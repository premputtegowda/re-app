-- Trailing price + rent appreciation per fips (latest data).
-- Emits 24-month and 36-month backward-looking HPI change and ZORI change.
-- Consumed by mart_mf_scored (and future SFR analog) to show recent
-- market trajectory alongside the composite ranking.
--
-- HPI is annual (Dec 31). ZORI is monthly; we use Dec-to-Dec comparisons
-- to keep parallel with HPI.
with hpi_latest as (
    select
        fips,
        period_end_date,
        hpi,
        row_number() over (partition by fips order by period_end_date desc) as recency_rank
    from {{ ref('stg_fhfa_hpi') }}
    qualify row_number() over (partition by fips, period_end_date order by as_of_date desc) = 1
),

hpi_pivoted as (
    -- Get each fips's HPI at t, t-1yr, t-2yrs, t-3yrs (using latest period as t).
    select
        h_now.fips,
        h_now.period_end_date as latest_period,
        h_now.hpi as hpi_now,
        h_1.hpi as hpi_1yr_ago,
        h_2.hpi as hpi_2yr_ago,
        h_3.hpi as hpi_3yr_ago
    from hpi_latest h_now
    left join hpi_latest h_1
        on h_1.fips = h_now.fips
        and h_1.period_end_date = h_now.period_end_date - interval '1 year'
    left join hpi_latest h_2
        on h_2.fips = h_now.fips
        and h_2.period_end_date = h_now.period_end_date - interval '2 years'
    left join hpi_latest h_3
        on h_3.fips = h_now.fips
        and h_3.period_end_date = h_now.period_end_date - interval '3 years'
    where h_now.recency_rank = 1
),

zori_annual as (
    -- Dec-only ZORI rows to match HPI annual cadence.
    select
        fips,
        period_end_date,
        zori
    from {{ ref('stg_zillow_zori') }}
    where extract(month from period_end_date) = 12
    qualify row_number() over (partition by fips, period_end_date order by as_of_date desc) = 1
),

zori_pivoted as (
    select
        z_now.fips,
        z_now.period_end_date as latest_zori_period,
        z_now.zori as zori_now,
        z_1.zori as zori_1yr_ago,
        z_2.zori as zori_2yr_ago,
        z_3.zori as zori_3yr_ago
    from zori_annual z_now
    left join zori_annual z_1
        on z_1.fips = z_now.fips
        and z_1.period_end_date = z_now.period_end_date - interval '1 year'
    left join zori_annual z_2
        on z_2.fips = z_now.fips
        and z_2.period_end_date = z_now.period_end_date - interval '2 years'
    left join zori_annual z_3
        on z_3.fips = z_now.fips
        and z_3.period_end_date = z_now.period_end_date - interval '3 years'
    qualify row_number() over (partition by z_now.fips order by z_now.period_end_date desc) = 1
)

select
    coalesce(h.fips, z.fips) as fips,
    h.latest_period as hpi_latest_period,
    z.latest_zori_period,
    -- Trailing HPI (price appreciation): YoY (12mo), 24mo, 36mo
    case
        when h.hpi_now is null or h.hpi_1yr_ago is null or h.hpi_1yr_ago = 0 then null
        else (h.hpi_now / h.hpi_1yr_ago) - 1
    end as hpi_trailing_12mo,
    case
        when h.hpi_now is null or h.hpi_2yr_ago is null or h.hpi_2yr_ago = 0 then null
        else (h.hpi_now / h.hpi_2yr_ago) - 1
    end as hpi_trailing_24mo,
    case
        when h.hpi_now is null or h.hpi_3yr_ago is null or h.hpi_3yr_ago = 0 then null
        else (h.hpi_now / h.hpi_3yr_ago) - 1
    end as hpi_trailing_36mo,
    -- Trailing ZORI (rent appreciation): YoY (12mo), 24mo, 36mo
    case
        when z.zori_now is null or z.zori_1yr_ago is null or z.zori_1yr_ago = 0 then null
        else (z.zori_now / z.zori_1yr_ago) - 1
    end as zori_trailing_12mo,
    case
        when z.zori_now is null or z.zori_2yr_ago is null or z.zori_2yr_ago = 0 then null
        else (z.zori_now / z.zori_2yr_ago) - 1
    end as zori_trailing_24mo,
    case
        when z.zori_now is null or z.zori_3yr_ago is null or z.zori_3yr_ago = 0 then null
        else (z.zori_now / z.zori_3yr_ago) - 1
    end as zori_trailing_36mo
from hpi_pivoted h
full outer join zori_pivoted z using (fips)
