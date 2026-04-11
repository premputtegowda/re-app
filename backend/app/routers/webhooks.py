"""Inbound webhook handlers (DocuSeal, etc.)."""
from __future__ import annotations

import hashlib
import hmac
import logging
from datetime import datetime

import httpx
from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import get_db
from app.models.loi import LOI
from app.models.user import User
from app.services.docuseal import get_docuseal_client, DocuSealError
from app.services.gmail_sender import GmailSender

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/webhooks", tags=["Webhooks"])


def _verify_docuseal_signature(body: bytes, signature: str | None, secret: str) -> bool:
    if not secret:
        return True
    if not signature:
        return False
    expected = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)


@router.post("/docuseal", status_code=status.HTTP_200_OK)
async def docuseal_webhook(
    request: Request,
    db: AsyncSession = Depends(get_db),
    x_docuseal_signature: str | None = Header(default=None),
):
    """
    Receives DocuSeal webhook events.
    On 'submission.completed':
      - Marks LOI as completed
      - Downloads signed PDF from DocuSeal
      - Emails it via the user's connected Gmail to all notify_emails recipients
    """
    settings = get_settings()
    body = await request.body()

    if not _verify_docuseal_signature(body, x_docuseal_signature, settings.docuseal_webhook_secret):
        raise HTTPException(status_code=401, detail="Invalid webhook signature")

    payload = await request.json()
    event = payload.get("event_type") or payload.get("event")
    logger.info("DocuSeal webhook event: %s", event)

    if event != "submission.completed":
        return {"status": "ignored"}

    data = payload.get("data", payload)
    submission_id = str(data.get("id", ""))
    if not submission_id:
        return {"status": "ignored"}

    result = await db.execute(
        select(LOI).where(LOI.docuseal_submission_id == submission_id)
    )
    loi = result.scalar_one_or_none()
    if not loi:
        logger.warning("No LOI found for DocuSeal submission %s", submission_id)
        return {"status": "not_found"}

    if loi.status == "completed":
        return {"status": "already_processed"}

    # Mark completed first — email is best-effort
    loi.status = "completed"
    loi.updated_at = datetime.utcnow()
    await db.commit()

    notify_emails: list[str] = loi.notify_emails or []
    if not notify_emails:
        return {"status": "ok"}

    # Load the deal owner's Gmail credentials
    user_result = await db.execute(select(User).where(User.id == loi.user_id))
    user = user_result.scalar_one_or_none()

    if not user or not user.gmail_refresh_token:
        logger.warning("LOI %s has notify_emails but user has no Gmail connected — skipping", loi.id)
        return {"status": "ok"}

    # Download signed PDF from DocuSeal
    try:
        client = get_docuseal_client()
        pdf_url = await client.get_document_url(submission_id)
        async with httpx.AsyncClient(timeout=30.0) as http:
            resp = await http.get(pdf_url)
            resp.raise_for_status()
            pdf_bytes = resp.content
    except Exception as exc:
        logger.error("Failed to download signed PDF for LOI %s: %s", loi.id, exc)
        return {"status": "ok"}

    property_address = loi.terms_data.get("property_address", "the property")
    subject = f"Signed LOI - {property_address}"
    body_text = (
        "The Letter of Intent has been signed by all parties.\n\n"
        "Please find the signed copy attached.\n\n"
        "This document was signed via DocuSeal e-signature."
    )

    sender = GmailSender(
        refresh_token=user.gmail_refresh_token,
        sender_email=user.gmail_sender_email or user.email,
    )
    for email_addr in notify_emails:
        try:
            await sender.send(
                to_email=email_addr,
                subject=subject,
                body=body_text,
                attachment_bytes=pdf_bytes,
                attachment_filename="signed-loi.pdf",
            )
            logger.info("Signed LOI emailed to %s via Gmail", email_addr)
        except Exception as exc:
            logger.warning("Failed to email signed LOI to %s: %s", email_addr, exc)

    return {"status": "ok"}
