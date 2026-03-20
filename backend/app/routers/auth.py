import secrets
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status, Response, Request
from fastapi.responses import RedirectResponse
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import get_db
from app.dependencies import get_current_user
from app.models import User, RefreshToken, Category, Property, Invitation, AccessRequest
from app.schemas import TokenResponse, GoogleAuthRequest, RefreshRequest, UserResponse
from app.services.oauth import verify_google_token, get_google_auth_url, exchange_code_for_tokens, GoogleOAuthError
from app.utils.security import (
    create_access_token,
    create_refresh_token,
    hash_token,
    get_refresh_token_expires_at,
)

router = APIRouter(prefix="/auth", tags=["Authentication"])
settings = get_settings()

# Default categories for new users
DEFAULT_CATEGORIES = [
    {"name": "Property Management", "color": "#3B82F6"},
    {"name": "Maintenance & Repairs", "color": "#10B981"},
    {"name": "Tenant Relations", "color": "#F59E0B"},
    {"name": "Financial Records", "color": "#8B5CF6"},
    {"name": "Property Inspections", "color": "#EC4899"},
]


async def create_default_data(db: AsyncSession, user: User) -> None:
    """Create default categories and a sample property for new users."""
    # Create default categories
    for cat_data in DEFAULT_CATEGORIES:
        category = Category(
            user_id=user.id,
            name=cat_data["name"],
            color=cat_data["color"],
        )
        db.add(category)

    # Create a default property
    default_property = Property(
        user_id=user.id,
        name="My First Property",
        address="",
    )
    db.add(default_property)

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

    # New user — check for a valid invite
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


async def create_tokens(db: AsyncSession, user: User) -> TokenResponse:
    """Create access and refresh tokens for a user."""
    access_token = create_access_token(user.id)
    refresh_token = create_refresh_token()

    # Store refresh token hash in database
    refresh_token_record = RefreshToken(
        user_id=user.id,
        token_hash=hash_token(refresh_token),
        expires_at=get_refresh_token_expires_at(),
    )
    db.add(refresh_token_record)
    await db.commit()

    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        expires_in=settings.access_token_expire_minutes * 60,
        user=UserResponse.model_validate(user),
    )


@router.get("/google/authorize")
async def google_authorize():
    """Redirect to Google OAuth authorization page."""
    state = secrets.token_urlsafe(32)
    auth_url = await get_google_auth_url(state)
    # In production, store state in session/cookie for CSRF validation
    return RedirectResponse(url=auth_url)


@router.get("/google/callback")
async def google_callback(
    code: str,
    state: str,
    db: AsyncSession = Depends(get_db),
):
    """Handle Google OAuth callback (redirect flow)."""
    try:
        # Exchange code for tokens
        tokens = await exchange_code_for_tokens(code)
        id_token = tokens.get("id_token")

        if not id_token:
            raise GoogleOAuthError("No ID token in response")

        # Verify and extract user info
        user_info = await verify_google_token(id_token)

        # Get or create user
        user, is_new = await get_or_create_user(db, user_info)

        # Create default data for new users
        if is_new:
            await create_default_data(db, user)

        await apply_pending_invite(db, user)

        # Create tokens
        token_response = await create_tokens(db, user)

        # Redirect to frontend with tokens
        redirect_url = (
            f"{settings.frontend_url}/auth/callback"
            f"?access_token={token_response.access_token}"
            f"&refresh_token={token_response.refresh_token}"
        )
        return RedirectResponse(url=redirect_url)

    except GoogleOAuthError as e:
        redirect_url = f"{settings.frontend_url}/auth/error?message={str(e)}"
        return RedirectResponse(url=redirect_url)


@router.post("/google/token", response_model=TokenResponse)
async def google_token(
    request: GoogleAuthRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Exchange Google credential (ID token) for access/refresh tokens.
    Used for popup flow where frontend gets the credential directly.
    """
    try:
        user_info = await verify_google_token(request.credential)
        user, is_new = await get_or_create_user(db, user_info)

        if is_new:
            await create_default_data(db, user)

        await apply_pending_invite(db, user)

        return await create_tokens(db, user)

    except GoogleOAuthError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(e),
        )


@router.post("/refresh", response_model=TokenResponse)
async def refresh_tokens(
    request: RefreshRequest,
    db: AsyncSession = Depends(get_db),
):
    """Exchange a valid refresh token for new access/refresh tokens."""
    token_hash = hash_token(request.refresh_token)

    # Find the refresh token
    result = await db.execute(
        select(RefreshToken).where(RefreshToken.token_hash == token_hash)
    )
    refresh_token_record = result.scalar_one_or_none()

    if not refresh_token_record:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid refresh token",
        )

    # Check if expired
    if refresh_token_record.expires_at < datetime.utcnow():
        await db.delete(refresh_token_record)
        await db.commit()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh token expired",
        )

    # Get the user
    result = await db.execute(
        select(User).where(User.id == refresh_token_record.user_id)
    )
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
        )

    # Delete the old refresh token (single use)
    await db.delete(refresh_token_record)
    await db.commit()

    # Create new tokens
    return await create_tokens(db, user)


@router.post("/logout")
async def logout(
    request: RefreshRequest,
    db: AsyncSession = Depends(get_db),
):
    """Invalidate the refresh token."""
    token_hash = hash_token(request.refresh_token)

    await db.execute(
        delete(RefreshToken).where(RefreshToken.token_hash == token_hash)
    )
    await db.commit()

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
