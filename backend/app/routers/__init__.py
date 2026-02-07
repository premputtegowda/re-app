from app.routers.auth import router as auth_router
from app.routers.categories import router as categories_router
from app.routers.properties import router as properties_router
from app.routers.entries import router as entries_router
from app.routers.analytics import router as analytics_router

__all__ = [
    "auth_router",
    "categories_router",
    "properties_router",
    "entries_router",
    "analytics_router",
]
