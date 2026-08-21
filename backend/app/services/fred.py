"""FRED (Federal Reserve Economic Data) client for market mortgage rate.

Caches the latest MORTGAGE30US observation in-process for 7 days. The upstream
series updates weekly (Thursdays), so one refresh per week per backend instance
is sufficient — no DB persistence required.
"""

import asyncio
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Optional

import httpx

from app.config import get_settings

FRED_URL = "https://api.stlouisfed.org/fred/series/observations"
DEFAULT_SERIES = "MORTGAGE30US"  # 30-Year Fixed Rate Mortgage Average, weekly
CACHE_TTL = timedelta(days=7)
HTTP_TIMEOUT = 10.0


@dataclass(frozen=True)
class MortgageRate:
    rate: float          # percent, e.g. 7.05
    as_of: str           # ISO date of the observation, e.g. "2026-08-08"
    series: str          # FRED series id


class FredUnavailableError(RuntimeError):
    """Raised when we can't obtain a rate (missing key, network error, bad response)."""


_cache: Optional[tuple[MortgageRate, datetime]] = None
_lock = asyncio.Lock()


async def get_mortgage_rate() -> MortgageRate:
    """Return the latest 30-yr fixed mortgage rate, using a 7-day process cache.

    Raises FredUnavailableError if FRED_API_KEY is missing or the API can't be
    reached / returns an unusable response.
    """
    global _cache

    now = datetime.utcnow()
    if _cache and now - _cache[1] < CACHE_TTL:
        return _cache[0]

    async with _lock:
        # Re-check inside the lock in case a concurrent caller already refreshed.
        if _cache and now - _cache[1] < CACHE_TTL:
            return _cache[0]

        api_key = get_settings().fred_api_key
        if not api_key:
            raise FredUnavailableError("FRED_API_KEY is not configured")

        params = {
            "series_id": DEFAULT_SERIES,
            "api_key": api_key,
            "file_type": "json",
            "sort_order": "desc",
            "limit": 1,
        }
        try:
            async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as client:
                response = await client.get(FRED_URL, params=params)
                response.raise_for_status()
                data = response.json()
        except (httpx.HTTPError, ValueError) as e:
            raise FredUnavailableError(f"FRED request failed: {e}") from e

        observations = data.get("observations") or []
        if not observations:
            raise FredUnavailableError("FRED returned no observations")

        latest = observations[0]
        value = latest.get("value")
        as_of = latest.get("date")
        # FRED marks missing data as "."
        if not as_of or value in (None, ".", ""):
            raise FredUnavailableError("FRED latest observation has no value")

        try:
            rate = float(value)
        except (TypeError, ValueError) as e:
            raise FredUnavailableError(f"FRED returned non-numeric value: {value!r}") from e

        result = MortgageRate(rate=rate, as_of=as_of, series=DEFAULT_SERIES)
        _cache = (result, now)
        return result


def _reset_cache_for_tests() -> None:
    """Clear the module-level cache. Tests use this between cases."""
    global _cache
    _cache = None
