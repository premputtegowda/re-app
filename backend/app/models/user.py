import uuid
from datetime import datetime
from typing import Optional, List
from sqlalchemy import String, Boolean, DateTime
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID, ARRAY

from app.database import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    picture_url: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    google_id: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False)
    has_complimentary_access: Mapped[bool] = mapped_column(Boolean, default=False)
    features: Mapped[List[str]] = mapped_column(ARRAY(String), nullable=False, default=lambda: ['reps'])
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    # Gmail OAuth — set when user connects their Gmail for sending LOI emails
    gmail_refresh_token: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    gmail_sender_email: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)

    # Relationships
    categories = relationship("Category", back_populates="user", cascade="all, delete-orphan")
    properties = relationship("Property", back_populates="user", cascade="all, delete-orphan")
    entries = relationship("Entry", back_populates="user", cascade="all, delete-orphan")
    refresh_tokens = relationship("RefreshToken", back_populates="user", cascade="all, delete-orphan")
    saved_deals = relationship("SavedDeal", back_populates="user", cascade="all, delete-orphan")
