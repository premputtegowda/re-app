from datetime import datetime
from typing import Optional, List
from uuid import UUID
from pydantic import BaseModel, EmailStr


class UserCreate(BaseModel):
    email: EmailStr
    name: str
    picture_url: Optional[str] = None
    google_id: str


class UserUpdate(BaseModel):
    name: Optional[str] = None
    picture_url: Optional[str] = None


class UserResponse(BaseModel):
    id: UUID
    email: str
    name: str
    picture_url: Optional[str]
    is_admin: bool
    has_complimentary_access: bool
    features: List[str]
    gmail_connected: bool = False
    gmail_sender_email: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

    @classmethod
    def model_validate(cls, obj, **kwargs):
        data = super().model_validate(obj, **kwargs)
        data.gmail_connected = bool(getattr(obj, "gmail_refresh_token", None))
        return data
