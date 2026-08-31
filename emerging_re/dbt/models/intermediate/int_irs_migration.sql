-- IRS SOI migration — normalized county-level features.
--
-- Raw stg_irs_soi_migration gives inflow/outflow returns + AGI per return.
-- Raw counts don't compare across counties of different sizes, so this
-- model normalizes by PEP population and derives the theoretically
-- interesting composite metrics.
--
-- Features (candidates for composite scoring — ablation will decide):
--   1. `irs_net_migration_rate` — net households moving in per 1000
--      population. Direct household-level demand signal.
--   2. `irs_inflow_rate` — gross inflow returns per 1000 population.
--      Raw churn intensity (some markets have high inflow AND outflow;
--      captures "attention" independent of net).
--   3. `irs_income_gap` — (inflow_agi_per_return − outflow_agi_per_return).
--      Positive = movers-in earn MORE than movers-out = future rent
--      capacity growth. In current top-20 MF markets, 19/20 are negative
--      (tenant income erosion), so this is a hard rare signal.
--   4. `irs_income_gap_pct` — same as #3 but normalized by outflow_agi.
--      Removes scale (helps compare $10K gap in $50K market vs $10K in
--      $150K market).
--   5. `irs_net_agi_per_capita` — aggregate income $$ flowing in net, per
--      person. Combines migration volume AND income levels.
--
-- Sign for composite scoring: all features naturally +1 (higher = more
-- attractive for MF investing).
--
-- Timing note: IRS SOI has ~2 year publish lag. The scoring model joins
-- by year-of-period, so for scoring at Dec 31 of year Y, uses the IRS
-- vintage covering tax year Y (if available). Backtest respects
-- as_of_date to prevent look-ahead.
with pep as (
    select fips, period_end_date, popestimate
    from {{ ref('stg_census_pep') }}
    qualify row_number() over (partition by fips, period_end_date order by as_of_date desc) = 1
),

irs as (
    -- Latest vintage per (fips, tax year). IRS SOI period_end_date =
    -- Dec 31 of the tax year.
    select
        fips,
        period_end_date,
        inflow_returns,
        outflow_returns,
        inflow_agi_per_return,
        outflow_agi_per_return,
        net_migration_returns,
        net_agi_thousands
    from {{ ref('stg_irs_soi_migration') }}
    qualify row_number() over (partition by fips, period_end_date order by as_of_date desc) = 1
),

joined as (
    -- Match IRS tax year to PEP year (both period_end = late-year snapshot).
    -- IRS is Dec 31; PEP is Jul 1 — small drift but same calendar year.
    select
        i.fips,
        i.period_end_date,
        p.popestimate,
        i.inflow_returns,
        i.outflow_returns,
        i.inflow_agi_per_return,
        i.outflow_agi_per_return,
        i.net_migration_returns,
        i.net_agi_thousands
    from irs i
    left join pep p
        on p.fips = i.fips
        and year(p.period_end_date) = year(i.period_end_date)
)

select
    fips,
    period_end_date,
    popestimate as pep_population,
    -- Rate metrics (normalized by population). Multiply by 1000 for readability.
    1000.0 * net_migration_returns / nullif(popestimate, 0) as irs_net_migration_rate,
    1000.0 * inflow_returns        / nullif(popestimate, 0) as irs_inflow_rate,
    1000.0 * outflow_returns       / nullif(popestimate, 0) as irs_outflow_rate,
    -- Income quality of movers.
    inflow_agi_per_return  as irs_inflow_avg_income,
    outflow_agi_per_return as irs_outflow_avg_income,
    inflow_agi_per_return - outflow_agi_per_return as irs_income_gap,
    -- Normalized income gap: (inflow - outflow) / outflow.
    (inflow_agi_per_return - outflow_agi_per_return)
        / nullif(outflow_agi_per_return, 0) as irs_income_gap_pct,
    -- Aggregate net income flow per capita ($ per person).
    -- net_agi_thousands is $ thousands, so × 1000 / population = $ per person.
    1000.0 * net_agi_thousands / nullif(popestimate, 0) as irs_net_agi_per_capita
from joined
-- Restrict to universe so we're not computing for counties we'd never score.
inner join {{ ref('int_universe') }} u using (fips)
