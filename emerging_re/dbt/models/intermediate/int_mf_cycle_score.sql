-- MF cycle indicator — where each county is in its own MF cycle.
--
-- Rationale: the current disq_price_ran_25pct uses SFR HPI, wrong signal
-- for MF. This model builds a proper per-period MF cycle score (0-100,
-- higher = later in cycle = more risk of near-term correction) from
-- MF-specific signals:
--
--   1. RENT HEAT       — ZORI 1yr growth percentile (higher = late)
--   2. PRICE HEAT      — HPI 1yr growth percentile (higher = late)
--   3. CAP COMPRESSION — MF cap rate percentile INVERTED (low cap = late)
--   4. VACANCY TIGHTNESS — vacancy percentile INVERTED (low vac = late)
--   5. SUPPLY PIPELINE — MF permit ratio percentile (high = future glut)
--
-- Each component percentile-ranked WITHIN each period_end_date so the
-- score is regime-independent (2022's "hot" is measured against 2022
-- peers, not 2018 peers). Then weighted average → 0-100 score.
--
-- Weights: rent + cap = 25% each (primary valuation signals); price +
-- vacancy + supply = 15% each (secondary demand/supply pressure).
--
-- Output: per (fips, period_end_date) with score + component breakdown.
-- Consumed by mart_mf_scored (display) and int_disqualifiers (Phase 3).
with hpi_yoy_by_period as (
    -- Per-period 1yr HPI growth (annualized already — HPI is annual).
    select
        h_now.fips,
        h_now.period_end_date,
        (h_now.hpi / nullif(h_prev.hpi, 0)) - 1 as hpi_yoy
    from (
        select fips, period_end_date, hpi
        from {{ ref('stg_fhfa_hpi') }}
        qualify row_number() over (partition by fips, period_end_date order by as_of_date desc) = 1
    ) h_now
    left join (
        select fips, period_end_date, hpi
        from {{ ref('stg_fhfa_hpi') }}
        qualify row_number() over (partition by fips, period_end_date order by as_of_date desc) = 1
    ) h_prev
        on h_prev.fips = h_now.fips
        and h_prev.period_end_date = h_now.period_end_date - interval '1 year'
    where h_prev.hpi is not null and h_prev.hpi > 0
),

zori_yoy_by_period as (
    -- Per-period 1yr ZORI growth. Dec-to-Dec to match HPI cadence.
    select
        z_now.fips,
        z_now.period_end_date,
        (z_now.zori / nullif(z_prev.zori, 0)) - 1 as zori_yoy
    from (
        select fips, period_end_date, zori
        from {{ ref('stg_zillow_zori') }}
        where extract(month from period_end_date) = 12
        qualify row_number() over (partition by fips, period_end_date order by as_of_date desc) = 1
    ) z_now
    left join (
        select fips, period_end_date, zori
        from {{ ref('stg_zillow_zori') }}
        where extract(month from period_end_date) = 12
        qualify row_number() over (partition by fips, period_end_date order by as_of_date desc) = 1
    ) z_prev
        on z_prev.fips = z_now.fips
        and z_prev.period_end_date = z_now.period_end_date - interval '1 year'
    where z_prev.zori is not null and z_prev.zori > 0
),

-- Assemble per-period inputs. Every input source is already per-period.
inputs as (
    select
        u.fips,
        h.period_end_date,
        h.hpi_yoy,
        z.zori_yoy,
        vt.vacancy_level_current,
        crt.mf_cap_rate_now,
        mpt.mf_permit_ratio_now
    from {{ ref('int_universe') }} u
    inner join hpi_yoy_by_period h on h.fips = u.fips
    left join zori_yoy_by_period z
        on z.fips = h.fips and z.period_end_date = h.period_end_date
    left join {{ ref('int_vacancy_trend') }} vt
        on vt.fips = h.fips and vt.period_end_date = h.period_end_date
    left join {{ ref('int_cap_rate_trend') }} crt
        on crt.fips = h.fips and crt.period_end_date = h.period_end_date
    left join {{ ref('int_mf_permit_trend') }} mpt
        on mpt.fips = h.fips and mpt.period_end_date = h.period_end_date
),

-- Percentile-rank each component WITHIN each period. percent_rank
-- returns 0-1 (0 = lowest, 1 = highest). NULL values are excluded
-- from ranking (get NULL score).
ranked as (
    select
        fips,
        period_end_date,
        hpi_yoy,
        zori_yoy,
        vacancy_level_current,
        mf_cap_rate_now,
        mf_permit_ratio_now,
        -- Rent heat: higher zori_yoy = later cycle (higher percentile)
        percent_rank() over (
            partition by period_end_date order by zori_yoy nulls last
        ) as rent_heat_pct,
        -- Price heat: higher hpi_yoy = later cycle
        percent_rank() over (
            partition by period_end_date order by hpi_yoy nulls last
        ) as price_heat_pct,
        -- Cap compression: LOW cap rate = late cycle. Invert by descending order.
        percent_rank() over (
            partition by period_end_date order by mf_cap_rate_now desc nulls last
        ) as cap_compression_pct,
        -- Vacancy tightness: LOW vacancy = late cycle. Invert by descending order.
        percent_rank() over (
            partition by period_end_date order by vacancy_level_current desc nulls last
        ) as vacancy_tight_pct,
        -- Supply pipeline: HIGH mf_permit_ratio = future supply glut = late cycle
        percent_rank() over (
            partition by period_end_date order by mf_permit_ratio_now nulls last
        ) as supply_pipeline_pct
    from inputs
)

select
    fips,
    period_end_date,
    -- Component percentiles (0-1 scale).
    rent_heat_pct,
    price_heat_pct,
    cap_compression_pct,
    vacancy_tight_pct,
    supply_pipeline_pct,
    -- Weighted MF cycle score (0-100). Higher = later in local cycle.
    round(100.0 * (
        coalesce(rent_heat_pct,        0.5) * 0.25 +
        coalesce(price_heat_pct,       0.5) * 0.15 +
        coalesce(cap_compression_pct,  0.5) * 0.25 +
        coalesce(vacancy_tight_pct,    0.5) * 0.15 +
        coalesce(supply_pipeline_pct,  0.5) * 0.20
    ), 1) as mf_cycle_score,
    -- Diagnostic: how many components have data?
    (
        (case when rent_heat_pct is not null then 1 else 0 end) +
        (case when price_heat_pct is not null then 1 else 0 end) +
        (case when cap_compression_pct is not null then 1 else 0 end) +
        (case when vacancy_tight_pct is not null then 1 else 0 end) +
        (case when supply_pipeline_pct is not null then 1 else 0 end)
    ) as n_components_available
from ranked
