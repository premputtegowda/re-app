-- Multi-family (10-20 unit) investor view.
--
-- Same composite ranking as mart_backtest_current, but with MF-appropriate
-- FILTERS pre-applied + MF-specific metrics surfaced for display + ranking
-- adjusted by a combined score that blends composite + cap rate.
--
-- Rationale (from v6 experiment 2026-08-29): adding MF features
-- (renter_share, mf_permit_ratio, vacancy trend) to the composite
-- scoring didn't help — our forward-return targets are SFR-biased so
-- MF signals fight the target. But MF features ARE useful as FILTERS
-- to narrow the universe to markets that fit MF investing.
--
-- Filters applied (all defensible for a 10-20 unit MF investor):
--   - Population >= 250K (deep tenant pool + deal flow + exit liquidity)
--   - 3-year MF permits >= 500 (evidence of active MF market)
--   - Renter share >= 25% (MF-friendly market culture)
--   - Rental vacancy <= 8% (not oversupplied)
--   - Not disqualified (aging trap / sector concentration / price ran)
--
-- Ranking: composite_score × 0.7 + z_score(cap_rate_proxy) × 0.3
-- Gives 70% weight to framework's forward-return signal, 30% to
-- current-yield attractiveness. Adjustable — this is one reasonable
-- blend.
with div_latest as (
    -- Latest employment diversity (HHI) per fips.
    select fips, employment_diversity_hhi
    from {{ ref('int_employment_diversity') }}
    qualify row_number() over (partition by fips order by period_end_date desc) = 1
),

-- Population growth trends: 5yr CAGR + 1yr YoY change from PEP.
pop_growth as (
    with pep_latest as (
        select fips, period_end_date, popestimate
        from {{ ref('stg_census_pep') }}
        qualify row_number() over (partition by fips, period_end_date order by as_of_date desc) = 1
    ),
    now_pop as (
        select fips, popestimate as pop_now, period_end_date as now_period
        from pep_latest
        qualify row_number() over (partition by fips order by period_end_date desc) = 1
    )
    select
        n.fips,
        n.pop_now,
        p1.popestimate as pop_1yr_ago,
        p5.popestimate as pop_5yr_ago,
        (n.pop_now::double / nullif(p1.popestimate, 0)) - 1 as pop_yoy,
        power(n.pop_now::double / nullif(p5.popestimate, 0), 1.0/5) - 1 as pop_cagr_5yr
    from now_pop n
    left join pep_latest p1
        on p1.fips = n.fips and p1.period_end_date = n.now_period - interval '1 year'
    left join pep_latest p5
        on p5.fips = n.fips and p5.period_end_date = n.now_period - interval '5 years'
),

disq_latest as (
    -- Top-supersector share (concentration flag context).
    select fips, max_supersector_share
    from {{ ref('int_disqualifiers') }}
    qualify row_number() over (partition by fips order by period_end_date desc) = 1
),

trailing_appr as (
    select fips,
           hpi_annualized_2yr, hpi_annualized_3yr, hpi_annualized_5yr,
           zori_annualized_2yr, zori_annualized_3yr, zori_annualized_5yr
    from {{ ref('int_trailing_appreciation') }}
),

unemployment as (
    -- Latest LAUS unemployment reading per fips (from int, which has YoY chg).
    select fips,
           unemployment_rate,
           unemployment_rate_yoy_chg
    from {{ ref('int_unemployment_features') }}
    qualify row_number() over (partition by fips order by period_end_date desc) = 1
),

bea as (
    -- Latest BEA per-capita income + trailing growth per fips.
    select fips,
           per_capita_income,
           pcpi_yoy,
           pcpi_cagr_3yr,
           pcpi_cagr_5yr,
           pcpi_cagr_3yr_vs_state_pp
    from {{ ref('int_bea_income') }}
    qualify row_number() over (partition by fips order by period_end_date desc) = 1
),

irs_migration as (
    -- Latest IRS SOI migration vintage per fips. Key MF signal:
    -- inflow_agi_per_return = income of incoming residents.
    select fips,
           inflow_returns,
           inflow_agi_per_return,
           outflow_agi_per_return,
           net_migration_returns,
           net_agi_thousands
    from {{ ref('stg_irs_soi_migration') }}
    qualify row_number() over (partition by fips order by period_end_date desc, as_of_date desc) = 1
),

