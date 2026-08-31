"""Multi-cohort spillover backtest — is 2020 result robust across regimes?

For each historical cohort (2015-2020 for 5yr, 2015-2023 for 2yr horizon):
    1. Score all counties leak-free (using ONLY data at cohort_date)
    2. Compute spillover using cohort_date Tier-1 momentum
    3. Compare realized returns for:
         a. Composite-only
         b. Spillover-only
         c. Combined (rank sum)

Report:
    - Per-cohort Q1-Q5 spread (does each cohort validate?)
    - Mean spread across cohorts (average edge)
    - Consistency (# cohorts with positive spread)

If spillover shows +spread in most/all cohorts → robust signal.
If only 2020 → COVID-specific fluke.

Run: `uv run python -m analytics.multi_cohort_backtest`
"""

from __future__ import annotations

import logging
from datetime import date
from pathlib import Path

import duckdb
import numpy as np
import pandas as pd

from analytics.spillover_model import (
    compute_spillover, load_centroids, WAREHOUSE,
)

logger = logging.getLogger(__name__)

# Cohorts to test per horizon. Constrained by realized-return availability
# (today is Aug 2026, so 5yr forward from 2020 = 2025 ✓, 6yr = 2026 ✗).
COHORTS_60MO = list(range(2015, 2021))  # 6 cohorts (2015..2020)
COHORTS_36MO = list(range(2015, 2023))  # 8 cohorts (2015..2022) — 2022→2025 ✓
COHORTS_24MO = list(range(2015, 2024))  # 9 cohorts (2015..2023)


def load_features_at(con: duckdb.DuckDBPyConnection, cohort_date: date) -> pd.DataFrame:
    """Cohort features + realized returns at each horizon + composite ranks."""
    q = f"""
      select
        f.fips, f.county_name, f.state_name, f.pop_latest,
        f.hpi_yoy, f.zori_yoy,
        s.hpi_forward_return_24mo,
        s.zori_forward_return_24mo,
        s.hpi_forward_return_36mo,
        s.zori_forward_return_36mo,
        s.hpi_forward_return_60mo,
        s.zori_forward_return_60mo,
        -- Use scores (not ranks) so we can filter NaN before quintile-cutting.
        -- Rank ties from disqualified counties (~750/977 in 2022) break qcut.
        s.composite_score,
        s.hpi_composite_score,
        s.zori_composite_score
      from main_marts.mart_county_features f
      left join main_marts.mart_backtest_scores s
        on s.fips = f.fips and s.period_end_date = f.period_end_date
      where f.period_end_date = date '{cohort_date}'
    """
    return con.execute(q).fetchdf()


def quintile_spread(df: pd.DataFrame, rank_col: str, ret_col: str) -> tuple[float, float, int]:
    """Return (Q1_mean, Q5_mean, n_valid). Values in raw units (not %)."""
    valid = df.dropna(subset=[rank_col, ret_col]).copy()
    if len(valid) < 50:
        return (np.nan, np.nan, len(valid))
    try:
        valid["q"] = pd.qcut(valid[rank_col], 5, labels=[1, 2, 3, 4, 5], duplicates="drop")
    except ValueError:
        # Not enough distinct rank values to form 5 quintiles.
        return (np.nan, np.nan, len(valid))
    means = valid.groupby("q", observed=True)[ret_col].mean()
    return (float(means.get(1, np.nan)), float(means.get(5, np.nan)), len(valid))


