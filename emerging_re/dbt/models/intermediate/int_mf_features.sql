-- Multi-family (10-20 unit) investor-oriented features. PIT-correct.
--
-- Grain: one row per (fips, scoring_period_end). Each row uses ACS + FMR
-- vintage data that was PUBLICLY AVAILABLE by the scoring date, enforced
-- via as_of_date filters. BPS (permits) is naturally time-series and
-- aggregated over a trailing 3-year window ending at scoring_period.
--
-- Emits per (fips, scoring_period_end):
--   `renter_share`               ACS renter / (renter + owner)
--   `mf_permit_ratio`            BPS units_5plus / units_total (trailing 3yr)
--   `rental_vacancy_change_3yr`  ACS 1yr vacancy trend (NULL for 5yr-only)
--   `rental_vacancy_rate`        current-at-scoring-period ACS level
--   `mf_cap_rate_estimated`      2BR FMR × 12 / median_home_value + 1.5% MF premium
--   `sfr_cap_rate_proxy`         ACS median rent × 12 / median_home_value
--   `fmr_2br`, `fmr_1br`, `fmr_3br`  raw FMR (UI display)
with periods as (
    select distinct period_end_date
    from {{ ref('stg_fhfa_hpi') }}
    where extract(month from period_end_date) = 12
),

-- ACS 1-year: PIT snapshot per (fips, scoring_period).
acs_1yr_pit as (
    select
        p.period_end_date as scoring_period,
        a.fips,
        a.period_end_date as acs_data_period,
        a.owner_occupied_units, a.renter_occupied_units, a.rental_vacancy_rate,
        a.median_home_value, a.median_gross_rent
    from periods p
    join {{ ref('stg_census_acs_1yr') }} a
        on a.as_of_date <= p.period_end_date
    qualify row_number() over (
        partition by a.fips, p.period_end_date
        order by a.period_end_date desc, a.as_of_date desc
    ) = 1
),

-- Vacancy 3yr ago: for each (fips, scoring_period), find the ACS 1yr row
-- whose data period is exactly 3 years before the CURRENT PIT data period,
-- and that was also publicly available by scoring_period.
acs_1yr_3yr_ago as (
    select
        curr.fips,
        curr.scoring_period,
        old.rental_vacancy_rate as vacancy_3yr_ago
    from acs_1yr_pit curr
    join {{ ref('stg_census_acs_1yr') }} old
        on old.fips = curr.fips
        and old.period_end_date = curr.acs_data_period - interval '3 years'
        and old.as_of_date <= curr.scoring_period
    qualify row_number() over (
        partition by curr.fips, curr.scoring_period
        order by old.as_of_date desc
    ) = 1
),

-- ACS 5-year fallback (all counties).
acs_5yr_pit as (
    select
        p.period_end_date as scoring_period,
        a.fips,
        a.owner_occupied_units, a.renter_occupied_units, a.rental_vacancy_rate,
        a.median_home_value, a.median_gross_rent
    from periods p
    join {{ ref('stg_census_acs')  }} a
        on a.as_of_date <= p.period_end_date
    qualify row_number() over (
        partition by a.fips, p.period_end_date
        order by a.period_end_date desc, a.as_of_date desc
    ) = 1
),

acs_preferred as (
    select
        u.fips,
        p.period_end_date,
        coalesce(a1.owner_occupied_units,  a5.owner_occupied_units)  as owner_occupied_units,
        coalesce(a1.renter_occupied_units, a5.renter_occupied_units) as renter_occupied_units,
        coalesce(a1.rental_vacancy_rate,   a5.rental_vacancy_rate)   as rental_vacancy_rate,
        coalesce(a1.median_home_value,     a5.median_home_value)     as median_home_value,
        coalesce(a1.median_gross_rent,     a5.median_gross_rent)     as median_gross_rent,
        a13.vacancy_3yr_ago
    from {{ ref('int_universe') }} u
    cross join periods p
    left join acs_1yr_pit    a1  on a1.fips = u.fips  and a1.scoring_period = p.period_end_date
    left join acs_5yr_pit    a5  on a5.fips = u.fips  and a5.scoring_period = p.period_end_date
    left join acs_1yr_3yr_ago a13 on a13.fips = u.fips and a13.scoring_period = p.period_end_date
),

-- FMR: PIT snapshot per (fips, scoring_period).
fmr_pit as (
    select
        p.period_end_date as scoring_period,
        f.fips,
        f.fmr_0br, f.fmr_1br, f.fmr_2br, f.fmr_3br, f.fmr_4br
    from periods p
    join {{ ref('stg_hud_fmr') }} f
        on f.as_of_date <= p.period_end_date
    qualify row_number() over (
        partition by f.fips, p.period_end_date
        order by f.period_end_date desc, f.as_of_date desc
    ) = 1
),

-- BPS permits: 3-year trailing sum ending at each scoring period. BPS is
-- natural time-series (monthly/annual) so this is naturally PIT.
bps_trailing_3yr as (
    select
        p.period_end_date as scoring_period,
        b.fips,
        sum(b.units_5plus) as mf_units_3yr,
        sum(b.units_total) as total_units_3yr
    from periods p
    join {{ ref('stg_census_bps') }} b
        on b.fips is not null
        and b.period_end_date <= p.period_end_date
        and b.period_end_date > p.period_end_date - interval '3 years'
    group by p.period_end_date, b.fips
),

joined as (
    select
        a.fips,
        a.period_end_date,
        a.owner_occupied_units, a.renter_occupied_units, a.rental_vacancy_rate,
        a.vacancy_3yr_ago, a.median_home_value, a.median_gross_rent,
        f.fmr_2br, f.fmr_1br, f.fmr_3br,
        b.mf_units_3yr, b.total_units_3yr
    from acs_preferred a
    left join fmr_pit          f on f.fips = a.fips and f.scoring_period = a.period_end_date
    left join bps_trailing_3yr b on b.fips = a.fips and b.scoring_period = a.period_end_date
)

select
    fips,
    period_end_date,
    -- Renter share
    case
        when owner_occupied_units is null or renter_occupied_units is null then null
        when (owner_occupied_units + renter_occupied_units) = 0 then null
        else 1.0 * renter_occupied_units / (owner_occupied_units + renter_occupied_units)
    end as renter_share,
    -- MF permit ratio (trailing 3yr)
    case
        when total_units_3yr is null or total_units_3yr = 0 then null
        else 1.0 * mf_units_3yr / total_units_3yr
    end as mf_permit_ratio,
    -- Rental vacancy trend + level
    rental_vacancy_rate,
    vacancy_3yr_ago,
    case
        when rental_vacancy_rate is null or vacancy_3yr_ago is null then null
        else rental_vacancy_rate - vacancy_3yr_ago
    end as rental_vacancy_change_3yr,
    -- SFR-ish cap rate proxy
    case
        when median_gross_rent is null or median_home_value is null
             or median_home_value = 0 then null
        else (median_gross_rent * 12.0) / median_home_value
    end as sfr_cap_rate_proxy,
    -- MF cap rate (2BR FMR method)
    case
        when fmr_2br is null or median_home_value is null
             or median_home_value = 0 then null
        else (fmr_2br * 12.0) / median_home_value + 0.015
    end as mf_cap_rate_estimated,
    -- Alt MF cap rate (SFR-proxy + 1.5% premium)
    case
        when median_gross_rent is null or median_home_value is null
             or median_home_value = 0 then null
        else (median_gross_rent * 12.0) / median_home_value + 0.015
    end as mf_cap_rate_from_sfr,
    fmr_2br, fmr_1br, fmr_3br
from joined
