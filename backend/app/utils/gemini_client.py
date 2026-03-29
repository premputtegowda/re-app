"""Gemini Flash client for property tax estimation using the google-genai SDK."""
from __future__ import annotations

import logging
from datetime import date
from typing import Optional

from google import genai
from google.genai import types

from app.config import get_settings

logger = logging.getLogger(__name__)

_MODEL = "gemini-2.5-flash"
_MODEL_FALLBACK = "gemini-3-flash-preview"

# ── System prompts ────────────────────────────────────────────────────────────

_SYSTEM_PROMPT_FULL = """\
You are a Real Estate Tax Architect. Calculate the projected annual tax for an \
INVESTMENT property (non-owner-occupied). Today's date: {today}.

GEOGRAPHY CONTEXT (provided in user message):
- State, County, School District, Purchase Price, FIPS

CRITICAL STATE-SPECIFIC RULES:
OHIO (OH):
  - Assessment ratio: 35% of purchase price.
  - INVESTOR PENALTY: EXCLUDE the 10% Non-Business Rollback AND the 2.5% \
Owner-Occupancy Credit. These apply only to owner-occupied homes.
  - Math: assessed_value = price * 0.35; annual_tax = assessed_value * (millage / 1000).
  - Use the school district name to identify the correct tax district millage.
  - 2026 REFORM: Ohio HB 187 / "Stop the Spike" — if purchase price significantly \
exceeds the current auditor value (ratio > 1.20), flag appeal risk. The county \
may reassess upward triggering a school board complaint within 30 days of transfer.
KANSAS (KS):
  - Assessment ratio: 11.5% for residential properties.
  - No homestead exemption for investment properties.
CALIFORNIA (CA):
  - Assessment resets to purchase price (Prop 13). ratio = 1.0.
  - Base rate 1% + local voter-approved bonds.
  - 2024–2026: Prop 19 transfer rules affect inherited property — flag if relevant.
TEXAS (TX):
  - No state income tax; rely on county appraisal district rates.
  - Assessment ratio = 1.0 (full market value).
  - Non-homestead cap: 10% annual appraisal increase cap for investment properties.
  - 2023 REFORM: SB 2 / HB 5 reduced school M&O rates — use post-reform rates.
NEW JERSEY (NJ):
  - Full market value assessment (ratio ≈ 1.0 but varies by municipality).
  - 2025–2026: Ongoing municipal reassessment cycles in several counties — \
flag if assessed value may be stale and subject to imminent revision.
NEW YORK (NY):
  - Assessment ratios vary widely by municipality (some as low as 6%).
  - NYC: Class 2 (rental, 4+ units) uses transitional assessed value — \
increases are phased in over 5 years.
ILLINOIS (IL):
  - Cook County: 10% assessment ratio for residential, 25% for commercial.
  - Non-homestead investors lose the Homeowner Exemption (saves ~$800–2,000/yr).
MONTANA (MT):
  - 2025 REFORM: SB 542 introduced tiered rates for rental vs owner-occupied — \
apply rental surcharge if enacted for 2026 tax year.
IOWA (IA):
  - 2023 REFORM: SF 552 capped annual residential assessment increases at 3%. \
  - Rental properties may be reclassified at higher commercial ratio.
ALL OTHER STATES:
  - Use the most recent 2024/2025 certified millage/levy rates.
  - Apply non-homestead investor rates (NO homestead exemption).
  - If a percentage rate is shown as owner-occupied, adjust for investor \
(typically 10–15% higher due to loss of rollbacks/credits).

REGULATORY AWARENESS — apply to ALL jurisdictions:
1. CURRENT RULES: Use the most recently certified rates (2025 payable 2026 \
where available). Note if rates are estimated due to pending certification.
2. UPCOMING CHANGES: Flag any known levy renewals, new school bond issues, \
or voter-approved measures on the 2026 ballot that could increase rates.
3. REASSESSMENT RISK: If the jurisdiction is in a revaluation cycle (typically \
every 3–6 years), flag that assessed value may increase at next update.
4. APPEAL RISK: If purchase price / current auditor value > 1.20, flag \
"High Appeal Risk" — neighboring taxing authorities may file a complaint to \
raise the assessment to purchase price.
5. PHASE-IN STATES: Some states (NY, MD, PA) phase in assessment increases \
over multiple years — note current vs fully-phased tax if applicable.
6. TAX ABATEMENTS: Flag if the jurisdiction offers LIHTC, 421-a (NYC), \
enterprise zone, or similar abatements that could reduce the investor bill.

OUTPUT: JSON only — schema provided in user message.
"""

_SYSTEM_PROMPT_MATH = """\
You are a property tax calculation engine for an INVESTMENT property.

Formula:
  assessed_value = purchase_price × assessment_ratio
  annual_tax     = assessed_value × (effective_millage / 1000)

Use the cached rates provided. Do NOT apply homestead exemptions.
OUTPUT: JSON only — schema provided in user message.
"""

