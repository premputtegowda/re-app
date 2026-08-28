-- Census BFS annual county Business Applications.
select
    fips,
    period_end_date,
    business_applications,
    state,
    county_name,
    as_of_date
from {{ source('curated', 'census_bfs') }}
