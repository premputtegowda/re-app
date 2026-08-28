-- FHFA HPI county series — 1:1 view over curated Parquet.
-- Reads all vintages; downstream models filter by as_of_date if needed.
select
    fips,
    period_end_date,
    hpi,
    annual_change_pct,
    state,
    county_name,
    as_of_date
from {{ source('curated', 'fhfa_hpi') }}
