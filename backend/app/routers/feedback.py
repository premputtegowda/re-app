import uuid
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user, get_current_admin_user
from app.models import User
from app.models.feedback import Feedback

router = APIRouter(prefix="/feedback", tags=["Feedback"])


# ── Schemas ────────────────────────────────────────────────────────────────────

class FeedbackSubmit(BaseModel):
    module: str   # 'deal_analyzer' | 'reps'
    message: str

class FeedbackResponse(BaseModel):
    id: uuid.UUID
    user_name: str
    user_email: str
    module: str
    message: str
    status: str
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

class FeedbackStatusUpdate(BaseModel):
    status: str   # pending | resolved | dismissed | roadmap


# ── User: submit feedback ──────────────────────────────────────────────────────

@router.post("/", response_model=FeedbackResponse, status_code=status.HTTP_201_CREATED)
async def submit_feedback(
    payload: FeedbackSubmit,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not payload.message.strip():
        raise HTTPException(status_code=400, detail="Message cannot be empty")
    if payload.module not in ("deal_analyzer", "reps"):
        raise HTTPException(status_code=400, detail="Invalid module")

    item = Feedback(
        user_id=current_user.id,
        user_name=current_user.name,
        user_email=current_user.email,
        module=payload.module,
        message=payload.message.strip(),
        status="pending",
    )
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return item


# ── Admin: list all feedback ───────────────────────────────────────────────────

@router.get("/", response_model=list[FeedbackResponse])
async def list_feedback(
    _: User = Depends(get_current_admin_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Feedback).order_by(Feedback.created_at.desc()))
    return result.scalars().all()


# ── Admin: update status ───────────────────────────────────────────────────────

@router.patch("/{feedback_id}", response_model=FeedbackResponse)
async def update_feedback_status(
    feedback_id: uuid.UUID,
    payload: FeedbackStatusUpdate,
    _: User = Depends(get_current_admin_user),
    db: AsyncSession = Depends(get_db),
):
    if payload.status not in ("pending", "resolved", "dismissed", "roadmap"):
        raise HTTPException(status_code=400, detail="Invalid status")

    result = await db.execute(select(Feedback).where(Feedback.id == feedback_id))
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Feedback not found")

    item.status = payload.status
    item.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(item)
    return item
