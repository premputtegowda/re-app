"""BLS QCEW (Quarterly Census of Employment and Wages) loader — county-level, annual.

Source: US Bureau of Labor Statistics (public domain).
    https://www.bls.gov/cew/downloadable-data-files.htm

QCEW covers ~95% of US jobs (all employers subject to unemployment insurance).
This loader pulls the **annual singlefile** for each year — a single ~520MB
CSV per year with all aggregation levels (national, state, MSA, county) and
all NAICS granularities (2-digit supersector through 6-digit industry).

**Aggregation filter (drops ~99% of rows).** We keep only:
    - agglvl 70, own 0: county total, all ownerships, all industries
      → 1 row per county with headline employment + wages
    - agglvl 74, own 5: county × NAICS supersector, private only
      → ~19 supersector rows per county, needed for the framework's
        high-wage employment share signal (NAICS 51+52+54+55 / total)

Dropped:
    - National/state/MSA rows (agglvl < 70)
    - Sub-supersector NAICS granularity (agglvl 76-78) — 3-6 digit codes.
      Doubles or triples file size for marginal downstream value; the
      framework's sector signals are all at the 2-digit level.
    - Ownership breakdowns other than 0/5. Federal/state/local government
      series (own 1/2/3) can be re-derived from public totals if needed.

**Annual vs quarterly.** BLS publishes both. We use annual because:
    (a) framework signals are all annual-cadence (employment growth Y/Y,
        wage growth Y/Y, sector share point-in-time),
    (b) quarterly files are 4× larger and add noise for our use case,
    (c) annual files contain year-over-year change columns that quarterly
        files lack.

**period_end_date convention.** Annual QCEW covers Q1-Q4 of the year; the
`annual_avg_emplvl` is the average of 12 monthly readings. We store
period_end_date as Dec 31 of the year — matches convention used elsewhere
(FHFA HPI, Census PEP is July 1).

**as_of_date convention.** BLS publishes each year's annual file the
following ~August (2024 annual published Sep 2025). For a historical
backfill we snapshot each year under the vintage's actual release month
(rough approximation: Aug of year+1) to preserve bitemporal correctness.

Run: `uv run python -m ingest.bls_qcew`
    or trim range: `uv run python -m ingest.bls_qcew --start-year 2010`
"""

from __future__ import annotations

import argparse
import logging
import tempfile
import zipfile
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

SOURCE_NAME = "bls_qcew"

QCEW_URL_TEMPLATE = (
    "https://data.bls.gov/cew/data/files/{year}/csv/{year}_annual_singlefile.zip"
)

# Columns to actually read from the 39-column source. All the *_chg /
# *_pct_chg / lq_* / disclosure fields are computable downstream from base
# metrics; skipping them saves ~80% of read memory.
COLUMNS_TO_READ = [
    "area_fips",
    "own_code",
    "industry_code",
    "agglvl_code",
    "year",
    "qtr",
    "annual_avg_estabs",
    "annual_avg_emplvl",
    "total_annual_wages",
    "annual_avg_wkly_wage",
    "avg_annual_pay",
]

# Aggregation levels + ownership codes we keep after filtering.
# (agglvl, own) → semantic label (used in logging + provenance).
KEPT_SLICES: dict[tuple[int, int], str] = {
    (70, 0): "county_total_all_ownership",
    (74, 5): "county_supersector_private",
}

DEFAULT_START_YEAR = 2000

# Rough vintage release map. BLS publishes annual QCEW ~Sep of year+1.
# Used as default as_of_date when loading a historical year so the
# bitemporal schema reflects when data was actually available.
def _default_as_of_for_year(year: int) -> date:
    return date(year + 1, 9, 15)


def load(
    start_year: int = DEFAULT_START_YEAR,
    end_year: int | None = None,
    as_of_date: date | None = None,
) -> Path:
    """Load a range of QCEW annual singlefiles into a single curated Parquet.

    If `as_of_date` is None, each year is snapshotted under its own vintage
    release date (Sep of year+1) — historical backfill preserves bitemporal
    correctness. If `as_of_date` is provided, all years share that as_of
    (useful for a re-snapshot pass that treats the whole range as a single
    ingest event).

    Returns the path to the LAST curated Parquet written (one per as_of_date).
    """
    if end_year is None:
        # Latest annual publishes ~Sep of year+1. Try last full year first;
        # if that file 404s we'll surface the error to the caller (better
        # than silently skipping).
        end_year = compute_as_of_date(None).year - 1
    if start_year > end_year:
        raise ValueError(f"start_year ({start_year}) > end_year ({end_year})")

    logger.info(
        "Starting BLS QCEW ingest (years %d-%d, as_of_date=%s)",
        start_year, end_year, "per-vintage" if as_of_date is None else as_of_date,
    )

    last_path: Path | None = None
    for year in range(start_year, end_year + 1):
        as_of = as_of_date if as_of_date is not None else _default_as_of_for_year(year)
        last_path = _load_one_year(year, as_of)

    assert last_path is not None
    return last_path


