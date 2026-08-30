-- FEMA NRI v1.20 — county-level natural hazard risk snapshot.
-- 71 columns kept from the 465-column raw NRI CSV. Full column list:
--   identity: fips, state, stateabbrv, county, population, area, buildvalue, agrivalue
--   composite: risk_score, risk_ratng, risk_spctl, eal_score, eal_ratng, eal_valt,
--              sovi_score, sovi_ratng, resl_score, resl_ratng
--   per hazard (17 hazards × 3 cols): {H}_riskr rating, {H}_risks score, {H}_afreq freq
select *
from {{ source('curated', 'fema_nri') }}
