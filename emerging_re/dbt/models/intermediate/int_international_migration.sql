-- Tier 1 demand signal: international migration rate.
--
-- Framework rationale: international migration captures a demand vector
-- that is distinct from domestic migration. Some markets (tech coastal
-- metros, gateway cities) grow primarily via international inflows even
-- when domestic net-out. Adding this alongside domestic gives the
-- composite two orthogonal migration signals.
--
-- One feature per (fips, period_end_date):
--   `internationalmig_per_1000` — net international migration for the
--     year ending July 1, per 1,000 residents.
with pep as (
    select
        fips,
        period_end_date,
        popestimate,
        internationalmig
    from {{ ref('stg_census_pep') }}
    qualify row_number() over (partition by fips, period_end_date order by as_of_date desc) = 1
)

select
    p.fips,
    p.period_end_date,
    p.popestimate,
    p.internationalmig,
    case
        when p.popestimate is null or p.popestimate = 0 then null
        else 1000.0 * p.internationalmig / p.popestimate
    end as internationalmig_per_1000
from pep p
inner join {{ ref('int_universe') }} u using (fips)
