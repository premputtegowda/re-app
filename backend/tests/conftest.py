import asyncio
import json
import sqlite3
import sys
from typing import AsyncGenerator, Generator
from unittest.mock import AsyncMock, MagicMock, patch
import uuid

# Register SQLite adapter for Python lists (used by ARRAY columns).
# Serializes list → JSON string on INSERT/UPDATE; SQLite stores as TEXT.
sqlite3.register_adapter(list, lambda v: json.dumps(v))

# ---------------------------------------------------------------------------
# Stub optional packages before any app module is imported.
# If the real packages are installed later, setdefault won't override them.
# ---------------------------------------------------------------------------
for _mod in (
    "apscheduler",
    "apscheduler.schedulers",
    "apscheduler.schedulers.asyncio",
    "aiosmtplib",
):
    sys.modules.setdefault(_mod, MagicMock())

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.pool import StaticPool

# ---------------------------------------------------------------------------
# Patch SQLite type compiler to handle PostgreSQL-specific column types.
# Models use postgresql.UUID and postgresql.ENUM which SQLite doesn't know.
# This is test-only infrastructure — production uses PostgreSQL natively.
# ---------------------------------------------------------------------------
from sqlalchemy.dialects.sqlite.base import SQLiteTypeCompiler as _STC
from sqlalchemy.dialects.postgresql import UUID as _PG_UUID, ENUM as _PG_ENUM


def _sqlite_visit_UUID(self, type_, **kw):  # noqa: N802
    return "VARCHAR(36)"


def _sqlite_visit_ENUM(self, type_, **kw):  # noqa: N802
    return "VARCHAR(50)"


def _sqlite_visit_ARRAY(self, type_, **kw):  # noqa: N802
    return "TEXT"


_STC.visit_UUID = _sqlite_visit_UUID  # type: ignore[attr-defined]
_STC.visit_ENUM = _sqlite_visit_ENUM  # type: ignore[attr-defined]
_STC.visit_ARRAY = _sqlite_visit_ARRAY  # type: ignore[attr-defined]

# Suppress CREATE TYPE / DROP TYPE DDL for PostgreSQL ENUM on non-PG dialects.
_pg_enum_create_orig = _PG_ENUM.create


def _pg_enum_create_safe(self, bind=None, checkfirst=True):
    dialect_name = getattr(getattr(bind, "dialect", None), "name", None)
    if dialect_name != "postgresql":
        return
    return _pg_enum_create_orig(self, bind=bind, checkfirst=checkfirst)


_PG_ENUM.create = _pg_enum_create_safe  # type: ignore[method-assign]

from app.database import Base, get_db
from app.main import app
from app.models import User, Category, Property, Entry
from app.utils.security import create_access_token


# Use in-memory SQLite for testing
TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"


@pytest.fixture(scope="session")
def event_loop() -> Generator[asyncio.AbstractEventLoop, None, None]:
    """Create an event loop for the test session."""
    loop = asyncio.get_event_loop_policy().new_event_loop()
    yield loop
    loop.close()


def _sqlite_to_char(date_val: str | None, fmt: str) -> str | None:
    """Emulate PostgreSQL to_char(date, 'YYYY-MM') for SQLite tests."""
    if date_val is None:
        return None
    from datetime import datetime as _dt
    try:
        d = _dt.strptime(str(date_val)[:10], "%Y-%m-%d")
    except ValueError:
        return str(date_val)
    pg_to_py = {"YYYY-MM": "%Y-%m", "YYYY": "%Y", "MM": "%m", "DD": "%d"}
    return d.strftime(pg_to_py.get(fmt, "%Y-%m-%d"))


@pytest_asyncio.fixture(scope="function")
async def test_engine():
    """Create a test database engine."""
    from sqlalchemy import event as _sa_event

    engine = create_async_engine(
        TEST_DATABASE_URL,
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )

    # Register PostgreSQL functions not natively available in SQLite.
    @_sa_event.listens_for(engine.sync_engine, "connect")
    def _register_sqlite_functions(dbapi_conn, _record):
        dbapi_conn.create_function("to_char", 2, _sqlite_to_char)

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield engine
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await engine.dispose()


@pytest_asyncio.fixture(scope="function")
async def test_db(test_engine) -> AsyncGenerator[AsyncSession, None]:
    """Create a test database session."""
    async_session = async_sessionmaker(
        test_engine, class_=AsyncSession, expire_on_commit=False
    )
    async with async_session() as session:
        yield session


@pytest_asyncio.fixture(scope="function")
async def async_client(test_db: AsyncSession) -> AsyncGenerator[AsyncClient, None]:
    """Create an async HTTP client for testing."""
    async def override_get_db():
        yield test_db

    app.dependency_overrides[get_db] = override_get_db

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        yield client

    app.dependency_overrides.clear()


@pytest_asyncio.fixture
async def test_user(test_db: AsyncSession) -> User:
    """Create a test user."""
    user = User(
        id=uuid.uuid4(),
        email="test@example.com",
        name="Test User",
        google_id="google_123456",
        picture_url="https://example.com/picture.jpg",
        is_admin=False,
    )
    test_db.add(user)
    await test_db.commit()
    await test_db.refresh(user)
    return user


@pytest_asyncio.fixture
async def admin_user(test_db: AsyncSession) -> User:
    """Create an admin test user."""
    user = User(
        id=uuid.uuid4(),
        email="admin@example.com",
        name="Admin User",
        google_id="google_admin_123",
        is_admin=True,
    )
    test_db.add(user)
    await test_db.commit()
    await test_db.refresh(user)
    return user


@pytest_asyncio.fixture
async def auth_headers(test_user: User) -> dict:
    """Create authentication headers for the test user."""
    access_token = create_access_token(user_id=str(test_user.id))
    return {"Authorization": f"Bearer {access_token}"}


@pytest_asyncio.fixture
async def admin_auth_headers(admin_user: User) -> dict:
    """Create authentication headers for the admin user."""
    access_token = create_access_token(user_id=str(admin_user.id))
    return {"Authorization": f"Bearer {access_token}"}


@pytest_asyncio.fixture
async def test_category(test_db: AsyncSession, test_user: User) -> Category:
    """Create a test category."""
    category = Category(
        id=uuid.uuid4(),
        user_id=test_user.id,
        name="Test Category",
        color="#3B82F6",
    )
    test_db.add(category)
    await test_db.commit()
    await test_db.refresh(category)
    return category


@pytest_asyncio.fixture
async def test_property(test_db: AsyncSession, test_user: User) -> Property:
    """Create a test property."""
    prop = Property(
        id=uuid.uuid4(),
        user_id=test_user.id,
        name="Test Property",
        address="123 Test Street",
    )
    test_db.add(prop)
    await test_db.commit()
    await test_db.refresh(prop)
    return prop


@pytest.fixture
def mock_google_verify():
    """Mock Google OAuth token verification."""
    with patch("app.routers.auth.verify_google_token") as mock:
        mock.return_value = {
            "email": "newuser@example.com",
            "name": "New User",
            "picture": "https://example.com/new_picture.jpg",
            "google_id": "google_new_123",
        }
        yield mock
