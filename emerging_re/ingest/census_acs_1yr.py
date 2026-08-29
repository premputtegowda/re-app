"""Census ACS 1-year loader — county-level, calendar-year snapshots.

Source: US Census Bureau (public domain, requires free API key).
    https://www.census.gov/data/developers/data-sets/acs-1year.html

Parallel to census_acs.py (5-year loader) but pulls the ACS 1-year API
endpoint. Trade-off vs 5-year: FRESH data (single calendar year, not
5-year rolling average) at the cost of coverage (only counties with
pop >= 65,000 qualify — ~861 counties vs ~3,222 with 5-year).

**Why we want this alongside 5-year:** for counties where 1yr is
available, it's ~1 year old rather than a 5-year rolling average
covering data as far back as 5 years. Meaningfully fresher for
fast-moving quantities like median home value. int_acs_features
prefers 1yr when available, falls back to 5yr for smaller counties.

**Vintage note.** ACS 1yr vintage YYYY = calendar year YYYY (not a
rolling window). Latest available today (Aug 2026): 2024, released
September 2025. Vintage 2020 was SKIPPED by Census due to pandemic
sample collection issues — do not include in the sequence.

Run: `uv run python -m ingest.census_acs_1yr`
    or single vintage: `uv run python -m ingest.census_acs_1yr --vintage 2022`
"""

from __future__ import annotations

import argparse
import json
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

SOURCE_NAME = "census_acs_1yr"

ACS_URL_TEMPLATE = "https://api.census.gov/data/{vintage}/acs/acs1"

# ACS 1yr publishes each September for previous calendar year. Latest
# available today (Aug 2026) = 2024. Vintage 2020 was cancelled by
# Census due to pandemic sample issues — skipped in the sequence.
LATEST_VINTAGE = 2024

VINTAGE_RELEASE_DATES: dict[int, date] = {
    2019: date(2020, 9, 17),
    # 2020 SKIPPED — Census did not publish standard 1yr for 2020
    2021: date(2022, 9, 15),
    2022: date(2023, 9, 14),
    2023: date(2024, 9, 12),
    2024: date(2025, 9, 11),
}

# Same variable set as census_acs.py (5yr) so downstream models can
# swap between sources without changing column names.
ACS_VARIABLES: dict[str, str] = {
    "B19013_001E": "median_household_income",
    "B25064_001E": "median_gross_rent",
    "B25077_001E": "median_home_value",
    "B25003_002E": "owner_occupied_units",           # for renter_share denominator
    "B25003_003E": "renter_occupied_units",
    "B25004_002E": "vacant_for_rent_units",
    "B01003_001E": "total_population",
}


def _load_api_key() -> str:
    env_path = Path(__file__).parent.parent / ".env"
    if not env_path.exists():
        raise RuntimeError(f"{env_path} not found — need CENSUS_API_KEY")
    for line in env_path.read_text().splitlines():
        if line.startswith("CENSUS_API_KEY="):
            key = line.split("=", 1)[1].strip().strip('"').strip("'")
            if not key or key.startswith("PASTE"):
                raise RuntimeError("CENSUS_API_KEY in .env is empty or placeholder")
            return key
    raise RuntimeError(f"CENSUS_API_KEY= not found in {env_path}")


def load(vintage: int = LATEST_VINTAGE, as_of_date: date | None = None) -> Path:
    """Full ingest pipeline for one ACS 1yr vintage."""
    if vintage not in VINTAGE_RELEASE_DATES:
        raise ValueError(
            f"Unknown ACS 1yr vintage {vintage}. Known: {sorted(VINTAGE_RELEASE_DATES)}"
        )
    as_of = VINTAGE_RELEASE_DATES[vintage] if as_of_date is None else compute_as_of_date(as_of_date)

    key = _load_api_key()
    url = ACS_URL_TEMPLATE.format(vintage=vintage)
    logger.info(
        "Starting ACS 1yr ingest (vintage=%d, as_of_date=%s, url=%s)",
        vintage, as_of.isoformat(), url,
    )

    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_dl = Path(tmpdir) / f"acs1_{vintage}.json"
        _download_all_counties(url, key, tmp_dl)
        snapshot_raw(SOURCE_NAME, as_of, tmp_dl)
        df_wide = _parse_and_validate(tmp_dl, vintage)

    clean, quarantined = _normalize_and_partition(df_wide, as_of)
    if not quarantined.empty:
        quarantine(SOURCE_NAME, as_of, quarantined, reason="fips_unknown_or_invalid")
    if clean.empty:
        raise RuntimeError("All rows failed FIPS normalization")

    curated_path = write_curated(SOURCE_NAME, as_of, clean)
    logger.info(
        "ACS 1yr %d complete: %d clean rows (%d counties), %d quarantined, out=%s",
        vintage, len(clean), clean["fips"].nunique(),
        len(quarantined), curated_path,
    )
    return curated_path


