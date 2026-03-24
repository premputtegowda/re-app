import uuid
from datetime import datetime, date
from enum import Enum
from sqlalchemy import String, Integer, Date, DateTime, ForeignKey, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID, ENUM

from app.database import Base


class EntryType(str, Enum):
    MATERIAL = "material"
    NON_MATERIAL = "non-material"


class Entry(Base):
    __tablename__ = "entries"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    category_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("categories.id", ondelete="RESTRICT"), nullable=False
    )
    property_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("properties.id", ondelete="RESTRICT"), nullable=False
    )
    date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    hours: Mapped[int] = mapped_column(Integer, nullable=False)
    minutes: Mapped[int] = mapped_column(Integer, nullable=False)
    total_minutes: Mapped[int] = mapped_column(Integer, nullable=False)
    type: Mapped[EntryType] = mapped_column(
        ENUM(EntryType, name="entry_type", create_type=True), nullable=False
    )
    description: Mapped[str] = mapped_column(Text, nullable=False)
    raw_description: Mapped[str | None] = mapped_column(Text, nullable=True, default=None)
    refined_description: Mapped[str | None] = mapped_column(Text, nullable=True, default=None)
    ai_category_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("categories.id", ondelete="SET NULL"), nullable=True, default=None
    )
    ai_type: Mapped[str | None] = mapped_column(String, nullable=True, default=None)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True, default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    # Relationships
    user = relationship("User", back_populates="entries")
    category = relationship("Category", back_populates="entries", foreign_keys=[category_id])
    property = relationship("Property", back_populates="entries")
    attachments = relationship("Attachment", back_populates="entry", cascade="all, delete-orphan")
