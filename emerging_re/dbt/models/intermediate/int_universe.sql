-- The screener's target universe: counties meeting all three inclusion rules
-- from DECISIONS.md §5.
--
--   1. Population >= 50,000 (latest PEP reading)
--   2. Has FHFA HPI history (at least one row)
--   3. Has Zillow ZORI history (at least one row)
--
-- Dual-target framework needs both HPI and ZORI, so we intersect strictly
-- rather than accept counties with only one target. Expected size after
-- intersection: ~500-600 counties (vs ~1,010 for pop>=50k alone).
--
-- One row per fips. Columns describe the county's coverage across sources
-- so downstream feature models can filter (e.g. skip counties with no
-- pre-2022 BPS data when computing 10yr rolling permit metrics).
with latest_pep as (
    select
        fips,
        state_name,
        county_name,
        popestimate as pop_latest,
        period_end_date as pop_period_end
    from {{ ref('stg_census_pep') }}
    qualify row_number() over (partition by fips order by period_end_date desc, as_of_date desc) = 1
),

hpi_coverage as (
    select
        fips,
        min(period_end_date) as first_hpi_period,
        max(period_end_date) as last_hpi_period,
        count(*) as hpi_row_count
    from {{ ref('stg_fhfa_hpi') }}
    group by fips
),

zori_coverage as (
    select
        fips,
        min(period_end_date) as first_zori_period,
        max(period_end_date) as last_zori_period,
        count(*) as zori_row_count
    from {{ ref('stg_zillow_zori') }}
    group by fips
),

bps_coverage as (
    -- Split into pre-2022 vs 2022+ to preserve the BPS coverage-cliff
    -- distinction from DECISIONS.md §3.
    select
        fips,
        count(*) filter (where period_end_date < date '2022-01-01') as bps_pre2022_years,
        count(*) filter (where period_end_date >= date '2022-01-01') as bps_2022plus_years
    from {{ ref('stg_census_bps') }}
    group by fips
),

qcew_coverage as (
    -- Just check for county-total (agglvl=70) presence.
    select
        fips,
        count(*) filter (where agglvl_code = 70) as qcew_total_years
    from {{ ref('stg_bls_qcew') }}
    group by fips
)

select
    p.fips,
    p.state_name,
    p.county_name,
    p.pop_latest,
    p.pop_period_end,
    h.first_hpi_period,
    h.last_hpi_period,
    h.hpi_row_count,
    z.first_zori_period,
    z.last_zori_period,
    z.zori_row_count,
    coalesce(b.bps_pre2022_years, 0) as bps_pre2022_years,
    coalesce(b.bps_2022plus_years, 0) as bps_2022plus_years,
    coalesce(q.qcew_total_years, 0) as qcew_total_years
from latest_pep p
inner join hpi_coverage h using (fips)     -- must have HPI
inner join zori_coverage z using (fips)    -- must have ZORI
left join bps_coverage b using (fips)      -- optional (may be gap)
left join qcew_coverage q using (fips)     -- optional
where p.pop_latest >= 50000
