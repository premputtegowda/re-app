-- MF property inventory — existing stock + new permit pipeline + age.
-- PIT-correct: one row per (fips, scoring_period_end).
--
-- Grain change (2026-09-02): previously one row per fips (latest ACS 1yr
-- vintage). Now (fips, period_end_date) with the ACS 1yr vintage that
-- was publicly available at each scoring date. BPS trailing 5yr aggregated
-- to a rolling window ending at scoring_period.
--
-- CRITICAL DEFINITIONAL NOTE: ACS B25024 reports HOUSING UNITS classified
-- by size of building they live in. NOT direct building counts. To
-- estimate buildings, divide units by bucket midpoint:
--   5-9 units → 7, 10-19 → 14.5, 20-49 → 34.5, 50+ → 75
-- Building estimates are approximations (±20% MOE).
--
-- Three independent signals combined per (fips, scoring_period):
--   1. EXISTING stock from ACS B25024 (units + est bldgs by size)
--   2. NEW pipeline from BPS 5+-unit permits, trailing 5yr sum
--   3. AGE from ACS B25034 (pre-1980 share = value-add vintage)
with periods as (
    select distinct period_end_date
    from {{ ref('stg_fhfa_hpi') }}
    where extract(month from period_end_date) = 12
),

acs_1yr_pit as (
    select
        p.period_end_date as scoring_period,
        a.fips,
        a.period_end_date as acs_data_period,
        a.total_population,
        a.units_in_5_to_9_bldgs,
        a.units_in_10_to_19_bldgs,
        a.units_in_20_to_49_bldgs,
        a.units_in_50_plus_bldgs,
        a.hu_built_2020_plus + a.hu_built_2010_to_2019 + a.hu_built_2000_to_2009 as hu_built_2000_plus,
        a.hu_built_1990_to_1999 + a.hu_built_1980_to_1989 as hu_built_1980_1999,
        a.hu_built_1970_to_1979 + a.hu_built_1960_to_1969
            + a.hu_built_1950_to_1959 + a.hu_built_1940_to_1949 + a.hu_built_pre_1940 as hu_built_pre_1980,
        a.hu_built_1960_to_1969 + a.hu_built_1950_to_1959
            + a.hu_built_1940_to_1949 + a.hu_built_pre_1940 as hu_built_pre_1970,
        a.hu_built_1950_to_1959 + a.hu_built_1940_to_1949 + a.hu_built_pre_1940 as hu_built_pre_1960,
        a.hu_built_2020_plus + a.hu_built_2010_to_2019 + a.hu_built_2000_to_2009
            + a.hu_built_1990_to_1999 + a.hu_built_1980_to_1989 + a.hu_built_1970_to_1979
            + a.hu_built_1960_to_1969 + a.hu_built_1950_to_1959 + a.hu_built_1940_to_1949
            + a.hu_built_pre_1940 as total_housing_units_yr_built
    from periods p
    join {{ ref('stg_census_acs_1yr') }} a
        on a.as_of_date <= p.period_end_date
        and a.units_in_10_to_19_bldgs is not null
    qualify row_number() over (
        partition by a.fips, p.period_end_date
        order by a.period_end_date desc, a.as_of_date desc
    ) = 1
),

bps_trailing_5yr as (
    -- 5-year trailing sum of 5+ unit permits ending at each scoring period.
    select
        p.period_end_date as scoring_period,
        b.fips,
        sum(b.units_5plus) as mf_permits_5yr_total,
        sum(b.units_total) as total_permits_5yr
    from periods p
    join {{ ref('stg_census_bps') }} b
        on b.period_end_date <= p.period_end_date
        and b.period_end_date > p.period_end_date - interval '5 years'
    group by p.period_end_date, b.fips
)

select
    a.fips,
    a.scoring_period as period_end_date,
    a.acs_data_period,
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
    round(a.units_in_10_to_19_bldgs / 14.5)  as est_bldgs_10_to_19,   -- 🎯 buy-target
    round(a.units_in_20_to_49_bldgs / 34.5)  as est_bldgs_20_to_49,
    round(a.units_in_50_plus_bldgs / 75.0)   as est_bldgs_50_plus,
    -- ── Age of housing stock (B25034 aggregates) ──
    a.hu_built_pre_1980,
    a.hu_built_pre_1970,
    a.hu_built_pre_1960,
    a.hu_built_1980_1999,
    a.hu_built_2000_plus,
    a.hu_built_pre_1980 / nullif(a.total_housing_units_yr_built, 0) as pre_1980_share,
    -- ── New pipeline (5-year permit history) ──
    coalesce(b.mf_permits_5yr_total, 0) as mf_permits_5yr_total,
    1.0 * coalesce(b.mf_permits_5yr_total, 0)
        / nullif(a.units_in_5_to_9_bldgs + a.units_in_10_to_19_bldgs
                 + a.units_in_20_to_49_bldgs + a.units_in_50_plus_bldgs, 0)
        as pipeline_to_stock_ratio,
    -- ── Absorption rate proxy: est properties trading/year (6% turnover) ──
    round(0.06 * round(a.units_in_10_to_19_bldgs / 14.5)) as est_annual_trades_10_to_19,
    round(0.06 * (round(a.units_in_5_to_9_bldgs / 7.0)
                  + round(a.units_in_10_to_19_bldgs / 14.5)
                  + round(a.units_in_20_to_49_bldgs / 34.5))) as est_annual_trades_5_to_49
from acs_1yr_pit a
left join bps_trailing_5yr b
    on b.fips = a.fips and b.scoring_period = a.scoring_period
inner join {{ ref('int_universe') }} u on u.fips = a.fips
