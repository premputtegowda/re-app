import uuid
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models import User
from app.models.saved_deal import SavedDeal

router = APIRouter(prefix="/shared", tags=["Shared"])


# ── Schemas ────────────────────────────────────────────────────────────────────

class SharedDealResponse(BaseModel):
    id: uuid.UUID
    name: str
    acquisition: dict[str, Any]
    operations: dict[str, Any]
    proForma: dict[str, Any]
    refinance: dict[str, Any]
    results: dict[str, Any]
    mcRanges: dict[str, Any] | None
    mcResults: Any | None
    currentStep: int | None
    calcState: dict[str, Any] | None
    savedAt: str
    updatedAt: str
    shareRole: str
    expiresAt: str

    class Config:
        from_attributes = True


class ForkResponse(BaseModel):
    id: uuid.UUID


# ── Helpers ────────────────────────────────────────────────────────────────────

async def _get_valid_deal(token: str, db: AsyncSession) -> SavedDeal:
    """Load a deal by share token, raising 404 or 410 as appropriate."""
    result = await db.execute(
        select(SavedDeal).where(SavedDeal.share_token == token)
    )
    deal = result.scalar_one_or_none()
    if not deal:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Link not found")
    if deal.share_expires_at is None or deal.share_expires_at < datetime.utcnow():
        raise HTTPException(status_code=status.HTTP_410_GONE, detail="This link has expired")
    return deal


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/{token}", response_model=SharedDealResponse)
async def get_shared_deal(
    token: str,
    db: AsyncSession = Depends(get_db),
):
    """Public endpoint — no auth required. Returns full deal data for a valid share token."""
    deal = await _get_valid_deal(token, db)
    return SharedDealResponse(
        id=deal.id,
        name=deal.name,
        acquisition=deal.acquisition_data,
        operations=deal.operations_data,
        proForma=deal.proforma_data,
        refinance=deal.refinance_data,
        results=deal.results_data,
        mcRanges=deal.mc_ranges_data,
        mcResults=deal.mc_results_data,
        currentStep=deal.current_step,
        calcState=deal.calc_state_data,
        savedAt=deal.saved_at.isoformat(),
        updatedAt=deal.updated_at.isoformat(),
        shareRole=deal.share_role or "partner",
        expiresAt=deal.share_expires_at.isoformat(),
    )


@router.post("/{token}/fork", response_model=ForkResponse, status_code=status.HTTP_201_CREATED)
async def fork_shared_deal(
    token: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Auth required. Creates a copy of the shared deal in the current user's account."""
    deal = await _get_valid_deal(token, db)

    now = datetime.utcnow()
    fork = SavedDeal(
        id=uuid.uuid4(),
        user_id=current_user.id,
        name=f"{deal.name} (copy)",
        acquisition_data=deal.acquisition_data,
        operations_data=deal.operations_data,
        proforma_data=deal.proforma_data,
        refinance_data=deal.refinance_data,
        results_data=deal.results_data,
        mc_ranges_data=deal.mc_ranges_data,
        mc_results_data=deal.mc_results_data,
        current_step=deal.current_step,
        calc_state_data=deal.calc_state_data,
        share_token=None,
        share_role=None,
        share_expires_at=None,
        saved_at=now,
        updated_at=now,
    )
    db.add(fork)
    await db.commit()
    await db.refresh(fork)
    return ForkResponse(id=fork.id)
