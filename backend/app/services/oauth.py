from google.oauth2 import id_token
from google.auth.transport import requests
import httpx

from app.config import get_settings

settings = get_settings()


class GoogleOAuthError(Exception):
    pass


async def verify_google_token(credential: str) -> dict:
    """
    Verify Google ID token and return user info.

    Args:
        credential: The Google ID token from frontend

    Returns:
        dict with keys: email, name, picture, google_id

    Raises:
        GoogleOAuthError if verification fails
    """
    try:
        # Verify the token with Google
        idinfo = id_token.verify_oauth2_token(
            credential,
            requests.Request(),
            settings.google_client_id
        )

        # Check issuer
        if idinfo["iss"] not in ["accounts.google.com", "https://accounts.google.com"]:
            raise GoogleOAuthError("Invalid token issuer")

        # Check if email is verified
        if not idinfo.get("email_verified", False):
            raise GoogleOAuthError("Email not verified with Google")

        return {
            "email": idinfo["email"],
            "name": idinfo.get("name", idinfo["email"].split("@")[0]),
            "picture": idinfo.get("picture"),
            "google_id": idinfo["sub"],
        }

    except ValueError as e:
        raise GoogleOAuthError(f"Invalid token: {str(e)}")


async def get_google_auth_url(state: str) -> str:
    """
    Generate Google OAuth authorization URL.

    Args:
        state: CSRF protection state parameter

    Returns:
        Authorization URL to redirect user to
    """
    params = {
        "client_id": settings.google_client_id,
        "redirect_uri": settings.google_redirect_uri,
        "response_type": "code",
        "scope": "openid email profile",
        "state": state,
        "access_type": "offline",
        "prompt": "consent",
    }
    query = "&".join(f"{k}={v}" for k, v in params.items())
    return f"https://accounts.google.com/o/oauth2/v2/auth?{query}"


async def exchange_code_for_tokens(code: str) -> dict:
    """
    Exchange authorization code for tokens.

    Args:
        code: Authorization code from Google callback

    Returns:
        dict with access_token and id_token

    Raises:
        GoogleOAuthError if exchange fails
    """
    async with httpx.AsyncClient() as client:
        response = await client.post(
            "https://oauth2.googleapis.com/token",
            data={
                "client_id": settings.google_client_id,
                "client_secret": settings.google_client_secret,
                "code": code,
                "grant_type": "authorization_code",
                "redirect_uri": settings.google_redirect_uri,
            },
        )

        if response.status_code != 200:
            raise GoogleOAuthError(f"Token exchange failed: {response.text}")

        return response.json()


# ── Gmail OAuth (for sending emails on behalf of users) ───────────────────────

GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send"


def get_gmail_auth_url(state: str) -> str:
    """
    Generate a Google OAuth URL that requests gmail.send permission.
    Reuses GOOGLE_REDIRECT_URI — no second URI needs registering in Google Cloud Console.
    The state carries a 'gmail:' prefix so the shared callback can route correctly.
    """
    settings = get_settings()
    from urllib.parse import urlencode
    params = {
        "client_id": settings.google_client_id,
        "redirect_uri": settings.google_redirect_uri,
        "response_type": "code",
        "scope": f"openid email {GMAIL_SEND_SCOPE}",
        "state": state,
        "access_type": "offline",
        "prompt": "consent",  # always show consent to guarantee refresh_token
    }
    return f"https://accounts.google.com/o/oauth2/v2/auth?{urlencode(params)}"


async def exchange_gmail_code(code: str) -> dict:
    """
    Exchange an authorization code for Gmail OAuth tokens.
    Returns dict containing at minimum: access_token, refresh_token, id_token.
    """
    settings = get_settings()
    async with httpx.AsyncClient() as client:
        response = await client.post(
            "https://oauth2.googleapis.com/token",
            data={
                "client_id": settings.google_client_id,
                "client_secret": settings.google_client_secret,
                "code": code,
                "grant_type": "authorization_code",
                "redirect_uri": settings.google_redirect_uri,
            },
        )
        if response.status_code != 200:
            raise GoogleOAuthError(f"Gmail token exchange failed: {response.text}")
        return response.json()


async def get_gmail_sender_email(access_token: str) -> str:
    """Fetch the email address of the Gmail account just authorized."""
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            "https://www.googleapis.com/oauth2/v3/userinfo",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        resp.raise_for_status()
        return resp.json().get("email", "")
