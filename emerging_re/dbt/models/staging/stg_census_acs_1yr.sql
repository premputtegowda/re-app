-- Census ACS 1-year county estimates — fresh calendar-year snapshots.
-- Available for ~861 counties (pop >= 65,000). Not a rolling window,
-- so period_end_date corresponds to a specific calendar year.
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
from {{ source('curated', 'census_acs_1yr') }}
