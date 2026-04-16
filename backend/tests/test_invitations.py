"""
Tests for the invite email flow and user acceptance:

  1. Admin creates invitation (POST /api/admin/invitations)
     - Creates DB record, returns summary
     - Sends email when SMTP enabled
     - Skips email when SMTP disabled
     - Rejects duplicate pending invite
     - Rejects invite for already-registered user

  2. User accepts invite via Google login (POST /api/auth/google/token)
     - New user with valid invite → created, has_complimentary_access=True, invite marked accepted
     - New user with no invite (invite_only=True) → 403 ACCESS_REQUEST_SUBMITTED
     - New user who already has a pending request → 403 ACCESS_REQUEST_PENDING
     - New user with expired invite → blocked, request created
     - Existing user logs in → always succeeds regardless of invite status

  3. apply_pending_invite (unit-level)
     - Valid unaccepted invite → grants access, sets accepted_at
     - No invite exists → no change
     - Expired invite → ignored
     - Already-accepted invite → ignored

  4. Admin lists and revokes invitations
"""
from __future__ import annotations

import secrets
import uuid
from datetime import datetime, timedelta
from unittest.mock import AsyncMock, patch, MagicMock

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.models import User, Invitation, AccessRequest


# ── Helpers ───────────────────────────────────────────────────────────────────

def _future(days: int = 7) -> datetime:
    return datetime.utcnow() + timedelta(days=days)


def _past(days: int = 1) -> datetime:
    return datetime.utcnow() - timedelta(days=days)


async def _create_invitation(
    db: AsyncSession,
    email: str,
    invited_by: User,
    *,
    expires_at: datetime | None = None,
    accepted_at: datetime | None = None,
    token: str | None = None,
) -> Invitation:
    inv = Invitation(
        email=email,
        token=token or secrets.token_urlsafe(32),
        invited_by_id=invited_by.id,
        expires_at=expires_at or _future(7),
        accepted_at=accepted_at,
    )
    db.add(inv)
    await db.commit()
    await db.refresh(inv)
    return inv


# ── 1. POST /api/admin/invitations ───────────────────────────────────────────

