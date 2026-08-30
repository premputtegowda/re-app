-- IRS SOI county migration flows — annual, tax-return based.
-- One row per (fips, tax_year) with inflow + outflow tallies.
select
    fips,
    period_end_date,
    inflow_returns,
    inflow_exemptions,
    inflow_agi_thousands,
    inflow_agi_per_return,
    outflow_returns,
    outflow_exemptions,
    outflow_agi_thousands,
    outflow_agi_per_return,
    net_migration_returns,
    net_agi_thousands,
    as_of_date
from {{ source('curated', 'irs_soi_migration') }}
