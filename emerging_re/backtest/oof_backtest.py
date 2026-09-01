"""Out-of-fold backtest for ZORI composite.

Splits the panel at 2018-12-31: train ablation runs on <= 2018, feature
selection derived algorithmically from LOO drop_delta < 0 on ZORI 24mo+36mo
targets. Test window (>= 2019-01-01) evaluates the OOF-derived composite
against the current hardcoded ZORI_MAX_FEATURES list and a trailing-12mo
baseline.

Why this exists: ZORI_MAX_FEATURES was picked from an ablation run over
the full panel — feature selection and evaluation shared data. This
script quantifies how much of the composite's edge is genuine signal vs
selection bias, cohort by cohort.

Accepted leak: the 2018 cohort's 24mo/36mo forward returns land in
2020-2021, overlapping test cohorts. Small and unavoidable if we want
any train sample at all; flagged in the report header.

Run: `uv run python -m backtest.oof_backtest`
"""

from __future__ import annotations

import argparse
import logging
from pathlib import Path

import duckdb
import numpy as np
import pandas as pd
from scipy import stats

from ._scoring import (
    TIERS,
    ZORI_MAX_FEATURES,
    FeatureSpec,
    _ALL_FEATURES,
    _zscore,
)

logger = logging.getLogger(__name__)

WAREHOUSE_PATH = Path("data/warehouse/emerging_re.duckdb")
OUTPUT_DIR = Path("data/curated/backtest/oof")
BACKTEST_START_YEAR = 2015
TRAIN_END = pd.Timestamp("2018-12-31")
TEST_START = pd.Timestamp("2019-01-01")

# Feature selection uses 24mo + 36mo only (60mo would leave too few train
# cohorts). 60mo is still reported on TEST for completeness.
ZORI_SELECTION_TARGETS = (
    "target_zori_24mo_demeaned",
    "target_zori_36mo_demeaned",
)
ZORI_REPORT_TARGETS = (
    "target_zori_24mo_demeaned",
    "target_zori_36mo_demeaned",
    "target_zori_60mo_demeaned",
)
BASELINE_COL = "zori_yoy"
MIN_N = 30


def load_features(start_year: int) -> pd.DataFrame:
    if not WAREHOUSE_PATH.exists():
        raise RuntimeError(
            f"{WAREHOUSE_PATH} not found. Run `make dbt-build` first."
        )
    con = duckdb.connect(str(WAREHOUSE_PATH), read_only=True)
    df = con.execute(f"""
        SELECT * FROM main_marts.mart_county_features
        WHERE period_end_date >= DATE '{start_year}-01-01'
    """).df()
    logger.info(
        "Loaded %d rows (%d counties, %d periods)",
        len(df), df["fips"].nunique(), df["period_end_date"].nunique(),
    )
    return df


def score_with_features(
    df: pd.DataFrame,
    features: tuple[FeatureSpec, ...],
    score_col: str,
) -> pd.DataFrame:
    """Cross-sectional composite score per period using the given feature set.

    Mirrors _scoring.score_period() but takes features as an argument
    instead of reading the hardcoded composite specs. Equal weights,
    median imputation, tier-mean structure — unchanged.
    """
    def _score_period(group: pd.DataFrame) -> pd.DataFrame:
        out = group.copy()
        for spec in features:
            if spec.column not in out.columns:
                continue
            raw = out[spec.column]
            imputed = raw.fillna(raw.median(skipna=True))
            out[f"z_{spec.column}"] = spec.sign * _zscore(imputed)
        tier_score_cols: list[str] = []
        for tier in TIERS:
            z_cols = [
                f"z_{s.column}" for s in features
                if s.tier == tier and f"z_{s.column}" in out.columns
            ]
            if z_cols:
                col = f"_oof_tier_{tier}"
                out[col] = out[z_cols].mean(axis=1)
                tier_score_cols.append(col)
        if tier_score_cols:
            out[score_col] = out[tier_score_cols].mean(axis=1)
        else:
            out[score_col] = np.nan
        if "any_disqualifier" in out.columns:
            disq_mask = out["any_disqualifier"] == True  # noqa: E712
            out.loc[disq_mask, score_col] = np.nan
        return out

    return pd.concat(
        [_score_period(g) for _p, g in df.groupby("period_end_date")],
        ignore_index=False,
    )


