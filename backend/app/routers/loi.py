"""LOI endpoints — create, read, cancel, download."""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models import User
from app.models.loi import LOI
from app.models.saved_deal import SavedDeal
from app.services.docuseal import get_docuseal_client, DocuSealError
from app.services.loi_pdf import generate_loi_pdf
from app.services.r2 import generate_download_url, get_r2_client
from app.config import get_settings

router = APIRouter(prefix="/deals", tags=["LOI"])


# ── Schemas ────────────────────────────────────────────────────────────────────

class SignerIn(BaseModel):
    name: str
    email: EmailStr
    role: str = "Signer"


class LOITermsIn(BaseModel):
    purchase_price: float
    earnest_money: float
    close_date: str           # "2026-06-01"
    contingency_financing: bool = True
    contingency_inspection: bool = True
    contingency_appraisal: bool = False
    additional_terms: str = ""


class CreateLOIRequest(BaseModel):
    terms: LOITermsIn
    signers: list[SignerIn]


class SignerStatus(BaseModel):
    name: str
    email: str
    role: str
    signed: bool


class LOIResponse(BaseModel):
    id: str
    deal_id: str
    status: str
    terms: dict[str, Any]
    signers: list[dict[str, Any]]
    signed_pdf_url: str | None
    created_at: str
    updated_at: str

    class Config:
        from_attributes = True


# ── Helpers ────────────────────────────────────────────────────────────────────

async def _get_deal_or_404(deal_id: uuid.UUID, user_id: uuid.UUID, db: AsyncSession) -> SavedDeal:
    result = await db.execute(
        select(SavedDeal).where(SavedDeal.id == deal_id, SavedDeal.user_id == user_id)
    )
    deal = result.scalar_one_or_none()
    if not deal:
        raise HTTPException(status_code=404, detail="Deal not found")
    return deal


async def _get_loi_or_404(deal_id: uuid.UUID, user_id: uuid.UUID, db: AsyncSession) -> LOI:
    result = await db.execute(
        select(LOI).where(LOI.deal_id == deal_id, LOI.user_id == user_id)
    )
    loi = result.scalar_one_or_none()
    if not loi:
        raise HTTPException(status_code=404, detail="LOI not found for this deal")
    return loi


def _loi_to_response(loi: LOI) -> LOIResponse:
    signed_url = None
    if loi.signed_pdf_r2_key:
        try:
            signed_url = generate_download_url(loi.signed_pdf_r2_key)
        except Exception:
            pass

    return LOIResponse(
        id=str(loi.id),
        deal_id=str(loi.deal_id),
        status=loi.status,
        terms=loi.terms_data,
        signers=loi.signers,
        signed_pdf_url=signed_url,
        created_at=loi.created_at.isoformat(),
        updated_at=loi.updated_at.isoformat(),
    )


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/{deal_id}/loi", response_model=LOIResponse, status_code=status.HTTP_201_CREATED)
async def create_loi(
    deal_id: uuid.UUID,
    body: CreateLOIRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Generate LOI PDF, send to DocuSeal for e-signature, store record."""
    deal = await _get_deal_or_404(deal_id, current_user.id, db)

    # Only one LOI per deal — cancel existing if present
    existing_result = await db.execute(
        select(LOI).where(LOI.deal_id == deal_id)
    )
    existing = existing_result.scalar_one_or_none()
    if existing:
        # Void pending submission in DocuSeal before replacing
        if existing.docuseal_submission_id and existing.status == "pending":
            try:
                client = get_docuseal_client()
                await client.void_submission(existing.docuseal_submission_id)
            except Exception:
                pass
        await db.delete(existing)
        await db.flush()

    # Extract property address from deal data
    property_address = deal.acquisition_data.get("propertyAddress", "Property address not specified")
    buyer_name = current_user.name or current_user.email

    # Generate PDF
    signers_list = [s.model_dump() for s in body.signers]
    pdf_bytes = generate_loi_pdf(
        property_address=property_address,
        buyer_name=buyer_name,
        purchase_price=body.terms.purchase_price,
        earnest_money=body.terms.earnest_money,
        close_date=body.terms.close_date,
        contingency_financing=body.terms.contingency_financing,
        contingency_inspection=body.terms.contingency_inspection,
        contingency_appraisal=body.terms.contingency_appraisal,
        additional_terms=body.terms.additional_terms,
        signers=signers_list,
    )

    # Send to DocuSeal
    doc_name = f"LOI - {property_address}"[:100]
    try:
        docuseal_client = get_docuseal_client()
        submission = await docuseal_client.create_submission(
            pdf_bytes=pdf_bytes,
            document_name=doc_name,
            signers=signers_list,
        )
        submission_id = str(submission.get("id", ""))
    except DocuSealError as exc:
        raise HTTPException(status_code=502, detail=f"DocuSeal error: {exc}")

    # Persist LOI record
    loi = LOI(
        id=uuid.uuid4(),
        deal_id=deal_id,
        user_id=current_user.id,
        docuseal_submission_id=submission_id,
        terms_data=body.terms.model_dump(),
        signers=signers_list,
        status="pending",
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    db.add(loi)
    await db.commit()
    await db.refresh(loi)

    return _loi_to_response(loi)


@router.get("/{deal_id}/loi", response_model=LOIResponse)
async def get_loi(
    deal_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get current LOI status for a deal."""
    await _get_deal_or_404(deal_id, current_user.id, db)
    loi = await _get_loi_or_404(deal_id, current_user.id, db)

    # Sync status from DocuSeal if still pending
    if loi.status == "pending" and loi.docuseal_submission_id:
        try:
            client = get_docuseal_client()
            remote = await client.get_submission(loi.docuseal_submission_id)
            if remote.get("status") == "completed":
                loi.status = "completed"
                loi.updated_at = datetime.utcnow()
                await db.commit()
                await db.refresh(loi)
        except Exception:
            pass  # Status sync is best-effort; webhook is the authoritative path

    return _loi_to_response(loi)


@router.delete("/{deal_id}/loi", status_code=status.HTTP_204_NO_CONTENT)
async def cancel_loi(
    deal_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Cancel and delete an LOI (voids the DocuSeal submission if pending)."""
    await _get_deal_or_404(deal_id, current_user.id, db)
    loi = await _get_loi_or_404(deal_id, current_user.id, db)

    if loi.docuseal_submission_id and loi.status == "pending":
        try:
            client = get_docuseal_client()
            await client.void_submission(loi.docuseal_submission_id)
        except Exception:
            pass

    await db.delete(loi)
    await db.commit()


@router.get("/{deal_id}/loi/download")
async def download_loi(
    deal_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return a short-lived presigned R2 URL for the signed PDF."""
    await _get_deal_or_404(deal_id, current_user.id, db)
    loi = await _get_loi_or_404(deal_id, current_user.id, db)

    if loi.status != "completed" or not loi.signed_pdf_r2_key:
        raise HTTPException(status_code=404, detail="Signed PDF not available yet")

    url = generate_download_url(loi.signed_pdf_r2_key)
    return {"url": url}
