"""AI-powered underwriting assumptions endpoint.

Flow:
1. Geocode the address (Census) → tract + county FIPS keys.
2. For each submarket-level query (contract services, insurance, utility rates,
   market vacancy/turnover, market rent by bed count), check the submarket cache.
   Cache hit → reuse. Cache miss → run Serper and store the result.
3. Property-tax query always runs fresh (property-specific) and is filtered to
   official government sources only.
4. Feed the combined search context to Gemini with the underwriting prompt.
5. Return the assumptions plus a per-category cost breakdown showing which
   searches were cache hits (cost $0) vs fresh (cost $0.001 each).
"""

import logging
import traceback
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models import User
from app.services.census import CensusUnavailableError, geocode
from app.services.gemini_assumptions import (
    GeminiUnavailableError,
    generate_assumptions,
)
from app.services.serper import (
    SerperBatchResult,
    SerperSearchResult,
    SerperUnavailableError,
    filter_official_tax_results,
    filter_out_listing_sites,
    search,
)
from app.services.submarket_cache_service import get_cached, upsert_cache

router = APIRouter(prefix="/assumptions", tags=["AI Assumptions"])
logger = logging.getLogger(__name__)

# ── Cache TTLs by category ──────────────────────────────────────────────────
# County-level data (vendor pricing, insurance zones, utility rates) is
# relatively stable. Tract-level data (rent comps, vacancy) changes faster.

_CATEGORY_TTL_DAYS = {
    "contract_services": 90,
    "insurance_rates": 90,
    "utility_rates": 90,
    "market_stats": 30,   # vacancy + turnover
    "county_tax_rate": 180,  # millage/effective rate — set annually, stable
    "cap_rate_comps": 60,    # transaction cap rates for multifamily comps
}
_RENT_TTL_DAYS = 30


class UnitMixEntry(BaseModel):
    beds: int
    baths: float
    count: int = Field(..., gt=0)
    in_place_rent_monthly: float = 0
    target_rent_monthly: float = 0
    rental_type: str = 'LTR'  # 'LTR' | 'MTR' | 'STR' — drives expense economics


class AssumptionsRequest(BaseModel):
    address: str = Field(..., min_length=3)
    unit_mix: list[UnitMixEntry] = Field(..., min_length=1)
    purchase_price: float = Field(..., gt=0)
    nrsf: int | None = None


class CategoryCostDetail(BaseModel):
    category: str
    submarket_key: str | None      # None for property-level queries
    cache_hit: bool
    searches_run: int
    cost_usd: float


class CostBreakdown(BaseModel):
    serper_usd: float
    serper_search_count: int
    gemini_usd: float
    gemini_input_tokens: int
    gemini_output_tokens: int
    total_usd: float
    by_category: list[CategoryCostDetail]


class AssumptionsResponse(BaseModel):
    assumptions: dict[str, Any]
    cost: CostBreakdown
    submarket: dict[str, str] | None   # tract, county, matched_address


# ── Helpers ─────────────────────────────────────────────────────────────────

def _submarket_queries(address: str) -> list[tuple[str, str, str]]:
    """(category, submarket_scope, query) for county/tract-level searches.

    submarket_scope is 'county' or 'tract' — determines which geography key
    to use for caching.
    """
    return [
        ("insurance_rates", "county", f"multifamily landlord insurance rates {address}"),
        ("contract_services", "county", f"commercial trash lawn pest snow removal pricing per unit {address}"),
        ("utility_rates", "county", f"utility rates electric water gas commercial {address}"),
        ("market_stats", "county", f"multifamily vacancy rate market average turnover cost per unit {address}"),
        # Effective tax rate — searches for district-specific rate at the address
        # (school district + city + county + special assessments combined).
        # Cached at county level; AI must still adjust for the specific district mix.
        ("county_tax_rate", "county", f"total effective property tax rate school district city special assessments {address} site:.gov OR site:.us"),
        # Cap rate comps for multifamily in this county/MSA
        ("cap_rate_comps", "county", f"multifamily apartment cap rate transactions 2026 {address}"),
    ]


def _rent_query(address: str, beds: int) -> tuple[str, str, str]:
    return (f"market_rent_{beds}br", "tract", f"{beds} bedroom apartment average rent {address}")


async def _get_or_fetch(
    db: AsyncSession,
    category: str,
    submarket_key: str,
    ttl_days: int,
    query: str,
    num_results: int = 3,
) -> tuple[SerperSearchResult, bool, float]:
    """Return (search_result, cache_hit, cost_incurred_usd)."""
    cached = await get_cached(db, submarket_key, category)
    if cached:
        return (
            SerperSearchResult(
                query=cached.get("query", query),
                results=cached.get("results", []),
                cost_usd=0.0,   # cache hit — no cost
            ),
            True,
            0.0,
        )
    fresh = await search(query, num_results=num_results)
    payload = {"query": fresh.query, "results": fresh.results}
    await upsert_cache(db, submarket_key, category, payload, ttl_days=ttl_days)
    return fresh, False, fresh.cost_usd


# ── Endpoint ────────────────────────────────────────────────────────────────

