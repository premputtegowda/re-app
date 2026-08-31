-- Foreign-born share + growth — immigrant rent-demand signal.
--
-- Hypothesis: >80% of first-5-years-in-country immigrants rent (Census
-- SIPP + American Housing Survey). Growth in foreign-born share of
-- population is a strong rent-demand signal, especially for MF (immigrant
-- households cluster in apartment stock near ports of entry, transit,
-- and employment hubs).
--
-- ACS B05002_013E = "Foreign-born" count. Divide by total_population
-- for share; take YoY change of share.
--
-- Features (candidates):
--   1. `foreign_born_share` — level (current share)
--   2. `foreign_born_share_yoy_chg` — change in share (pp)
--   3. `foreign_born_cagr_3yr` — 3yr CAGR of count
--
-- Sign for composite: all naturally +1.
with acs as (
    select
        fips,
        period_end_date,
        foreign_born_population,
        total_population
    from {{ ref('stg_census_acs_1yr') }}
    where foreign_born_population is not null
      and total_population is not null and total_population > 0
    qualify row_number() over (partition by fips, period_end_date order by as_of_date desc) = 1
),

with_share as (
    select
        fips, period_end_date,
        foreign_born_population,
        total_population,
        1.0 * foreign_born_population / total_population as foreign_born_share
    from acs
),

with_lags as (
    select
        a_now.fips,
        a_now.period_end_date,
        a_now.foreign_born_population,
        a_now.foreign_born_share,
        a_1.foreign_born_share as share_t_minus_1,
        a_3.foreign_born_population as fb_t_minus_3
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
    foreign_born_share,
    foreign_born_share - share_t_minus_1 as foreign_born_share_yoy_chg,
    power(foreign_born_population / nullif(fb_t_minus_3, 0), 1.0/3) - 1 as foreign_born_cagr_3yr
from with_lags
inner join {{ ref('int_universe') }} u using (fips)
