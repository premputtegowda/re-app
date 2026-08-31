"""BEA Regional Personal Income loader — county-level, annual.

Source: US Bureau of Economic Analysis (public data, requires free API key).
    https://apps.bea.gov/API/signup/

BEA publishes county-level personal income annually (~11 month lag) via the
Regional dataset. We pull the CAINC1 (Personal Income Summary) table which
gives per-county totals for income, per-capita income, and population that
BEA re-benchmarks (slightly different from Census PEP due to methodology).

**Signal value:** per-capita income growth is the cleanest "wealth migration"
signal at county level:
    - High earners moving IN raises per-capita even without population growth
    - Sustained 3-5yr income CAGR outpacing state avg = economic magnet
    - Divergence from state average filters out overall macro drift
    - IRS SOI migration measures WHO's moving (income of movers); BEA measures
      RESULTING per-capita — complementary signals

**Publish schedule:** BEA releases county personal income in mid-November
of the following year (2024 data → Nov 2025). Prior years get periodically
revised — we snapshot each vintage under its release date for bitemporal
correctness.

**LineCode reference for CAINC1 table:**
    1 = Personal income (thousands of dollars)
    2 = Population (persons)
    3 = Per capita personal income (dollars)
CAINC5N adds wage/salary breakdown (200-series line codes) — separate loader
if we want the wage-share features.

**FIPS quirk:** BEA uses `GeoFips` = 5-digit FIPS for counties but also
includes state totals (`SS000`) and MSA-level rows if you ask for `MSA`
tables. We filter to 5-digit county codes only.

Run: `uv run python -m ingest.bea_regional_income`      # latest year
     `uv run python -m ingest.bea_regional_income --year 2022`
     `uv run python -m ingest.bea_regional_income --all` # all vintages
"""

from __future__ import annotations

import argparse
import json
import logging
import re
import tempfile
import time
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

SOURCE_NAME = "bea_regional_income"

BEA_API_URL = "https://apps.bea.gov/api/data/"

# CAINC1: Personal Income Summary. Line codes we pull per county.
CAINC1_LINE_CODES: dict[int, str] = {
    1: "personal_income_thousands",     # total personal income, $ thousands
    2: "bea_population",                # BEA re-benchmarked population
    3: "per_capita_income",             # $ per person
}

# BEA typically releases county personal income mid-November for prior year.
# Values here are approximate — used as as_of_date for bitemporal snapshot.
VINTAGE_RELEASE_DATES: dict[int, date] = {
    2019: date(2020, 11, 17),
    2020: date(2021, 11, 16),
    2021: date(2022, 11, 16),
    2022: date(2023, 11, 16),
    2023: date(2024, 11, 14),
    2024: date(2025, 11, 13),
}

LATEST_YEAR = 2024


def _load_api_key() -> str:
    env_path = Path(__file__).parent.parent / ".env"
    if not env_path.exists():
        raise RuntimeError(f"{env_path} not found — need BEA_API_KEY")
    for line in env_path.read_text().splitlines():
        if line.startswith("BEA_API_KEY="):
            key = line.split("=", 1)[1].strip().strip('"').strip("'")
            if not key or key.startswith("PASTE"):
                raise RuntimeError("BEA_API_KEY in .env is empty or placeholder")
            return key
    raise RuntimeError(f"BEA_API_KEY= not found in {env_path}")


def load(year: int = LATEST_YEAR, as_of_date: date | None = None) -> Path:
    """Full ingest pipeline for one BEA CAINC1 vintage-year snapshot."""
    if year not in VINTAGE_RELEASE_DATES:
        raise ValueError(
            f"Unknown BEA vintage {year}. Known: {sorted(VINTAGE_RELEASE_DATES)}"
        )
    as_of = VINTAGE_RELEASE_DATES[year] if as_of_date is None else compute_as_of_date(as_of_date)

    key = _load_api_key()
    logger.info(
        "Starting BEA regional income ingest (year=%d, as_of=%s)",
        year, as_of.isoformat(),
    )

    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_dl = Path(tmpdir) / f"bea_cainc1_{year}.json"
        _download(key, year, tmp_dl)
        snapshot_raw(SOURCE_NAME, as_of, tmp_dl)
        df_wide = _parse(tmp_dl, year)

    clean, quarantined = _normalize_and_partition(df_wide, as_of)
    if not quarantined.empty:
        quarantine(SOURCE_NAME, as_of, quarantined, reason="fips_unknown_or_invalid")
    if clean.empty:
        raise RuntimeError("All rows failed FIPS normalization")

    curated_path = write_curated(SOURCE_NAME, as_of, clean)
    logger.info(
        "BEA CAINC1 %d complete: %d clean rows (%d counties), %d quarantined, out=%s",
        year, len(clean), clean["fips"].nunique(),
        len(quarantined), curated_path,
    )
    return curated_path


