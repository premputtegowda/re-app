import pytest
from httpx import AsyncClient

from app.models import User, Category


@pytest.mark.asyncio
async def test_create_category(
    async_client: AsyncClient, test_user: User, auth_headers: dict
):
    """Test creating a new category."""
    response = await async_client.post(
        "/api/categories",
        json={"name": "New Category", "color": "#FF5733"},
        headers=auth_headers,
    )

    assert response.status_code == 201
    data = response.json()
    assert data["name"] == "New Category"
    assert data["color"] == "#FF5733"
    assert "id" in data


@pytest.mark.asyncio
async def test_create_category_default_color(
    async_client: AsyncClient, test_user: User, auth_headers: dict
):
    """Test creating a category with default color."""
    response = await async_client.post(
        "/api/categories",
        json={"name": "Default Color Category"},
        headers=auth_headers,
    )

    assert response.status_code == 201
    data = response.json()
    assert data["color"] == "#3B82F6"  # Default blue


@pytest.mark.asyncio
async def test_create_duplicate_category(
    async_client: AsyncClient, test_category: Category, auth_headers: dict
):
    """Test creating a duplicate category fails."""
    response = await async_client.post(
        "/api/categories",
        json={"name": test_category.name, "color": "#FF5733"},
        headers=auth_headers,
    )

    assert response.status_code == 400
    assert "already exists" in response.json()["detail"].lower()


@pytest.mark.asyncio
async def test_list_categories(
    async_client: AsyncClient, test_category: Category, auth_headers: dict
):
    """Test listing user's categories."""
    response = await async_client.get("/api/categories", headers=auth_headers)

    assert response.status_code == 200
    data = response.json()
    assert len(data) >= 1
    assert any(c["name"] == test_category.name for c in data)


@pytest.mark.asyncio
async def test_get_category(
    async_client: AsyncClient, test_category: Category, auth_headers: dict
):
    """Test getting a specific category."""
    response = await async_client.get(
        f"/api/categories/{test_category.id}",
        headers=auth_headers,
    )

    assert response.status_code == 200
    data = response.json()
    assert data["id"] == str(test_category.id)
    assert data["name"] == test_category.name


@pytest.mark.asyncio
async def test_update_category(
    async_client: AsyncClient, test_category: Category, auth_headers: dict
):
    """Test updating a category."""
    response = await async_client.put(
        f"/api/categories/{test_category.id}",
        json={"name": "Updated Category", "color": "#00FF00"},
        headers=auth_headers,
    )

    assert response.status_code == 200
    data = response.json()
    assert data["name"] == "Updated Category"
    assert data["color"] == "#00FF00"


@pytest.mark.asyncio
async def test_delete_category(
    async_client: AsyncClient, test_category: Category, auth_headers: dict
):
    """Test deleting a category."""
    response = await async_client.delete(
        f"/api/categories/{test_category.id}",
        headers=auth_headers,
    )

    assert response.status_code == 204

    # Verify it's deleted
    get_response = await async_client.get(
        f"/api/categories/{test_category.id}",
        headers=auth_headers,
    )
    assert get_response.status_code == 404


@pytest.mark.asyncio
async def test_category_isolation(
    async_client: AsyncClient, test_category: Category, admin_auth_headers: dict
):
    """Test that users can only see their own categories."""
    response = await async_client.get(
        f"/api/categories/{test_category.id}",
        headers=admin_auth_headers,
    )

    # Admin should not see another user's category
    assert response.status_code == 404
