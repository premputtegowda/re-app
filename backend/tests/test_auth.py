import pytest
from unittest.mock import patch, MagicMock
from httpx import AsyncClient

from app.models import User


@pytest.mark.asyncio
async def test_google_login_new_user(
    async_client: AsyncClient, mock_google_verify
):
    """Test Google login creates a new user and sets HttpOnly refresh cookie."""
    mock_settings = MagicMock(
        invite_only=False,
        access_token_expire_minutes=15,
        frontend_url="http://localhost:3000",
    )
    with patch("app.routers.auth.settings", mock_settings):
        response = await async_client.post(
            "/api/auth/google/token",
            json={"credential": "fake_google_token"},
        )

        assert response.status_code == 200
        data = response.json()
        assert "access_token" in data
        assert "refresh_token" not in data  # never exposed to JS
        assert data["token_type"] == "bearer"
        assert data["user"]["email"] == "newuser@example.com"
        assert data["user"]["name"] == "New User"
        # Refresh token arrives as an HttpOnly cookie
        assert "refresh_token" in response.cookies


@pytest.mark.asyncio
async def test_google_login_existing_user(
    async_client: AsyncClient, test_user: User, mock_google_verify
):
    """Test Google login with existing user returns access token."""
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
    """Test refreshing access token via HttpOnly cookie."""
    mock_google_verify.return_value = {
        "email": test_user.email,
        "name": test_user.name,
        "picture": test_user.picture_url,
        "google_id": test_user.google_id,
    }

    # Login — httpx AsyncClient automatically stores the Set-Cookie
    await async_client.post(
        "/api/auth/google/token",
        json={"credential": "fake_google_token"},
    )

    # Refresh using the cookie (no body needed)
    response = await async_client.post("/api/auth/refresh")

    assert response.status_code == 200
    data = response.json()
    assert "access_token" in data
    assert "refresh_token" not in data
    # A new refresh cookie should be issued (token rotation)
    assert "refresh_token" in response.cookies


@pytest.mark.asyncio
async def test_refresh_token_missing_cookie(async_client: AsyncClient):
    """Test refresh without a cookie returns 401."""
    response = await async_client.post("/api/auth/refresh")
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_logout(
    async_client: AsyncClient, test_user: User, auth_headers: dict, mock_google_verify
):
    """Test logging out invalidates the refresh cookie."""
    mock_google_verify.return_value = {
        "email": test_user.email,
        "name": test_user.name,
        "picture": test_user.picture_url,
        "google_id": test_user.google_id,
    }

    # Login — stores cookie in client
    await async_client.post(
        "/api/auth/google/token",
        json={"credential": "fake_google_token"},
    )

    # Logout
    response = await async_client.post("/api/auth/logout")
    assert response.status_code == 200

    # Try to refresh after logout — should fail (token deleted from DB)
    refresh_response = await async_client.post("/api/auth/refresh")
    assert refresh_response.status_code == 401
