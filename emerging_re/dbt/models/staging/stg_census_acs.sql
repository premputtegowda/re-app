-- Census ACS 5-year county estimates.
-- Level metrics for UI: median income, median rent ($), median home value,
-- vacancy rate. NOT in composite scoring (v4 experiment showed adjacent
-- rate-based features don't improve Spearman); consumed by the county-
-- detail page for concrete $-denominated context alongside the composite
-- rank.
select
    fips,
    period_end_date,
    median_household_income,
    median_gross_rent,
    median_home_value,
    renter_occupied_units,
    vacant_for_rent_units,
    rental_vacancy_rate,
    total_population,
    county_state_name,
    as_of_date
from {{ source('curated', 'census_acs') }}
