-- Target A (60mo/5yr variant): forward 60-month FHFA HPI change,
-- demeaned cross-sectionally vs national median. Longest horizon we
-- can compute given data (latest FHFA year = 2025, so scoring 2020
-- is the last date with +5yr forward data available).
--
-- Same date-based self-join pattern as 24mo/36mo variants.
with hpi as (
    select fips, period_end_date, hpi
    from {{ ref('stg_fhfa_hpi') }}
    qualify row_number() over (partition by fips, period_end_date order by as_of_date desc) = 1
),

with_forward as (
    select
        u.fips,
        h_now.period_end_date,
        h_now.hpi as hpi_t,
        h_fwd.hpi as hpi_t_plus_60mo,
        h_fwd.period_end_date as period_end_t_plus_60mo
    from {{ ref('int_universe') }} u
    inner join hpi h_now on h_now.fips = u.fips
    left join hpi h_fwd
        on h_fwd.fips = u.fips
        and h_fwd.period_end_date = h_now.period_end_date + interval '5 years'
),

with_returns as (
    select
        fips,
        period_end_date,
        hpi_t,
        hpi_t_plus_60mo,
        period_end_t_plus_60mo,
        case
            when hpi_t_plus_60mo is null or hpi_t is null or hpi_t = 0 then null
            else (hpi_t_plus_60mo / hpi_t) - 1
        end as forward_return_60mo
    from with_forward
),

demeaned as (
    select
        fips,
        period_end_date,
        hpi_t,
        forward_return_60mo,
        median(forward_return_60mo) over (partition by period_end_date) as national_median_60mo,
        forward_return_60mo
            - median(forward_return_60mo) over (partition by period_end_date)
            as target_hpi_60mo_demeaned
    from with_returns
    where forward_return_60mo is not null
)

select * from demeaned
