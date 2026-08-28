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
from ._scoring import FEATURES, score_all_periods

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

    keep_cols = [
        "fips", "period_end_date", "county_name", "state_name", "pop_latest",
        "composite_score", "composite_rank",
        "score_tier1_demand", "score_tier2_supply", "score_tier3_pricing",
        "any_disqualifier",
        # Individual feature z-scores — useful for the UI "why is this ranked
        # 14th" contribution breakdown.
        *[f"z_{s.column}" for s in FEATURES],
        # Also keep the targets so the UI can show realized-vs-predicted per
        # county without joining back.
        "target_hpi_24mo_demeaned",
        "target_zori_24mo_demeaned",
        "hpi_forward_return_24mo",
        "zori_forward_return_24mo",
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
    df = pd.DataFrame([{
        "experiment": r.experiment,
        "target": r.target.replace("target_", "").replace("_24mo_demeaned", ""),
        "regime": r.regime,
        "spearman": r.spearman if r.spearman is not None else float("nan"),
        "n": r.n,
    } for r in all_results])

    print("\n" + "=" * 78)
    print("PHASE 3 BACKTEST — SPEARMAN RANK CORRELATION")
    print("=" * 78)

    # Baseline vs composite comparison — the ship criterion table.
    print("\n--- HEAD-TO-HEAD: composite vs baseline (target = HPI 24mo demeaned) ---")
    hpi_view = df[
        (df["target"] == "hpi")
        & (df["experiment"].isin(["composite", "baseline"]))
    ].pivot(index="regime", columns="experiment", values="spearman")
    print(hpi_view.round(4).to_string())

    print("\n--- HEAD-TO-HEAD: composite vs baseline (target = ZORI 24mo demeaned) ---")
    zori_view = df[
        (df["target"] == "zori")
        & (df["experiment"].isin(["composite", "baseline"]))
    ].pivot(index="regime", columns="experiment", values="spearman")
    print(zori_view.round(4).to_string())

    # Ship criterion: composite beats baseline by >=0.05 Spearman on
    # at least one target in the "all" regime.
    print("\n--- SHIP CRITERION (composite beats baseline by >= 0.05 Spearman) ---")
    for target in ("hpi", "zori"):
        try:
            comp = df[(df["experiment"] == "composite") & (df["target"] == target) & (df["regime"] == "all")]["spearman"].iloc[0]
            base = df[(df["experiment"] == "baseline") & (df["target"] == target) & (df["regime"] == "all")]["spearman"].iloc[0]
            delta = comp - base
            verdict = "PASS" if delta >= 0.05 else "FAIL"
            print(f"  {target.upper()}: composite={comp:+.4f}, baseline={base:+.4f}, delta={delta:+.4f} [{verdict}]")
        except (IndexError, KeyError):
            print(f"  {target.upper()}: insufficient data")

    # Ablation — which features matter?
    print("\n--- FEATURE ABLATION (drop feature, measure Spearman change, 'all' regime) ---")
    for target in ("hpi", "zori"):
        try:
            comp_all = df[(df["experiment"] == "composite") & (df["target"] == target) & (df["regime"] == "all")]["spearman"].iloc[0]
        except (IndexError, KeyError):
            continue
        print(f"\n  Target = {target.upper()} (composite = {comp_all:+.4f})")
        ablation_rows = df[
            df["experiment"].str.startswith("ablation:")
            & (df["target"] == target)
            & (df["regime"] == "all")
        ].copy()
        ablation_rows["feature_dropped"] = ablation_rows["experiment"].str.replace("ablation:drop_", "")
        ablation_rows["delta_vs_full"] = ablation_rows["spearman"] - comp_all
        # Feature importance = -delta (bigger drop = more important).
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

    # 3. Evaluate composite + baseline + ablation
    logger.info("Evaluating composite score across regimes")
    composite_results = evaluate(scored, experiment_label="composite")

    logger.info("Evaluating baseline (trailing 12mo momentum)")
    baseline_results = evaluate_baseline(scored)

    logger.info("Running leave-one-out ablation on %d features", len(FEATURES))
    ablation_results = evaluate_ablation(scored, features_df)

    all_results = composite_results + baseline_results + ablation_results

    # 4. Persist
    write_scores(scored, args.output_dir / "scores")
    write_diagnostics(all_results, args.output_dir / "diagnostics")

    # 5. Print summary
    print_summary(all_results)


if __name__ == "__main__":
    main()
