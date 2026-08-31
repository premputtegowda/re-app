-- FAA airport enplanement growth — leading indicator for economic activity.
--
-- Hypothesis: airport passenger boarding growth predicts real-estate demand
-- with a 12-24 month lead. New business travel, tourism uptick, and
-- corporate/tech migration all show up in enplanements before they show up
-- in HPI/ZORI.
--
-- Empirical: 5yr growth 2019→2025 shows dramatic divergence:
--   Bozeman MT (Gallatin, 30031): 795K → 1.4M (+78%)
--   Provo UT (Utah, 49049):       110K → 531K (+382%)
--   Bradenton FL (Manatee, 12081): 978K → 2.2M (+129%)
--   Nashville (Davidson, 47037): +40%
--   San Antonio (Bexar, 48029):  +4% (mature market baseline)
--
-- Features (candidates):
--   1. `enp_yoy` — 1yr growth
--   2. `enp_cagr_3yr` — 3yr CAGR (smoother)
--   3. `enp_growth_vs_natl_pp` — YoY minus national YoY (macro-normalized;
--      captures market-specific outperformance vs sector-wide travel recovery)
--
-- Sign for composite: all naturally +1.
--
-- Coverage caveat: only counties with commercial airports (~415) have
-- non-null data. Counties without airports get median-imputed by
-- scoring — effectively no contribution but no penalty.
with faa as (
    select
        fips,
        period_end_date,
        total_enplanements
    from {{ ref('stg_faa_enplanements') }}
    where total_enplanements is not null and total_enplanements > 0
    qualify row_number() over (partition by fips, period_end_date order by as_of_date desc) = 1
),

with_lags as (
    select
        f_now.fips,
        f_now.period_end_date,
        f_now.total_enplanements,
        f_1.total_enplanements as enp_t_minus_1,
        f_3.total_enplanements as enp_t_minus_3
    from faa f_now
    left join faa f_1
        on f_1.fips = f_now.fips
        and f_1.period_end_date = f_now.period_end_date - interval '1 year'
    left join faa f_3
        on f_3.fips = f_now.fips
        and f_3.period_end_date = f_now.period_end_date - interval '3 years'
),

with_growth as (
    select
        *,
        total_enplanements / nullif(enp_t_minus_1, 0) - 1 as enp_yoy,
        power(total_enplanements / nullif(enp_t_minus_3, 0), 1.0/3) - 1 as enp_cagr_3yr
    from with_lags
),

-- National average YoY, weighted by enplanement volume (so ATL/LAX
-- dominate the sector-wide recovery baseline).
natl_avg as (
    select
        period_end_date,
        sum(enp_yoy * total_enplanements) / nullif(sum(total_enplanements), 0)
            as natl_enp_yoy
    from with_growth
    where enp_yoy is not null
    group by period_end_date
)

select
    g.fips,
    g.period_end_date,
    g.total_enplanements,
    g.enp_yoy,
    g.enp_cagr_3yr,
    g.enp_yoy - n.natl_enp_yoy as enp_growth_vs_natl_pp
from with_growth g
left join natl_avg n on n.period_end_date = g.period_end_date
inner join {{ ref('int_universe') }} u on u.fips = g.fips
