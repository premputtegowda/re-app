from datetime import datetime
from typing import Optional
from uuid import UUID
from pydantic import BaseModel, Field


class PropertyBase(BaseModel):
    name: str = Field(..., min_length=2, max_length=100)
    address: Optional[str] = Field(None, max_length=200)


class PropertyCreate(PropertyBase):
    pass


class PropertyUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=2, max_length=100)
    address: Optional[str] = Field(None, max_length=200)


class PropertyResponse(PropertyBase):
    id: UUID
    user_id: UUID
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True
