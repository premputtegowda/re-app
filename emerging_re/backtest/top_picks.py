"""Top-10 ZORI picks per cohort year + realized 36mo forward returns.

Uses the December snapshot per year (2015-12 through 2022-12) — one-shot
ranking per year, matching how an annual investment decision would work.
Scores with the pruned ZORI_MAX_FEATURES.

Run: `uv run python -m backtest.top_picks`
"""

from __future__ import annotations

import argparse
from pathlib import Path

import duckdb
import pandas as pd

from ._scoring import ZORI_MAX_FEATURES
from .oof_backtest import score_with_features

WAREHOUSE_PATH = Path("data/warehouse/emerging_re.duckdb")
SNAPSHOT_YEARS = range(2015, 2024)  # 2023-12 shown even if 36mo target NaN


def load_snapshots() -> pd.DataFrame:
    con = duckdb.connect(str(WAREHOUSE_PATH), read_only=True)
    df = con.execute("""
        SELECT * FROM main_marts.mart_county_features
        WHERE EXTRACT(MONTH FROM period_end_date) = 12
          AND EXTRACT(YEAR FROM period_end_date) BETWEEN 2015 AND 2023
    """).df()
    df["period_end_date"] = pd.to_datetime(df["period_end_date"])
    return df


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--top-n", type=int, default=10)
    parser.add_argument(
        "--pop-floor", type=int, default=0,
        help="Minimum population (0 = no filter, use full universe)",
    )
    args = parser.parse_args()

    df = load_snapshots()
    if args.pop_floor > 0:
        df = df[df["pop_latest"] >= args.pop_floor].copy()

    scored = score_with_features(df, ZORI_MAX_FEATURES, score_col="zori_score")

    print("=" * 90)
    print(f"TOP {args.top_n} ZORI PICKS — DECEMBER SNAPSHOT, WITH 36mo REALIZED RETURNS")
    print(f"Composite features: {[s.column for s in ZORI_MAX_FEATURES]}")
    if args.pop_floor:
        print(f"Population floor: {args.pop_floor:,}")
    print("=" * 90)

    for year in SNAPSHOT_YEARS:
        snap = scored[scored["period_end_date"] == pd.Timestamp(f"{year}-12-31")]
        if snap.empty:
            continue
        top = snap.dropna(subset=["zori_score"]).nlargest(args.top_n, "zori_score")

        universe_mean_36mo = snap["zori_forward_return_36mo"].mean()
        top_mean_36mo = top["zori_forward_return_36mo"].mean()

        print(f"\n----- COHORT {year}-12  (n_universe={len(snap)}, "
              f"universe_mean_36mo={universe_mean_36mo*100:+.2f}%, "
              f"top{args.top_n}_mean_36mo={top_mean_36mo*100:+.2f}%, "
              f"edge_vs_universe={(top_mean_36mo - universe_mean_36mo)*100:+.2f} pp) -----")

        display = top[[
            "fips", "county_name", "state_name", "pop_latest",
            "zori_score",
            "zori_forward_return_36mo",
            "target_zori_36mo_demeaned",
        ]].copy()
        display.insert(0, "rank", range(1, len(display) + 1))
        display["pop_latest"] = display["pop_latest"].astype("Int64")
        display["zori_score"] = display["zori_score"].round(3)
        display["zori_36mo_return_pct"] = (display["zori_forward_return_36mo"] * 100).round(2)
        display["alpha_vs_natl_pp"] = (display["target_zori_36mo_demeaned"] * 100).round(2)
        display = display.drop(columns=["zori_forward_return_36mo", "target_zori_36mo_demeaned"])
        print(display.to_string(index=False))


if __name__ == "__main__":
    main()
