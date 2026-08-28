"""Test the claim: 'momentum-heavy picks are more shock-sensitive than
fundamentals-heavy picks.'

Empirical strategy — for each scoring period, take the top-quartile of
counties by composite score. Split them into:
    momentum-heavy:      score_tier4_momentum >  score_tier1_demand
    fundamentals-heavy:  score_tier1_demand   >  score_tier4_momentum
Compare their realized target_hpi_24mo_demeaned. If momentum-heavy
consistently underperforms fundamentals-heavy — especially during shock
windows — the claim is supported.

Run: `uv run python scripts/test_tier_durability.py`
"""

from __future__ import annotations

import duckdb
import pandas as pd

DB = "data/warehouse/emerging_re.duckdb"


def main() -> None:
    con = duckdb.connect(DB, read_only=True)

    # Pull top-quartile by composite score per period, with tier scores +
    # realized targets. Only rows with a valid HPI target survive.
    df = con.execute("""
        with ranked as (
          select
            fips, period_end_date, county_name, state_name, pop_latest,
            composite_score,
            score_tier1_demand,
            score_tier4_momentum,
            target_hpi_24mo_demeaned,
            target_zori_24mo_demeaned,
            percent_rank() over (partition by period_end_date order by composite_score) as pctile
          from main_marts.mart_backtest_scores
          where composite_score is not null
            and target_hpi_24mo_demeaned is not null
        )
        select
          fips, period_end_date, county_name, state_name, pop_latest,
          composite_score, score_tier1_demand, score_tier4_momentum,
          target_hpi_24mo_demeaned, target_zori_24mo_demeaned,
          pctile
        from ranked
        where pctile >= 0.75  -- top quartile
    """).df()

    df["is_momentum_heavy"] = df["score_tier4_momentum"] > df["score_tier1_demand"]

    # -------- TEST 1: aggregate across all periods --------
    print("=" * 78)
    print("TEST 1 — All periods, top-quartile by composite")
    print("=" * 78)
    grouped = df.groupby("is_momentum_heavy").agg(
        n=("fips", "count"),
        median_hpi_target=("target_hpi_24mo_demeaned", "median"),
        mean_hpi_target=("target_hpi_24mo_demeaned", "mean"),
        median_zori_target=("target_zori_24mo_demeaned", "median"),
        mean_zori_target=("target_zori_24mo_demeaned", "mean"),
    ).rename(index={True: "momentum-heavy", False: "fundamentals-heavy"})
    print(grouped.round(4).to_string())
    print()

    momo = grouped.loc["momentum-heavy"]
    fund = grouped.loc["fundamentals-heavy"]
    print(f"  HPI target — fundamentals median − momentum median = {fund['median_hpi_target'] - momo['median_hpi_target']:+.4f}")
    print(f"  ZORI target — fundamentals median − momentum median = {fund['median_zori_target'] - momo['median_zori_target']:+.4f}")
    print("  (positive number = fundamentals-heavy outperforms momentum-heavy → claim supported)")

    # -------- TEST 2: per-period breakdown --------
    print()
    print("=" * 78)
    print("TEST 2 — Per-period comparison (median realized HPI 24mo demeaned)")
    print("=" * 78)
    per_period = df.groupby(["period_end_date", "is_momentum_heavy"])["target_hpi_24mo_demeaned"].median().unstack()
    per_period.columns = ["fundamentals_heavy", "momentum_heavy"]
    per_period["gap_fund_minus_momo"] = per_period["fundamentals_heavy"] - per_period["momentum_heavy"]
    print(per_period.round(4).to_string())
    print()
    fund_wins = (per_period["gap_fund_minus_momo"] > 0).sum()
    total_periods = len(per_period.dropna())
    print(f"  Fundamentals-heavy median > momentum-heavy median in {fund_wins}/{total_periods} periods")

    # -------- TEST 3: the COVID shock specifically --------
    print()
    print("=" * 78)
    print("TEST 3 — COVID shock (scored 2019-12-31, realized 2019→2021)")
    print("=" * 78)
    shock = df[df["period_end_date"] == pd.Timestamp("2019-12-31")].copy()
    if shock.empty:
        print("  (no 2019-12-31 scoring data)")
    else:
        shock_group = shock.groupby("is_momentum_heavy").agg(
            n=("fips", "count"),
            median_hpi_target=("target_hpi_24mo_demeaned", "median"),
            mean_hpi_target=("target_hpi_24mo_demeaned", "mean"),
            top_5=("target_hpi_24mo_demeaned", lambda s: s.nlargest(5).round(4).tolist()),
        ).rename(index={True: "momentum-heavy", False: "fundamentals-heavy"})
        print(shock_group[["n", "median_hpi_target", "mean_hpi_target"]].round(4).to_string())
        print()
        shock_momo = shock_group.loc["momentum-heavy"]
        shock_fund = shock_group.loc["fundamentals-heavy"]
        print(f"  Median gap (fund − momo) = {shock_fund['median_hpi_target'] - shock_momo['median_hpi_target']:+.4f}")
        print(f"  Mean gap   (fund − momo) = {shock_fund['mean_hpi_target'] - shock_momo['mean_hpi_target']:+.4f}")

    # -------- TEST 4: the rate-hike cool-down 2022-2024 --------
    print()
    print("=" * 78)
    print("TEST 4 — Rate-hike cool-down (scored 2022-12-31, realized 2022→2024)")
    print("=" * 78)
    cool = df[df["period_end_date"] == pd.Timestamp("2022-12-31")].copy()
    if cool.empty:
        print("  (no 2022-12-31 scoring data)")
    else:
        cool_group = cool.groupby("is_momentum_heavy").agg(
            n=("fips", "count"),
            median_hpi_target=("target_hpi_24mo_demeaned", "median"),
            mean_hpi_target=("target_hpi_24mo_demeaned", "mean"),
        ).rename(index={True: "momentum-heavy", False: "fundamentals-heavy"})
        print(cool_group.round(4).to_string())
        print()
        cool_momo = cool_group.loc["momentum-heavy"]
        cool_fund = cool_group.loc["fundamentals-heavy"]
        print(f"  Median gap (fund − momo) = {cool_fund['median_hpi_target'] - cool_momo['median_hpi_target']:+.4f}")

    print()
    print("=" * 78)


if __name__ == "__main__":
    main()
