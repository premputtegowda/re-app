from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from app.config import get_settings
from app.dependencies import get_current_admin_user
from app.models import User
from app.services.scheduler import send_weekly_reports

router = APIRouter(prefix="/email", tags=["Email"])


class WeeklyReportResponse(BaseModel):
    sent: int
    skipped: int
    failed: int


@router.post(
    "/send-weekly-report",
    response_model=WeeklyReportResponse,
    summary="Manually trigger the weekly YTD email report (admin only)",
)
async def trigger_weekly_report(
    current_admin: User = Depends(get_current_admin_user),
) -> WeeklyReportResponse:
    """
    Manually trigger the same weekly report job that APScheduler runs every Saturday.
    Requires admin JWT. Returns 503 if SMTP is disabled in settings.
    """
    settings = get_settings()
    if not settings.smtp_enabled:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="SMTP is disabled. Set SMTP_ENABLED=true to enable email delivery.",
        )

    result = await send_weekly_reports()
    return WeeklyReportResponse(**result)
