"""The economic-edge test: does Spearman 0.5 translate to actual dollars?

Simulates three strategies at each historical scoring date:
    - Composite:   equal-weight the top-N counties by composite_score
    - Baseline:    equal-weight the top-N counties by hpi_yoy (momentum)
    - Universe:    equal-weight the entire universe (buy-the-market)
Compares realized 24-month and 36-month HPI returns (raw, not demeaned)
so the numbers are in "actual price appreciation over hold period" units.

Then quantifies:
    - Average edge (composite vs baseline vs universe)
    - Hit rate (what % of top-N picks actually beat the median universe county?)
    - Downside (worst pick in each top-N — one bad pick can destroy an IRR)
    - 5-year cumulative simulation (pick in 2019, hold to 2024)

Run: `uv run python scripts/test_investor_edge.py`
"""

from __future__ import annotations

import duckdb
import numpy as np
import pandas as pd

DB = "data/warehouse/emerging_re.duckdb"
TOP_N = 10  # realistic shortlist size for a single investor


def _load_scored() -> pd.DataFrame:
    con = duckdb.connect(DB, read_only=True)
    return con.execute("""
        select
          fips, period_end_date, county_name, state_name, pop_latest,
          composite_score, hpi_forward_return_24mo, hpi_forward_return_36mo,
          any_disqualifier
        from main_marts.mart_backtest_scores
        where composite_score is not null
    """).df()


def _load_features() -> pd.DataFrame:
    """We need hpi_yoy (baseline momentum) at each scoring date."""
    con = duckdb.connect(DB, read_only=True)
    return con.execute("""
        select
          fips, period_end_date, hpi_yoy,
          hpi_forward_return_24mo, hpi_forward_return_36mo
        from main_marts.mart_county_features
        where hpi_yoy is not null
    """).df()


def _top_n_return(df: pd.DataFrame, sort_col: str, n: int, return_col: str) -> pd.Series:
    """For each period, pick top-N by sort_col, average their return_col."""
    return (
        df.sort_values(["period_end_date", sort_col], ascending=[True, False])
        .groupby("period_end_date")
        .head(n)
        .groupby("period_end_date")[return_col]
        .mean()
    )


