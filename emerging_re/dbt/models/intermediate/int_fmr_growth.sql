-- HUD Fair Market Rent — trailing growth features.
--
-- FMR captures the 40th-percentile rent for standard-quality rentals in
-- each HUD FMR Area (typically a metro or non-metro county). This is
-- the SEGMENT that MF investors actually own (Class B/C) — not the
-- luxury Class A that Zillow ZORI averages over.
--
-- Hypothesis: FMR YoY / CAGR is a cleaner leading indicator for future
-- ZORI growth than trailing ZORI itself, because:
--   1. FMR is set annually based on ~2yr trailing ACS survey data —
--      captures rent changes that ZORI's daily-listing index misses
--      (long-term tenants renewing at higher rates)
--   2. FMR-eligible rentals are heavily MF, matching our investment thesis
--   3. Section 8 payment standards drive market rents in FMR-heavy metros
--      (Baltimore, Detroit, Cleveland) → self-fulfilling
--
-- Features:
--   1. `fmr_2br_yoy` — 1yr FMR growth
--   2. `fmr_2br_cagr_3yr` — 3yr CAGR (smooths noise)
--   3. `fmr_2br_cagr_3yr_vs_state_pp` — state-demeaned 3yr CAGR
--
-- Sign for composite: all naturally +1 (higher = more rent-momentum).
--
-- Vintage handling: latest FMR per (fips, FY period). One row per
-- (fips, FY-Sep 30). Match to scoring date via year-of-period.
with fmr as (
    select
        fips,
        period_end_date,
        fmr_2br,
        substr(fips, 1, 2) as state_fips
    from {{ ref('stg_hud_fmr') }}
    where fmr_2br is not null and fmr_2br > 0
    qualify row_number() over (partition by fips, period_end_date order by as_of_date desc) = 1
),

with_lags as (
    -- FMR is fiscal year — period_end = Sep 30. Exact 1yr steps.
    select
        f_now.fips,
        f_now.period_end_date,
        f_now.state_fips,
        f_now.fmr_2br,
        f_1.fmr_2br as fmr_2br_t_minus_1,
        f_3.fmr_2br as fmr_2br_t_minus_3
    from fmr f_now
    left join fmr f_1
        on f_1.fips = f_now.fips
        and f_1.period_end_date = f_now.period_end_date - interval '1 year'
    left join fmr f_3
        on f_3.fips = f_now.fips
        and f_3.period_end_date = f_now.period_end_date - interval '3 years'
),

with_growth as (
    select
        *,
        fmr_2br / nullif(fmr_2br_t_minus_1, 0) - 1 as fmr_2br_yoy,
        power(fmr_2br / nullif(fmr_2br_t_minus_3, 0), 1.0/3) - 1 as fmr_2br_cagr_3yr
    from with_lags
),

-- State-demeaned 3yr CAGR (unweighted — FMR is a metro-level statistic,
-- and treating each county's FMR area equally reflects HUD's methodology).
state_avg as (
    select
        state_fips,
        period_end_date,
        avg(fmr_2br_cagr_3yr) as state_fmr_2br_cagr_3yr
    from with_growth
    where fmr_2br_cagr_3yr is not null
    group by state_fips, period_end_date
)

select
    g.fips,
    g.period_end_date,
    g.fmr_2br,
    g.fmr_2br_yoy,
    g.fmr_2br_cagr_3yr,
    g.fmr_2br_cagr_3yr - s.state_fmr_2br_cagr_3yr as fmr_2br_cagr_3yr_vs_state_pp
from with_growth g
left join state_avg s
    on s.state_fips = g.state_fips and s.period_end_date = g.period_end_date
inner join {{ ref('int_universe') }} u on u.fips = g.fips
