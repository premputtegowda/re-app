-- Zillow ZORI monthly rent index — 1:1 view over curated Parquet.
select
    fips,
    period_end_date,
    zori,
    state,
    county_name,
    metro,
    as_of_date
from {{ source('curated', 'zillow_zori') }}