def _download(key: str, year: int, dest: Path) -> None:
    """Pull all counties (GeoFips=COUNTY) for one year × all target line codes.
    BEA lets us request multiple line codes in one call via comma-separated
    LineCode param — 3 lines × ~3200 counties fits well under the response
    size limit. Silence httpx logging so key doesn't leak."""
    all_rows: list[dict] = []
    httpx_logger = logging.getLogger("httpx")
    prev_level = httpx_logger.level
    httpx_logger.setLevel(logging.WARNING)

    try:
        for line_code, alias in CAINC1_LINE_CODES.items():
            params = {
                "UserID": key,
                "method": "GetData",
                "datasetname": "Regional",
                "TableName": "CAINC1",
                "LineCode": str(line_code),
                "GeoFips": "COUNTY",
                "Year": str(year),
                "ResultFormat": "JSON",
            }
            r = httpx.get(BEA_API_URL, params=params, timeout=60.0)
            r.raise_for_status()
            payload = r.json()
            results = payload.get("BEAAPI", {}).get("Results", {})
            if "Error" in results:
                raise RuntimeError(f"BEA API error for line {line_code}: {results['Error']}")
            data = results.get("Data", [])
            for row in data:
                row["_line_code"] = line_code
                row["_alias"] = alias
            all_rows.extend(data)
            logger.info("Fetched line %d (%s): %d rows", line_code, alias, len(data))
            time.sleep(0.2)  # polite pacing
    finally:
        httpx_logger.setLevel(prev_level)

    dest.write_text(json.dumps(all_rows))
    logger.info("Total %d rows written to %s", len(all_rows), dest)


def _parse(source_file: Path, year: int) -> pd.DataFrame:
    """Long → wide pivot: rows keyed on fips, columns per line-code alias."""
    rows = json.loads(source_file.read_text())
    if not rows:
        raise ValueError(f"BEA CAINC1 response for {year} has 0 rows")

    df = pd.DataFrame(rows)
    logger.info("Parsed %d BEA rows for year %d", len(df), year)

    required = {"GeoFips", "GeoName", "DataValue", "_alias"}
    missing = required - set(df.columns)
    if missing:
        raise ValueError(f"BEA response missing columns: {missing}. Got: {list(df.columns)}")

    # Filter to 5-digit county codes (BEA also emits state totals SS000,
    # region roll-ups, and MSA codes that don't match ^\d{5}$).
    df = df[df["GeoFips"].astype(str).str.match(r"^\d{5}$")].copy()

    # DataValue is a string with commas for thousands separators; may be
    # "(NA)" or "(D)" (disclosure suppressed) — coerce to numeric with NaN.
    df["value"] = pd.to_numeric(
        df["DataValue"].astype(str).str.replace(",", "", regex=False),
        errors="coerce",
    )

    # Pivot: one row per county with columns = aliases.
    wide = df.pivot_table(
        index=["GeoFips", "GeoName"], columns="_alias", values="value", aggfunc="first"
    ).reset_index()
    wide.columns.name = None

    wide = wide.rename(columns={"GeoFips": "fips_raw", "GeoName": "county_state_name"})
    wide["period_end_date"] = date(year, 12, 31)

    logger.info("Pivoted to %d county rows × %d metric cols", len(wide), wide.shape[1] - 3)
    return wide


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
        *CAINC1_LINE_CODES.values(),
        "county_state_name",
        "_fips_remap_flag",
    ]
    clean = clean[[c for c in keep_cols if c in clean.columns]]

    dupes = clean.duplicated(subset=["fips", "period_end_date"]).sum()
    if dupes:
        logger.info("Collapsing %d (fips, period) duplicates from remaps", dupes)
        # Sum income + population, take max of per-capita (dominant county wins).
        agg_map = {
            "personal_income_thousands": "sum",
            "bea_population": "sum",
            "per_capita_income": "max",
            "county_state_name": "first",
            "_fips_remap_flag": "first",
        }
        clean = (
            clean.groupby(["fips", "period_end_date"], as_index=False)
            .agg({k: v for k, v in agg_map.items() if k in clean.columns})
        )

    logger.info("FIPS normalization: %d clean, %d quarantined", len(clean), len(quarantined))
    return clean, quarantined


def _main() -> None:
    parser = argparse.ArgumentParser(description="Ingest BEA CAINC1 personal income (county-level)")
    parser.add_argument(
        "--year", type=int, default=LATEST_YEAR,
        choices=sorted(VINTAGE_RELEASE_DATES),
        help=f"BEA data year (default: {LATEST_YEAR})",
    )
    parser.add_argument(
        "--all", action="store_true",
        help="Load all configured years (default: latest only)",
    )
    parser.add_argument(
        "--as-of", type=date.fromisoformat, default=None,
        help="Override as_of_date. Default: approximate BEA release date.",
    )
    parser.add_argument("--verbose", "-v", action="store_true", help="DEBUG logging")
    args = parser.parse_args()

    configure_logging(logging.DEBUG if args.verbose else logging.INFO)
    if args.all:
        for y in sorted(VINTAGE_RELEASE_DATES):
            load(year=y)
    else:
        load(year=args.year, as_of_date=args.as_of)


if __name__ == "__main__":
    _main()
