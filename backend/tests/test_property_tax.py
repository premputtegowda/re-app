"""
Tests for the property tax estimation pipeline.

Covers:
  - Census client (get_fips)
  - Serper client (search_tax_info, search_millage_rate)
  - Property tax service two-phase pipeline (Option B backup search)
  - Gemini response date fallback (_ensure_future_refresh_date)

All external calls (Census, Serper, Gemini) are mocked — no real HTTP or DB connections.
"""
from __future__ import annotations

import json
from datetime import date, timedelta
from typing import Optional
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import httpx

# ---------------------------------------------------------------------------
# Shared test fixtures / constants
# ---------------------------------------------------------------------------

MOCK_FIPS = {
    "fips": "39049",
    "county_name": "Franklin County",
    "state": "OH",
    "matched_address": "123 MAIN ST, COLUMBUS, OH 43215",
}

MOCK_SNIPPETS_PRIMARY = (
    "Franklin County Auditor | Effective millage rate tax district 010 — "
    "2024 rates certified by the county board of revision."
)

MOCK_SNIPPETS_MILLAGE = (
    "Franklin County OH District 010 effective millage 49.77 mills — "
    "Franklin County Auditor official rate table 2024."
)

MOCK_GEMINI_ESTIMATED = {
    "regime_type": "fractional",
    "district_code": "010",
    "assessment_ratio": 0.35,
    "effective_millage": 65.0,
    "millage_confidence": "estimated",
    "net_estimated_annual_tax": 53463,
    "effective_tax_rate_percentage": 2.28,
    "calculation_breakdown": ["step1", "step2"],
    "investor_penalties_applied": ["No homestead"],
    "data_governance": {
        "next_refresh_date": "2027-01-01",
        "refresh_reason": "Annual",
    },
}

MOCK_GEMINI_CONFIRMED = {
    **MOCK_GEMINI_ESTIMATED,
    "effective_millage": 49.77,
    "millage_confidence": "confirmed",
    "net_estimated_annual_tax": 40937,
    "effective_tax_rate_percentage": 1.74,
}

MOCK_GEMINI_REFINED = {
    "effective_millage": 49.77,
    "millage_confidence": "confirmed",
    "net_estimated_annual_tax": 40937,
    "effective_tax_rate_percentage": 1.74,
    "calculation_breakdown": ["Confirmed 49.77 mills from Franklin County Auditor"],
    "millage_source": "Franklin County Auditor District 010 table",
}


# ---------------------------------------------------------------------------
# Census client tests
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_get_fips_success():
    """get_fips returns correct fips/county/state on a successful Census response."""
    census_payload = {
        "result": {
            "addressMatches": [
                {
                    "matchedAddress": "123 MAIN ST, COLUMBUS, OH 43215",
                    "geographies": {
                        "Counties": [
                            {"STATE": "39", "COUNTY": "049", "NAME": "Franklin County"}
                        ]
                    },
                }
            ]
        }
    }

    mock_response = MagicMock()
    mock_response.raise_for_status = MagicMock()
    mock_response.json.return_value = census_payload

    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.get = AsyncMock(return_value=mock_response)

    with patch("app.utils.census_client.httpx.AsyncClient", return_value=mock_client):
        from app.utils.census_client import get_fips
        result = await get_fips("123 Main St, Columbus, OH 43215")

    assert result is not None
    assert result["fips"] == "39049"
    assert result["county_name"] == "Franklin County"
    assert result["state"] == "OH"


@pytest.mark.asyncio
async def test_get_fips_no_match():
    """get_fips returns None when Census returns an empty addressMatches list."""
    census_payload = {"result": {"addressMatches": []}}

    mock_response = MagicMock()
    mock_response.raise_for_status = MagicMock()
    mock_response.json.return_value = census_payload

    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.get = AsyncMock(return_value=mock_response)

    with patch("app.utils.census_client.httpx.AsyncClient", return_value=mock_client):
        from app.utils.census_client import get_fips
        result = await get_fips("999 Nowhere Blvd, Nonexistent, ZZ 00000")

    assert result is None


@pytest.mark.asyncio
async def test_get_fips_state_abbr_zip_separated():
    """
    Regression: Census sometimes returns 'CITY, KS, 66112' with state and zip
    as separate comma-separated segments. _extract_state_abbr must return 'KS'.
    """
    census_payload = {
        "result": {
            "addressMatches": [
                {
                    "matchedAddress": "456 ELM ST, KANSAS CITY, KS, 66112",
                    "geographies": {
                        "Counties": [
                            {"STATE": "20", "COUNTY": "209", "NAME": "Wyandotte County"}
                        ]
                    },
                }
            ]
        }
    }

    mock_response = MagicMock()
    mock_response.raise_for_status = MagicMock()
    mock_response.json.return_value = census_payload

    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.get = AsyncMock(return_value=mock_response)

    with patch("app.utils.census_client.httpx.AsyncClient", return_value=mock_client):
        from app.utils.census_client import get_fips
        result = await get_fips("456 Elm St, Kansas City, KS 66112")

    assert result is not None
    assert result["state"] == "KS"


