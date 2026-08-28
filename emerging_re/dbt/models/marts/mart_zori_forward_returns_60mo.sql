-- Target B (60mo/5yr variant): forward 60-month Zillow ZORI change,
-- demeaned cross-sectionally.
with zori as (
    select fips, period_end_date, zori
    from {{ ref('stg_zillow_zori') }}
    qualify row_number() over (partition by fips, period_end_date order by as_of_date desc) = 1
),

with_forward as (
    select
        u.fips,
        z_now.period_end_date,
        z_now.zori as zori_t,
        z_fwd.zori as zori_t_plus_60mo,
        z_fwd.period_end_date as period_end_t_plus_60mo
    from {{ ref('int_universe') }} u
    inner join zori z_now on z_now.fips = u.fips
    left join zori z_fwd
        on z_fwd.fips = u.fips
        and z_fwd.period_end_date = z_now.period_end_date + interval '5 years'
),

with_returns as (
    select
        fips,
        period_end_date,
        zori_t,
        zori_t_plus_60mo,
        period_end_t_plus_60mo,
        case
            when zori_t_plus_60mo is null or zori_t is null or zori_t = 0 then null
            else (zori_t_plus_60mo / zori_t) - 1
        end as forward_return_60mo
    from with_forward
),

demeaned as (
    select
        fips,
        period_end_date,
        zori_t,
        forward_return_60mo,
        median(forward_return_60mo) over (partition by period_end_date) as national_median_60mo,
        forward_return_60mo
            - median(forward_return_60mo) over (partition by period_end_date)
            as target_zori_60mo_demeaned
    from with_returns
    where forward_return_60mo is not null
)

select * from demeaned
