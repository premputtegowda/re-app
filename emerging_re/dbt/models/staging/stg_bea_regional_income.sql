-- BEA CAINC1 personal income summary — county-level, annual.
-- Multiple vintages loaded (2019-2024); models select the latest per
-- (fips, period_end_date) at use time via qualify.
select
    fips,
    period_end_date,
    personal_income_thousands,
    bea_population,
    per_capita_income,
    county_state_name,
    as_of_date
from {{ source('curated', 'bea_regional_income') }}