# ---------------------------------------------------------------------------
# Serper client tests
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_search_tax_info_returns_cleaned_snippets():
    """search_tax_info returns plain text with titles and snippets joined by '|'."""
    serper_payload = {
        "organic": [
            {"title": "Franklin County Auditor", "snippet": "Millage rates 2024"},
            {"title": "Tax District 010", "snippet": "Effective rate 49.77"},
        ]
    }

    mock_response = MagicMock()
    mock_response.raise_for_status = MagicMock()
    mock_response.json.return_value = serper_payload

    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.post = AsyncMock(return_value=mock_response)

    mock_settings = MagicMock()
    mock_settings.serper_api_key = "fake-key"

    with (
        patch("app.utils.serper_client.httpx.AsyncClient", return_value=mock_client),
        patch("app.utils.serper_client.get_settings", return_value=mock_settings),
    ):
        from app.utils.serper_client import search_tax_info
        result = await search_tax_info("123 Main St", "Franklin County", "OH")

    assert result is not None
    assert "Franklin County Auditor" in result
    assert "Millage rates 2024" in result
    assert "|" in result


@pytest.mark.asyncio
async def test_search_tax_info_returns_none_on_failure():
    """search_tax_info returns None when Serper raises an HTTP error."""
    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)

    mock_response = MagicMock()
    mock_response.status_code = 403
    mock_client.post = AsyncMock(
        side_effect=httpx.HTTPStatusError(
            "403 Forbidden", request=MagicMock(), response=mock_response
        )
    )

    mock_settings = MagicMock()
    mock_settings.serper_api_key = "fake-key"

    with (
        patch("app.utils.serper_client.httpx.AsyncClient", return_value=mock_client),
        patch("app.utils.serper_client.get_settings", return_value=mock_settings),
    ):
        from app.utils.serper_client import search_tax_info
        result = await search_tax_info("123 Main St", "Franklin County", "OH")

    assert result is None


@pytest.mark.asyncio
async def test_search_millage_rate_uses_targeted_query():
    """search_millage_rate constructs a query containing district_code and 'effective millage'."""
    serper_payload = {
        "organic": [
            {
                "title": "Franklin County Auditor District 010",
                "snippet": "Effective millage 49.77 mills for district 010",
            }
        ]
    }

    mock_response = MagicMock()
    mock_response.raise_for_status = MagicMock()
    mock_response.json.return_value = serper_payload

    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.post = AsyncMock(return_value=mock_response)

    mock_settings = MagicMock()
    mock_settings.serper_api_key = "fake-key"

    captured_payload: dict = {}

    async def capture_post(url, json=None, headers=None):
        captured_payload.update(json or {})
        return mock_response

    mock_client.post = capture_post

    with (
        patch("app.utils.serper_client.httpx.AsyncClient", return_value=mock_client),
        patch("app.utils.serper_client.get_settings", return_value=mock_settings),
    ):
        from app.utils.serper_client import search_millage_rate
        result = await search_millage_rate("Franklin County", "OH", "010")

    query = captured_payload.get("q", "")
    assert "effective millage" in query.lower()
    assert "010" in query
    assert result is not None


# ---------------------------------------------------------------------------
# Property tax service pipeline tests
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_option_b_fires_when_millage_estimated():
    """
    When the primary Gemini call returns millage_confidence='estimated',
    Option B fires: search_millage_rate is called and refine_millage is used
    to update the result. Final net_estimated_annual_tax and millage_confidence
    must match the refined values.
    """
    mock_db = AsyncMock()
    # Simulate cache miss: scalar_one_or_none returns None
    mock_db.execute = AsyncMock(
        return_value=MagicMock(scalar_one_or_none=MagicMock(return_value=None))
    )
    mock_db.merge = AsyncMock()
    mock_db.commit = AsyncMock()

    with (
        patch("app.services.property_tax_service.get_fips", new=AsyncMock(return_value=MOCK_FIPS)),
        patch("app.services.property_tax_service.search_tax_info", new=AsyncMock(return_value=MOCK_SNIPPETS_PRIMARY)),
        patch("app.services.property_tax_service.estimate_property_tax", new=AsyncMock(return_value=dict(MOCK_GEMINI_ESTIMATED))),
        patch("app.services.property_tax_service.search_millage_rate", new=AsyncMock(return_value=MOCK_SNIPPETS_MILLAGE)) as mock_smr,
        patch("app.services.property_tax_service.refine_millage", new=AsyncMock(return_value=dict(MOCK_GEMINI_REFINED))) as mock_rm,
    ):
        from app.services.property_tax_service import get_property_tax_estimate
        result = await get_property_tax_estimate(
            address="123 Main St, Columbus, OH 43215",
            purchase_price=2_350_000,
            db=mock_db,
        )

    mock_smr.assert_awaited_once()
    mock_rm.assert_awaited_once()
    assert result["net_estimated_annual_tax"] == 40937
    assert result["millage_confidence"] == "confirmed"


