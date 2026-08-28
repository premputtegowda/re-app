-- Target A (36mo variant): forward 36-month FHFA HPI change, demeaned
-- cross-sectionally vs the national median. Same shape as
-- mart_hpi_forward_returns_24mo, just a 3-year window instead of 2.
--
-- Added because the user's actual investment horizon is 3-5 years for
-- rental IRR — 24mo is dominated by momentum, longer horizons let the
-- framework's mean-reversion theory play out.
--
-- Same date-based self-join pattern to survive FHFA coverage gaps.
with hpi as (
    select
        fips,
        period_end_date,
        hpi
    from {{ ref('stg_fhfa_hpi') }}
    qualify row_number() over (partition by fips, period_end_date order by as_of_date desc) = 1
),

with_forward as (
    select
        u.fips,
        h_now.period_end_date,
        h_now.hpi as hpi_t,
        h_fwd.hpi as hpi_t_plus_36mo,
        h_fwd.period_end_date as period_end_t_plus_36mo
    from {{ ref('int_universe') }} u
    inner join hpi h_now on h_now.fips = u.fips
    left join hpi h_fwd
        on h_fwd.fips = u.fips
        and h_fwd.period_end_date = h_now.period_end_date + interval '3 years'
),

with_returns as (
    select
        fips,
        period_end_date,
        hpi_t,
        hpi_t_plus_36mo,
        period_end_t_plus_36mo,
        case
            when hpi_t_plus_36mo is null or hpi_t is null or hpi_t = 0 then null
            else (hpi_t_plus_36mo / hpi_t) - 1
        end as forward_return_36mo
    from with_forward
),

demeaned as (
    select
        fips,
        period_end_date,
        hpi_t,
        forward_return_36mo,
        median(forward_return_36mo) over (partition by period_end_date) as national_median_36mo,
        forward_return_36mo
            - median(forward_return_36mo) over (partition by period_end_date)
            as target_hpi_36mo_demeaned
    from with_returns
    where forward_return_36mo is not null
)

select * from demeaned
