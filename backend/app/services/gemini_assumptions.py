"""Gemini-powered underwriting assumption generator.

Takes property inputs + Serper.dev search results as grounding context,
runs a strict-sourcing underwriting prompt, returns structured JSON
matching the expected OpEx/NOI schema. Tracks token cost.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from typing import Any

from google import genai
from google.genai import types

from app.config import get_settings

logger = logging.getLogger(__name__)

MODEL = "gemini-2.5-flash"

# Gemini 2.5 Flash pricing (USD per 1M tokens, standard <=128K context).
# https://ai.google.dev/gemini-api/docs/pricing
INPUT_COST_PER_1M = 0.30
OUTPUT_COST_PER_1M = 2.50


class GeminiUnavailableError(RuntimeError):
    """Raised when the Gemini key is missing or the API call fails."""


@dataclass(frozen=True)
class GeminiAssumptionsResult:
    assumptions: dict[str, Any]     # parsed JSON per underwriting schema
    raw_response: str                # raw LLM text (for debugging)
    input_tokens: int
    output_tokens: int
    cost_usd: float


# ── Prompt ──────────────────────────────────────────────────────────────────
# Taken verbatim from the user's underwriting prompt; property + search
# results are appended as context blocks.

_UNDERWRITING_SYSTEM_INSTRUCTION = """You are an expert multifamily real estate acquisitions underwriter. For the given property you must:
(1) estimate the current **market rent per unit type** from rental comps in the search results, and
(2) underwrite operating expenses and Net Operating Income (NOI) using strict evidentiary standards.

### UNDERWRITING & SOURCING RULES
1. **Prefer sourced values, but ESTIMATE when a source isn't available.** For every line item:
   - **First choice:** value derived from a cited URL in the provided search results — set `source` to the URL(s), `confidence` to "High".
   - **Fallback:** if no relevant source exists in the search results, provide a REASONED ESTIMATE based on the property's attributes (city/state/climate, unit count, unit mix, property type, purchase price as a proxy for property class). Set `source` to "Estimate — no direct source available", `confidence` to "Medium" (defensible market benchmark) or "Low" (rough guess), and put the reasoning in `assumption` (e.g., "Typical trash service for a 4-unit MFR in the Midwest is $50–$80/mo per building; estimated at $70/mo").
   - **Never fabricate a specific URL** — if you're estimating, say so; do not invent citations.
   - The only line items that must return null when unsourced are the ones covered by rule #3 (property tax).
2. **Authorized fixed assumptions** (always use these, no source needed, no estimation):
   - **Property Management (per strategy):**
     - `property_management_ltr` = 8% of LTR EGI portion. Populate only if LTR units exist.
     - `property_management_mtr` = 15% of MTR/STR EGI portion. Populate only if MTR/STR units exist.
   - **Repairs & Maintenance (per strategy):**
     - `repairs_and_maintenance_ltr` = 8% of LTR EGI portion. Populate only if LTR units exist.
     - `repairs_and_maintenance_mtr` = 10% of MTR/STR EGI portion (higher wear from frequent turnovers). Populate only if MTR/STR units exist.
   - **Marketing & Leasing:** Exactly one month of applicable unit rent per new lease/turnover. Turnover frequency: LTR ~1/yr, MTR ~4/yr, STR ~30-50/yr — so total marketing $ scales accordingly per unit type.

**Rental-strategy-aware expenses — per-strategy split:**
   The property context lists a `rental_type` per unit type (LTR / MTR / STR) and provides per-strategy unit counts.
   - **Common expenses** (real estate taxes, insurance base, licenses, utilities common area, RUBS recovery, R&M, all contract services, G&A, payroll, property management): apply to ALL units regardless of strategy. Compute across the full property.
   - **LTR-specific line items** (`turnover_ltr`, `marketing_ltr`): populate ONLY if the property has at least one LTR unit. Annual $ is for LTR units only. If no LTR units, set to null with source "Not applicable — no LTR units".
   - **MTR-specific line items** (`turnover_mtr`, `marketing_mtr`, `insurance_rider_mtr_str`, `utilities_bundled_mtr_str`, `internet_wifi`, `streaming_cable`, `ff_e_reserve`, `consumables`): populate ONLY if the property has at least one MTR or STR unit. Annual $ is for MTR/STR units only. If none, set to null with source "Not applicable — no MTR/STR units".

