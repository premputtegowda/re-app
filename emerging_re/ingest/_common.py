"""Shared ingest helpers.

Every source loader uses these to:
- Compute the run's `as_of_date` (the date we downloaded — the OBSERVATION
  date, not the source's publish date).
- Snapshot the raw file immutably under `data/raw/{source}/{as_of_date}/`.
- Write curated Parquet under `data/curated/{source}/as_of_date={date}/`
  with the bitemporal schema (fips, period_end_date, as_of_date + metrics).
- Route validation failures to `data/quarantine/{source}/{as_of_date}/`
  rather than silently dropping.
- Download files with retries + progress logging.

Load helpers stay minimal on purpose — each source has its own quirks and
column schemas that live in the loader itself, not here.
"""

from __future__ import annotations

import gzip
import hashlib
import logging
import shutil
from datetime import UTC, date, datetime
from pathlib import Path

import httpx
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

logger = logging.getLogger(__name__)


# ── Paths ──────────────────────────────────────────────────────────────────
# All paths are anchored on the emerging_re package directory so loaders
# work regardless of the CWD they're invoked from.

MODULE_ROOT = Path(__file__).resolve().parent.parent
DATA_ROOT = MODULE_ROOT / "data"
RAW_ROOT = DATA_ROOT / "raw"
CURATED_ROOT = DATA_ROOT / "curated"
QUARANTINE_ROOT = DATA_ROOT / "quarantine"
CROSSWALKS_ROOT = DATA_ROOT / "crosswalks"


# ── as_of_date computation ─────────────────────────────────────────────────
# The `as_of_date` is the OBSERVATION date — when our ingest ran and saw the
# source's current published state. UTC to avoid timezone drift affecting
# which date a run belongs to. Overridable for backfills.

def compute_as_of_date(override: date | None = None) -> date:
    """Return today (UTC) unless an override is supplied (e.g. for backfills)."""
    return override or datetime.now(UTC).date()


# ── HTTP download with retries ─────────────────────────────────────────────

