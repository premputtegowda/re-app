"""Symmetry test: does the BOTTOM of the composite ranking predict
underperformance as reliably as the TOP predicts outperformance?

Also tests the disqualified subset separately (counties excluded from
scoring because any_disqualifier=true) — theoretically they should be
even worse than the bottom-of-ranking survivors.

Run: `uv run python scripts/test_bottom_ranking.py`
"""

from __future__ import annotations

import duckdb
import pandas as pd

DB = "data/warehouse/emerging_re.duckdb"
BOTTOM_N = 10


def main() -> None:
    con = duckdb.connect(DB, read_only=True)

    # Rows with realized targets. Composite is NULL for disqualified rows
    # (that's how the scoring function excludes them from ranking); we still
    # want to see how disqualified counties actually performed.
    scored = con.execute("""
        select
          fips, period_end_date, county_name, state_name, pop_latest,
          composite_score,
          hpi_forward_return_24mo, hpi_forward_return_36mo,
          any_disqualifier
        from main_marts.mart_backtest_scores
    """).df()

    for horizon_col, horizon_label in [
        ("hpi_forward_return_24mo", "24mo"),
        ("hpi_forward_return_36mo", "36mo"),
    ]:
        print("=" * 78)
        print(f"HORIZON = {horizon_label}")
        print("=" * 78)

        valid = scored[scored[horizon_col].notna()].copy()
        # Only score-eligible rows (not disqualified) can be ranked.
        eligible = valid[~valid["any_disqualifier"]].copy()

        # Bottom-N picks per period.
        bottom = (
            eligible.sort_values(["period_end_date", "composite_score"], ascending=[True, True])
            .groupby("period_end_date")
            .head(BOTTOM_N)
        )
        # Top-N for comparison.
        top = (
            eligible.sort_values(["period_end_date", "composite_score"], ascending=[True, False])
            .groupby("period_end_date")
            .head(BOTTOM_N)
        )

        # Aggregate per-period metrics.
        rows = []
        for period, g_all in valid.groupby("period_end_date"):
            g_bottom = bottom[bottom["period_end_date"] == period]
            g_top = top[top["period_end_date"] == period]
            g_disq = valid[
                (valid["period_end_date"] == period) & (valid["any_disqualifier"])
            ]
            median = g_all[horizon_col].median()
            universe_mean = g_all[g_all["any_disqualifier"] == False][horizon_col].mean()  # noqa: E712
            rows.append({
                "period": period,
                "median_realized_pct": median * 100,
                "universe_mean_pct": universe_mean * 100,
                "top10_mean_pct": g_top[horizon_col].mean() * 100 if not g_top.empty else None,
                "bottom10_mean_pct": g_bottom[horizon_col].mean() * 100 if not g_bottom.empty else None,
                "disqualified_mean_pct": g_disq[horizon_col].mean() * 100 if not g_disq.empty else None,
                "n_disq": len(g_disq),
                # Under-median rate: fraction of picks that fell BELOW median (higher = better avoid signal)
                "top10_under_median_rate": (g_top[horizon_col] < median).mean() if not g_top.empty else None,
                "bottom10_under_median_rate": (g_bottom[horizon_col] < median).mean() if not g_bottom.empty else None,
                "disq_under_median_rate": (g_disq[horizon_col] < median).mean() if not g_disq.empty else None,
                # Best pick in bottom-10 (was accidentally picking a low-composite county still ok?)
                "bottom10_best_pick_pct": g_bottom[horizon_col].max() * 100 if not g_bottom.empty else None,
                # Worst pick in bottom-10 (how bad does it get?)
                "bottom10_worst_pick_pct": g_bottom[horizon_col].min() * 100 if not g_bottom.empty else None,
            })
        per_period = pd.DataFrame(rows).set_index("period")

        print("\nPer-period aggregate (raw HPI return %, not demeaned):")
        display = per_period[[
            "top10_mean_pct", "universe_mean_pct", "bottom10_mean_pct", "disqualified_mean_pct",
        ]].round(2)
        print(display.to_string())
        print()
        print(f"--- Aggregate averages over all periods ({horizon_label}) ---")
        print(f"  Top-10 mean return:              {per_period['top10_mean_pct'].mean():+.2f}%")
        print(f"  Universe mean return:            {per_period['universe_mean_pct'].mean():+.2f}%")
        print(f"  Bottom-10 mean return:           {per_period['bottom10_mean_pct'].mean():+.2f}%")
        print(f"  Disqualified subset mean return: {per_period['disqualified_mean_pct'].mean():+.2f}%")
        print()
        print(f"  Top-10 EDGE over universe:       {per_period['top10_mean_pct'].mean() - per_period['universe_mean_pct'].mean():+.2f} pp")
        print(f"  Bottom-10 GAP below universe:    {per_period['bottom10_mean_pct'].mean() - per_period['universe_mean_pct'].mean():+.2f} pp")
        print(f"  Disqualified GAP below universe: {per_period['disqualified_mean_pct'].mean() - per_period['universe_mean_pct'].mean():+.2f} pp")

        print()
        print(f"--- Under-median rate (avoid quality: higher = better) ---")
        print(f"  Bottom-10 avg % that underperformed median: {per_period['bottom10_under_median_rate'].mean() * 100:.1f}%")
        print(f"  Disqualified avg % that underperformed median: {per_period['disq_under_median_rate'].mean() * 100:.1f}%")
        print(f"  (100% = every pick a true dud; 50% = coin flip; lower = ranking has no bottom-signal)")

        print()
        print(f"--- Worst-case downside ({horizon_label}) ---")
        print(f"  Bottom-10 avg worst pick: {per_period['bottom10_worst_pick_pct'].mean():+.2f}%")
        print(f"  Bottom-10 avg best pick:  {per_period['bottom10_best_pick_pct'].mean():+.2f}%")

        print()


if __name__ == "__main__":
    main()