fema_risk as (
    -- FEMA NRI composite + key hazards for MF investors.
    -- Ratings are text ("Very Low" ... "Very High"); scores are 0-100.
    select fips,
           risk_score       as fema_composite_risk_score,
           risk_ratng       as fema_composite_risk_rating,
           eal_score        as fema_expected_annual_loss_score,
           cfld_risks       as fema_coastal_flood_risk,
           hrcn_risks       as fema_hurricane_risk,
           wfir_risks       as fema_wildfire_risk,
           erqk_risks       as fema_earthquake_risk,
           trnd_risks       as fema_tornado_risk,
           hwav_risks       as fema_heat_wave_risk
    from {{ ref('stg_fema_nri') }}
),

-- Raw composite prediction variables (latest period per fips).
-- These are the 9 features the composite scoring uses.
comp_features as (
    select
        fips,
        domesticmig_per_1000,
        domesticmig_accel_3yr,
        high_wage_share,
        high_wage_share_yoy_chg,
        wage_growth_yoy_demeaned,
        emp_growth_yoy_demeaned,
        hpi_yoy,
        zori_yoy
    from {{ ref('mart_county_features') }}
    qualify row_number() over (partition by fips order by period_end_date desc) = 1
),

base as (
    select
        bc.fips,
        bc.county_name,
        bc.state_name,
        bc.pop_latest,
        -- Back-compat (composite_score = joint).
        bc.composite_score,
        -- Per-composite scores (2026-08-31 3-composite refactor).
        bc.hpi_composite_score,
        bc.zori_composite_score,
        bc.joint_composite_score,
        bc.score_tier1_demand,
        bc.score_tier4_momentum,
        cc.cap_rate_proxy as sfr_cap_rate_proxy,
        cc.median_gross_rent,
        cc.median_home_value,
        cc.median_household_income,
        ta.hpi_annualized_2yr,
        ta.hpi_annualized_3yr,
        ta.hpi_annualized_5yr,
        ta.zori_annualized_2yr,
        ta.zori_annualized_3yr,
        ta.zori_annualized_5yr,
        mf.renter_share,
        mf.mf_permit_ratio,
        mf.rental_vacancy_rate,
        mf.rental_vacancy_change_3yr,
        mf.fmr_2br,
        mf.mf_cap_rate_estimated,
        mf.mf_cap_rate_from_sfr,
        bps.mf_permits_3yr,
        dl.employment_diversity_hhi,
        dq.max_supersector_share,
        cf.domesticmig_per_1000,
        cf.domesticmig_accel_3yr,
        cf.high_wage_share,
        cf.high_wage_share_yoy_chg,
        cf.wage_growth_yoy_demeaned,
        cf.emp_growth_yoy_demeaned,
        cf.hpi_yoy,
        cf.zori_yoy,
        un.unemployment_rate,
        un.unemployment_rate_yoy_chg,
        bea.per_capita_income as bea_per_capita_income,
        bea.pcpi_yoy as bea_pcpi_yoy,
        bea.pcpi_cagr_3yr as bea_pcpi_cagr_3yr,
        bea.pcpi_cagr_5yr as bea_pcpi_cagr_5yr,
        bea.pcpi_cagr_3yr_vs_state_pp as bea_pcpi_cagr_3yr_vs_state_pp,
        im.inflow_returns as irs_inflow_returns,
        im.inflow_agi_per_return as irs_inflow_avg_income,
        im.outflow_agi_per_return as irs_outflow_avg_income,
        im.net_migration_returns as irs_net_migration_households,
        fr.fema_composite_risk_score,
        fr.fema_composite_risk_rating,
        fr.fema_expected_annual_loss_score,
        fr.fema_coastal_flood_risk,
        fr.fema_hurricane_risk,
        fr.fema_wildfire_risk,
        fr.fema_earthquake_risk,
        fr.fema_tornado_risk,
        fr.fema_heat_wave_risk,
        -- MF inventory + age + absorption (ACS B25024 + B25034 + BPS).
        inv.units_in_10_to_19_bldgs,
        inv.est_bldgs_10_to_19,               -- 🎯 estimated buy-target count
        inv.units_in_5_to_9_bldgs,
        inv.est_bldgs_5_to_9,
        inv.units_in_20_to_49_bldgs,
        inv.est_bldgs_20_to_49,
        inv.total_mf_units,
        inv.pre_1980_share,                   -- value-add vintage indicator
        inv.hu_built_pre_1980,
        inv.hu_built_pre_1960,
        inv.mf_permits_5yr_total,
        inv.pipeline_to_stock_ratio,          -- new supply pressure
        inv.est_annual_trades_10_to_19,       -- expected properties trading/yr
        inv.est_annual_trades_5_to_49,
        -- Population growth trends (PEP).
        pg.pop_yoy,
        pg.pop_cagr_5yr,
        -- Historical analog matching (analog_matcher.py).
        anlg.analog_rank,
        anlg.analog_score as analog_similarity_score,
        anlg.best_analog_market,
        anlg.best_analog_hpi_5y_pct,
        anlg.best_analog_zori_5y_pct,
        -- Spillover / adjacency signal (Tier-1 metro momentum × distance).
        sp.spillover_hpi_pct,
        sp.spillover_zori_pct,
        sp.spillover_hpi_rank,
        sp.spillover_zori_rank,
        sp.nearest_tier1_metro,
        sp.nearest_tier1_distance_mi
    from {{ ref('mart_backtest_current') }} bc
    left join {{ ref('mart_county_context') }} cc using (fips)
    left join {{ ref('int_mf_features') }} mf using (fips)
    left join div_latest dl using (fips)
    left join disq_latest dq using (fips)
    left join trailing_appr ta using (fips)
    left join comp_features cf using (fips)
    left join unemployment un using (fips)
    left join bea using (fips)
    left join irs_migration im using (fips)
    left join fema_risk fr using (fips)
    left join {{ ref('int_mf_inventory') }} inv using (fips)
    left join pop_growth pg using (fips)
    left join {{ ref('mart_analog_ranking') }} anlg using (fips)
    left join {{ ref('mart_spillover_ranking') }} sp using (fips)
    left join (
        -- 3yr MF permit total (needed for the filter).
        select
            fips,
            sum(units_5plus) as mf_permits_3yr
        from {{ ref('stg_census_bps') }}
        where period_end_date in (date '2023-12-31', date '2024-12-31', date '2025-12-31')
        group by fips
    ) bps using (fips)
    where bc.composite_score is not null
      and not bc.any_disqualifier
),

