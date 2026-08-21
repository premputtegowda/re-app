from app.routers.auth import router as auth_router
from app.routers.categories import router as categories_router
from app.routers.properties import router as properties_router
from app.routers.entries import router as entries_router
from app.routers.analytics import router as analytics_router
from app.routers.email import router as email_router
from app.routers.attachments import router as attachments_router
from app.routers.attachments import attachments_router as attachments_download_router
from app.routers.admin import router as admin_router
from app.routers.export import router as export_router
from app.routers.deals import router as deals_router
from app.routers.feedback import router as feedback_router
from app.routers.shared import router as shared_router
from app.routers.market import router as market_router

__all__ = [
    "auth_router",
    "categories_router",
    "properties_router",
    "entries_router",
    "analytics_router",
    "email_router",
    "attachments_router",
    "attachments_download_router",
    "admin_router",
    "export_router",
    "deals_router",
    "feedback_router",
    "shared_router",
    "market_router",
]
