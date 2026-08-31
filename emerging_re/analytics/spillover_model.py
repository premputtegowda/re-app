"""Spillover / adjacency predictor — Tier-1 metro momentum leaks into
adjacent Tier-2/3 markets over 6-18 months.

Different from composite (which uses per-county fundamentals) and analog
(which matches feature signatures). This model asks:
    "How much are nearby BIG metros growing? That growth will spill into
    this smaller market as workers get priced out / businesses expand."

For each county C:
    spillover_hpi_score  = weighted average of Tier-1 metro hpi_yoy,
                           weighted by exp(-distance / DECAY_MILES)
    spillover_zori_score = same for zori_yoy

Backtest determines whether combining spillover with composite adds value.

Run: `uv run python -m analytics.spillover_model [--backtest]`

Output when NOT --backtest: writes latest scores to
    data/curated/spillover/spillover_scores.parquet
Output when --backtest: prints quintile-spread comparison for 2020 cohort
    (leak-free: uses 2020 Tier-1 momentum to score 2020 counties, checks
    2020→2025 realized returns).
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

WAREHOUSE = Path(__file__).resolve().parent.parent / "data/warehouse/emerging_re.duckdb"
CENTROIDS_PATH = Path(__file__).resolve().parent.parent / "data/crosswalks/county_centroids_2020.tsv"
OUTPUT_DIR = Path(__file__).resolve().parent.parent / "data/curated/spillover"

# Configuration.
TIER1_MIN_POP = 500_000        # metros with pop >= 500K are the spillover source
DECAY_MILES = 50.0             # characteristic distance for exp decay
MAX_DISTANCE_MILES = 250.0     # cap: don't count metros farther than this
BACKTEST_COHORT = date(2020, 12, 31)


def load_centroids() -> pd.DataFrame:
    if not CENTROIDS_PATH.exists():
        raise RuntimeError(f"Centroids file missing: {CENTROIDS_PATH}")
    df = pd.read_csv(CENTROIDS_PATH, sep="\t", dtype={"GEOID": str})
    df.columns = [c.strip() for c in df.columns]
    return df.rename(columns={
        "GEOID": "fips",
        "INTPTLAT": "lat",
        "INTPTLONG": "lon",
    })[["fips", "lat", "lon"]]


def load_features_at(con: duckdb.DuckDBPyConnection, cohort_date: date) -> pd.DataFrame:
    """All counties + momentum features + realized 5yr returns at cohort_date."""
    q = f"""
      select
        f.fips, f.county_name, f.state_name, f.pop_latest,
        f.hpi_yoy, f.zori_yoy,
        s.hpi_forward_return_60mo,
        s.zori_forward_return_60mo,
        s.composite_rank as composite_rank_at_cohort,
        s.hpi_composite_rank as hpi_rank_at_cohort,
        s.zori_composite_rank as zori_rank_at_cohort
      from main_marts.mart_county_features f
      left join main_marts.mart_backtest_scores s
        on s.fips = f.fips and s.period_end_date = f.period_end_date
      where f.period_end_date = date '{cohort_date}'
    """
    return con.execute(q).fetchdf()


def haversine_matrix(coords_a: np.ndarray, coords_b: np.ndarray) -> np.ndarray:
    """Return (n_a, n_b) matrix of distances in MILES using haversine formula.
    coords: (n, 2) arrays of (lat, lon) in degrees."""
    R_MILES = 3958.756  # earth radius miles
    lat_a = np.radians(coords_a[:, 0])[:, None]
    lon_a = np.radians(coords_a[:, 1])[:, None]
    lat_b = np.radians(coords_b[:, 0])[None, :]
    lon_b = np.radians(coords_b[:, 1])[None, :]
    dlat = lat_b - lat_a
    dlon = lon_b - lon_a
    a = np.sin(dlat / 2) ** 2 + np.cos(lat_a) * np.cos(lat_b) * np.sin(dlon / 2) ** 2
    c = 2 * np.arcsin(np.clip(np.sqrt(a), 0, 1))
    return R_MILES * c


def compute_spillover(cohort: pd.DataFrame, centroids: pd.DataFrame) -> pd.DataFrame:
    """For each county in cohort, compute distance-weighted average of
    Tier-1 metro momentum. Returns cohort DataFrame with new columns:
        spillover_hpi_score, spillover_zori_score,
        nearest_tier1_metro, nearest_tier1_distance_mi.
    """
    coh = cohort.merge(centroids, on="fips", how="left").copy()
    n_missing = coh["lat"].isna().sum()
    if n_missing:
        logger.warning("%d counties missing centroids (skipping)", n_missing)
        coh = coh.dropna(subset=["lat", "lon"])

    # Tier-1 pool: pop >= TIER1_MIN_POP AND has momentum data.
    tier1 = coh[
        (coh["pop_latest"] >= TIER1_MIN_POP)
        & coh["hpi_yoy"].notna()
        & coh["zori_yoy"].notna()
    ].reset_index(drop=True)
    logger.info("Tier-1 pool: %d metros (pop >= %s)", len(tier1), TIER1_MIN_POP)

    all_coords = coh[["lat", "lon"]].to_numpy(dtype=float)
    t1_coords = tier1[["lat", "lon"]].to_numpy(dtype=float)

    # Distance matrix: (n_counties, n_tier1) in miles.
    D = haversine_matrix(all_coords, t1_coords)

    # Mask same-county pairs + distances > MAX_DISTANCE_MILES.
    coh_fips = coh["fips"].to_numpy()
    t1_fips = tier1["fips"].to_numpy()
    same_mask = coh_fips[:, None] == t1_fips[None, :]
    D_effective = np.where(same_mask | (D > MAX_DISTANCE_MILES), np.inf, D)

    # Distance-decay weights.
    W = np.exp(-D_effective / DECAY_MILES)
    W_sum = W.sum(axis=1, keepdims=True)

    hpi_yoy_t1 = tier1["hpi_yoy"].to_numpy(dtype=float)
    zori_yoy_t1 = tier1["zori_yoy"].to_numpy(dtype=float)

    coh["spillover_hpi_score"] = (W @ hpi_yoy_t1) / np.where(W_sum.flatten() > 0, W_sum.flatten(), np.nan)
    coh["spillover_zori_score"] = (W @ zori_yoy_t1) / np.where(W_sum.flatten() > 0, W_sum.flatten(), np.nan)

    # Nearest tier-1 metro info for interpretability.
    nearest_idx = np.argmin(D_effective, axis=1)
    coh["nearest_tier1_distance_mi"] = np.round(D_effective[np.arange(len(coh)), nearest_idx], 1)
    coh["nearest_tier1_metro"] = tier1.iloc[nearest_idx]["county_name"].values + ", " + tier1.iloc[nearest_idx]["state_name"].values
    coh.loc[coh["nearest_tier1_distance_mi"] == np.inf, "nearest_tier1_metro"] = None

    coh["spillover_hpi_rank"] = coh["spillover_hpi_score"].rank(ascending=False, method="min").astype("Int64")
    coh["spillover_zori_rank"] = coh["spillover_zori_score"].rank(ascending=False, method="min").astype("Int64")

    return coh


def evaluate_strategy(df: pd.DataFrame, rank_col: str, ret_col: str, label: str) -> dict:
    valid = df.dropna(subset=[rank_col, ret_col]).copy()
    if len(valid) == 0:
        return {"strategy": label, "n": 0}
    valid["q"] = pd.qcut(valid[rank_col], 5, labels=[1, 2, 3, 4, 5])
    means = valid.groupby("q", observed=True)[ret_col].mean() * 100
    return {
        "strategy": label,
        "n": len(valid),
        "Q1_pct": round(float(means.get(1, np.nan)), 2),
        "Q2_pct": round(float(means.get(2, np.nan)), 2),
        "Q3_pct": round(float(means.get(3, np.nan)), 2),
        "Q4_pct": round(float(means.get(4, np.nan)), 2),
        "Q5_pct": round(float(means.get(5, np.nan)), 2),
        "Q1_minus_Q5": round(float(means.get(1, np.nan) - means.get(5, np.nan)), 2),
    }


def run_backtest(con: duckdb.DuckDBPyConnection) -> None:
    logger.info("Loading %s cohort", BACKTEST_COHORT)
    cohort = load_features_at(con, BACKTEST_COHORT)
    centroids = load_centroids()
    scored = compute_spillover(cohort, centroids)

    # Combined rank: sum of composite + spillover ranks (lower = better).
    for suffix, hpi_or_zori in [("hpi", "hpi"), ("zori", "zori")]:
        comp_rank = scored[f"{suffix}_rank_at_cohort"] if f"{suffix}_rank_at_cohort" in scored.columns else scored["composite_rank_at_cohort"]
        spill_rank = scored[f"spillover_{hpi_or_zori}_rank"]
        scored[f"combined_{hpi_or_zori}_rank_sum"] = comp_rank.fillna(len(scored) + 1) + spill_rank.fillna(len(scored) + 1)
        scored[f"combined_{hpi_or_zori}_rank"] = scored[f"combined_{hpi_or_zori}_rank_sum"].rank(ascending=True, method="min").astype("Int64")

    print("\n" + "=" * 90)
    print(f"SPILLOVER BACKTEST — cohort {BACKTEST_COHORT}, target 2020→2025 realized returns")
    print(f"Tier-1 pool: pop >= {TIER1_MIN_POP:,};  decay = {DECAY_MILES}mi;  max = {MAX_DISTANCE_MILES}mi")
    print("=" * 90)

    for target, label in [("hpi_forward_return_60mo", "HPI 5-year"), ("zori_forward_return_60mo", "ZORI 5-year")]:
        print(f"\n\n── Target: {label} ──\n")
        rank_hpi_or_zori = "hpi" if "hpi" in target else "zori"
        results = [
            evaluate_strategy(scored, f"{rank_hpi_or_zori}_rank_at_cohort", target, f"{rank_hpi_or_zori.upper()}-composite only"),
            evaluate_strategy(scored, f"spillover_{rank_hpi_or_zori}_rank", target, "Spillover only"),
            evaluate_strategy(scored, f"combined_{rank_hpi_or_zori}_rank", target, "Combined (rank sum)"),
        ]
        print(pd.DataFrame(results).to_string(index=False))

    # Show top 10 by spillover score alone (interpretability)
    print("\n\n── Top 10 counties by HPI spillover score (2020) — expected to benefit from nearby Tier-1 momentum ──\n")
    top = scored.dropna(subset=["spillover_hpi_score"]).nlargest(10, "spillover_hpi_score")[[
        "county_name", "state_name", "pop_latest", "spillover_hpi_score",
        "nearest_tier1_metro", "nearest_tier1_distance_mi",
        "hpi_forward_return_60mo",
    ]].copy()
    top["spillover_hpi_score"] = (top["spillover_hpi_score"] * 100).round(2)
    top["realized_5y_hpi_pct"] = (top["hpi_forward_return_60mo"] * 100).round(1)
    top = top.drop(columns=["hpi_forward_return_60mo"])
    print(top.to_string(index=False))


def run_current(con: duckdb.DuckDBPyConnection) -> None:
    latest = con.execute("select max(period_end_date) from main_marts.mart_county_features").fetchone()[0]
    logger.info("Computing spillover for latest period: %s", latest)
    cohort = load_features_at(con, latest)
    centroids = load_centroids()
    scored = compute_spillover(cohort, centroids)

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    out = OUTPUT_DIR / "spillover_scores.parquet"
    keep = [
        "fips", "county_name", "state_name", "pop_latest",
        "spillover_hpi_score", "spillover_zori_score",
        "spillover_hpi_rank", "spillover_zori_rank",
        "nearest_tier1_metro", "nearest_tier1_distance_mi",
    ]
    scored[keep].to_parquet(out, index=False)
    logger.info("Wrote %d rows to %s", len(scored), out)


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(name)s %(levelname)s: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
    parser = argparse.ArgumentParser(description="Spillover / adjacency model")
    parser.add_argument("--backtest", action="store_true",
                        help="Run leak-free 2020-cohort backtest vs composite")
    args = parser.parse_args()

    con = duckdb.connect(str(WAREHOUSE), read_only=True)
    if args.backtest:
        run_backtest(con)
    else:
        run_current(con)


if __name__ == "__main__":
    main()