**IMPORTANT — per-unit rate wording (must match app display):**
   The app displays a `$/unit/mo` column for each line item, computed as `annual ÷ applicable-unit-count ÷ 12` where the denominator is:
   - **Common expenses**: TOTAL unit count (all strategies combined)
   - **LTR-specific** (`turnover_ltr`, `marketing_ltr`): LTR unit count only
   - **MTR-specific** (all `_mtr` / `_mtr_str` categories): MTR + STR unit count
   Your `assumption` text MUST express per-unit rates using the SAME denominator, so the number you cite matches what the reader sees. Example for a 6-LTR + 2-MTR property:
   - `turnover_ltr` at $1,800/yr → write "$25/unit/mo (per LTR unit, 6 units)"
   - `internet_wifi` at $1,800/yr → write "$75/unit/mo (per MTR unit, 2 units)"
   - `insurance` (common) at $3,200/yr → write "$33.33/unit/mo (per total unit, 8 units)"
3. **Property Tax — district-aware, official sources only.** Property tax rates within a single county vary by overlapping districts (school district, city/municipality, TRA / Tax Rate Area, special assessments for fire/water/park/library/sewer). Use the following waterfall:
   - **Tier 1 (best):** the specific parcel's tax bill or assessor record from an official government site. Cite URL, confidence "High".
   - **Tier 2 (preferred fallback):** identify the property's **actual district mix** (school district, city, special districts) from the address and search results, then sum their published rates. Break down the arithmetic in the assumption field like: `School (Warrick East SD): 0.85% + City (Newburgh): 0.15% + County base: 0.30% + Fire district: 0.05% = 1.35% combined; 1.35% × $500,000 × 1.0 assessment ratio = $6,750`. Confidence "Medium". Cite each district's official source URL.
   - **Tier 3 (rough fallback):** county-wide effective rate applied to purchase price, only when district-level data isn't in the search results. Confidence "Low" — explicitly note in the assumption that this ignores district variation and could be off by 20-40%.
   - **REJECT** Zillow, Coldwell Banker, Redfin, Realtor.com, ikeyrealty, and every MLS/listing site as tax sources.
   - If no tier is possible, set `real_estate_taxes.annual` to null with "Unable to estimate — insufficient district data".
4. **All Operating Expenses — Census-Tract-first reasoning, property-attribute-based, not listing-site quotes.** For EVERY operating expense line item (insurance, utilities, R&M, turnover, contract services, G&A, payroll, etc.), do NOT use "insurance $XXX/mo" / "utilities $XXX/mo" / similar figures from consumer real-estate listing sites (Zillow, Redfin, Realtor.com, Trulia, Homes.com, MLS sites, etc.). Instead, use this **strict geographic priority** for reasoning:

   **Priority 1 — Census Tract (GEOID given in property context):** ACS/Census tract-level demographics anchor the property's class. If the tract has median household income $40k, aging housing stock, and 25%+ rentals, this is a Class B/C submarket. If the tract has $120k income and predominantly new construction, this is Class A. Use tract-level demographics FIRST to establish property class, then apply expense benchmarks appropriate to that class.

   **Priority 2 — County FIPS:** Insurance zone factors, utility service territory rates, contract-services vendor pricing typically publish at the county level. Search results scoped to this county are your next-best anchor.

   **Priority 3 — City / ZIP:** Municipal pricing and vendor rates.

   **Priority 4 — State:** Only as a last resort. Note "Low" confidence when reasoning at state level.

   **NEVER** fall back to broad multi-state regional averages ("Midwest", "South", "Northeast", "Sun Belt") — those are strictly disqualified.

   **Property class factors** (apply on top of geographic reasoning): unit count, construction (wood-frame ~15-25% pricier to insure than brick), age, amenities.

   **Every assumption field MUST cite the geography level used**, e.g., *"Tract 18173010700 median income $52k → Class B; Warrick County multifamily insurance zone factor 1.05×; typical Class B wood-frame $200-$400/unit → estimated $280/unit × 4 units = $1,120/yr"*.

   Confidence: "Medium" if reasoning grounded at tract or county level; "Low" if only state-level.

   **EXCEPTIONS:** property tax has its own Rule #3; market rent (Rule #5) legitimately uses rental listing sites.
