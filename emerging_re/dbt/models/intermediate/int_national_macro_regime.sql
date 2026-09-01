-- National MF-relevant macro regime, classified per calendar year.
--
-- The county-level MF cycle score alone doesn't work as a disqualifier
-- (backtest showed hot markets keep going up for years UNLESS a macro
-- shock reverses the regime). This model classifies each Dec 31 into
-- a regime so downstream we can combine county + macro signals.
--
-- Six regimes, roughly ordered by MF favorability:
--   ACCOMMODATIVE — Fed cutting or holding low, mortgage rates low.
--                   Best entry conditions for MF (cheap debt, cap rate
--                   compression tailwind).
--   EARLY_RECOVERY — Fed just started cutting from peak; unemployment
--                   plateauing. MF starts bottoming.
--   MID_CYCLE     — rates stable, healthy growth, no imbalances.
--   LATE_CYCLE    — Fed raising OR yield curve inverting.
--   TIGHTENING    — Fed hiking rapidly (>200bps in 12mo). MF value under
--                   pressure from cap rate expansion.
--   TOPPING       — Fed funds near cycle peak AND yield curve inverted
--                   for 6+ months. High probability of MF correction
--                   in next 12-24mo.
--
-- Rules use YoY changes + level thresholds. Definitions are heuristic;
-- can be refined based on backtest performance.
with pivoted as (
    -- Pivot to wide format at Dec 31 of each year.
    -- FRED data varies by frequency (daily/monthly). Take the LAST
    -- observation on or before each Dec 31.
    select
        year_end.year,
        max(case when p.series_id = 'DGS10' then p.value end) as tsy_10y,
        max(case when p.series_id = 'DGS2' then p.value end) as tsy_2y,
        max(case when p.series_id = 'T10Y2Y' then p.value end) as yield_curve_10y_2y,
        max(case when p.series_id = 'FEDFUNDS' then p.value end) as fed_funds,
        max(case when p.series_id = 'CPIAUCSL' then p.value end) as cpi_index,
        max(case when p.series_id = 'UNRATE' then p.value end) as unemployment_rate,
        max(case when p.series_id = 'MORTGAGE30US' then p.value end) as mortgage_30y
    from (
        -- For each series × year, get the latest observation of that year.
        select
            series_id, extract(year from observation_date) as year,
            observation_date, value
        from {{ ref('stg_fred_macro') }}
        qualify row_number() over (
            partition by series_id, extract(year from observation_date)
            order by observation_date desc
        ) = 1
    ) p
    inner join (
        select distinct extract(year from observation_date) as year
        from {{ ref('stg_fred_macro') }}
    ) year_end using (year)
    group by year_end.year
),

with_yoy as (
    -- YoY changes: current − 1yr prior. Positive = rising.
    select
        p.year,
        make_date(cast(p.year as int), 12, 31) as period_end_date,
        p.tsy_10y,
        p.tsy_2y,
        p.yield_curve_10y_2y,
        p.fed_funds,
        p.cpi_index,
        p.unemployment_rate,
        p.mortgage_30y,
        p.fed_funds - lag(p.fed_funds) over (order by p.year) as fed_funds_yoy_chg_bps,
        p.tsy_10y - lag(p.tsy_10y) over (order by p.year) as tsy_10y_yoy_chg_bps,
        p.unemployment_rate - lag(p.unemployment_rate) over (order by p.year) as unemp_yoy_chg,
        -- CPI YoY (inflation rate)
        100.0 * (p.cpi_index / nullif(lag(p.cpi_index) over (order by p.year), 0) - 1) as inflation_yoy_pct,
        -- Real 10yr Tsy = nominal 10yr - inflation (approx)
        p.tsy_10y - 100.0 * (p.cpi_index / nullif(lag(p.cpi_index) over (order by p.year), 0) - 1) as real_tsy_10y
    from pivoted p
)

select
    year,
    period_end_date,
    tsy_10y,
    tsy_2y,
    yield_curve_10y_2y,
    fed_funds,
    fed_funds_yoy_chg_bps,
    tsy_10y_yoy_chg_bps,
    inflation_yoy_pct,
    real_tsy_10y,
    unemployment_rate,
    unemp_yoy_chg,
    mortgage_30y,
    -- ── Regime classification (checked in priority order) ──
    case
        -- TOPPING: Fed at cycle peak (funds > 4%) AND yield curve inverted (< 0)
        when fed_funds > 4.0 and yield_curve_10y_2y < 0
            then 'TOPPING'
        -- TIGHTENING: Fed hiking rapidly (>150bps in 12mo)
        when fed_funds_yoy_chg_bps > 1.5
            then 'TIGHTENING'
        -- EARLY_RECOVERY: Fed just started cutting from peak (funds falling >75bps)
        -- AND unemployment rising (economy still weak)
        when fed_funds_yoy_chg_bps < -0.75 and unemp_yoy_chg > 0
            then 'EARLY_RECOVERY'
        -- ACCOMMODATIVE: Fed low (<2%) and stable/cutting
        when fed_funds < 2.0 and coalesce(fed_funds_yoy_chg_bps, 0) <= 0.5
            then 'ACCOMMODATIVE'
        -- LATE_CYCLE: Fed elevated (>3%) and rising modestly
        when fed_funds > 3.0 and coalesce(fed_funds_yoy_chg_bps, 0) > 0
            then 'LATE_CYCLE'
        -- Default: MID_CYCLE
        else 'MID_CYCLE'
    end as macro_regime,
    -- Categorical simplification: is regime MF-hostile?
    case
        when fed_funds > 4.0 and yield_curve_10y_2y < 0 then true
        when fed_funds_yoy_chg_bps > 1.5 then true
        else false
    end as regime_mf_hostile
from with_yoy
