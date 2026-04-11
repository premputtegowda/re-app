import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import String, DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy import JSON

from app.database import Base


class LOI(Base):
    __tablename__ = "lois"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    deal_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("saved_deals.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
        unique=True,  # one active LOI per deal
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # DocuSeal reference
    docuseal_submission_id: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)

    # LOI content — purchase_price, earnest_money, close_date, contingencies, additional_terms
    terms_data: Mapped[dict] = mapped_column(JSON, nullable=False)

    # [{name, email, role, order}]
    signers: Mapped[list] = mapped_column(JSON, nullable=False)

    # 'pending' | 'completed' | 'expired'
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="pending")

    # R2 key for the signed PDF once completed
    signed_pdf_r2_key: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    # Relationships
    deal = relationship("SavedDeal", back_populates="loi")
    user = relationship("User")
