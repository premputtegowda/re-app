"""Historical MF backtest.

Applies the same MF-suitability filters at each historical scoring date
using data available at that time:
    - Population >= 250K (from historical PEP)
    - 3-year rolling MF permits >= 500 (from historical BPS)
    - Not disqualified

Ranks by composite score at each date, takes top-N, computes realized
24mo and 36mo HPI returns. Compares to MF-universe average and
overall universe average.

Note: this does NOT use MF-adjusted cap rate (would require historical
HUD FMR loading for each vintage). Ranking uses the composite score
directly. This answers: "does the composite work well for MF-suitable
counties historically?"

Run: `uv run python scripts/test_mf_historical.py`
"""

from __future__ import annotations

import duckdb
import pandas as pd

DB = "data/warehouse/emerging_re.duckdb"
TOP_N = 20


def main() -> None:
    con = duckdb.connect(DB, read_only=True)

    # For each historical scoring period, build the MF-eligible set using
    # data AT THAT TIME (no look-ahead):
    #   - pop from same-year PEP
    #   - 3yr MF permits ending in scoring year
    # Then join to backtest scores + realized returns.
    df = con.execute("""
        with pep_annual as (
          select fips, year(period_end_date) as year, popestimate
          from main_staging.stg_census_pep
          qualify row_number() over (partition by fips, period_end_date order by as_of_date desc) = 1
        ),
        bps_annual as (
          select fips, year(period_end_date) as year, units_5plus, units_total
          from main_staging.stg_census_bps
          where date_trunc('month', period_end_date) = date_trunc('month', make_date(year(period_end_date), 12, 1))
        ),
        mf_permits_3yr as (
          -- For scoring year Y, sum 5+ unit permits over Y-2 through Y.
          select
            b1.fips, b1.year as scoring_year,
            b1.units_5plus + coalesce(b2.units_5plus, 0) + coalesce(b3.units_5plus, 0) as mf_permits_3yr
          from bps_annual b1
          left join bps_annual b2 on b2.fips = b1.fips and b2.year = b1.year - 1
          left join bps_annual b3 on b3.fips = b1.fips and b3.year = b1.year - 2
        )
        select
          s.fips, s.period_end_date, s.county_name, s.state_name,
          s.composite_score, s.any_disqualifier, s.pop_latest,
          s.hpi_forward_return_24mo, s.hpi_forward_return_36mo,
          p.popestimate as pop_at_scoring_time,
          coalesce(mf.mf_permits_3yr, 0) as mf_permits_3yr
        from main_marts.mart_backtest_scores s
        left join pep_annual p on p.fips = s.fips and p.year = year(s.period_end_date)
        left join mf_permits_3yr mf on mf.fips = s.fips and mf.scoring_year = year(s.period_end_date)
        where s.composite_score is not null
          and not s.any_disqualifier
    """).df()

    # Apply MF filters
    mf_eligible = df[
        (df["pop_at_scoring_time"] >= 250_000) & (df["mf_permits_3yr"] >= 500)
    ].copy()

    print(f"Historical MF-eligible observations: {len(mf_eligible):,} across {mf_eligible['period_end_date'].nunique()} scoring dates")
    print(f"Universe size per year (approximate):")
    for period, n in mf_eligible.groupby("period_end_date")["fips"].nunique().items():
        print(f"  {period}: {n} MF-eligible counties")

    # For each scoring period, take top-20 by composite (from MF-eligible)
    # and compute their portfolio-level realized returns.
    print()
    print("=" * 90)
    print(f"MF TOP-{TOP_N} PORTFOLIO PERFORMANCE (vs MF-universe avg vs entire universe avg)")
    print("=" * 90)
    print()
    print(f"  {'period':<12} {'mf_top':>7} {'mf_uni':>7} {'all_uni':>8} {'top vs mf':>10} {'top vs all':>11}")
    print(f"  {'':12} {'24mo%':>7} {'24mo%':>7} {'24mo%':>8} {'pp':>10} {'pp':>11}")
    print(f"  {'-' * 65}")

    rows_24mo = []
    for period, g_mf in mf_eligible.groupby("period_end_date"):
        # Same-period universe (all non-disqualified with valid targets)
        g_all = df[
            (df["period_end_date"] == period)
            & (df["hpi_forward_return_24mo"].notna())
        ]
        if g_mf[g_mf["hpi_forward_return_24mo"].notna()].empty or g_all.empty:
            continue
        top_n = g_mf[g_mf["hpi_forward_return_24mo"].notna()].nlargest(TOP_N, "composite_score")
        rows_24mo.append({
            "period": period,
            "n_mf_eligible": len(g_mf),
            "top_n": len(top_n),
            "mf_top_avg_24mo": top_n["hpi_forward_return_24mo"].mean(),
            "mf_universe_avg_24mo": g_mf["hpi_forward_return_24mo"].mean(),
            "all_universe_avg_24mo": g_all["hpi_forward_return_24mo"].mean(),
        })

    table_24 = pd.DataFrame(rows_24mo).set_index("period")
    for period, r in table_24.iterrows():
        top = r["mf_top_avg_24mo"] * 100
        mf_u = r["mf_universe_avg_24mo"] * 100
        all_u = r["all_universe_avg_24mo"] * 100
        edge_vs_mf = top - mf_u
        edge_vs_all = top - all_u
        print(f"  {str(period)[:10]:<12} {top:>6.1f}% {mf_u:>6.1f}% {all_u:>7.1f}% {edge_vs_mf:>+9.1f}pp {edge_vs_all:>+10.1f}pp")

    print()
    print(f"--- Aggregate averages across all scoring periods (24mo) ---")
    print(f"  MF top-{TOP_N} avg return:            {table_24['mf_top_avg_24mo'].mean() * 100:+.2f}%")
    print(f"  MF universe avg return:            {table_24['mf_universe_avg_24mo'].mean() * 100:+.2f}%")
    print(f"  Entire universe avg return:        {table_24['all_universe_avg_24mo'].mean() * 100:+.2f}%")
    print(f"  MF top-{TOP_N} edge over MF universe: {(table_24['mf_top_avg_24mo'].mean() - table_24['mf_universe_avg_24mo'].mean()) * 100:+.2f}pp")
    print(f"  MF top-{TOP_N} edge over ALL universe: {(table_24['mf_top_avg_24mo'].mean() - table_24['all_universe_avg_24mo'].mean()) * 100:+.2f}pp")

    # Same for 36mo
    print()
    print("=" * 90)
    print(f"MF TOP-{TOP_N} PORTFOLIO PERFORMANCE — 36mo HORIZON")
    print("=" * 90)
    print()
    print(f"  {'period':<12} {'mf_top':>7} {'mf_uni':>7} {'all_uni':>8} {'top vs mf':>10} {'top vs all':>11}")
    print(f"  {'':12} {'36mo%':>7} {'36mo%':>7} {'36mo%':>8} {'pp':>10} {'pp':>11}")
    print(f"  {'-' * 65}")

    rows_36mo = []
    for period, g_mf in mf_eligible.groupby("period_end_date"):
        g_all = df[
            (df["period_end_date"] == period)
            & (df["hpi_forward_return_36mo"].notna())
        ]
        g_mf_valid = g_mf[g_mf["hpi_forward_return_36mo"].notna()]
        if g_mf_valid.empty or g_all.empty:
            continue
        top_n = g_mf_valid.nlargest(TOP_N, "composite_score")
        rows_36mo.append({
            "period": period,
            "mf_top_avg_36mo": top_n["hpi_forward_return_36mo"].mean(),
            "mf_universe_avg_36mo": g_mf_valid["hpi_forward_return_36mo"].mean(),
            "all_universe_avg_36mo": g_all["hpi_forward_return_36mo"].mean(),
        })

    table_36 = pd.DataFrame(rows_36mo).set_index("period")
    for period, r in table_36.iterrows():
        top = r["mf_top_avg_36mo"] * 100
        mf_u = r["mf_universe_avg_36mo"] * 100
        all_u = r["all_universe_avg_36mo"] * 100
        print(f"  {str(period)[:10]:<12} {top:>6.1f}% {mf_u:>6.1f}% {all_u:>7.1f}% {top-mf_u:>+9.1f}pp {top-all_u:>+10.1f}pp")

    print()
    print(f"--- Aggregate averages (36mo) ---")
    print(f"  MF top-{TOP_N} avg return:            {table_36['mf_top_avg_36mo'].mean() * 100:+.2f}%")
    print(f"  MF universe avg return:            {table_36['mf_universe_avg_36mo'].mean() * 100:+.2f}%")
    print(f"  Entire universe avg return:        {table_36['all_universe_avg_36mo'].mean() * 100:+.2f}%")
    print(f"  MF top-{TOP_N} edge over MF universe: {(table_36['mf_top_avg_36mo'].mean() - table_36['mf_universe_avg_36mo'].mean()) * 100:+.2f}pp")
    print(f"  MF top-{TOP_N} edge over ALL universe: {(table_36['mf_top_avg_36mo'].mean() - table_36['all_universe_avg_36mo'].mean()) * 100:+.2f}pp")

    # Show historical top-10 for a few scoring dates
    print()
    print("=" * 90)
    print("HISTORICAL MF TOP-10 PICKS (illustrative years)")
    print("=" * 90)
    for target_period in ["2019-12-31", "2020-12-31", "2021-12-31", "2022-12-31"]:
        period_ts = pd.Timestamp(target_period)
        g = mf_eligible[
            (mf_eligible["period_end_date"] == period_ts)
            & (mf_eligible["hpi_forward_return_24mo"].notna())
        ]
        if g.empty:
            continue
        top10 = g.nlargest(10, "composite_score")
        print()
        print(f"Scored at {target_period} — top 10 MF-suitable by composite:")
        for _, r in top10.iterrows():
            realized = r["hpi_forward_return_24mo"] * 100
            print(f"  {r['county_name']:<28} {r['state_name']:<20} score={r['composite_score']:.2f}, realized 24mo HPI={realized:+.1f}%")
        mf_universe_avg = g["hpi_forward_return_24mo"].mean() * 100
        top10_avg = top10["hpi_forward_return_24mo"].mean() * 100
        print(f"  Top-10 avg: {top10_avg:+.1f}%   MF universe avg: {mf_universe_avg:+.1f}%   Edge: {top10_avg - mf_universe_avg:+.1f}pp")


if __name__ == "__main__":
    main()
