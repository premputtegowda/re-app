"""Emerging-RE backtest orchestrator.

Reads mart_county_features from the dbt-built DuckDB warehouse. Applies
the pre-registered scoring function to every period from 2015 onward.
Evaluates composite score, baseline, and per-feature ablation against
both forward-return targets, split by regime.

Writes two Parquet outputs:
    data/curated/backtest/scores/scores.parquet
        one row per (fips, period_end_date) with score + rank + tier
        contributions. Consumed by mart_backtest_scores.
    data/curated/backtest/diagnostics/diagnostics.parquet
        one row per (experiment, target, regime) with spearman + n.
        Consumed by mart_backtest_diagnostics.

Also prints a summary table to stdout for immediate feedback.

Run: `uv run python -m backtest.run_backtest`
"""

from __future__ import annotations

import argparse
import logging
from datetime import date, datetime
from pathlib import Path

import duckdb
import pandas as pd

from ._diagnostics import evaluate, evaluate_ablation, evaluate_baseline
from ._scoring import COMPOSITES, FEATURES, TIERS, score_all_periods

logger = logging.getLogger(__name__)

WAREHOUSE_PATH = Path("data/warehouse/emerging_re.duckdb")
OUTPUT_DIR = Path("data/curated/backtest")
BACKTEST_START_YEAR = 2015  # per DECISIONS.md §7


def load_features(start_year: int) -> pd.DataFrame:
    """Read the full mart_county_features table for the backtest window."""
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
        "Loaded %d rows from mart_county_features (%d counties, %d periods)",
        len(df), df["fips"].nunique(), df["period_end_date"].nunique(),
    )
    return df


def write_scores(scored: pd.DataFrame, out_dir: Path) -> Path:
    """Write per-(fips, period) scores + rank + tier contributions."""
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / "scores.parquet"

    # Build keep_cols dynamically. Emit both the JOINT alias
    # (composite_score) and per-composite scores/ranks so downstream marts
    # can pick the composite matching an investor's strategy.
    keep_cols = [
        "fips", "period_end_date", "county_name", "state_name", "pop_latest",
        "composite_score", "composite_rank",
        *[f"score_{t}" for t in TIERS],
        # Per-composite scores + ranks
        *[c.score_col for c in COMPOSITES],
        *[c.rank_col for c in COMPOSITES],
        # Per-composite tier scores (for "why this score" breakdowns)
        *[f"{c.name}_score_{t}" for c in COMPOSITES for t in TIERS],
        "any_disqualifier",
        # Individual feature z-scores — useful for the UI "why is this ranked
        # 14th" contribution breakdown.
        *[f"z_{s.column}" for s in FEATURES],
        # Realized targets — 24mo + 36mo horizons.
        "target_hpi_24mo_demeaned",
        "target_zori_24mo_demeaned",
        "target_hpi_36mo_demeaned",
        "target_zori_36mo_demeaned",
        "target_hpi_60mo_demeaned",
        "target_zori_60mo_demeaned",
        "hpi_forward_return_24mo",
        "zori_forward_return_24mo",
        "hpi_forward_return_36mo",
        "zori_forward_return_36mo",
        "hpi_forward_return_60mo",
        "zori_forward_return_60mo",
    ]
    keep_cols = [c for c in keep_cols if c in scored.columns]
    scored[keep_cols].to_parquet(out_path, index=False)
    logger.info("Wrote scores: %s (%d rows)", out_path, len(scored))
    return out_path


def write_diagnostics(all_results: list, out_dir: Path) -> Path:
    """Write per-(experiment, target, regime) diagnostics."""
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / "diagnostics.parquet"
    df = pd.DataFrame([{
        "experiment": r.experiment,
        "target": r.target,
        "regime": r.regime,
        "spearman": r.spearman,
        "n": r.n,
        "p_value": r.p_value,
        "scoring_run_ts": datetime.utcnow().isoformat(),
    } for r in all_results])
    df.to_parquet(out_path, index=False)
    logger.info("Wrote diagnostics: %s (%d rows)", out_path, len(df))
    return out_path


