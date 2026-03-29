"""SQLAlchemy model for jurisdictional property tax reference data."""
from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import Date, DateTime, Float, JSON, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class JurisdictionTaxData(Base):
    """
    Cached property tax jurisdiction data keyed by FIPS + district code.

    This table stores purely jurisdictional reference data (rates, ratios, regime
    type) and contains no personally identifiable user information.  It is shared
    read/write across all users and is refreshed when next_refresh_date expires.
    """

    __tablename__ = "jurisdiction_tax_data"

    # Primary key: "{5-digit FIPS}-{3-digit district_code}", e.g. "39049-010"
    jurisdiction_key: Mapped[str] = mapped_column(String(16), primary_key=True)

    # Geographic identifiers
    fips: Mapped[str] = mapped_column(String(5), nullable=False, index=True)
    district_code: Mapped[str] = mapped_column(String(8), nullable=False)
    county_name: Mapped[str] = mapped_column(String(100), nullable=False)
    state: Mapped[str] = mapped_column(String(2), nullable=False)

    # Tax rate data
    assessment_ratio: Mapped[float] = mapped_column(Float, nullable=False)
    effective_millage: Mapped[float] = mapped_column(Float, nullable=False)
    regime_type: Mapped[str] = mapped_column(String(32), nullable=False)
    millage_confidence: Mapped[str | None] = mapped_column(String(16), nullable=True)

    # Cache governance
    next_refresh_date: Mapped[date] = mapped_column(Date, nullable=False)
    last_fetched_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=datetime.utcnow
    )

    # Full Gemini response stored for audit / debugging purposes
    raw_gemini_response: Mapped[dict | None] = mapped_column(JSON, nullable=True)
