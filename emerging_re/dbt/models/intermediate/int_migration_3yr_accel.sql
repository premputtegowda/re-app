-- Tier 1 signal: net domestic migration, accelerating.
--
-- Per DECISIONS.md and the framework: "Net domestic migration rate.
-- Positive AND accelerating over 3yr."
--
-- Two features emitted per (fips, period):
--   1. `domesticmig_per_1000` — current-period rate, normalized by
--      population so counties of different sizes compare cleanly
--   2. `domesticmig_accel_3yr` — current rate minus the average rate of
--      the trailing 3 years. Positive = accelerating; negative =
--      decelerating. Continuous metric so downstream weighting can treat
--      "barely accelerating" vs "wildly accelerating" differently.
--
-- Cadence: annual (PEP publishes once/year; period_end_date = July 1).
-- Uses latest vintage per (fips, period) — V2019 covers 2010-2019,
-- V2025 covers 2020-2025. Backtest will re-filter by as_of.
with pep as (
    select
        fips,
        period_end_date,
        popestimate,
        domesticmig
    from {{ ref('stg_census_pep') }}
    qualify row_number() over (partition by fips, period_end_date order by as_of_date desc) = 1
),

per_capita as (
    select
        fips,
        period_end_date,
        popestimate,
        domesticmig,
        1000.0 * domesticmig / nullif(popestimate, 0) as domesticmig_per_1000
    from pep
),

with_lags as (
    -- Date-based join to fetch t-1, t-2, t-3 rates. PEP is annual with
    -- period_end = July 1, so intervals are exact 1-year steps. If a
    -- county is missing a year (rare for PEP since Census restates back
    -- to 2010 in each vintage), the corresponding lag is NULL and the
    -- 3yr-avg becomes NULL — safer than silently using wrong data.
    select
        p_now.fips,
        p_now.period_end_date,
        p_now.popestimate,
        p_now.domesticmig,
        p_now.domesticmig_per_1000,
        p_1.domesticmig_per_1000 as domesticmig_per_1000_t_minus_1,
        p_2.domesticmig_per_1000 as domesticmig_per_1000_t_minus_2,
        p_3.domesticmig_per_1000 as domesticmig_per_1000_t_minus_3
    from per_capita p_now
    left join per_capita p_1
        on p_1.fips = p_now.fips
        and p_1.period_end_date = p_now.period_end_date - interval '1 year'
    left join per_capita p_2
        on p_2.fips = p_now.fips
        and p_2.period_end_date = p_now.period_end_date - interval '2 years'
    left join per_capita p_3
        on p_3.fips = p_now.fips
        and p_3.period_end_date = p_now.period_end_date - interval '3 years'
),

with_accel as (
    select
        fips,
        period_end_date,
        popestimate,
        domesticmig,
        domesticmig_per_1000,
        -- Prior 3yr average — null if ANY of t-1..t-3 is missing (strict
        -- guard against biased averages from partial history).
        (domesticmig_per_1000_t_minus_1
            + domesticmig_per_1000_t_minus_2
            + domesticmig_per_1000_t_minus_3) / 3.0 as domesticmig_per_1000_prev3_avg,
        -- Acceleration = current minus prior-3yr-avg.
        domesticmig_per_1000
            - (domesticmig_per_1000_t_minus_1
                + domesticmig_per_1000_t_minus_2
                + domesticmig_per_1000_t_minus_3) / 3.0
            as domesticmig_accel_3yr
    from with_lags
)

select
    a.fips,
    a.period_end_date,
    a.popestimate,
    a.domesticmig,
    a.domesticmig_per_1000,
    a.domesticmig_per_1000_prev3_avg,
    a.domesticmig_accel_3yr
from with_accel a
-- Restrict to universe so we're not computing for counties we'd never score.
inner join {{ ref('int_universe') }} u using (fips)
