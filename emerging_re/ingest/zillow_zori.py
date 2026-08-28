"""Zillow ZORI (Observed Rent Index) loader — county-level, monthly.

Source: Zillow Research (public download, non-commercial license).
    https://www.zillow.com/research/data/

ZORI is Zillow's smoothed, seasonally-adjusted rent index for all rental
inventory (SFR + condo + multi-family). Monthly cadence, county granularity,
starts January 2015. Full history is RESTATED every month — snapshotting is
essential; past vintages are unrecoverable if we don't save them.

**License caveat (Section 6 of DECISIONS.md):** Zillow ZORI is
"personal, non-commercial use only." Fine for internal/personal use. Cannot
be redistributed or used in a commercial product without a licensed
replacement (Apartments.com, CoStar, CoreLogic Multifamily).

**Wide-format source, melted to long.** Source CSV has columns like
`2015-01-31`, `2015-02-28`, ..., `2026-XX-XX` (one per month). We melt to
one row per (fips, period_end_date) — matches the bitemporal schema
everywhere else in the module.

**Coverage:** ~1,393 counties as of 2026-08. Narrower than FHFA HPI (~2,795
counties) — this is what tightens the universe from ~800 to ~500-600 counties
(see DECISIONS.md Section 5).

Run: `uv run python -m ingest.zillow_zori`
"""

from __future__ import annotations

import argparse
import logging
import re
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

SOURCE_NAME = "zillow_zori"

# Zillow's county ZORI file — smoothed, seasonally adjusted, all-inventory
# (SFR + condo + MF). Verified 2026-08-28.
ZORI_COUNTY_URL = (
    "https://files.zillowstatic.com/research/public_csvs/zori/"
    "County_zori_uc_sfrcondomfr_sm_sa_month.csv"
)

# Metadata columns (fixed schema). Everything else in the CSV is a month
# column named like "YYYY-MM-DD". Order matches Zillow's file layout as of
# 2026-08 — validated below.
METADATA_COLUMNS = (
    "RegionID",
    "SizeRank",
    "RegionName",
    "RegionType",
    "StateName",
    "State",
    "Metro",
    "StateCodeFIPS",
    "MunicipalCodeFIPS",
)

# Recognise month columns by shape: "YYYY-MM-DD" where DD is the month-end.
MONTH_COLUMN_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def load(as_of_date: date | None = None) -> Path:
    """Full ingest pipeline for Zillow county ZORI.

    Steps mirror the FHFA loader: download → snapshot → parse → normalize
    FIPS → quarantine bad rows → write curated Parquet with bitemporal keys.

    Returns path to the curated Parquet file.
    """
    as_of = compute_as_of_date(as_of_date)
    logger.info("Starting Zillow ZORI ingest (as_of_date=%s)", as_of.isoformat())

    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_dl = Path(tmpdir) / "County_zori.csv"
        download(ZORI_COUNTY_URL, tmp_dl)
        snapshot_raw(SOURCE_NAME, as_of, tmp_dl)
        df_wide = _parse_and_validate(tmp_dl)

    df_long = _melt_to_long(df_wide)
    clean, quarantined = _normalize_and_partition(df_long, as_of)
    if not quarantined.empty:
        quarantine(SOURCE_NAME, as_of, quarantined, reason="fips_unknown_or_invalid")

    if clean.empty:
        raise RuntimeError("All rows failed FIPS normalization — check crosswalk and source URL")

    curated_path = write_curated(SOURCE_NAME, as_of, clean)
    logger.info(
        "Zillow ZORI ingest complete: %d clean rows (%d counties, %d months), "
        "%d quarantined, out=%s",
        len(clean),
        clean["fips"].nunique(),
        clean["period_end_date"].nunique(),
        len(quarantined),
        curated_path,
    )
    return curated_path


