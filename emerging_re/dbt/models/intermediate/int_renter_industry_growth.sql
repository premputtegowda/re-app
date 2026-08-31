-- Renter-heavy industry employment growth — QCEW-derived.
--
-- Hypothesis: rent appreciation is driven by demand from workers who
-- actually rent. The Bureau of Labor Statistics QCEW tracks employment
-- by NAICS supersector. Three supersectors dominate the "renter worker"
-- population:
--   NAICS 71 — Arts, Entertainment, Recreation
--   NAICS 72 — Accommodation and Food Services
--   NAICS 44-45 — Retail Trade
--
-- Combined ("Leisure + Retail") = the marginal renter-household producer.
-- These workers earn below-median wages and are dominated by renters
-- (Census SIPP data: ~65% renter vs 45% for all workers). Growth in
-- this employment class → new renter households → rent demand.
--
-- Note: existing composite already has all_industry emp_growth_yoy.
-- This feature isolates the RENTER SUBSET which theoretically should
-- better predict rent (vs. all-industry which better predicts prices).
--
-- Features (candidates for composite scoring):
--   1. `renter_ind_emp_yoy` — combined YoY growth
--   2. `renter_ind_emp_cagr_3yr` — smoothed 3yr CAGR
--   3. `renter_ind_emp_growth_vs_state_pp` — state-demeaned YoY
--
-- Sign for composite: all naturally +1.
--
-- Vintage handling: latest per (fips, period_end_date, industry_code).
with renter_industries as (
    select
        fips,
        period_end_date,
        industry_code,
        annual_avg_emplvl
    from {{ ref('stg_bls_qcew') }}
    where industry_code in ('71', '72', '44-45')
      and agglvl_code = 74
      and annual_avg_emplvl is not null
      and annual_avg_emplvl > 0
    qualify row_number() over (
        partition by fips, period_end_date, industry_code
        order by as_of_date desc
    ) = 1
),

combined as (
    -- Sum across the 3 supersectors per (fips, period).
    select
        fips,
        period_end_date,
        sum(annual_avg_emplvl) as renter_ind_emp,
        count(distinct industry_code) as industries_reporting
    from renter_industries
    group by fips, period_end_date
),

-- Only keep counties with all 3 supersectors reporting (else the "sum"
-- undercounts and creates spurious growth signal on year-to-year
-- coverage changes).
with_lags as (
    select
        c_now.fips,
        c_now.period_end_date,
        substr(c_now.fips, 1, 2) as state_fips,
        c_now.renter_ind_emp,
        c_1.renter_ind_emp as emp_t_minus_1,
        c_3.renter_ind_emp as emp_t_minus_3
    from combined c_now
    left join combined c_1
        on c_1.fips = c_now.fips
        and c_1.period_end_date = c_now.period_end_date - interval '1 year'
        and c_1.industries_reporting = 3
    left join combined c_3
        on c_3.fips = c_now.fips
        and c_3.period_end_date = c_now.period_end_date - interval '3 years'
        and c_3.industries_reporting = 3
    where c_now.industries_reporting = 3
),

with_growth as (
    select
        *,
        renter_ind_emp / nullif(emp_t_minus_1, 0) - 1 as renter_ind_emp_yoy,
        power(renter_ind_emp / nullif(emp_t_minus_3, 0), 1.0/3) - 1 as renter_ind_emp_cagr_3yr
    from with_lags
),

state_avg as (
    -- Weighted by county emp so tiny counties don't drag state avg.
    select
        state_fips,
        period_end_date,
        sum(renter_ind_emp_yoy * renter_ind_emp) / nullif(sum(renter_ind_emp), 0)
            as state_renter_ind_emp_yoy
    from with_growth
    where renter_ind_emp_yoy is not null
    group by state_fips, period_end_date
)

select
    g.fips,
    g.period_end_date,
    g.renter_ind_emp,
    g.renter_ind_emp_yoy,
    g.renter_ind_emp_cagr_3yr,
    g.renter_ind_emp_yoy - s.state_renter_ind_emp_yoy as renter_ind_emp_growth_vs_state_pp
from with_growth g
left join state_avg s
    on s.state_fips = g.state_fips and s.period_end_date = g.period_end_date
inner join {{ ref('int_universe') }} u on u.fips = g.fips