@pytest.mark.asyncio
async def test_option_b_skipped_when_millage_confirmed():
    """
    When the primary Gemini call returns millage_confidence='confirmed',
    search_millage_rate must NOT be called.
    """
    mock_db = AsyncMock()
    mock_db.execute = AsyncMock(
        return_value=MagicMock(scalar_one_or_none=MagicMock(return_value=None))
    )
    mock_db.merge = AsyncMock()
    mock_db.commit = AsyncMock()

    with (
        patch("app.services.property_tax_service.get_fips", new=AsyncMock(return_value=MOCK_FIPS)),
        patch("app.services.property_tax_service.search_tax_info", new=AsyncMock(return_value=MOCK_SNIPPETS_PRIMARY)),
        patch("app.services.property_tax_service.estimate_property_tax", new=AsyncMock(return_value=dict(MOCK_GEMINI_CONFIRMED))),
        patch("app.services.property_tax_service.search_millage_rate", new=AsyncMock(return_value=MOCK_SNIPPETS_MILLAGE)) as mock_smr,
        patch("app.services.property_tax_service.refine_millage", new=AsyncMock(return_value=dict(MOCK_GEMINI_REFINED))),
    ):
        from app.services.property_tax_service import get_property_tax_estimate
        result = await get_property_tax_estimate(
            address="123 Main St, Columbus, OH 43215",
            purchase_price=2_350_000,
            db=mock_db,
        )

    mock_smr.assert_not_awaited()
    assert result["millage_confidence"] == "confirmed"


@pytest.mark.asyncio
async def test_option_b_skipped_when_millage_snippets_unavailable():
    """
    When Option B fires but search_millage_rate returns None,
    the pipeline must not crash and must keep the original estimated values.
    """
    mock_db = AsyncMock()
    mock_db.execute = AsyncMock(
        return_value=MagicMock(scalar_one_or_none=MagicMock(return_value=None))
    )
    mock_db.merge = AsyncMock()
    mock_db.commit = AsyncMock()

    with (
        patch("app.services.property_tax_service.get_fips", new=AsyncMock(return_value=MOCK_FIPS)),
        patch("app.services.property_tax_service.search_tax_info", new=AsyncMock(return_value=MOCK_SNIPPETS_PRIMARY)),
        patch("app.services.property_tax_service.estimate_property_tax", new=AsyncMock(return_value=dict(MOCK_GEMINI_ESTIMATED))),
        patch("app.services.property_tax_service.search_millage_rate", new=AsyncMock(return_value=None)),
        patch("app.services.property_tax_service.refine_millage", new=AsyncMock(return_value=dict(MOCK_GEMINI_REFINED))) as mock_rm,
    ):
        from app.services.property_tax_service import get_property_tax_estimate
        result = await get_property_tax_estimate(
            address="123 Main St, Columbus, OH 43215",
            purchase_price=2_350_000,
            db=mock_db,
        )

    # refine_millage must not be called when snippets are unavailable
    mock_rm.assert_not_awaited()
    # Original estimated values are kept
    assert result["net_estimated_annual_tax"] == 53463
    assert result["millage_confidence"] == "estimated"


@pytest.mark.asyncio
async def test_refresh_date_fallback_when_past_date_returned():
    """
    _ensure_future_refresh_date must replace a past next_refresh_date with a
    future date (end of current year).
    """
    from app.utils.gemini_client import _ensure_future_refresh_date

    result = {
        "data_governance": {
            "next_refresh_date": "2024-01-01",
            "refresh_reason": "Annual",
        }
    }
    _ensure_future_refresh_date(result)

    refresh_date = date.fromisoformat(result["data_governance"]["next_refresh_date"])
    assert refresh_date > date.today(), (
        f"Expected a future date but got {refresh_date}"
    )
