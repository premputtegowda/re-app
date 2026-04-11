import logging
import secrets
from datetime import datetime

logger = logging.getLogger(__name__)

from fastapi import APIRouter, Depends, HTTPException, status, Response, Request
from fastapi.responses import RedirectResponse
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import get_db
from app.dependencies import get_current_user
from app.models import User, RefreshToken, Category, Property, Invitation, AccessRequest
from app.schemas import TokenResponse, GoogleAuthRequest, UserResponse
from app.services.oauth import (
    verify_google_token,
    get_google_auth_url,
    exchange_code_for_tokens,
    get_gmail_auth_url,
    exchange_gmail_code,
    get_gmail_sender_email,
    GoogleOAuthError,
)
from app.utils.security import (
    create_access_token,
    create_refresh_token,
    hash_token,
    get_refresh_token_expires_at,
)

router = APIRouter(prefix="/auth", tags=["Authentication"])
settings = get_settings()

REFRESH_COOKIE_NAME = "refresh_token"

# Default categories for new users
DEFAULT_CATEGORIES = [
    {"name": "Property Management", "color": "#3B82F6"},
    {"name": "Maintenance & Repairs", "color": "#10B981"},
    {"name": "Tenant Relations", "color": "#F59E0B"},
    {"name": "Financial Records", "color": "#8B5CF6"},
    {"name": "Property Inspections", "color": "#EC4899"},
]


def _set_refresh_cookie(response: Response, token: str, expires_at: datetime) -> None:
    """Set the refresh token as an HttpOnly cookie.

    In production (HTTPS) the frontend and backend are on different domains, so
    we need SameSite=None to allow the cookie to be sent with cross-origin fetch
    requests (credentials: 'include').  SameSite=None requires Secure=True.
    In local development (HTTP) we fall back to SameSite=Lax because browsers
    reject SameSite=None on non-secure connections.
    """
    secure = settings.frontend_url.startswith("https")
    samesite = "none" if secure else "lax"
    response.set_cookie(
        key=REFRESH_COOKIE_NAME,
        value=token,
        httponly=True,
        secure=secure,
        samesite=samesite,
        expires=int(expires_at.timestamp()),
        path="/api/auth",  # Only sent to auth endpoints — limits exposure
    )


def _clear_refresh_cookie(response: Response) -> None:
    """Remove the refresh token cookie."""
    response.delete_cookie(key=REFRESH_COOKIE_NAME, path="/api/auth")


async def create_default_data(db: AsyncSession, user: User) -> None:
    """Create default categories for new users."""
    for cat_data in DEFAULT_CATEGORIES:
        category = Category(
            user_id=user.id,
            name=cat_data["name"],
            color=cat_data["color"],
        )
        db.add(category)

    await db.commit()


async def apply_pending_invite(db: AsyncSession, user: User) -> None:
    """If a non-expired, unaccepted invite exists for this email, apply complimentary access."""
    now = datetime.utcnow()
    result = await db.execute(
        select(Invitation).where(
            Invitation.email == user.email,
            Invitation.accepted_at.is_(None),
            Invitation.expires_at > now,
        )
    )
    invite = result.scalar_one_or_none()
    if invite:
        user.has_complimentary_access = True
        invite.accepted_at = now
        await db.commit()


