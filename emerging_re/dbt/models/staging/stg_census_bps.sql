-- Census BPS annual county building permits.
-- Note: pre-2022 coverage is ~45% of pop>=50k universe (see DECISIONS.md §3).
select
    fips,
    period_end_date,
    units_1,
    units_2,
    units_34,
    units_5plus,
    units_total,
    bldgs_total,
    value_total,
    county_name,
    as_of_date
from {{ source('curated', 'census_bps') }}
