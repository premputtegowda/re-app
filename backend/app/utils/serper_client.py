"""Serper.dev search client for fetching property tax jurisdiction data."""
from __future__ import annotations

import logging
from typing import Optional

import httpx

from app.config import get_settings

logger = logging.getLogger(__name__)

_SERPER_URL = "https://google.serper.dev/search"
_TIMEOUT_SECONDS = 10
_MAX_TOKENS = 300  # ~1500 characters at ~5 chars/token


async def search_tax_info(address: str, county_name: str, state: str) -> Optional[str]:
    """
    Search for property tax information for the given jurisdiction using Serper.dev.

    Constructs a targeted query for the county auditor / millage data, extracts
    only organic result titles and snippets, and returns a plain-text string
    capped at approximately 300 tokens.

    Returns None on any failure so the caller can decide how to handle it.
    """
    settings = get_settings()
    api_key = settings.serper_api_key
    if not api_key:
        logger.error("SERPER_API_KEY is not configured")
        return None

    query = (
        f"{county_name} {state} effective millage rate tax district auditor 2024"
    )

    payload = {"q": query, "num": 10}
    headers = {
        "X-API-KEY": api_key,
        "Content-Type": "application/json",
    }

    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT_SECONDS) as client:
            response = await client.post(_SERPER_URL, json=payload, headers=headers)
            response.raise_for_status()
            data = response.json()

        organic_results = data.get("organic", [])
        snippets: list[str] = []
        for result in organic_results:
            title = result.get("title", "").strip()
            snippet = result.get("snippet", "").strip()
            if title or snippet:
                parts = [p for p in [title, snippet] if p]
                snippets.append(" | ".join(parts))

        combined = "\n".join(snippets)
        return _truncate_to_tokens(combined, _MAX_TOKENS)

    except httpx.TimeoutException:
        logger.error("Serper search timed out for address: %s", address)
        return None
    except httpx.HTTPStatusError as exc:
        logger.error("Serper HTTP error %s for address: %s", exc.response.status_code, address)
        return None
    except Exception:
        logger.exception("Serper unexpected error for address: %s", address)
        return None


async def search_millage_rate(county_name: str, state: str, district_code: str) -> Optional[str]:
    """
    Focused backup search for effective millage rate when primary search didn't
    yield a confirmed rate. Targets the county auditor's specific district table.

    Returns None on any failure so the caller can decide how to handle it.
    """
    settings = get_settings()
    api_key = settings.serper_api_key
    if not api_key:
        logger.error("SERPER_API_KEY is not configured")
        return None

    query = f"{county_name} {state} tax district {district_code} effective millage rate 2024"

    payload = {"q": query, "num": 10}
    headers = {
        "X-API-KEY": api_key,
        "Content-Type": "application/json",
    }

    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT_SECONDS) as client:
            response = await client.post(_SERPER_URL, json=payload, headers=headers)
            response.raise_for_status()
            data = response.json()

        organic_results = data.get("organic", [])
        snippets: list[str] = []
        for result in organic_results:
            title = result.get("title", "").strip()
            snippet = result.get("snippet", "").strip()
            if title or snippet:
                parts = [p for p in [title, snippet] if p]
                snippets.append(" | ".join(parts))

        combined = "\n".join(snippets)
        # Cap at ~200 tokens for focused millage snippets
        return _truncate_to_tokens(combined, 200)

    except httpx.TimeoutException:
        logger.error("Serper millage search timed out for %s %s district %s", county_name, state, district_code)
        return None
    except httpx.HTTPStatusError as exc:
        logger.error(
            "Serper HTTP error %s for millage search %s %s district %s",
            exc.response.status_code, county_name, state, district_code,
        )
        return None
    except Exception:
        logger.exception("Serper unexpected error for millage search %s %s district %s", county_name, state, district_code)
        return None


def _truncate_to_tokens(text: str, max_tokens: int) -> str:
    """
    Truncate text to approximately max_tokens tokens.
    Uses a conservative estimate of 5 characters per token.
    """
    max_chars = max_tokens * 5
    if len(text) <= max_chars:
        return text
    truncated = text[:max_chars]
    # Truncate at a word boundary to avoid cutting mid-word
    last_space = truncated.rfind(" ")
    if last_space > 0:
        truncated = truncated[:last_space]
    return truncated + " [truncated]"