def _spearman_rho(df: pd.DataFrame, x: str, y: str) -> float | None:
    valid = df[[x, y]].dropna()
    if len(valid) < MIN_N:
        return None
    rho, _ = stats.spearmanr(valid[x], valid[y])
    return float(rho)


def select_features_oof(
    train_df: pd.DataFrame,
) -> tuple[tuple[FeatureSpec, ...], pd.DataFrame]:
    """LOO ablation on TRAIN. Keep features whose removal HURTS avg ZORI Spearman."""
    logger.info(
        "LOO ablation on TRAIN (%d rows, %d periods) — %d candidate features",
        len(train_df), train_df["period_end_date"].nunique(), len(_ALL_FEATURES),
    )
    train_full = score_with_features(train_df, _ALL_FEATURES, score_col="_full")
    baseline_rhos: dict[str, float] = {}
    for target in ZORI_SELECTION_TARGETS:
        rho = _spearman_rho(train_full, "_full", target)
        baseline_rhos[target] = rho if rho is not None else float("nan")
        logger.info("  TRAIN full-composite Spearman %s = %+.4f", target, baseline_rhos[target])

    rows = []
    kept: list[FeatureSpec] = []
    for spec in _ALL_FEATURES:
        reduced = tuple(s for s in _ALL_FEATURES if s is not spec)
        ablated = score_with_features(train_df, reduced, score_col="_ablated")
        deltas: list[float] = []
        for target in ZORI_SELECTION_TARGETS:
            rho = _spearman_rho(ablated, "_ablated", target)
            if rho is None:
                continue
            deltas.append(rho - baseline_rhos[target])
        avg_delta = float(np.mean(deltas)) if deltas else float("nan")
        keep = avg_delta < 0
        if keep:
            kept.append(spec)
        rows.append({
            "feature": spec.column,
            "tier": spec.tier,
            "sign": spec.sign,
            "avg_drop_delta": avg_delta,
            "keep": keep,
        })
        logger.info(
            "  drop %-42s avg_delta=%+.4f  keep=%s",
            spec.column, avg_delta, keep,
        )

    ablation_df = pd.DataFrame(rows).sort_values("avg_drop_delta")
    return tuple(kept), ablation_df


