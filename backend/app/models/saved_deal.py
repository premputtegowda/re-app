import uuid
from datetime import datetime
from typing import Optional
from sqlalchemy import String, Integer, DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy import JSON

from app.database import Base


class SavedDeal(Base):
    __tablename__ = "saved_deals"

    # Client-provided UUID so IDs are stable across devices
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)

    # Full deal data stored as JSON blobs — mirrors the TypeScript SavedDeal shape
    acquisition_data: Mapped[dict] = mapped_column(JSON, nullable=False)
    operations_data: Mapped[dict] = mapped_column(JSON, nullable=False)
    proforma_data: Mapped[dict] = mapped_column(JSON, nullable=False)
    refinance_data: Mapped[dict] = mapped_column(JSON, nullable=False)
    results_data: Mapped[dict] = mapped_column(JSON, nullable=False)
    mc_ranges_data: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    mc_results_data: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    current_step: Mapped[int | None] = mapped_column(Integer, nullable=True)
    calc_state_data: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    # Sharing
    share_token: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, unique=True, index=True)
    share_role: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)  # 'partner' | 'lender' | 'agent'
    share_expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    saved_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    # Relationships
    user = relationship("User", back_populates="saved_deals")
