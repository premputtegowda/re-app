-- BLS LAUS county-level monthly unemployment rate — full history.
-- Downstream int_unemployment_features computes YoY change per period.
select
    fips,
    period_end_date,
    unemployment_rate,
    as_of_date
from {{ source('curated', 'bls_laus') }}