def run_cohort(con: duckdb.DuckDBPyConnection, cohort_year: int, centroids: pd.DataFrame) -> dict:
    """Score one cohort and return per-strategy Q1-Q5 spreads for both horizons."""
    cohort_date = date(cohort_year, 12, 31)
    cohort = load_features_at(con, cohort_date)
    if cohort.empty or cohort["hpi_yoy"].notna().sum() == 0:
        logger.warning("Cohort %d: no usable data, skipping", cohort_year)
        return None

    scored = compute_spillover(cohort, centroids)

    # Re-rank composites at this cohort using SCORES not stored ranks —
    # so we skip disqualified counties (they have NaN composite_score
    # even though stored rank ties them all at the same "last" rank).
    for target in ("hpi", "zori"):
        score_col = f"{target}_composite_score"
        rank_col = f"{target}_composite_rank"
        scored[rank_col] = scored[score_col].rank(ascending=False, method="min", na_option="keep")

    # Combined ranks (rank sum, target-specific composites).
    for target in ("hpi", "zori"):
        comp_col = f"{target}_composite_rank"
        spill_col = f"spillover_{target}_rank"
        combo = f"combined_{target}_rank_sum"
        rank_combo = f"combined_{target}_rank"
        # For counties with NaN composite, use spillover-only for combined
        # (rather than penalizing them with rank_max).
        scored[combo] = scored[comp_col].fillna(scored[spill_col]) + scored[spill_col].fillna(scored[comp_col])
        scored[rank_combo] = scored[combo].rank(ascending=True, method="min")

    row = {"cohort_year": cohort_year, "n_universe": len(scored)}
    for horizon in (24, 36, 60):
        for target in ("hpi", "zori"):
            ret_col = f"{target}_forward_return_{horizon}mo"
            if scored[ret_col].isna().all():
                continue
            for strat, rank_col in [
                ("composite", f"{target}_composite_rank"),
                ("spillover", f"spillover_{target}_rank"),
                ("combined", f"combined_{target}_rank"),
            ]:
                q1, q5, n = quintile_spread(scored, rank_col, ret_col)
                key = f"{target}_{horizon}mo_{strat}"
                row[f"{key}_q1_pct"] = round((q1 or 0) * 100, 2) if not np.isnan(q1) else np.nan
                row[f"{key}_q5_pct"] = round((q5 or 0) * 100, 2) if not np.isnan(q5) else np.nan
                row[f"{key}_spread_pp"] = round((q1 - q5) * 100, 2) if not (np.isnan(q1) or np.isnan(q5)) else np.nan
                row[f"{key}_n"] = n
    return row


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(name)s %(levelname)s: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
    con = duckdb.connect(str(WAREHOUSE), read_only=True)
    centroids = load_centroids()

    all_cohorts = sorted(set(COHORTS_60MO) | set(COHORTS_24MO))
    rows = []
    for year in all_cohorts:
        logger.info("Scoring cohort %d", year)
        r = run_cohort(con, year, centroids)
        if r:
            rows.append(r)

    df = pd.DataFrame(rows)

    # Per-horizon, per-target summary: mean spread + # positive cohorts.
    print("\n" + "=" * 88)
    print("MULTI-COHORT SPILLOVER BACKTEST — Q1-Q5 spread by cohort, target, horizon")
    print("=" * 88)
    for horizon in (24, 36, 60):
        for target in ("hpi", "zori"):
            key_prefix = f"{target}_{horizon}mo"
            comp_col = f"{key_prefix}_composite_spread_pp"
            spill_col = f"{key_prefix}_spillover_spread_pp"
            combo_col = f"{key_prefix}_combined_spread_pp"
            if comp_col not in df.columns or df[comp_col].isna().all():
                continue
            print(f"\n\n── {target.upper()} {horizon}mo target ──")
            table = df[["cohort_year", comp_col, spill_col, combo_col, f"{key_prefix}_composite_n"]].copy()
            table.columns = ["Cohort", "Comp Q1-Q5", "Spillover Q1-Q5", "Combined Q1-Q5", "n"]
            print(table.to_string(index=False))
            for col_short, col_full in [("Comp", comp_col), ("Spillover", spill_col), ("Combined", combo_col)]:
                vals = df[col_full].dropna()
                mean_spread = vals.mean()
                pos_count = (vals > 0).sum()
                total_count = len(vals)
                print(f"  {col_short:10s}: mean spread = {mean_spread:+.2f} pp  |  {pos_count}/{total_count} cohorts positive")

    # Save results.
    out_path = Path(__file__).resolve().parent.parent / "data/curated/backtest/multi_cohort_spillover.parquet"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(out_path, index=False)
    logger.info("\nDetailed results → %s", out_path)


if __name__ == "__main__":
    main()
