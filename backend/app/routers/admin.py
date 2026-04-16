import json
import logging
import secrets
from datetime import datetime, timedelta
from uuid import UUID

logger = logging.getLogger(__name__)

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import get_db
from app.dependencies import get_current_admin_user
from app.models import User, Entry, Invitation, AccessRequest
from app.services.email import get_smtp_sender

router = APIRouter(prefix="/admin", tags=["Admin"])

INVITE_EXPIRY_DAYS = 7


# ── Schemas ────────────────────────────────────────────────────────────────────

class AdminUserSummary(BaseModel):
    id: UUID
    name: str
    email: str
    picture_url: str | None
    is_admin: bool
    has_complimentary_access: bool
    features: list[str]
    created_at: str
    last_active: str | None
    entry_count: int

    class Config:
        from_attributes = True


class PatchUserRequest(BaseModel):
    is_admin: bool | None = None
    has_complimentary_access: bool | None = None
    add_feature: str | None = None
    remove_feature: str | None = None


class InviteRequest(BaseModel):
    email: EmailStr


class InvitationSummary(BaseModel):
    id: UUID
    email: str
    invited_by: str
    created_at: str
    expires_at: str
    accepted_at: str | None
    is_expired: bool


# ── Helpers ────────────────────────────────────────────────────────────────────

def _parse_features(val) -> list[str]:
    """Return features as a Python list regardless of storage format (list or JSON string)."""
    if isinstance(val, str):
        try:
            return json.loads(val)
        except (json.JSONDecodeError, ValueError):
            return []
    return list(val or [])


async def _user_summary(user: User, db: AsyncSession) -> AdminUserSummary:
    counts_result = await db.execute(
        select(func.count(Entry.id)).where(Entry.user_id == user.id)
    )
    entry_count = counts_result.scalar() or 0

    last_result = await db.execute(
        select(func.max(Entry.date)).where(Entry.user_id == user.id)
    )
    last_active = last_result.scalar()

    return AdminUserSummary(
        id=user.id,
        name=user.name,
        email=user.email,
        picture_url=user.picture_url,
        is_admin=user.is_admin,
        has_complimentary_access=user.has_complimentary_access,
        features=_parse_features(user.features),
        created_at=user.created_at.date().isoformat(),
        last_active=str(last_active) if last_active else None,
        entry_count=entry_count,
    )


# ── User endpoints ─────────────────────────────────────────────────────────────

@router.get("/users", response_model=list[AdminUserSummary])
async def list_users(
    _admin: User = Depends(get_current_admin_user),
    db: AsyncSession = Depends(get_db),
):
    """Return metadata for all users. No entry content is exposed."""
    users_result = await db.execute(select(User).order_by(User.created_at.desc()))
    users = users_result.scalars().all()

    counts_result = await db.execute(
        select(Entry.user_id, func.count(Entry.id).label("cnt")).group_by(Entry.user_id)
    )
    counts = {row.user_id: row.cnt for row in counts_result}

    last_active_result = await db.execute(
        select(Entry.user_id, func.max(Entry.date).label("last")).group_by(Entry.user_id)
    )
    last_active = {row.user_id: str(row.last) for row in last_active_result}

    return [
        AdminUserSummary(
            id=u.id,
            name=u.name,
            email=u.email,
            picture_url=u.picture_url,
            is_admin=u.is_admin,
            has_complimentary_access=u.has_complimentary_access,
            features=_parse_features(u.features),
            created_at=u.created_at.date().isoformat(),
            last_active=last_active.get(u.id),
            entry_count=counts.get(u.id, 0),
        )
        for u in users
    ]


