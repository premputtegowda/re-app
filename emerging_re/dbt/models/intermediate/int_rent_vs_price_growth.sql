-- Tier 3 signal: rent growth vs price growth.
--
-- Framework: "Rent growth exceeding price growth — the most important
-- single criterion. 12-24mo opportunity window."
--
-- Rationale: when rents rise faster than prices, cap rates expand
-- (yield goes up before prices catch up). That's the classic emerging-
-- market entry window — cash flow improves before appreciation prices
-- you out. When rents lag prices, the market has already run and
-- yields are compressed.
--
-- Cadence: annual. HPI is annual (Dec 31), ZORI is monthly. We compare
-- Dec-to-Dec YoY changes for both so the two series line up on the
-- same period_end_date.
--
-- Features per (fips, period_end_date):
--   - `hpi_yoy` — FHFA 1-year change
--   - `zori_yoy` — Zillow ZORI 1-year change (Dec to Dec)
--   - `rent_minus_price_growth` — zori_yoy minus hpi_yoy
--     Positive = rent outpacing price = Tier 3 signal firing
--     Negative = price outpacing rent = late-cycle risk
with hpi as (
    -- Latest vintage per (fips, Dec 31 period).
    select
        fips,
        period_end_date,
        hpi
    from {{ ref('stg_fhfa_hpi') }}
    qualify row_number() over (partition by fips, period_end_date order by as_of_date desc) = 1
),

hpi_yoy as (
    -- Year-over-year HPI change. Date-based join (same lesson as
    -- mart_hpi_forward_returns_24mo — Manhattan and low-repeat-sales
    -- counties have gaps).
    select
        h_now.fips,
        h_now.period_end_date,
        h_now.hpi as hpi_now,
        h_prev.hpi as hpi_prior_year,
        case
            when h_prev.hpi is null or h_prev.hpi = 0 then null
            else (h_now.hpi / h_prev.hpi) - 1
        end as hpi_yoy
    from hpi h_now
    left join hpi h_prev
        on h_prev.fips = h_now.fips
        and h_prev.period_end_date = h_now.period_end_date - interval '1 year'
),

zori_dec as (
    -- Pull only December months of ZORI so it aligns with HPI's Dec 31
    -- cadence. Zillow's period_end is the last day of the month, so
    -- Dec 31 for each year.
    select
        fips,
        period_end_date,
        zori
    from {{ ref('stg_zillow_zori') }}
    where extract(month from period_end_date) = 12
    qualify row_number() over (partition by fips, period_end_date order by as_of_date desc) = 1
),

zori_yoy as (
    select
        z_now.fips,
        z_now.period_end_date,
        z_now.zori as zori_now,
        z_prev.zori as zori_prior_year,
        case
            when z_prev.zori is null or z_prev.zori = 0 then null
            else (z_now.zori / z_prev.zori) - 1
        end as zori_yoy
    from zori_dec z_now
    left join zori_dec z_prev
        on z_prev.fips = z_now.fips
        and z_prev.period_end_date = z_now.period_end_date - interval '1 year'
),

joined as (
    -- Both keyed on Dec 31 period. Inner join — we only want rows
    -- where BOTH signals exist (no Tier 3 signal computable otherwise).
    select
        h.fips,
        h.period_end_date,
        h.hpi_now,
        h.hpi_yoy,
        z.zori_now,
        z.zori_yoy,
        case
            when h.hpi_yoy is null or z.zori_yoy is null then null
            else z.zori_yoy - h.hpi_yoy
        end as rent_minus_price_growth
    from hpi_yoy h
    inner join zori_yoy z using (fips, period_end_date)
)

select
    j.fips,
    j.period_end_date,
    j.hpi_now,
    j.hpi_yoy,
    j.zori_now,
    j.zori_yoy,
    j.rent_minus_price_growth
from joined j
inner join {{ ref('int_universe') }} u using (fips)
where j.rent_minus_price_growth is not null