async def get_or_create_user(db: AsyncSession, user_info: dict) -> tuple[User, bool]:
    """
    Get existing user or create new one.
    New users without a valid invite are blocked — an AccessRequest is saved instead.
    Returns (user, is_new_user)
    """
    # Check if user exists by google_id
    result = await db.execute(
        select(User).where(User.google_id == user_info["google_id"])
    )
    user = result.scalar_one_or_none()

    if user:
        # Update user info from Google (in case name/picture changed)
        user.name = user_info["name"]
        user.picture_url = user_info.get("picture")
        user.updated_at = datetime.utcnow()
        await db.commit()
        await db.refresh(user)
        return user, False

    # New user — check invite gate
    if settings.invite_only:
        now = datetime.utcnow()
        invite_result = await db.execute(
            select(Invitation).where(
                Invitation.email == user_info["email"],
                Invitation.accepted_at.is_(None),
                Invitation.expires_at > now,
            )
        )
        has_invite = invite_result.scalar_one_or_none() is not None

        if not has_invite:
            # Save or update an access request so admin can approve it
            existing_req = await db.execute(
                select(AccessRequest).where(
                    AccessRequest.email == user_info["email"],
                    AccessRequest.status == "pending",
                )
            )
            already_pending = existing_req.scalar_one_or_none() is not None
            if not already_pending:
                db.add(AccessRequest(
                    email=user_info["email"],
                    name=user_info["name"],
                    picture_url=user_info.get("picture"),
                ))
                await db.commit()

            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="ACCESS_REQUEST_PENDING" if already_pending else "ACCESS_REQUEST_SUBMITTED",
            )

    # Create new user
    user = User(
        email=user_info["email"],
        name=user_info["name"],
        picture_url=user_info.get("picture"),
        google_id=user_info["google_id"],
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    return user, True


async def create_tokens(db: AsyncSession, user: User, response: Response) -> TokenResponse:
    """Create access token + set refresh token as HttpOnly cookie."""
    access_token = create_access_token(user.id)
    refresh_token = create_refresh_token()
    expires_at = get_refresh_token_expires_at()

    # Store refresh token hash in database
    refresh_token_record = RefreshToken(
        user_id=user.id,
        token_hash=hash_token(refresh_token),
        expires_at=expires_at,
    )
    db.add(refresh_token_record)
    await db.commit()

    _set_refresh_cookie(response, refresh_token, expires_at)

    return TokenResponse(
        access_token=access_token,
        expires_in=settings.access_token_expire_minutes * 60,
        user=UserResponse.model_validate(user),
    )


@router.get("/google/authorize")
async def google_authorize():
    """Redirect to Google OAuth authorization page."""
    state = secrets.token_urlsafe(32)
    auth_url = await get_google_auth_url(state)
    return RedirectResponse(url=auth_url)


@router.get("/google/callback")
async def google_callback(
    code: str,
    state: str,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    """
    Shared Google OAuth callback for both login and Gmail sender flows.
    Gmail flows use state prefixed with 'gmail:'.
    """
    # ── Gmail sender flow ──────────────────────────────────────────────────────
    if state.startswith("gmail:"):
        import hmac as _hmac, hashlib as _hashlib, time as _time, uuid as _uuid
        raw_state = state[len("gmail:"):]
        try:
            user_id_str, timestamp_str, sig = raw_state.rsplit(":", 2)
            expected_sig = _hmac.new(
                settings.jwt_secret_key.encode(),
                f"{user_id_str}:{timestamp_str}".encode(),
                _hashlib.sha256,
            ).hexdigest()[:16]
            if not _hmac.compare_digest(expected_sig, sig):
                raise ValueError("bad sig")
            if _time.time() - int(timestamp_str) > 600:
                raise ValueError("state expired")
        except Exception:
            return RedirectResponse(f"{settings.frontend_url}/deal-analyzer/settings?gmail_error=invalid_state")

        try:
            tokens = await exchange_gmail_code(code)
            refresh_token = tokens.get("refresh_token")
            access_token = tokens.get("access_token")
            if not refresh_token:
                raise GoogleOAuthError("No refresh_token — consent screen may not have appeared")
            sender_email = await get_gmail_sender_email(access_token)
        except GoogleOAuthError as exc:
            logger.warning("Gmail OAuth exchange failed: %s", exc)
            return RedirectResponse(f"{settings.frontend_url}/deal-analyzer/settings?gmail_error=oauth_failed")

        result = await db.execute(select(User).where(User.id == _uuid.UUID(user_id_str)))
        user = result.scalar_one_or_none()
        if not user:
            return RedirectResponse(f"{settings.frontend_url}/deal-analyzer/settings?gmail_error=user_not_found")

        user.gmail_refresh_token = refresh_token
        user.gmail_sender_email = sender_email
        user.updated_at = datetime.utcnow()
        await db.commit()
        logger.info("Gmail sender connected for user %s (%s)", user.id, sender_email)
        return RedirectResponse(f"{settings.frontend_url}/deal-analyzer/settings?gmail_connected=1")

    # ── Login flow ─────────────────────────────────────────────────────────────
    try:
        tokens = await exchange_code_for_tokens(code)
        id_token = tokens.get("id_token")

        if not id_token:
            raise GoogleOAuthError("No ID token in response")

        user_info = await verify_google_token(id_token)
        user, is_new = await get_or_create_user(db, user_info)

        if is_new:
            await create_default_data(db, user)

        await apply_pending_invite(db, user)

        token_response = await create_tokens(db, user, response)

        redirect_url = (
            f"{settings.frontend_url}/auth/callback"
            f"?access_token={token_response.access_token}"
        )
        return RedirectResponse(url=redirect_url)

    except GoogleOAuthError as e:
        redirect_url = f"{settings.frontend_url}/auth/error?message={str(e)}"
        return RedirectResponse(url=redirect_url)


@router.post("/google/token", response_model=TokenResponse)
async def google_token(
    request: GoogleAuthRequest,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    """
    Exchange Google credential (ID token) for access token.
    Refresh token is set as an HttpOnly cookie — never exposed to JavaScript.
    """
    try:
        user_info = await verify_google_token(request.credential)
        user, is_new = await get_or_create_user(db, user_info)

        if is_new:
            await create_default_data(db, user)

        await apply_pending_invite(db, user)

        return await create_tokens(db, user, response)

    except GoogleOAuthError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(e),
        )


@router.post("/refresh", response_model=TokenResponse)
async def refresh_tokens(
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    """
    Exchange a valid refresh token (from HttpOnly cookie) for a new access token.
    Issues a new refresh token cookie (single-use rotation).
    """
    token = request.cookies.get(REFRESH_COOKIE_NAME)
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="No refresh token",
        )

    token_hash = hash_token(token)

    result = await db.execute(
        select(RefreshToken).where(RefreshToken.token_hash == token_hash)
    )
    refresh_token_record = result.scalar_one_or_none()

    if not refresh_token_record:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid refresh token",
        )

    if refresh_token_record.expires_at < datetime.utcnow():
        await db.delete(refresh_token_record)
        await db.commit()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh token expired",
        )

    result = await db.execute(
        select(User).where(User.id == refresh_token_record.user_id)
    )
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
        )

    # Delete old token (single-use rotation)
    await db.delete(refresh_token_record)
    await db.commit()

    return await create_tokens(db, user, response)