def main() -> None:
    scored = _load_scored()
    features = _load_features()

    # Composite picks use scored (has composite_score + realized returns).
    # Baseline picks use features (has hpi_yoy + realized returns).
    # Both are filtered to universe rows (which is what mart tables carry).

    for horizon_col, horizon_label in [
        ("hpi_forward_return_24mo", "24mo"),
        ("hpi_forward_return_36mo", "36mo"),
    ]:
        print("=" * 78)
        print(f"HORIZON = {horizon_label}   (raw HPI change, not demeaned)")
        print("=" * 78)

        s = scored[scored[horizon_col].notna() & ~scored["any_disqualifier"]].copy()
        f = features[features[horizon_col].notna()].copy()

        composite_returns = _top_n_return(s, "composite_score", TOP_N, horizon_col)
        baseline_returns = _top_n_return(f, "hpi_yoy", TOP_N, horizon_col)
        universe_returns = s.groupby("period_end_date")[horizon_col].mean()

        table = pd.DataFrame({
            "composite_top10_avg_return": composite_returns,
            "baseline_top10_avg_return": baseline_returns,
            "universe_avg_return": universe_returns,
        }).dropna(how="all")
        table["edge_vs_universe_composite"] = table["composite_top10_avg_return"] - table["universe_avg_return"]
        table["edge_vs_universe_baseline"] = table["baseline_top10_avg_return"] - table["universe_avg_return"]
        table["edge_vs_baseline_composite"] = table["composite_top10_avg_return"] - table["baseline_top10_avg_return"]

        print("\nPer-period top-10 avg returns (raw %):")
        display = (table * 100).round(2)
        print(display.to_string())

        print(f"\n--- Aggregate ({horizon_label}) ---")
        print(f"  Composite top-10 avg return:         {table['composite_top10_avg_return'].mean() * 100:+.2f}%")
        print(f"  Baseline  top-10 avg return:         {table['baseline_top10_avg_return'].mean() * 100:+.2f}%")
        print(f"  Universe average return:             {table['universe_avg_return'].mean() * 100:+.2f}%")
        print(f"  Composite edge vs universe (avg):    {table['edge_vs_universe_composite'].mean() * 100:+.2f} pp")
        print(f"  Composite edge vs baseline (avg):    {table['edge_vs_baseline_composite'].mean() * 100:+.2f} pp")

        # Hit rate — of the top-N picks per period, what % beat the median
        # universe county in that period?
        hit_rows = []
        for period, g in s.groupby("period_end_date"):
            median = g[horizon_col].median()
            top_n = g.sort_values("composite_score", ascending=False).head(TOP_N)
            top_n_baseline = f[f["period_end_date"] == period].sort_values("hpi_yoy", ascending=False).head(TOP_N)
            hit_rows.append({
                "period_end_date": period,
                "median_realized": median,
                "composite_hit_rate": (top_n[horizon_col] > median).mean(),
                "baseline_hit_rate": (top_n_baseline[horizon_col] > median).mean(),
                "composite_worst_pick": top_n[horizon_col].min(),
                "baseline_worst_pick": top_n_baseline[horizon_col].min(),
            })
        hits = pd.DataFrame(hit_rows).set_index("period_end_date")
        print(f"\n--- Hit rate (% of top-10 that beat median universe county) ---")
        print(f"  Composite average hit rate:          {hits['composite_hit_rate'].mean() * 100:.1f}%")
        print(f"  Baseline  average hit rate:          {hits['baseline_hit_rate'].mean() * 100:.1f}%")
        print(f"  (50% = coin flip; higher = ranking has signal)")

        print(f"\n--- Downside risk (worst pick in each top-10, raw %) ---")
        print(f"  Composite avg worst-pick return:     {hits['composite_worst_pick'].mean() * 100:+.2f}%")
        print(f"  Baseline  avg worst-pick return:     {hits['baseline_worst_pick'].mean() * 100:+.2f}%")

        print()

    # -------- 5-year cumulative simulation --------
    print("=" * 78)
    print("5-YEAR SIMULATION — pick top-N at Dec 2019, hold to Dec 2024")
    print("=" * 78)
    con = duckdb.connect(DB, read_only=True)
    top10_composite_5y = con.execute(f"""
        with picks as (
          select fips, county_name, state_name, composite_score
          from main_marts.mart_backtest_scores
          where period_end_date = date '2019-12-31'
            and composite_score is not null
            and not any_disqualifier
          order by composite_score desc
          limit {TOP_N}
        ),
        hpi_all as (
          select fips, period_end_date, hpi
          from main_staging.stg_fhfa_hpi
          where period_end_date in (date '2019-12-31', date '2024-12-31')
          qualify row_number() over (partition by fips, period_end_date order by as_of_date desc) = 1
        )
        select p.county_name || ', ' || p.state_name as county,
               p.composite_score,
               max(case when h.period_end_date = date '2019-12-31' then h.hpi end) as hpi_2019,
               max(case when h.period_end_date = date '2024-12-31' then h.hpi end) as hpi_2024
        from picks p
        left join hpi_all h using (fips)
        group by p.fips, p.county_name, p.state_name, p.composite_score
        order by p.composite_score desc
    """).df()
    top10_composite_5y["pct_5yr"] = 100 * (top10_composite_5y["hpi_2024"] / top10_composite_5y["hpi_2019"] - 1)

    top10_baseline_5y = con.execute(f"""
        with picks as (
          select fips, county_name, state_name, hpi_yoy
          from main_marts.mart_county_features
          where period_end_date = date '2019-12-31' and hpi_yoy is not null
          order by hpi_yoy desc
          limit {TOP_N}
        ),
        hpi_all as (
          select fips, period_end_date, hpi
          from main_staging.stg_fhfa_hpi
          where period_end_date in (date '2019-12-31', date '2024-12-31')
          qualify row_number() over (partition by fips, period_end_date order by as_of_date desc) = 1
        )
        select p.county_name || ', ' || p.state_name as county,
               p.hpi_yoy,
               max(case when h.period_end_date = date '2019-12-31' then h.hpi end) as hpi_2019,
               max(case when h.period_end_date = date '2024-12-31' then h.hpi end) as hpi_2024
        from picks p
        left join hpi_all h using (fips)
        group by p.fips, p.county_name, p.state_name, p.hpi_yoy
        order by p.hpi_yoy desc
    """).df()
    top10_baseline_5y["pct_5yr"] = 100 * (top10_baseline_5y["hpi_2024"] / top10_baseline_5y["hpi_2019"] - 1)

    universe_5y = con.execute("""
        with universe_2019 as (
          select fips from main_marts.mart_county_features
          where period_end_date = date '2019-12-31' and hpi_yoy is not null
        ),
        hpi_all as (
          select fips, period_end_date, hpi
          from main_staging.stg_fhfa_hpi
          where period_end_date in (date '2019-12-31', date '2024-12-31')
          qualify row_number() over (partition by fips, period_end_date order by as_of_date desc) = 1
        )
        select 100.0 * (max(case when period_end_date = date '2024-12-31' then hpi end)
                      / max(case when period_end_date = date '2019-12-31' then hpi end) - 1) as pct_5yr
        from hpi_all
        where fips in (select fips from universe_2019)
        group by fips
    """).df()

    print("\nTop-10 composite picks 2019-12-31 → 2024-12-31 (5-year price change):")
    print(top10_composite_5y[["county", "composite_score", "pct_5yr"]].round(2).to_string(index=False))
    print(f"\n  Composite top-10 average 5yr return: {top10_composite_5y['pct_5yr'].mean():+.2f}%")

    print("\nTop-10 baseline (momentum) picks 2019-12-31 → 2024-12-31:")
    print(top10_baseline_5y[["county", "hpi_yoy", "pct_5yr"]].round(2).to_string(index=False))
    print(f"\n  Baseline top-10 average 5yr return:  {top10_baseline_5y['pct_5yr'].mean():+.2f}%")

    print(f"\n  Universe average 5yr return:         {universe_5y['pct_5yr'].mean():+.2f}%")
    print(f"  Universe median 5yr return:          {universe_5y['pct_5yr'].median():+.2f}%")

    print(f"\n  Composite edge vs baseline (5yr):    {top10_composite_5y['pct_5yr'].mean() - top10_baseline_5y['pct_5yr'].mean():+.2f} pp")
    print(f"  Composite edge vs universe (5yr):    {top10_composite_5y['pct_5yr'].mean() - universe_5y['pct_5yr'].mean():+.2f} pp")


if __name__ == "__main__":
    main()
