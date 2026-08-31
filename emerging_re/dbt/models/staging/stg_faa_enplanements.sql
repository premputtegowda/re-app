-- FAA airport enplanements aggregated to county — annual (Dec 31 period_end).
-- Multiple vintages loaded (CY2019-CY2025); models select latest per
-- (fips, period_end_date) at use time via qualify.
select
    fips,
    period_end_date,
    total_enplanements,
    num_airports,
    largest_hub_tier,
    as_of_date
from {{ source('curated', 'faa_enplanements') }}
