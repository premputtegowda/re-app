"""IRS SOI Migration loader — county-level, annual.

Source: IRS Statistics of Income (SOI) Division (public domain).
    https://www.irs.gov/statistics/soi-tax-stats-migration-data

Based on tax return address changes between consecutive filing years.
Each year's file describes moves BETWEEN two consecutive filing years
(e.g., `countyinflow2223.csv` = migration from tax year 2021 (filed 2022)
to tax year 2022 (filed 2023), with 2022 as the "current year").

**Two file types per year:**
    countyinflow{YY}{YY}.csv    — one row per (destination, origin) pair
                                    describing households MOVING IN to destination
    countyoutflow{YY}{YY}.csv   — one row per (origin, destination) pair
                                    describing households MOVING OUT of origin

**Key columns:**
    y2_statefips + y2_countyfips  = destination county
    y1_statefips + y1_countyfips  = origin county (or special code)
    n1                             = number of returns (households)
    n2                             = number of exemptions (people)
    agi                            = aggregate adjusted gross income ($ thousands)

**Special origin codes (y1_statefips):**
    96 = Total Migration - US and Foreign (all sources combined)
    97 = Total Migration - US only (excluding foreign)
    98 = Non-migrants (stayed in same county) — different summary row

We use `y1_statefips=96` rows as the total-inflow and total-outflow
aggregates per county. That gives us clean per-county totals without
double-counting when summing individual origin rows.

**Emitted features per (fips, tax_year):**
    inflow_returns          — households moving in
    inflow_exemptions       — people moving in
    inflow_agi_thousands    — aggregate income of movers-in ($ thousands)
    inflow_agi_per_return   — average household income of movers-in
    outflow_returns         — households moving out
    outflow_exemptions      — people moving out
    outflow_agi_thousands   — aggregate income of movers-out
    outflow_agi_per_return  — average household income of movers-out
    net_migration_returns   — inflow - outflow households
    net_agi_thousands       — inflow_agi - outflow_agi ("income imported")

**MF investor value:**
Average AGI of INFLOWS is the critical signal. A county receiving
high-income transplants (Onondaga NY absorbing Micron workers) has
very different rental economics than one receiving low-income
transplants. PEP migration alone doesn't distinguish this.

Run: `uv run python -m ingest.irs_soi_migration`
    or specific vintage: `uv run python -m ingest.irs_soi_migration --vintage 2223`
"""

from __future__ import annotations

import argparse
import logging
import tempfile
from datetime import date
from pathlib import Path

import httpx
import pandas as pd

from crosswalks.normalize_fips import normalize_fips_series
from ingest._common import (
    compute_as_of_date,
    configure_logging,
    quarantine,
    snapshot_raw,
    write_curated,
)

logger = logging.getLogger(__name__)

SOURCE_NAME = "irs_soi_migration"

BASE_URL = "https://www.irs.gov/pub/irs-soi"
HTTP_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X) "
        "emerging-re-loader/1.0 (research@example.com)"
    ),
}

# Vintage codes = "YYYYy" formatted as 4-digit two-year window.
# e.g. "2223" = migration from filing-year 2022 to filing-year 2023.
# The "current" (destination) year is the second half: 2022 → 2023 = 2023.
# Release lag ~2 years after tax year.
VINTAGE_RELEASE_DATES: dict[str, date] = {
    "1920": date(2022, 6, 1),  # tax years 2019→2020
    "2021": date(2023, 6, 1),  # 2020→2021
    "2122": date(2024, 6, 1),  # 2021→2022
    "2223": date(2025, 6, 1),  # 2022→2023 (latest today)
}
LATEST_VINTAGE = "2223"

# Special origin codes we want the "total" summary row for.
ALL_SOURCES_STATEFIPS = "96"  # US + Foreign combined


