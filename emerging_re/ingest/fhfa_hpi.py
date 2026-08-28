"""FHFA HPI (House Price Index) loader — county-level, annual.

Source: Federal Housing Finance Agency (public domain).
    https://www.fhfa.gov/data/hpi/datasets

The county file is an XLSX with the actual data table starting on row 6
(header row 5 with 8 columns). Repeat-sales methodology on all-transactions
(includes refinances) — this is the target for Section 7 Target A (forward
24-month HPI change).

**IMPORTANT — verify URL on first run.** FHFA's download page occasionally
moves files. If the download fails with 404, browse to
    https://www.fhfa.gov/data/hpi/datasets
and update `HPI_COUNTY_URL` below. Look for the "HPI by County (annual,
all-transactions, experimental)" download link.

Run: `uv run python -m ingest.fhfa_hpi`
    or with a specific as_of_date for backfill:
    `uv run python -m ingest.fhfa_hpi --as-of 2024-05-15`
"""

from __future__ import annotations

import argparse
import logging
import tempfile
from datetime import date
from pathlib import Path

import pandas as pd

from crosswalks.normalize_fips import normalize_fips_series
from ingest._common import (
    compute_as_of_date,
    configure_logging,
    download,
    quarantine,
    snapshot_raw,
    write_curated,
)

logger = logging.getLogger(__name__)

SOURCE_NAME = "fhfa_hpi"

# FHFA's county HPI file. Update if FHFA reorganizes their download page.
# Verified 2026-08-28: https://www.fhfa.gov/data/hpi/datasets
HPI_COUNTY_URL = "https://www.fhfa.gov/hpi/download/annual/hpi_at_county.xlsx"

# XLSX has 5 title/note rows above the actual header. Header row is row 5
# (0-indexed) with 8 columns; data starts on row 6.
XLSX_HEADER_ROW = 5
XLSX_SHEET_NAME = "county"

# Expected column layout of the source XLSX (verified 2026-08-28).
# We validate presence of these columns before processing; a schema drift
# should fail loudly, not silently corrupt downstream data.
EXPECTED_COLUMNS = {
    "State": "state",              # 2-char state abbreviation
    "County": "county_name",       # human-readable county name
    "FIPS code": "fips_raw",       # 5-digit FIPS (may have leading zero)
    "Year": "year",                # 4-digit year
    "Annual Change (%)": "annual_change_pct",
    "HPI": "hpi",                  # index level (default base)
    "HPI with 1990 base": "hpi_1990_base",
    "HPI with 2000 base": "hpi_2000_base",
}


def load(as_of_date: date | None = None) -> Path:
    """Full ingest pipeline for FHFA county HPI.

    Steps:
      1. Compute as_of_date (today UTC unless overridden).
      2. Download the source TSV to a temp file.
      3. Snapshot the raw file to data/raw/fhfa_hpi/{as_of_date}/ (immutable).
      4. Parse + validate + FIPS-normalize.
      5. Quarantine rows that fail normalization.
      6. Write clean rows to data/curated/fhfa_hpi/as_of_date={date}/*.parquet
         with bitemporal keys (fips, period_end_date, as_of_date).

    Returns path to the curated Parquet file.
    """
    as_of = compute_as_of_date(as_of_date)
    logger.info("Starting FHFA HPI ingest (as_of_date=%s)", as_of.isoformat())

    # 1. Download to tempfile
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_dl = Path(tmpdir) / "hpi_at_county.xlsx"
        download(HPI_COUNTY_URL, tmp_dl)

        # 2. Snapshot raw (immutable, gzipped — XLSX compresses poorly but
        #    we gzip anyway for uniform snapshot format across sources)
        snapshot_raw(SOURCE_NAME, as_of, tmp_dl)

        # 3. Parse + validate
        df = _parse_and_validate(tmp_dl)

    # 4. FIPS-normalize + partition into clean / quarantine
    clean, quarantined = _normalize_and_partition(df, as_of)
    if not quarantined.empty:
        quarantine(SOURCE_NAME, as_of, quarantined, reason="fips_unknown_or_invalid")

    if clean.empty:
        raise RuntimeError("All rows failed FIPS normalization — check crosswalk and source URL")

    # 5. Write curated Parquet
    curated_path = write_curated(SOURCE_NAME, as_of, clean)
    logger.info(
        "FHFA HPI ingest complete: %d clean rows, %d quarantined, out=%s",
        len(clean), len(quarantined), curated_path,
    )
    return curated_path


