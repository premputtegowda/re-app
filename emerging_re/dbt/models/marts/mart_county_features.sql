-- Final wide table for the emerging-market screener. One row per
-- (fips, period_end_date), joining every Phase 2 intermediate feature
-- to both forward-return targets. This is the table Phase 3 backtest
-- feeds into a scoring function.
--
-- Grain: annual, Dec 31. Chosen because FHFA HPI (both a feature and
-- the primary target) is annual — no way to get finer without losing
-- HPI. Sub-annual features (like monthly ZORI) get sampled at Dec 31.
--
-- PEP data (period_end = July 1) is joined by year(period) — a small
-- July-to-December drift approximation, same choice as int_disqualifiers.
--
-- Column groups:
--   - identity: fips, period_end_date, county_name, state_name, pop_latest
--   - tier 1 demand: migration, high-wage share, wage growth, emp growth
--   - tier 2 supply: permits intensity
--   - tier 3 pricing: rent-vs-price growth
--   - disqualifiers: aging trap, sector conc, price ran, any
--   - targets: HPI 24mo demeaned (A), ZORI 24mo demeaned (B)
--
-- All features are raw (not standardized). Phase 3 scoring computes
-- cross-sectional z-scores at query time so the standardization
-- reflects each backtest fold's universe.
with dec31_periods as (
    -- Anchor grain: any Dec 31 for which HPI exists for any universe
    -- county. This produces the row cardinality of the mart.
    select distinct
        h.fips,
        h.period_end_date
    from {{ ref('stg_fhfa_hpi') }} h
    inner join {{ ref('int_universe') }} u on u.fips = h.fips
),

with_universe as (
    select
        d.fips,
        d.period_end_date,
        u.county_name,
        u.state_name,
        u.pop_latest
    from dec31_periods d
    inner join {{ ref('int_universe') }} u on u.fips = d.fips
),

-- Tier 1 features
with_migration as (
    select
        b.*,
        m.domesticmig_per_1000,
        m.domesticmig_accel_3yr
    from with_universe b
    left join {{ ref('int_migration_3yr_accel') }} m
        on m.fips = b.fips
        and year(m.period_end_date) = year(b.period_end_date)
),

with_high_wage as (
    select
        m.*,
        h.high_wage_share,
        h.high_wage_share_yoy_chg
    from with_migration m
    left join {{ ref('int_high_wage_share') }} h
        on h.fips = m.fips and h.period_end_date = m.period_end_date
),

with_wage_growth as (
    select
        h.*,
        w.wage_growth_yoy,
        w.wage_growth_yoy_demeaned
    from with_high_wage h
    left join {{ ref('int_wage_growth_yoy') }} w
        on w.fips = h.fips and w.period_end_date = h.period_end_date
),

with_emp_growth as (
    select
        w.*,
        e.emp_growth_yoy,
        e.emp_growth_yoy_demeaned
    from with_wage_growth w
    left join {{ ref('int_employment_growth_yoy') }} e
        on e.fips = w.fips and e.period_end_date = w.period_end_date
),

-- Tier 2 features
with_permits as (
    select
        e.*,
        p.permits_per_1000,
        p.permits_per_1000_10yr_baseline,
        p.permits_intensity_ratio,
        p.permits_10yr_baseline_years_available
    from with_emp_growth e
    left join {{ ref('int_permits_intensity') }} p
        on p.fips = e.fips and p.period_end_date = e.period_end_date
),

-- Tier 3 features
with_rvp as (
    select
        p.*,
        r.hpi_yoy,
        r.zori_yoy,
        r.rent_minus_price_growth,
        -- New feature (2026-08-29): affordability compression proxy.
        -- Rents outpacing wages = tenants stretched = future rent moderation
        -- likely. Sign for scoring is -1 (negative gap = wages winning =
        -- future rent runway).
        r.zori_yoy - w.wage_growth_yoy as rent_growth_vs_wage_growth
    from with_permits p
    left join {{ ref('int_rent_vs_price_growth') }} r
        on r.fips = p.fips and r.period_end_date = p.period_end_date
    left join {{ ref('int_wage_growth_yoy') }} w
        on w.fips = p.fips and w.period_end_date = p.period_end_date
),

-- New Tier 1 features (2026-08-29): international migration + emp diversity
with_intl_mig as (
    select
        r.*,
        im.internationalmig,
        im.internationalmig_per_1000
    from with_rvp r
    left join {{ ref('int_international_migration') }} im
        on im.fips = r.fips
        and year(im.period_end_date) = year(r.period_end_date)
),

