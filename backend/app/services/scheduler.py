from __future__ import annotations

import logging
from datetime import date
from typing import Optional

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.database import async_session_maker
from app.models import User, Entry
from app.services.email import EmailSender, get_smtp_sender
from app.utils.csv_export import EntryRow, entry_to_row, generate_audit_csv, get_audit_csv_filename

logger = logging.getLogger(__name__)


async def send_weekly_reports(sender: Optional[EmailSender] = None) -> dict:
    """
    Core job: query all users and send each a YTD CSV email.

    Opens its own DB session (not request-scoped). Skips users with 0 entries.
    Logs and continues on per-user failures.

    Returns:
        {"sent": N, "skipped": N, "failed": N}
    """
    if sender is None:
        sender = get_smtp_sender()

    today = date.today()
    year = today.year
    year_start = date(year, 1, 1)

    sent = 0
    skipped = 0
    failed = 0

    async with async_session_maker() as db:
        result = await db.execute(select(User))
        users = result.scalars().all()

        for user in users:
            try:
                entries_result = await db.execute(
                    select(Entry)
                    .options(
                        selectinload(Entry.category),
                        selectinload(Entry.property),
                        selectinload(Entry.attachments),
                    )
                    .where(
                        Entry.user_id == user.id,
                        Entry.date >= year_start,
                        Entry.date <= today,
                    )
                    .order_by(Entry.date.asc())
                )
                entries = entries_result.scalars().all()

                if not entries:
                    logger.info("Skipping user %s — no YTD entries.", user.email)
                    skipped += 1
                    continue

                rows: list[EntryRow] = [entry_to_row(e, idx + 1) for idx, e in enumerate(entries)]
                csv_bytes = generate_audit_csv(rows, year)
                filename = get_audit_csv_filename(year)

                subject = f"Your REPS Audit Log — {today.strftime('%B %d, %Y')}"
                body = (
                    f"Hi {user.name},\n\n"
                    f"Attached is your REPS Audit Log for {year} "
                    f"({year_start.strftime('%b %d')} – {today.strftime('%b %d, %Y')}).\n\n"
                    f"The CSV contains your full activity log ({len(rows)} entries) "
                    "including attachment Drive links.\n\n"
                    "Keep up the great work!\n\n"
                    "— DealstackRE"
                )

                await sender.send(
                    to_email=user.email,
                    subject=subject,
                    body=body,
                    attachment_bytes=csv_bytes,
                    attachment_filename=filename,
                )
                logger.info("Sent YTD report to %s (%d entries).", user.email, len(entries))
                sent += 1

            except Exception as exc:
                logger.error("Failed to send report to %s: %s", user.email, exc)
                failed += 1

    logger.info("Weekly report job complete — sent=%d skipped=%d failed=%d", sent, skipped, failed)
    return {"sent": sent, "skipped": skipped, "failed": failed}


def create_scheduler() -> AsyncIOScheduler:
    """
    Create and configure the APScheduler instance.

    Schedule: every Saturday at midnight (server local time).

    To switch from in-memory to persistent job storage in future, replace
    MemoryJobStore (default) with SQLAlchemyJobStore — a 2-line change:
        from apscheduler.jobstores.sqlalchemy import SQLAlchemyJobStore
        jobstores = {"default": SQLAlchemyJobStore(url=settings.database_url)}
    """
    scheduler = AsyncIOScheduler()
    scheduler.add_job(
        send_weekly_reports,
        trigger="cron",
        day_of_week="sat",
        hour=0,
        minute=0,
        replace_existing=True,
        misfire_grace_time=3600,
        id="weekly_email_report",
    )
    return scheduler