def _parse_and_validate(source_file: Path) -> pd.DataFrame:
    """Read XLSX, rename columns to snake_case, validate schema.

    FHFA's file is XLSX with 5 title rows above the actual header. FIPS
    codes are read as strings to preserve leading zeros (Alabama = 01xxx,
    Alaska = 02xxx, etc.) — Excel strips them by default without dtype hint.
    """
    df = pd.read_excel(
        source_file,
        sheet_name=XLSX_SHEET_NAME,
        header=XLSX_HEADER_ROW,
        dtype={"FIPS code": str},
    )
    logger.info("Parsed %d rows from FHFA source", len(df))

    # Schema drift check — every EXPECTED_COLUMNS key must be in df.columns.
    missing = set(EXPECTED_COLUMNS) - set(df.columns)
    if missing:
        raise ValueError(
            f"FHFA source schema drift — missing columns: {missing}. "
            f"Got: {list(df.columns)}. Update EXPECTED_COLUMNS or check URL."
        )

    df = df.rename(columns=EXPECTED_COLUMNS)[list(EXPECTED_COLUMNS.values())]

    # Coerce types
    df["year"] = pd.to_numeric(df["year"], errors="coerce").astype("Int64")
    df["hpi"] = pd.to_numeric(df["hpi"], errors="coerce")
    df["hpi_1990_base"] = pd.to_numeric(df["hpi_1990_base"], errors="coerce")
    df["hpi_2000_base"] = pd.to_numeric(df["hpi_2000_base"], errors="coerce")
    df["annual_change_pct"] = pd.to_numeric(df["annual_change_pct"], errors="coerce")

    # Rows with null year or null hpi are useless — drop them (logged, not
    # quarantined; these are truly malformed and not recoverable).
    before = len(df)
    df = df.dropna(subset=["year", "hpi"])
    dropped = before - len(df)
    if dropped:
        logger.warning("Dropped %d rows with null year or hpi", dropped)

    # Derive period_end_date from year. FHFA annual data represents Dec 31
    # of the reporting year. If a source ever ships quarterly, this needs
    # to change — but "HPI_AT_BDL_county.txt" is annual by design.
    df["period_end_date"] = pd.to_datetime(
        df["year"].astype(str) + "-12-31", errors="coerce"
    ).dt.date

    return df


def _normalize_and_partition(
    df: pd.DataFrame, as_of_date: date
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Apply FIPS normalization; split into (clean, quarantined) DataFrames.

    Clean rows have `fips` set to the 2020 canonical code. Quarantined rows
    keep their original `fips_raw` value + a `_quarantine_reason` note added
    by the caller.
    """
    norm = normalize_fips_series(
        df["fips_raw"], period_end_dates=pd.Series(df["period_end_date"], index=df.index)
    )
    df = df.assign(**{
        "fips": norm["fips_2020"],
        "_fips_remap_flag": norm["remap_flag"],
        "_fips_remap_note": norm["note"],
    })

    quarantined_mask = df["fips"].isna() | (df["_fips_remap_flag"] == "unknown")
    quarantined = df[quarantined_mask].copy()
    clean = df[~quarantined_mask].copy()

    # Reorder clean columns so bitemporal keys come first
    keep_cols = [
        "fips", "period_end_date",
        "hpi", "hpi_1990_base", "hpi_2000_base", "annual_change_pct",
        "state", "county_name",
        "_fips_remap_flag",  # kept for provenance; downstream can filter
    ]
    clean = clean[keep_cols]

    # If a rename or split-merge collapsed two source rows to the same
    # (fips, period_end_date), dedup by taking the first — HPI values should
    # be identical since they came from the same source row physically.
    dupes = clean.duplicated(subset=["fips", "period_end_date"]).sum()
    if dupes:
        logger.warning("Deduping %d (fips, period) duplicates from remaps", dupes)
        clean = clean.drop_duplicates(subset=["fips", "period_end_date"], keep="first")

    logger.info(
        "FIPS normalization: %d clean, %d quarantined, %d remap-flag='renamed', "
        "%d remap-flag='split_merge'",
        len(clean), len(quarantined),
        (clean["_fips_remap_flag"] == "renamed").sum(),
        (clean["_fips_remap_flag"] == "split_merge").sum(),
    )
    return clean, quarantined


def _main() -> None:
    parser = argparse.ArgumentParser(description="Ingest FHFA county HPI")
    parser.add_argument(
        "--as-of", type=date.fromisoformat, default=None,
        help="Override as_of_date (YYYY-MM-DD) for backfills. Default: today UTC.",
    )
    parser.add_argument(
        "--verbose", "-v", action="store_true",
        help="Enable DEBUG-level logging",
    )
    args = parser.parse_args()

    configure_logging(logging.DEBUG if args.verbose else logging.INFO)
    load(as_of_date=args.as_of)


if __name__ == "__main__":
    _main()
