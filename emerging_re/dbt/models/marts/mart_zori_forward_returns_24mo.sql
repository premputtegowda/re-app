-- Target B per DECISIONS.md §7: forward 24-month Zillow ZORI change,
-- demeaned cross-sectionally vs the national median.
--
-- Same shape as mart_hpi_forward_returns_24mo, but ZORI is MONTHLY cadence
-- (period_end_date is the last day of the month) so we get ~130 target
-- observations per county instead of ~30. The extra granularity matters
-- for backtest statistical power.
--
-- Uses the date-based self-join pattern (NOT positional lead) — same
-- lesson learned from FHFA/Manhattan gap. ZORI is more densely-sampled
-- than FHFA but early months for many counties are missing (Zillow's
-- county coverage starts at different dates), so gaps exist for early
-- vintages of every county.
with zori as (
    -- Latest vintage per (fips, period). Zillow restates its entire
    -- history every month, so `as_of_date` matters. For "current-state"
    -- scoring we want the newest restatement. Phase 3 backtest will
    -- filter by as_of_date <= scoring_date + lag_zillow.
    select
        fips,
        period_end_date,
        zori
    from {{ ref('stg_zillow_zori') }}
    qualify row_number() over (partition by fips, period_end_date order by as_of_date desc) = 1
),

with_forward as (
    -- Date-based self-join for the row exactly 24 months forward.
    -- ZORI's period_end_date is month-end (e.g. 2024-07-31), so
    -- 2024-07-31 + 2 years = 2026-07-31, which is also a month-end
    -- and lines up with real ZORI rows.
    select
        u.fips,
        z_now.period_end_date,
        z_now.zori as zori_t,
        z_fwd.zori as zori_t_plus_24mo,
        z_fwd.period_end_date as period_end_t_plus_24mo
    from {{ ref('int_universe') }} u
    inner join zori z_now on z_now.fips = u.fips
    left join zori z_fwd
        on z_fwd.fips = u.fips
        and z_fwd.period_end_date = z_now.period_end_date + interval '2 years'
),

with_returns as (
    select
        fips,
        period_end_date,
        zori_t,
        zori_t_plus_24mo,
        period_end_t_plus_24mo,
        case
            when zori_t_plus_24mo is null or zori_t is null or zori_t = 0 then null
            else (zori_t_plus_24mo / zori_t) - 1
        end as forward_return_24mo
    from with_forward
),

demeaned as (
    -- Cross-sectional demean per period_end_date.
    select
        fips,
        period_end_date,
        zori_t,
        forward_return_24mo,
        median(forward_return_24mo) over (partition by period_end_date) as national_median_24mo,
        forward_return_24mo
            - median(forward_return_24mo) over (partition by period_end_date)
            as target_zori_24mo_demeaned
    from with_returns
    where forward_return_24mo is not null
)

select * from demeaned
