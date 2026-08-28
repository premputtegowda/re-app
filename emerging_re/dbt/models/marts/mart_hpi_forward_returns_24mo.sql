-- Target A per DECISIONS.md §7: forward 24-month FHFA HPI change,
-- demeaned cross-sectionally vs the national median.
--
-- Interpretation: rows with target > 0 outperformed the median county
-- over the following 24 months; rows with target < 0 underperformed.
-- The demean removes the base rate (national appreciation regime), so
-- a Phase 3 backtest's Spearman correlation reflects RELATIVE ranking
-- skill, not "did we correctly predict everyone would go up in 2020".
--
-- Restricted to the universe so we're not scoring counties that would
-- never be candidates.
with hpi as (
    -- FHFA is annual (period_end = Dec 31 of year). Take the latest
    -- vintage's value for each (fips, period). Downstream backtest
    -- discipline will re-filter this by as_of_date <= scoring_date + lag.
    select
        fips,
        period_end_date,
        hpi
    from {{ ref('stg_fhfa_hpi') }}
    qualify row_number() over (partition by fips, period_end_date order by as_of_date desc) = 1
),

with_forward as (
    -- Date-based self-join to get the row exactly 24 months forward.
    -- Positional lead() is WRONG here — FHFA has coverage gaps for
    -- low-repeat-sales counties (e.g. Manhattan 36061 is missing several
    -- years). lead(hpi, 2) skips over gaps and produces bogus returns.
    -- The date join returns NULL when the exact +24mo row is missing,
    -- which is what we want — such rows get filtered downstream.
    select
        u.fips,
        h_now.period_end_date,
        h_now.hpi as hpi_t,
        h_fwd.hpi as hpi_t_plus_24mo,
        h_fwd.period_end_date as period_end_t_plus_24mo
    from {{ ref('int_universe') }} u
    inner join hpi h_now on h_now.fips = u.fips
    left join hpi h_fwd
        on h_fwd.fips = u.fips
        and h_fwd.period_end_date = h_now.period_end_date + interval '2 years'
),

with_returns as (
    select
        fips,
        period_end_date,
        hpi_t,
        hpi_t_plus_24mo,
        period_end_t_plus_24mo,
        case
            when hpi_t_plus_24mo is null or hpi_t is null or hpi_t = 0 then null
            else (hpi_t_plus_24mo / hpi_t) - 1
        end as forward_return_24mo
    from with_forward
),

demeaned as (
    -- Cross-sectional demean: subtract the median forward return across
    -- all universe counties in the SAME period_end_date. This is the
    -- "relative ranking" transformation from DECISIONS.md §7.
    select
        fips,
        period_end_date,
        hpi_t,
        forward_return_24mo,
        median(forward_return_24mo) over (partition by period_end_date) as national_median_24mo,
        forward_return_24mo
            - median(forward_return_24mo) over (partition by period_end_date)
            as target_hpi_24mo_demeaned
    from with_returns
    where forward_return_24mo is not null
)

select * from demeaned
