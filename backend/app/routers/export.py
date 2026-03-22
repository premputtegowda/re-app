import io
import logging
import zipfile
from datetime import date

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.dependencies import get_current_user
from app.models import User, Entry
from app.services.r2 import get_object_bytes
from app.utils.csv_export import (
    entry_to_row,
    generate_audit_csv,
    get_audit_csv_filename,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/export", tags=["Export"])


@router.get("/audit-package")
async def download_audit_package(
    year: int = Query(default=None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Generate and stream a ZIP containing:
      - REPS_Audit_Log_{year}.csv  (entry log with prefixed attachment filenames)
      - attachments/{entry_num}_{original_filename}  (all R2 files, labeled by entry)
    """
    resolved_year = year or date.today().year
    year_start = date(resolved_year, 1, 1)
    year_end = date(resolved_year, 12, 31)

    result = await db.execute(
        select(Entry)
        .options(
            selectinload(Entry.category),
            selectinload(Entry.property),
            selectinload(Entry.attachments),
        )
        .where(
            Entry.user_id == current_user.id,
            Entry.date >= year_start,
            Entry.date <= year_end,
        )
        .order_by(Entry.date.asc(), Entry.created_at.asc())
    )
    entries = result.scalars().all()

    rows = [entry_to_row(e, idx + 1) for idx, e in enumerate(entries)]
    csv_bytes = generate_audit_csv(rows, resolved_year)
    csv_filename = get_audit_csv_filename(resolved_year)

    total_attachments = sum(len(e.attachments or []) for e in entries)
    logger.info(
        "Audit package: user=%s year=%d entries=%d attachments=%d",
        current_user.email, resolved_year, len(entries), total_attachments,
    )

    def generate_zip():
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
            zf.writestr(csv_filename, csv_bytes)

            for idx, entry in enumerate(entries):
                entry_num = str(idx + 1).zfill(3)
                for attachment in (entry.attachments or []):
                    logger.info(
                        "Processing attachment id=%s file_ref=%s",
                        attachment.id, attachment.file_ref,
                    )
                    if not (attachment.file_ref and "/" in attachment.file_ref):
                        logger.warning("Skipping attachment %s — not an R2 file", attachment.id)
                        continue
                    try:
                        file_bytes = get_object_bytes(attachment.file_ref)
                        filename = f"{entry_num}_{attachment.original_filename}"
                        zf.writestr(f"attachments/{filename}", file_bytes)
                        logger.info("Added %s to ZIP", filename)
                    except Exception as e:
                        logger.warning(
                            "Skipping attachment %s in audit package: %s",
                            attachment.id, e,
                        )

        buffer.seek(0)
        yield buffer.read()

    zip_filename = f"REPS_Audit_Package_{resolved_year}.zip"
    return StreamingResponse(
        generate_zip(),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{zip_filename}"'},
    )
