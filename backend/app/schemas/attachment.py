from datetime import datetime
from uuid import UUID
from pydantic import BaseModel


class AttachmentCreate(BaseModel):
    file_ref: str
    attachment_url: str
    original_filename: str
    content_type: str
    file_size: int


class AttachmentResponse(BaseModel):
    id: UUID
    entry_id: UUID
    file_ref: str
    attachment_url: str
    original_filename: str
    content_type: str
    file_size: int
    created_at: datetime

    class Config:
        from_attributes = True