_SYSTEM_PROMPT_REFINE_MILLAGE = """\
You are a property tax engine refining an effective millage rate for an INVESTMENT \
property (non-owner-occupied). Today's date: {today}.

CRITICAL UNIT RULES:
1. Millage = dollars per $1,000 of ASSESSED VALUE (e.g. 49.77 mills).
2. A "rate" shown as % of market value (e.g. "Columbus: $100k × 1.48%") is the \
OWNER-OCCUPIED effective rate — do NOT use it directly.
3. Use only the NON-HOMESTEAD (investor) rate. Ohio investors lose the 10% \
non-business rollback and 2.5% owner credit — their gross millage IS the effective rate.
4. If the snippets only contain owner-occupied rates or tax-estimator percentages \
with no explicit mills figure, set millage_confidence to 'estimated' and return \
the prior values unchanged.

OUTPUT: JSON only — schema provided in user message.
"""


def _get_client(api_key: str) -> genai.Client:
    return genai.Client(api_key=api_key)


# ── Public functions ───────────────────────────────────────────────────────────

async def estimate_property_tax(
    address: str,
    purchase_price: int,
    fips_data: dict,
    serper_text: Optional[str],
    cached_rates: Optional[dict],
) -> dict:
    """
    Call Gemini to estimate property tax.

    Full mode  (serper_text provided): architect prompt + Serper context.
    Math mode  (cached_rates provided): calculate from cached rates only.
    """
    from app.services.property_tax_service import PropertyTaxServiceError

    settings = get_settings()
    api_key = settings.gemini_api_key
    if not api_key:
        raise PropertyTaxServiceError("GEMINI_API_KEY_MISSING")

    today = date.today().isoformat()

    if serper_text is not None:
        system = _SYSTEM_PROMPT_FULL.format(today=today)
        user_msg = _build_full_user_message(address, purchase_price, fips_data, serper_text)
    elif cached_rates is not None:
        system = _SYSTEM_PROMPT_MATH
        user_msg = _build_math_user_message(address, purchase_price, fips_data, cached_rates)
    else:
        raise PropertyTaxServiceError("GEMINI_NO_INPUT")

    schema = _full_response_schema()
    result = await _call_gemini(api_key, system, user_msg, schema)
    _ensure_future_refresh_date(result)
    return result


async def refine_millage(
    address: str,
    purchase_price: int,
    existing_result: dict,
    millage_snippets: str,
) -> dict:
    """
    Second-pass millage refinement when initial confidence is 'estimated'.
    Falls back to existing_result unchanged on any error.
    """
    from app.services.property_tax_service import PropertyTaxServiceError

    settings = get_settings()
    api_key = settings.gemini_api_key
    if not api_key:
        logger.error("GEMINI_API_KEY not configured — skipping millage refinement")
        return existing_result

    today = date.today().isoformat()
    system = _SYSTEM_PROMPT_REFINE_MILLAGE.format(today=today)

    prior = {
        "address": address,
        "purchase_price": purchase_price,
        "regime_type": existing_result.get("regime_type"),
        "district_code": existing_result.get("district_code"),
        "assessment_ratio": existing_result.get("assessment_ratio"),
        "effective_millage_prior": existing_result.get("effective_millage"),
        "net_estimated_annual_tax_prior": existing_result.get("net_estimated_annual_tax"),
    }
    user_msg = (
        f"Prior estimate:\n{_json(prior)}\n\n"
        f"New millage search snippets:\n{millage_snippets}\n\n"
        f"Output schema:\n{_json(_refine_schema())}"
    )

    try:
        result = await _call_gemini(api_key, system, user_msg, _refine_schema())
        return result
    except PropertyTaxServiceError:
        logger.warning("refine_millage failed — keeping original estimate")
        return existing_result


# ── Message builders ───────────────────────────────────────────────────────────

def _build_full_user_message(
    address: str, purchase_price: int, fips_data: dict, serper_text: str
) -> str:
    payload = {
        "address": address,
        "purchase_price": purchase_price,
        "current_year": 2026,
        "state": fips_data.get("state", ""),
        "county": fips_data.get("county_name", ""),
        "school_district": fips_data.get("school_district", ""),
        "fips": fips_data.get("fips", ""),
        "is_investment": True,
        "homestead_exempt": False,
    }
    schema_note = f"Output schema:\n{_json(_full_response_schema())}"
    return (
        f"Property data:\n{_json(payload)}\n\n"
        f"Web search results for this jurisdiction:\n{serper_text}\n\n"
        f"{schema_note}"
    )


def _build_math_user_message(
    address: str, purchase_price: int, fips_data: dict, cached_rates: dict
) -> str:
    payload = {
        "address": address,
        "purchase_price": purchase_price,
        "state": fips_data.get("state", ""),
        "county": fips_data.get("county_name", ""),
        "school_district": fips_data.get("school_district", ""),
        "assessment_ratio": cached_rates.get("assessment_ratio"),
        "effective_millage": cached_rates.get("effective_millage"),
        "regime_type": cached_rates.get("regime_type", ""),
        "district_code": cached_rates.get("district_code", "000"),
        "is_investment": True,
        "homestead_exempt": False,
    }
    schema_note = f"Output schema:\n{_json(_full_response_schema())}"
    return f"Cached rate data:\n{_json(payload)}\n\n{schema_note}"


