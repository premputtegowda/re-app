-- HUD Fair Market Rents — county-level, fiscal-year annual.
-- 2BR is our primary MF rent proxy (typical apartment stock is ~40-50%
-- 2BR). FMR is set at 40th percentile of standard-quality rentals.
select
    fips,
    period_end_date,
    fmr_0br,
    fmr_1br,
    fmr_2br,
    fmr_3br,
    fmr_4br,
    fmr_percentile,
    county_name,
    fmr_area_name,
    as_of_date
from {{ source('curated', 'hud_fmr') }}
