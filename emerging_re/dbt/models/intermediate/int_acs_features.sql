-- ACS-derived features for the composite + UI context. PIT-correct.
--
-- Grain: one row per (fips, scoring_period_end). For each scoring period
-- (annual Dec 31), the ACS values come from the most recent vintage that
-- was PUBLICLY AVAILABLE by that scoring date — enforced via as_of_date.
--
-- Prior version emitted one row per fips (latest vintage only), which
-- meant historical cohorts either got NULL (mart lateral join rejected
-- future-dated data) or leaked (in the raw view). This rewrite fixes
-- both by materializing PIT-appropriate values per period.
--
-- Prefers ACS 1-year data when available for the target period; falls
-- back to ACS 5-year for smaller counties / older periods. Emits
-- provenance columns `acs_source`, `acs_data_period`, `acs_as_of_date`
-- so downstream can audit which vintage was actually used at each scoring date.
with periods as (
    -- Annual Dec 31 scoring dates that appear anywhere in the panel.
    select distinct period_end_date
    from {{ ref('stg_fhfa_hpi') }}
    where extract(month from period_end_date) = 12
),

-- ACS 1-year: for each (fips, scoring_period), pick the vintage row whose
-- as_of_date <= scoring_period, ordered by data period (newer first).
acs_1yr_pit as (
    select
        p.period_end_date as scoring_period,
        a.fips,
        a.period_end_date as acs_data_period,
        a.as_of_date,
        a.median_household_income,
        a.median_gross_rent,
        a.median_home_value,
        a.rental_vacancy_rate
    from periods p
    join {{ ref('stg_census_acs_1yr') }} a
        on a.as_of_date <= p.period_end_date
    qualify row_number() over (
        partition by a.fips, p.period_end_date
        order by a.period_end_date desc, a.as_of_date desc
    ) = 1
),

-- ACS 5-year: same pattern, wider coverage (all ~3,220 counties).
acs_5yr_pit as (
    select
        p.period_end_date as scoring_period,
        a.fips,
        a.period_end_date as acs_data_period,
        a.as_of_date,
        a.median_household_income,
        a.median_gross_rent,
        a.median_home_value,
        a.rental_vacancy_rate
    from periods p
    join {{ ref('stg_census_acs')  }} a
        on a.as_of_date <= p.period_end_date
    qualify row_number() over (
        partition by a.fips, p.period_end_date
        order by a.period_end_date desc, a.as_of_date desc
    ) = 1
),

preferred as (
    -- Coalesce: use 1yr values when present for the (fips, scoring_period),
    -- else fall back to 5yr. Track which source was used per row.
    select
        u.fips,
        coalesce(a1.scoring_period, a5.scoring_period) as period_end_date,
        coalesce(a1.median_household_income, a5.median_household_income) as median_household_income,
        coalesce(a1.median_gross_rent,      a5.median_gross_rent)       as median_gross_rent,
        coalesce(a1.median_home_value,      a5.median_home_value)       as median_home_value,
        coalesce(a1.rental_vacancy_rate,    a5.rental_vacancy_rate)     as rental_vacancy_rate,
        coalesce(a1.acs_data_period, a5.acs_data_period) as acs_data_period,
        coalesce(a1.as_of_date,      a5.as_of_date)      as acs_as_of_date,
        case
            when a1.fips is not null then '1yr'
            when a5.fips is not null then '5yr'
            else 'none'
        end as acs_source
    from {{ ref('int_universe') }} u
    join periods p on true
    left join acs_1yr_pit a1 on a1.fips = u.fips and a1.scoring_period = p.period_end_date
    left join acs_5yr_pit a5 on a5.fips = u.fips and a5.scoring_period = p.period_end_date
    where coalesce(a1.scoring_period, a5.scoring_period) is not null
)

select
    fips,
    period_end_date,
    rental_vacancy_rate,
    case
        when median_gross_rent is null or median_household_income is null
             or median_household_income = 0 then null
        else (median_gross_rent * 12.0) / median_household_income
    end as rent_to_income_ratio,
    case
        when median_gross_rent is null or median_home_value is null
             or median_home_value = 0 then null
        else (median_gross_rent * 12.0) / median_home_value
    end as cap_rate_proxy,
    median_gross_rent,
    median_home_value,
    median_household_income,
    acs_source,
    acs_data_period,
    acs_as_of_date
from preferred