4b. **Cap Rate — estimate current market cap rate + exit cap rate.**
   - **Current market cap rate (`current_market_cap_rate_pct`):** the going-in cap rate for stabilized comparable properties in THIS submarket. Reason from:
     - **Tract-level demographics** (Priority 1): ACS median income, housing stock age, rental share. Class A tracts → 5.0–6.0%; Class B → 6.0–7.5%; Class C → 7.5–10%+.
     - **Property class factors:** unit count (larger MFR institutional-grade compresses cap by 25-75 bps), age (post-2010 build compresses; pre-1980 expands), amenities.
     - **Submarket search results** for recent transaction cap rates in this county/MSA.
     - Show tract-level reasoning in the assumption field. Confidence "Medium" when grounded in tract/county data, "Low" if only broad state-level.
   - **Exit cap rate (`exit_cap_rate_pct`):** default to `current_market_cap_rate_pct + 1.0%` (standard underwriting convention adding ~100 bps for cap rate expansion over the hold period). If tract-level data suggests a different spread (e.g., high-growth submarket → +50 bps only; declining submarket → +150 bps), justify in the assumption field.
5. **Rent — estimate BOTH in-place rent AND market rent per unit type.**
   - **Market rent (`estimated_market_rent_monthly`):** what a NEW tenant would pay today. Source from comparable rental listings (Apartments.com, Zillow Rentals, Rent.com, local property management sites) — these are the correct source for market rent. Cite the URL(s) in `market_source`. Confidence "High" for direct comps, "Medium" for extrapolation.
   - **In-place rent (`estimated_in_place_rent_monthly`):** what the CURRENT tenants are paying (typically below market for stabilized properties due to loss-to-lease).
     - If the property context shows a non-zero in-place rent for this unit type in the user's unit mix, USE THAT value and set `in_place_source` to "User-provided (from unit mix input)".
     - Otherwise, estimate as market rent × (1 - typical loss-to-lease). For stabilized Class B/C multifamily, loss-to-lease is typically 5-15% (older buildings + long-tenured tenants toward 15%; recent renovations toward 5%). Show the arithmetic in `in_place_source`, e.g., "Estimated: market $1,200 × (1 - 10% typical LTL for older Class B) = $1,080".
     - If the user provided a value, treat it as ground truth and do NOT override.
6. **Turnover:** Turnover expense = (Annual Turns) × (Cost per Turn). Show the arithmetic in the assumption text.
7. **Contract Services Itemization:** Itemize each Contract Services subcategory separately. Estimate each even if the consolidated search result covers them collectively.
8. **No Double-Counting:** RUBS is expense recovery/reimbursement only. R&M is not duplicated with turnover or CAPEX. Non-operating capital/reserves remain below the line (NOT included in NOI).

