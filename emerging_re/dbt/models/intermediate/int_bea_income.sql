-- BEA regional per-capita income — trailing growth features.
--
-- Wealth-migration signal. IRS SOI tells us WHO moves (income of movers-in
-- vs movers-out); BEA tells us the RESULTING per-capita income and how
-- fast it's growing. Complementary — BEA captures locals earning more
-- AND high-income arrivals AND retirees drawing investment income.
--
-- Features (candidates for composite scoring):
--   1. `pcpi_yoy` — 1-year per-capita income growth rate. Direct signal.
--   2. `pcpi_cagr_3yr` — 3-year compound annual growth. Smooths noise.
--   3. `pcpi_cagr_5yr` — 5-year CAGR. Longest-window trend.
--   4. `pcpi_growth_vs_state_1yr_pp` — 1yr growth minus state-average
--      1yr growth. Filters out macro drift; positive = outperforming
--      peers.
--   5. `pcpi_cagr_3yr_vs_state_pp` — same for 3yr CAGR.
--
-- Sign for composite scoring: all features naturally +1.
--
-- Vintage handling: BEA publishes with ~11mo lag but revises prior years.
-- We take the LATEST vintage per (fips, period_end_date) — assumes newer
-- data is more accurate (BEA methodology explicitly revises upward).
with bea as (
    select
        fips,
        period_end_date,
        per_capita_income,
        personal_income_thousands,
        bea_population,
        -- Derive state from FIPS prefix for state-demeaned growth.
        substr(fips, 1, 2) as state_fips
    from {{ ref('stg_bea_regional_income') }}
    where per_capita_income is not null and per_capita_income > 0
    qualify row_number() over (partition by fips, period_end_date order by as_of_date desc) = 1
),

with_lags as (
    -- Point-in-time lags for 1yr, 3yr, 5yr growth calcs.
    select
        b_now.fips,
        b_now.period_end_date,
        b_now.state_fips,
        b_now.per_capita_income,
        b_now.personal_income_thousands,
        b_now.bea_population,
        b_1.per_capita_income as pcpi_t_minus_1,
        b_3.per_capita_income as pcpi_t_minus_3,
        b_5.per_capita_income as pcpi_t_minus_5
    from bea b_now
    left join bea b_1
        on b_1.fips = b_now.fips
        and b_1.period_end_date = b_now.period_end_date - interval '1 year'
    left join bea b_3
        on b_3.fips = b_now.fips
        and b_3.period_end_date = b_now.period_end_date - interval '3 years'
    left join bea b_5
        on b_5.fips = b_now.fips
        and b_5.period_end_date = b_now.period_end_date - interval '5 years'
),

with_growth as (
    select
        *,
        per_capita_income / nullif(pcpi_t_minus_1, 0) - 1 as pcpi_yoy,
        power(per_capita_income / nullif(pcpi_t_minus_3, 0), 1.0/3) - 1 as pcpi_cagr_3yr,
        power(per_capita_income / nullif(pcpi_t_minus_5, 0), 1.0/5) - 1 as pcpi_cagr_5yr
    from with_lags
),

-- State-demeaned growth: subtract state population-weighted avg.
-- Weighting by BEA population so tiny counties don't drag the state avg.
state_avg as (
    select
        state_fips,
        period_end_date,
        sum(pcpi_yoy * bea_population) / nullif(sum(bea_population), 0) as state_pcpi_yoy,
        sum(pcpi_cagr_3yr * bea_population) / nullif(sum(bea_population), 0) as state_pcpi_cagr_3yr
    from with_growth
    where pcpi_yoy is not null
    group by state_fips, period_end_date
)

select
    g.fips,
    g.period_end_date,
    g.per_capita_income,
    g.personal_income_thousands,
    g.bea_population,
    g.pcpi_yoy,
    g.pcpi_cagr_3yr,
    g.pcpi_cagr_5yr,
    -- State-demeaned growth (percentage points).
    g.pcpi_yoy - s.state_pcpi_yoy as pcpi_growth_vs_state_1yr_pp,
    g.pcpi_cagr_3yr - s.state_pcpi_cagr_3yr as pcpi_cagr_3yr_vs_state_pp
from with_growth g
left join state_avg s
    on s.state_fips = g.state_fips and s.period_end_date = g.period_end_date
-- Restrict to universe so we're not computing for counties we'd never score.
inner join {{ ref('int_universe') }} u on u.fips = g.fips
