"""Market data endpoints — FRED-backed mortgage rate lookup."""

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from app.dependencies import get_current_user
from app.models import User
from app.services.fred import FredUnavailableError, get_mortgage_rate

router = APIRouter(prefix="/market", tags=["Market"])


class MortgageRateResponse(BaseModel):
    rate: float
    asOf: str
    series: str


@router.get("/mortgage-rate", response_model=MortgageRateResponse)
async def mortgage_rate(current_user: User = Depends(get_current_user)):
    """Latest 30-yr fixed mortgage rate from FRED (cached weekly)."""
    try:
        result = await get_mortgage_rate()
    except FredUnavailableError as e:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(e),
        ) from e
    return MortgageRateResponse(rate=result.rate, asOf=result.as_of, series=result.series)
