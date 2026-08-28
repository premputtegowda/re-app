-- Tier 1 signal: wage growth outpacing national.
--
-- Framework: "Wage growth outpacing national" — counties where wages
-- grow faster than the national average signal expanding demand pockets
-- that historically precede price appreciation.
--
-- Metric: year-over-year change in avg annual pay at agglvl 70 (county
-- total, all ownerships, all industries), cross-sectionally demeaned per
-- period so the raw number is "how much did this county's wage growth
-- beat/lag the median county."
--
-- Emitted per (fips, period):
--   - `avg_annual_pay` — QCEW's headline avg annual pay for the county
--   - `wage_growth_yoy` — (pay_t / pay_t-1) - 1
--   - `wage_growth_yoy_demeaned` — wage_growth_yoy minus median across
--     universe for the same period. Positive = outpacing national median.
with pay as (
    select
        fips,
        period_end_date,
        avg_annual_pay
    from {{ ref('stg_bls_qcew') }}
    where agglvl_code = 70
    qualify row_number() over (partition by fips, period_end_date order by as_of_date desc) = 1
),

with_yoy as (
    select
        p_now.fips,
        p_now.period_end_date,
        p_now.avg_annual_pay,
        p_prev.avg_annual_pay as avg_annual_pay_t_minus_1,
        case
            when p_prev.avg_annual_pay is null or p_prev.avg_annual_pay = 0 then null
            else (p_now.avg_annual_pay / p_prev.avg_annual_pay) - 1
        end as wage_growth_yoy
    from pay p_now
    left join pay p_prev
        on p_prev.fips = p_now.fips
        and p_prev.period_end_date = p_now.period_end_date - interval '1 year'
),

demeaned as (
    -- Cross-sectional demean over universe counties for the same period.
    -- Joining to universe INSIDE the CTE so the median we subtract
    -- reflects the target universe (not e.g. tiny rural counties with
    -- volatile wage swings).
    select
        w.fips,
        w.period_end_date,
        w.avg_annual_pay,
        w.wage_growth_yoy,
        median(w.wage_growth_yoy) over (partition by w.period_end_date) as national_median_wage_growth,
        w.wage_growth_yoy
            - median(w.wage_growth_yoy) over (partition by w.period_end_date)
            as wage_growth_yoy_demeaned
    from with_yoy w
    inner join {{ ref('int_universe') }} u using (fips)
    where w.wage_growth_yoy is not null
)

select * from demeaned
