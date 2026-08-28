-- Tier 1 demand signal: employment diversity (Herfindahl-Hirschman Index).
--
-- Continuous version of the sector_concentration disqualifier. Computed
-- as sum of squared supersector employment shares per (fips, period).
--
-- Interpretation:
--   HHI = 1        → all employment in one sector (max concentration)
--   HHI = 1/N      → perfectly diverse across N sectors
--   Typical U.S. county: 0.10 to 0.20 (7-10 effective sectors)
--
-- Lower HHI = more diverse = more resilient to sector-specific shocks
-- (a single-employer town collapses when the employer leaves; a diverse
-- economy absorbs).
--
-- Sign in scoring is -1 so lower HHI = higher composite = more attractive.
with qcew_totals as (
    -- County total employment (agglvl 70, own 0).
    select
        fips,
        period_end_date,
        annual_avg_emplvl as total_emp
    from {{ ref('stg_bls_qcew') }}
    where agglvl_code = 70
    qualify row_number() over (partition by fips, period_end_date order by as_of_date desc) = 1
),

supersector_shares as (
    -- Per (fips, period, supersector): share of total county employment.
    -- agglvl=74 with own=5 (private supersector breakdown).
    -- Exclude industry_code '10' (all industries, would double-count) and
    -- '99' (unclassified).
    select
        s.fips,
        s.period_end_date,
        s.industry_code,
        s.annual_avg_emplvl,
        t.total_emp,
        case
            when t.total_emp is null or t.total_emp = 0 then null
            else 1.0 * s.annual_avg_emplvl / t.total_emp
        end as sector_share
    from {{ ref('stg_bls_qcew') }} s
    inner join qcew_totals t using (fips, period_end_date)
    where s.agglvl_code = 74
      and s.own_code = 5
      and s.industry_code not in ('10', '99')
    qualify row_number() over (partition by s.fips, s.period_end_date, s.industry_code order by s.as_of_date desc) = 1
),

hhi as (
    -- Herfindahl: sum of squared shares across all supersectors present
    -- in the county for that period. Null shares are dropped.
    select
        fips,
        period_end_date,
        sum(sector_share * sector_share) as employment_diversity_hhi,
        count(*) as n_supersectors_reporting
    from supersector_shares
    where sector_share is not null
    group by fips, period_end_date
)

select
    h.fips,
    h.period_end_date,
    h.employment_diversity_hhi,
    h.n_supersectors_reporting
from hhi h
inner join {{ ref('int_universe') }} u using (fips)