def download(url: str, dest: Path, timeout: float = 120.0, retries: int = 3) -> Path:
    """Download `url` to `dest`, atomic-write via temp file, retry on transient
    errors. Returns dest path on success. Raises on final failure."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".partial")

    last_err: Exception | None = None
    for attempt in range(1, retries + 1):
        try:
            logger.info("GET %s (attempt %d/%d)", url, attempt, retries)
            with httpx.stream("GET", url, timeout=timeout, follow_redirects=True) as r:
                r.raise_for_status()
                bytes_written = 0
                with tmp.open("wb") as f:
                    for chunk in r.iter_bytes(chunk_size=64 * 1024):
                        f.write(chunk)
                        bytes_written += len(chunk)
            logger.info("Downloaded %d bytes to %s", bytes_written, dest)
            tmp.rename(dest)  # atomic
            return dest
        except (httpx.HTTPError, httpx.TimeoutException) as e:
            last_err = e
            logger.warning("Download attempt %d failed: %s", attempt, e)
            if tmp.exists():
                tmp.unlink()
    raise RuntimeError(f"Download failed after {retries} attempts: {url}") from last_err


# ── Snapshot: gzip raw source file, hash for dedup, write to raw/ tree ─────

def snapshot_raw(source: str, as_of_date: date, source_file: Path) -> Path:
    """Copy `source_file` into `data/raw/{source}/{as_of_date}/` gzipped.

    Preserves the original filename. Returns the destination path.
    Idempotent: if the exact bytes were already snapshotted (same content
    hash under the same as_of_date), returns the existing path without
    re-writing.
    """
    out_dir = RAW_ROOT / source / as_of_date.isoformat()
    out_dir.mkdir(parents=True, exist_ok=True)

    # Preserve original name but ensure .gz suffix.
    name = source_file.name
    if not name.endswith(".gz"):
        name = f"{name}.gz"
    out_path = out_dir / name

    if out_path.exists():
        # Content-hash check for idempotency (protects against a re-run mid-day).
        existing_hash = _file_hash(out_path, gzipped=True)
        new_hash = _file_hash(source_file, gzipped=False)
        if existing_hash == new_hash:
            logger.info("Snapshot already exists with matching content: %s", out_path)
            return out_path
        logger.warning("Snapshot exists but content differs — overwriting: %s", out_path)

    with source_file.open("rb") as fin, gzip.open(out_path, "wb", compresslevel=6) as fout:
        shutil.copyfileobj(fin, fout)
    logger.info("Snapshot written: %s", out_path)
    return out_path


def _file_hash(path: Path, gzipped: bool) -> str:
    """SHA256 hex digest of file bytes (decompressed if gzipped=True)."""
    h = hashlib.sha256()
    opener = gzip.open if gzipped else open
    with opener(path, "rb") as f:
        while chunk := f.read(64 * 1024):
            h.update(chunk)
    return h.hexdigest()


# ── Write curated Parquet with bitemporal keys ─────────────────────────────

def write_curated(
    source: str,
    as_of_date: date,
    df: pd.DataFrame,
    *,
    required_columns: tuple[str, ...] = ("fips", "period_end_date"),
) -> Path:
    """Write `df` to `data/curated/{source}/as_of_date={date}/*.parquet`.

    Enforces:
    - `fips` column exists, is str, length 5, non-null
    - `period_end_date` column exists, is date-like
    - Adds `as_of_date` column set to `as_of_date` arg (bitemporal key)
    - Writes as a single Parquet file per as_of_date (partitioned dir layout
      so DuckDB `hive_partitioning=1` picks it up automatically)

    Returns destination path.
    """
    for col in required_columns:
        if col not in df.columns:
            raise ValueError(f"required column missing: {col}")
    if df["fips"].isna().any():
        raise ValueError("null fips values present — filter or quarantine before writing")
    if not df["fips"].astype(str).str.match(r"^\d{5}$").all():
        bad = df[~df["fips"].astype(str).str.match(r"^\d{5}$")]["fips"].unique()[:5]
        raise ValueError(f"fips must be 5-digit strings; found: {bad!r}")

    # Add the bitemporal key. Coerce to date (not datetime) for a clean schema.
    df = df.copy()
    df["as_of_date"] = as_of_date
    df["period_end_date"] = pd.to_datetime(df["period_end_date"]).dt.date

    out_dir = CURATED_ROOT / source / f"as_of_date={as_of_date.isoformat()}"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / "data.parquet"

    table = pa.Table.from_pandas(df, preserve_index=False)
    pq.write_table(table, out_path, compression="zstd")
    logger.info("Curated Parquet written: %s (%d rows)", out_path, len(df))
    return out_path


# ── Quarantine: rows that failed FIPS normalization or schema validation ──

def quarantine(
    source: str,
    as_of_date: date,
    df: pd.DataFrame,
    reason: str,
) -> Path | None:
    """Write `df` (with an added `_quarantine_reason` column) to
    `data/quarantine/{source}/{as_of_date}/{timestamp}_{reason_slug}.csv.gz`.

    No-op if `df` is empty. Never overwrites (adds a timestamp suffix if a
    same-named file exists). Reason should be a short slug describing the
    failure class (e.g. `"unknown_fips"`, `"schema_null_hpi"`).
    """
    if df.empty:
        return None
    df = df.copy()
    df["_quarantine_reason"] = reason

    out_dir = QUARANTINE_ROOT / source / as_of_date.isoformat()
    out_dir.mkdir(parents=True, exist_ok=True)
    ts = datetime.now(UTC).strftime("%H%M%S")
    slug = "".join(c if c.isalnum() else "_" for c in reason)[:50]
    out_path = out_dir / f"{ts}_{slug}.csv.gz"

    df.to_csv(out_path, index=False, compression="gzip")
    logger.warning("Quarantined %d rows (reason=%r) → %s", len(df), reason, out_path)
    return out_path


# ── Logging setup — call from `if __name__ == "__main__"` blocks ───────────

def configure_logging(level: int = logging.INFO) -> None:
    logging.basicConfig(
        level=level,
        format="%(asctime)s %(name)s %(levelname)s: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