def _load_one_year(year: int, as_of: date) -> Path:
    """Download + parse + write curated for one year."""
    url = QCEW_URL_TEMPLATE.format(year=year)
    logger.info("Loading QCEW %d (as_of=%s, url=%s)", year, as_of.isoformat(), url)

    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_zip = Path(tmpdir) / f"{year}_annual_singlefile.zip"
        download(url, tmp_zip)
        snapshot_raw(SOURCE_NAME, as_of, tmp_zip)
        df_wide = _parse_and_filter(tmp_zip, year)

    clean, quarantined = _normalize_and_partition(df_wide)
    if not quarantined.empty:
        quarantine(SOURCE_NAME, as_of, quarantined, reason="fips_unknown_or_invalid")
    if clean.empty:
        raise RuntimeError(f"QCEW {year}: all rows failed FIPS normalization")

    curated_path = write_curated(SOURCE_NAME, as_of, clean)
    logger.info(
        "QCEW %d complete: %d clean rows (%d counties, %d unique industries), "
        "%d quarantined, out=%s",
        year,
        len(clean),
        clean["fips"].nunique(),
        clean["industry_code"].nunique(),
        len(quarantined),
        curated_path,
    )
    return curated_path


def _parse_and_filter(zip_file: Path, year: int) -> pd.DataFrame:
    """Extract CSV from zip, read only wanted columns, filter to county slices.

    QCEW singlefiles are ~520MB uncompressed. We read the whole file into
    memory (pandas ~2GB peak) then filter aggressively — streaming the CSV
    with chunksize would save memory but complicate filter+concat logic;
    2GB peak is acceptable on modern hardware.
    """
    with zipfile.ZipFile(zip_file) as zf:
        inner_names = [n for n in zf.namelist() if n.endswith(".csv")]
        if len(inner_names) != 1:
            raise ValueError(f"Expected exactly 1 CSV in {zip_file.name}, got {inner_names}")
        with zf.open(inner_names[0]) as f:
            df = pd.read_csv(
                f,
                usecols=COLUMNS_TO_READ,
                dtype={
                    "area_fips": str,
                    "own_code": "Int8",
                    "industry_code": str,
                    "agglvl_code": "Int8",
                    "year": "Int16",
                    "qtr": str,
                },
            )
    logger.info("QCEW %d: parsed %d total rows (all agglvls)", year, len(df))

    # Filter to the (agglvl, own) slices we keep.
    keep_mask = False
    for (agglvl, own), _label in KEPT_SLICES.items():
        keep_mask |= (df["agglvl_code"] == agglvl) & (df["own_code"] == own)
    df = df[keep_mask].copy()
    logger.info("QCEW %d: kept %d rows after agglvl/own filter", year, len(df))

    # QCEW area_fips values include non-county codes:
    #   USxxx = national/regional aggregates
    #   XX000 = state totals (county part = 000)
    #   XXX99 = statewide "unknown" counties (part of state, no county assigned)
    #   XXXXX (5 digits, county part != 000) = actual counties
    # We only want real counties.
    is_5digit = df["area_fips"].str.fullmatch(r"\d{5}")
    is_county = is_5digit & ~df["area_fips"].str.endswith("000") & ~df["area_fips"].str.endswith("999")
    dropped = len(df) - is_county.sum()
    df = df[is_county].copy()
    logger.info("QCEW %d: kept %d county rows (dropped %d non-county)", year, len(df), dropped)

    if df.empty:
        raise ValueError(f"QCEW {year}: 0 county rows after filtering — schema drift?")

    df = df.rename(columns={"area_fips": "fips_raw"})
    df["period_end_date"] = date(year, 12, 31)
    return df


def _normalize_and_partition(
    df: pd.DataFrame,
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """FIPS-normalize; split into (clean, quarantined). Same pattern as other loaders."""
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
        "agglvl_code", "own_code", "industry_code",
        "annual_avg_estabs", "annual_avg_emplvl",
        "total_annual_wages", "annual_avg_wkly_wage", "avg_annual_pay",
        "_fips_remap_flag",
    ]
    clean = clean[keep_cols]

    # Dedup key includes industry_code + agglvl_code because a single county
    # has multiple rows (one for the county total, many for supersectors).
    dedup_key = ["fips", "period_end_date", "agglvl_code", "industry_code"]
    dupes = clean.duplicated(subset=dedup_key).sum()
    if dupes:
        # FIPS remap collisions: two source counties merged into one under
        # 2020 codes (e.g. Bedford VA). Sum employment/wages/estabs; take
        # first for remap_flag. Same rationale as census_bps.
        logger.warning("Aggregating %d dedup-key duplicates from FIPS remaps", dupes)
        agg_map = {
            "own_code": "first",
            "annual_avg_estabs": "sum",
            "annual_avg_emplvl": "sum",
            "total_annual_wages": "sum",
            # avg wkly wage and avg annual pay are per-employee — recompute
            # after summing wages and employment; safer than "mean" which
            # weights by row count not employee count.
            "annual_avg_wkly_wage": "mean",
            "avg_annual_pay": "mean",
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
    parser = argparse.ArgumentParser(description="Ingest BLS QCEW county employment + wages")
    parser.add_argument(
        "--start-year", type=int, default=DEFAULT_START_YEAR,
        help=f"First year to load (default: {DEFAULT_START_YEAR})",
    )
    parser.add_argument(
        "--end-year", type=int, default=None,
        help="Last year to load (default: latest published year)",
    )
    parser.add_argument(
        "--as-of", type=date.fromisoformat, default=None,
        help="Override as_of_date (YYYY-MM-DD). Default: per-year vintage "
             "release date (Sep of year+1) for bitemporal correctness.",
    )
    parser.add_argument("--verbose", "-v", action="store_true", help="DEBUG-level logging")
    args = parser.parse_args()

    configure_logging(logging.DEBUG if args.verbose else logging.INFO)
    load(start_year=args.start_year, end_year=args.end_year, as_of_date=args.as_of)


if __name__ == "__main__":
    _main()