@router.post("/generate", response_model=AssumptionsResponse)
async def generate(
    payload: AssumptionsRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Generate underwriting assumptions for a property using Serper + Gemini."""
    try:
        return await _generate_impl(payload, db)
    except HTTPException:
        raise  # already a proper HTTP response — pass through
    except Exception as e:
        # Log the FULL traceback so we can debug 500s. FastAPI's default
        # exception handler produces a bare "Internal Server Error" without
        # the actual exception details — this ensures the log always has it.
        tb = traceback.format_exc()
        logger.error("assumptions/generate crashed: %s\n%s", e, tb)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Assumptions generation crashed: {type(e).__name__}: {e}",
        ) from e


async def _generate_impl(
    payload: AssumptionsRequest,
    db: AsyncSession,
) -> AssumptionsResponse:
    """Actual implementation body — separated so the wrapper can log tracebacks."""
    unit_count = sum(u.count for u in payload.unit_mix)
    gpr_annual = sum(
        u.count * (u.target_rent_monthly or u.in_place_rent_monthly) * 12
        for u in payload.unit_mix
    ) or None
    distinct_beds = sorted({u.beds for u in payload.unit_mix})

    # Geocode to get submarket keys. If Census fails, fall back to no-cache mode
    # so the endpoint still works — every search runs fresh.
    submarket_info: dict[str, str] | None = None
    tract_key: str | None = None
    county_key: str | None = None
    try:
        loc = await geocode(payload.address)
        tract_key = f"tract:{loc.census_tract}"
        county_key = f"county:{loc.county_fips}"
        submarket_info = {
            "census_tract": loc.census_tract,
            "county_fips": loc.county_fips,
            "matched_address": loc.matched_address,
        }
    except CensusUnavailableError:
        pass  # no-cache fallback

    all_searches: list[SerperSearchResult] = []
    cost_details: list[CategoryCostDetail] = []
    total_serper_cost = 0.0
    total_search_count = 0

    try:
        # 1) Property tax — always fresh, filtered to official sources
        tax_query = f"county assessor property tax records {payload.address} site:.gov OR site:.us"
        tax_raw = await search(tax_query, num_results=8)
        tax_filtered = filter_official_tax_results(tax_raw)
        all_searches.append(tax_filtered)
        total_serper_cost += tax_raw.cost_usd
        total_search_count += 1
        cost_details.append(CategoryCostDetail(
            category="property_tax_official",
            submarket_key=None,
            cache_hit=False,
            searches_run=1,
            cost_usd=tax_raw.cost_usd,
        ))

        # 2) Submarket-level queries (cacheable if we have geocoding)
        for category, scope, query in _submarket_queries(payload.address):
            key = county_key if scope == "county" else tract_key
            if key is None:
                # No geocoding — bypass cache, run fresh
                fresh = await search(query, num_results=3)
                all_searches.append(fresh)
                total_serper_cost += fresh.cost_usd
                total_search_count += 1
                cost_details.append(CategoryCostDetail(
                    category=category, submarket_key=None, cache_hit=False,
                    searches_run=1, cost_usd=fresh.cost_usd,
                ))
                continue
            result, hit, cost = await _get_or_fetch(
                db, category, key, _CATEGORY_TTL_DAYS[category], query
            )
            # All operating-expense categories: reject consumer listing-site
            # results so the AI reasons from property attributes + area factors
            # + industry benchmarks, not per-listing quotes.
            result = filter_out_listing_sites(result)
            all_searches.append(result)
            total_serper_cost += cost
            total_search_count += (0 if hit else 1)
            cost_details.append(CategoryCostDetail(
                category=category, submarket_key=key, cache_hit=hit,
                searches_run=(0 if hit else 1), cost_usd=cost,
            ))

        # 3) Per-bed-count market rent (tract-level cache)
        for beds in distinct_beds:
            category, scope, query = _rent_query(payload.address, beds)
            key = tract_key
            if key is None:
                fresh = await search(query, num_results=3)
                all_searches.append(fresh)
                total_serper_cost += fresh.cost_usd
                total_search_count += 1
                cost_details.append(CategoryCostDetail(
                    category=category, submarket_key=None, cache_hit=False,
                    searches_run=1, cost_usd=fresh.cost_usd,
                ))
                continue
            result, hit, cost = await _get_or_fetch(
                db, category, key, _RENT_TTL_DAYS, query
            )
            all_searches.append(result)
            total_serper_cost += cost
            total_search_count += (0 if hit else 1)
            cost_details.append(CategoryCostDetail(
                category=category, submarket_key=key, cache_hit=hit,
                searches_run=(0 if hit else 1), cost_usd=cost,
            ))
    except SerperUnavailableError as e:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Search unavailable: {e}",
        ) from e

    search_batch = SerperBatchResult(
        searches=all_searches,
        total_cost_usd=round(total_serper_cost, 6),
    )

    try:
        result = await generate_assumptions(
            address=payload.address,
            unit_count=unit_count,
            nrsf=payload.nrsf,
            gpr_annual=gpr_annual,
            search_batch=search_batch,
            unit_mix_summary=[
                {
                    "type": f"{u.beds}BR/{u.baths}BA",
                    "count": u.count,
                    "in_place_rent_monthly": u.in_place_rent_monthly,
                    "target_rent_monthly": u.target_rent_monthly,
                    "rental_type": u.rental_type,
                }
                for u in payload.unit_mix
            ],
            purchase_price=payload.purchase_price,
            submarket=submarket_info,
        )
    except GeminiUnavailableError as e:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"AI unavailable: {e}",
        ) from e

    total = round(total_serper_cost + result.cost_usd, 6)

    return AssumptionsResponse(
        assumptions=result.assumptions,
        submarket=submarket_info,
        cost=CostBreakdown(
            serper_usd=round(total_serper_cost, 6),
            serper_search_count=total_search_count,
            gemini_usd=result.cost_usd,
            gemini_input_tokens=result.input_tokens,
            gemini_output_tokens=result.output_tokens,
            total_usd=total,
            by_category=cost_details,
        ),
    )
