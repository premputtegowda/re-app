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
with base as (
    select
        bc.fips,
        bc.county_name,
        bc.state_name,
        bc.pop_latest,
        bc.composite_score,
        bc.score_tier1_demand,
        bc.score_tier4_momentum,
        cc.cap_rate_proxy as sfr_cap_rate_proxy,
        cc.median_gross_rent,
        cc.median_home_value,
        cc.median_household_income,
        mf.renter_share,
        mf.mf_permit_ratio,
        mf.rental_vacancy_rate,
        mf.rental_vacancy_change_3yr,
        mf.fmr_2br,
        mf.mf_cap_rate_estimated,
        bps.mf_permits_3yr
    from {{ ref('mart_backtest_current') }} bc
    left join {{ ref('mart_county_context') }} cc using (fips)
    left join {{ ref('int_mf_features') }} mf using (fips)
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
    select
        *,
        0.7 * composite_score + 0.3 * coalesce(mf_cap_zscore, 0) as mf_score
    from with_combined_score
)

select
    row_number() over (order by mf_score desc) as mf_rank,
    fips,
    county_name,
    state_name,
    pop_latest,
    case
        when pop_latest > 500000 then 'Tier 1'
        when pop_latest >= 200000 then 'Tier 2'
        else 'Tier 3'
    end as pop_tier,
    round(mf_score::decimal, 3) as mf_score,
    round(composite_score::decimal, 3) as composite_score,
    -- Primary yield metric: MF-adjusted (2BR FMR × 12 / home_val + 150bps)
    round(mf_cap_rate_estimated * 100, 2) as mf_cap_pct,
    -- Compare against SFR-ish proxy for context
    round(sfr_cap_rate_proxy * 100, 2) as sfr_cap_pct,
    round(renter_share * 100, 1) as renter_share_pct,
    round(rental_vacancy_rate * 100, 1) as vacancy_pct,
    round(rental_vacancy_change_3yr * 100, 1) as vacancy_change_3yr_pp,
    round(mf_permit_ratio * 100, 1) as mf_permit_share_pct,
    mf_permits_3yr,
    fmr_2br as fmr_2br_monthly,
    median_gross_rent,
    median_home_value,
    median_household_income
from final
order by mf_rank
