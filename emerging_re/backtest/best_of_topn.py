"""Best-of-top-N sweep — how does coverage scale with candidate list size?

For each cohort year and each N in {3, 5, 10, 20}, report the best realized
36mo ZORI return achievable from the composite's top-N candidates. This
tells us how large a candidate list the composite needs to reliably
contain a top-quartile winner.

Run: `uv run python -m backtest.best_of_topn`
"""

from __future__ import annotations

from pathlib import Path

import duckdb
import pandas as pd

from ._scoring import ZORI_MAX_FEATURES
from .oof_backtest import score_with_features

WAREHOUSE_PATH = Path("data/warehouse/emerging_re.duckdb")
SNAPSHOT_YEARS = range(2015, 2023)
N_SIZES = (1, 3, 5, 10, 20)


def load_snapshots() -> pd.DataFrame:
    con = duckdb.connect(str(WAREHOUSE_PATH), read_only=True)
    df = con.execute("""
        SELECT * FROM main_marts.mart_county_features
        WHERE EXTRACT(MONTH FROM period_end_date) = 12
          AND EXTRACT(YEAR FROM period_end_date) BETWEEN 2015 AND 2022
    """).df()
    df["period_end_date"] = pd.to_datetime(df["period_end_date"])
    return df


def percentile_of(value: float, series: pd.Series) -> float:
    if pd.isna(value):
        return float("nan")
    return (series < value).mean() * 100


def main() -> None:
    df = load_snapshots()
    scored = score_with_features(df, ZORI_MAX_FEATURES, score_col="zori_score")

    rows = []
    per_cohort_display = []
    for year in SNAPSHOT_YEARS:
        snap = scored[scored["period_end_date"] == pd.Timestamp(f"{year}-12-31")]
        ranked = snap.dropna(subset=["zori_score"]).sort_values("zori_score", ascending=False)
        uni_returns = snap.dropna(subset=["zori_forward_return_36mo"])["zori_forward_return_36mo"]
        if uni_returns.empty:
            continue
        uni_mean = uni_returns.mean()
        row = {"cohort": year, "universe_mean_pct": uni_mean * 100}
        for n in N_SIZES:
            topn = ranked.head(n)
            best_ret = topn["zori_forward_return_36mo"].max()
            best_pct = percentile_of(best_ret, uni_returns)
            best_beat = pd.notna(best_ret) and best_ret > uni_mean
            row[f"n{n}_best_ret_pct"] = best_ret * 100 if pd.notna(best_ret) else None
            row[f"n{n}_best_percentile"] = best_pct
            row[f"n{n}_beat_mean"] = bool(best_beat) if pd.notna(best_ret) else None
            # Also record which pick was best.
            if pd.notna(best_ret):
                best_idx = topn["zori_forward_return_36mo"].idxmax()
                row[f"n{n}_best_rank"] = topn.index.get_loc(best_idx) + 1
                row[f"n{n}_best_name"] = f"{topn.loc[best_idx, 'county_name']}, {topn.loc[best_idx, 'state_name']}"
            else:
                row[f"n{n}_best_rank"] = None
                row[f"n{n}_best_name"] = None
        rows.append(row)

    df_summary = pd.DataFrame(rows)

    # Per-cohort table: which pick was best at each N, and its return + percentile.
    print("=" * 120)
    print("BEST-OF-TOP-N — WHICH PICK WON AND AT WHAT PERCENTILE")
    print("=" * 120)
    for _, r in df_summary.iterrows():
        print(f"\n  COHORT {int(r['cohort'])}-12   (universe mean {r['universe_mean_pct']:+.2f}%)")
        for n in N_SIZES:
            name = r[f"n{n}_best_name"]
            ret = r[f"n{n}_best_ret_pct"]
            pct = r[f"n{n}_best_percentile"]
            rank = r[f"n{n}_best_rank"]
            if pd.isna(rank) or name is None or (isinstance(name, float) and pd.isna(name)):
                continue
            print(f"    N={n:2d}  best_of_top_N = rank #{int(rank):2d}  "
                  f"{name:<40}  return={ret:+6.2f}%  percentile=p{pct:5.1f}")

    # Strategy comparison summary.
    print("\n" + "=" * 120)
    print("STRATEGY COMPARISON — 'Best of top N' across 7 measurable cohorts (2016-2022)")
    print("=" * 120)
    print(f"{'N':>4} | {'hit_rate':>10} | {'avg_pct':>10} | {'avg_ret':>10} | "
          f"{'top_decile':>12} | {'above_p75':>11} | {'below_median':>13} | {'disasters (<p10)':>18}")
    print("-" * 120)
    for n in N_SIZES:
        beat = df_summary[f"n{n}_beat_mean"].dropna()
        pct = df_summary[f"n{n}_best_percentile"].dropna()
        ret = df_summary[f"n{n}_best_ret_pct"].dropna()
        hit_rate = beat.mean() * 100 if len(beat) else float("nan")
        avg_pct = pct.mean()
        avg_ret = ret.mean()
        top_decile = int((pct >= 90).sum())
        above_p75 = int((pct >= 75).sum())
        below_median = int((pct < 50).sum())
        disasters = int((pct < 10).sum())
        print(f"{n:>4} | {hit_rate:>9.0f}% | {avg_pct:>9.1f}p | {avg_ret:>+9.2f}% | "
              f"{top_decile:>4}/{len(beat)}      | {above_p75:>4}/{len(beat)}     | "
              f"{below_median:>5}/{len(beat)}       | {disasters:>5}/{len(beat)}")

    print("\n(hit_rate = beat universe mean, avg_pct = avg realized percentile, disasters = bottom decile)")


if __name__ == "__main__":
    main()
