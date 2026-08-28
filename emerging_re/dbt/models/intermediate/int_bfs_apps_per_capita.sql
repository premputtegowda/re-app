-- Business applications per capita (Tier 1 demand leading indicator).
--
-- BFS is annual, Dec-31 period. Joined to PEP July-1 by year for the
-- per-capita normalization (same drift approximation used elsewhere).
--
-- Emits `business_apps_per_1000` (current) + a 3-year rolling avg to
-- smooth the noisy year-over-year signal.
with bfs as (
    select
        fips,
        period_end_date,
        business_applications
    from {{ ref('stg_census_bfs') }}
    qualify row_number() over (partition by fips, period_end_date order by as_of_date desc) = 1
),

pep as (
    select
        fips,
        year(period_end_date) as year,
        popestimate
    from {{ ref('stg_census_pep') }}
    qualify row_number() over (partition by fips, period_end_date order by as_of_date desc) = 1
),

with_pop as (
    select
        b.fips,
        b.period_end_date,
        b.business_applications,
        p.popestimate,
        case
            when p.popestimate is null or p.popestimate = 0 then null
            else 1000.0 * b.business_applications / p.popestimate
        end as business_apps_per_1000
    from bfs b
    left join pep p
        on p.fips = b.fips
        and p.year = year(b.period_end_date)
),

with_smoothed as (
    -- 3-year rolling avg (t-2, t-1, t) — dampens the BFS year-over-year
    -- noise. Date-based join respects any gaps.
    select
        w_now.fips,
        w_now.period_end_date,
        w_now.business_applications,
        w_now.popestimate,
        w_now.business_apps_per_1000,
        (
            select avg(x) from unnest([
                w_now.business_apps_per_1000,
                (select business_apps_per_1000 from with_pop w where w.fips = w_now.fips and w.period_end_date = w_now.period_end_date - interval '1 year'),
                (select business_apps_per_1000 from with_pop w where w.fips = w_now.fips and w.period_end_date = w_now.period_end_date - interval '2 years')
            ]) t(x)
            where x is not null
        ) as business_apps_per_1000_3yr_avg
    from with_pop w_now
)

select
    s.fips,
    s.period_end_date,
    s.business_applications,
    s.business_apps_per_1000,
    s.business_apps_per_1000_3yr_avg
from with_smoothed s
inner join {{ ref('int_universe') }} u using (fips)
