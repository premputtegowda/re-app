-- Rent catch-up features — mean-reversion signal for markets that have
-- UNDERGROWN vs peers. Complements the momentum-heavy composite.
--
-- Backtest of 2022→2025 tertiary diversified showed our composite
-- systematically MISSED the winners (Vermilion IL, Clark OH, Broome NY,
-- Elmore AL — all cheap catch-up markets) because we have zero
-- mean-reversion features. Every ZORI/HPI signal is momentum-oriented.
--
-- Features (per fips, period_end_date):
--   1. `zori_5yr_cagr_deficit` — this county's 5yr rent CAGR minus
--      national avg. Negative = underperformed = catch-up candidate.
--      Sign for composite: -1 (more negative = more attractive).
--   2. `hpi_5yr_cagr_deficit` — same for price appreciation.
--
-- The intent: identify markets that DIDN'T participate in the 2020-2022
-- boom → will benefit from rent inflation catch-up as expensive markets
-- get priced out.
with zori_annual as (
    -- Dec ZORI per fips per year.
    select fips, period_end_date, zori
    from {{ ref('stg_zillow_zori') }}
    where extract(month from period_end_date) = 12
    qualify row_number() over (partition by fips, period_end_date order by as_of_date desc) = 1
),

hpi_annual as (
    select fips, period_end_date, hpi
    from {{ ref('stg_fhfa_hpi') }}
    qualify row_number() over (partition by fips, period_end_date order by as_of_date desc) = 1
),

zori_5yr_cagr as (
    -- Compute per-period trailing 5yr CAGR from monthly ZORI series.
    select
        z_now.fips,
        z_now.period_end_date,
        z_now.zori as zori_now,
        z_5.zori as zori_5yr_ago,
        case
            when z_5.zori is null or z_5.zori = 0 then null
            else pow(z_now.zori / z_5.zori, 1.0/5) - 1
        end as zori_5yr_cagr
    from zori_annual z_now
    left join zori_annual z_5
        on z_5.fips = z_now.fips
        and z_5.period_end_date = z_now.period_end_date - interval '5 years'
),

hpi_5yr_cagr as (
    select
        h_now.fips,
        h_now.period_end_date,
        case
            when h_5.hpi is null or h_5.hpi = 0 then null
            else pow(h_now.hpi / h_5.hpi, 1.0/5) - 1
        end as hpi_5yr_cagr
    from hpi_annual h_now
    left join hpi_annual h_5
        on h_5.fips = h_now.fips
        and h_5.period_end_date = h_now.period_end_date - interval '5 years'
),

-- National averages per period — the reference point.
natl_zori as (
    select
        period_end_date,
        avg(zori_5yr_cagr) as natl_zori_5yr_cagr,
        median(zori_5yr_cagr) as natl_zori_5yr_median
    from zori_5yr_cagr
    where zori_5yr_cagr is not null
    group by period_end_date
),

natl_hpi as (
    select
        period_end_date,
        avg(hpi_5yr_cagr) as natl_hpi_5yr_cagr,
        median(hpi_5yr_cagr) as natl_hpi_5yr_median
    from hpi_5yr_cagr
    where hpi_5yr_cagr is not null
    group by period_end_date
)

select
    coalesce(z.fips, h.fips) as fips,
    coalesce(z.period_end_date, h.period_end_date) as period_end_date,
    z.zori_5yr_cagr,
    h.hpi_5yr_cagr,
    nz.natl_zori_5yr_cagr,
    nh.natl_hpi_5yr_cagr,
    -- Deficits: negative = county underperformed national → catch-up potential.
    z.zori_5yr_cagr - nz.natl_zori_5yr_cagr as zori_5yr_cagr_deficit,
    h.hpi_5yr_cagr - nh.natl_hpi_5yr_cagr as hpi_5yr_cagr_deficit
from zori_5yr_cagr z
full outer join hpi_5yr_cagr h using (fips, period_end_date)
left join natl_zori nz on nz.period_end_date = coalesce(z.period_end_date, h.period_end_date)
left join natl_hpi nh on nh.period_end_date = coalesce(z.period_end_date, h.period_end_date)
inner join {{ ref('int_universe') }} u on u.fips = coalesce(z.fips, h.fips)
