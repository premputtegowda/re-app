-- Age 20-34 cohort — peak-renter age share + growth.
--
-- Hypothesis: rent demand is driven by 20-34 year-olds (SIPP data: 65%
-- rent this cohort vs 45% all adults). Growth in this cohort's share
-- of population is the most direct rent-demand mechanism we can measure.
--
-- Only ACS 1yr has this data with annual updates (pop >= 65K counties).
-- Falls back to 5yr not attempted here — 1yr timing is more useful and
-- 5yr age brackets are heavily smoothed anyway.
--
-- Features (candidates):
--   1. `age_20_34_share` — level (current share of population)
--   2. `age_20_34_share_yoy_chg` — annual change in share (pp)
--   3. `age_20_34_growth_3yr_cagr` — 3yr CAGR of the cohort count
--
-- Sign for composite: all naturally +1.
--
-- Coverage: ~861 pop>=65K counties (matches ACS 1yr universe).
with acs as (
    select
        fips,
        period_end_date,
        age_20_34,
        total_population
    from {{ ref('stg_census_acs_1yr') }}
    where age_20_34 is not null and total_population is not null and total_population > 0
    qualify row_number() over (partition by fips, period_end_date order by as_of_date desc) = 1
),

with_share as (
    select
        fips,
        period_end_date,
        age_20_34,
        total_population,
        1.0 * age_20_34 / total_population as age_20_34_share
    from acs
),

with_lags as (
    select
        a_now.fips,
        a_now.period_end_date,
        a_now.age_20_34,
        a_now.age_20_34_share,
        a_1.age_20_34_share as share_t_minus_1,
        a_3.age_20_34 as cohort_t_minus_3
    from with_share a_now
    left join with_share a_1
        on a_1.fips = a_now.fips
        and a_1.period_end_date = a_now.period_end_date - interval '1 year'
    left join with_share a_3
        on a_3.fips = a_now.fips
        and a_3.period_end_date = a_now.period_end_date - interval '3 years'
)

select
    fips,
    period_end_date,
    age_20_34_share,
    age_20_34_share - share_t_minus_1 as age_20_34_share_yoy_chg,
    power(age_20_34 / nullif(cohort_t_minus_3, 0), 1.0/3) - 1 as age_20_34_growth_3yr_cagr
from with_lags
inner join {{ ref('int_universe') }} u using (fips)