Return ONLY valid JSON (no markdown fences, no commentary) with the exact schema described in the user message."""


_JSON_SCHEMA_TEMPLATE = """{
  "cap_rate_estimation": {
    "current_market_cap_rate_pct": null,
    "exit_cap_rate_pct": null,
    "assumption": "",
    "source": "",
    "confidence": ""
  },
  "market_rent_estimation": {
    "by_unit_type": [
      {
        "unit_type": "e.g. 2BR/1BA",
        "count": 0,
        "estimated_in_place_rent_monthly": null,
        "estimated_market_rent_monthly": null,
        "in_place_source": "",
        "market_source": "",
        "confidence": ""
      }
    ],
    "notes": ""
  },
  "revenue": {
    "gross_potential_rent_annual": null,
    "effective_gross_income_annual": null
  },
  "operating_expenses": {
    "real_estate_taxes": { "annual": null, "assumption": "", "source": "", "confidence": "" },
    "insurance": { "annual": null, "assumption": "", "source": "", "confidence": "" },
    "licenses_and_permits": { "annual": null, "assumption": "", "source": "", "confidence": "" },
    "utilities": { "annual": null, "assumption": "", "source": "", "confidence": "" },
    "utility_rubs_recovery": { "annual": null, "assumption": "", "source": "", "confidence": "" },
    "repairs_and_maintenance_ltr": { "annual": null, "assumption": "8% of LTR EGI. LTR units only.", "source": "User Assumption", "confidence": "High" },
    "repairs_and_maintenance_mtr": { "annual": null, "assumption": "10% of MTR EGI (higher wear from frequent turnovers). MTR/STR units only.", "source": "User Assumption", "confidence": "High" },
    "turnover_ltr": { "annual": null, "assumption": "LTR units only. Annual LTR turns × cost/turn. Per-unit rate = annual / LTR unit count / 12.", "source": "", "confidence": "" },
    "turnover_mtr": { "annual": null, "assumption": "MTR units only. Higher turnover frequency + deep-clean cost. Per-unit rate = annual / MTR unit count / 12.", "source": "", "confidence": "" },
    "contract_services_snow_removal": { "annual": null, "assumption": "", "source": "", "confidence": "" },
    "contract_services_lawn_maintenance": { "annual": null, "assumption": "", "source": "", "confidence": "" },
    "contract_services_pest_control": { "annual": null, "assumption": "", "source": "", "confidence": "" },
    "contract_services_trash_recycling": { "annual": null, "assumption": "", "source": "", "confidence": "" },
    "contract_services_janitorial": { "annual": null, "assumption": "", "source": "", "confidence": "" },
    "contract_services_security_fire_safety": { "annual": null, "assumption": "", "source": "", "confidence": "" },
    "contract_services_elevator": { "annual": null, "assumption": "", "source": "", "confidence": "" },
    "contract_services_pool_amenities": { "annual": null, "assumption": "", "source": "", "confidence": "" },
    "marketing_ltr": { "annual": null, "assumption": "LTR units only. One month LTR rent × LTR turnover freq (~1/yr). Per-unit rate = annual / LTR unit count / 12.", "source": "User Assumption", "confidence": "High" },
    "marketing_mtr": { "annual": null, "assumption": "MTR units only. Platform subs + listing fees + higher turnover freq. Per-unit rate = annual / MTR unit count / 12.", "source": "User Assumption", "confidence": "High" },
    "general_and_administrative": { "annual": null, "assumption": "", "source": "", "confidence": "" },
    "payroll": { "annual": null, "assumption": "", "source": "", "confidence": "" },
    "property_management_ltr": { "annual": null, "assumption": "8% of LTR EGI. LTR units only.", "source": "User Assumption", "confidence": "High" },
    "property_management_mtr": { "annual": null, "assumption": "15% of MTR EGI (higher coordination). MTR/STR units only.", "source": "User Assumption", "confidence": "High" },
    "utilities_bundled_mtr_str": { "annual": null, "assumption": "MTR/STR only — landlord-paid electric/water/gas/trash bundled into rent. Null for LTR.", "source": "", "confidence": "" },
    "internet_wifi": { "annual": null, "assumption": "MTR/STR only — mandatory internet/WiFi (~$60-100/unit/mo). Null for LTR.", "source": "", "confidence": "" },
    "insurance_rider_mtr_str": { "annual": null, "assumption": "MTR/STR only — furnished/short-stay coverage rider on top of base insurance. Null for LTR.", "source": "", "confidence": "" },
    "ff_e_reserve": { "annual": null, "assumption": "MTR/STR only — furniture, fixtures, equipment reserve for wear/replacement (~$300-600/unit/yr). Null for LTR.", "source": "", "confidence": "" },
    "consumables": { "annual": null, "assumption": "MTR/STR only — cleaning supplies, toiletries (soap/TP/shampoo), coffee/pantry, linens/towels replacement (~$50-100/unit/mo). Null for LTR.", "source": "", "confidence": "" },
    "streaming_cable": { "annual": null, "assumption": "MTR/STR only — streaming/cable subscription (~$20-40/unit/mo). Null for LTR.", "source": "", "confidence": "" },
    "capex_reserves": { "annual": null, "assumption": "Replacement reserves for roof, HVAC, appliances, flooring, etc. Typically $250-500/unit/year for stabilized multi-family. Applies to ALL units regardless of strategy.", "source": "User Assumption", "confidence": "High" },
    "total_opex_annual": null
  },
  "noi_annual": null,
  "below_the_line": {
    "replacement_reserves_annual": null,
    "year_1_capex_deferred_maintenance_annual": null
  }
}"""


def _build_user_prompt(
    address: str,
    unit_count: int,
    nrsf: int | None,
    gpr_annual: float | None,
    purchase_price: float,
    unit_mix_summary: list[dict],
    search_context: str,
    submarket: dict | None,
) -> str:
    unit_mix_lines = "\n".join(
        f"  - {u['count']}× {u['type']} [{u.get('rental_type', 'LTR')}] — in-place ${u['in_place_rent_monthly']:.0f}/mo, target ${u['target_rent_monthly']:.0f}/mo"
        for u in unit_mix_summary
    )
    ltr_units = sum(u['count'] for u in unit_mix_summary if u.get('rental_type', 'LTR') == 'LTR')
    mtr_units = sum(u['count'] for u in unit_mix_summary if u.get('rental_type', 'LTR') in ('MTR', 'STR'))
    strategy_counts = (
        f"- LTR unit count: {ltr_units}\n"
        f"- MTR/STR unit count: {mtr_units}\n"
        f"- Total unit count: {unit_count}\n"
    )
    submarket_line = ""
    if submarket:
        submarket_line = (
            f"- Census Tract: {submarket.get('census_tract', 'n/a')} "
            f"(county FIPS {submarket.get('county_fips', 'n/a')})\n"
            f"- Matched Address (Census): {submarket.get('matched_address', 'n/a')}\n"
        )
    return f"""### PROPERTY CONTEXT
