import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_health_check(async_client: AsyncClient):
    """Test the health check endpoint."""
    response = await async_client.get("/health")
    assert response.status_code == 200
    assert response.json() == "OK"


@pytest.mark.asyncio
async def test_root_endpoint(async_client: AsyncClient):
    """Test the root endpoint."""
    response = await async_client.get("/")
    assert response.status_code == 200
