from uuid import UUID
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status, Query
from pydantic import BaseModel
from sqlalchemy import select, and_, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings, get_settings
from app.database import get_db
from app.dependencies import get_current_user
from app.models import User, Entry, Category, Property
from app.models.entry import EntryType as ModelEntryType
from app.schemas import EntryCreate, EntryUpdate, EntryResponse
from app.schemas.entry import EntryType, EntryFilter
from app.services.classification import ClassificationResult, get_classifier

router = APIRouter(prefix="/entries", tags=["Entries"])


class ClassifyRequest(BaseModel):
    description: str


async def validate_category_and_property(
    db: AsyncSession,
    user_id: UUID,
    category_id: UUID,
    property_id: UUID,
) -> None:
    """Validate that category and property exist and belong to user."""
    # Check category
    result = await db.execute(
        select(Category).where(
            Category.id == category_id,
            Category.user_id == user_id,
        )
    )
    if not result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Category not found or doesn't belong to user",
        )

    # Check property
    result = await db.execute(
        select(Property).where(
            Property.id == property_id,
            Property.user_id == user_id,
        )
    )
    if not result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Property not found or doesn't belong to user",
        )


@router.post("/classify", response_model=ClassificationResult)
async def classify_activity(
    data: ClassifyRequest,
    current_user: User = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    """Classify an activity description using Gemini AI."""
    if not settings.gemini_api_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="AI classification is not configured",
        )

    classifier = get_classifier(settings)

    try:
        return await classifier.classify(data.description)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"AI classification failed: {exc}",
        ) from exc


@router.get("", response_model=List[EntryResponse])
async def list_entries(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    category_id: Optional[UUID] = Query(None),
    property_id: Optional[UUID] = Query(None),
    type: Optional[EntryType] = Query(None),
    search: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
):
    """List entries with optional filters and pagination."""
    query = select(Entry).where(Entry.user_id == current_user.id)

    # Apply filters
    if date_from:
        query = query.where(Entry.date >= date_from)
    if date_to:
        query = query.where(Entry.date <= date_to)
    if category_id:
        query = query.where(Entry.category_id == category_id)
    if property_id:
        query = query.where(Entry.property_id == property_id)
    if type:
        query = query.where(Entry.type == ModelEntryType(type.value))
    if search:
        query = query.where(Entry.description.ilike(f"%{search}%"))

    # Order by date descending, then by created_at descending
    query = query.order_by(Entry.date.desc(), Entry.created_at.desc())

    # Pagination
    offset = (page - 1) * limit
    query = query.offset(offset).limit(limit)

    result = await db.execute(query)
    return result.scalars().all()


@router.post("", response_model=EntryResponse, status_code=status.HTTP_201_CREATED)
async def create_entry(
    data: EntryCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a new hours entry."""
    await validate_category_and_property(
        db, current_user.id, data.category_id, data.property_id
    )

    entry = Entry(
        user_id=current_user.id,
        category_id=data.category_id,
        property_id=data.property_id,
        date=data.date,
        hours=data.hours,
        minutes=data.minutes,
        total_minutes=data.hours * 60 + data.minutes,
        type=ModelEntryType(data.type.value),
        description=data.description,
        notes=data.notes,
    )
    db.add(entry)
    await db.commit()
    await db.refresh(entry)

    return entry


@router.post("/bulk", response_model=List[EntryResponse], status_code=status.HTTP_201_CREATED)
async def create_entries_bulk(
    entries: List[EntryCreate],
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create multiple entries at once (for migration from localStorage)."""
    if len(entries) > 500:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Maximum 500 entries per bulk request",
        )

    created_entries = []

    for data in entries:
        # Validate category and property exist
        await validate_category_and_property(
            db, current_user.id, data.category_id, data.property_id
        )

        entry = Entry(
            user_id=current_user.id,
            category_id=data.category_id,
            property_id=data.property_id,
            date=data.date,
            hours=data.hours,
            minutes=data.minutes,
            total_minutes=data.hours * 60 + data.minutes,
            type=ModelEntryType(data.type.value),
            description=data.description,
        )
        db.add(entry)
        created_entries.append(entry)

    await db.commit()

    # Refresh all entries
    for entry in created_entries:
        await db.refresh(entry)

    return created_entries


@router.get("/{entry_id}", response_model=EntryResponse)
async def get_entry(
    entry_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get a specific entry by ID."""
    result = await db.execute(
        select(Entry).where(
            Entry.id == entry_id,
            Entry.user_id == current_user.id,
        )
    )
    entry = result.scalar_one_or_none()

    if not entry:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Entry not found",
        )

    return entry


@router.put("/{entry_id}", response_model=EntryResponse)
async def update_entry(
    entry_id: UUID,
    data: EntryUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update an entry."""
    result = await db.execute(
        select(Entry).where(
            Entry.id == entry_id,
            Entry.user_id == current_user.id,
        )
    )
    entry = result.scalar_one_or_none()

    if not entry:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Entry not found",
        )

    # Validate new category/property if provided
    category_id = data.category_id if data.category_id else entry.category_id
    property_id = data.property_id if data.property_id else entry.property_id

    if data.category_id or data.property_id:
        await validate_category_and_property(
            db, current_user.id, category_id, property_id
        )

    # Update fields
    if data.date is not None:
        entry.date = data.date
    if data.hours is not None:
        entry.hours = data.hours
    if data.minutes is not None:
        entry.minutes = data.minutes
    if data.category_id is not None:
        entry.category_id = data.category_id
    if data.property_id is not None:
        entry.property_id = data.property_id
    if data.type is not None:
        entry.type = ModelEntryType(data.type.value)
    if data.description is not None:
        entry.description = data.description
    if data.notes is not None:
        entry.notes = data.notes

    # Recalculate total_minutes
    entry.total_minutes = entry.hours * 60 + entry.minutes

    # Validate total time > 0
    if entry.total_minutes == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Time must be greater than 0",
        )

    await db.commit()
    await db.refresh(entry)

    return entry


@router.delete("/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_entry(
    entry_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete an entry."""
    result = await db.execute(
        select(Entry).where(
            Entry.id == entry_id,
            Entry.user_id == current_user.id,
        )
    )
    entry = result.scalar_one_or_none()

    if not entry:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Entry not found",
        )

    await db.delete(entry)
    await db.commit()
