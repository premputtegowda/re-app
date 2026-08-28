-- Per-county context metrics for the UI county-detail page.
-- Prefers ACS 1yr (fresher, calendar-year snapshot) when available;
-- falls back to ACS 5yr (rolling window) for counties < 65K population.
--
-- Includes a `acs_source` column so the UI can show "as of 2024 (1yr)"
-- vs "5yr average through 2024" per county.
with acs_1yr_latest as (
    select
        fips, period_end_date as acs_period_end_date,
        median_household_income, median_gross_rent, median_home_value,
        rental_vacancy_rate, total_population, county_state_name,
        as_of_date as acs_as_of_date
    from {{ ref('stg_census_acs_1yr') }}
    qualify row_number() over (partition by fips order by as_of_date desc) = 1
),

acs_5yr_latest as (
    select
        fips, period_end_date as acs_period_end_date,
        median_household_income, median_gross_rent, median_home_value,
        rental_vacancy_rate, total_population, county_state_name,
        as_of_date as acs_as_of_date
    from {{ ref('stg_census_acs') }}
    qualify row_number() over (partition by fips order by as_of_date desc) = 1
),

merged as (
    select
        u.fips,
        u.county_name,
        u.state_name,
        u.pop_latest,
        coalesce(a1.median_household_income, a5.median_household_income) as median_household_income,
        coalesce(a1.median_gross_rent, a5.median_gross_rent) as median_gross_rent,
        coalesce(a1.median_home_value, a5.median_home_value) as median_home_value,
        coalesce(a1.rental_vacancy_rate, a5.rental_vacancy_rate) as rental_vacancy_rate,
        coalesce(a1.acs_period_end_date, a5.acs_period_end_date) as acs_period_end_date,
        case
            when a1.fips is not null then '1yr'
            when a5.fips is not null then '5yr'
            else 'none'
        end as acs_source
    from {{ ref('int_universe') }} u
    left join acs_1yr_latest a1 using (fips)
    left join acs_5yr_latest a5 using (fips)
)

select
    fips,
    county_name,
    state_name,
    pop_latest,
    median_household_income,
    median_gross_rent,
    median_home_value,
    rental_vacancy_rate,
    acs_period_end_date,
    acs_source,
    case
        when median_gross_rent is null or median_home_value is null
             or median_home_value = 0 then null
        else (median_gross_rent * 12.0) / median_home_value
    end as cap_rate_proxy,
    case
        when median_gross_rent is null or median_household_income is null
             or median_household_income = 0 then null
        else (median_gross_rent * 12.0) / median_household_income
    end as rent_to_income_ratio
from merged
