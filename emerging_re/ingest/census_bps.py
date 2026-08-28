"""Census BPS (Building Permits Survey) loader — county-level, annual.

Source: US Census Bureau (public domain).
    https://www.census.gov/construction/bps/

BPS measures new housing units authorized by building permits. It's the
canonical supply-side signal for the framework: strong migration + LOW
permits per capita = pricing power; strong migration + HIGH permits =
supply catching up, appreciation likely capped.

**File layout.** Census publishes one file per (month, year, level, type):
    coYYMMy.txt = county, year-to-date cumulative through month MM
    coYYMMc.txt = county, that single month only

We use the December YTD file (`coYY12y.txt`) for each historical year to
get full-year permit totals. For the current year, we probe months 12→1
and take the latest available YTD file (partial year).

**Two-row header.** First row groups columns by unit type; second row
gives the per-column labels (Bldgs, Units, Value). We skip both and pass
explicit column names.

**Metrics captured per (fips, year):**
    - units_1: units in 1-family buildings (single-family detached/attached)
    - units_2: units in 2-family buildings
    - units_34: units in 3-4 family buildings
    - units_5plus: units in 5+ family buildings (multifamily)
    - units_total: sum of the above (headline supply number)
    - value_total: total permit value in dollars (proxy for construction $)
    - bldgs_total: total buildings (permits, not units)

Skipping the "*_rep" (reported vs imputed) versions — imputation gap is
small at county level for annual data, and downstream models benefit from
the imputed totals being more consistent across counties.

Run: `uv run python -m ingest.census_bps`
    or a shorter backfill: `uv run python -m ingest.census_bps --start-year 2015`
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
    download,
    quarantine,
    snapshot_raw,
    write_curated,
)

logger = logging.getLogger(__name__)

SOURCE_NAME = "census_bps"

BPS_URL_TEMPLATE = (
    "https://www2.census.gov/econ/bps/County/co{yy:02d}{mm:02d}y.txt"
)

# Explicit column names — the two-row source header is unusable as-is
# (grouped headers with blank cells). Order matches the file layout
# verified 2026-08-28 for `co2412y.txt`.
COLUMN_NAMES = [
    "survey_date",        # YYYYMM int
    "state_fips",         # 2ch
    "county_fips",        # 3ch
    "region_code",
    "division_code",
    "county_name",
    # 1-unit
    "bldgs_1", "units_1", "value_1",
    # 2-unit
    "bldgs_2", "units_2", "value_2",
    # 3-4 unit
    "bldgs_34", "units_34", "value_34",
    # 5+ unit
    "bldgs_5plus", "units_5plus", "value_5plus",
    # Reported (imputation-free) versions — kept for provenance but not
    # written to curated (see module docstring).
    "bldgs_1_rep", "units_1_rep", "value_1_rep",
    "bldgs_2_rep", "units_2_rep", "value_2_rep",
    "bldgs_34_rep", "units_34_rep", "value_34_rep",
    "bldgs_5plus_rep", "units_5plus_rep", "value_5plus_rep",
]

# Which metric columns we sum across for headline totals.
UNITS_CATEGORIES = ["units_1", "units_2", "units_34", "units_5plus"]
BLDGS_CATEGORIES = ["bldgs_1", "bldgs_2", "bldgs_34", "bldgs_5plus"]
VALUE_CATEGORIES = ["value_1", "value_2", "value_34", "value_5plus"]

DEFAULT_START_YEAR = 2000


def load(
    start_year: int = DEFAULT_START_YEAR,
    end_year: int | None = None,
    as_of_date: date | None = None,
) -> Path:
    """Load a range of BPS annual files into a single curated Parquet.

    For each year in [start_year, end_year - 1] loads the December YTD
    file (full year). For end_year (current calendar year by default),
    probes months 12→1 and takes the latest available (partial year).

    Returns path to the curated Parquet file.
    """
    as_of = compute_as_of_date(as_of_date)
    if end_year is None:
        end_year = as_of.year
    if start_year > end_year:
        raise ValueError(f"start_year ({start_year}) > end_year ({end_year})")

    logger.info(
        "Starting Census BPS ingest (years %d-%d, as_of_date=%s)",
        start_year, end_year, as_of.isoformat(),
    )

    frames: list[pd.DataFrame] = []
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_root = Path(tmpdir)
        for year in range(start_year, end_year + 1):
            df_year = _load_one_year(year, tmp_root, as_of, is_current=(year == as_of.year))
            if df_year is not None:
                frames.append(df_year)

    if not frames:
        raise RuntimeError(f"No BPS files loaded for years {start_year}-{end_year}")

    df_all = pd.concat(frames, ignore_index=True)
    logger.info("Combined %d year-files into %d rows", len(frames), len(df_all))

    clean, quarantined = _normalize_and_partition(df_all, as_of)
    if not quarantined.empty:
        quarantine(SOURCE_NAME, as_of, quarantined, reason="fips_unknown_or_invalid")

    if clean.empty:
        raise RuntimeError("All rows failed FIPS normalization — check crosswalk and source URL")

    curated_path = write_curated(SOURCE_NAME, as_of, clean)
    logger.info(
        "Census BPS ingest complete: %d clean rows (%d counties, %d periods), "
        "%d quarantined, out=%s",
        len(clean),
        clean["fips"].nunique(),
        clean["period_end_date"].nunique(),
        len(quarantined),
        curated_path,
    )
    return curated_path


def _load_one_year(
    year: int, tmp_root: Path, as_of: date, is_current: bool
) -> pd.DataFrame | None:
    """Download + parse a single year's BPS file.

    For historical years pulls the December YTD file (full year total).
    For the current year probes 12→1 and uses the latest available.
    Returns None if no file for the year is available.
    """
    yy = year % 100
    months_to_try = [12] if not is_current else list(range(12, 0, -1))

    for mm in months_to_try:
        url = BPS_URL_TEMPLATE.format(yy=yy, mm=mm)
        # HEAD-check first to avoid noisy download attempts for missing months.
        try:
            head = httpx.head(url, timeout=15.0, follow_redirects=True)
        except httpx.HTTPError as e:
            logger.warning("HEAD failed for %s: %s", url, e)
            continue
        if head.status_code != 200:
            logger.debug("Skipping %s (HTTP %d)", url, head.status_code)
            continue

        tmp_dl = tmp_root / f"co{yy:02d}{mm:02d}y.txt"
        download(url, tmp_dl)
        snapshot_raw(SOURCE_NAME, as_of, tmp_dl)

        df = _parse_and_validate(tmp_dl, year=year, month=mm)
        logger.info("Loaded %s: %d county rows (period_end=%s)",
                    url.rsplit("/", 1)[1], len(df), df["period_end_date"].iloc[0])
        return df

    logger.warning("No BPS file available for year %d", year)
    return None


def _parse_and_validate(source_file: Path, year: int, month: int) -> pd.DataFrame:
    """Parse a BPS county file, keep FIPS parts as strings, derive period_end_date.

    Skips the two-row source header (grouped columns unusable as-is) and
    passes explicit COLUMN_NAMES. Empty separator lines are skipped
    automatically by pandas' `skip_blank_lines=True`.
    """
    df = pd.read_csv(
        source_file,
        skiprows=2,               # drop both header rows
        header=None,
        names=COLUMN_NAMES,
        dtype={"state_fips": str, "county_fips": str, "survey_date": str},
        skip_blank_lines=True,
    )

    if df.empty:
        raise ValueError(f"BPS file {source_file} parsed to 0 rows — schema drift?")

    # county_name has trailing whitespace from fixed-width formatting.
    df["county_name"] = df["county_name"].str.strip()

    # FIPS = state (2) + county (3), zero-padded.
    df["fips_raw"] = df["state_fips"].str.zfill(2) + df["county_fips"].str.zfill(3)

    # Coerce numeric columns (they arrive as int/float already but be defensive).
    for col in COLUMN_NAMES[6:]:  # everything after county_name is numeric
        df[col] = pd.to_numeric(df[col], errors="coerce")

    # Compute headline totals across unit-size categories.
    df["units_total"] = df[UNITS_CATEGORIES].sum(axis=1)
    df["bldgs_total"] = df[BLDGS_CATEGORIES].sum(axis=1)
    df["value_total"] = df[VALUE_CATEGORIES].sum(axis=1)

    # period_end_date = last day of the file's month.
    # For Dec files this is Dec 31 (full year). For partial-year current files
    # it's the last day of the latest month covered (e.g. 2026-07-31 = YTD Jul).
    df["period_end_date"] = pd.Timestamp(year=year, month=month, day=1).to_period("M").to_timestamp("M").date()

    return df


def _normalize_and_partition(
    df: pd.DataFrame, as_of_date: date
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
        # Per-category unit counts (dominant framework signal)
        "units_1", "units_2", "units_34", "units_5plus",
        # Headline totals
        "units_total", "bldgs_total", "value_total",
        # Metadata
        "county_name",
        "_fips_remap_flag",
    ]
    clean = clean[keep_cols]

    dupes = clean.duplicated(subset=["fips", "period_end_date"]).sum()
    if dupes:
        # Remaps can collapse two source rows to one (fips, period). Sum unit
        # counts (rare — Bedford VA is the main case) so total permits are
        # preserved rather than dropped.
        logger.warning("Aggregating %d (fips, period) duplicates from remaps", dupes)
        agg_map = {
            "units_1": "sum", "units_2": "sum", "units_34": "sum", "units_5plus": "sum",
            "units_total": "sum", "bldgs_total": "sum", "value_total": "sum",
            "county_name": "first", "_fips_remap_flag": "first",
        }
        clean = clean.groupby(["fips", "period_end_date"], as_index=False).agg(agg_map)

    logger.info(
        "FIPS normalization: %d clean, %d quarantined, %d renamed, %d split_merge",
        len(clean), len(quarantined),
        (clean["_fips_remap_flag"] == "renamed").sum(),
        (clean["_fips_remap_flag"] == "split_merge").sum(),
    )
    return clean, quarantined


def _main() -> None:
    parser = argparse.ArgumentParser(description="Ingest Census BPS county building permits")
    parser.add_argument(
        "--start-year", type=int, default=DEFAULT_START_YEAR,
        help=f"First year to load (default: {DEFAULT_START_YEAR})",
    )
    parser.add_argument(
        "--end-year", type=int, default=None,
        help="Last year to load (default: current year)",
    )
    parser.add_argument(
        "--as-of", type=date.fromisoformat, default=None,
        help="Override as_of_date (YYYY-MM-DD). Default: today UTC.",
    )
    parser.add_argument("--verbose", "-v", action="store_true", help="DEBUG-level logging")
    args = parser.parse_args()

    configure_logging(logging.DEBUG if args.verbose else logging.INFO)
    load(start_year=args.start_year, end_year=args.end_year, as_of_date=args.as_of)


if __name__ == "__main__":
    _main()
