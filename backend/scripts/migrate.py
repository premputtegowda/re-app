"""
Pre-start migration script.

Run order in Railway start command:
  1. python scripts/migrate.py   ← creates tables on fresh DB, stamps alembic
  2. alembic upgrade head        ← applies any pending incremental migrations
  3. uvicorn app.main:app        ← starts the app

This ensures alembic always has tables to work with, whether the database
is brand new or has been running for months.
"""
import asyncio
import logging

from sqlalchemy import text

from app.database import engine, Base
from app.models import (  # noqa: F401 — import all models so Base.metadata is populated
    User, Category, Property, Entry, RefreshToken,
    Attachment, Invitation, AccessRequest,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


async def main() -> None:
    logger.info("Running pre-migration setup...")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        logger.info("Tables ensured via create_all.")
    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
