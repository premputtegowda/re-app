-- Tier 2 signal: building permits intensity vs county's own history.
--
-- Framework: "Permits/1000 residents vs county's own 10yr average."
-- Ratio >1 = above trend (supply catching up); ratio <1 = below trend
-- (supply constrained). Combined with Tier 1 demand signals this is the
-- framework's core supply-demand tension proxy.
--
-- Features emitted per (fips, period_end_date):
--   - `permits_per_1000` — current year's total units permitted per 1000 residents
--   - `permits_per_1000_3yr_avg` — rolling avg of last 3 years (t-2, t-1, t)
--   - `permits_per_1000_10yr_baseline` — mean of t-10 through t-1
--     (EXCLUDES current year so the ratio isn't self-referential)
--   - `permits_intensity_ratio` — current / 10yr baseline
--   - `permits_10yr_baseline_years_available` — how many of the 10 prior
--     years had data (for coverage-aware filtering downstream)
--
-- Coverage note: BPS pre-2022 has ~45% coverage of pop>=50k universe
-- (DECISIONS.md §3). For counties missing pre-2022 history, the 10yr
-- baseline will be NULL and downstream models can filter or use
-- fallback logic.
with bps as (
    -- Annual permit totals. period_end_date = Dec 31 of year (or last
    -- day of latest available month for current year — filtered out
    -- below since we only want full annual counts).
    select
        fips,
        period_end_date,
        units_total
    from {{ ref('stg_census_bps') }}
    -- Restrict to Dec-end rows (full-year totals). Partial-year current
    -- rows would distort the per-1000 metric.
    where date_trunc('month', period_end_date) = date_trunc('month', make_date(year(period_end_date), 12, 1))
),

pep as (
    -- PEP is annual, period_end = July 1. Use latest vintage per period.
    select
        fips,
        year(period_end_date) as year,
        popestimate
    from {{ ref('stg_census_pep') }}
    qualify row_number() over (partition by fips, period_end_date order by as_of_date desc) = 1
),

joined as (
    -- Join BPS (Dec 31) to PEP (July 1) on year — PEP July 1 pop is the
    -- best available mid-year population for the annual permit total.
    select
        b.fips,
        b.period_end_date,
        b.units_total,
        p.popestimate,
        case
            when p.popestimate is null or p.popestimate = 0 then null
            else 1000.0 * b.units_total / p.popestimate
        end as permits_per_1000
    from bps b
    left join pep p
        on p.fips = b.fips
        and p.year = year(b.period_end_date)
),

with_history as (
    -- Self-join to collect prior 10 years' rates for the baseline
    -- calculation. Date-based join (annual step) so gaps are respected.
    -- Using array_agg + list_avg (DuckDB) to compute mean over the
    -- non-null subset — that's how we handle the BPS coverage cliff
    -- gracefully.
    select
        j_now.fips,
        j_now.period_end_date,
        j_now.units_total,
        j_now.popestimate,
        j_now.permits_per_1000,
        -- 3-year rolling avg (t-2, t-1, t) — captures recent trend.
        (
            select avg(x) from unnest([
                j_now.permits_per_1000,
                (select permits_per_1000 from joined j where j.fips = j_now.fips and j.period_end_date = j_now.period_end_date - interval '1 year'),
                (select permits_per_1000 from joined j where j.fips = j_now.fips and j.period_end_date = j_now.period_end_date - interval '2 years')
            ]) t(x)
            where x is not null
        ) as permits_per_1000_3yr_avg,
        -- 10-year baseline uses t-10 through t-1 (EXCLUDES current year
        -- so ratio isn't self-referential). Correlated subqueries feel
        -- clunky in SQL — but avoid a huge multi-lag join and stay
        -- readable in the small.
        (
            select avg(j.permits_per_1000)
            from joined j
            where j.fips = j_now.fips
              and j.period_end_date >= j_now.period_end_date - interval '10 years'
              and j.period_end_date <  j_now.period_end_date
              and j.permits_per_1000 is not null
        ) as permits_per_1000_10yr_baseline,
        (
            select count(*)
            from joined j
            where j.fips = j_now.fips
              and j.period_end_date >= j_now.period_end_date - interval '10 years'
              and j.period_end_date <  j_now.period_end_date
              and j.permits_per_1000 is not null
        ) as permits_10yr_baseline_years_available
    from joined j_now
)

select
    w.fips,
    w.period_end_date,
    w.units_total,
    w.popestimate,
    w.permits_per_1000,
    w.permits_per_1000_3yr_avg,
    w.permits_per_1000_10yr_baseline,
    case
        when w.permits_per_1000_10yr_baseline is null
             or w.permits_per_1000_10yr_baseline = 0 then null
        else w.permits_per_1000 / w.permits_per_1000_10yr_baseline
    end as permits_intensity_ratio,
    w.permits_10yr_baseline_years_available
from with_history w
inner join {{ ref('int_universe') }} u using (fips)