def print_summary(all_results: list) -> None:
    """Human-readable summary — the moment-of-truth table."""
    # Parse target into (metric, horizon) for cleaner display.
    def _split_target(t: str) -> tuple[str, str]:
        # e.g. "target_hpi_24mo_demeaned" → ("hpi", "24mo")
        parts = t.replace("target_", "").replace("_demeaned", "").split("_")
        return parts[0], parts[1]  # (metric, horizon)

    df = pd.DataFrame([{
        "experiment": r.experiment,
        "metric": _split_target(r.target)[0],
        "horizon": _split_target(r.target)[1],
        "regime": r.regime,
        "spearman": r.spearman if r.spearman is not None else float("nan"),
        "n": r.n,
    } for r in all_results])

    print("\n" + "=" * 78)
    print("PHASE 3 BACKTEST — SPEARMAN RANK CORRELATION")
    print("=" * 78)

    # For 3-composite mode: show hpi/zori/joint side-by-side vs baseline.
    for horizon in ("24mo", "36mo", "60mo"):
        print(f"\n\n{'=' * 30} HORIZON = {horizon} {'=' * 30}")
        for metric in ("hpi", "zori"):
            view = df[
                (df["metric"] == metric)
                & (df["horizon"] == horizon)
                & (df["experiment"].isin(["hpi", "zori", "joint", "baseline"]))
                & (df["regime"] == "all")
            ].pivot(index="regime", columns="experiment", values="spearman")
            print(f"\n--- {metric.upper()} {horizon} — Spearman by composite (regime=all) ---")
            print(view.round(4).to_string())

        # Ship criterion — target-specific.
        # ZORI-max only needs to beat baseline on ZORI (ignores HPI).
        # HPI-max only needs to beat baseline on HPI.
        # JOINT must beat baseline on BOTH.
        print(f"\n--- SHIP CRITERION (target-specific, delta >= 0.05, {horizon}) ---")

        def _get(exp: str, metric: str) -> float | None:
            rows = df[
                (df["experiment"] == exp) & (df["metric"] == metric)
                & (df["horizon"] == horizon) & (df["regime"] == "all")
            ]
            return None if rows.empty else rows["spearman"].iloc[0]

        for exp, target_metrics in (
            ("hpi", ("hpi",)),
            ("zori", ("zori",)),
            ("joint", ("hpi", "zori")),
        ):
            verdicts = []
            for m in target_metrics:
                comp = _get(exp, m)
                base = _get("baseline", m)
                if comp is None or base is None:
                    verdicts.append(f"{m.upper()} n/a")
                    continue
                delta = comp - base
                v = "PASS" if delta >= 0.05 else "FAIL"
                verdicts.append(f"{m.upper()} composite={comp:+.4f} baseline={base:+.4f} delta={delta:+.4f} [{v}]")
            print(f"  {exp.upper():5s}: {'  |  '.join(verdicts)}")

    # Ablation — which features matter? Show for both horizons + both metrics.
    print("\n\n--- FEATURE ABLATION ('all' regime, sorted by importance) ---")
    for horizon in ("24mo", "36mo", "60mo"):
        for metric in ("hpi", "zori"):
            try:
                comp_all = df[(df["experiment"] == "composite") & (df["metric"] == metric) & (df["horizon"] == horizon) & (df["regime"] == "all")]["spearman"].iloc[0]
            except (IndexError, KeyError):
                continue
            print(f"\n  Target = {metric.upper()} {horizon} (composite = {comp_all:+.4f})")
            ablation_rows = df[
                df["experiment"].str.startswith("ablation:")
                & (df["metric"] == metric)
                & (df["horizon"] == horizon)
                & (df["regime"] == "all")
            ].copy()
            ablation_rows["feature_dropped"] = ablation_rows["experiment"].str.replace("ablation:drop_", "")
            ablation_rows["delta_vs_full"] = ablation_rows["spearman"] - comp_all
            ablation_rows = ablation_rows.sort_values("delta_vs_full")
            for _, row in ablation_rows.iterrows():
                marker = "!" if row["delta_vs_full"] < -0.01 else " "
                print(f"    {marker} drop {row['feature_dropped']:<35} spearman={row['spearman']:+.4f}  delta={row['delta_vs_full']:+.4f}")

    print("\n" + "=" * 78 + "\n")


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the emerging-re backtest")
    parser.add_argument(
        "--start-year", type=int, default=BACKTEST_START_YEAR,
        help=f"First scoring year (default: {BACKTEST_START_YEAR})",
    )
    parser.add_argument(
        "--output-dir", type=Path, default=OUTPUT_DIR,
        help=f"Output directory for Parquet files (default: {OUTPUT_DIR})",
    )
    parser.add_argument("--verbose", "-v", action="store_true", help="DEBUG logging")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(name)s %(levelname)s: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    # 1. Load features
    features_df = load_features(args.start_year)

    # 2. Score every period
    logger.info("Scoring %d rows across %d periods", len(features_df), features_df["period_end_date"].nunique())
    scored = score_all_periods(features_df)

    # 3. Evaluate each composite + baseline + ablation
    all_results = []
    for comp in COMPOSITES:
        logger.info("Evaluating %s composite across regimes", comp.name)
        all_results.extend(evaluate(
            scored, experiment_label=comp.name, score_col=comp.score_col,
        ))
    # Also emit legacy "composite" label (alias for JOINT) so back-compat
    # dashboards keep working.
    all_results.extend(evaluate(scored, experiment_label="composite"))

    logger.info("Evaluating baseline (trailing 12mo momentum)")
    all_results.extend(evaluate_baseline(scored))

    logger.info("Running leave-one-out ablation on %d features", len(FEATURES))
    all_results.extend(evaluate_ablation(scored, features_df))

    # 4. Persist
    write_scores(scored, args.output_dir / "scores")
    write_diagnostics(all_results, args.output_dir / "diagnostics")

    # 5. Print summary
    print_summary(all_results)


if __name__ == "__main__":
    main()
