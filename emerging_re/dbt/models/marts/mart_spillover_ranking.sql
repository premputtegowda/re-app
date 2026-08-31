-- Spillover / adjacency ranking — Tier-1 metro momentum × distance decay.
-- Genuinely additive to composite (2020-cohort backtest: +5 pp HPI Q1-Q5
-- improvement over composite alone, +3 pp on ZORI).
select
    fips,
    county_name,
    state_name,
    pop_latest,
    round(spillover_hpi_score * 100, 2) as spillover_hpi_pct,
    round(spillover_zori_score * 100, 2) as spillover_zori_pct,
    spillover_hpi_rank,
    spillover_zori_rank,
    nearest_tier1_metro,
    nearest_tier1_distance_mi
from {{ source('spillover', 'spillover_scores') }}
