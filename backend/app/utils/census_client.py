"""US Census Geocoding API client for resolving FIPS codes from addresses."""
from __future__ import annotations

import logging
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

_CENSUS_URL = "https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress"
_TIMEOUT_SECONDS = 10


async def get_fips(address: str) -> Optional[dict]:
    """
    Resolve a property address to FIPS code, county name, and state via the
    US Census Geocoding API (free, no API key required).

    Returns a dict with keys: fips, county_name, state, matched_address.
    Returns None on any failure so the caller can apply a fallback.
    """
    params = {
        "address": address,
        "benchmark": "Public_AR_Current",
        "vintage": "Current_Current",
        "format": "json",
        "layers": "all",
    }

    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT_SECONDS) as client:
            response = await client.get(_CENSUS_URL, params=params)
            response.raise_for_status()
            data = response.json()

        address_matches = (
            data.get("result", {})
            .get("addressMatches", [])
        )
        if not address_matches:
            logger.warning("Census geocoder returned no address matches for: %s", address)
            return None

        match = address_matches[0]
        matched_address: str = match.get("matchedAddress", address)

        geographies = match.get("geographies", {})

        # Layer 84 = counties; layer 6 = census tracts (contains state FIPS)
        counties = geographies.get("Counties", [])
        if not counties:
            logger.warning("Census geocoder returned no county data for: %s", address)
            return None

        county = counties[0]
        state_fips: str = county.get("STATE", "")
        county_fips: str = county.get("COUNTY", "")
        county_name: str = county.get("NAME", "")

        if not state_fips or not county_fips:
            logger.warning("Census geocoder missing STATE/COUNTY FIPS for: %s", address)
            return None

        # 5-digit FIPS = 2-digit state + 3-digit county
        fips = f"{state_fips}{county_fips}"

        # Derive state abbreviation from state name via the matched address
        # The Census API does not return a state abbreviation directly — parse
        # it from the matchedAddress string (last two chars before the zip).
        state_abbr = _extract_state_abbr(matched_address)

        # School district — drives most millage variation within a county
        unified = geographies.get("Unified School Districts", [{}])[0]
        secondary = geographies.get("Secondary School Districts", [{}])[0]
        school_district = unified.get("NAME") or secondary.get("NAME") or ""

        return {
            "fips": fips,
            "county_name": county_name,
            "state": state_abbr,
            "school_district": school_district,
            "matched_address": matched_address,
        }

    except httpx.TimeoutException:
        logger.error("Census geocoder timed out for address: %s", address)
        return None
    except httpx.HTTPStatusError as exc:
        logger.error("Census geocoder HTTP error %s for address: %s", exc.response.status_code, address)
        return None
    except Exception:
        logger.exception("Census geocoder unexpected error for address: %s", address)
        return None


def _extract_state_abbr(matched_address: str) -> str:
    """
    Parse the 2-letter state abbreviation from a Census matched address string.

    Two formats observed:
      - "123 MAIN ST, CITY, OH 43215"     (state + zip in same segment)
      - "123 MAIN ST, CITY, KS, 66112"    (state and zip in separate segments)

    Returns empty string if unable to parse.
    """
    try:
        parts = [p.strip() for p in matched_address.split(",")]
        if len(parts) < 2:
            return ""

        last = parts[-1]
        # If last segment is all digits (zip only), state is in second-to-last
        if last.replace("-", "").isdigit():
            state_segment = parts[-2]
        else:
            state_segment = last  # "OH 43215" — state is first token

        tokens = state_segment.split()
        return tokens[0] if tokens else ""
    except Exception:
        return ""
