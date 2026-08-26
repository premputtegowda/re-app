"""Census Geocoder — turn a US street address into Census Tract + County FIPS.

Uses the free public Census Geocoder API — no API key required.
Reference: https://geocoding.geo.census.gov/geocoder/
"""

import asyncio
from dataclasses import dataclass
from typing import Optional

import httpx

CENSUS_URL = "https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress"
BENCHMARK = "Public_AR_Current"
VINTAGE = "Current_Current"
HTTP_TIMEOUT = 10.0


@dataclass(frozen=True)
class CensusLocation:
    census_tract: str      # 11-digit GEOID: state(2) + county(3) + tract(6)
    county_fips: str       # 5-digit: state(2) + county(3)
    state_fips: str        # 2-digit
    matched_address: str   # what Census matched (may differ from input)


class CensusUnavailableError(RuntimeError):
    """Raised when the Census Geocoder is unreachable or address unresolvable."""


# Small in-process cache — geocoding a given address is deterministic and
# doesn't change during a session.
_cache: dict[str, CensusLocation] = {}
_lock = asyncio.Lock()


async def geocode(address: str) -> CensusLocation:
    """Resolve a street address to Census Tract + County FIPS."""
    key = address.strip().lower()
    if key in _cache:
        return _cache[key]

    async with _lock:
        if key in _cache:
            return _cache[key]

        params = {
            "address": address,
            "benchmark": BENCHMARK,
            "vintage": VINTAGE,
            "layers": "Census Tracts,Counties",
            "format": "json",
        }
        try:
            async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as client:
                resp = await client.get(CENSUS_URL, params=params)
                resp.raise_for_status()
                data = resp.json()
        except (httpx.HTTPError, ValueError) as e:
            raise CensusUnavailableError(f"Census geocoder failed: {e}") from e

        matches = (data.get("result") or {}).get("addressMatches") or []
        if not matches:
            raise CensusUnavailableError(f"Address not found by Census: {address}")

        m = matches[0]
        geographies = m.get("geographies") or {}
        tracts = geographies.get("Census Tracts") or []
        counties = geographies.get("Counties") or []
        if not tracts or not counties:
            raise CensusUnavailableError("Census matched address but returned no tract/county")

        tract = tracts[0]
        county = counties[0]
        location = CensusLocation(
            census_tract=str(tract.get("GEOID", "")),
            county_fips=str(county.get("GEOID", "")),
            state_fips=str(county.get("STATE", "")),
            matched_address=str(m.get("matchedAddress", address)),
        )
        _cache[key] = location
        return location


def _reset_cache_for_tests() -> None:
    _cache.clear()
