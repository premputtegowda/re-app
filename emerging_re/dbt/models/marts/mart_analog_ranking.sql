-- Historical-analog ranking — separate from composite ranking.
--
-- The composite says "which markets look best on today's features."
-- This mart says "which markets today look like past winners looked
-- BEFORE they boomed."
--
-- Consumed by:
--   - mart_mf_scored (joined as analog_score + best_analog_market columns)
--   - stand-alone browsable — best for finding tertiary/secondary
--     markets that fail the MF filter but match past-winner signatures
select
    fips,
    county_name,
    state_name,
    pop_latest,
    analog_rank,
    round(analog_score::decimal, 3) as analog_score,
    round(best_analog_similarity::decimal, 3) as best_analog_similarity,
    best_analog_fips,
    best_analog_market,
    -- What the historical analog delivered — sets expectation for this
    -- market's realized returns IF the signature holds.
    round(best_analog_fwd_hpi_5y * 100, 1) as best_analog_hpi_5y_pct,
    round(best_analog_fwd_zori_5y * 100, 1) as best_analog_zori_5y_pct
from {{ source('analog_matches', 'analog_matches') }}
