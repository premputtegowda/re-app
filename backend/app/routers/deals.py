from datetime import datetime
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models import User
from app.models.saved_deal import SavedDeal

router = APIRouter(prefix="/deals", tags=["Deals"])


# ── Schemas ────────────────────────────────────────────────────────────────────

class DealPayload(BaseModel):
    """Full deal data sent from the client."""
    id: UUID
    name: str
    acquisition: dict[str, Any]
    operations: dict[str, Any]
    proForma: dict[str, Any]
    refinance: dict[str, Any]
    results: dict[str, Any]
    mcRanges: dict[str, Any] | None = None
    mcResults: Any | None = None
    currentStep: int | None = None
    savedAt: str
    updatedAt: str


class DealResponse(BaseModel):
    id: UUID
    name: str
    acquisition: dict[str, Any]
    operations: dict[str, Any]
    proForma: dict[str, Any]
    refinance: dict[str, Any]
    results: dict[str, Any]
    mcRanges: dict[str, Any] | None
    mcResults: Any | None
    currentStep: int | None
    savedAt: str
    updatedAt: str

    class Config:
        from_attributes = True


class DealUpdatePayload(BaseModel):
    name: str
    acquisition: dict[str, Any]
    operations: dict[str, Any]
    proForma: dict[str, Any]
    refinance: dict[str, Any]
    results: dict[str, Any]
    mcRanges: dict[str, Any] | None = None
    mcResults: Any | None = None
    currentStep: int | None = None
    updatedAt: str


# ── Helpers ────────────────────────────────────────────────────────────────────

def _to_response(deal: SavedDeal) -> DealResponse:
    return DealResponse(
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
        savedAt=deal.saved_at.isoformat(),
        updatedAt=deal.updated_at.isoformat(),
    )


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("", response_model=list[DealResponse])
async def list_deals(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return all saved deals for the authenticated user."""
    result = await db.execute(
        select(SavedDeal)
        .where(SavedDeal.user_id == current_user.id)
        .order_by(SavedDeal.updated_at.desc())
    )
    deals = result.scalars().all()
    return [_to_response(d) for d in deals]


@router.post("", response_model=DealResponse, status_code=status.HTTP_201_CREATED)
async def create_deal(
    payload: DealPayload,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a new saved deal. The client provides the UUID so it matches local state."""
    # Reject if ID already exists for this user
    existing = await db.execute(
        select(SavedDeal).where(
            SavedDeal.id == payload.id,
            SavedDeal.user_id == current_user.id,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A deal with this ID already exists.",
        )

    try:
        saved_at = datetime.fromisoformat(payload.savedAt.replace("Z", "+00:00")).replace(tzinfo=None)
        updated_at = datetime.fromisoformat(payload.updatedAt.replace("Z", "+00:00")).replace(tzinfo=None)
    except ValueError:
        saved_at = updated_at = datetime.utcnow()

    deal = SavedDeal(
        id=payload.id,
        user_id=current_user.id,
        name=payload.name,
        acquisition_data=payload.acquisition,
        operations_data=payload.operations,
        proforma_data=payload.proForma,
        refinance_data=payload.refinance,
        results_data=payload.results,
        mc_ranges_data=payload.mcRanges,
        mc_results_data=payload.mcResults,
        current_step=payload.currentStep,
        saved_at=saved_at,
        updated_at=updated_at,
    )
    db.add(deal)
    await db.commit()
    await db.refresh(deal)
    return _to_response(deal)


@router.put("/{deal_id}", response_model=DealResponse)
async def update_deal(
    deal_id: UUID,
    payload: DealUpdatePayload,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Full update of an existing deal."""
    result = await db.execute(
        select(SavedDeal).where(
            SavedDeal.id == deal_id,
            SavedDeal.user_id == current_user.id,
        )
    )
    deal = result.scalar_one_or_none()
    if not deal:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Deal not found")

    deal.name = payload.name
    deal.acquisition_data = payload.acquisition
    deal.operations_data = payload.operations
    deal.proforma_data = payload.proForma
    deal.refinance_data = payload.refinance
    deal.results_data = payload.results
    deal.mc_ranges_data = payload.mcRanges
    deal.mc_results_data = payload.mcResults
    deal.current_step = payload.currentStep
    deal.updated_at = datetime.utcnow()

    await db.commit()
    await db.refresh(deal)
    return _to_response(deal)


@router.delete("/{deal_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_deal(
    deal_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete a saved deal."""
    result = await db.execute(
        select(SavedDeal).where(
            SavedDeal.id == deal_id,
            SavedDeal.user_id == current_user.id,
        )
    )
    deal = result.scalar_one_or_none()
    if not deal:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Deal not found")

    await db.delete(deal)
    await db.commit()
