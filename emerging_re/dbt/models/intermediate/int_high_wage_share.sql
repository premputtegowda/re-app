-- Tier 1 signal: high-wage employment share.
--
-- The framework treats concentration in high-wage sectors as a demand
-- signal (higher household income → willingness/ability to pay more for
-- housing). Defined as employment in NAICS supersectors 51+52+54+55 as a
-- fraction of total county employment:
--
--   NAICS 51 = Information (tech, media, publishing)
--   NAICS 52 = Finance and Insurance
--   NAICS 54 = Professional, Scientific, and Technical Services
--   NAICS 55 = Management of Companies and Enterprises
--
-- Two features emitted:
--   1. `high_wage_share` — the current fraction, e.g. 0.25 means 25% of
--      the county's private jobs are in these four supersectors
--   2. `high_wage_share_yoy_chg` — year-over-year change (t vs t-1),
--      captures whether the county's mix is TILTING toward high-wage or
--      away from it
--
-- Denominator is county total (agglvl 70, all ownerships) not private-
-- only, so it's comparable across counties with different
-- public/private mixes. Numerator is private supersectors (agglvl 74,
-- own=5) since these four industries are almost entirely private
-- anyway; using private avoids double-counting government workers in
-- e.g. federal information services.
with total_emp as (
    -- agglvl=70 rows are the county headline (all industries, all
    -- ownerships). One row per (fips, period).
    select
        fips,
        period_end_date,
        annual_avg_emplvl as total_emp
    from {{ ref('stg_bls_qcew') }}
    where agglvl_code = 70
    qualify row_number() over (partition by fips, period_end_date order by as_of_date desc) = 1
),

high_wage_emp as (
    -- agglvl=74 with own=5 (private) is the supersector breakdown.
    -- Sum the four high-wage industry codes to a single per-county
    -- number.
    select
        fips,
        period_end_date,
        sum(annual_avg_emplvl) as high_wage_emp
    from {{ ref('stg_bls_qcew') }}
    where agglvl_code = 74
      and own_code = 5
      and industry_code in ('51', '52', '54', '55')
    group by fips, period_end_date, as_of_date
    qualify row_number() over (partition by fips, period_end_date order by as_of_date desc) = 1
),

per_period as (
    select
        t.fips,
        t.period_end_date,
        t.total_emp,
        coalesce(h.high_wage_emp, 0) as high_wage_emp,
        case
            when t.total_emp is null or t.total_emp = 0 then null
            else coalesce(h.high_wage_emp, 0) * 1.0 / t.total_emp
        end as high_wage_share
    from total_emp t
    left join high_wage_emp h using (fips, period_end_date)
),

with_yoy as (
    -- Date-based join for the t-1 row. QCEW annual is period_end =
    -- Dec 31, so t - 1 year = last year's Dec 31, an exact match.
    select
        p_now.fips,
        p_now.period_end_date,
        p_now.total_emp,
        p_now.high_wage_emp,
        p_now.high_wage_share,
        p_prev.high_wage_share as high_wage_share_t_minus_1,
        p_now.high_wage_share - p_prev.high_wage_share as high_wage_share_yoy_chg
    from per_period p_now
    left join per_period p_prev
        on p_prev.fips = p_now.fips
        and p_prev.period_end_date = p_now.period_end_date - interval '1 year'
)

select
    w.fips,
    w.period_end_date,
    w.total_emp,
    w.high_wage_emp,
    w.high_wage_share,
    w.high_wage_share_yoy_chg
from with_yoy w
inner join {{ ref('int_universe') }} u using (fips)
