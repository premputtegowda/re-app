import pytest
from httpx import AsyncClient

from app.models import User


@pytest.mark.asyncio
async def test_google_login_new_user(
    async_client: AsyncClient, mock_google_verify
):
    """Test Google login creates a new user."""
    response = await async_client.post(
        "/api/auth/google/token",
        json={"credential": "fake_google_token"},
    )

    assert response.status_code == 200
    data = response.json()
    assert "access_token" in data
    assert "refresh_token" in data
    assert data["token_type"] == "bearer"
    assert data["user"]["email"] == "newuser@example.com"
    assert data["user"]["name"] == "New User"


@pytest.mark.asyncio
async def test_google_login_existing_user(
    async_client: AsyncClient, test_user: User, mock_google_verify
):
    """Test Google login with existing user returns tokens."""
    mock_google_verify.return_value = {
        "email": test_user.email,
        "name": test_user.name,
        "picture": test_user.picture_url,
        "google_id": test_user.google_id,
    }

    response = await async_client.post(
        "/api/auth/google/token",
        json={"credential": "fake_google_token"},
    )

    assert response.status_code == 200
    data = response.json()
    assert data["user"]["email"] == test_user.email


@pytest.mark.asyncio
async def test_get_current_user(
    async_client: AsyncClient, test_user: User, auth_headers: dict
):
    """Test getting current authenticated user."""
    response = await async_client.get("/api/auth/me", headers=auth_headers)

    assert response.status_code == 200
    data = response.json()
    assert data["email"] == test_user.email
    assert data["name"] == test_user.name


@pytest.mark.asyncio
async def test_get_current_user_unauthorized(async_client: AsyncClient):
    """Test accessing protected endpoint without token."""
    response = await async_client.get("/api/auth/me")

    assert response.status_code == 401


@pytest.mark.asyncio
async def test_refresh_token(
    async_client: AsyncClient, test_user: User, mock_google_verify
):
    """Test refreshing access token."""
    mock_google_verify.return_value = {
        "email": test_user.email,
        "name": test_user.name,
        "picture": test_user.picture_url,
        "google_id": test_user.google_id,
    }

    # First, login to get tokens
    login_response = await async_client.post(
        "/api/auth/google/token",
        json={"credential": "fake_google_token"},
    )
    refresh_token = login_response.json()["refresh_token"]

    # Then refresh
    response = await async_client.post(
        "/api/auth/refresh",
        json={"refresh_token": refresh_token},
    )

    assert response.status_code == 200
    data = response.json()
    assert "access_token" in data
    assert "refresh_token" in data


@pytest.mark.asyncio
async def test_logout(
    async_client: AsyncClient, test_user: User, auth_headers: dict, mock_google_verify
):
    """Test logging out invalidates refresh token."""
    mock_google_verify.return_value = {
        "email": test_user.email,
        "name": test_user.name,
        "picture": test_user.picture_url,
        "google_id": test_user.google_id,
    }

    # Login to get refresh token
    login_response = await async_client.post(
        "/api/auth/google/token",
        json={"credential": "fake_google_token"},
    )
    refresh_token = login_response.json()["refresh_token"]

    # Logout
    response = await async_client.post(
        "/api/auth/logout",
        json={"refresh_token": refresh_token},
        headers=auth_headers,
    )

    assert response.status_code == 200

    # Try to use the refresh token - should fail
    refresh_response = await async_client.post(
        "/api/auth/refresh",
        json={"refresh_token": refresh_token},
    )

    assert refresh_response.status_code == 401
