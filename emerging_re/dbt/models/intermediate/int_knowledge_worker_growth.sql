-- Knowledge-worker employment growth — QCEW-derived.
--
-- Complements v11-A renter-industry-emp (Leisure+Retail = LOW-wage
-- renters). This model captures HIGH-wage renters — tech, professional
-- services, consulting. These workers cluster in urban cores and rent
-- luxury apartments before moving to owner-occupied homes.
--
-- NAICS 51 = Information (tech, telecom, media, software)
-- NAICS 54 = Professional/Scientific/Technical Services (consulting, legal,
--            accounting, R&D, design)
--
-- Combined ("Knowledge worker") = well-paid renters who move into a
-- market before buying. Growth here predicts high-end rent + eventually
-- home value.
--
-- Features:
--   1. `knowledge_emp_yoy` — combined YoY growth
--   2. `knowledge_emp_cagr_3yr` — 3yr CAGR
--   3. `knowledge_emp_growth_vs_state_pp` — state-demeaned YoY
--
-- Sign for composite: all naturally +1.
with knowledge_industries as (
    select
        fips,
        period_end_date,
        industry_code,
        annual_avg_emplvl
    from {{ ref('stg_bls_qcew') }}
    where industry_code in ('51', '54')
      and agglvl_code = 74
      and annual_avg_emplvl is not null and annual_avg_emplvl > 0
    qualify row_number() over (
        partition by fips, period_end_date, industry_code
        order by as_of_date desc
    ) = 1
),

combined as (
    select
        fips,
        period_end_date,
        sum(annual_avg_emplvl) as knowledge_emp,
        count(distinct industry_code) as industries_reporting
    from knowledge_industries
    group by fips, period_end_date
),

with_lags as (
    select
        c_now.fips,
        c_now.period_end_date,
        substr(c_now.fips, 1, 2) as state_fips,
        c_now.knowledge_emp,
        c_1.knowledge_emp as emp_t_minus_1,
        c_3.knowledge_emp as emp_t_minus_3
    from combined c_now
    left join combined c_1
        on c_1.fips = c_now.fips
        and c_1.period_end_date = c_now.period_end_date - interval '1 year'
        and c_1.industries_reporting = 2
    left join combined c_3
        on c_3.fips = c_now.fips
        and c_3.period_end_date = c_now.period_end_date - interval '3 years'
        and c_3.industries_reporting = 2
    where c_now.industries_reporting = 2
),

with_growth as (
    select
        *,
        knowledge_emp / nullif(emp_t_minus_1, 0) - 1 as knowledge_emp_yoy,
        power(knowledge_emp / nullif(emp_t_minus_3, 0), 1.0/3) - 1 as knowledge_emp_cagr_3yr
    from with_lags
),

state_avg as (
    select
        state_fips,
        period_end_date,
        sum(knowledge_emp_yoy * knowledge_emp) / nullif(sum(knowledge_emp), 0)
            as state_knowledge_emp_yoy
    from with_growth
    where knowledge_emp_yoy is not null
    group by state_fips, period_end_date
)

select
    g.fips,
    g.period_end_date,
    g.knowledge_emp,
    g.knowledge_emp_yoy,
    g.knowledge_emp_cagr_3yr,
    g.knowledge_emp_yoy - s.state_knowledge_emp_yoy as knowledge_emp_growth_vs_state_pp
from with_growth g
left join state_avg s
    on s.state_fips = g.state_fips and s.period_end_date = g.period_end_date
inner join {{ ref('int_universe') }} u on u.fips = g.fips
