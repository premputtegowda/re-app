"""Cache table for submarket-level AI grounding data (Census Tract / County keyed).

Stores expensive-to-fetch market data (Serper search results, insurance zone
factors, contract-services benchmarks, etc.) so repeated properties in the same
submarket don't trigger fresh AI + search calls. Property-specific data is
NEVER cached here — this is strictly market-level.
"""

from datetime import datetime

from sqlalchemy import JSON, DateTime, Index, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class SubmarketCache(Base):
    __tablename__ = "submarket_cache"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    # Submarket identifier — usually a Census Tract GEOID (11 chars) or County
    # FIPS (5 chars). Prefix distinguishes the geography scope.
    submarket_key: Mapped[str] = mapped_column(String(32), nullable=False)
    # Data category — e.g. "contract_services", "insurance_zone", "tax_millage",
    # "market_rent_2br", "utility_rates". One cache row per (key, category).
    data_category: Mapped[str] = mapped_column(String(64), nullable=False)
    payload: Mapped[dict] = mapped_column(JSON, nullable=False)
    fetched_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)

    __table_args__ = (
        UniqueConstraint("submarket_key", "data_category", name="uq_submarket_cache_key_category"),
        Index("ix_submarket_cache_expires_at", "expires_at"),
    )