@router.patch("/users/{user_id}", response_model=AdminUserSummary)
async def patch_user(
    user_id: UUID,
    body: PatchUserRequest,
    admin: User = Depends(get_current_admin_user),
    db: AsyncSession = Depends(get_db),
):
    """Grant/revoke admin or complimentary access. Admins cannot demote themselves."""
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    if user.id == admin.id and body.is_admin is False:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot remove your own admin access",
        )

    if body.is_admin is not None:
        user.is_admin = body.is_admin
    if body.has_complimentary_access is not None:
        user.has_complimentary_access = body.has_complimentary_access

    if body.add_feature is not None:
        current = list(_parse_features(user.features))  # force new list so SQLAlchemy detects the change
        if body.add_feature not in current:
            current.append(body.add_feature)
        user.features = current
    if body.remove_feature is not None:
        user.features = [f for f in _parse_features(user.features) if f != body.remove_feature]

    await db.commit()
    await db.refresh(user)

    return await _user_summary(user, db)


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(
    user_id: UUID,
    admin: User = Depends(get_current_admin_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete a user and all their data. Admins cannot delete themselves."""
    if user_id == admin.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot delete your own account from the admin panel",
        )

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    await db.delete(user)
    await db.commit()


# ── Invitation endpoints ────────────────────────────────────────────────────────

@router.get("/invitations", response_model=list[InvitationSummary])
async def list_invitations(
    _admin: User = Depends(get_current_admin_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Invitation).order_by(Invitation.created_at.desc())
    )
    invitations = result.scalars().all()

    # Fetch inviter names in one query
    inviter_ids = {i.invited_by_id for i in invitations}
    inviters: dict[UUID, str] = {}
    if inviter_ids:
        inviters_result = await db.execute(select(User).where(User.id.in_(inviter_ids)))
        inviters = {u.id: u.name for u in inviters_result.scalars().all()}

    now = datetime.utcnow()
    return [
        InvitationSummary(
            id=inv.id,
            email=inv.email,
            invited_by=inviters.get(inv.invited_by_id, "Unknown"),
            created_at=inv.created_at.date().isoformat(),
            expires_at=inv.expires_at.date().isoformat(),
            accepted_at=inv.accepted_at.date().isoformat() if inv.accepted_at else None,
            is_expired=inv.accepted_at is None and inv.expires_at < now,
        )
        for inv in invitations
    ]


@router.post("/invitations", response_model=InvitationSummary, status_code=status.HTTP_201_CREATED)
async def create_invitation(
    body: InviteRequest,
    admin: User = Depends(get_current_admin_user),
    db: AsyncSession = Depends(get_db),
):
    """Create an invitation and send invite email. Raises 400 if email already invited/signed up."""
    settings = get_settings()

    # Check if user already exists
    existing_user = await db.execute(select(User).where(User.email == body.email))
    if existing_user.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A user with this email already exists. Grant access directly from the user table.",
        )

    # Check for existing pending invite
    now = datetime.utcnow()
    existing_invite = await db.execute(
        select(Invitation).where(
            Invitation.email == body.email,
            Invitation.accepted_at.is_(None),
            Invitation.expires_at > now,
        )
    )
    if existing_invite.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A pending invite already exists for this email.",
        )

    token = secrets.token_urlsafe(32)
    expires_at = now + timedelta(days=INVITE_EXPIRY_DAYS)

    invitation = Invitation(
        email=body.email,
        token=token,
        invited_by_id=admin.id,
        expires_at=expires_at,
    )
    db.add(invitation)
    await db.commit()
    await db.refresh(invitation)

    # Send invite email if SMTP is enabled
    if settings.smtp_enabled:
        invite_url = f"{settings.frontend_url}/invite?token={token}"
        body_text = (
            f"Hi,\n\n"
            f"You've been invited to join DealstackRE with complimentary access.\n\n"
            f"Click the link below to accept your invitation (expires in {INVITE_EXPIRY_DAYS} days):\n"
            f"{invite_url}\n\n"
            f"DealstackRE helps real estate professionals track and document their hours "
            f"for IRS Real Estate Professional Status (REPS) qualification.\n\n"
            f"— The DealstackRE Team"
        )
        try:
            sender = get_smtp_sender()
            await sender.send_plain(
                to_email=body.email,
                subject="You've been invited to DealstackRE",
                body=body_text,
            )
            logger.info("Invite email sent to %s", body.email)
        except Exception as exc:
            logger.error("Failed to send invite email to %s: %s", body.email, exc, exc_info=True)

    return InvitationSummary(
        id=invitation.id,
        email=invitation.email,
        invited_by=admin.name,
        created_at=invitation.created_at.date().isoformat(),
        expires_at=invitation.expires_at.date().isoformat(),
        accepted_at=None,
        is_expired=False,
    )


@router.delete("/invitations/{invitation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_invitation(
    invitation_id: UUID,
    _admin: User = Depends(get_current_admin_user),
    db: AsyncSession = Depends(get_db),
):
    """Revoke a pending invite."""
    result = await db.execute(select(Invitation).where(Invitation.id == invitation_id))
    invitation = result.scalar_one_or_none()
    if not invitation:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invitation not found")

    await db.delete(invitation)
    await db.commit()


# ── Access Request endpoints ───────────────────────────────────────────────────

class AccessRequestSummary(BaseModel):
    id: UUID
    email: str
    name: str
    picture_url: str | None
    status: str
    requested_at: str


@router.get("/access-requests", response_model=list[AccessRequestSummary])
async def list_access_requests(
    _admin: User = Depends(get_current_admin_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(AccessRequest).order_by(AccessRequest.requested_at.desc())
    )
    requests = result.scalars().all()
    return [
        AccessRequestSummary(
            id=r.id,
            email=r.email,
            name=r.name,
            picture_url=r.picture_url,
            status=r.status,
            requested_at=r.requested_at.date().isoformat(),
        )
        for r in requests
    ]


@router.post("/access-requests/{request_id}/approve", response_model=InvitationSummary)
async def approve_access_request(
    request_id: UUID,
    admin: User = Depends(get_current_admin_user),
    db: AsyncSession = Depends(get_db),
):
    """Approve a request — creates an invite for their email and sends the invite email."""
    result = await db.execute(select(AccessRequest).where(AccessRequest.id == request_id))
    req = result.scalar_one_or_none()
    if not req:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Request not found")

    settings = get_settings()
    now = datetime.utcnow()
    token = secrets.token_urlsafe(32)
    expires_at = now + timedelta(days=INVITE_EXPIRY_DAYS)

    invitation = Invitation(
        email=req.email,
        token=token,
        invited_by_id=admin.id,
        expires_at=expires_at,
    )
    db.add(invitation)

    req.status = "approved"
    req.reviewed_at = now
    await db.commit()
    await db.refresh(invitation)

    if settings.smtp_enabled:
        invite_url = f"{settings.frontend_url}/invite?token={token}"
        body_text = (
            f"Hi {req.name},\n\n"
            f"Your request to join DealstackRE has been approved!\n\n"
            f"Click the link below to accept your invitation (expires in {INVITE_EXPIRY_DAYS} days):\n"
            f"{invite_url}\n\n"
            f"— The DealstackRE Team"
        )
        try:
            sender = get_smtp_sender()
            await sender.send_plain(to_email=req.email, subject="You're in! Your DealstackRE invite", body=body_text)
            logger.info("Approval email sent to %s", req.email)
        except Exception as exc:
            logger.error("Failed to send approval email to %s: %s", req.email, exc, exc_info=True)

    return InvitationSummary(
        id=invitation.id,
        email=invitation.email,
        invited_by=admin.name,
        created_at=invitation.created_at.date().isoformat(),
        expires_at=invitation.expires_at.date().isoformat(),
        accepted_at=None,
        is_expired=False,
    )


@router.post("/access-requests/{request_id}/decline", status_code=status.HTTP_204_NO_CONTENT)
async def decline_access_request(
    request_id: UUID,
    _admin: User = Depends(get_current_admin_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(AccessRequest).where(AccessRequest.id == request_id))
    req = result.scalar_one_or_none()
    if not req:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Request not found")

    req.status = "declined"
    req.reviewed_at = datetime.utcnow()
    await db.commit()
