-- Tertiary anchor MF market screener — separate view from mart_mf_scored.
--
-- WHY this exists: mart_mf_scored requires pop >= 250K + MF permits >= 500,
-- which excludes the small metros that our anchor-institution analysis
-- identified as strong 2020-2025 performers:
--   - Newport RI (pop 83K, Naval Station) — +55% rent 5y
--   - Taylor TX (pop 150K, Dyess AFB) — +62% rent 5y
--   - Broome NY (pop 196K, SUNY Binghamton) — +57% rent 5y
--   - Washington TN (pop 141K, East TN State) — +59% rent 5y
--
-- This mart targets:
--   - Population 50K-250K (tertiary MF segment)
--   - Has meaningful anchor institution (score > 20th percentile)
--   - Not disqualified (MF cycle top warning etc.)
--
-- For each county: exposes anchor profile + composite ranking + cap rate +
-- realized returns (for backtest validation).
with anchor_latest as (
    select fips, anchor_type, anchor_stability_score,
           tourism_share, edu_share, healthcare_share,
           federal_gov_share, state_local_gov_share
    from {{ ref('int_anchor_institutions') }}
    qualify row_number() over (partition by fips order by period_end_date desc) = 1
),

-- Compute anchor percentile within full universe (so "meaningful anchor"
-- = above 20th percentile of all counties for this metric).
anchor_universe as (
    select
        fips, anchor_type, anchor_stability_score,
        tourism_share, edu_share, healthcare_share,
        federal_gov_share, state_local_gov_share,
        ntile(5) over (order by anchor_stability_score) as anchor_quintile
    from anchor_latest
),

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
        power(n.pop_now::double / nullif(p5.popestimate, 0), 1.0/5) - 1 as pop_cagr_5yr
    from now_pop n
    left join pep_latest p5
        on p5.fips = n.fips and p5.period_end_date = n.now_period - interval '5 years'
),

trailing_returns as (
    select fips, hpi_annualized_3yr, hpi_annualized_5yr,
           zori_annualized_3yr, zori_annualized_5yr
    from {{ ref('int_trailing_appreciation') }}
),

mf_context as (
    -- int_mf_features is now (fips, period_end_date) grain after PIT rewrite.
    -- This screener is a current-state view — take latest period per fips.
    select fips, mf_cap_rate_estimated, rental_vacancy_rate, renter_share
    from {{ ref('int_mf_features') }}
    qualify row_number() over (partition by fips order by period_end_date desc) = 1
)

select
    bc.fips,
    bc.county_name,
    bc.state_name,
    bc.pop_latest,
    -- Anchor profile
    au.anchor_type,
    round(au.anchor_stability_score::decimal, 3) as anchor_stability_score,
    round(au.tourism_share * 100, 1) as tourism_share_pct,
    round(au.edu_share * 100, 1) as edu_share_pct,
    round(au.healthcare_share * 100, 1) as healthcare_share_pct,
    round(au.federal_gov_share * 100, 1) as federal_gov_share_pct,
    round(au.state_local_gov_share * 100, 1) as state_local_gov_share_pct,
    -- Composite scores (leak-free at latest period)
    round(bc.hpi_composite_score::decimal, 3) as hpi_composite_score,
    round(bc.zori_composite_score::decimal, 3) as zori_composite_score,
    round(bc.joint_composite_score::decimal, 3) as joint_composite_score,
    -- MF economics
    round(mfc.mf_cap_rate_estimated * 100, 2) as mf_cap_pct,
    round(mfc.rental_vacancy_rate * 100, 1) as vacancy_pct,
    round(mfc.renter_share * 100, 1) as renter_share_pct,
    -- Historical performance (trailing_returns)
    round(t.hpi_annualized_3yr * 100, 1) as hpi_3y_pct,
    round(t.hpi_annualized_5yr * 100, 1) as hpi_5y_pct,
    round(t.zori_annualized_3yr * 100, 1) as zori_3y_pct,
    round(t.zori_annualized_5yr * 100, 1) as zori_5y_pct,
    -- Population trajectory
    round(pg.pop_cagr_5yr * 100, 2) as pop_5y_cagr_pct,
    -- Ranking within tertiary anchor universe (recomputed here)
    row_number() over (order by bc.zori_composite_score desc) as tertiary_zori_rank,
    row_number() over (order by bc.hpi_composite_score desc) as tertiary_hpi_rank,
    row_number() over (order by bc.joint_composite_score desc) as tertiary_joint_rank
from {{ ref('mart_backtest_current') }} bc
inner join anchor_universe au on au.fips = bc.fips
left join pop_growth pg on pg.fips = bc.fips
left join trailing_returns t on t.fips = bc.fips
left join mf_context mfc on mfc.fips = bc.fips
where bc.pop_latest between 50000 and 250000  -- tertiary MF segment
  and au.anchor_quintile >= 2                  -- has meaningful anchor (not bottom 20%)
  and (bc.any_disqualifier is null or bc.any_disqualifier = false)
  and bc.hpi_composite_score is not null
order by joint_composite_score desc nulls last