@router.post("/logout")
async def logout(
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    """Invalidate the refresh token and clear the cookie."""
    token = request.cookies.get(REFRESH_COOKIE_NAME)
    if token:
        token_hash = hash_token(token)
        await db.execute(
            delete(RefreshToken).where(RefreshToken.token_hash == token_hash)
        )
        await db.commit()

    _clear_refresh_cookie(response)
    return {"message": "Logged out successfully"}


@router.get("/me", response_model=UserResponse)
async def get_current_user_info(
    current_user: User = Depends(get_current_user),
):
    """Get the current authenticated user."""
    return current_user


@router.delete("/me")
async def delete_account(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete the current user's account and all associated data."""
    await db.delete(current_user)
    await db.commit()
    return {"message": "Account deleted successfully"}


# ── Gmail OAuth (send LOI emails from user's Gmail) ───────────────────────────

@router.get("/gmail/authorize")
async def gmail_authorize(
    current_user: User = Depends(get_current_user),
):
    """
    Return the Google OAuth URL that grants gmail.send permission.
    State is prefixed with 'gmail:' so the shared google/callback can route it.
    """
    import hmac as _hmac, hashlib as _hashlib, time as _time
    raw_state = f"{current_user.id}:{int(_time.time())}"
    sig = _hmac.new(
        settings.jwt_secret_key.encode(), raw_state.encode(), _hashlib.sha256
    ).hexdigest()[:16]
    state = f"gmail:{raw_state}:{sig}"
    url = get_gmail_auth_url(state)
    return {"url": url}


@router.delete("/gmail/disconnect")
async def gmail_disconnect(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Remove the stored Gmail OAuth token."""
    current_user.gmail_refresh_token = None
    current_user.gmail_sender_email = None
    current_user.updated_at = datetime.utcnow()
    await db.commit()
    return {"message": "Gmail disconnected"}
