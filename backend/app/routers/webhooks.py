"""Inbound webhook handlers (DocuSeal, etc.)."""
from __future__ import annotations

import hashlib
import hmac
import logging
from datetime import datetime

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import get_db
from app.models.loi import LOI
from app.services.docuseal import get_docuseal_client, DocuSealError
from app.services.email import get_smtp_sender

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/webhooks", tags=["Webhooks"])


# ── DocuSeal ──────────────────────────────────────────────────────────────────

def _verify_docuseal_signature(body: bytes, signature: str | None, secret: str) -> bool:
    """HMAC-SHA256 verification of DocuSeal webhook payload."""
    if not secret:
        return True  # skip verification if no secret configured (dev mode)
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
      - Emails it to all notify_emails recipients configured by the user
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

    # Find matching LOI
    result = await db.execute(
        select(LOI).where(LOI.docuseal_submission_id == submission_id)
    )
    loi = result.scalar_one_or_none()
    if not loi:
        logger.warning("No LOI found for DocuSeal submission %s", submission_id)
        return {"status": "not_found"}

    if loi.status == "completed":
        return {"status": "already_processed"}

    # Mark completed first — email delivery is best-effort
    loi.status = "completed"
    loi.updated_at = datetime.utcnow()
    await db.commit()

    # Download signed PDF and email to notify_emails
    notify_emails: list[str] = loi.notify_emails or []
    if notify_emails and settings.smtp_enabled:
        try:
            client = get_docuseal_client()
            pdf_url = await client.get_document_url(submission_id)

            import httpx
            async with httpx.AsyncClient(timeout=30.0) as http:
                resp = await http.get(pdf_url)
                resp.raise_for_status()
                pdf_bytes = resp.content

            property_address = loi.terms_data.get("property_address", "the property")
            subject = f"Signed LOI - {property_address}"
            body_text = (
                "The Letter of Intent has been signed by all parties.\n\n"
                "Please find the signed copy attached.\n\n"
                "This document was signed via DocuSeal e-signature."
            )
            sender = get_smtp_sender()
            for email_addr in notify_emails:
                try:
                    await sender.send(
                        to_email=email_addr,
                        subject=subject,
                        body=body_text,
                        attachment_bytes=pdf_bytes,
                        attachment_filename="signed-loi.pdf",
                    )
                    logger.info("Signed LOI emailed to %s", email_addr)
                except Exception as exc:
                    logger.warning("Failed to email signed LOI to %s: %s", email_addr, exc)

        except (DocuSealError, Exception) as exc:
            logger.error("Failed to download/email signed PDF: %s", exc)
            # Status is already committed — don't fail the webhook response

    logger.info("LOI %s marked completed (submission %s)", loi.id, submission_id)
    return {"status": "ok"}