@pytest.mark.asyncio
async def test_create_invitation_returns_summary(
    async_client: AsyncClient,
    admin_auth_headers: dict,
):
    """Admin POSTs a new email → 200 with invitation summary fields."""
    resp = await async_client.post(
        "/api/admin/invitations",
        json={"email": "invite1@example.com"},
        headers=admin_auth_headers,
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["email"] == "invite1@example.com"
    assert data["accepted_at"] is None
    assert data["is_expired"] is False
    assert "expires_at" in data
    assert "id" in data


@pytest.mark.asyncio
async def test_create_invitation_persists_to_db(
    async_client: AsyncClient,
    admin_auth_headers: dict,
    test_db: AsyncSession,
):
    """Invitation record is created in the database with the correct email."""
    email = "persist@example.com"
    await async_client.post(
        "/api/admin/invitations",
        json={"email": email},
        headers=admin_auth_headers,
    )
    result = await test_db.execute(select(Invitation).where(Invitation.email == email))
    inv = result.scalar_one_or_none()
    assert inv is not None
    assert inv.accepted_at is None
    assert inv.expires_at > datetime.utcnow()


@pytest.mark.asyncio
async def test_create_invitation_sends_email_when_smtp_enabled(
    async_client: AsyncClient,
    admin_auth_headers: dict,
):
    """When smtp_enabled=True, the invite email is sent via the SMTP sender."""
    mock_sender = AsyncMock()

    with patch("app.routers.admin.get_settings") as mock_settings, \
         patch("app.routers.admin.get_smtp_sender", return_value=mock_sender):
        cfg = MagicMock()
        cfg.smtp_enabled = True
        cfg.frontend_url = "https://app.example.com"
        mock_settings.return_value = cfg

        resp = await async_client.post(
            "/api/admin/invitations",
            json={"email": "smtp@example.com"},
            headers=admin_auth_headers,
        )

    assert resp.status_code == 201
    mock_sender.send_plain.assert_awaited_once()
    call_kwargs = mock_sender.send_plain.call_args.kwargs
    assert call_kwargs["to_email"] == "smtp@example.com"
    assert "invite" in call_kwargs["subject"].lower() or "invited" in call_kwargs["subject"].lower()
    assert "https://app.example.com/invite?token=" in call_kwargs["body"]


@pytest.mark.asyncio
async def test_create_invitation_skips_email_when_smtp_disabled(
    async_client: AsyncClient,
    admin_auth_headers: dict,
):
    """When smtp_enabled=False, no email is sent but the invitation is still created."""
    mock_sender = AsyncMock()

    with patch("app.routers.admin.get_settings") as mock_settings, \
         patch("app.routers.admin.get_smtp_sender", return_value=mock_sender):
        cfg = MagicMock()
        cfg.smtp_enabled = False
        mock_settings.return_value = cfg

        resp = await async_client.post(
            "/api/admin/invitations",
            json={"email": "nosmtp@example.com"},
            headers=admin_auth_headers,
        )

    assert resp.status_code == 201
    mock_sender.send_plain.assert_not_awaited()


@pytest.mark.asyncio
async def test_create_invitation_rejects_duplicate_pending(
    async_client: AsyncClient,
    admin_auth_headers: dict,
    admin_user: User,
    test_db: AsyncSession,
):
    """Sending a second invite to the same email when one is still pending → 400."""
    email = "dupe@example.com"
    await _create_invitation(test_db, email, admin_user)

    resp = await async_client.post(
        "/api/admin/invitations",
        json={"email": email},
        headers=admin_auth_headers,
    )
    assert resp.status_code == 400
    assert "pending invite" in resp.json()["detail"].lower()


@pytest.mark.asyncio
async def test_create_invitation_rejects_existing_user(
    async_client: AsyncClient,
    admin_auth_headers: dict,
    test_user: User,
):
    """Inviting an email that already has a user account → 400."""
    resp = await async_client.post(
        "/api/admin/invitations",
        json={"email": test_user.email},
        headers=admin_auth_headers,
    )
    assert resp.status_code == 400
    assert "already exists" in resp.json()["detail"].lower()


@pytest.mark.asyncio
async def test_create_invitation_requires_admin(
    async_client: AsyncClient,
    auth_headers: dict,
):
    """Non-admin user attempting to invite → 403."""
    resp = await async_client.post(
        "/api/admin/invitations",
        json={"email": "blocked@example.com"},
        headers=auth_headers,
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_create_invitation_unauthenticated(async_client: AsyncClient):
    """No auth token → 401 or 403."""
    resp = await async_client.post(
        "/api/admin/invitations",
        json={"email": "anon@example.com"},
    )
    assert resp.status_code in (401, 403)


# ── 2. Invite email content ────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_invite_email_contains_token_url(
    async_client: AsyncClient,
    admin_auth_headers: dict,
    test_db: AsyncSession,
):
    """The email body contains the /invite?token= URL with the correct token."""
    captured_body: list[str] = []

    async def fake_send_plain(to_email, subject, body):
        captured_body.append(body)

    mock_sender = AsyncMock()
    mock_sender.send_plain.side_effect = fake_send_plain

    with patch("app.routers.admin.get_settings") as mock_settings, \
         patch("app.routers.admin.get_smtp_sender", return_value=mock_sender):
        cfg = MagicMock()
        cfg.smtp_enabled = True
        cfg.frontend_url = "https://app.example.com"
        mock_settings.return_value = cfg

        resp = await async_client.post(
            "/api/admin/invitations",
            json={"email": "content@example.com"},
            headers=admin_auth_headers,
        )

    assert resp.status_code == 201
    # Retrieve the token from DB and verify it appears in the email body
    result = await test_db.execute(
        select(Invitation).where(Invitation.email == "content@example.com")
    )
    inv = result.scalar_one()
    assert len(captured_body) == 1
    assert f"https://app.example.com/invite?token={inv.token}" in captured_body[0]


@pytest.mark.asyncio
async def test_invite_email_mentions_expiry(
    async_client: AsyncClient,
    admin_auth_headers: dict,
):
    """The email body mentions the expiry window (days)."""
    captured_body: list[str] = []

    async def fake_send_plain(to_email, subject, body):
        captured_body.append(body)

    mock_sender = AsyncMock()
    mock_sender.send_plain.side_effect = fake_send_plain

    with patch("app.routers.admin.get_settings") as mock_settings, \
         patch("app.routers.admin.get_smtp_sender", return_value=mock_sender):
        cfg = MagicMock()
        cfg.smtp_enabled = True
        cfg.frontend_url = "https://app.example.com"
        mock_settings.return_value = cfg

        await async_client.post(
            "/api/admin/invitations",
            json={"email": "expiry@example.com"},
            headers=admin_auth_headers,
        )

    assert any("day" in body.lower() for body in captured_body)


# ── 3. User accepts invite (POST /api/auth/google/token) ──────────────────────

@pytest.mark.asyncio
async def test_new_user_with_valid_invite_gets_complimentary_access(
    async_client: AsyncClient,
    admin_user: User,
    test_db: AsyncSession,
):
    """
    New user whose email has a valid pending invite → created with
    has_complimentary_access=True and invite.accepted_at is set.
    """
    email = "newuser@example.com"
    await _create_invitation(test_db, email, admin_user)

    with patch("app.routers.auth.verify_google_token") as mock_verify, \
         patch("app.routers.auth.settings") as mock_settings:
        mock_settings.invite_only = True
        mock_settings.access_token_expire_minutes = 30
        mock_verify.return_value = {
            "email": email,
            "name": "New User",
            "picture": "https://example.com/pic.jpg",
            "google_id": "google_new_abc",
        }

        resp = await async_client.post(
            "/api/auth/google/token",
            json={"credential": "fake-google-credential"},
        )

    assert resp.status_code == 200
    data = resp.json()
    assert data["user"]["email"] == email
    assert data["user"]["has_complimentary_access"] is True

    # Verify DB state
    user_result = await test_db.execute(select(User).where(User.email == email))
    user = user_result.scalar_one()
    assert user.has_complimentary_access is True

    # Verify invite is marked accepted
    await test_db.refresh(user)
    inv_result = await test_db.execute(
        select(Invitation).where(Invitation.email == email)
    )
    inv = inv_result.scalar_one()
    assert inv.accepted_at is not None


@pytest.mark.asyncio
async def test_new_user_without_invite_gets_403_and_creates_access_request(
    async_client: AsyncClient,
    test_db: AsyncSession,
):
    """
    New user with no pending invite in invite-only mode →
    403 ACCESS_REQUEST_SUBMITTED and an AccessRequest row created.
    """
    email = "uninvited@example.com"

    with patch("app.routers.auth.verify_google_token") as mock_verify, \
         patch("app.routers.auth.settings") as mock_settings:
        mock_settings.invite_only = True
        mock_verify.return_value = {
            "email": email,
            "name": "Uninvited User",
            "picture": None,
            "google_id": "google_uninvited_1",
        }

        resp = await async_client.post(
            "/api/auth/google/token",
            json={"credential": "fake-credential"},
        )

    assert resp.status_code == 403
    assert resp.json()["detail"] == "ACCESS_REQUEST_SUBMITTED"

    # Access request should now be in DB
    ar_result = await test_db.execute(
        select(AccessRequest).where(AccessRequest.email == email)
    )
    ar = ar_result.scalar_one_or_none()
    assert ar is not None
    assert ar.status == "pending"
    assert ar.name == "Uninvited User"


@pytest.mark.asyncio
async def test_new_user_already_pending_gets_403_pending(
    async_client: AsyncClient,
    test_db: AsyncSession,
):
    """
    New user who already submitted an access request →
    403 ACCESS_REQUEST_PENDING (not SUBMITTED again).
    """
    email = "alreadypending@example.com"
    # Pre-create the pending access request
    ar = AccessRequest(email=email, name="Pending Person", status="pending")
    test_db.add(ar)
    await test_db.commit()

    with patch("app.routers.auth.verify_google_token") as mock_verify, \
         patch("app.routers.auth.settings") as mock_settings:
        mock_settings.invite_only = True
        mock_verify.return_value = {
            "email": email,
            "name": "Pending Person",
            "picture": None,
            "google_id": "google_pending_2",
        }

        resp = await async_client.post(
            "/api/auth/google/token",
            json={"credential": "fake-credential"},
        )

    assert resp.status_code == 403
    assert resp.json()["detail"] == "ACCESS_REQUEST_PENDING"


@pytest.mark.asyncio
async def test_new_user_with_expired_invite_is_blocked(
    async_client: AsyncClient,
    admin_user: User,
    test_db: AsyncSession,
):
    """
    New user whose only invite is expired → treated as uninvited,
    access request is created.
    """
    email = "expired@example.com"
    await _create_invitation(test_db, email, admin_user, expires_at=_past(1))

    with patch("app.routers.auth.verify_google_token") as mock_verify, \
         patch("app.routers.auth.settings") as mock_settings:
        mock_settings.invite_only = True
        mock_verify.return_value = {
            "email": email,
            "name": "Expired User",
            "picture": None,
            "google_id": "google_expired_1",
        }

        resp = await async_client.post(
            "/api/auth/google/token",
            json={"credential": "fake-credential"},
        )

    assert resp.status_code == 403
    assert resp.json()["detail"] == "ACCESS_REQUEST_SUBMITTED"


@pytest.mark.asyncio
async def test_existing_user_logs_in_without_invite(
    async_client: AsyncClient,
    test_user: User,
):
    """
    An already-registered user can log in even in invite_only mode,
    regardless of invite status.
    """
    with patch("app.routers.auth.verify_google_token") as mock_verify, \
         patch("app.routers.auth.settings") as mock_settings:
        mock_settings.invite_only = True
        mock_settings.access_token_expire_minutes = 30
        mock_verify.return_value = {
            "email": test_user.email,
            "name": test_user.name,
            "picture": None,
            "google_id": test_user.google_id,
        }

        resp = await async_client.post(
            "/api/auth/google/token",
            json={"credential": "fake-credential"},
        )

    assert resp.status_code == 200
    assert resp.json()["user"]["email"] == test_user.email


@pytest.mark.asyncio
async def test_already_accepted_invite_not_applied_again(
    async_client: AsyncClient,
    admin_user: User,
    test_db: AsyncSession,
):
    """
    User with an already-accepted invite logs in again →
    apply_pending_invite finds no pending invite and makes no change.
    """
    email = "accepted@example.com"
    await _create_invitation(
        test_db, email, admin_user, accepted_at=datetime.utcnow() - timedelta(hours=1)
    )
    # Create user in DB directly (already accepted)
    user = User(
        email=email,
        name="Already Accepted",
        google_id="google_accepted_1",
        has_complimentary_access=True,
    )
    test_db.add(user)
    await test_db.commit()

    with patch("app.routers.auth.verify_google_token") as mock_verify, \
         patch("app.routers.auth.settings") as mock_settings:
        mock_settings.invite_only = False
        mock_settings.access_token_expire_minutes = 30
        mock_verify.return_value = {
            "email": email,
            "name": "Already Accepted",
            "picture": None,
            "google_id": "google_accepted_1",
        }

        resp = await async_client.post(
            "/api/auth/google/token",
            json={"credential": "fake-credential"},
        )

    assert resp.status_code == 200
    # Complimentary access should still be True (was set before)
    assert resp.json()["user"]["has_complimentary_access"] is True


# ── 4. apply_pending_invite — unit-level ──────────────────────────────────────

@pytest.mark.asyncio
async def test_apply_pending_invite_grants_access_and_marks_accepted(
    test_db: AsyncSession,
    admin_user: User,
):
    """Valid pending invite → user gets complimentary access and invite is stamped."""
    from app.routers.auth import apply_pending_invite

    email = "apply@example.com"
    inv = await _create_invitation(test_db, email, admin_user)

    user = User(
        email=email,
        name="Apply Test",
        google_id="google_apply_1",
        has_complimentary_access=False,
    )
    test_db.add(user)
    await test_db.commit()

    await apply_pending_invite(test_db, user)

    await test_db.refresh(user)
    await test_db.refresh(inv)
    assert user.has_complimentary_access is True
    assert inv.accepted_at is not None


@pytest.mark.asyncio
async def test_apply_pending_invite_no_invite_no_change(
    test_db: AsyncSession,
):
    """No invite for this email → user stays unchanged."""
    from app.routers.auth import apply_pending_invite

    user = User(
        email="noinvite@example.com",
        name="No Invite",
        google_id="google_noinvite_1",
        has_complimentary_access=False,
    )
    test_db.add(user)
    await test_db.commit()

    await apply_pending_invite(test_db, user)

    await test_db.refresh(user)
    assert user.has_complimentary_access is False


@pytest.mark.asyncio
async def test_apply_pending_invite_ignores_expired(
    test_db: AsyncSession,
    admin_user: User,
):
    """Expired invite → treated as no invite, user not granted access."""
    from app.routers.auth import apply_pending_invite

    email = "expiredapply@example.com"
    await _create_invitation(test_db, email, admin_user, expires_at=_past(1))

    user = User(
        email=email,
        name="Expired Apply",
        google_id="google_expired_apply",
        has_complimentary_access=False,
    )
    test_db.add(user)
    await test_db.commit()

    await apply_pending_invite(test_db, user)

    await test_db.refresh(user)
    assert user.has_complimentary_access is False


@pytest.mark.asyncio
async def test_apply_pending_invite_ignores_already_accepted(
    test_db: AsyncSession,
    admin_user: User,
):
    """Already-accepted invite → no change (accepted_at remains as-is)."""
    from app.routers.auth import apply_pending_invite

    email = "acceptedapply@example.com"
    accepted_ts = datetime.utcnow() - timedelta(hours=2)
    await _create_invitation(test_db, email, admin_user, accepted_at=accepted_ts)

    user = User(
        email=email,
        name="Accepted Apply",
        google_id="google_accepted_apply",
        has_complimentary_access=False,
    )
    test_db.add(user)
    await test_db.commit()

    await apply_pending_invite(test_db, user)

    await test_db.refresh(user)
    # No new invite found — user stays without access
    assert user.has_complimentary_access is False


# ── 5. List and revoke invitations ────────────────────────────────────────────

@pytest.mark.asyncio
async def test_list_invitations_returns_all(
    async_client: AsyncClient,
    admin_auth_headers: dict,
    admin_user: User,
    test_db: AsyncSession,
):
    """GET /api/admin/invitations returns all created invitations."""
    await _create_invitation(test_db, "list1@example.com", admin_user)
    await _create_invitation(test_db, "list2@example.com", admin_user)

    resp = await async_client.get("/api/admin/invitations", headers=admin_auth_headers)
    assert resp.status_code == 200
    emails = {item["email"] for item in resp.json()}
    assert "list1@example.com" in emails
    assert "list2@example.com" in emails


@pytest.mark.asyncio
async def test_list_invitations_shows_expired_status(
    async_client: AsyncClient,
    admin_auth_headers: dict,
    admin_user: User,
    test_db: AsyncSession,
):
    """An invite past its expiry is listed with is_expired=True."""
    await _create_invitation(
        test_db, "expiredlist@example.com", admin_user, expires_at=_past(1)
    )

    resp = await async_client.get("/api/admin/invitations", headers=admin_auth_headers)
    assert resp.status_code == 200
    expired_items = [i for i in resp.json() if i["email"] == "expiredlist@example.com"]
    assert len(expired_items) == 1
    assert expired_items[0]["is_expired"] is True


@pytest.mark.asyncio
async def test_list_invitations_shows_accepted_at(
    async_client: AsyncClient,
    admin_auth_headers: dict,
    admin_user: User,
    test_db: AsyncSession,
):
    """An accepted invite is listed with a non-null accepted_at."""
    accepted_ts = datetime.utcnow() - timedelta(hours=1)
    await _create_invitation(
        test_db, "acceptedlist@example.com", admin_user, accepted_at=accepted_ts
    )

    resp = await async_client.get("/api/admin/invitations", headers=admin_auth_headers)
    assert resp.status_code == 200
    items = [i for i in resp.json() if i["email"] == "acceptedlist@example.com"]
    assert len(items) == 1
    assert items[0]["accepted_at"] is not None


@pytest.mark.asyncio
async def test_revoke_invitation_deletes_record(
    async_client: AsyncClient,
    admin_auth_headers: dict,
    admin_user: User,
    test_db: AsyncSession,
):
    """DELETE /api/admin/invitations/{id} → 204 and record is gone from DB."""
    inv = await _create_invitation(test_db, "revoke@example.com", admin_user)

    resp = await async_client.delete(
        f"/api/admin/invitations/{inv.id}", headers=admin_auth_headers
    )
    assert resp.status_code == 204

    result = await test_db.execute(select(Invitation).where(Invitation.id == inv.id))
    assert result.scalar_one_or_none() is None


@pytest.mark.asyncio
async def test_revoke_nonexistent_invitation_returns_404(
    async_client: AsyncClient,
    admin_auth_headers: dict,
):
    """Revoking an invite that doesn't exist → 404."""
    fake_id = uuid.uuid4()
    resp = await async_client.delete(
        f"/api/admin/invitations/{fake_id}", headers=admin_auth_headers
    )
    assert resp.status_code == 404


# ── 6. Approve access request flow ───────────────────────────────────────────

@pytest.mark.asyncio
async def test_approve_access_request_creates_invitation(
    async_client: AsyncClient,
    admin_auth_headers: dict,
    test_db: AsyncSession,
):
    """Approving an access request creates an Invitation and marks request approved."""
    ar = AccessRequest(
        email="approve@example.com",
        name="Approvals User",
        status="pending",
    )
    test_db.add(ar)
    await test_db.commit()
    await test_db.refresh(ar)

    resp = await async_client.post(
        f"/api/admin/access-requests/{ar.id}/approve",
        headers=admin_auth_headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["email"] == "approve@example.com"

    # Access request is now approved
    await test_db.refresh(ar)
    assert ar.status == "approved"

    # Invitation was created
    inv_result = await test_db.execute(
        select(Invitation).where(Invitation.email == "approve@example.com")
    )
    inv = inv_result.scalar_one_or_none()
    assert inv is not None
    assert inv.accepted_at is None


@pytest.mark.asyncio
async def test_approve_access_request_sends_email_when_smtp_enabled(
    async_client: AsyncClient,
    admin_auth_headers: dict,
    test_db: AsyncSession,
):
    """Approving a request with smtp_enabled=True sends an invitation email."""
    ar = AccessRequest(
        email="approvemail@example.com",
        name="Mail Approvals",
        status="pending",
    )
    test_db.add(ar)
    await test_db.commit()
    await test_db.refresh(ar)

    mock_sender = AsyncMock()
    with patch("app.routers.admin.get_settings") as mock_settings, \
         patch("app.routers.admin.get_smtp_sender", return_value=mock_sender):
        cfg = MagicMock()
        cfg.smtp_enabled = True
        cfg.frontend_url = "https://app.example.com"
        mock_settings.return_value = cfg

        resp = await async_client.post(
            f"/api/admin/access-requests/{ar.id}/approve",
            headers=admin_auth_headers,
        )

    assert resp.status_code == 200
    mock_sender.send_plain.assert_awaited_once()
    call_kwargs = mock_sender.send_plain.call_args.kwargs
    assert call_kwargs["to_email"] == "approvemail@example.com"


# ── Deal Analyzer feature grant — verify NO email is sent (announcement removed) ──

@pytest.mark.asyncio
async def test_deal_analyzer_email_not_sent_when_smtp_disabled(
    async_client: AsyncClient,
    admin_auth_headers: dict,
    test_user: User,
):
    """No email is sent when SMTP is disabled, but feature is still granted."""
    mock_sender = AsyncMock()

    with patch("app.routers.admin.get_settings") as mock_settings, \
         patch("app.routers.admin.get_smtp_sender", return_value=mock_sender):
        cfg = MagicMock()
        cfg.smtp_enabled = False
        mock_settings.return_value = cfg

        resp = await async_client.patch(
            f"/api/admin/users/{test_user.id}",
            json={"add_feature": "deal_analyzer"},
            headers=admin_auth_headers,
        )

    assert resp.status_code == 200
    mock_sender.send_plain.assert_not_awaited()
    assert "deal_analyzer" in resp.json()["features"]


@pytest.mark.asyncio
async def test_deal_analyzer_email_not_sent_for_other_features(
    async_client: AsyncClient,
    admin_auth_headers: dict,
    test_user: User,
):
    """Announcement email is NOT sent when a different feature (e.g. reps) is toggled."""
    mock_sender = AsyncMock()

    with patch("app.routers.admin.get_settings") as mock_settings, \
         patch("app.routers.admin.get_smtp_sender", return_value=mock_sender):
        cfg = MagicMock()
        cfg.smtp_enabled = True
        cfg.frontend_url = "https://app.example.com"
        mock_settings.return_value = cfg

        resp = await async_client.patch(
            f"/api/admin/users/{test_user.id}",
            json={"add_feature": "reps"},
            headers=admin_auth_headers,
        )

    assert resp.status_code == 200
    mock_sender.send_plain.assert_not_awaited()


@pytest.mark.asyncio
async def test_deal_analyzer_email_not_sent_if_feature_already_present(
    async_client: AsyncClient,
    admin_auth_headers: dict,
    test_user: User,
    test_db: AsyncSession,
):
    """No duplicate email if deal_analyzer is already in the user's features list."""
    test_user.features = ["deal_analyzer"]
    await test_db.commit()

    mock_sender = AsyncMock()

    with patch("app.routers.admin.get_settings") as mock_settings, \
         patch("app.routers.admin.get_smtp_sender", return_value=mock_sender):
        cfg = MagicMock()
        cfg.smtp_enabled = True
        cfg.frontend_url = "https://app.example.com"
        mock_settings.return_value = cfg

        resp = await async_client.patch(
            f"/api/admin/users/{test_user.id}",
            json={"add_feature": "deal_analyzer"},
            headers=admin_auth_headers,
        )

    assert resp.status_code == 200
    mock_sender.send_plain.assert_not_awaited()


@pytest.mark.asyncio
async def test_deal_analyzer_smtp_failure_does_not_break_feature_grant(
    async_client: AsyncClient,
    admin_auth_headers: dict,
    test_user: User,
):
    """If SMTP throws, the feature is still saved and the endpoint returns 200."""
    mock_sender = AsyncMock()
    mock_sender.send_plain.side_effect = Exception("SMTP connection refused")

    with patch("app.routers.admin.get_settings") as mock_settings, \
         patch("app.routers.admin.get_smtp_sender", return_value=mock_sender):
        cfg = MagicMock()
        cfg.smtp_enabled = True
        cfg.frontend_url = "https://app.example.com"
        mock_settings.return_value = cfg

        resp = await async_client.patch(
            f"/api/admin/users/{test_user.id}",
            json={"add_feature": "deal_analyzer"},
            headers=admin_auth_headers,
        )

    assert resp.status_code == 200
    assert "deal_analyzer" in resp.json()["features"]
