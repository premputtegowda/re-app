import pytest
from datetime import date
from httpx import AsyncClient

from app.models import User, Category, Property, Entry


@pytest.mark.asyncio
async def test_create_entry(
    async_client: AsyncClient,
    test_user: User,
    test_category: Category,
    test_property: Property,
    auth_headers: dict,
):
    """Test creating a new entry."""
    response = await async_client.post(
        "/api/entries",
        json={
            "date": str(date.today()),
            "hours": 2,
            "minutes": 30,
            "category_id": str(test_category.id),
            "property_id": str(test_property.id),
            "type": "material",
            "description": "Test work entry",
        },
        headers=auth_headers,
    )

    assert response.status_code == 201
    data = response.json()
    assert data["hours"] == 2
    assert data["minutes"] == 30
    assert data["total_minutes"] == 150  # 2*60 + 30
    assert data["category_id"] == str(test_category.id)
    assert data["property_id"] == str(test_property.id)
    assert data["type"] == "material"


@pytest.mark.asyncio
async def test_create_entry_non_material(
    async_client: AsyncClient,
    test_user: User,
    test_category: Category,
    test_property: Property,
    auth_headers: dict,
):
    """Test creating a non-material entry."""
    response = await async_client.post(
        "/api/entries",
        json={
            "date": str(date.today()),
            "hours": 1,
            "minutes": 0,
            "category_id": str(test_category.id),
            "property_id": str(test_property.id),
            "type": "non-material",
            "description": "Non-material work",
        },
        headers=auth_headers,
    )

    assert response.status_code == 201
    data = response.json()
    assert data["type"] == "non-material"


@pytest.mark.asyncio
async def test_create_entry_future_date(
    async_client: AsyncClient,
    test_category: Category,
    test_property: Property,
    auth_headers: dict,
):
    """Test that future dates are rejected."""
    from datetime import timedelta
    future_date = date.today() + timedelta(days=1)

    response = await async_client.post(
        "/api/entries",
        json={
            "date": str(future_date),
            "hours": 1,
            "minutes": 0,
            "category_id": str(test_category.id),
            "property_id": str(test_property.id),
            "type": "material",
            "description": "Future entry",
        },
        headers=auth_headers,
    )

    assert response.status_code == 422


@pytest.mark.asyncio
async def test_list_entries(
    async_client: AsyncClient,
    test_user: User,
    test_category: Category,
    test_property: Property,
    auth_headers: dict,
):
    """Test listing entries with filters."""
    # Create an entry first
    await async_client.post(
        "/api/entries",
        json={
            "date": str(date.today()),
            "hours": 3,
            "minutes": 0,
            "category_id": str(test_category.id),
            "property_id": str(test_property.id),
            "type": "material",
            "description": "List test entry",
        },
        headers=auth_headers,
    )

    response = await async_client.get("/api/entries", headers=auth_headers)

    assert response.status_code == 200
    data = response.json()
    assert len(data) >= 1


@pytest.mark.asyncio
async def test_list_entries_with_date_filter(
    async_client: AsyncClient,
    test_user: User,
    test_category: Category,
    test_property: Property,
    auth_headers: dict,
):
    """Test listing entries with date range filter."""
    today = date.today()

    await async_client.post(
        "/api/entries",
        json={
            "date": str(today),
            "hours": 1,
            "minutes": 0,
            "category_id": str(test_category.id),
            "property_id": str(test_property.id),
            "type": "material",
            "description": "Today's entry",
        },
        headers=auth_headers,
    )

    response = await async_client.get(
        f"/api/entries?start_date={today}&end_date={today}",
        headers=auth_headers,
    )

    assert response.status_code == 200
    data = response.json()
    assert len(data) >= 1


@pytest.mark.asyncio
async def test_get_entry(
    async_client: AsyncClient,
    test_category: Category,
    test_property: Property,
    auth_headers: dict,
):
    """Test getting a specific entry."""
    create_response = await async_client.post(
        "/api/entries",
        json={
            "date": str(date.today()),
            "hours": 2,
            "minutes": 0,
            "category_id": str(test_category.id),
            "property_id": str(test_property.id),
            "type": "material",
            "description": "Get test entry",
        },
        headers=auth_headers,
    )
    entry_id = create_response.json()["id"]

    response = await async_client.get(
        f"/api/entries/{entry_id}",
        headers=auth_headers,
    )

    assert response.status_code == 200
    data = response.json()
    assert data["id"] == entry_id


@pytest.mark.asyncio
async def test_update_entry(
    async_client: AsyncClient,
    test_category: Category,
    test_property: Property,
    auth_headers: dict,
):
    """Test updating an entry."""
    create_response = await async_client.post(
        "/api/entries",
        json={
            "date": str(date.today()),
            "hours": 2,
            "minutes": 0,
            "category_id": str(test_category.id),
            "property_id": str(test_property.id),
            "type": "material",
            "description": "Original description",
        },
        headers=auth_headers,
    )
    entry_id = create_response.json()["id"]

    response = await async_client.put(
        f"/api/entries/{entry_id}",
        json={
            "date": str(date.today()),
            "hours": 3,
            "minutes": 30,
            "category_id": str(test_category.id),
            "property_id": str(test_property.id),
            "type": "material",
            "description": "Updated description",
        },
        headers=auth_headers,
    )

    assert response.status_code == 200
    data = response.json()
    assert data["hours"] == 3
    assert data["minutes"] == 30
    assert data["description"] == "Updated description"


@pytest.mark.asyncio
async def test_delete_entry(
    async_client: AsyncClient,
    test_category: Category,
    test_property: Property,
    auth_headers: dict,
):
    """Test deleting an entry."""
    create_response = await async_client.post(
        "/api/entries",
        json={
            "date": str(date.today()),
            "hours": 1,
            "minutes": 0,
            "category_id": str(test_category.id),
            "property_id": str(test_property.id),
            "type": "material",
            "description": "To delete",
        },
        headers=auth_headers,
    )
    entry_id = create_response.json()["id"]

    response = await async_client.delete(
        f"/api/entries/{entry_id}",
        headers=auth_headers,
    )

    assert response.status_code == 204

    # Verify deleted
    get_response = await async_client.get(
        f"/api/entries/{entry_id}",
        headers=auth_headers,
    )
    assert get_response.status_code == 404


@pytest.mark.asyncio
async def test_bulk_create_entries(
    async_client: AsyncClient,
    test_category: Category,
    test_property: Property,
    auth_headers: dict,
):
    """Test bulk creating entries (for migration)."""
    entries = [
        {
            "date": str(date.today()),
            "hours": 1,
            "minutes": 0,
            "category_id": str(test_category.id),
            "property_id": str(test_property.id),
            "type": "material",
            "description": "Bulk entry 1",
        },
        {
            "date": str(date.today()),
            "hours": 2,
            "minutes": 0,
            "category_id": str(test_category.id),
            "property_id": str(test_property.id),
            "type": "non-material",
            "description": "Bulk entry 2",
        },
    ]

    response = await async_client.post(
        "/api/entries/bulk",
        json={"entries": entries},
        headers=auth_headers,
    )

    assert response.status_code == 201
    data = response.json()
    assert data["created"] == 2
