"""Backtest: does the double-conviction (composite + analog) strategy work?

Leak-free point-in-time test for 2020 cohort:
    1. Load winners with winner_period < 2020-01-01 (no look-ahead)
    2. Score all 2020-12-31 counties against those pre-2020 analogs
    3. Load composite score at 2020-12-31 (already computed leak-free)
    4. Load realized 2020→2025 returns (5yr forward)
    5. Compare quintile spread for:
         a. Composite-only ranking
         b. Analog-only ranking
         c. Combined (rank sum)
         d. Combined (strict intersection: top quintile of both)

Expected: if double conviction adds value, strategy (c) or (d) beats (a) and (b).

Run: `uv run python -m analytics.double_conviction_backtest`
"""

from __future__ import annotations

import logging
from datetime import date
from pathlib import Path

import duckdb
import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)

# Same features used by the production analog matcher.
ANALOG_FEATURES = [
    "domesticmig_per_1000",
    "domesticmig_accel_3yr",
    "emp_growth_yoy_demeaned",
    "wage_growth_yoy_demeaned",
    "high_wage_share",
    "high_wage_share_yoy_chg",
    "renter_ind_emp_yoy",
    "hpi_yoy",
    "zori_yoy",
]

# Backtest configuration.
BACKTEST_COHORT = date(2020, 12, 31)  # score at this date
WINNER_CUTOFF = date(2020, 1, 1)      # only use winners identified before this
WINNER_DECILE_MIN = 9
TOP_K_ANALOGS = 5

WAREHOUSE = Path(__file__).resolve().parent.parent / "data/warehouse/emerging_re.duckdb"


def load_pre_cutoff_winners(con: duckdb.DuckDBPyConnection, cutoff: date) -> pd.DataFrame:
    """Winners identified BEFORE the cutoff — leak-free training set.

    Note: a "winner" here means top-decile 5yr forward return starting from
    winner_period. So winner_period + 5yr must be observable. Since we're
    using cutoff=2020-01-01, valid winners have winner_period in
    [2013-01-01, 2019-12-31] with realized 5yr returns available.
    """
    q = f"""
      with forward as (
        select
          fips, county_name, state_name, period_end_date,
          hpi_forward_return_60mo, zori_forward_return_60mo,
          ntile(10) over (partition by period_end_date order by hpi_forward_return_60mo) as hpi_dec,
          ntile(10) over (partition by period_end_date order by zori_forward_return_60mo) as zori_dec
        from main_marts.mart_backtest_scores
        where hpi_forward_return_60mo is not null
          and zori_forward_return_60mo is not null
          and period_end_date < date '{cutoff}'
      )
      select
        fips, county_name, state_name, period_end_date as winner_period,
        hpi_forward_return_60mo, zori_forward_return_60mo
      from forward
      where hpi_dec >= {WINNER_DECILE_MIN}
        and zori_dec >= {WINNER_DECILE_MIN}
        and period_end_date >= date '2013-01-01'
    """
    return con.execute(q).fetchdf()


def load_features_at(con: duckdb.DuckDBPyConnection, cohort: date) -> pd.DataFrame:
    """Join raw features (mart_county_features) with realized returns +
    composite rank (mart_backtest_scores)."""
    cols = ", ".join(f"f.{c}" for c in ANALOG_FEATURES)
    q = f"""
      select
        f.fips, f.county_name, f.state_name, {cols},
        s.hpi_forward_return_60mo,
        s.zori_forward_return_60mo,
        s.composite_rank as composite_rank_at_cohort
      from main_marts.mart_county_features f
      left join main_marts.mart_backtest_scores s
        on s.fips = f.fips and s.period_end_date = f.period_end_date
      where f.period_end_date = date '{cohort}'
    """
    return con.execute(q).fetchdf()


