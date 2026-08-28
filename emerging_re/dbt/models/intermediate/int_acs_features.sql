-- ACS-derived features for the composite + UI context.
--
-- Prefers ACS 1-year data when available (~832 of 978 universe counties,
-- pop >= 65,000) because it's a calendar-year snapshot rather than a
-- 5-year rolling average. Falls back to ACS 5-year data for smaller
-- counties so the framework still scores them.
--
-- Emits three level metrics per (fips, period_end_date):
--   1. `rental_vacancy_rate` — direct market-tightness proxy
--   2. `rent_to_income_ratio` — affordability level
--   3. `cap_rate_proxy` — annual rent / median home value (yield signal)
--
-- Also emits `acs_source` = '1yr' or '5yr' for provenance / UI display.
with acs_1yr as (
    -- Latest 1yr vintage per fips (~861 US counties nationwide).
    select
        fips,
        period_end_date,
        median_household_income,
        median_gross_rent,
        median_home_value,
        rental_vacancy_rate,
        as_of_date
    from {{ ref('stg_census_acs_1yr') }}
    qualify row_number() over (partition by fips order by period_end_date desc, as_of_date desc) = 1
),

acs_5yr as (
    -- Latest 5yr vintage per fips (~3,222 US counties nationwide, wide coverage).
    select
        fips,
        period_end_date,
        median_household_income,
        median_gross_rent,
        median_home_value,
        rental_vacancy_rate,
        as_of_date
    from {{ ref('stg_census_acs') }}
    qualify row_number() over (partition by fips order by period_end_date desc, as_of_date desc) = 1
),

preferred as (
    -- Coalesce: use 1yr values when present, else fall back to 5yr.
    -- Track the source ('1yr' | '5yr' | 'none') for downstream display.
    select
        u.fips,
        coalesce(a1.period_end_date, a5.period_end_date) as period_end_date,
        coalesce(a1.median_household_income, a5.median_household_income) as median_household_income,
        coalesce(a1.median_gross_rent, a5.median_gross_rent) as median_gross_rent,
        coalesce(a1.median_home_value, a5.median_home_value) as median_home_value,
        coalesce(a1.rental_vacancy_rate, a5.rental_vacancy_rate) as rental_vacancy_rate,
        case
            when a1.fips is not null then '1yr'
            when a5.fips is not null then '5yr'
            else 'none'
        end as acs_source
    from {{ ref('int_universe') }} u
    left join acs_1yr a1 using (fips)
    left join acs_5yr a5 using (fips)
)

select
    fips,
    period_end_date,
    rental_vacancy_rate,
    case
        when median_gross_rent is null or median_household_income is null
             or median_household_income = 0 then null
        else (median_gross_rent * 12.0) / median_household_income
    end as rent_to_income_ratio,
    case
        when median_gross_rent is null or median_home_value is null
             or median_home_value = 0 then null
        else (median_gross_rent * 12.0) / median_home_value
    end as cap_rate_proxy,
    acs_source
from preferred
