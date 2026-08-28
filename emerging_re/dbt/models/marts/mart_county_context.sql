-- Per-county context metrics for the UI's county-detail page. Latest
-- ACS vintage only (that's what users see as "current"). Historical
-- vintages remain queryable via stg_census_acs for time-series charts.
--
-- Adds derived metrics for investor decision-making:
--   * cap_rate_proxy — (median gross rent × 12) / median home value.
--     Not a true cap rate (no OpEx, no vacancy, no financing), but a
--     usable relative-yield indicator across counties.
--   * rent_to_income_ratio — 12 months of median rent / median household
--     income. Framework thresholds: <25% = affordable, >35% = stretched.
--
-- Joined to int_universe so we only surface counties in scope. Downstream
-- API filters further if the user wants a smaller universe.
with acs_latest as (
    select
        fips,
        median_household_income,
        median_gross_rent,
        median_home_value,
        rental_vacancy_rate,
        total_population,
        county_state_name,
        period_end_date as acs_period_end_date,
        as_of_date as acs_as_of_date
    from {{ ref('stg_census_acs') }}
    qualify row_number() over (partition by fips order by as_of_date desc) = 1
)

select
    u.fips,
    u.county_name,
    u.state_name,
    u.pop_latest,
    -- ACS level metrics
    a.median_household_income,
    a.median_gross_rent,
    a.median_home_value,
    a.rental_vacancy_rate,
    a.acs_period_end_date,
    -- Derived investor metrics
    case
        when a.median_gross_rent is null or a.median_home_value is null
             or a.median_home_value = 0 then null
        else (a.median_gross_rent * 12.0) / a.median_home_value
    end as cap_rate_proxy,
    case
        when a.median_gross_rent is null or a.median_household_income is null
             or a.median_household_income = 0 then null
        else (a.median_gross_rent * 12.0) / a.median_household_income
    end as rent_to_income_ratio
from {{ ref('int_universe') }} u
left join acs_latest a using (fips)