def load_winner_features(
    con: duckdb.DuckDBPyConnection, winners: pd.DataFrame
) -> pd.DataFrame:
    cols = ", ".join(ANALOG_FEATURES)
    pairs = ", ".join(
        f"('{r.fips}', date '{r.winner_period.strftime('%Y-%m-%d')}')"
        for r in winners.itertuples()
    )
    q = f"""
      with keys(fips, period_end_date) as (values {pairs})
      select f.fips, f.period_end_date, {cols}
      from main_marts.mart_county_features f
      inner join keys k on k.fips = f.fips and k.period_end_date = f.period_end_date
    """
    return con.execute(q).fetchdf()


def zscore_matrix(df: pd.DataFrame, cols: list[str], mus: dict, sds: dict) -> np.ndarray:
    Z = df[cols].copy()
    for c in cols:
        Z[c] = (Z[c] - mus[c]) / sds[c] if sds[c] else 0.0
    return np.nan_to_num(Z.to_numpy(dtype=float), nan=0.0)


def cosine_similarity(A: np.ndarray, B: np.ndarray) -> np.ndarray:
    A_n = A / np.clip(np.linalg.norm(A, axis=1, keepdims=True), 1e-9, None)
    B_n = B / np.clip(np.linalg.norm(B, axis=1, keepdims=True), 1e-9, None)
    return A_n @ B_n.T


