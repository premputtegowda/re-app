-- MF property inventory — existing stock + new permit pipeline + age.
--
-- CRITICAL DEFINITIONAL NOTE: ACS B25024 reports the count of HOUSING
-- UNITS classified by the size of building they live in. It does NOT
-- directly report the number of buildings. To estimate buildings, we
-- divide units by the midpoint of each size bucket:
--   5-9 units bucket   → midpoint 7
--   10-19 units bucket → midpoint 14.5  🎯
--   20-49 units bucket → midpoint 34.5
--   50+ units bucket   → assume 75 as midpoint (rough; wide tail)
-- Building estimates are approximations — treat as ±20% margin of error.
--
-- Three independent signals combined per (fips):
--   1. EXISTING stock from ACS B25024 (units + estimated bldgs by size)
--   2. NEW pipeline from BPS 5+-unit permits, trailing 5yr sum
--   3. AGE from ACS B25034 — pre-1980 share = value-add vintage
--
-- Absorption rate proxy:
--   Assumes 6% annual MF property turnover (industry norm 5-8% for
--   privately-held 5-20 unit properties). Multiplied against estimated
--   building count → approximate properties trading per year.
with acs_1yr_latest as (
    select
        fips,
        period_end_date as acs_period,
        total_population,
        -- Structure size (units per building bucket)
        units_in_5_to_9_bldgs,
        units_in_10_to_19_bldgs,
        units_in_20_to_49_bldgs,
        units_in_50_plus_bldgs,
        -- Year built (aggregated categories from raw brackets)
        hu_built_2020_plus + hu_built_2010_to_2019 + hu_built_2000_to_2009
            as hu_built_2000_plus,
        hu_built_1990_to_1999 + hu_built_1980_to_1989
            as hu_built_1980_1999,
        hu_built_1970_to_1979 + hu_built_1960_to_1969
            + hu_built_1950_to_1959 + hu_built_1940_to_1949 + hu_built_pre_1940
            as hu_built_pre_1980,
        hu_built_1960_to_1969 + hu_built_1950_to_1959
            + hu_built_1940_to_1949 + hu_built_pre_1940
            as hu_built_pre_1970,
        hu_built_1950_to_1959 + hu_built_1940_to_1949 + hu_built_pre_1940
            as hu_built_pre_1960,
        -- Total housing units (sum of all brackets — used as denominator).
        hu_built_2020_plus + hu_built_2010_to_2019 + hu_built_2000_to_2009
            + hu_built_1990_to_1999 + hu_built_1980_to_1989 + hu_built_1970_to_1979
            + hu_built_1960_to_1969 + hu_built_1950_to_1959 + hu_built_1940_to_1949
            + hu_built_pre_1940 as total_housing_units_yr_built
    from {{ ref('stg_census_acs_1yr') }}
    where units_in_10_to_19_bldgs is not null
    qualify row_number() over (partition by fips order by period_end_date desc, as_of_date desc) = 1
),

bps_recent as (
    -- 5-year trailing sum of 5+ unit permits (2021-2025).
    select
        fips,
        sum(units_5plus) as mf_permits_5yr_total,
        sum(units_total) as total_permits_5yr
    from {{ ref('stg_census_bps') }}
    where period_end_date in (
        date '2021-12-31', date '2022-12-31', date '2023-12-31',
        date '2024-12-31', date '2025-12-31'
    )
    group by fips
)

select
    a.fips,
    a.acs_period as period_end_date,
    a.total_population,
    -- ── Existing MF stock: RAW UNIT COUNTS (from ACS B25024) ──
    a.units_in_5_to_9_bldgs,
    a.units_in_10_to_19_bldgs,          -- 🎯 tenants in target-size stock
    a.units_in_20_to_49_bldgs,
    a.units_in_50_plus_bldgs,
    a.units_in_5_to_9_bldgs + a.units_in_10_to_19_bldgs
        + a.units_in_20_to_49_bldgs + a.units_in_50_plus_bldgs as total_mf_units,
    -- ── ESTIMATED BUILDING COUNTS (units / bucket midpoint) ──
    round(a.units_in_5_to_9_bldgs / 7.0)     as est_bldgs_5_to_9,
    round(a.units_in_10_to_19_bldgs / 14.5)  as est_bldgs_10_to_19,   -- 🎯 buy-target count
    round(a.units_in_20_to_49_bldgs / 34.5)  as est_bldgs_20_to_49,
    round(a.units_in_50_plus_bldgs / 75.0)   as est_bldgs_50_plus,
    -- ── Age of housing stock (B25034 aggregates) ──
    a.hu_built_pre_1980,
    a.hu_built_pre_1970,
    a.hu_built_pre_1960,
    a.hu_built_1980_1999,
    a.hu_built_2000_plus,
    -- Pre-1980 share (value-add vintage indicator).
    a.hu_built_pre_1980 / nullif(a.total_housing_units_yr_built, 0)
        as pre_1980_share,
    -- ── New pipeline (5-year permit history) ──
    coalesce(b.mf_permits_5yr_total, 0) as mf_permits_5yr_total,
    -- Pipeline-to-existing-stock ratio in UNIT terms (apples-to-apples).
    1.0 * coalesce(b.mf_permits_5yr_total, 0)
        / nullif(a.units_in_5_to_9_bldgs + a.units_in_10_to_19_bldgs
                 + a.units_in_20_to_49_bldgs + a.units_in_50_plus_bldgs, 0)
        as pipeline_to_stock_ratio,
    -- ── Absorption rate proxy: est properties trading/year ──
    -- 6% annual turnover × estimated building count = expected annual trades.
    -- Useful for sizing broker outreach + inventory availability planning.
    round(0.06 * round(a.units_in_10_to_19_bldgs / 14.5))
        as est_annual_trades_10_to_19,
    round(0.06 * (round(a.units_in_5_to_9_bldgs / 7.0)
                  + round(a.units_in_10_to_19_bldgs / 14.5)
                  + round(a.units_in_20_to_49_bldgs / 34.5)))
        as est_annual_trades_5_to_49
from acs_1yr_latest a
left join bps_recent b using (fips)
inner join {{ ref('int_universe') }} u on u.fips = a.fips
