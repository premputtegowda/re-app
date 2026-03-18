import csv
import io
import zipfile
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Sequence


CSV_HEADERS = ["Date", "Hours", "Minutes", "Total Minutes", "Category", "Property", "Type", "Description"]

AUDIT_CSV_HEADERS = [
    "Entry #", "Date", "Property", "Category", "Type",
    "Hours", "Minutes", "Total Hours", "Description", "Notes / Evidence",
]


ATTACHMENT_MANIFEST_HEADERS = [
    "Entry #", "Entry Date", "Filename", "Content Type", "Size (bytes)", "Google Drive Link",
]


@dataclass
class AttachmentRecord:
    """Flat view of an attachment for the manifest CSV."""
    entry_num: str
    entry_date: date
    filename: str
    content_type: str
    file_size: int
    attachment_url: str


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
    notes: str = ""
    attachments: list[AttachmentRecord] = field(default_factory=list)


def entry_to_row(entry, entry_num: int = 0) -> EntryRow:
    """Convert an ORM Entry object to an EntryRow dataclass."""
    num_str = str(entry_num).zfill(3)
    attachment_records = [
        AttachmentRecord(
            entry_num=num_str,
            entry_date=entry.date,
            filename=a.original_filename,
            content_type=a.content_type,
            file_size=a.file_size,
            attachment_url=a.attachment_url,
        )
        for a in (entry.attachments or [])
    ]
    return EntryRow(
        date=entry.date,
        hours=entry.hours,
        minutes=entry.minutes,
        total_minutes=entry.total_minutes,
        category=entry.category.name if entry.category else "",
        property=entry.property.name if entry.property else "",
        type=entry.type.value if hasattr(entry.type, "value") else str(entry.type),
        description=entry.description,
        notes=entry.notes or "",
        attachments=attachment_records,
    )


def generate_ytd_csv(rows: Sequence[EntryRow], year: int) -> bytes:
    """
    Generate UTF-8-sig (BOM) encoded CSV bytes for the given rows.

    Args:
        rows: Sequence of EntryRow instances to write.
        year: The year for which the YTD report is generated.

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


def generate_audit_csv(rows: Sequence[EntryRow], year: int) -> bytes:
    """
    Generate the full audit log CSV matching the frontend export format.

    Includes Entry #, Total Hours (decimal), and Notes / Evidence columns.
    """
    buffer = io.StringIO()
    writer = csv.writer(buffer, quoting=csv.QUOTE_MINIMAL)
    writer.writerow(AUDIT_CSV_HEADERS)
    for idx, row in enumerate(rows):
        total_hours = round(row.hours + row.minutes / 60, 2)
        writer.writerow([
            str(idx + 1).zfill(3),
            row.date.isoformat(),
            row.property,
            row.category,
            row.type,
            row.hours,
            row.minutes,
            f"{total_hours:.2f}",
            row.description,
            row.notes,
        ])
    return buffer.getvalue().encode("utf-8-sig")


def generate_attachment_manifest(rows: Sequence[EntryRow]) -> bytes:
    """
    Generate a CSV manifest of all attachments across all entries.
    Returns UTF-8-sig encoded bytes, or an empty manifest if no attachments exist.
    """
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(ATTACHMENT_MANIFEST_HEADERS)
    for row in rows:
        for rec in row.attachments:
            writer.writerow([
                rec.entry_num,
                rec.entry_date.isoformat(),
                rec.filename,
                rec.content_type,
                rec.file_size,
                rec.attachment_url,
            ])
    return buffer.getvalue().encode("utf-8-sig")


def _build_readme(year: int, entry_count: int, attachment_count: int) -> str:
    generated = datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC")
    return "\n".join([
        f"REPS Audit Export Bundle — {year}",
        f"Generated: {generated}",
        f"Total Entries: {entry_count}",
        f"Total Attachments: {attachment_count}",
        "",
        "CONTENTS",
        "--------",
        f"  REPS_Audit_Log_{year}.csv          Full activity log with all fields",
        f"  REPS_Attachments_{year}.csv        Manifest of all supporting documents with Drive links",
        "  README.txt                         This file",
        "",
        "FILE NAMING CONVENTION",
        "----------------------",
        "Attachment files follow this pattern:",
        "",
        "  Entry_NNN_NN.<ext>",
        "",
        "where NNN matches the entry number in the CSV log.",
        "",
        "Examples:",
        "  Entry_042_01.pdf  →  first attachment for CSV entry #42",
        "  Entry_042_02.jpg  →  second attachment for CSV entry #42",
        "",
        "BEST PRACTICES (IRS § 469(c)(7))",
        "---------------------------------",
        "• Export at least once per month and retain for 7+ years.",
        "• For each material-participation entry, keep at least one of:",
        "    - Receipts or invoices",
        "    - Contractor agreements or work orders",
        "    - Photos of the property or work performed",
        "    - Emails/texts with tenants or vendors",
        "    - Calendar entries or time logs",
        "• Non-material entries still benefit from documentation.",
        "",
        "Generated by REPS Tracker.",
    ])


def generate_audit_bundle(rows: Sequence[EntryRow], year: int) -> bytes:
    """
    Generate the REPS Audit Bundle ZIP containing:
      - REPS_Audit_Log_{year}.csv        Full entry log
      - REPS_Attachments_{year}.csv      Manifest with Google Drive links
      - README.txt

    Returns raw ZIP bytes suitable for email attachment.
    """
    csv_bytes = generate_audit_csv(rows, year)
    manifest_bytes = generate_attachment_manifest(rows)
    attachment_count = sum(len(r.attachments) for r in rows)
    readme = _build_readme(year, len(rows), attachment_count)

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(f"REPS_Audit_Log_{year}.csv", csv_bytes)
        zf.writestr(f"REPS_Attachments_{year}.csv", manifest_bytes)
        zf.writestr("README.txt", readme.encode("utf-8"))
    return buf.getvalue()


def get_ytd_filename(year: int) -> str:
    """Return the standard YTD CSV filename for the given year."""
    return f"reps_tracker_YTD_{year}.csv"


def get_audit_bundle_filename(year: int) -> str:
    """Return the standard audit bundle ZIP filename for the given year."""
    return f"REPS_Audit_Bundle_{year}.zip"
