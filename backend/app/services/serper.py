"""Serper.dev Google Search client with per-call cost tracking.

Prepaid pricing (as of 2026): ~$1 per 1,000 queries → $0.001/query.
"""

from dataclasses import dataclass
from typing import Any

import httpx

from app.config import get_settings

SERPER_URL = "https://google.serper.dev/search"
COST_PER_SEARCH = 0.001  # USD
HTTP_TIMEOUT = 15.0


@dataclass(frozen=True)
class SerperSearchResult:
    query: str
    results: list[dict[str, Any]]   # organic results
    cost_usd: float                  # this single search


@dataclass(frozen=True)
class SerperBatchResult:
    searches: list[SerperSearchResult]
    total_cost_usd: float


class SerperUnavailableError(RuntimeError):
    """Raised when the Serper key is missing or the API is unreachable."""


async def search(query: str, num_results: int = 8) -> SerperSearchResult:
    """Run a single Google search via Serper.dev."""
    api_key = get_settings().serper_api_key
    if not api_key:
        raise SerperUnavailableError("SERPER_API_KEY is not configured")

    headers = {"X-API-KEY": api_key, "Content-Type": "application/json"}
    payload = {"q": query, "num": num_results}

    try:
        async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as client:
            response = await client.post(SERPER_URL, headers=headers, json=payload)
            response.raise_for_status()
            data = response.json()
    except (httpx.HTTPError, ValueError) as e:
        raise SerperUnavailableError(f"Serper request failed: {e}") from e

    organic = data.get("organic", []) or []
    trimmed = [
        {
            "title": r.get("title", ""),
            "link": r.get("link", ""),
            "snippet": r.get("snippet", ""),
        }
        for r in organic
    ]
    return SerperSearchResult(query=query, results=trimmed, cost_usd=COST_PER_SEARCH)


async def batch_search(queries: list[str], num_results: int = 8) -> SerperBatchResult:
    """Run multiple searches sequentially, aggregate cost."""
    results: list[SerperSearchResult] = []
    for q in queries:
        results.append(await search(q, num_results=num_results))
    total = sum(r.cost_usd for r in results)
    return SerperBatchResult(searches=results, total_cost_usd=total)


# Trusted domain suffixes/keywords for property tax sources. Any URL that
# doesn't match one of these is dropped for the tax query, since the model
# has been known to cite unrelated real-estate listings.
_TAX_OFFICIAL_MARKERS = (
    ".gov",
    ".us",
    "assessor",
    "treasurer",
    "auditor",
    "propertytax",
)


def filter_official_tax_results(result: SerperSearchResult) -> SerperSearchResult:
    """Drop non-official-looking URLs from a tax-query result."""
    kept = [
        r for r in result.results
        if any(marker in (r.get("link", "") or "").lower() for marker in _TAX_OFFICIAL_MARKERS)
    ]
    return SerperSearchResult(query=result.query, results=kept, cost_usd=result.cost_usd)


# Consumer real-estate listing sites that quote "insurance $XXX/mo" for a
# specific listing — the number is a rough estimate for that one property, not
# a market benchmark. Reject for insurance/tax queries so the AI reasons from
# property attributes and area factors instead.
_LISTING_SITE_MARKERS = (
    "zillow.com",
    "redfin.com",
    "realtor.com",
    "trulia.com",
    "homes.com",
    "coldwellbanker",
    "ikeyrealty",
    "movoto.com",
    "compass.com",
    "century21.com",
    "remax.com",
    "berkshirehathaway",
    "kw.com",
    "opendoor.com",
    "estately.com",
)


def filter_out_listing_sites(result: SerperSearchResult) -> SerperSearchResult:
    """Drop consumer listing-site URLs; keep everything else."""
    kept = [
        r for r in result.results
        if not any(marker in (r.get("link", "") or "").lower() for marker in _LISTING_SITE_MARKERS)
    ]
    return SerperSearchResult(query=result.query, results=kept, cost_usd=result.cost_usd)
