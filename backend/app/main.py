import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.database import engine, Base
from app.routers import (
    auth_router,
    categories_router,
    properties_router,
    entries_router,
    analytics_router,
    email_router,
)
from app.services.scheduler import create_scheduler

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

settings = get_settings()

# Track database connection status
db_connected = False
db_error = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global db_connected, db_error
    # Startup: Try to create tables if they don't exist
    # In production, use Alembic migrations instead
    try:
        logger.info("Attempting database connection...")
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        db_connected = True
        logger.info("Database connection successful!")
    except Exception as e:
        db_error = str(e)
        logger.error(f"Database connection failed: {e}")
        # Don't fail startup - let the app run for debugging

    scheduler = create_scheduler()
    if settings.smtp_enabled:
        scheduler.start()
        logger.info("APScheduler started")

    yield

    # Shutdown
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


@app.get("/")
async def root():
    return {"message": "REPS Tracker API", "docs": "/docs"}


@app.get("/health")
async def health():
    return "OK"
