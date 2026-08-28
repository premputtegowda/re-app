-- Framework disqualifiers per DECISIONS.md — "any one kills a county".
--
-- Three feasible with our current sources; two more deferred:
--
--   IMPLEMENTED
--   1. `disq_aging_trap` — positive net migration BUT total population
--      shrinking. Signals deaths outpacing births + migration = aging
--      demographic base. Looks like demand from migration alone but
--      the county is actually eroding.
--   2. `disq_sector_concentration` — any single NAICS supersector holds
--      >25% of county employment. Single-employer/sector risk (one
--      plant closure = local depression).
--   3. `disq_price_ran_25pct` — HPI up >25% over trailing 24 months.
--      "You missed it" — asset already repriced above your entry point.
--
--   DEFERRED (no data source in Phase 1)
--   - Insurance costs rising sharply (coastal FL, wildfire CA, Gulf) —
--     no ingested source
--   - Municipal fiscal distress / pension underfunding — no source
--
-- One row per (fips, period_end_date). Downstream scorer treats
-- `any_disqualifier` = true as an automatic score-zero.
with pep_latest as (
    select
        fips,
        period_end_date,
        popestimate,
        npopchg,
        naturalchg,
        netmig,
        domesticmig
    from {{ ref('stg_census_pep') }}
    qualify row_number() over (partition by fips, period_end_date order by as_of_date desc) = 1
),

aging_trap as (
    -- Aging trap = positive net migration BUT population shrinking.
    -- If natural change is so negative that migration can't offset it,
    -- the county is dying demographically even though it "looks" like
    -- there's inflow demand.
    select
        fips,
        period_end_date,
        popestimate,
        netmig,
        naturalchg,
        npopchg,
        (netmig > 0 and npopchg < 0) as disq_aging_trap
    from pep_latest
),

qcew_totals as (
    -- County total employment (agglvl 70).
    select
        fips,
        period_end_date,
        annual_avg_emplvl as total_emp
    from {{ ref('stg_bls_qcew') }}
    where agglvl_code = 70
    qualify row_number() over (partition by fips, period_end_date order by as_of_date desc) = 1
),

qcew_max_sector as (
    -- Largest supersector share per county-year. agglvl=74 own=5
    -- (private supersectors). We compute max share vs county total.
    -- Excludes industry_code '10' (which is "all industries", not a
    -- supersector) to avoid the trivial 100% case.
    select
        s.fips,
        s.period_end_date,
        t.total_emp,
        max(s.annual_avg_emplvl * 1.0 / nullif(t.total_emp, 0)) as max_supersector_share
    from {{ ref('stg_bls_qcew') }} s
    inner join qcew_totals t using (fips, period_end_date)
    where s.agglvl_code = 74
      and s.own_code = 5
      and s.industry_code != '10'
    group by s.fips, s.period_end_date, s.as_of_date, t.total_emp
    qualify row_number() over (partition by s.fips, s.period_end_date order by s.as_of_date desc) = 1
),

sector_conc as (
    select
        fips,
        period_end_date,
        max_supersector_share,
        (max_supersector_share > 0.25) as disq_sector_concentration
    from qcew_max_sector
),

hpi_latest as (
    select
        fips,
        period_end_date,
        hpi
    from {{ ref('stg_fhfa_hpi') }}
    qualify row_number() over (partition by fips, period_end_date order by as_of_date desc) = 1
),

hpi_24mo_change as (
    -- Trailing 24-month HPI change (date-based join, same lesson).
    -- Manhattan-style gaps produce NULL, not fake +80%.
    select
        h_now.fips,
        h_now.period_end_date,
        h_now.hpi,
        h_prev.hpi as hpi_24mo_ago,
        case
            when h_prev.hpi is null or h_prev.hpi = 0 then null
            else (h_now.hpi / h_prev.hpi) - 1
        end as hpi_trailing_24mo,
        case
            when h_prev.hpi is null or h_prev.hpi = 0 then null
            else ((h_now.hpi / h_prev.hpi) - 1) > 0.25
        end as disq_price_ran_25pct
    from hpi_latest h_now
    left join hpi_latest h_prev
        on h_prev.fips = h_now.fips
        and h_prev.period_end_date = h_now.period_end_date - interval '2 years'
),

-- Full-outer-join style union — each source has different periods
-- (PEP is July 1, QCEW/HPI are Dec 31). We need the disq flags per
-- Dec 31 for alignment with the annual scorer. So: pick the closest
-- prior PEP row for each Dec 31 (which is the same-year July 1).
--
-- Simpler approach: emit one row per (fips, Dec 31 year_end) — pull
-- the same-year PEP by year(period_end_date). Small approximation
-- (July-to-Dec drift) but consistent.
annual_dec_periods as (
    select distinct
        fips,
        period_end_date
    from hpi_latest
),

joined as (
    select
        a.fips,
        a.period_end_date,
        -- Aging trap uses same-year PEP (period_end = July 1).
        ag.disq_aging_trap,
        -- Sector concentration uses same-Dec-31 QCEW.
        sc.max_supersector_share,
        sc.disq_sector_concentration,
        -- Price ran uses same-Dec-31 HPI.
        pr.hpi_trailing_24mo,
        pr.disq_price_ran_25pct
    from annual_dec_periods a
    left join aging_trap ag
        on ag.fips = a.fips
        and year(ag.period_end_date) = year(a.period_end_date)
    left join sector_conc sc
        on sc.fips = a.fips and sc.period_end_date = a.period_end_date
    left join hpi_24mo_change pr
        on pr.fips = a.fips and pr.period_end_date = a.period_end_date
)

select
    j.fips,
    j.period_end_date,
    j.disq_aging_trap,
    j.max_supersector_share,
    j.disq_sector_concentration,
    j.hpi_trailing_24mo,
    j.disq_price_ran_25pct,
    -- Convenience: true if ANY implemented disqualifier fires.
    -- NULL propagation is intentional — a county with missing signals
    -- shouldn't be silently marked "safe".
    coalesce(j.disq_aging_trap, false)
        or coalesce(j.disq_sector_concentration, false)
        or coalesce(j.disq_price_ran_25pct, false)
        as any_disqualifier
from joined j
inner join {{ ref('int_universe') }} u on u.fips = j.fips
