-- FRED national macro time series (long format).
-- Not fips-keyed — this is national data (single time series per series_id).
select
    observation_date,
    series_id,
    value,
    as_of_date
from {{ source('curated', 'fred_macro') }}
