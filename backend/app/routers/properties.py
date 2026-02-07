from typing import List
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models import User, Property, Entry
from app.schemas import PropertyCreate, PropertyUpdate, PropertyResponse

router = APIRouter(prefix="/properties", tags=["Properties"])


@router.get("", response_model=List[PropertyResponse])
async def list_properties(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List all properties for the current user."""
    result = await db.execute(
        select(Property)
        .where(Property.user_id == current_user.id)
        .order_by(Property.name)
    )
    return result.scalars().all()


@router.post("", response_model=PropertyResponse, status_code=status.HTTP_201_CREATED)
async def create_property(
    data: PropertyCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a new property."""
    # Check for duplicate name
    result = await db.execute(
        select(Property).where(
            Property.user_id == current_user.id,
            Property.name == data.name,
        )
    )
    if result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A property with this name already exists",
        )

    property_obj = Property(
        user_id=current_user.id,
        name=data.name,
        address=data.address,
    )
    db.add(property_obj)
    await db.commit()
    await db.refresh(property_obj)

    return property_obj


@router.get("/{property_id}", response_model=PropertyResponse)
async def get_property(
    property_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get a specific property by ID."""
    result = await db.execute(
        select(Property).where(
            Property.id == property_id,
            Property.user_id == current_user.id,
        )
    )
    property_obj = result.scalar_one_or_none()

    if not property_obj:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Property not found",
        )

    return property_obj


@router.put("/{property_id}", response_model=PropertyResponse)
async def update_property(
    property_id: UUID,
    data: PropertyUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update a property."""
    result = await db.execute(
        select(Property).where(
            Property.id == property_id,
            Property.user_id == current_user.id,
        )
    )
    property_obj = result.scalar_one_or_none()

    if not property_obj:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Property not found",
        )

    # Check for duplicate name if name is being updated
    if data.name and data.name != property_obj.name:
        result = await db.execute(
            select(Property).where(
                Property.user_id == current_user.id,
                Property.name == data.name,
                Property.id != property_id,
            )
        )
        if result.scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="A property with this name already exists",
            )

    # Update fields
    if data.name is not None:
        property_obj.name = data.name
    if data.address is not None:
        property_obj.address = data.address

    await db.commit()
    await db.refresh(property_obj)

    return property_obj


@router.delete("/{property_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_property(
    property_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete a property (only if not used by any entries)."""
    result = await db.execute(
        select(Property).where(
            Property.id == property_id,
            Property.user_id == current_user.id,
        )
    )
    property_obj = result.scalar_one_or_none()

    if not property_obj:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Property not found",
        )

    # Check if property is in use
    result = await db.execute(
        select(func.count(Entry.id)).where(Entry.property_id == property_id)
    )
    entry_count = result.scalar()

    if entry_count > 0:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Cannot delete: property is used in {entry_count} entries",
        )

    await db.delete(property_obj)
    await db.commit()
