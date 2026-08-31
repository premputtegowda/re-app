-- Rental vacancy trend — per-period time series (not static snapshot).
--
-- Existing int_mf_features.rental_vacancy_change_3yr is a LATEST-per-fips
-- snapshot, which introduces look-ahead when joined per-period. This model
-- emits (fips, period_end_date) rows so the backtest can score each
-- period against contemporaneous vacancy data.
--
-- ACS 1yr rental_vacancy_rate is the source. 1yr = calendar-year snapshot,
-- available for counties with pop ≥ 65K. Falls back to 5yr for smaller
-- counties.
--
-- Features (candidates):
--   1. `vacancy_change_3yr` — change vs 3yr prior (repeat of prev signal
--      but on proper time-series basis)
--   2. `vacancy_change_5yr` — 5yr change (longer window, smoother)
--   3. `vacancy_level_current` — level (control variable)
--
-- Sign for composite: FALLING vacancy = tight market = rent-growth
-- predictor, so sign = -1 for change features (lower is better).
with acs_1yr as (
    select
        fips, period_end_date, rental_vacancy_rate
    from {{ ref('stg_census_acs_1yr') }}
    where rental_vacancy_rate is not null
    qualify row_number() over (partition by fips, period_end_date order by as_of_date desc) = 1
),

acs_5yr as (
    select
        fips, period_end_date, rental_vacancy_rate
    from {{ ref('stg_census_acs') }}
    where rental_vacancy_rate is not null
    qualify row_number() over (partition by fips, period_end_date order by as_of_date desc) = 1
),

-- Combine: prefer 1yr, fall back to 5yr where 1yr missing (small counties).
combined as (
    select fips, period_end_date, rental_vacancy_rate, '1yr' as source from acs_1yr
    union all
    select a5.fips, a5.period_end_date, a5.rental_vacancy_rate, '5yr' as source
    from acs_5yr a5
    left join acs_1yr a1
        on a1.fips = a5.fips and a1.period_end_date = a5.period_end_date
    where a1.fips is null
),

with_lags as (
    select
        c_now.fips,
        c_now.period_end_date,
        c_now.rental_vacancy_rate as vacancy_level_current,
        c_3.rental_vacancy_rate as vacancy_3yr_ago,
        c_5.rental_vacancy_rate as vacancy_5yr_ago
    from combined c_now
    left join combined c_3
        on c_3.fips = c_now.fips
        and c_3.period_end_date = c_now.period_end_date - interval '3 years'
    left join combined c_5
        on c_5.fips = c_now.fips
        and c_5.period_end_date = c_now.period_end_date - interval '5 years'
)

select
    fips,
    period_end_date,
    vacancy_level_current,
    vacancy_level_current - vacancy_3yr_ago as vacancy_change_3yr,
    vacancy_level_current - vacancy_5yr_ago as vacancy_change_5yr
from with_lags
inner join {{ ref('int_universe') }} u using (fips)
