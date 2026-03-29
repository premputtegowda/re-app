"""Pydantic schemas for the property tax estimation endpoint."""
from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel, Field


class PropertyTaxEstimateRequest(BaseModel):
    address: str = Field(..., min_length=5, description="Full property address")
    purchase_price: int = Field(..., gt=0, description="Purchase price in dollars")


class PropertyTaxEstimateResponse(BaseModel):
    jurisdiction_key: str
    net_estimated_annual_tax: float
    effective_tax_rate_percentage: float
    regime_type: str
    millage_confidence: Optional[str] = None  # "confirmed" | "estimated" | None for cached
    calculation_breakdown: List[str]
    investor_penalties_applied: List[str]
    next_refresh_date: str
    refresh_reason: str
    is_cached: bool  # True when jurisdiction rates came from the DB cache
    source: str      # Always "estimated" from this endpoint
