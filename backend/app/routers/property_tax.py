"""Property tax estimation router."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.schemas.property_tax import PropertyTaxEstimateRequest, PropertyTaxEstimateResponse
from app.services.property_tax_service import PropertyTaxServiceError, get_property_tax_estimate

router = APIRouter(prefix="/property-tax", tags=["Property Tax"])


@router.post(
    "/estimate",
    response_model=PropertyTaxEstimateResponse,
    status_code=status.HTTP_200_OK,
)
async def estimate_tax(
    request: PropertyTaxEstimateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> PropertyTaxEstimateResponse:
    """
    Estimate the annual property tax for a real estate investment property.

    Pipeline:
      1. Resolve FIPS via US Census Geocoding API.
      2. Check jurisdiction cache in the database.
      3. On cache miss: search Serper → Gemini full-architect mode.
      4. On cache hit: Gemini math-only mode with cached rates.
    """
    try:
        result = await get_property_tax_estimate(
            address=request.address,
            purchase_price=request.purchase_price,
            db=db,
        )
        return PropertyTaxEstimateResponse(**result)
    except PropertyTaxServiceError as exc:
        if exc.code == "SERPER_UNAVAILABLE":
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Unable to retrieve tax info — please enter your own estimate",
            )
        if exc.code in ("GEMINI_PARSE_ERROR", "GEMINI_EMPTY_RESPONSE"):
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Tax estimation service returned an unexpected response — please enter your own estimate",
            )
        if exc.code in ("GEMINI_TIMEOUT", "GEMINI_HTTP_ERROR", "GEMINI_MODEL_UNAVAILABLE"):
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Tax estimation service is temporarily unavailable — please enter your own estimate",
            )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An unexpected error occurred during tax estimation",
        )