filtered as (
    -- Apply MF-appropriate filters.
    select *
    from base
    where pop_latest >= 250000
      and coalesce(mf_permits_3yr, 0) >= 500
      and coalesce(renter_share, 0) >= 0.25
      and (rental_vacancy_rate is null or rental_vacancy_rate <= 0.08)
),

with_combined_score as (
    -- Combined ranking uses MF-adjusted cap rate (2BR FMR + 150bps premium)
    -- instead of the SFR-ish cap_rate_proxy. Z-score within the filtered
    -- MF universe so it reflects yield relative to peer MF markets.
    select
        *,
        case
            when mf_cap_rate_estimated is null then null
            else (mf_cap_rate_estimated - avg(mf_cap_rate_estimated) over ())
                 / nullif(stddev_pop(mf_cap_rate_estimated) over (), 0)
        end as mf_cap_zscore
    from filtered
),

final as (
    -- Three MF scores, one per target-optimized composite:
    --   mf_score_hpi   — appreciation-optimized (value-add / flipper)
    --   mf_score_zori  — rent-optimized (cash flow / DSCR)
    --   mf_score_joint — balanced (buy-and-hold)
    -- All use the same 0.7 * composite + 0.3 * cap_rate_zscore blend.
    -- mf_score (unqualified) = mf_score_joint for back-compat.
    select
        *,
        0.7 * hpi_composite_score   + 0.3 * coalesce(mf_cap_zscore, 0) as mf_score_hpi,
        0.7 * zori_composite_score  + 0.3 * coalesce(mf_cap_zscore, 0) as mf_score_zori,
        0.7 * joint_composite_score + 0.3 * coalesce(mf_cap_zscore, 0) as mf_score_joint,
        0.7 * composite_score       + 0.3 * coalesce(mf_cap_zscore, 0) as mf_score
    from with_combined_score
)