def load(vintage: str = LATEST_VINTAGE, as_of_date: date | None = None) -> Path:
    """Full ingest pipeline for one IRS SOI migration vintage."""
    if vintage not in VINTAGE_RELEASE_DATES:
        raise ValueError(
            f"Unknown IRS SOI vintage {vintage}. Known: {sorted(VINTAGE_RELEASE_DATES)}"
        )
    as_of = VINTAGE_RELEASE_DATES[vintage] if as_of_date is None else compute_as_of_date(as_of_date)
    # The "tax year" of the destination = 2000 + second-half of vintage code.
    tax_year = 2000 + int(vintage[2:])
    logger.info(
        "Starting IRS SOI ingest (vintage=%s, tax_year=%d, as_of=%s)",
        vintage, tax_year, as_of.isoformat(),
    )

    inflow_url = f"{BASE_URL}/countyinflow{vintage}.csv"
    outflow_url = f"{BASE_URL}/countyoutflow{vintage}.csv"

    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_in = Path(tmpdir) / f"countyinflow{vintage}.csv"
        tmp_out = Path(tmpdir) / f"countyoutflow{vintage}.csv"
        _download(inflow_url, tmp_in)
        _download(outflow_url, tmp_out)
        snapshot_raw(SOURCE_NAME, as_of, tmp_in)
        snapshot_raw(SOURCE_NAME, as_of, tmp_out)

        inflow = _parse_flow(tmp_in, is_inflow=True)
        outflow = _parse_flow(tmp_out, is_inflow=False)

    df = _combine_and_derive(inflow, outflow, tax_year)
    clean, quarantined = _normalize_and_partition(df, as_of)
    if not quarantined.empty:
        quarantine(SOURCE_NAME, as_of, quarantined, reason="fips_unknown_or_invalid")

    if clean.empty:
        raise RuntimeError("All rows failed FIPS normalization")

    curated_path = write_curated(SOURCE_NAME, as_of, clean)
    logger.info(
        "IRS SOI migration %s complete: %d clean rows (%d counties), %d quarantined, out=%s",
        vintage, len(clean), clean["fips"].nunique(),
        len(quarantined), curated_path,
    )
    return curated_path


def _download(url: str, dest: Path) -> None:
    """Download with proper UA (IRS blocks bare requests)."""
    logger.info("Downloading %s", url)
    with httpx.stream("GET", url, headers=HTTP_HEADERS, timeout=60.0, follow_redirects=True) as r:
        r.raise_for_status()
        with dest.open("wb") as f:
            for chunk in r.iter_bytes(chunk_size=64 * 1024):
                f.write(chunk)
    logger.info("Downloaded to %s (%d bytes)", dest, dest.stat().st_size)


def _parse_flow(source_file: Path, is_inflow: bool) -> pd.DataFrame:
    """Parse a countyinflow or countyoutflow CSV, filter to per-county totals.

    Column meaning DIFFERS by file:
      inflow  file: y2 = destination (subject), y1 = origin
      outflow file: y1 = origin (subject),      y2 = destination
    In both, the "subject" county is the one whose flows we tally,
    and the "other" side gets the special code 96 = "all sources/destinations
    combined" for the per-county summary row.

    Returns one row per subject-county with:
      {fips_raw, {prefix}_returns, {prefix}_exemptions, {prefix}_agi_thousands}
    """
    # Latin-1 encoding: IRS files include accented characters (e.g., "Doña Ana"
    # in NM) starting with the 2122 vintage. utf-8 fails on those rows.
    df = pd.read_csv(
        source_file,
        encoding="latin-1",
        dtype={
            "y2_statefips": str, "y2_countyfips": str,
            "y1_statefips": str, "y1_countyfips": str,
        },
        na_values=["", "0"],
    )
    label = "inflow" if is_inflow else "outflow"
    logger.info("Parsed %d rows from %s file", len(df), label)

    # Filter to per-county summary rows (all-source or all-destination totals).
    # inflow: y1_statefips=96 (all origins combined)
    # outflow: y2_statefips=96 (all destinations combined)
    if is_inflow:
        df = df[df["y1_statefips"] == ALL_SOURCES_STATEFIPS].copy()
        # Subject = destination
        df["fips_raw"] = df["y2_statefips"].str.zfill(2) + df["y2_countyfips"].str.zfill(3)
    else:
        df = df[df["y2_statefips"] == ALL_SOURCES_STATEFIPS].copy()
        # Subject = origin
        df["fips_raw"] = df["y1_statefips"].str.zfill(2) + df["y1_countyfips"].str.zfill(3)
    logger.info("Filtered %s to %d per-county total rows", label, len(df))

    # Rename columns per direction.
    prefix = "inflow" if is_inflow else "outflow"
    df = df.rename(columns={
        "n1": f"{prefix}_returns",
        "n2": f"{prefix}_exemptions",
        "agi": f"{prefix}_agi_thousands",
    })

    keep = df[[
        "fips_raw",
        f"{prefix}_returns",
        f"{prefix}_exemptions",
        f"{prefix}_agi_thousands",
    ]]
    return keep


