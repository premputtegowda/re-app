-- Multi-family (10-20 unit) investor-oriented features.
--
-- Emits per (fips):
--   `renter_share`               ACS renter / (renter + owner)
--   `mf_permit_ratio`            BPS units_5plus / units_total (trailing 3yr)
--   `rental_vacancy_change_3yr`  ACS 1yr vacancy trend (NULL for 5yr-only)
--   `rental_vacancy_rate`        current (level)
--   `mf_cap_rate_estimated`      2BR FMR × 12 / median_home_value + 1.5% MF premium
--   `sfr_cap_rate_proxy`         ACS median rent × 12 / median_home_value (from mart_county_context — reproduced here for direct comparison)
--
-- MF cap rate design:
--   Numerator: HUD FMR 2BR (MF-oriented, 40th percentile)
--   Denominator: ACS median_home_value (still SFR-biased, but closest
--     available for county-level home values)
--   Premium: fixed +1.5% (midpoint of the 100-200 bps range typical for
--     10-20 unit MF vs SFR investor economics — commercial financing,
--     PM overhead, vacancy/turnover exposure, value-add expectation).
--
-- This is an ESTIMATE, not a real cap rate. Actual 10-20 unit MF deals
-- in any specific market will vary 50-100 bps around this figure
-- depending on property class, condition, and local investor demand.
with acs_1yr_latest as (
    select
        fips, period_end_date,
        owner_occupied_units, renter_occupied_units, rental_vacancy_rate,
        median_home_value, median_gross_rent
    from {{ ref('stg_census_acs_1yr') }}
    qualify row_number() over (partition by fips order by period_end_date desc, as_of_date desc) = 1
),

acs_1yr_3yr_ago as (
    select
        a.fips,
        a.rental_vacancy_rate as vacancy_3yr_ago
    from {{ ref('stg_census_acs_1yr') }} a
    inner join acs_1yr_latest curr
        on curr.fips = a.fips
        and a.period_end_date = curr.period_end_date - interval '3 years'
    qualify row_number() over (partition by a.fips order by a.as_of_date desc) = 1
),

acs_5yr_latest as (
    select
        fips, period_end_date,
        owner_occupied_units, renter_occupied_units, rental_vacancy_rate,
        median_home_value, median_gross_rent
    from {{ ref('stg_census_acs') }}
    qualify row_number() over (partition by fips order by period_end_date desc, as_of_date desc) = 1
),

acs_preferred as (
    select
        u.fips,
        coalesce(a1.owner_occupied_units, a5.owner_occupied_units) as owner_occupied_units,
        coalesce(a1.renter_occupied_units, a5.renter_occupied_units) as renter_occupied_units,
        coalesce(a1.rental_vacancy_rate, a5.rental_vacancy_rate) as rental_vacancy_rate,
        coalesce(a1.median_home_value, a5.median_home_value) as median_home_value,
        coalesce(a1.median_gross_rent, a5.median_gross_rent) as median_gross_rent,
        a13.vacancy_3yr_ago
    from {{ ref('int_universe') }} u
    left join acs_1yr_latest a1 using (fips)
    left join acs_5yr_latest a5 using (fips)
    left join acs_1yr_3yr_ago a13 using (fips)
),

fmr_latest as (
    -- Latest FY FMR per fips (2BR primary + other bedroom counts for UI).
    select
        fips, fmr_0br, fmr_1br, fmr_2br, fmr_3br, fmr_4br,
        period_end_date as fmr_period_end
    from {{ ref('stg_hud_fmr') }}
    qualify row_number() over (partition by fips order by period_end_date desc, as_of_date desc) = 1
),

bps_recent as (
    select
        fips,
        sum(units_5plus) as mf_units_3yr,
        sum(units_total) as total_units_3yr
    from {{ ref('stg_census_bps') }}
    where period_end_date in (date '2023-12-31', date '2024-12-31', date '2025-12-31')
    group by fips
),

joined as (
    select
        a.fips,
        a.owner_occupied_units, a.renter_occupied_units, a.rental_vacancy_rate,
        a.vacancy_3yr_ago, a.median_home_value, a.median_gross_rent,
        f.fmr_2br, f.fmr_1br, f.fmr_3br,
        b.mf_units_3yr, b.total_units_3yr
    from acs_preferred a
    left join fmr_latest f using (fips)
    left join bps_recent b using (fips)
)

select
    fips,
    -- Renter share
    case
        when owner_occupied_units is null or renter_occupied_units is null then null
        when (owner_occupied_units + renter_occupied_units) = 0 then null
        else 1.0 * renter_occupied_units / (owner_occupied_units + renter_occupied_units)
    end as renter_share,
    -- MF permit ratio
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
    -- SFR-ish cap rate proxy (for direct comparison — same math as mart_county_context)
    case
        when median_gross_rent is null or median_home_value is null
             or median_home_value = 0 then null
        else (median_gross_rent * 12.0) / median_home_value
    end as sfr_cap_rate_proxy,
    -- MF cap rate (2BR FMR method): 2BR FMR × 12 / home value + 1.5% MF premium.
    -- Uses HUD's MF-oriented rent (Section 8 40th percentile of standard-quality).
    case
        when fmr_2br is null or median_home_value is null
             or median_home_value = 0 then null
        else (fmr_2br * 12.0) / median_home_value + 0.015
    end as mf_cap_rate_estimated,
    -- Alternative MF cap rate (SFR-proxy + 1.5% premium method).
    -- Uses ACS median gross rent (all-inventory blend) + same premium.
    -- Comparison lets investor sanity-check the FMR-based number.
    case
        when median_gross_rent is null or median_home_value is null
             or median_home_value = 0 then null
        else (median_gross_rent * 12.0) / median_home_value + 0.015
    end as mf_cap_rate_from_sfr,
    -- Also expose raw 2BR FMR for UI display
    fmr_2br,
    fmr_1br,
    fmr_3br
from joined
