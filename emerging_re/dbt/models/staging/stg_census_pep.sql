-- Census PEP annual county population + migration components.
-- Two vintages currently loaded: V2019 (2010-2019) and V2025 (2020-2025).
-- We keep both — downstream can compute latest-known via qualify.
select
    fips,
    period_end_date,
    popestimate,
    npopchg,
    births,
    deaths,
    naturalchg,
    internationalmig,
    domesticmig,
    netmig,
    state_name,
    county_name,
    as_of_date
from {{ source('curated', 'census_pep') }}