def evaluate_test(
    scored: pd.DataFrame,
    score_col: str,
    label: str,
) -> list[dict]:
    """Per-cohort Spearman + Q1-Q5 spread on realized forward returns."""
    results: list[dict] = []
    df = scored.copy()
    df["cohort_year"] = df["period_end_date"].dt.year
    for year in sorted(df["cohort_year"].unique()):
        cohort = df[df["cohort_year"] == year]
        for target in ZORI_REPORT_TARGETS:
            valid = cohort[[score_col, target]].dropna()
            n = len(valid)
            if n < MIN_N:
                results.append({
                    "label": label, "cohort_year": int(year), "target": target,
                    "spearman": None, "q1_q5_spread": None, "n": n,
                })
                continue
            rho, _ = stats.spearmanr(valid[score_col], valid[target])
            ranked = valid.sort_values(score_col, ascending=False)
            q = max(n // 5, 1)
            top_mean = ranked[target].iloc[:q].mean()
            bot_mean = ranked[target].iloc[-q:].mean()
            results.append({
                "label": label, "cohort_year": int(year), "target": target,
                "spearman": float(rho),
                "q1_q5_spread": float(top_mean - bot_mean),
                "n": n,
            })
    return results


def print_report(
    all_results: list[dict],
    selected: tuple[FeatureSpec, ...],
    ablation_df: pd.DataFrame,
) -> None:
    print("\n" + "=" * 82)
    print("OOF BACKTEST — ZORI COMPOSITE")
    print("=" * 82)
    print(f"Train window: <= {TRAIN_END.date()}   |   Test window: >= {TEST_START.date()}")
    print("Note: 2018 cohort's 24/36mo forward returns land in 2020-2021 (mild overlap).")
    print()

    print(f"--- OOF feature selection ({len(selected)}/{len(_ALL_FEATURES)} kept) ---")
    for _, row in ablation_df.iterrows():
        marker = "KEEP" if row["keep"] else "drop"
        print(
            f"  {marker}  {row['feature']:<42} tier={row['tier']:<16} "
            f"sign={int(row['sign']):+d}  avg_delta={row['avg_drop_delta']:+.4f}"
        )
    print()

    hardcoded_cols = {s.column for s in ZORI_MAX_FEATURES}
    oof_cols = {s.column for s in selected}
    added = sorted(oof_cols - hardcoded_cols)
    removed = sorted(hardcoded_cols - oof_cols)
    kept_same = sorted(oof_cols & hardcoded_cols)
    print("--- Membership diff: OOF vs current ZORI_MAX_FEATURES ---")
    print(f"  Kept by both  ({len(kept_same)}): {kept_same or '(none)'}")
    print(f"  OOF-only add  ({len(added)}): {added or '(none)'}")
    print(f"  OOF removes   ({len(removed)}): {removed or '(none)'}")
    print()

    df = pd.DataFrame(all_results)

    print("=" * 82)
    print("PER-COHORT TEST — SPEARMAN (higher = better)")
    print("=" * 82)
    for target in ZORI_REPORT_TARGETS:
        print(f"\n  {target}")
        pivot = df[df["target"] == target].pivot(
            index="cohort_year", columns="label", values="spearman",
        )
        print(pivot.round(4).to_string())

    print("\n" + "=" * 82)
    print("PER-COHORT TEST — Q1-Q5 SPREAD (top quintile − bottom quintile forward return, pp)")
    print("=" * 82)
    for target in ZORI_REPORT_TARGETS:
        print(f"\n  {target}")
        pivot = df[df["target"] == target].pivot(
            index="cohort_year", columns="label", values="q1_q5_spread",
        )
        print((pivot * 100).round(2).to_string())

    print("\n" + "=" * 82)
    print("SAMPLE SIZES (n per cohort × target)")
    print("=" * 82)
    n_pivot = df[df["label"] == "OOF"].pivot(
        index="cohort_year", columns="target", values="n",
    )
    print(n_pivot.to_string())
    print()


def main() -> None:
    parser = argparse.ArgumentParser(description="OOF backtest for ZORI composite")
    parser.add_argument("--start-year", type=int, default=BACKTEST_START_YEAR)
    parser.add_argument("--output-dir", type=Path, default=OUTPUT_DIR)
    parser.add_argument("--verbose", "-v", action="store_true")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(name)s %(levelname)s: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    features_df = load_features(args.start_year)
    features_df["period_end_date"] = pd.to_datetime(features_df["period_end_date"])

    train_df = features_df[features_df["period_end_date"] <= TRAIN_END].copy()
    test_df = features_df[features_df["period_end_date"] >= TEST_START].copy()
    logger.info(
        "Split: train=%d rows (%d periods), test=%d rows (%d periods)",
        len(train_df), train_df["period_end_date"].nunique(),
        len(test_df), test_df["period_end_date"].nunique(),
    )

    selected, ablation_df = select_features_oof(train_df)
    logger.info("OOF selection kept %d of %d features", len(selected), len(_ALL_FEATURES))

    test_oof = score_with_features(test_df, selected, score_col="oof_score")
    test_hard = score_with_features(test_df, ZORI_MAX_FEATURES, score_col="hardcoded_score")
    test_scored = test_oof.copy()
    test_scored["hardcoded_score"] = test_hard["hardcoded_score"].values

    all_results: list[dict] = []
    all_results += evaluate_test(test_scored, "oof_score", "OOF")
    all_results += evaluate_test(test_scored, "hardcoded_score", "HARDCODED")
    all_results += evaluate_test(test_scored, BASELINE_COL, "BASELINE_yoy")

    args.output_dir.mkdir(parents=True, exist_ok=True)
    pd.DataFrame(all_results).to_parquet(args.output_dir / "results.parquet", index=False)
    ablation_df.to_parquet(args.output_dir / "ablation.parquet", index=False)
    logger.info("Wrote %s", args.output_dir / "results.parquet")

    print_report(all_results, selected, ablation_df)


if __name__ == "__main__":
    main()
