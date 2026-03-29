"""
Property tax estimation service.

Orchestrates the full pipeline:
  1. US Census FIPS lookup
  2. DB cache check
  3. Serper web search (cache miss only)
  4. Gemini Flash estimation
  5. Persist jurisdiction data
"""
from __future__ import annotations

import logging
from datetime import date, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.property_tax import JurisdictionTaxData
from app.utils.census_client import get_fips
from app.utils.gemini_client import estimate_property_tax, refine_millage
from app.utils.serper_client import search_millage_rate, search_tax_info

logger = logging.getLogger(__name__)


class PropertyTaxServiceError(Exception):
    """Raised when the property tax estimation pipeline fails in a known way."""

    def __init__(self, code: str, message: str = "") -> None:
        self.code = code
        super().__init__(message or code)


async def get_property_tax_estimate(
    address: str,
    purchase_price: int,
    db: AsyncSession,
) -> dict:
    """
    Full property tax estimation pipeline.

    Returns a dict matching PropertyTaxEstimateResponse fields.
    """
    # ── 1. Resolve FIPS ──────────────────────────────────────────────────────
    fips_data = await get_fips(address)
    if not fips_data:
        logger.warning("Census FIPS lookup failed for address: %s — using fallback", address)
        fips_data = {"fips": "00000", "county_name": "", "state": "", "matched_address": address}

    fips = fips_data["fips"]

    # ── 2. Check DB cache ────────────────────────────────────────────────────
    cached = await _find_cached_jurisdiction(db, fips)
    is_cached = cached is not None and cached.next_refresh_date > date.today()

    if is_cached:
        # ── 3a. Cache hit — math-only Gemini call ────────────────────────────
        logger.info("Cache hit for FIPS %s (expires %s)", fips, cached.next_refresh_date)
        cached_rates = {
            "assessment_ratio": cached.assessment_ratio,
            "effective_millage": cached.effective_millage,
            "regime_type": cached.regime_type,
            "district_code": cached.district_code,
        }
        result = await estimate_property_tax(
            address, purchase_price, fips_data,
            serper_text=None, cached_rates=cached_rates,
        )
        jurisdiction_key = cached.jurisdiction_key
    else:
        # ── 3b. Cache miss — full pipeline ───────────────────────────────────
        logger.info("Cache miss for FIPS %s — running full pipeline", fips)

        serper_text = await search_tax_info(
            address, fips_data["county_name"], fips_data["state"]
        )
        if serper_text is None:
            raise PropertyTaxServiceError(
                "SERPER_UNAVAILABLE",
                "Unable to retrieve tax info — please enter your own estimate",
            )

        result = await estimate_property_tax(
            address, purchase_price, fips_data,
            serper_text=serper_text, cached_rates=None,
        )

        # ── Phase 2 (Option B): targeted millage search when confidence is low ─
        if result.get("millage_confidence") == "estimated":
            logger.info(
                "Millage confidence low — firing targeted millage search for %s %s district %s",
                fips_data["county_name"], fips_data["state"], result.get("district_code", "000"),
            )
            millage_snippets = await search_millage_rate(
                fips_data["county_name"],
                fips_data["state"],
                result.get("district_code", "000"),
            )
            if millage_snippets:
                refined = await refine_millage(address, purchase_price, result, millage_snippets)
                result.update({
                    "effective_millage": refined.get("effective_millage", result.get("effective_millage")),
                    "net_estimated_annual_tax": refined.get("net_estimated_annual_tax", result.get("net_estimated_annual_tax")),
                    "effective_tax_rate_percentage": refined.get("effective_tax_rate_percentage", result.get("effective_tax_rate_percentage")),
                    "millage_confidence": refined.get("millage_confidence", "estimated"),
                    "calculation_breakdown": refined.get("calculation_breakdown", result.get("calculation_breakdown")),
                })

        # ── 4. Persist jurisdiction data ─────────────────────────────────────
        district_code: str = result.get("district_code") or "000"
        jurisdiction_key = f"{fips}-{district_code}"

        next_refresh_raw = result.get("data_governance", {}).get("next_refresh_date", "")
        next_refresh = _parse_date(next_refresh_raw)

        jurisdiction = JurisdictionTaxData(
            jurisdiction_key=jurisdiction_key,
            fips=fips,
            district_code=district_code,
            county_name=fips_data["county_name"],
            state=fips_data["state"],
            assessment_ratio=float(result.get("assessment_ratio", 1.0)),
            effective_millage=float(result.get("effective_millage", 0.0)),
            regime_type=result.get("regime_type", "full_value"),
            millage_confidence=result.get("millage_confidence"),
            next_refresh_date=next_refresh,
            last_fetched_at=datetime.utcnow(),
            raw_gemini_response=result,
        )
        # merge = upsert semantics (insert or update by PK)
        await db.merge(jurisdiction)
        await db.commit()

    # ── 5. Build response ────────────────────────────────────────────────────
    governance = result.get("data_governance", {})
    return {
        "jurisdiction_key": jurisdiction_key,
        "net_estimated_annual_tax": float(result.get("net_estimated_annual_tax", 0)),
        "effective_tax_rate_percentage": float(result.get("effective_tax_rate_percentage", 0)),
        "regime_type": result.get("regime_type", "full_value"),
        "millage_confidence": result.get("millage_confidence"),
        "calculation_breakdown": result.get("calculation_breakdown", []),
        "investor_penalties_applied": result.get("investor_penalties_applied", []),
        "next_refresh_date": governance.get("next_refresh_date", ""),
        "refresh_reason": governance.get("refresh_reason", ""),
        "is_cached": is_cached,
        "source": "estimated",
    }


async def _find_cached_jurisdiction(
    db: AsyncSession, fips: str
) -> JurisdictionTaxData | None:
    """
    Return the most recently fetched JurisdictionTaxData row for this FIPS code,
    or None if no record exists.
    """
    result = await db.execute(
        select(JurisdictionTaxData)
        .where(JurisdictionTaxData.fips == fips)
        .order_by(JurisdictionTaxData.last_fetched_at.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


def _parse_date(date_str: str) -> date:
    """
    Parse a YYYY-MM-DD string into a date.
    Falls back to one year from today if the string is invalid.
    """
    try:
        return date.fromisoformat(date_str)
    except (ValueError, TypeError):
        today = date.today()
        return today.replace(year=today.year + 1)
