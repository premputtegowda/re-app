-- Latest scoring per county — the UI's main landing page reads this.
-- "Current" = the most recent period_end_date for which we have
-- composite scores AND both features and (soon-to-be-realized) targets.
-- Note: the LATEST period never has forward-24mo targets yet, so we
-- keep those columns nullable.
with latest_period as (
    select max(period_end_date) as period_end_date
    from {{ ref('mart_backtest_scores') }}
    where composite_score is not null
)

select
    s.fips,
    s.period_end_date,
    s.county_name,
    s.state_name,
    s.pop_latest,
    -- Back-compat alias (= joint).
    s.composite_score,
    s.composite_rank,
    -- Per-composite scores + ranks.
    s.hpi_composite_score,
    s.hpi_composite_rank,
    s.zori_composite_score,
    s.zori_composite_rank,
    s.joint_composite_score,
    s.joint_composite_rank,
    -- Per-composite tier contributions.
    s.hpi_score_tier1_demand,
    s.hpi_score_tier4_momentum,
    s.zori_score_tier1_demand,
    s.zori_score_tier4_momentum,
    s.joint_score_tier1_demand,
    s.joint_score_tier4_momentum,
    -- Back-compat.
    s.score_tier1_demand,
    s.score_tier4_momentum,
    s.any_disqualifier,
    -- Feature z-scores for "why this rank" breakdown.
    s.z_domesticmig_per_1000,
    s.z_domesticmig_accel_3yr,
    s.z_wage_growth_yoy_demeaned,
    s.z_emp_growth_yoy_demeaned,
    s.z_cap_rate_proxy,
    s.z_irs_net_migration_rate,
    s.z_irs_inflow_rate,
    s.z_irs_income_gap,
    s.z_irs_income_gap_pct,
    s.z_irs_net_agi_per_capita,
    s.z_pcpi_cagr_3yr_vs_state_pp,
    s.z_fmr_2br_cagr_3yr_vs_state_pp,
    s.z_renter_ind_emp_yoy,
    s.z_vt_vacancy_change_3yr,
    s.z_vt_vacancy_change_5yr,
    s.z_age_20_34_share_yoy_chg,
    s.z_foreign_born_share_yoy_chg,
    s.z_mf_permit_ratio_ts,
    s.z_hpi_yoy,
    s.z_zori_yoy
from {{ ref('mart_backtest_scores') }} s
inner join latest_period p on s.period_end_date = p.period_end_date
