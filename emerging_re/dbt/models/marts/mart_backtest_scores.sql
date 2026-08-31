-- Full per-(fips, period) scoring history from backtest/run_backtest.py.
-- Consumed by the UI's county-detail view.
--
-- Three target-optimized composites (added 2026-08-31):
--   hpi_composite_score  — best for value-add / flipper (3-5yr appreciation)
--   zori_composite_score — best for cash-flow / DSCR (rent growth)
--   joint_composite_score — best for total-return (buy-and-hold)
-- Alias: composite_score = joint_composite_score (back-compat).
select
    fips,
    period_end_date,
    county_name,
    state_name,
    pop_latest,
    -- Back-compat alias (= joint).
    composite_score,
    composite_rank,
    -- Per-composite scores + ranks.
    hpi_composite_score,
    hpi_composite_rank,
    zori_composite_score,
    zori_composite_rank,
    joint_composite_score,
    joint_composite_rank,
    -- Per-composite tier contributions.
    hpi_score_tier1_demand,
    hpi_score_tier4_momentum,
    zori_score_tier1_demand,
    zori_score_tier4_momentum,
    joint_score_tier1_demand,
    joint_score_tier4_momentum,
    -- Back-compat tier score cols (= joint's).
    score_tier1_demand,
    score_tier4_momentum,
    any_disqualifier,
    -- Individual feature z-scores. All features currently z-scored, even
    -- those excluded from every composite (kept for post-hoc inspection).
    z_domesticmig_per_1000,
    z_domesticmig_accel_3yr,
    z_wage_growth_yoy_demeaned,
    z_emp_growth_yoy_demeaned,
    z_cap_rate_proxy,
    z_irs_net_migration_rate,
    z_irs_inflow_rate,
    z_irs_income_gap,
    z_irs_income_gap_pct,
    z_irs_net_agi_per_capita,
    z_pcpi_cagr_3yr_vs_state_pp,
    z_fmr_2br_cagr_3yr_vs_state_pp,
    z_renter_ind_emp_yoy,
    z_vt_vacancy_change_3yr,
    z_vt_vacancy_change_5yr,
    z_age_20_34_share_yoy_chg,
    z_foreign_born_share_yoy_chg,
    z_mf_permit_ratio_ts,
    z_hpi_yoy,
    z_zori_yoy,
    -- Realized targets for post-hoc comparison (all three horizons).
    target_hpi_24mo_demeaned,
    target_zori_24mo_demeaned,
    target_hpi_36mo_demeaned,
    target_zori_36mo_demeaned,
    target_hpi_60mo_demeaned,
    target_zori_60mo_demeaned,
    hpi_forward_return_24mo,
    zori_forward_return_24mo,
    hpi_forward_return_36mo,
    zori_forward_return_36mo,
    hpi_forward_return_60mo,
    zori_forward_return_60mo
from {{ source('backtest', 'scores') }}
