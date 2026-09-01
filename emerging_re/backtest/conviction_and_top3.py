"""Conviction filter + top-3 analysis for single-pick investing.

For each cohort year:
  - Show the top 3 picks + realized 36mo ZORI returns
  - Compute conviction metrics for the #1 pick:
      * margin_1v2 — score gap to #2 (large = high conviction)
      * z_vs_universe — (score - universe median) / universe std
      * feature_agreement — count of z_<feature> > 1.0 among the 4 features
  - Backtest two strategies:
      A. "Always #1" — the baseline (43% hit rate, p46 avg)
      B. "Best of top 3" — pick whichever of top 3 returns highest
      C. "Conviction-gated" — only invest if margin >= X AND agreement >= N,
         else abstain (score as "no pick"). Reports hit rate on qualifying
         cohorts only + coverage (fraction of years we invested).

Run: `uv run python -m backtest.conviction_and_top3`
"""

from __future__ import annotations

from pathlib import Path

import duckdb
import pandas as pd

from ._scoring import ZORI_MAX_FEATURES
from .oof_backtest import score_with_features

WAREHOUSE_PATH = Path("data/warehouse/emerging_re.duckdb")
SNAPSHOT_YEARS = range(2015, 2023)


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

    z_cols = [f"z_{f.column}" for f in ZORI_MAX_FEATURES]

    per_cohort_rows = []

    print("=" * 110)
    print("CONVICTION + TOP-3 ANALYSIS — SINGLE PICK VIEW")
    print(f"Features: {[f.column for f in ZORI_MAX_FEATURES]}")
    print("=" * 110)

    for year in SNAPSHOT_YEARS:
        snap = scored[scored["period_end_date"] == pd.Timestamp(f"{year}-12-31")]
        ranked = snap.dropna(subset=["zori_score"]).sort_values("zori_score", ascending=False)
        if len(ranked) < 3:
            continue

        top3 = ranked.head(3).reset_index(drop=True)
        universe_returns = snap.dropna(subset=["zori_forward_return_36mo"])
        uni_return_series = universe_returns["zori_forward_return_36mo"]

        # Conviction metrics on #1.
        s1 = top3.loc[0, "zori_score"]
        s2 = top3.loc[1, "zori_score"]
        margin_1v2 = s1 - s2
        uni_median_score = ranked["zori_score"].median()
        uni_std_score = ranked["zori_score"].std()
        z_vs_universe = (s1 - uni_median_score) / uni_std_score if uni_std_score else float("nan")

        top1_z = top3.loc[0, z_cols].astype(float)
        agreement_1sigma = int((top1_z > 1.0).sum())
        agreement_05sigma = int((top1_z > 0.5).sum())

        # Realized returns.
        top1_return = top3.loc[0, "zori_forward_return_36mo"]
        top1_pct = percentile_of(top1_return, uni_return_series)

        top3_returns = top3["zori_forward_return_36mo"]
        best_of_3_idx = top3_returns.idxmax() if top3_returns.notna().any() else None
        best_of_3_return = top3_returns.max() if top3_returns.notna().any() else float("nan")
        best_of_3_pct = percentile_of(best_of_3_return, uni_return_series)

        uni_mean = uni_return_series.mean()

        # Print per-cohort block.
        print(f"\n----- COHORT {year}-12 -----")
        print(f"  universe: n={len(universe_returns)}  mean={uni_mean*100:+.2f}%  "
              f"median={uni_return_series.median()*100:+.2f}%  max={uni_return_series.max()*100:+.2f}%")
        print(f"  TOP 3:")
        for i in range(3):
            r = top3.loc[i, "zori_forward_return_36mo"]
            r_str = f"{r*100:+7.2f}%" if pd.notna(r) else "     NA"
            pct = percentile_of(r, uni_return_series)
            pct_str = f"p{pct:4.1f}" if pd.notna(pct) else "  --"
            z_str = " ".join(f"{top3.loc[i, c]:+.2f}" for c in z_cols)
            print(f"    #{i+1}  {top3.loc[i, 'county_name']:<25} {top3.loc[i, 'state_name']:<16} "
                  f"score={top3.loc[i, 'zori_score']:.2f}  ret={r_str}  {pct_str}   z=[{z_str}]")
        print(f"  CONVICTION #1: margin_1v2={margin_1v2:+.3f}  z_vs_universe={z_vs_universe:+.2f}  "
              f"agreement_>1σ={agreement_1sigma}/4  agreement_>0.5σ={agreement_05sigma}/4")
        best_note = f"  (#{best_of_3_idx+1})" if best_of_3_idx is not None else ""
        print(f"  BEST OF TOP 3: return={best_of_3_return*100:+.2f}%  percentile=p{best_of_3_pct:.1f}"
              f"  vs #1_only_ret={top1_return*100 if pd.notna(top1_return) else float('nan'):+.2f}%{best_note}")

        per_cohort_rows.append({
            "cohort": year,
            "top1_county": f"{top3.loc[0, 'county_name']}, {top3.loc[0, 'state_name']}",
            "top1_return_pct": top1_return * 100 if pd.notna(top1_return) else None,
            "top1_percentile": top1_pct,
            "top1_beat_mean": (top1_return > uni_mean) if pd.notna(top1_return) else None,
            "best_of_3_return_pct": best_of_3_return * 100 if pd.notna(best_of_3_return) else None,
            "best_of_3_percentile": best_of_3_pct,
            "best_of_3_beat_mean": (best_of_3_return > uni_mean) if pd.notna(best_of_3_return) else None,
            "margin_1v2": margin_1v2,
            "z_vs_universe": z_vs_universe,
            "agreement_1sigma": agreement_1sigma,
            "agreement_05sigma": agreement_05sigma,
        })

    summary = pd.DataFrame(per_cohort_rows)
    measurable = summary.dropna(subset=["top1_return_pct"])

    print("\n" + "=" * 110)
    print("STRATEGY COMPARISON — full 2015-2022 window (7 measurable cohorts)")
    print("=" * 110)

    def stats(sub: pd.DataFrame, ret_col: str, beat_col: str, pct_col: str, label: str, coverage_denom: int) -> None:
        n = len(sub)
        if n == 0:
            print(f"  {label:<40} n=0  (no qualifying cohorts)")
            return
        hit = sub[beat_col].mean() * 100
        avg_pct = sub[pct_col].mean()
        avg_ret = sub[ret_col].mean()
        top_decile = (sub[pct_col] >= 90).sum()
        below_median = (sub[pct_col] < 50).sum()
        coverage = n / coverage_denom * 100
        print(f"  {label:<40} n={n}/{coverage_denom} ({coverage:.0f}% coverage)  "
              f"hit_rate={hit:.0f}%  avg_pct=p{avg_pct:.0f}  avg_ret={avg_ret:+.1f}%  "
              f"top_decile={top_decile}  below_median={below_median}")

    print("\n  BASELINE STRATEGIES")
    stats(measurable, "top1_return_pct", "top1_beat_mean", "top1_percentile",
          "A. Always #1 pick", len(measurable))
    stats(measurable, "best_of_3_return_pct", "best_of_3_beat_mean", "best_of_3_percentile",
          "B. Best of top 3 (hindsight)", len(measurable))

    print("\n  CONVICTION-GATED (only invest when both conditions met, else ABSTAIN)")

    # Test a few threshold pairs.
    for margin_th, agree_th in [
        (0.05, 2), (0.10, 2), (0.10, 3), (0.15, 3), (0.20, 3), (0.15, 4),
    ]:
        qualify = measurable[
            (measurable["margin_1v2"] >= margin_th)
            & (measurable["agreement_1sigma"] >= agree_th)
        ]
        label = f"C. margin>={margin_th:.2f} & agree_>1σ>={agree_th}/4"
        stats(qualify, "top1_return_pct", "top1_beat_mean", "top1_percentile",
              label, len(measurable))

    # Show the conviction metrics side by side.
    print("\n" + "=" * 110)
    print("CONVICTION METRICS PER COHORT — WHAT DIFFERENTIATES WINS FROM LOSSES?")
    print("=" * 110)
    disp = summary[[
        "cohort", "top1_county", "top1_percentile",
        "margin_1v2", "z_vs_universe",
        "agreement_1sigma", "agreement_05sigma",
    ]].copy()
    disp["top1_percentile"] = disp["top1_percentile"].round(1)
    disp["margin_1v2"] = disp["margin_1v2"].round(3)
    disp["z_vs_universe"] = disp["z_vs_universe"].round(2)
    print(disp.to_string(index=False))


if __name__ == "__main__":
    main()