# ── Gemini SDK call ────────────────────────────────────────────────────────────

async def _call_gemini(
    api_key: str, system_prompt: str, user_message: str, schema: dict
) -> dict:
    """
    Call Gemini using the google-genai SDK with response_mime_type='application/json'.
    Tries _MODEL first, falls back to _MODEL_FALLBACK on 404.
    Returns a parsed dict — no fence stripping needed (SDK enforces JSON).
    """
    from app.services.property_tax_service import PropertyTaxServiceError
    import asyncio

    client = _get_client(api_key)
    config = types.GenerateContentConfig(
        system_instruction=system_prompt,
        response_mime_type="application/json",
        temperature=0.1,
        max_output_tokens=8192,
    )

    for model in [_MODEL, _MODEL_FALLBACK]:
        try:
            # google-genai SDK is sync — run in thread pool to avoid blocking
            loop = asyncio.get_event_loop()
            response = await loop.run_in_executor(
                None,
                lambda m=model: client.models.generate_content(
                    model=m,
                    config=config,
                    contents=user_message,
                ),
            )

            # SDK with response_mime_type='application/json' returns parsed object
            # or raw text — handle both
            if hasattr(response, "parsed") and response.parsed is not None:
                result = response.parsed
            else:
                import json
                raw = response.text or ""
                result = json.loads(raw)

            if not isinstance(result, dict):
                raise PropertyTaxServiceError("GEMINI_PARSE_ERROR")

            # Ensure district_code defaults to "000" if missing
            if not result.get("district_code"):
                result["district_code"] = "000"

            return result

        except Exception as exc:
            err_str = str(exc).lower()
            if ("404" in err_str or "not found" in err_str) and model == _MODEL:
                logger.info("Model %s unavailable, trying fallback", model)
                continue
            if "timeout" in err_str:
                raise PropertyTaxServiceError("GEMINI_TIMEOUT")
            logger.error("Gemini error (model=%s): %s", model, exc)
            raise PropertyTaxServiceError("GEMINI_HTTP_ERROR")

    raise PropertyTaxServiceError("GEMINI_MODEL_UNAVAILABLE")


# ── JSON response schemas (passed to Gemini as output guide) ──────────────────

def _full_response_schema() -> dict:
    return {
        "regime_type": "<full_value|fractional|hybrid>",
        "district_code": "<3-digit string or '000' if unknown>",
        "assessment_ratio": "<decimal e.g. 0.35 for Ohio>",
        "effective_millage": "<decimal mills e.g. 49.77>",
        "millage_confidence": "<confirmed|estimated>",
        "net_estimated_annual_tax": "<integer dollars>",
        "effective_tax_rate_percentage": "<float e.g. 2.10>",
        "calculation_breakdown": ["<step 1>", "<step 2>"],
        "investor_penalties_applied": ["<penalty or empty list>"],
        "regulatory_flags": [
            "<any of: appeal_risk, reassessment_cycle, pending_levy, "
            "phase_in_state, abatement_available, reform_enacted, "
            "rate_certification_pending — include only what applies, "
            "empty list if none>"
        ],
        "regulatory_notes": "<single string summarising current + upcoming regulatory risks, empty string if none>",
        "data_governance": {
            "next_refresh_date": f"<YYYY-MM-DD future date after {date.today().isoformat()}>",
            "refresh_reason": "<brief explanation>",
        },
    }


def _refine_schema() -> dict:
    return {
        "effective_millage": "<decimal mills for NON-HOMESTEAD investor rate>",
        "millage_confidence": "<confirmed|estimated>",
        "net_estimated_annual_tax": "<recalculated integer>",
        "effective_tax_rate_percentage": "<recalculated float>",
        "calculation_breakdown": ["<updated steps>"],
        "millage_source": "<source description or 'insufficient data'>",
    }


# ── Helpers ────────────────────────────────────────────────────────────────────

def _json(obj: dict) -> str:
    import json
    return json.dumps(obj, indent=2)


def _ensure_future_refresh_date(result: dict) -> None:
    """Guarantee next_refresh_date is always a future date."""
    today = date.today()
    fallback = today.replace(month=12, day=31).isoformat()

    try:
        governance = result.get("data_governance", {})
        raw_date = governance.get("next_refresh_date", "")
        if date.fromisoformat(str(raw_date)) <= today:
            logger.warning("Past next_refresh_date (%s) — defaulting to %s", raw_date, fallback)
            governance["next_refresh_date"] = fallback
            governance["refresh_reason"] = (
                governance.get("refresh_reason", "")
                + " (refresh date adjusted: returned date was already past)"
            )
            result["data_governance"] = governance
    except (ValueError, TypeError):
        result.setdefault("data_governance", {})["next_refresh_date"] = fallback
