-- ACS-derived features for testing composite predictability.
-- Emits three level metrics per (fips, period_end_date=ACS midpoint):
--
--   1. `rental_vacancy_rate` — direct market-tightness proxy (the
--      signal HUD USPS Vacancy would have provided). Low = tight market.
--   2. `rent_to_income_ratio` — annual gross rent / median household
--      income. Low = affordability headroom for future rent growth.
--   3. `cap_rate_proxy` — annual rent / median home value. High = better
--      yield / cheaper on cash-flow basis (Tier 3 value signal).
--
-- ACS 5-year period_end_date = middle year of the 5-year window (Dec 31
-- of vintage−2). Downstream features join to this date directly rather
-- than treating ACS as annual — the 5-year smoothing means neighboring
-- period_end_dates are highly correlated anyway.
select
    a.fips,
    a.period_end_date,
    a.rental_vacancy_rate,
    case
        when a.median_gross_rent is null or a.median_household_income is null
             or a.median_household_income = 0 then null
        else (a.median_gross_rent * 12.0) / a.median_household_income
    end as rent_to_income_ratio,
    case
        when a.median_gross_rent is null or a.median_home_value is null
             or a.median_home_value = 0 then null
        else (a.median_gross_rent * 12.0) / a.median_home_value
    end as cap_rate_proxy
from {{ ref('stg_census_acs') }} a
inner join {{ ref('int_universe') }} u on u.fips = a.fips
qualify row_number() over (partition by a.fips, a.period_end_date order by a.as_of_date desc) = 1
