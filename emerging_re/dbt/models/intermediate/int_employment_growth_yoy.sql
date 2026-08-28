-- Tier 1 signal: total employment growth, YoY, demeaned vs national.
--
-- Framework: "High-wage employment growth" — separately captured by
-- int_high_wage_share. This model captures the broader signal: is the
-- county's TOTAL job count growing faster than the national median?
--
-- Complements int_high_wage_share (which captures mix) with a magnitude
-- signal: county could be growing its total jobs fast even without
-- shifting mix. Both features go into the final scorer.
--
-- Emitted per (fips, period):
--   - `total_emp` — county headline employment (agglvl 70)
--   - `emp_growth_yoy` — (emp_t / emp_t-1) - 1
--   - `emp_growth_yoy_demeaned` — cross-sectional demean over universe
with emp as (
    select
        fips,
        period_end_date,
        annual_avg_emplvl as total_emp
    from {{ ref('stg_bls_qcew') }}
    where agglvl_code = 70
    qualify row_number() over (partition by fips, period_end_date order by as_of_date desc) = 1
),

with_yoy as (
    select
        e_now.fips,
        e_now.period_end_date,
        e_now.total_emp,
        e_prev.total_emp as total_emp_t_minus_1,
        case
            when e_prev.total_emp is null or e_prev.total_emp = 0 then null
            else (e_now.total_emp * 1.0 / e_prev.total_emp) - 1
        end as emp_growth_yoy
    from emp e_now
    left join emp e_prev
        on e_prev.fips = e_now.fips
        and e_prev.period_end_date = e_now.period_end_date - interval '1 year'
),

demeaned as (
    select
        w.fips,
        w.period_end_date,
        w.total_emp,
        w.emp_growth_yoy,
        median(w.emp_growth_yoy) over (partition by w.period_end_date) as national_median_emp_growth,
        w.emp_growth_yoy
            - median(w.emp_growth_yoy) over (partition by w.period_end_date)
            as emp_growth_yoy_demeaned
    from with_yoy w
    inner join {{ ref('int_universe') }} u using (fips)
    where w.emp_growth_yoy is not null
)

select * from demeaned
