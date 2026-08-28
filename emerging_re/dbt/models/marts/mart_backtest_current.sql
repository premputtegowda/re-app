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
    s.composite_score,
    s.composite_rank,
    s.score_tier1_demand,
    s.score_tier2_supply,
    s.score_tier3_pricing,
    s.any_disqualifier,
    s.z_domesticmig_per_1000,
    s.z_domesticmig_accel_3yr,
    s.z_high_wage_share,
    s.z_high_wage_share_yoy_chg,
    s.z_wage_growth_yoy_demeaned,
    s.z_emp_growth_yoy_demeaned,
    s.z_permits_intensity_ratio,
    s.z_rent_minus_price_growth
from {{ ref('mart_backtest_scores') }} s
inner join latest_period p on s.period_end_date = p.period_end_date
