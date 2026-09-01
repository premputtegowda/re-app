-- Anchor-institution employment concentration — captures the tertiary
-- market signature we've been missing (Taylor TX / Dyess AFB, Newport RI /
-- Naval Station, Broome NY / SUNY Binghamton, Washington TN / East TN
-- State, McLean IL / Illinois State, etc.).
--
-- Anchor institutions provide:
--   - Perpetual demand base (soldiers, students, patients, tourists)
--   - Supply constraint (small metros don't overbuild)
--   - Recession resilience (federal / state payroll doesn't lay off)
--
-- Data source: QCEW supersector employment across ALL ownership types.
-- Combines federal + state + local + private for full institution coverage:
--   - Universities: mostly state (SUNY, state Us) + private (private colleges)
--   - Military bases: federal civilian workforce (active-duty NOT in QCEW)
--   - Hospitals: state (public hospitals, VA) + local (county hospitals) +
--     private (nonprofit + for-profit hospital systems)
--   - Tourism: mostly private (accommodation + food service)
--   - Public admin (state capitals, county seats): state + local government
with qcew_latest as (
    select
        fips, period_end_date, agglvl_code, own_code, industry_code,
        annual_avg_emplvl
    from {{ ref('stg_bls_qcew') }}
    qualify row_number() over (
        partition by fips, period_end_date, agglvl_code, own_code, industry_code
        order by as_of_date desc
    ) = 1
),

totals as (
    -- County total employment across ALL ownerships (agglvl 70, own 0).
    select fips, period_end_date, annual_avg_emplvl as total_emp
    from qcew_latest
    where agglvl_code = 70 and own_code = 0
),

anchor_by_sector as (
    -- Sum ALL ownerships within each supersector to get true anchor size.
    -- E.g., university = state SUNY employment + private college employment.
    select
        fips, period_end_date,
        sum(case when industry_code = '61' then annual_avg_emplvl end) as edu_total_emp,
        sum(case when industry_code = '62' then annual_avg_emplvl end) as healthcare_total_emp,
        sum(case when industry_code = '71' then annual_avg_emplvl end) as arts_recreation_emp,
        sum(case when industry_code = '72' then annual_avg_emplvl end) as accommodation_food_emp,
        -- Federal presence proxy (military civilian workforce, federal labs,
        -- VA hospitals, DoD contractors). NOTE: active-duty military NOT
        -- in QCEW so this UNDERSTATES military-base counties.
        sum(case when own_code = 1 then annual_avg_emplvl end) as federal_gov_emp,
        -- State + local combined (state capitals, county seats, public schools)
        sum(case when own_code in (2, 3) then annual_avg_emplvl end) as state_local_gov_emp,
        -- Sub-breakout: education by ownership (for signal isolation)
        sum(case when industry_code = '61' and own_code in (2, 3) then annual_avg_emplvl end) as edu_public_emp,
        sum(case when industry_code = '61' and own_code = 5 then annual_avg_emplvl end) as edu_private_emp,
        -- Healthcare by ownership
        sum(case when industry_code = '62' and own_code in (1, 2, 3) then annual_avg_emplvl end) as healthcare_public_emp,
        sum(case when industry_code = '62' and own_code = 5 then annual_avg_emplvl end) as healthcare_private_emp
    from qcew_latest
    where agglvl_code = 74
    group by fips, period_end_date
)

select
    t.fips,
    t.period_end_date,
    t.total_emp,
    -- Combined-ownership sector totals (raw counts).
    a.edu_total_emp,
    a.healthcare_total_emp,
    a.arts_recreation_emp,
    a.accommodation_food_emp,
    a.federal_gov_emp,
    a.state_local_gov_emp,
    -- Ownership subtotals for signal isolation.
    a.edu_public_emp,
    a.edu_private_emp,
    a.healthcare_public_emp,
    a.healthcare_private_emp,
    -- Employment shares (0-1).
    coalesce(a.edu_total_emp, 0) / nullif(t.total_emp, 0) as edu_share,
    coalesce(a.healthcare_total_emp, 0) / nullif(t.total_emp, 0) as healthcare_share,
    (coalesce(a.arts_recreation_emp, 0) + coalesce(a.accommodation_food_emp, 0))
        / nullif(t.total_emp, 0) as tourism_share,
    coalesce(a.federal_gov_emp, 0) / nullif(t.total_emp, 0) as federal_gov_share,
    coalesce(a.state_local_gov_emp, 0) / nullif(t.total_emp, 0) as state_local_gov_share,
    -- Anchor type classification — which single sector dominates.
    -- Thresholds calibrated for ~5-15% of counties in each category.
    case
        when coalesce(a.federal_gov_emp, 0) / nullif(t.total_emp, 0) > 0.10
            then 'military_or_federal'
        when coalesce(a.edu_total_emp, 0) / nullif(t.total_emp, 0) > 0.10
            then 'university'
        when coalesce(a.healthcare_total_emp, 0) / nullif(t.total_emp, 0) > 0.22
            then 'healthcare'
        when (coalesce(a.arts_recreation_emp, 0) + coalesce(a.accommodation_food_emp, 0))
             / nullif(t.total_emp, 0) > 0.20
            then 'tourism'
        else 'diversified'
    end as anchor_type,
    -- Composite anchor stability score (0-1).
    -- Weighted by empirical stability: federal > university > healthcare > tourism.
    least(1.0,
        (coalesce(a.federal_gov_emp, 0) * 1.5 +
         coalesce(a.edu_total_emp, 0) * 1.2 +
         coalesce(a.healthcare_total_emp, 0) * 1.0 +
         (coalesce(a.arts_recreation_emp, 0) + coalesce(a.accommodation_food_emp, 0)) * 0.7
        ) / nullif(t.total_emp, 0)
    ) as anchor_stability_score
from totals t
left join anchor_by_sector a using (fips, period_end_date)
inner join {{ ref('int_universe') }} u on u.fips = t.fips
