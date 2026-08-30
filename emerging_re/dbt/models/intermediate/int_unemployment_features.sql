-- Unemployment features per (fips, period_end_date).
--
-- Emits:
--   unemployment_rate           latest known monthly rate at that period
--   unemployment_rate_yoy_chg   change over 12 months (level pp)
--
-- Downstream mart_county_features joins on annual scoring periods
-- (Dec 31 each year) using the nearest same-month or prior monthly
-- LAUS reading. Date-based join to avoid look-ahead.
with monthly as (
    select
        fips,
        period_end_date,
        unemployment_rate
    from {{ ref('stg_bls_laus') }}
    qualify row_number() over (partition by fips, period_end_date order by as_of_date desc) = 1
)

select
    m_now.fips,
    m_now.period_end_date,
    m_now.unemployment_rate,
    m_prev.unemployment_rate as unemployment_rate_12mo_ago,
    m_now.unemployment_rate - m_prev.unemployment_rate as unemployment_rate_yoy_chg
from monthly m_now
left join monthly m_prev
    on m_prev.fips = m_now.fips
    and m_prev.period_end_date = m_now.period_end_date - interval '1 year'
