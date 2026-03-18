from typing import List
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models import User, Entry
from app.models.attachment import Attachment
from app.schemas.attachment import AttachmentCreate, AttachmentResponse

router = APIRouter(prefix="/entries", tags=["Attachments"])


async def _get_entry_for_user(
    entry_id: UUID, user_id: UUID, db: AsyncSession
) -> Entry:
    result = await db.execute(
        select(Entry).where(Entry.id == entry_id, Entry.user_id == user_id)
    )
    entry = result.scalar_one_or_none()
    if not entry:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Entry not found")
    return entry


@router.post("/{entry_id}/attachments", response_model=AttachmentResponse, status_code=status.HTTP_201_CREATED)
async def create_attachment(
    entry_id: UUID,
    data: AttachmentCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Store Google Drive file metadata after the frontend has uploaded the file."""
    await _get_entry_for_user(entry_id, current_user.id, db)

    attachment = Attachment(
        entry_id=entry_id,
        user_id=current_user.id,
        file_ref=data.file_ref,
        attachment_url=data.attachment_url,
        original_filename=data.original_filename,
        content_type=data.content_type,
        file_size=data.file_size,
    )
    db.add(attachment)
    await db.commit()
    await db.refresh(attachment)
    return attachment


@router.get("/{entry_id}/attachments", response_model=List[AttachmentResponse])
async def list_attachments(
    entry_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List all attachments for an entry."""
    await _get_entry_for_user(entry_id, current_user.id, db)

    result = await db.execute(
        select(Attachment).where(Attachment.entry_id == entry_id)
    )
    return result.scalars().all()


@router.delete("/{entry_id}/attachments/{attachment_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_attachment(
    entry_id: UUID,
    attachment_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Remove attachment metadata. The caller is responsible for deleting from Google Drive."""
    result = await db.execute(
        select(Attachment).where(
            Attachment.id == attachment_id,
            Attachment.entry_id == entry_id,
            Attachment.user_id == current_user.id,
        )
    )
    attachment = result.scalar_one_or_none()
    if not attachment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Attachment not found")

    await db.delete(attachment)
    await db.commit()
