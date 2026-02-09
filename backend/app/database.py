from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase

from app.config import get_settings

settings = get_settings()

# Determine connection args based on environment
connect_args = {}
if "localhost" not in settings.database_url:
    # For Supabase/production: use simple SSL require mode
    # Also disable prepared statement cache for pooler compatibility
    connect_args = {
        "ssl": "require",
        "prepared_statement_cache_size": 0,
    }

engine = create_async_engine(
    settings.database_url,
    echo=settings.debug,
    future=True,
    connect_args=connect_args,
)

async_session_maker = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncSession:
    async with async_session_maker() as session:
        try:
            yield session
        finally:
            await session.close()
