"""Historical analog matcher — find markets today whose feature signature
matches past winners at their pre-boom moment.

Different lens from composite scoring:
    Composite = "which markets look best on framework's 20 features today"
    Analog   = "which markets today look like Boise did in 2015 (before it boomed)"

Approach:
    1. Identify past winners: markets in top decile of 5yr forward HPI + ZORI
       (both) starting from each historical vintage 2013-2019
    2. Extract each winner's FEATURE SNAPSHOT at winner_period (pre-boom)
    3. Compute cosine similarity: current-day markets × historical winners
    4. Rank current markets by average similarity to their top-K analogs
    5. Write output as parquet → dbt source → mart_analog_ranking

Key design choice: uses FEATURES that capture "coiled spring" pattern
(demand fundamentals building, price/rent momentum still moderate). Excludes
composite-optimized features like `mf_permit_ratio_ts` which are lagging.

Output written to: data/curated/analog_matches/analog_matches.parquet
    Columns: fips, county_name, state_name, analog_score, top_analog_market,
             top_analog_similarity, avg_top5_similarity

Run: `uv run python -m analytics.analog_matcher`
"""

from __future__ import annotations

import argparse
import logging
from datetime import date
from pathlib import Path

import duckdb
import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)

# Features for analog matching. Chosen to capture "pre-boom signature":
# strong demand fundamentals (migration, employment) + moderate momentum
# (before the boom shows up in prices). Excludes features already used
# heavily in composite (avoid double-counting the same signal).
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

WINNER_DECILE_MIN = 9  # top 20% on both HPI and ZORI 5yr forward
TOP_K_ANALOGS = 5      # avg similarity to nearest-K winners

WAREHOUSE = Path(__file__).resolve().parent.parent / "data/warehouse/emerging_re.duckdb"
OUTPUT_DIR = Path(__file__).resolve().parent.parent / "data/curated/analog_matches"


def load_winners(con: duckdb.DuckDBPyConnection) -> pd.DataFrame:
    """Historical winners: top decile 5yr forward HPI AND ZORI."""
    q = f"""
      with forward as (
        select
          fips, county_name, state_name, period_end_date,
          hpi_forward_return_60mo,
          zori_forward_return_60mo,
          ntile(10) over (partition by period_end_date order by hpi_forward_return_60mo) as hpi_dec,
          ntile(10) over (partition by period_end_date order by zori_forward_return_60mo) as zori_dec
        from main_marts.mart_backtest_scores
        where hpi_forward_return_60mo is not null
          and zori_forward_return_60mo is not null
      )
      select
        fips, county_name, state_name,
        period_end_date as winner_period,
        hpi_forward_return_60mo as fwd_hpi_5y,
        zori_forward_return_60mo as fwd_zori_5y
      from forward
      where hpi_dec >= {WINNER_DECILE_MIN} and zori_dec >= {WINNER_DECILE_MIN}
        and period_end_date >= date '2013-01-01'
        and period_end_date <= date '2020-12-31'
      order by period_end_date, fips
    """
    df = con.execute(q).fetchdf()
    logger.info("Found %d historical winners across %d vintages",
                len(df), df["winner_period"].nunique())
    return df


def load_winner_features(con: duckdb.DuckDBPyConnection, winners: pd.DataFrame) -> pd.DataFrame:
    """Feature vectors at each winner's pre-boom snapshot."""
    cols = ", ".join(ANALOG_FEATURES)
    # Build a VALUES clause for the join keys.
    pairs = ", ".join(
        f"('{r.fips}', date '{r.winner_period.strftime('%Y-%m-%d')}')"
        for r in winners.itertuples()
    )
    q = f"""
      with keys(fips, period_end_date) as (values {pairs})
      select f.fips, f.period_end_date, {cols}
      from main_marts.mart_county_features f
      inner join keys k
        on k.fips = f.fips and k.period_end_date = f.period_end_date
    """
    return con.execute(q).fetchdf()


def load_current_features(con: duckdb.DuckDBPyConnection) -> pd.DataFrame:
    """Latest-period features for all counties in the universe."""
    cols = ", ".join(ANALOG_FEATURES)
    q = f"""
      select
        fips, county_name, state_name, pop_latest, {cols}
      from main_marts.mart_county_features
      where period_end_date = (
        select max(period_end_date) from main_marts.mart_county_features
      )
    """
    return con.execute(q).fetchdf()


