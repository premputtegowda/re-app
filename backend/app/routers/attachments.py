import io
import logging
import zipfile
from typing import List
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models import User, Entry
from app.models.attachment import Attachment
from app.schemas.attachment import AttachmentCreate, AttachmentResponse
from app.services.r2 import (
    generate_object_key,
    generate_upload_url,
    generate_download_url,
    delete_object,
    get_object_bytes,
)

logger = logging.getLogger(__name__)

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


# --- Presign ---

class PresignRequest(BaseModel):
    entry_id: str
    filename: str
    content_type: str


class PresignResponse(BaseModel):
    upload_url: str
    key: str


class DownloadUrlRequest(BaseModel):
    file_ref: str


class DownloadUrlResponse(BaseModel):
    url: str


@router.post("/download-url", response_model=DownloadUrlResponse, tags=["Attachments"])
async def get_download_url(
    data: DownloadUrlRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Generate a fresh pre-signed download URL for an R2 attachment."""
    # Verify the attachment belongs to this user
    result = await db.execute(
        select(Attachment).where(
            Attachment.file_ref == data.file_ref,
            Attachment.user_id == current_user.id,
        )
    )
    attachment = result.scalar_one_or_none()
    if not attachment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Attachment not found")

    url = generate_download_url(data.file_ref)
    return DownloadUrlResponse(url=url)


@router.post("/presign", response_model=PresignResponse, tags=["Attachments"])
async def presign_upload(
    data: PresignRequest,
    current_user: User = Depends(get_current_user),
):
    """Generate a pre-signed R2 upload URL for direct browser → R2 upload."""
    key = generate_object_key(str(current_user.id), data.entry_id, data.filename)
    upload_url = generate_upload_url(key, data.content_type)
    return PresignResponse(upload_url=upload_url, key=key)


# --- CRUD ---

@router.post("/{entry_id}/attachments", response_model=AttachmentResponse, status_code=status.HTTP_201_CREATED)
async def create_attachment(
    entry_id: UUID,
    data: AttachmentCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Store R2 file metadata after the frontend has uploaded the file."""
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
    """List all attachments for an entry with fresh pre-signed download URLs."""
    await _get_entry_for_user(entry_id, current_user.id, db)

    result = await db.execute(
        select(Attachment).where(Attachment.entry_id == entry_id)
    )
    attachments = result.scalars().all()

    # Refresh download URLs for R2-stored files (file_ref is an R2 key, not a Drive ID)
    for a in attachments:
        if a.file_ref and "/" in a.file_ref:  # R2 keys contain slashes; Drive IDs don't
            try:
                a.attachment_url = generate_download_url(a.file_ref)
            except Exception:
                pass  # Keep existing URL if refresh fails

    return attachments


@router.delete("/{entry_id}/attachments/{attachment_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_attachment(
    entry_id: UUID,
    attachment_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Remove attachment metadata and delete the file from R2."""
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

    # Delete from R2 if it's an R2-stored file
    if attachment.file_ref and "/" in attachment.file_ref:
        try:
            delete_object(attachment.file_ref)
        except Exception as e:
            logger.warning("Failed to delete R2 object %s: %s", attachment.file_ref, e)

    await db.delete(attachment)
    await db.commit()


# --- ZIP download ---

attachments_router = APIRouter(prefix="/attachments", tags=["Attachments"])


@attachments_router.get("/download-all")
async def download_all_attachments(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Stream all of the user's R2 attachments as a single ZIP file."""
    result = await db.execute(
        select(Attachment).where(
            Attachment.user_id == current_user.id,
        )
    )
    attachments = result.scalars().all()

    r2_attachments = [a for a in attachments if a.file_ref and "/" in a.file_ref]

    if not r2_attachments:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No attachments found")

    def generate_zip():
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
            for a in r2_attachments:
                try:
                    file_bytes = get_object_bytes(a.file_ref)
                    # Organise by date prefix from the entry if available
                    zf.writestr(a.original_filename or a.file_ref.split("/")[-1], file_bytes)
                except Exception as e:
                    logger.warning("Skipping attachment %s in ZIP: %s", a.id, e)
        buffer.seek(0)
        yield buffer.read()

    return StreamingResponse(
        generate_zip(),
        media_type="application/zip",
        headers={"Content-Disposition": "attachment; filename=dealstackre_attachments.zip"},
    )
