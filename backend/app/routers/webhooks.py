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
from app.services.r2 import get_r2_client

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
    On 'submission.completed': downloads signed PDF → stores in R2 → emails all parties.
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

    # Download signed PDF from DocuSeal
    try:
        client = get_docuseal_client()
        pdf_bytes = await client.download_document(submission_id)
    except DocuSealError as exc:
        logger.error("Failed to download signed PDF: %s", exc)
        raise HTTPException(status_code=502, detail="Failed to download signed PDF")

    # Store in R2
    r2_key = f"deals/{loi.deal_id}/loi-signed-{int(datetime.utcnow().timestamp())}.pdf"
    try:
        r2 = get_r2_client()
        r2.put_object(
            Bucket=settings.r2_bucket_name,
            Key=r2_key,
            Body=pdf_bytes,
            ContentType="application/pdf",
        )
    except Exception as exc:
        logger.error("Failed to store signed PDF in R2: %s", exc)
        raise HTTPException(status_code=500, detail="Failed to store signed PDF")

    # Update LOI status
    loi.status = "completed"
    loi.signed_pdf_r2_key = r2_key
    loi.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(loi)

    # Email signed PDF to all signers + deal owner
    if settings.smtp_enabled:
        property_address = loi.terms_data.get("purchase_price", "the property")
        subject = f"Signed LOI — {loi.terms_data.get('property_address', 'Deal')}"
        body_text = (
            f"Your Letter of Intent has been signed by all parties.\n\n"
            f"Please find the signed copy attached.\n\n"
            f"This document was signed via DocuSeal e-signature."
        )
        sender = get_smtp_sender()
        recipients = {s["email"] for s in loi.signers}
        for email_addr in recipients:
            try:
                await sender.send(
                    to_email=email_addr,
                    subject=subject,
                    body=body_text,
                    attachment_bytes=pdf_bytes,
                    attachment_filename="signed-loi.pdf",
                )
            except Exception as exc:
                logger.warning("Failed to email signed LOI to %s: %s", email_addr, exc)

    logger.info("LOI %s marked completed, PDF stored at %s", loi.id, r2_key)
    return {"status": "ok"}
