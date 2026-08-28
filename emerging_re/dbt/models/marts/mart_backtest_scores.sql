-- Full per-(fips, period) scoring history from backtest/run_backtest.py.
-- Consumed by the UI's county-detail view (score + tier contributions
-- + realized-vs-predicted comparison).
select
    fips,
    period_end_date,
    county_name,
    state_name,
    pop_latest,
    composite_score,
    composite_rank,
    score_tier1_demand,
    score_tier2_supply,
    score_tier3_pricing,
    any_disqualifier,
    -- Individual feature z-scores (contributions) for the "why is this
    -- ranked 14th" UI breakdown.
    z_domesticmig_per_1000,
    z_domesticmig_accel_3yr,
    z_high_wage_share,
    z_high_wage_share_yoy_chg,
    z_wage_growth_yoy_demeaned,
    z_emp_growth_yoy_demeaned,
    z_permits_intensity_ratio,
    z_rent_minus_price_growth,
    -- Realized targets for post-hoc comparison.
    target_hpi_24mo_demeaned,
    target_zori_24mo_demeaned,
    hpi_forward_return_24mo,
    zori_forward_return_24mo
from {{ source('backtest', 'scores') }}
