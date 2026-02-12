from datetime import date, timedelta
from typing import List
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, func, extract
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel

from app.database import get_db
from app.dependencies import get_current_user
from app.models import User, Entry, Category, Property
from app.models.entry import EntryType

router = APIRouter(prefix="/analytics", tags=["Analytics"])


class SummaryResponse(BaseModel):
    total_minutes: int
    total_hours: float
    entries_count: int
    week_minutes: int
    week_hours: float
    month_minutes: int
    month_hours: float
    material_minutes: int
    material_hours: float
    non_material_minutes: int
    non_material_hours: float


class CategorySummary(BaseModel):
    category_id: UUID
    category_name: str
    color: str
    total_minutes: int
    total_hours: float
    entries_count: int


class PropertySummary(BaseModel):
    property_id: UUID
    property_name: str
    total_minutes: int
    total_hours: float
    entries_count: int


class MonthlyData(BaseModel):
    month: str  # YYYY-MM
    total_minutes: int
    total_hours: float
    entries_count: int


@router.get("/summary", response_model=SummaryResponse)
async def get_summary(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get overall summary statistics."""
    today = date.today()
    week_start = today - timedelta(days=today.weekday())
    month_start = today.replace(day=1)

    # Total stats
    result = await db.execute(
        select(
            func.coalesce(func.sum(Entry.total_minutes), 0).label("total_minutes"),
            func.count(Entry.id).label("entries_count"),
        ).where(Entry.user_id == current_user.id)
    )
    row = result.one()
    total_minutes = row.total_minutes
    entries_count = row.entries_count

    # Week stats
    result = await db.execute(
        select(func.coalesce(func.sum(Entry.total_minutes), 0)).where(
            Entry.user_id == current_user.id,
            Entry.date >= week_start,
        )
    )
    week_minutes = result.scalar()

    # Month stats
    result = await db.execute(
        select(func.coalesce(func.sum(Entry.total_minutes), 0)).where(
            Entry.user_id == current_user.id,
            Entry.date >= month_start,
        )
    )
    month_minutes = result.scalar()

    # Material vs Non-Material
    result = await db.execute(
        select(func.coalesce(func.sum(Entry.total_minutes), 0)).where(
            Entry.user_id == current_user.id,
            Entry.type == EntryType.MATERIAL,
        )
    )
    material_minutes = result.scalar()

    result = await db.execute(
        select(func.coalesce(func.sum(Entry.total_minutes), 0)).where(
            Entry.user_id == current_user.id,
            Entry.type == EntryType.NON_MATERIAL,
        )
    )
    non_material_minutes = result.scalar()

    return SummaryResponse(
        total_minutes=total_minutes,
        total_hours=round(total_minutes / 60, 2),
        entries_count=entries_count,
        week_minutes=week_minutes,
        week_hours=round(week_minutes / 60, 2),
        month_minutes=month_minutes,
        month_hours=round(month_minutes / 60, 2),
        material_minutes=material_minutes,
        material_hours=round(material_minutes / 60, 2),
        non_material_minutes=non_material_minutes,
        non_material_hours=round(non_material_minutes / 60, 2),
    )


@router.get("/by-category", response_model=List[CategorySummary])
async def get_by_category(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    limit: int = Query(10, ge=1, le=50),
):
    """Get hours grouped by category."""
    result = await db.execute(
        select(
            Category.id.label("category_id"),
            Category.name.label("category_name"),
            Category.color,
            func.coalesce(func.sum(Entry.total_minutes), 0).label("total_minutes"),
            func.count(Entry.id).label("entries_count"),
        )
        .join(Entry, Entry.category_id == Category.id)
        .where(Category.user_id == current_user.id)
        .group_by(Category.id, Category.name, Category.color)
        .order_by(func.sum(Entry.total_minutes).desc())
        .limit(limit)
    )

    return [
        CategorySummary(
            category_id=row.category_id,
            category_name=row.category_name,
            color=row.color,
            total_minutes=row.total_minutes,
            total_hours=round(row.total_minutes / 60, 2),
            entries_count=row.entries_count,
        )
        for row in result
    ]


@router.get("/by-property", response_model=List[PropertySummary])
async def get_by_property(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    limit: int = Query(10, ge=1, le=50),
):
    """Get hours grouped by property."""
    result = await db.execute(
        select(
            Property.id.label("property_id"),
            Property.name.label("property_name"),
            func.coalesce(func.sum(Entry.total_minutes), 0).label("total_minutes"),
            func.count(Entry.id).label("entries_count"),
        )
        .join(Entry, Entry.property_id == Property.id)
        .where(Property.user_id == current_user.id)
        .group_by(Property.id, Property.name)
        .order_by(func.sum(Entry.total_minutes).desc())
        .limit(limit)
    )

    return [
        PropertySummary(
            property_id=row.property_id,
            property_name=row.property_name,
            total_minutes=row.total_minutes,
            total_hours=round(row.total_minutes / 60, 2),
            entries_count=row.entries_count,
        )
        for row in result
    ]


@router.get("/monthly", response_model=List[MonthlyData])
async def get_monthly(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    months: int = Query(12, ge=1, le=24),
):
    """Get monthly hours trend."""
    # Calculate start date (beginning of month, N months ago)
    today = date.today()
    start_date = (today.replace(day=1) - timedelta(days=months * 30)).replace(day=1)

    # Use extract for database-agnostic year/month grouping
    year_col = extract('year', Entry.date)
    month_col = extract('month', Entry.date)

    result = await db.execute(
        select(
            year_col.label("year"),
            month_col.label("month_num"),
            func.coalesce(func.sum(Entry.total_minutes), 0).label("total_minutes"),
            func.count(Entry.id).label("entries_count"),
        )
        .where(
            Entry.user_id == current_user.id,
            Entry.date >= start_date,
        )
        .group_by(year_col, month_col)
        .order_by(year_col, month_col)
    )

    return [
        MonthlyData(
            month=f"{int(row.year)}-{int(row.month_num):02d}",
            total_minutes=row.total_minutes,
            total_hours=round(row.total_minutes / 60, 2),
            entries_count=row.entries_count,
        )
        for row in result
    ]
