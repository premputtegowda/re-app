import pytest
from httpx import AsyncClient

from app.models import User, Property


@pytest.mark.asyncio
async def test_create_property(
    async_client: AsyncClient, test_user: User, auth_headers: dict
):
    """Test creating a new property."""
    response = await async_client.post(
        "/api/properties",
        json={"name": "New Property", "address": "456 New Street"},
        headers=auth_headers,
    )

    assert response.status_code == 201
    data = response.json()
    assert data["name"] == "New Property"
    assert data["address"] == "456 New Street"
    assert "id" in data


@pytest.mark.asyncio
async def test_create_property_without_address(
    async_client: AsyncClient, test_user: User, auth_headers: dict
):
    """Test creating a property without address."""
    response = await async_client.post(
        "/api/properties",
        json={"name": "No Address Property"},
        headers=auth_headers,
    )

    assert response.status_code == 201
    data = response.json()
    assert data["name"] == "No Address Property"
    assert data["address"] is None


@pytest.mark.asyncio
async def test_create_duplicate_property(
    async_client: AsyncClient, test_property: Property, auth_headers: dict
):
    """Test creating a duplicate property fails."""
    response = await async_client.post(
        "/api/properties",
        json={"name": test_property.name},
        headers=auth_headers,
    )

    assert response.status_code == 409
    assert "already exists" in response.json()["detail"].lower()


@pytest.mark.asyncio
async def test_list_properties(
    async_client: AsyncClient, test_property: Property, auth_headers: dict
):
    """Test listing user's properties."""
    response = await async_client.get("/api/properties", headers=auth_headers)

    assert response.status_code == 200
    data = response.json()
    assert len(data) >= 1
    assert any(p["name"] == test_property.name for p in data)


@pytest.mark.asyncio
async def test_get_property(
    async_client: AsyncClient, test_property: Property, auth_headers: dict
):
    """Test getting a specific property."""
    response = await async_client.get(
        f"/api/properties/{test_property.id}",
        headers=auth_headers,
    )

    assert response.status_code == 200
    data = response.json()
    assert data["id"] == str(test_property.id)
    assert data["name"] == test_property.name


@pytest.mark.asyncio
async def test_update_property(
    async_client: AsyncClient, test_property: Property, auth_headers: dict
):
    """Test updating a property."""
    response = await async_client.put(
        f"/api/properties/{test_property.id}",
        json={"name": "Updated Property", "address": "789 Updated Ave"},
        headers=auth_headers,
    )

    assert response.status_code == 200
    data = response.json()
    assert data["name"] == "Updated Property"
    assert data["address"] == "789 Updated Ave"


@pytest.mark.asyncio
async def test_delete_property(
    async_client: AsyncClient, test_property: Property, auth_headers: dict
):
    """Test deleting a property."""
    response = await async_client.delete(
        f"/api/properties/{test_property.id}",
        headers=auth_headers,
    )

    assert response.status_code == 204

    # Verify it's deleted
    get_response = await async_client.get(
        f"/api/properties/{test_property.id}",
        headers=auth_headers,
    )
    assert get_response.status_code == 404


@pytest.mark.asyncio
async def test_property_isolation(
    async_client: AsyncClient, test_property: Property, admin_auth_headers: dict
):
    """Test that users can only see their own properties."""
    response = await async_client.get(
        f"/api/properties/{test_property.id}",
        headers=admin_auth_headers,
    )

    # Admin should not see another user's property
    assert response.status_code == 404
