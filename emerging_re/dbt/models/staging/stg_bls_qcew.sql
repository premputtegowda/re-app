-- BLS QCEW annual county employment + wages, keyed by NAICS supersector.
-- Two agglvl values loaded: 70 (county total, own=0) and 74 (private
-- supersector breakdown, own=5). Downstream models pivot as needed.
select
    fips,
    period_end_date,
    agglvl_code,
    own_code,
    industry_code,
    annual_avg_estabs,
    annual_avg_emplvl,
    total_annual_wages,
    annual_avg_wkly_wage,
    avg_annual_pay,
    as_of_date
from {{ source('curated', 'bls_qcew') }}