def _combine_and_derive(inflow: pd.DataFrame, outflow: pd.DataFrame, tax_year: int) -> pd.DataFrame:
    """Merge inflow + outflow, compute per-return AGI and net metrics.

    period_end_date = Dec 31 of the tax_year (the destination year).
    """
    df = inflow.merge(outflow, on="fips_raw", how="outer")

    df["inflow_agi_per_return"] = (
        df["inflow_agi_thousands"] / df["inflow_returns"].where(df["inflow_returns"] > 0)
        * 1000  # convert thousands to $ / return
    )
    df["outflow_agi_per_return"] = (
        df["outflow_agi_thousands"] / df["outflow_returns"].where(df["outflow_returns"] > 0)
        * 1000
    )
    df["net_migration_returns"] = df["inflow_returns"].fillna(0) - df["outflow_returns"].fillna(0)
    df["net_agi_thousands"] = df["inflow_agi_thousands"].fillna(0) - df["outflow_agi_thousands"].fillna(0)

    df["period_end_date"] = date(tax_year, 12, 31)

    logger.info(
        "Combined: %d counties. Median inflow AGI/return: $%.0f, outflow AGI/return: $%.0f",
        len(df),
        df["inflow_agi_per_return"].median(),
        df["outflow_agi_per_return"].median(),
    )
    return df


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
        "inflow_returns", "inflow_exemptions", "inflow_agi_thousands", "inflow_agi_per_return",
        "outflow_returns", "outflow_exemptions", "outflow_agi_thousands", "outflow_agi_per_return",
        "net_migration_returns", "net_agi_thousands",
        "_fips_remap_flag",
    ]
    clean = clean[keep_cols]

    dupes = clean.duplicated(subset=["fips", "period_end_date"]).sum()
    if dupes:
        logger.warning("Deduping %d (fips, period) duplicates", dupes)
        clean = clean.drop_duplicates(subset=["fips", "period_end_date"], keep="first")

    logger.info("FIPS normalization: %d clean, %d quarantined", len(clean), len(quarantined))
    return clean, quarantined


def _main() -> None:
    parser = argparse.ArgumentParser(description="Ingest IRS SOI county migration flows")
    parser.add_argument(
        "--vintage", type=str, default=LATEST_VINTAGE,
        choices=sorted(VINTAGE_RELEASE_DATES),
        help=f"IRS SOI vintage code YYYY (default: {LATEST_VINTAGE})",
    )
    parser.add_argument(
        "--all", action="store_true",
        help="Load all known vintages sequentially (default: latest only)",
    )
    parser.add_argument(
        "--as-of", type=date.fromisoformat, default=None,
        help="Override as_of_date (YYYY-MM-DD). Default: vintage release date.",
    )
    parser.add_argument("--verbose", "-v", action="store_true", help="DEBUG logging")
    args = parser.parse_args()

    configure_logging(logging.DEBUG if args.verbose else logging.INFO)
    if args.all:
        for v in sorted(VINTAGE_RELEASE_DATES):
            load(vintage=v)
    else:
        load(vintage=args.vintage, as_of_date=args.as_of)


if __name__ == "__main__":
    _main()
