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
async def test_create_category_with_color(
    async_client: AsyncClient, test_user: User, auth_headers: dict
):
    """Test creating a category with a specific color."""
    response = await async_client.post(
        "/api/categories",
        json={"name": "Custom Color Category", "color": "#FF5733"},
        headers=auth_headers,
    )

    assert response.status_code == 201
    data = response.json()
    assert data["color"] == "#FF5733"


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

    assert response.status_code == 409
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


@pytest.mark.asyncio
async def test_get_category_not_found(
    async_client: AsyncClient, auth_headers: dict
):
    """Test getting non-existent category returns 404."""
    import uuid
    response = await async_client.get(
        f"/api/categories/{uuid.uuid4()}",
        headers=auth_headers,
    )
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_update_category_not_found(
    async_client: AsyncClient, auth_headers: dict
):
    """Test updating non-existent category returns 404."""
    import uuid
    response = await async_client.put(
        f"/api/categories/{uuid.uuid4()}",
        json={"name": "Updated", "color": "#FF0000"},
        headers=auth_headers,
    )
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_delete_category_not_found(
    async_client: AsyncClient, auth_headers: dict
):
    """Test deleting non-existent category returns 404."""
    import uuid
    response = await async_client.delete(
        f"/api/categories/{uuid.uuid4()}",
        headers=auth_headers,
    )
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_create_category_invalid_color(
    async_client: AsyncClient, auth_headers: dict
):
    """Test creating category with invalid color fails."""
    response = await async_client.post(
        "/api/categories",
        json={"name": "Invalid Color", "color": "not-a-color"},
        headers=auth_headers,
    )
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_create_category_short_name(
    async_client: AsyncClient, auth_headers: dict
):
    """Test creating category with too short name fails."""
    response = await async_client.post(
        "/api/categories",
        json={"name": "A", "color": "#FF5733"},
        headers=auth_headers,
    )
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_category_unauthorized(async_client: AsyncClient):
    """Test category endpoints require authentication."""
    response = await async_client.get("/api/categories")
    assert response.status_code in [401, 403]


@pytest.mark.asyncio
async def test_update_category_duplicate_name(
    async_client: AsyncClient, test_user: User, auth_headers: dict
):
    """Test updating category to duplicate name fails."""
    # Create first category
    await async_client.post(
        "/api/categories",
        json={"name": "First Category", "color": "#FF0000"},
        headers=auth_headers,
    )

    # Create second category
    create_response = await async_client.post(
        "/api/categories",
        json={"name": "Second Category", "color": "#00FF00"},
        headers=auth_headers,
    )
    second_id = create_response.json()["id"]

    # Try to update second to have first's name
    response = await async_client.put(
        f"/api/categories/{second_id}",
        json={"name": "First Category"},
        headers=auth_headers,
    )
    assert response.status_code == 409


@pytest.mark.asyncio
async def test_delete_category_with_entries(
    async_client: AsyncClient,
    test_category: Category,
    test_property,
    auth_headers: dict,
):
    """Test deleting category with entries fails."""
    from datetime import date

    # Create an entry using the category
    await async_client.post(
        "/api/entries",
        json={
            "date": str(date.today()),
            "hours": 1,
            "minutes": 0,
            "category_id": str(test_category.id),
            "property_id": str(test_property.id),
            "type": "material",
            "description": "Test entry",
        },
        headers=auth_headers,
    )

    # Try to delete the category
    response = await async_client.delete(
        f"/api/categories/{test_category.id}",
        headers=auth_headers,
    )
    assert response.status_code == 409
    assert "entries" in response.json()["detail"].lower()
