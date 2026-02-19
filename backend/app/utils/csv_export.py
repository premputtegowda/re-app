import csv
import io
from dataclasses import dataclass
from datetime import date
from typing import Sequence


CSV_HEADERS = ["Date", "Hours", "Minutes", "Total Minutes", "Category", "Property", "Type", "Description"]


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


def entry_to_row(entry) -> EntryRow:
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
    )


def generate_ytd_csv(rows: Sequence[EntryRow], year: int) -> bytes:
    """
    Generate UTF-8-sig (BOM) encoded CSV bytes for the given rows.

    Args:
        rows: Sequence of EntryRow instances to write.
        year: The year for which the YTD report is generated (unused in body
              but kept in signature for context/future filtering).

    Returns:
        CSV bytes with BOM prefix for Excel compatibility.
    """
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


def get_ytd_filename(year: int) -> str:
    """Return the standard YTD CSV filename for the given year."""
    return f"reps_tracker_YTD_{year}.csv"