with_diversity as (
    select
        m.*,
        d.employment_diversity_hhi,
        d.n_supersectors_reporting
    from with_intl_mig m
    left join {{ ref('int_employment_diversity') }} d
        on d.fips = m.fips and d.period_end_date = m.period_end_date
),

-- v5 additions (2026-08-29): BFS + ACS-derived features to test
-- predictability. ACS features join on period_end_date via a nearest-
-- prior match — ACS 5yr midpoints are Dec 31 of (vintage−2), so scoring
-- at Dec 31 of year Y matches the ACS vintage that INCLUDES year Y.
with_bfs as (
    select
        d.*,
        bf.business_applications,
        bf.business_apps_per_1000,
        bf.business_apps_per_1000_3yr_avg
    from with_diversity d
    left join {{ ref('int_bfs_apps_per_capita') }} bf
        on bf.fips = d.fips and bf.period_end_date = d.period_end_date
),

with_acs as (
    -- ACS 5yr vintage YYYY period_end = Dec 31 of (YYYY−2). For scoring
    -- at Dec 31 of year Y, the ACS vintage that CENTERS on Y-2 gives us
    -- info that reasonably reflects the market at scoring time.
    -- We match to the ACS row with period_end_date closest to (but not
    -- greater than) the scoring date.
    select
        b.*,
        af.rental_vacancy_rate,
        af.rent_to_income_ratio,
        af.cap_rate_proxy
    from with_bfs b
    left join lateral (
        select rental_vacancy_rate, rent_to_income_ratio, cap_rate_proxy
        from {{ ref('int_acs_features') }} a
        where a.fips = b.fips and a.period_end_date <= b.period_end_date
        order by a.period_end_date desc
        limit 1
    ) af on true
),

-- v6 additions (2026-08-29): MF-oriented features
with_mf as (
    select
        a.*,
        mf.renter_share,
        mf.mf_permit_ratio,
        mf.rental_vacancy_change_3yr
    from with_acs a
    left join {{ ref('int_mf_features') }} mf using (fips)
),

-- Disqualifiers
with_disq as (
    select
        r.*,
        d.disq_aging_trap,
        d.max_supersector_share,
        d.disq_sector_concentration,
        d.hpi_trailing_24mo,
        d.disq_price_ran_25pct,
        d.any_disqualifier
    from with_mf r
    left join {{ ref('int_disqualifiers') }} d
        on d.fips = r.fips and d.period_end_date = r.period_end_date
),

-- Targets (24mo + 36mo variants — 24mo predominantly momentum-driven,
-- 36mo lets mean-reversion play out for IRR-oriented investors)
with_target_a24 as (
    select
        d.*,
        ta.forward_return_24mo as hpi_forward_return_24mo,
        ta.target_hpi_24mo_demeaned
    from with_disq d
    left join {{ ref('mart_hpi_forward_returns_24mo') }} ta
        on ta.fips = d.fips and ta.period_end_date = d.period_end_date
),

with_target_b24 as (
    select
        a.*,
        tb.forward_return_24mo as zori_forward_return_24mo,
        tb.target_zori_24mo_demeaned
    from with_target_a24 a
    left join {{ ref('mart_zori_forward_returns_24mo') }} tb
        on tb.fips = a.fips and tb.period_end_date = a.period_end_date
),

with_target_a36 as (
    select
        b.*,
        ta.forward_return_36mo as hpi_forward_return_36mo,
        ta.target_hpi_36mo_demeaned
    from with_target_b24 b
    left join {{ ref('mart_hpi_forward_returns_36mo') }} ta
        on ta.fips = b.fips and ta.period_end_date = b.period_end_date
),

with_target_b36 as (
    select
        a.*,
        tb.forward_return_36mo as zori_forward_return_36mo,
        tb.target_zori_36mo_demeaned
    from with_target_a36 a
    left join {{ ref('mart_zori_forward_returns_36mo') }} tb
        on tb.fips = a.fips and tb.period_end_date = a.period_end_date
),

with_target_a60 as (
    select
        b.*,
        ta.forward_return_60mo as hpi_forward_return_60mo,
        ta.target_hpi_60mo_demeaned
    from with_target_b36 b
    left join {{ ref('mart_hpi_forward_returns_60mo') }} ta
        on ta.fips = b.fips and ta.period_end_date = b.period_end_date
),

with_target_b60 as (
    select
        a.*,
        tb.forward_return_60mo as zori_forward_return_60mo,
        tb.target_zori_60mo_demeaned
    from with_target_a60 a
    left join {{ ref('mart_zori_forward_returns_60mo') }} tb
        on tb.fips = a.fips and tb.period_end_date = a.period_end_date
)

select * from with_target_b60
