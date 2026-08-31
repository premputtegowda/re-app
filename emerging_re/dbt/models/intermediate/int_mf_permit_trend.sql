-- MF permit ratio trend — per-period supply pipeline metric.
--
-- Hypothesis (uncertain sign): change in units_5plus / units_total tracks
-- MF supply expansion. Two conflicting theories:
--   POSITIVE: rising MF permit share = developers responding to demand =
--     leading indicator for rent (developers see it coming first)
--   NEGATIVE: rising MF permit share = overbuild = future rent softening
-- Ablation will decide the empirical sign.
--
-- BPS is annual (Dec 31). Compute 3yr trailing MF permit ratio per period,
-- then change vs 3yr prior.
--
-- Features:
--   1. `mf_permit_ratio_now` — trailing 3yr MF permit share
--   2. `mf_permit_ratio_change_3yr` — 3yr change in that ratio (pp)
--
-- Sign: start with +1 (rising = demand-led). If ablation shows negative
-- correlation, flip to -1.
with bps as (
    select fips, period_end_date, units_5plus, units_total
    from {{ ref('stg_census_bps') }}
    where units_total is not null and units_total > 0
    qualify row_number() over (partition by fips, period_end_date order by as_of_date desc) = 1
),

-- Trailing 3yr sum per (fips, period).
trailing_3yr as (
    select
        b_now.fips,
        b_now.period_end_date,
        b_now.units_5plus + coalesce(b_1.units_5plus, 0) + coalesce(b_2.units_5plus, 0)
            as mf_units_3yr,
        b_now.units_total + coalesce(b_1.units_total, 0) + coalesce(b_2.units_total, 0)
            as total_units_3yr
    from bps b_now
    left join bps b_1
        on b_1.fips = b_now.fips
        and b_1.period_end_date = b_now.period_end_date - interval '1 year'
    left join bps b_2
        on b_2.fips = b_now.fips
        and b_2.period_end_date = b_now.period_end_date - interval '2 years'
),

with_ratio as (
    select
        fips, period_end_date,
        1.0 * mf_units_3yr / nullif(total_units_3yr, 0) as mf_permit_ratio_now
    from trailing_3yr
    where total_units_3yr > 0
),

with_lag as (
    select
        r_now.fips,
        r_now.period_end_date,
        r_now.mf_permit_ratio_now,
        r_3.mf_permit_ratio_now as ratio_t_minus_3
    from with_ratio r_now
    left join with_ratio r_3
        on r_3.fips = r_now.fips
        and r_3.period_end_date = r_now.period_end_date - interval '3 years'
)

select
    fips,
    period_end_date,
    mf_permit_ratio_now,
    mf_permit_ratio_now - ratio_t_minus_3 as mf_permit_ratio_change_3yr
from with_lag
inner join {{ ref('int_universe') }} u using (fips)
