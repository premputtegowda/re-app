import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.database import engine
from app.routers import (
    auth_router,
    categories_router,
    properties_router,
    entries_router,
    analytics_router,
    email_router,
    attachments_router,
    attachments_download_router,
    admin_router,
    export_router,
    deals_router,
)
from app.services.scheduler import create_scheduler

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

settings = get_settings()

@asynccontextmanager
async def lifespan(app: FastAPI):
    scheduler = create_scheduler()
    if settings.smtp_enabled:
        scheduler.start()
        logger.info("APScheduler started")

    yield

    if scheduler.running:
        scheduler.shutdown(wait=False)
    try:
        await engine.dispose()
    except Exception:
        pass


app = FastAPI(
    title=settings.app_name,
    description="API for REPS Hours Tracker - Track Real Estate Professional Status hours",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_url],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(auth_router, prefix="/api")
app.include_router(categories_router, prefix="/api")
app.include_router(properties_router, prefix="/api")
app.include_router(entries_router, prefix="/api")
app.include_router(analytics_router, prefix="/api")
app.include_router(email_router, prefix="/api")
app.include_router(attachments_router, prefix="/api")
app.include_router(attachments_download_router, prefix="/api")
app.include_router(admin_router, prefix="/api")
app.include_router(export_router, prefix="/api")
app.include_router(deals_router, prefix="/api")


@app.get("/")
async def root():
    return {"message": "REPS Tracker API", "docs": "/docs"}


@app.get("/health")
async def health():
    return "OK"