def _download_all_counties(url: str, key: str, dest: Path) -> None:
    """One API call gets all pop>=65K counties. Silence httpx URL logging
    so the API key doesn't leak to stdout."""
    variables = ",".join(["NAME", *ACS_VARIABLES.keys()])
    params = {
        "get": variables,
        "for": "county:*",
        "in": "state:*",
        "key": key,
    }
    logger.info("Fetching ACS 1yr for all pop>=65K counties (variables: %d)", len(ACS_VARIABLES))
    httpx_logger = logging.getLogger("httpx")
    previous_level = httpx_logger.level
    httpx_logger.setLevel(logging.WARNING)
    try:
        r = httpx.get(url, params=params, timeout=120.0)
    finally:
        httpx_logger.setLevel(previous_level)
    r.raise_for_status()
    dest.write_bytes(r.content)
    logger.info("Downloaded %d bytes to %s", len(r.content), dest)


def _parse_and_validate(source_file: Path, vintage: int) -> pd.DataFrame:
    """Same shape as census_acs.py parser. Period end = Dec 31 of vintage
    year (1yr estimates ARE calendar-year snapshots, not smoothed
    windows — so there's no "midpoint" ambiguity as with 5yr)."""
    data = json.loads(source_file.read_bytes())
    if not data or len(data) < 2:
        raise ValueError(f"ACS 1yr response has {len(data)} rows")

    headers = data[0]
    rows = data[1:]
    df = pd.DataFrame(rows, columns=headers)
    logger.info("Parsed %d county rows for ACS 1yr vintage %d", len(df), vintage)

    required = {"NAME", "state", "county", *ACS_VARIABLES.keys()}
    missing = required - set(df.columns)
    if missing:
        raise ValueError(f"ACS 1yr response missing columns: {missing}")

    df["fips_raw"] = df["state"].str.zfill(2) + df["county"].str.zfill(3)

    for var, alias in ACS_VARIABLES.items():
        df[alias] = pd.to_numeric(df[var], errors="coerce")
        df.loc[df[alias] < 0, alias] = pd.NA

    denom = df["renter_occupied_units"].fillna(0) + df["vacant_for_rent_units"].fillna(0)
    df["rental_vacancy_rate"] = df["vacant_for_rent_units"] / denom.where(denom > 0)

    # 1yr = calendar year, so period_end = Dec 31 of the vintage year.
    df["period_end_date"] = date(vintage, 12, 31)
    df = df.rename(columns={"NAME": "county_state_name"})

    return df


def _normalize_and_partition(
    df: pd.DataFrame, as_of_date: date
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Same normalize/partition pattern as census_acs.py (5yr loader)."""
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
        "median_household_income", "median_gross_rent", "median_home_value",
        "owner_occupied_units", "renter_occupied_units",
        "vacant_for_rent_units", "rental_vacancy_rate",
        "total_population", "county_state_name",
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
    parser = argparse.ArgumentParser(description="Ingest Census ACS 1-year county estimates")
    parser.add_argument(
        "--vintage", type=int, default=LATEST_VINTAGE,
        choices=sorted(VINTAGE_RELEASE_DATES),
        help=f"ACS 1yr vintage year (default: {LATEST_VINTAGE}). Note: 2020 is unavailable.",
    )
    parser.add_argument(
        "--all", action="store_true",
        help="Load all known vintages sequentially (default: latest only)",
    )
    parser.add_argument(
        "--as-of", type=date.fromisoformat, default=None,
        help="Override as_of_date (YYYY-MM-DD). Default: vintage release date.",
    )
    parser.add_argument("--verbose", "-v", action="store_true", help="DEBUG-level logging")
    args = parser.parse_args()

    configure_logging(logging.DEBUG if args.verbose else logging.INFO)

    if args.all:
        for v in sorted(VINTAGE_RELEASE_DATES):
            load(vintage=v)
    else:
        load(vintage=args.vintage, as_of_date=args.as_of)


if __name__ == "__main__":
    _main()
