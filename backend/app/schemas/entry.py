from datetime import datetime, date
from typing import Optional
from uuid import UUID
from enum import Enum
from pydantic import BaseModel, Field, field_validator, model_validator


class EntryType(str, Enum):
    MATERIAL = "material"
    NON_MATERIAL = "non-material"


class EntryBase(BaseModel):
    date: date
    hours: int = Field(..., ge=0, le=24)
    minutes: int = Field(..., ge=0, le=59)
    category_id: UUID
    property_id: UUID
    type: EntryType
    description: str = Field(..., min_length=1, max_length=500)

    @field_validator("date")
    @classmethod
    def validate_date_not_future(cls, v: date) -> date:
        if v > date.today():
            raise ValueError("Cannot log hours for future dates")
        return v

    @model_validator(mode="after")
    def validate_time_greater_than_zero(self):
        if self.hours == 0 and self.minutes == 0:
            raise ValueError("Time must be greater than 0")
        return self


class EntryCreate(EntryBase):
    pass


class EntryUpdate(BaseModel):
    date: Optional[date] = None
    hours: Optional[int] = Field(None, ge=0, le=24)
    minutes: Optional[int] = Field(None, ge=0, le=59)
    category_id: Optional[UUID] = None
    property_id: Optional[UUID] = None
    type: Optional[EntryType] = None
    description: Optional[str] = Field(None, min_length=1, max_length=500)

    @field_validator("date")
    @classmethod
    def validate_date_not_future(cls, v: Optional[date]) -> Optional[date]:
        if v is not None and v > date.today():
            raise ValueError("Cannot log hours for future dates")
        return v


class EntryResponse(BaseModel):
    id: UUID
    user_id: UUID
    date: date
    hours: int
    minutes: int
    total_minutes: int
    category_id: UUID
    property_id: UUID
    type: EntryType
    description: str
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class EntryFilter(BaseModel):
    date_from: Optional[date] = None
    date_to: Optional[date] = None
    category_id: Optional[UUID] = None
    property_id: Optional[UUID] = None
    type: Optional[EntryType] = None
    search: Optional[str] = None
    page: int = Field(1, ge=1)
    limit: int = Field(20, ge=1, le=100)