- Address: {address}
- Purchase Price: ${purchase_price:,.0f}
- Unit Mix:
{unit_mix_lines}
### UNIT COUNTS BY STRATEGY
{strategy_counts}- Total Net Rentable SF (NRSF): {nrsf if nrsf else 'unknown'}
- Gross Potential Rent (GPR, annual): {f'${gpr_annual:,.0f}' if gpr_annual else 'unknown (derive from unit mix if needed)'}
{submarket_line}
### AVAILABLE SEARCH RESULTS (scoped to this specific address / tract / county)
{search_context}

### REQUIRED OUTPUT
Return ONLY valid JSON matching this exact schema.

{_JSON_SCHEMA_TEMPLATE}"""


def _format_search_context(search_batch) -> str:
    """Format Serper batch results as a readable context block for the prompt."""
    blocks = []
    for s in search_batch.searches:
        results_text = "\n".join(
            f"  - {r['title']}\n    {r['link']}\n    {r['snippet']}"
            for r in s.results[:3]  # top 3 keeps context tight & cheap
        )
        blocks.append(f"QUERY: {s.query}\n{results_text}")
    return "\n\n".join(blocks)


async def generate_assumptions(
    address: str,
    unit_count: int,
    nrsf: int | None,
    gpr_annual: float | None,
    search_batch,  # SerperBatchResult
    unit_mix_summary: list[dict],
    purchase_price: float,
    submarket: dict | None = None,
) -> GeminiAssumptionsResult:
    """Call Gemini with search context to produce underwriting assumptions."""
    api_key = get_settings().gemini_api_key
    if not api_key:
        raise GeminiUnavailableError("GEMINI_API_KEY is not configured")

    client = genai.Client(api_key=api_key)
    user_prompt = _build_user_prompt(
        address=address,
        unit_count=unit_count,
        nrsf=nrsf,
        gpr_annual=gpr_annual,
        purchase_price=purchase_price,
        unit_mix_summary=unit_mix_summary,
        search_context=_format_search_context(search_batch),
        submarket=submarket,
    )

    try:
        response = await client.aio.models.generate_content(
            model=MODEL,
            contents=user_prompt,
            config=types.GenerateContentConfig(
                system_instruction=_UNDERWRITING_SYSTEM_INSTRUCTION,
                response_mime_type="application/json",
                temperature=0.1,
                max_output_tokens=16384,
            ),
        )
    except Exception as e:
        raise GeminiUnavailableError(f"Gemini call failed: {e}") from e

    raw = (response.text or "").strip()
    logger.info("Gemini raw response (%d chars): %s", len(raw), raw[:2000])

    # Strip potential markdown fences even though response_mime_type=json is set —
    # models occasionally still wrap output.
    cleaned = raw
    if cleaned.startswith("```"):
        # Remove opening fence line and trailing ```
        cleaned = cleaned.split("\n", 1)[1] if "\n" in cleaned else cleaned
        if cleaned.endswith("```"):
            cleaned = cleaned[: -3].strip()

    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError as e:
        # Truncation check: if finishReason is MAX_TOKENS, tell the user.
        finish_reason = None
        try:
            candidates = getattr(response, "candidates", None) or []
            if candidates:
                finish_reason = str(getattr(candidates[0], "finish_reason", ""))
        except Exception:
            pass
        detail = f"Gemini returned invalid JSON ({e})."
        if finish_reason and "MAX" in finish_reason.upper():
            detail += " Response was truncated (hit max_output_tokens). Try a smaller property or increase the token budget."
        logger.warning("%s Raw length=%d, finish_reason=%s", detail, len(raw), finish_reason)
        raise GeminiUnavailableError(detail) from e

    usage = getattr(response, "usage_metadata", None)
    input_tokens = getattr(usage, "prompt_token_count", 0) if usage else 0
    output_tokens = getattr(usage, "candidates_token_count", 0) if usage else 0
    cost = (
        (input_tokens / 1_000_000) * INPUT_COST_PER_1M
        + (output_tokens / 1_000_000) * OUTPUT_COST_PER_1M
    )

    return GeminiAssumptionsResult(
        assumptions=parsed,
        raw_response=raw,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        cost_usd=round(cost, 6),
    )