def _parse_and_validate(source_file: Path) -> pd.DataFrame:
    """Read wide-format CSV, keep FIPS-related metadata as strings.

    Zillow's `StateCodeFIPS` is a 2-char string (leading zero for states
    < 10 — e.g. "06" for CA). `MunicipalCodeFIPS` is 3-char. Both must be
    read as strings or Excel/CSV parsers strip leading zeros.
    """
    df = pd.read_csv(
        source_file,
        dtype={"StateCodeFIPS": str, "MunicipalCodeFIPS": str, "RegionID": str},
    )
    logger.info("Parsed %d county rows (wide format) from Zillow ZORI", len(df))

    # Schema drift check — every metadata column must be present.
    missing = set(METADATA_COLUMNS) - set(df.columns)
    if missing:
        raise ValueError(
            f"Zillow ZORI source schema drift — missing columns: {missing}. "
            f"Got: {list(df.columns)[:15]}...  "
            "Update METADATA_COLUMNS or check URL."
        )

    # RegionType should always be "county" for this file. Any other value
    # means Zillow changed the file or we downloaded the wrong one.
    non_county = df[df["RegionType"] != "county"]
    if not non_county.empty:
        raise ValueError(
            f"Zillow ZORI has {len(non_county)} non-county rows — expected all "
            f"'county'. Sample: {non_county['RegionType'].unique()[:5]}"
        )

    return df


def _melt_to_long(df_wide: pd.DataFrame) -> pd.DataFrame:
    """Reshape wide (columns = months) → long (one row per county+month).

    Output columns: fips_raw, period_end_date, zori, state, region_name, metro.
    """
    month_cols = [c for c in df_wide.columns if MONTH_COLUMN_RE.match(c)]
    if not month_cols:
        raise ValueError("No month columns detected in Zillow ZORI (expected YYYY-MM-DD)")

    logger.info(
        "Melting %d month columns (from %s to %s) across %d counties",
        len(month_cols), month_cols[0], month_cols[-1], len(df_wide),
    )

    # Build FIPS from Zillow's state + municipal code parts.
    df_wide = df_wide.copy()
    df_wide["fips_raw"] = (
        df_wide["StateCodeFIPS"].str.zfill(2) + df_wide["MunicipalCodeFIPS"].str.zfill(3)
    )

    id_vars = ["fips_raw", "State", "RegionName", "Metro"]
    df_long = df_wide.melt(
        id_vars=id_vars,
        value_vars=month_cols,
        var_name="period_end_date",
        value_name="zori",
    )
    df_long = df_long.rename(columns={
        "State": "state",
        "RegionName": "county_name",
        "Metro": "metro",
    })
    df_long["period_end_date"] = pd.to_datetime(df_long["period_end_date"]).dt.date

    # Drop null rents — Zillow leaves early months null for counties whose
    # coverage begins later. Not an error condition; just a coverage gap.
    before = len(df_long)
    df_long = df_long.dropna(subset=["zori"])
    dropped = before - len(df_long)
    if dropped:
        logger.info("Dropped %d rows with null ZORI (coverage gaps)", dropped)

    df_long["zori"] = pd.to_numeric(df_long["zori"], errors="coerce")
    return df_long


def _normalize_and_partition(
    df: pd.DataFrame, as_of_date: date
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """FIPS-normalize; split into (clean, quarantined) DataFrames.

    Same shape as the FHFA loader's partitioner — kept as a per-source function
    (not a shared helper) because column layouts vary and it's clearer to
    have the schema decisions colocated with the source's other quirks.
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

    keep_cols = [
        "fips", "period_end_date",
        "zori",
        "state", "county_name", "metro",
        "_fips_remap_flag",
    ]
    clean = clean[keep_cols]

    dupes = clean.duplicated(subset=["fips", "period_end_date"]).sum()
    if dupes:
        logger.warning("Deduping %d (fips, period) duplicates from remaps", dupes)
        clean = clean.drop_duplicates(subset=["fips", "period_end_date"], keep="first")

    logger.info(
        "FIPS normalization: %d clean, %d quarantined, %d renamed, %d split_merge",
        len(clean), len(quarantined),
        (clean["_fips_remap_flag"] == "renamed").sum(),
        (clean["_fips_remap_flag"] == "split_merge").sum(),
    )
    return clean, quarantined


def _main() -> None:
    parser = argparse.ArgumentParser(description="Ingest Zillow county ZORI")
    parser.add_argument(
        "--as-of", type=date.fromisoformat, default=None,
        help="Override as_of_date (YYYY-MM-DD) for backfills. Default: today UTC.",
    )
    parser.add_argument("--verbose", "-v", action="store_true", help="DEBUG-level logging")
    args = parser.parse_args()

    configure_logging(logging.DEBUG if args.verbose else logging.INFO)
    load(as_of_date=args.as_of)


if __name__ == "__main__":
    _main()