def evaluate_strategy(df: pd.DataFrame, rank_col: str, ret_col: str, label: str) -> dict:
    """Given a rank column (1 = best) and a return column, compute quintile
    mean returns + Q1-Q5 spread + hit rate for top decile."""
    valid = df.dropna(subset=[rank_col, ret_col]).copy()
    if len(valid) == 0:
        return {"strategy": label, "n": 0}
    valid["quintile"] = pd.qcut(valid[rank_col], 5, labels=[1, 2, 3, 4, 5])
    q_means = valid.groupby("quintile", observed=True)[ret_col].mean() * 100
    return {
        "strategy": label,
        "n": len(valid),
        "q1_mean_ret_pct": round(float(q_means.get(1, np.nan)), 2),
        "q2_mean_ret_pct": round(float(q_means.get(2, np.nan)), 2),
        "q3_mean_ret_pct": round(float(q_means.get(3, np.nan)), 2),
        "q4_mean_ret_pct": round(float(q_means.get(4, np.nan)), 2),
        "q5_mean_ret_pct": round(float(q_means.get(5, np.nan)), 2),
        "q1_minus_q5": round(float(q_means.get(1, np.nan) - q_means.get(5, np.nan)), 2),
    }


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(name)s %(levelname)s: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
    con = duckdb.connect(str(WAREHOUSE), read_only=True)

    # 1. Winners with winner_period < WINNER_CUTOFF.
    winners = load_pre_cutoff_winners(con, WINNER_CUTOFF)
    logger.info("Pre-%s winners: %d across %d vintages",
                WINNER_CUTOFF, len(winners), winners["winner_period"].nunique())

    winner_feats = load_winner_features(con, winners)
    winners_full = winners.merge(
        winner_feats,
        left_on=["fips", "winner_period"], right_on=["fips", "period_end_date"],
    )
    logger.info("Winners with feature snapshots: %d", len(winners_full))

    # 2. All 2020-12-31 features + realized 5yr returns + composite rank.
    cohort = load_features_at(con, BACKTEST_COHORT)
    logger.info("Cohort %s: %d counties (%d with realized 5yr HPI, %d with ZORI)",
                BACKTEST_COHORT, len(cohort),
                cohort["hpi_forward_return_60mo"].notna().sum(),
                cohort["zori_forward_return_60mo"].notna().sum())

    # 3. Compute analog similarity: cohort × winners.
    pooled = pd.concat(
        [winners_full[ANALOG_FEATURES], cohort[ANALOG_FEATURES]], ignore_index=True
    )
    mus = {c: pooled[c].mean(skipna=True) for c in ANALOG_FEATURES}
    sds = {c: pooled[c].std(ddof=0, skipna=True) for c in ANALOG_FEATURES}

    W_z = zscore_matrix(winners_full, ANALOG_FEATURES, mus, sds)
    C_z = zscore_matrix(cohort, ANALOG_FEATURES, mus, sds)

    sim = cosine_similarity(C_z, W_z)
    top_k = min(TOP_K_ANALOGS, sim.shape[1])
    top_k_idx = np.argsort(-sim, axis=1)[:, :top_k]
    top_k_sim = np.take_along_axis(sim, top_k_idx, axis=1)
    cohort["analog_score"] = top_k_sim.mean(axis=1)
    cohort["analog_rank"] = cohort["analog_score"].rank(ascending=False, method="min").astype(int)

    # 4. Combined ranks.
    cohort["combined_rank_sum"] = (
        cohort["composite_rank_at_cohort"].fillna(len(cohort) + 1)
        + cohort["analog_rank"].fillna(len(cohort) + 1)
    )
    cohort["combined_rank"] = cohort["combined_rank_sum"].rank(ascending=True, method="min").astype(int)

    # 5. Evaluate strategies vs realized returns.
    print("\n" + "=" * 80)
    print(f"POINT-IN-TIME BACKTEST — cohort {BACKTEST_COHORT}, target 5yr forward returns")
    print(f"Winners drawn from vintages < {WINNER_CUTOFF} (no look-ahead)")
    print("=" * 80)

    for target, target_label in [
        ("hpi_forward_return_60mo", "HPI 5-year"),
        ("zori_forward_return_60mo", "ZORI 5-year"),
    ]:
        print(f"\n\n── Target: {target_label} ──\n")
        results = []
        for rank_col, label in [
            ("composite_rank_at_cohort", "Composite-only"),
            ("analog_rank", "Analog-only"),
            ("combined_rank", "Combined (rank sum)"),
        ]:
            results.append(evaluate_strategy(cohort, rank_col, target, label))

        # Also: strict double-conviction (top quintile of BOTH)
        n = len(cohort.dropna(subset=[target]))
        quintile_size = n // 5
        double = cohort.dropna(subset=[target]).copy()
        double["comp_q1"] = double["composite_rank_at_cohort"].rank(method="min") <= quintile_size
        double["anlg_q1"] = double["analog_rank"].rank(method="min") <= quintile_size
        double["is_double"] = double["comp_q1"] & double["anlg_q1"]
        n_double = int(double["is_double"].sum())
        if n_double >= 5:
            mean_double = float(double[double["is_double"]][target].mean() * 100)
            mean_universe = float(double[target].mean() * 100)
            results.append({
                "strategy": f"Double-conviction (top-Q1 both)  [{n_double} counties]",
                "n": n_double,
                "q1_mean_ret_pct": round(mean_double, 2),
                "q2_mean_ret_pct": None, "q3_mean_ret_pct": None,
                "q4_mean_ret_pct": None, "q5_mean_ret_pct": None,
                "q1_minus_q5": round(mean_double - mean_universe, 2),
            })

        print(pd.DataFrame(results).to_string(index=False))

        # List the actual "double-conviction" picks + their realized returns.
        if n_double >= 5:
            print(f"\n  Double-conviction picks ({n_double} counties):")
            picks = double[double["is_double"]][[
                "fips", "county_name", "state_name",
                "composite_rank_at_cohort", "analog_rank", target,
            ]].copy()
            picks["ret_pct"] = (picks[target] * 100).round(1)
            picks = picks.sort_values("ret_pct", ascending=False)
            for _, r in picks.iterrows():
                print(f"    {r['county_name']:<32s} ({r['state_name']:<15s}) "
                      f"comp #{int(r['composite_rank_at_cohort']):>3d}  "
                      f"anlg #{int(r['analog_rank']):>3d}  "
                      f"realized {r['ret_pct']:+6.1f}%")


if __name__ == "__main__":
    main()
