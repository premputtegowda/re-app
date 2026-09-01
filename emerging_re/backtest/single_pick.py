"""Single-pick track record — the honest metric for capital-intensive RE.

For each cohort year, take the composite's #1 pick and report:
  - What we picked
  - Its realized 36mo ZORI return
  - Where that return lands in the universe distribution (percentile)
  - Universe mean/median/top for comparison
  - The county we should have picked (universe #1 by realized return)

This is the metric that matters when investors pick ONE market, not a
diversified basket. Cross-sectional Spearman and Q1-Q5 spread reward
correct ranking on average — they can look good even when the #1 pick
is a coin flip.

Run: `uv run python -m backtest.single_pick`
"""

from __future__ import annotations

from pathlib import Path

import duckdb
import pandas as pd

from ._scoring import ZORI_MAX_FEATURES
from .oof_backtest import score_with_features

WAREHOUSE_PATH = Path("data/warehouse/emerging_re.duckdb")
SNAPSHOT_YEARS = range(2015, 2023)  # need 36mo forward returns


def load_snapshots() -> pd.DataFrame:
    con = duckdb.connect(str(WAREHOUSE_PATH), read_only=True)
    df = con.execute("""
        SELECT * FROM main_marts.mart_county_features
        WHERE EXTRACT(MONTH FROM period_end_date) = 12
          AND EXTRACT(YEAR FROM period_end_date) BETWEEN 2015 AND 2022
    """).df()
    df["period_end_date"] = pd.to_datetime(df["period_end_date"])
    return df


def main() -> None:
    df = load_snapshots()
    scored = score_with_features(df, ZORI_MAX_FEATURES, score_col="zori_score")

    print("=" * 108)
    print("SINGLE-PICK TRACK RECORD — #1 ZORI PICK PER YEAR vs UNIVERSE (36mo forward)")
    print("=" * 108)

    summary_rows = []
    for year in SNAPSHOT_YEARS:
        snap = scored[scored["period_end_date"] == pd.Timestamp(f"{year}-12-31")]
        picked = snap.dropna(subset=["zori_score"]).nlargest(1, "zori_score").iloc[0]
        universe_with_returns = snap.dropna(subset=["zori_forward_return_36mo"])
        if universe_with_returns.empty:
            continue

        picked_return = picked["zori_forward_return_36mo"]
        # Percentile: what fraction of universe DID WE BEAT? Higher is better.
        # 1.0 = we beat 100% of universe (perfect); 0.5 = median; 0.0 = worst.
        if pd.notna(picked_return):
            percentile = (universe_with_returns["zori_forward_return_36mo"] < picked_return).mean()
        else:
            percentile = float("nan")

        uni_mean = universe_with_returns["zori_forward_return_36mo"].mean()
        uni_median = universe_with_returns["zori_forward_return_36mo"].median()
        uni_p75 = universe_with_returns["zori_forward_return_36mo"].quantile(0.75)
        uni_p90 = universe_with_returns["zori_forward_return_36mo"].quantile(0.90)
        uni_max = universe_with_returns["zori_forward_return_36mo"].max()

        # Universe #1 (what we should have picked in hindsight).
        should_have = universe_with_returns.nlargest(1, "zori_forward_return_36mo").iloc[0]

        picked_pop_str = f"pop={int(picked['pop_latest']):,}" if pd.notna(picked['pop_latest']) else "pop=?"

        print(f"\n----- COHORT {year}-12  (n={len(universe_with_returns)}) -----")
        print(f"  UNIVERSE          mean={uni_mean*100:+6.2f}%  median={uni_median*100:+6.2f}%  "
              f"p75={uni_p75*100:+6.2f}%  p90={uni_p90*100:+6.2f}%  max={uni_max*100:+6.2f}%")
        picked_return_str = f"{picked_return*100:+6.2f}%" if pd.notna(picked_return) else "     NA"
        percentile_str = f"{percentile*100:5.1f}%" if pd.notna(percentile) else "  NA "
        print(f"  OUR #1 PICK       {picked['county_name']}, {picked['state_name']} "
              f"({picked_pop_str}, score={picked['zori_score']:.2f})")
        print(f"                    return_36mo={picked_return_str}   "
              f"percentile={percentile_str}   "
              f"beat_universe_mean={('YES' if pd.notna(picked_return) and picked_return > uni_mean else 'no')}")
        print(f"  HINDSIGHT WINNER  {should_have['county_name']}, {should_have['state_name']}  "
              f"return_36mo={should_have['zori_forward_return_36mo']*100:+6.2f}%")

        summary_rows.append({
            "cohort": year,
            "pick": f"{picked['county_name']}, {picked['state_name']}",
            "pick_return_pct": picked_return * 100 if pd.notna(picked_return) else None,
            "percentile": percentile * 100 if pd.notna(percentile) else None,
            "universe_mean_pct": uni_mean * 100,
            "universe_max_pct": uni_max * 100,
            "beat_mean": pd.notna(picked_return) and picked_return > uni_mean,
        })

    # Summary line.
    print("\n" + "=" * 108)
    print("SUMMARY — SINGLE PICK PERFORMANCE")
    print("=" * 108)
    summary = pd.DataFrame(summary_rows)
    summary_display = summary.copy()
    for c in ["pick_return_pct", "percentile", "universe_mean_pct", "universe_max_pct"]:
        summary_display[c] = summary_display[c].round(2)
    print(summary_display.to_string(index=False))

    measurable = summary.dropna(subset=["pick_return_pct"])
    hit_rate = measurable["beat_mean"].mean() if len(measurable) else float("nan")
    avg_percentile = measurable["percentile"].mean() if len(measurable) else float("nan")
    n_top_decile = ((measurable["percentile"] >= 90) if len(measurable) else pd.Series([])).sum()
    n_below_median = ((measurable["percentile"] < 50) if len(measurable) else pd.Series([])).sum()
    print(f"\n  Cohorts measured:            {len(measurable)}")
    print(f"  Hit rate (beat universe mean): {hit_rate*100:.1f}%")
    print(f"  Avg percentile of #1 pick:     {avg_percentile:.1f}%  (50 = median, 100 = perfect)")
    print(f"  Cohorts in TOP DECILE (p90+):  {n_top_decile} of {len(measurable)}")
    print(f"  Cohorts BELOW MEDIAN:          {n_below_median} of {len(measurable)}")


if __name__ == "__main__":
    main()
