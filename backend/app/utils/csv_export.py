import csv
import io
from dataclasses import dataclass, field
from datetime import date
from typing import Sequence


CSV_HEADERS = ["Date", "Hours", "Minutes", "Total Minutes", "Category", "Property", "Type", "Description"]

AUDIT_CSV_HEADERS = [
    "Entry #", "Date", "Property", "Category", "Type",
    "Hours", "Minutes", "Total Minutes", "Total Hours", "Description", "Notes", "Attachments",
]


@dataclass
class EntryRow:
    """Flat, ORM-decoupled view of an hours entry for CSV export."""
    date: date
    hours: int
    minutes: int
    total_minutes: int
    category: str
    property: str
    type: str
    description: str
    notes: str | None = None
    attachment_filenames: list[str] = field(default_factory=list)
    attachment_urls: list[str] = field(default_factory=list)


def entry_to_row(entry, entry_num: int = 0) -> EntryRow:
    """Convert an ORM Entry object to an EntryRow dataclass."""
    return EntryRow(
        date=entry.date,
        hours=entry.hours,
        minutes=entry.minutes,
        total_minutes=entry.total_minutes,
        category=entry.category.name if entry.category else "",
        property=entry.property.name if entry.property else "",
        type=entry.type.value if hasattr(entry.type, "value") else str(entry.type),
        description=entry.description,
        notes=entry.notes or None,
        attachment_filenames=[
            a.original_filename for a in (entry.attachments or []) if a.original_filename
        ],
        attachment_urls=[
            a.attachment_url for a in (entry.attachments or []) if a.attachment_url
        ],
    )


def generate_ytd_csv(rows: Sequence[EntryRow], year: int) -> bytes:
    """Generate UTF-8-sig (BOM) encoded CSV bytes for the given rows."""
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(CSV_HEADERS)
    for row in rows:
        writer.writerow([
            row.date.isoformat(),
            row.hours,
            row.minutes,
            row.total_minutes,
            row.category,
            row.property,
            row.type,
            row.description,
        ])
    return buffer.getvalue().encode("utf-8-sig")


def generate_audit_csv(rows: Sequence[EntryRow], year: int) -> bytes:
    """Generate the full audit log CSV with notes and attachment URLs."""
    buffer = io.StringIO()
    writer = csv.writer(buffer, quoting=csv.QUOTE_MINIMAL)
    writer.writerow(AUDIT_CSV_HEADERS)
    for idx, row in enumerate(rows):
        entry_num = str(idx + 1).zfill(3)
        total_hours = round(row.hours + row.minutes / 60, 2)
        writer.writerow([
            entry_num,
            row.date.isoformat(),
            row.property,
            row.category,
            row.type,
            row.hours,
            row.minutes,
            row.total_minutes,
            f"{total_hours:.2f}",
            row.description,
            row.notes or "",
            " | ".join(row.attachment_urls),
        ])
    return buffer.getvalue().encode("utf-8-sig")


def get_ytd_filename(year: int) -> str:
    """Return the standard YTD CSV filename for the given year."""
    return f"reps_tracker_YTD_{year}.csv"


def get_audit_csv_filename(year: int) -> str:
    """Return the standard audit CSV filename for the given year."""
    return f"REPS_Audit_Log_{year}.csv"
