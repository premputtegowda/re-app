"""Census BFS (Business Formation Statistics) loader — county-level, annual.

Source: US Census Bureau (public domain).
    https://www.census.gov/econ/bfs/data/county.html

BFS measures new business initiations via EIN (Employer ID Number)
applications. County-annual data is a genuine leading indicator for
employment growth: business applications precede employer formation
by 4-8 quarters.

**One metric per year: `BA` (business applications count).** Wide-format
Excel with columns BA2005..BA2025 (21 years of history). Melted to
long/tall in the loader — one row per (fips, year, business_applications).

**Cadence caveat.** County-level BFS is annual, not weekly (the
weekly/monthly BFS series are national-only). Publish lag ~5 months
(2025 data released June 2026). Same annual cadence + similar lag to
QCEW — pairs naturally with the existing employment features.

Run: `uv run python -m ingest.census_bfs`
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

SOURCE_NAME = "census_bfs"

BFS_URL = "https://www.census.gov/econ/bfs/xlsx/bfs_county_apps_annual.xlsx"

# The Excel file has a title/description row (0) + a blank row (1), then
# the actual column headers at row 2. `header=2` (0-indexed) picks the
# real header row.
XLSX_HEADER_ROW = 2
XLSX_SHEET_NAME = "County Data"


def load(as_of_date: date | None = None) -> Path:
    """Full ingest pipeline for Census BFS county applications."""
    as_of = compute_as_of_date(as_of_date)
    logger.info("Starting Census BFS ingest (as_of_date=%s)", as_of.isoformat())

    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_dl = Path(tmpdir) / "bfs_county_apps_annual.xlsx"
        download(BFS_URL, tmp_dl)
        snapshot_raw(SOURCE_NAME, as_of, tmp_dl)
        df_long = _parse_and_melt(tmp_dl)

    clean, quarantined = _normalize_and_partition(df_long, as_of)
    if not quarantined.empty:
        quarantine(SOURCE_NAME, as_of, quarantined, reason="fips_unknown_or_invalid")

    if clean.empty:
        raise RuntimeError("All rows failed FIPS normalization")

    curated_path = write_curated(SOURCE_NAME, as_of, clean)
    logger.info(
        "Census BFS ingest complete: %d clean rows (%d counties, %d years), "
        "%d quarantined, out=%s",
        len(clean),
        clean["fips"].nunique(),
        clean["period_end_date"].nunique(),
        len(quarantined),
        curated_path,
    )
    return curated_path


def _parse_and_melt(source_file: Path) -> pd.DataFrame:
    """Read XLSX, keep FIPS as strings, melt wide→long.

    Wide format: metadata columns + BA2005..BA2025. Melts to one row per
    (fips, year, business_applications).
    """
    df = pd.read_excel(
        source_file,
        sheet_name=XLSX_SHEET_NAME,
        header=XLSX_HEADER_ROW,
        dtype={"County Code": str, "state_fips": str, "county_fips": str},
    )
    logger.info("Parsed %d county rows from BFS wide format", len(df))

    required = {"State", "County", "state_fips", "county_fips"}
    missing = required - set(df.columns)
    if missing:
        raise ValueError(f"BFS schema drift — missing columns: {missing}")

    # Build FIPS = state_fips (2ch, zero-padded) + county_fips (3ch, zero-padded)
    df["fips_raw"] = df["state_fips"].str.zfill(2) + df["county_fips"].str.zfill(3)

    # Identify BAyyyy columns.
    year_cols = [c for c in df.columns if isinstance(c, str) and c.startswith("BA") and c[2:].isdigit()]
    if not year_cols:
        raise ValueError("BFS has no BAyyyy columns — schema changed?")
    logger.info("Found %d year columns: %s..%s", len(year_cols), year_cols[0], year_cols[-1])

    id_vars = ["fips_raw", "State", "County"]
    tall = df.melt(
        id_vars=id_vars,
        value_vars=year_cols,
        var_name="year_col",
        value_name="business_applications",
    )
    tall["year"] = tall["year_col"].str[2:].astype(int)
    tall = tall.drop(columns=["year_col"])
    tall["business_applications"] = pd.to_numeric(tall["business_applications"], errors="coerce")

    # BFS annual data represents calendar year → Dec 31 period end.
    tall["period_end_date"] = pd.to_datetime(
        tall["year"].astype(str) + "-12-31", errors="coerce"
    ).dt.date

    tall = tall.rename(columns={"State": "state", "County": "county_name"})
    # Drop rows with null BA counts — leaves counties that don't report.
    tall = tall.dropna(subset=["business_applications"])

    logger.info(
        "Melted to %d rows (%d counties × %d years)",
        len(tall), tall["fips_raw"].nunique(), tall["year"].nunique(),
    )
    return tall


def _normalize_and_partition(
    df: pd.DataFrame, as_of_date: date
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """FIPS-normalize; split into (clean, quarantined). Standard pattern."""
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

    keep_cols = [
        "fips", "period_end_date",
        "business_applications",
        "state", "county_name",
        "_fips_remap_flag",
    ]
    clean = clean[keep_cols]

    # Handle rename/split-merge collisions by summing BAs (permits pattern).
    dedup_key = ["fips", "period_end_date"]
    dupes = clean.duplicated(subset=dedup_key).sum()
    if dupes:
        logger.warning("Aggregating %d (fips, period) duplicates from remaps", dupes)
        agg_map = {
            "business_applications": "sum",
            "state": "first",
            "county_name": "first",
            "_fips_remap_flag": "first",
        }
        clean = clean.groupby(dedup_key, as_index=False).agg(agg_map)

    logger.info(
        "FIPS normalization: %d clean, %d quarantined, %d renamed, %d split_merge",
        len(clean), len(quarantined),
        (clean["_fips_remap_flag"] == "renamed").sum(),
        (clean["_fips_remap_flag"] == "split_merge").sum(),
    )
    return clean, quarantined


def _main() -> None:
    parser = argparse.ArgumentParser(description="Ingest Census BFS county business applications")
    parser.add_argument(
        "--as-of", type=date.fromisoformat, default=None,
        help="Override as_of_date (YYYY-MM-DD). Default: today UTC.",
    )
    parser.add_argument("--verbose", "-v", action="store_true", help="DEBUG-level logging")
    args = parser.parse_args()

    configure_logging(logging.DEBUG if args.verbose else logging.INFO)
    load(as_of_date=args.as_of)


if __name__ == "__main__":
    _main()