def _zscore_matrix(df: pd.DataFrame, feature_cols: list[str], mus: dict, sds: dict) -> np.ndarray:
    """Z-score features using PROVIDED means/stds (so current + historical
    live in the same feature space). Median-impute NaNs with 0 after z-score
    (0 = at the population mean, neutral)."""
    Z = df[feature_cols].copy()
    for c in feature_cols:
        Z[c] = (Z[c] - mus[c]) / sds[c] if sds[c] else 0.0
    return np.nan_to_num(Z.to_numpy(dtype=float), nan=0.0)


def cosine_similarity(A: np.ndarray, B: np.ndarray) -> np.ndarray:
    """Return (n_A × n_B) cosine similarity matrix."""
    A_norm = A / np.clip(np.linalg.norm(A, axis=1, keepdims=True), 1e-9, None)
    B_norm = B / np.clip(np.linalg.norm(B, axis=1, keepdims=True), 1e-9, None)
    return A_norm @ B_norm.T


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(name)s %(levelname)s: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
    parser = argparse.ArgumentParser(description="Historical analog matcher")
    parser.add_argument("--top-k", type=int, default=TOP_K_ANALOGS)
    args = parser.parse_args()

    con = duckdb.connect(str(WAREHOUSE), read_only=True)

    winners = load_winners(con)
    winner_feats = load_winner_features(con, winners)
    winners_full = winners.merge(winner_feats, left_on=["fips", "winner_period"],
                                 right_on=["fips", "period_end_date"], how="inner")
    logger.info("Winners with feature snapshots: %d", len(winners_full))

    current = load_current_features(con)
    logger.info("Current-day markets: %d (as of %s)", len(current),
                con.execute("select max(period_end_date) from main_marts.mart_county_features").fetchone()[0])

    # Pool feature values across BOTH sets so z-scoring uses a shared scale.
    pooled = pd.concat([winners_full[ANALOG_FEATURES], current[ANALOG_FEATURES]], ignore_index=True)
    mus = {c: pooled[c].mean(skipna=True) for c in ANALOG_FEATURES}
    sds = {c: pooled[c].std(ddof=0, skipna=True) for c in ANALOG_FEATURES}

    W_z = _zscore_matrix(winners_full, ANALOG_FEATURES, mus, sds)
    C_z = _zscore_matrix(current, ANALOG_FEATURES, mus, sds)

    logger.info("Computing similarity matrix (%d current × %d winners)", len(C_z), len(W_z))
    sim = cosine_similarity(C_z, W_z)  # (n_current, n_winners)

    # For each current market: score = mean of top-K similarities.
    top_k = min(args.top_k, sim.shape[1])
    top_k_idx = np.argsort(-sim, axis=1)[:, :top_k]
    top_k_sim = np.take_along_axis(sim, top_k_idx, axis=1)
    avg_top_k = top_k_sim.mean(axis=1)
    best_idx = top_k_idx[:, 0]
    best_sim = top_k_sim[:, 0]

    result = current[["fips", "county_name", "state_name", "pop_latest"]].copy()
    result["analog_score"] = avg_top_k
    result[f"top_{top_k}_avg_similarity"] = avg_top_k
    result["best_analog_similarity"] = best_sim
    result["best_analog_fips"] = winners_full.iloc[best_idx]["fips"].values
    result["best_analog_market"] = (
        winners_full.iloc[best_idx]["county_name"].values
        + " (" + winners_full.iloc[best_idx]["state_name"].values + ", "
        + winners_full.iloc[best_idx]["winner_period"].astype(str).values.astype(str) + ")"
    )
    result["best_analog_fwd_hpi_5y"] = winners_full.iloc[best_idx]["fwd_hpi_5y"].values
    result["best_analog_fwd_zori_5y"] = winners_full.iloc[best_idx]["fwd_zori_5y"].values

    # Rank current markets by analog score.
    result = result.sort_values("analog_score", ascending=False)
    result["analog_rank"] = range(1, len(result) + 1)

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUTPUT_DIR / "analog_matches.parquet"
    result.to_parquet(out_path, index=False)
    logger.info("Wrote %d rows to %s", len(result), out_path)

    # Print top 20.
    print("\n═══ Top 20 markets by analog score ═══\n")
    show = result.head(20)[[
        "analog_rank", "county_name", "state_name", "pop_latest",
        "analog_score", "best_analog_market",
        "best_analog_fwd_hpi_5y", "best_analog_fwd_zori_5y",
    ]].copy()
    show["analog_score"] = show["analog_score"].round(3)
    show["best_analog_fwd_hpi_5y"] = (show["best_analog_fwd_hpi_5y"] * 100).round(1)
    show["best_analog_fwd_zori_5y"] = (show["best_analog_fwd_zori_5y"] * 100).round(1)
    print(show.to_string(index=False))


if __name__ == "__main__":
    main()
