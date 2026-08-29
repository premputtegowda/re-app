-- Multi-family (10-20 unit) investor-oriented features.
--
-- Three MF-relevant signals per (fips, period_end_date):
--   1. `renter_share` — renter-occupied / (renter + owner). High share =
--      MF-friendly market (professional PMs, deep tenant pool, mature
--      rental culture). Sign in scoring: +1.
--   2. `mf_permit_ratio` — 5+ unit permits / total permits (trailing 3yr
--      to smooth annual noise). High = market's new supply is skewing
--      MF (developers see MF demand). Sign in scoring: +1.
--   3. `rental_vacancy_change_3yr` — current vacancy − vacancy 3 years
--      ago. Negative = tightening market (landlord pricing power).
--      Sign in scoring: -1.
--
-- ACS-derived features prefer 1yr data (~832 counties); fall back to 5yr
-- for the smaller 146 counties. Vacancy trend needs 1yr history so it's
-- NULL for 5yr-only counties.
with acs_1yr_latest as (
    -- Latest 1yr vintage per fips.
    select
        fips, period_end_date,
        owner_occupied_units, renter_occupied_units, rental_vacancy_rate
    from {{ ref('stg_census_acs_1yr') }}
    qualify row_number() over (partition by fips order by period_end_date desc, as_of_date desc) = 1
),

acs_1yr_3yr_ago as (
    -- ACS 1yr vintage 3 years before the LATEST. For "latest = 2024",
    -- 3-year lookback is 2021 (since 2020 vintage is missing).
    -- Match: latest.period_end_date − 3 years = target period.
    select
        a.fips,
        a.period_end_date,
        a.rental_vacancy_rate as vacancy_3yr_ago
    from {{ ref('stg_census_acs_1yr') }} a
    inner join acs_1yr_latest curr
        on curr.fips = a.fips
        and a.period_end_date = curr.period_end_date - interval '3 years'
    qualify row_number() over (partition by a.fips order by a.as_of_date desc) = 1
),

acs_5yr_latest as (
    -- Fallback for counties < 65K pop that don't have 1yr data.
    select
        fips, period_end_date,
        owner_occupied_units, renter_occupied_units, rental_vacancy_rate
    from {{ ref('stg_census_acs') }}
    qualify row_number() over (partition by fips order by period_end_date desc, as_of_date desc) = 1
),

acs_preferred as (
    -- Prefer 1yr; fall back to 5yr per fips.
    select
        u.fips,
        coalesce(a1.owner_occupied_units, a5.owner_occupied_units) as owner_occupied_units,
        coalesce(a1.renter_occupied_units, a5.renter_occupied_units) as renter_occupied_units,
        coalesce(a1.rental_vacancy_rate, a5.rental_vacancy_rate) as rental_vacancy_rate,
        -- vacancy_3yr_ago only from 1yr (5yr comparison is too smoothed
        -- to be meaningful for a 3yr trend)
        a13.vacancy_3yr_ago
    from {{ ref('int_universe') }} u
    left join acs_1yr_latest a1 using (fips)
    left join acs_5yr_latest a5 using (fips)
    left join acs_1yr_3yr_ago a13 using (fips)
),

bps_recent as (
    -- Trailing 3-year MF permit share (units_5plus / total units) to
    -- smooth annual noise. Uses full-year Dec-end rows only.
    select
        fips,
        sum(units_5plus) as mf_units_3yr,
        sum(units_total) as total_units_3yr
    from {{ ref('stg_census_bps') }}
    where period_end_date in (date '2023-12-31', date '2024-12-31', date '2025-12-31')
    group by fips
)

select
    a.fips,
    -- Renter share of occupied households.
    case
        when a.owner_occupied_units is null or a.renter_occupied_units is null then null
        when (a.owner_occupied_units + a.renter_occupied_units) = 0 then null
        else 1.0 * a.renter_occupied_units
             / (a.owner_occupied_units + a.renter_occupied_units)
    end as renter_share,
    -- MF permit ratio (3yr rolling).
    case
        when b.total_units_3yr is null or b.total_units_3yr = 0 then null
        else 1.0 * b.mf_units_3yr / b.total_units_3yr
    end as mf_permit_ratio,
    -- Rental vacancy trend: negative = tightening, positive = loosening.
    case
        when a.rental_vacancy_rate is null or a.vacancy_3yr_ago is null then null
        else a.rental_vacancy_rate - a.vacancy_3yr_ago
    end as rental_vacancy_change_3yr,
    -- Also expose the current vacancy level (for filtering + UI).
    a.rental_vacancy_rate,
    a.vacancy_3yr_ago
from acs_preferred a
left join bps_recent b using (fips)
