"""Read/write helpers for submarket_cache — Serper results keyed by geography."""

from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.submarket_cache import SubmarketCache


async def get_cached(
    db: AsyncSession, submarket_key: str, data_category: str
) -> Optional[dict]:
    """Return cached payload for (key, category) if present and unexpired."""
    result = await db.execute(
        select(SubmarketCache).where(
            SubmarketCache.submarket_key == submarket_key,
            SubmarketCache.data_category == data_category,
        )
    )
    row = result.scalar_one_or_none()
    if not row:
        return None
    if row.expires_at < datetime.utcnow():
        return None
    return row.payload


async def upsert_cache(
    db: AsyncSession,
    submarket_key: str,
    data_category: str,
    payload: dict,
    ttl_days: int,
) -> None:
    """Insert or update the cache entry. Uses Postgres ON CONFLICT for atomicity."""
    now = datetime.utcnow()
    expires_at = now + timedelta(days=ttl_days)
    stmt = pg_insert(SubmarketCache).values(
        submarket_key=submarket_key,
        data_category=data_category,
        payload=payload,
        fetched_at=now,
        expires_at=expires_at,
    )
    stmt = stmt.on_conflict_do_update(
        constraint="uq_submarket_cache_key_category",
        set_={
            "payload": stmt.excluded.payload,
            "fetched_at": stmt.excluded.fetched_at,
            "expires_at": stmt.excluded.expires_at,
        },
    )
    await db.execute(stmt)
    await db.commit()
