import pytest
from datetime import date, timedelta
from httpx import AsyncClient

from app.models import User, Category, Property


@pytest.mark.asyncio
async def test_get_summary(
    async_client: AsyncClient,
    test_user: User,
    test_category: Category,
    test_property: Property,
    auth_headers: dict,
):
    """Test getting summary analytics."""
    # Create some entries
    await async_client.post(
        "/api/entries",
        json={
            "date": str(date.today()),
            "hours": 2,
            "minutes": 30,
            "category_id": str(test_category.id),
            "property_id": str(test_property.id),
            "type": "material",
            "description": "Summary test entry",
        },
        headers=auth_headers,
    )

    response = await async_client.get("/api/analytics/summary", headers=auth_headers)

    assert response.status_code == 200
    data = response.json()
    assert "entries_count" in data
    assert "total_minutes" in data
    assert "material_minutes" in data
    assert "non_material_minutes" in data
    assert data["entries_count"] >= 1
    assert data["total_minutes"] >= 150  # 2h 30m = 150 min


@pytest.mark.asyncio
async def test_get_summary_with_date_range(
    async_client: AsyncClient,
    test_user: User,
    test_category: Category,
    test_property: Property,
    auth_headers: dict,
):
    """Test getting summary with date filters."""
    today = date.today()
    yesterday = today - timedelta(days=1)

    await async_client.post(
        "/api/entries",
        json={
            "date": str(yesterday),
            "hours": 1,
            "minutes": 0,
            "category_id": str(test_category.id),
            "property_id": str(test_property.id),
            "type": "material",
            "description": "Yesterday entry",
        },
        headers=auth_headers,
    )

    # Query only today - should not include yesterday's entry
    response = await async_client.get(
        f"/api/analytics/summary?start_date={today}&end_date={today}",
        headers=auth_headers,
    )

    assert response.status_code == 200


@pytest.mark.asyncio
async def test_get_by_category(
    async_client: AsyncClient,
    test_user: User,
    test_category: Category,
    test_property: Property,
    auth_headers: dict,
):
    """Test getting analytics by category."""
    await async_client.post(
        "/api/entries",
        json={
            "date": str(date.today()),
            "hours": 3,
            "minutes": 0,
            "category_id": str(test_category.id),
            "property_id": str(test_property.id),
            "type": "material",
            "description": "Category test entry",
        },
        headers=auth_headers,
    )

    response = await async_client.get(
        "/api/analytics/by-category",
        headers=auth_headers,
    )

    assert response.status_code == 200
    data = response.json()
    assert len(data) >= 1
    # Find the test category in results
    category_data = next(
        (c for c in data if c["category_id"] == str(test_category.id)), None
    )
    assert category_data is not None
    assert category_data["total_minutes"] >= 180  # 3 hours


@pytest.mark.asyncio
async def test_get_by_property(
    async_client: AsyncClient,
    test_user: User,
    test_category: Category,
    test_property: Property,
    auth_headers: dict,
):
    """Test getting analytics by property."""
    await async_client.post(
        "/api/entries",
        json={
            "date": str(date.today()),
            "hours": 4,
            "minutes": 0,
            "category_id": str(test_category.id),
            "property_id": str(test_property.id),
            "type": "material",
            "description": "Property test entry",
        },
        headers=auth_headers,
    )

    response = await async_client.get(
        "/api/analytics/by-property",
        headers=auth_headers,
    )

    assert response.status_code == 200
    data = response.json()
    assert len(data) >= 1
    # Find the test property in results
    property_data = next(
        (p for p in data if p["property_id"] == str(test_property.id)), None
    )
    assert property_data is not None
    assert property_data["total_minutes"] >= 240  # 4 hours


@pytest.mark.asyncio
async def test_get_monthly(
    async_client: AsyncClient,
    test_user: User,
    test_category: Category,
    test_property: Property,
    auth_headers: dict,
):
    """Test getting monthly analytics."""
    await async_client.post(
        "/api/entries",
        json={
            "date": str(date.today()),
            "hours": 5,
            "minutes": 0,
            "category_id": str(test_category.id),
            "property_id": str(test_property.id),
            "type": "material",
            "description": "Monthly test entry",
        },
        headers=auth_headers,
    )

    response = await async_client.get(
        "/api/analytics/monthly",
        headers=auth_headers,
    )

    assert response.status_code == 200
    data = response.json()
    assert len(data) >= 1

    current_month = date.today().strftime("%Y-%m")
    month_data = next((m for m in data if m["month"] == current_month), None)
    assert month_data is not None
    assert month_data["total_minutes"] >= 300  # 5 hours


@pytest.mark.asyncio
async def test_analytics_unauthorized(async_client: AsyncClient):
    """Test analytics endpoints require authentication."""
    endpoints = [
        "/api/analytics/summary",
        "/api/analytics/by-category",
        "/api/analytics/by-property",
        "/api/analytics/monthly",
    ]

    for endpoint in endpoints:
        response = await async_client.get(endpoint)
        assert response.status_code in [401, 403], f"Expected 401 or 403 for {endpoint}"