select
    row_number() over (order by mf_score desc)         as mf_rank,
    row_number() over (order by mf_score_hpi desc)     as mf_rank_hpi,
    row_number() over (order by mf_score_zori desc)    as mf_rank_zori,
    row_number() over (order by mf_score_joint desc)   as mf_rank_joint,
    fips,
    county_name,
    state_name,
    pop_latest,
    case
        when pop_latest > 500000 then 'Tier 1'
        when pop_latest >= 200000 then 'Tier 2'
        else 'Tier 3'
    end as pop_tier,
    -- Population growth (PEP: annual, latest vintage).
    round(pop_yoy * 100, 2) as pop_yoy_pct,
    round(pop_cagr_5yr * 100, 2) as pop_cagr_5yr_pct,
    case
        when pop_cagr_5yr is null then 'Unknown'
        when pop_cagr_5yr >= 0.015 then 'Fast growing'         -- >=1.5%/yr
        when pop_cagr_5yr >= 0.005 then 'Growing'              -- 0.5-1.5%/yr
        when pop_cagr_5yr >= -0.005 then 'Stable'              -- ±0.5%/yr
        else 'Declining'
    end as pop_trend,
    round(mf_score::decimal, 3)        as mf_score,
    round(mf_score_hpi::decimal, 3)    as mf_score_hpi,
    round(mf_score_zori::decimal, 3)   as mf_score_zori,
    round(mf_score_joint::decimal, 3)  as mf_score_joint,
    round(composite_score::decimal, 3) as composite_score,
    round(hpi_composite_score::decimal, 3)   as hpi_composite_score,
    round(zori_composite_score::decimal, 3)  as zori_composite_score,
    round(joint_composite_score::decimal, 3) as joint_composite_score,
    -- Primary yield metric: MF-adjusted (2BR FMR × 12 / home_val + 150bps)
    round(mf_cap_rate_estimated * 100, 2) as mf_cap_from_fmr_pct,
    round(mf_cap_rate_from_sfr * 100, 2) as mf_cap_from_sfr_pct,
    -- Raw SFR-ish proxy (no premium added) for context
    round(sfr_cap_rate_proxy * 100, 2) as sfr_cap_raw_pct,
    round(renter_share * 100, 1) as renter_share_pct,
    round(rental_vacancy_rate * 100, 1) as vacancy_pct,
    round(rental_vacancy_change_3yr * 100, 1) as vacancy_change_3yr_pp,
    round(mf_permit_ratio * 100, 1) as mf_permit_share_pct,
    mf_permits_3yr,
    -- ── MF INVENTORY (ACS B25024 unit counts + estimated buildings) ──
    units_in_10_to_19_bldgs,
    est_bldgs_10_to_19,                                  -- 🎯 buy-target property count
    units_in_5_to_9_bldgs,
    est_bldgs_5_to_9,
    units_in_20_to_49_bldgs,
    est_bldgs_20_to_49,
    total_mf_units,
    -- ── AGE OF STOCK (ACS B25034 aggregates) ──
    round(pre_1980_share * 100, 1) as pre_1980_share_pct,
    hu_built_pre_1980,
    hu_built_pre_1960,
    -- ── SUPPLY PIPELINE (BPS 5yr new-unit permits) ──
    mf_permits_5yr_total,
    round(pipeline_to_stock_ratio * 100, 1) as pipeline_pct_of_stock,
    -- ── ABSORPTION RATE (6% annual turnover proxy) ──
    est_annual_trades_10_to_19,                          -- expected properties trading/yr
    est_annual_trades_5_to_49,
    fmr_2br as fmr_2br_monthly,
    median_gross_rent,
    median_home_value,
    median_household_income,
    -- Annualized (CAGR) PRICE appreciation.
    round(hpi_annualized_2yr * 100, 1) as price_annualized_2yr_pct,
    round(hpi_annualized_3yr * 100, 1) as price_annualized_3yr_pct,
    round(hpi_annualized_5yr * 100, 1) as price_annualized_5yr_pct,
    -- Annualized (CAGR) RENT appreciation.
    round(zori_annualized_2yr * 100, 1) as rent_annualized_2yr_pct,
    round(zori_annualized_3yr * 100, 1) as rent_annualized_3yr_pct,
    round(zori_annualized_5yr * 100, 1) as rent_annualized_5yr_pct,
    -- Diversity metrics (sector-level via HHI; employer-level not available).
    round(employment_diversity_hhi::decimal, 3) as hhi,
    round(max_supersector_share * 100, 1) as top_sector_pct,
    -- ── HISTORICAL ANALOG (interpretive only — did NOT validate in backtest) ──
    analog_rank,
    round(analog_similarity_score::decimal, 3) as analog_score,
    best_analog_market,
    best_analog_hpi_5y_pct as analog_realized_hpi_5y,
    best_analog_zori_5y_pct as analog_realized_zori_5y,
    -- ── SPILLOVER (VALIDATED — adds +5 pp HPI Q1-Q5 over composite alone) ──
    spillover_hpi_pct,
    spillover_zori_pct,
    spillover_hpi_rank,
    spillover_zori_rank,
    nearest_tier1_metro,
    nearest_tier1_distance_mi,
    -- Sector diversification category (HHI-based).
    -- HHI < 0.15 diversified; 0.15-0.25 moderate; > 0.25 concentrated.
    case
        when employment_diversity_hhi is null then 'Unknown'
        when employment_diversity_hhi < 0.15 then 'Diversified'
        when employment_diversity_hhi < 0.25 then 'Moderate'
        else 'Concentrated'
    end as sector_diversity_category,
    -- Composite prediction variables (the 9 features that drive the score).
    round(domesticmig_per_1000::decimal, 2) as var_domesticmig_per_1000,
    round(domesticmig_accel_3yr::decimal, 2) as var_domesticmig_accel_3yr,
    round(high_wage_share * 100, 1) as var_high_wage_share_pct,
    round(high_wage_share_yoy_chg * 100, 2) as var_high_wage_yoy_chg_pct,
    round(wage_growth_yoy_demeaned * 100, 2) as var_wage_growth_demeaned_pct,
    round(emp_growth_yoy_demeaned * 100, 2) as var_emp_growth_demeaned_pct,
    round(hpi_yoy * 100, 2) as var_hpi_yoy_pct,
    round(zori_yoy * 100, 2) as var_zori_yoy_pct,
    -- Unemployment context (BLS LAUS latest).
    round(unemployment_rate::decimal, 2) as unemployment_rate_pct,
    round(unemployment_rate_yoy_chg::decimal, 2) as unemployment_yoy_chg_pp,
    -- IRS SOI migration flows (latest tax year available).
    irs_inflow_returns as irs_inflow_households,
    irs_net_migration_households as irs_net_households,
    round(irs_inflow_avg_income::decimal, 0) as irs_inflow_avg_income,
    round(irs_outflow_avg_income::decimal, 0) as irs_outflow_avg_income,
    round((irs_inflow_avg_income - irs_outflow_avg_income)::decimal, 0) as irs_income_gap,
    -- FEMA National Risk Index (v1.20).
    round(fema_composite_risk_score::decimal, 1) as fema_risk_score,
    fema_composite_risk_rating as fema_risk_rating,
    -- Climate/insurance risk category — uses FEMA's OWN normalized rating,
    -- NOT the raw score (score conflates hazard × population × vulnerability,
    -- so urban counties always score high). fema_risk_rating is FEMA's
    -- population-normalized 5-tier scale.
    case
        when fema_composite_risk_rating is null then 'Unknown'
        when fema_composite_risk_rating in ('Very Low', 'Relatively Low') then 'Low'
        when fema_composite_risk_rating = 'Relatively Moderate' then 'Moderate'
        when fema_composite_risk_rating = 'Relatively High' then 'High'
        when fema_composite_risk_rating = 'Very High' then 'Very High'
        else 'Unknown'
    end as insurance_risk_category,
    -- Physical peril breakdown (0-100 each) — the actual signals that
    -- drive future insurance premium changes, decoupled from population.
    round(greatest(
        coalesce(fema_hurricane_risk, 0),
        coalesce(fema_coastal_flood_risk, 0),
        coalesce(fema_wildfire_risk, 0),
        coalesce(fema_earthquake_risk, 0),
        coalesce(fema_tornado_risk, 0)
    )::decimal, 1) as worst_peril_score,
    fema_composite_risk_rating as fema_risk_rating,
    round(fema_coastal_flood_risk::decimal, 1) as fema_coastal_flood_score,
    round(fema_hurricane_risk::decimal, 1) as fema_hurricane_score,
    round(fema_wildfire_risk::decimal, 1) as fema_wildfire_score,
    round(fema_earthquake_risk::decimal, 1) as fema_earthquake_score,
    round(fema_tornado_risk::decimal, 1) as fema_tornado_score,
    round(fema_heat_wave_risk::decimal, 1) as fema_heat_wave_score
from final
order by mf_rank
