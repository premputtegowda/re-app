-- Cap rate trend — per-period MF cap rate + 3yr change.
--
-- Hypothesis: falling cap rates = investors bidding up prices before
-- rents catch up = future rent-chase to restore yield. Compressing cap
-- rate is a LEADING indicator for rent growth (as market prices in
-- expected future rent increases via lower current yields).
--
-- MF cap rate formula: HUD FMR 2BR × 12 / ACS median_home_value + 1.5% MF premium.
--
-- Features:
--   1. `mf_cap_rate_now` — current level
--   2. `mf_cap_rate_change_3yr` — change vs 3yr ago (negative = compressing)
--
-- Sign for composite: -1 for change (lower/compressing = better).
-- +1 for level (high current cap = high yield = attractive).
--
-- Uses ACS 1yr for freshness, falls back to 5yr where 1yr unavailable.
with acs_1yr as (
    select fips, period_end_date, median_home_value
    from {{ ref('stg_census_acs_1yr') }}
    where median_home_value is not null and median_home_value > 0
    qualify row_number() over (partition by fips, period_end_date order by as_of_date desc) = 1
),

acs_5yr as (
    select fips, period_end_date, median_home_value
    from {{ ref('stg_census_acs') }}
    where median_home_value is not null and median_home_value > 0
    qualify row_number() over (partition by fips, period_end_date order by as_of_date desc) = 1
),

home_value_combined as (
    select fips, period_end_date, median_home_value, '1yr' as source from acs_1yr
    union all
    select a5.fips, a5.period_end_date, a5.median_home_value, '5yr' as source
    from acs_5yr a5
    left join acs_1yr a1
        on a1.fips = a5.fips and a1.period_end_date = a5.period_end_date
    where a1.fips is null
),

fmr as (
    select fips, period_end_date, fmr_2br
    from {{ ref('stg_hud_fmr') }}
    where fmr_2br is not null and fmr_2br > 0
    qualify row_number() over (partition by fips, period_end_date order by as_of_date desc) = 1
),

cap_rates as (
    -- MF cap rate per (fips, calendar year). ACS period_end = Dec 31 of vintage year,
    -- FMR period_end = Sep 30 of FY. Join by year-of-period.
    select
        h.fips,
        h.period_end_date,
        h.median_home_value,
        f.fmr_2br,
        (f.fmr_2br * 12.0) / h.median_home_value + 0.015 as mf_cap_rate_now
    from home_value_combined h
    inner join fmr f
        on f.fips = h.fips
        and year(f.period_end_date) = year(h.period_end_date)
),

with_lag as (
    select
        c_now.fips,
        c_now.period_end_date,
        c_now.mf_cap_rate_now,
        c_3.mf_cap_rate_now as mf_cap_rate_t_minus_3
    from cap_rates c_now
    left join cap_rates c_3
        on c_3.fips = c_now.fips
        and c_3.period_end_date = c_now.period_end_date - interval '3 years'
)

select
    fips,
    period_end_date,
    mf_cap_rate_now,
    mf_cap_rate_now - mf_cap_rate_t_minus_3 as mf_cap_rate_change_3yr
from with_lag
inner join {{ ref('int_universe') }} u using (fips)
