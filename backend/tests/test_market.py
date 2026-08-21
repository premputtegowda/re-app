"""Tests for the market mortgage-rate endpoint."""
from unittest.mock import AsyncMock, patch

import httpx
import pytest
from httpx import AsyncClient

from app.services import fred as fred_service


@pytest.fixture(autouse=True)
def clear_fred_cache():
    """Reset the in-process FRED cache before each test so cases don't leak."""
    fred_service._reset_cache_for_tests()
    yield
    fred_service._reset_cache_for_tests()


def _mock_httpx_response(json_payload: dict, status_code: int = 200) -> AsyncMock:
    """Build an AsyncMock context-manager that simulates httpx.AsyncClient()."""
    response = AsyncMock()
    response.json = lambda: json_payload
    response.status_code = status_code
    response.raise_for_status = (
        (lambda: None)
        if status_code < 400
        else _raise_for_status_factory(status_code)
    )

    client_cm = AsyncMock()
    client_cm.__aenter__.return_value.get = AsyncMock(return_value=response)
    return client_cm


def _raise_for_status_factory(code: int):
    def _raise():
        raise httpx.HTTPStatusError(
            f"status {code}", request=httpx.Request("GET", "http://x"), response=httpx.Response(code)
        )
    return _raise


@pytest.mark.asyncio
async def test_mortgage_rate_happy_path(async_client: AsyncClient, auth_headers: dict):
    payload = {"observations": [{"date": "2026-08-08", "value": "7.05"}]}
    with patch("app.services.fred.get_settings") as get_settings, \
         patch("app.services.fred.httpx.AsyncClient", return_value=_mock_httpx_response(payload)):
        get_settings.return_value.fred_api_key = "test-key"
        response = await async_client.get("/api/market/mortgage-rate", headers=auth_headers)

    assert response.status_code == 200
    body = response.json()
    assert body == {"rate": 7.05, "asOf": "2026-08-08", "series": "MORTGAGE30US"}


@pytest.mark.asyncio
async def test_mortgage_rate_cache_hit_avoids_second_fetch(async_client: AsyncClient, auth_headers: dict):
    """Second call within the TTL should return cached data without re-hitting FRED."""
    payload = {"observations": [{"date": "2026-08-08", "value": "7.05"}]}
    mock_client = _mock_httpx_response(payload)

    with patch("app.services.fred.get_settings") as get_settings, \
         patch("app.services.fred.httpx.AsyncClient", return_value=mock_client) as async_client_ctor:
        get_settings.return_value.fred_api_key = "test-key"
        r1 = await async_client.get("/api/market/mortgage-rate", headers=auth_headers)
        r2 = await async_client.get("/api/market/mortgage-rate", headers=auth_headers)

    assert r1.status_code == 200
    assert r2.status_code == 200
    assert r1.json() == r2.json()
    # httpx.AsyncClient() should have been constructed exactly once
    assert async_client_ctor.call_count == 1


@pytest.mark.asyncio
async def test_mortgage_rate_missing_api_key_returns_503(async_client: AsyncClient, auth_headers: dict):
    with patch("app.services.fred.get_settings") as get_settings:
        get_settings.return_value.fred_api_key = ""
        response = await async_client.get("/api/market/mortgage-rate", headers=auth_headers)
    assert response.status_code == 503
    assert "FRED_API_KEY" in response.json()["detail"]


@pytest.mark.asyncio
async def test_mortgage_rate_fred_network_error_returns_503(async_client: AsyncClient, auth_headers: dict):
    client_cm = AsyncMock()
    client_cm.__aenter__.return_value.get = AsyncMock(
        side_effect=httpx.HTTPError("boom")
    )
    with patch("app.services.fred.get_settings") as get_settings, \
         patch("app.services.fred.httpx.AsyncClient", return_value=client_cm):
        get_settings.return_value.fred_api_key = "test-key"
        response = await async_client.get("/api/market/mortgage-rate", headers=auth_headers)
    assert response.status_code == 503


@pytest.mark.asyncio
async def test_mortgage_rate_empty_observations_returns_503(async_client: AsyncClient, auth_headers: dict):
    with patch("app.services.fred.get_settings") as get_settings, \
         patch("app.services.fred.httpx.AsyncClient", return_value=_mock_httpx_response({"observations": []})):
        get_settings.return_value.fred_api_key = "test-key"
        response = await async_client.get("/api/market/mortgage-rate", headers=auth_headers)
    assert response.status_code == 503


@pytest.mark.asyncio
async def test_mortgage_rate_requires_auth(async_client: AsyncClient):
    response = await async_client.get("/api/market/mortgage-rate")
    assert response.status_code == 401
