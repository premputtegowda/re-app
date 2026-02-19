"""
Tests for:
  - app.utils.csv_export (pure functions — no DB, no I/O)
  - app.services.scheduler.send_weekly_reports (mocked DB + sender)
  - POST /api/email/send-weekly-report (HTTP endpoint)
"""
from __future__ import annotations

import uuid
from datetime import date
from typing import AsyncGenerator
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from app.utils.csv_export import (
    CSV_HEADERS,
    EntryRow,
    generate_ytd_csv,
    get_ytd_filename,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_row(**kwargs) -> EntryRow:
    defaults = dict(
        date=date(2026, 1, 15),
        hours=2,
        minutes=30,
        total_minutes=150,
        category="Management",
        property="Main St",
        type="material",
        description="Routine inspection",
    )
    defaults.update(kwargs)
    return EntryRow(**defaults)


def _parse_csv(csv_bytes: bytes) -> list[list[str]]:
    import csv
    import io
    text = csv_bytes.decode("utf-8-sig")
    reader = csv.reader(io.StringIO(text))
    return list(reader)


# ---------------------------------------------------------------------------
# csv_export — pure unit tests
# ---------------------------------------------------------------------------

def test_generate_ytd_csv_headers():
    rows = _parse_csv(generate_ytd_csv([], year=2026))
    assert rows[0] == CSV_HEADERS


def test_generate_ytd_csv_single_row():
    row = _make_row()
    rows = _parse_csv(generate_ytd_csv([row], year=2026))
    assert len(rows) == 2
    data = rows[1]
    assert data[0] == "2026-01-15"
    assert data[1] == "2"
    assert data[2] == "30"
    assert data[3] == "150"
    assert data[4] == "Management"
    assert data[5] == "Main St"
    assert data[6] == "material"
    assert data[7] == "Routine inspection"


def test_generate_ytd_csv_empty():
    rows = _parse_csv(generate_ytd_csv([], year=2026))
    assert rows[0] == CSV_HEADERS
    assert len(rows) == 1


def test_generate_ytd_csv_sorted_rows():
    """Rows are written in the order they are provided."""
    row_a = _make_row(date=date(2026, 3, 1), description="A")
    row_b = _make_row(date=date(2026, 1, 1), description="B")
    rows = _parse_csv(generate_ytd_csv([row_a, row_b], year=2026))
    assert rows[1][7] == "A"
    assert rows[2][7] == "B"


def test_get_ytd_filename():
    assert get_ytd_filename(2026) == "reps_tracker_YTD_2026.csv"


def test_generate_ytd_csv_utf8_bom():
    csv_bytes = generate_ytd_csv([], year=2026)
    assert csv_bytes[:3] == b"\xef\xbb\xbf"


# ---------------------------------------------------------------------------
# scheduler — send_weekly_reports (mocked session + sender)
# ---------------------------------------------------------------------------

def _make_orm_entry(user_id, category_name="Work", property_name="Home"):
    entry = MagicMock()
    entry.user_id = user_id
    entry.date = date(2026, 1, 10)
    entry.hours = 1
    entry.minutes = 0
    entry.total_minutes = 60
    entry.category = MagicMock()
    entry.category.name = category_name
    entry.property = MagicMock()
    entry.property.name = property_name
    entry.type = MagicMock()
    entry.type.value = "material"
    entry.description = "Test"
    return entry


@pytest.mark.asyncio
async def test_send_weekly_reports_skips_user_with_no_entries():
    """Users with no YTD entries must be skipped and sender never called."""
    from app.services.scheduler import send_weekly_reports

    mock_sender = AsyncMock()
    user = MagicMock()
    user.id = uuid.uuid4()
    user.email = "user@example.com"
    user.name = "Test User"

    mock_session = AsyncMock()
    mock_session.__aenter__ = AsyncMock(return_value=mock_session)
    mock_session.__aexit__ = AsyncMock(return_value=False)

    users_result = MagicMock()
    users_result.scalars.return_value.all.return_value = [user]

    entries_result = MagicMock()
    entries_result.scalars.return_value.all.return_value = []

    mock_session.execute = AsyncMock(side_effect=[users_result, entries_result])

    with patch("app.services.scheduler.async_session_maker", return_value=mock_session):
        result = await send_weekly_reports(sender=mock_sender)

    mock_sender.send.assert_not_called()
    assert result["skipped"] == 1
    assert result["sent"] == 0
    assert result["failed"] == 0


@pytest.mark.asyncio
async def test_send_weekly_reports_sends_to_user_with_entries():
    """Users with entries receive exactly one email with the CSV attachment."""
    from app.services.scheduler import send_weekly_reports

    mock_sender = AsyncMock()
    user = MagicMock()
    user.id = uuid.uuid4()
    user.email = "user@example.com"
    user.name = "Test User"

    entry = _make_orm_entry(user.id)

    mock_session = AsyncMock()
    mock_session.__aenter__ = AsyncMock(return_value=mock_session)
    mock_session.__aexit__ = AsyncMock(return_value=False)

    users_result = MagicMock()
    users_result.scalars.return_value.all.return_value = [user]

    entries_result = MagicMock()
    entries_result.scalars.return_value.all.return_value = [entry]

    mock_session.execute = AsyncMock(side_effect=[users_result, entries_result])

    with patch("app.services.scheduler.async_session_maker", return_value=mock_session):
        result = await send_weekly_reports(sender=mock_sender)

    mock_sender.send.assert_awaited_once()
    call_kwargs = mock_sender.send.call_args.kwargs
    assert call_kwargs["to_email"] == "user@example.com"
    assert call_kwargs["attachment_filename"].startswith("reps_tracker_YTD_")
    assert result["sent"] == 1
    assert result["skipped"] == 0
    assert result["failed"] == 0


@pytest.mark.asyncio
async def test_send_weekly_reports_continues_after_failure():
    """An SMTP failure for one user increments failed and does not raise."""
    from app.services.scheduler import send_weekly_reports

    mock_sender = AsyncMock()
    mock_sender.send.side_effect = Exception("SMTP connection refused")

    user = MagicMock()
    user.id = uuid.uuid4()
    user.email = "user@example.com"
    user.name = "Test User"

    entry = _make_orm_entry(user.id)

    mock_session = AsyncMock()
    mock_session.__aenter__ = AsyncMock(return_value=mock_session)
    mock_session.__aexit__ = AsyncMock(return_value=False)

    users_result = MagicMock()
    users_result.scalars.return_value.all.return_value = [user]

    entries_result = MagicMock()
    entries_result.scalars.return_value.all.return_value = [entry]

    mock_session.execute = AsyncMock(side_effect=[users_result, entries_result])

    with patch("app.services.scheduler.async_session_maker", return_value=mock_session):
        result = await send_weekly_reports(sender=mock_sender)

    assert result["failed"] == 1
    assert result["sent"] == 0


# ---------------------------------------------------------------------------
# HTTP endpoint — /api/email/send-weekly-report
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_trigger_weekly_report_unauthenticated(async_client: AsyncClient):
    """No auth token → 403 (HTTPBearer raises 403 when no credentials)."""
    response = await async_client.post("/api/email/send-weekly-report")
    assert response.status_code in (401, 403)


@pytest.mark.asyncio
async def test_trigger_weekly_report_admin_only(
    async_client: AsyncClient, auth_headers: dict
):
    """Non-admin user → 403 Forbidden."""
    response = await async_client.post(
        "/api/email/send-weekly-report", headers=auth_headers
    )
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_trigger_weekly_report_smtp_disabled(
    async_client: AsyncClient, admin_auth_headers: dict
):
    """Admin user but SMTP disabled → 503."""
    with patch("app.routers.email.get_settings") as mock_settings:
        mock_settings.return_value.smtp_enabled = False
        response = await async_client.post(
            "/api/email/send-weekly-report", headers=admin_auth_headers
        )
    assert response.status_code == 503


@pytest.mark.asyncio
async def test_trigger_weekly_report_success(
    async_client: AsyncClient, admin_auth_headers: dict
):
    """Admin user + smtp_enabled=True → 200 with {sent, skipped, failed}."""
    mock_result = {"sent": 3, "skipped": 1, "failed": 0}

    with patch("app.routers.email.get_settings") as mock_settings, \
         patch("app.routers.email.send_weekly_reports", new_callable=AsyncMock) as mock_job:
        mock_settings.return_value.smtp_enabled = True
        mock_job.return_value = mock_result

        response = await async_client.post(
            "/api/email/send-weekly-report", headers=admin_auth_headers
        )

    assert response.status_code == 200
    body = response.json()
    assert body["sent"] == 3
    assert body["skipped"] == 1
    assert body["failed"] == 0
