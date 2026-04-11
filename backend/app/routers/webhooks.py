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
    On 'submission.completed': marks the LOI as completed.
    DocuSeal automatically emails the signed PDF to all signers.
    The signed document remains accessible via DocuSeal's API.
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

    loi.status = "completed"
    loi.updated_at = datetime.utcnow()
    await db.commit()

    logger.info("LOI %s marked completed (submission %s)", loi.id, submission_id)
    return {"status": "ok"}
