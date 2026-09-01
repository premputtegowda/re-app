"""Census ACS (American Community Survey) 5-year loader — county-level.

Source: US Census Bureau (public domain, requires free API key).
    https://www.census.gov/data/developers/data-sets/acs-5year.html

Pulls the ACS 5-year rolling estimates for a small, UI-focused variable set:
median household income, median gross rent (actual $), median home value,
plus rental vacancy inputs and total population sanity check.

**Not scored in the composite.** These are LEVEL metrics for the County
Detail UI page — an investor needs concrete $ numbers alongside the
composite rank to decide whether a market fits their budget. Empirical
test 2026-08-29 showed rate-based ACS-adjacent features (rent-vs-wage
growth) do NOT improve the composite; using ACS only for UI context.

**Vintage note.** ACS 5-year vintage YYYY estimates cover calendar years
(YYYY-4) through YYYY. Latest available today (Aug 2026): 2024. Multiple
vintages loaded under their release-date as_of for bitemporal correctness
(same pattern as Census PEP).

**Auth.** Requires CENSUS_API_KEY in ../.env (register at
https://api.census.gov/data/key_signup.html — instant email, no eligibility
gate).

Run: `uv run python -m ingest.census_acs`
    or single vintage: `uv run python -m ingest.census_acs --vintage 2020`
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

SOURCE_NAME = "census_acs"

# ACS 5-year API — vintage YYYY released each December for (YYYY-4)..(YYYY).
ACS_URL_TEMPLATE = "https://api.census.gov/data/{vintage}/acs/acs5"

# Vintages known available. ACS 5-year publishes each December. Latest
# available on 2026-08-29 = 2024.
LATEST_VINTAGE = 2024

# Approximate release dates for bitemporal as_of correctness. ACS 5-year
# typically publishes in December.
VINTAGE_RELEASE_DATES: dict[int, date] = {
    # Older vintages added 2026-09-01 to extend ACS coverage back to 2008
    # period_end (vintage 2010 = 2006-2010 rolling, midpoint 2008-12-31).
    # Enables ML training window back to 2008 cohorts with observed 36mo
    # ACS median-gross-rent forward targets.
    2010: date(2011, 12, 8),
    2011: date(2012, 12, 6),
    2012: date(2013, 12, 17),
    2013: date(2014, 12, 4),
    2014: date(2015, 12, 3),
    2015: date(2016, 12, 8),
    2016: date(2017, 12, 7),
    2017: date(2018, 12, 6),
    2018: date(2019, 12, 19),
    2019: date(2020, 12, 10),
    2020: date(2022, 3, 17),   # 2020 vintage delayed by pandemic
    2021: date(2022, 12, 8),
    2022: date(2023, 12, 7),
    2023: date(2024, 12, 12),
    2024: date(2025, 12, 11),
}

# Variables we pull. Kept small — this is UI context, not scoring inputs.
# All are estimates (suffix _E); margins of error (_M) omitted to keep the
# payload lean.
ACS_VARIABLES: dict[str, str] = {
    "B19013_001E": "median_household_income",       # dollars
    "B25064_001E": "median_gross_rent",             # dollars per month
    "B25077_001E": "median_home_value",             # dollars
    "B25003_002E": "owner_occupied_units",          # count — for renter_share denominator
    "B25003_003E": "renter_occupied_units",         # count
    "B25004_002E": "vacant_for_rent_units",         # count
    "B01003_001E": "total_population",              # count (sanity vs PEP)
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
    """Full ingest pipeline for one ACS 5-year vintage.

    Returns path to the curated Parquet file.
    """
    if vintage not in VINTAGE_RELEASE_DATES:
        raise ValueError(
            f"Unknown ACS vintage {vintage}. Known: {sorted(VINTAGE_RELEASE_DATES)}"
        )
    if as_of_date is None:
        as_of = VINTAGE_RELEASE_DATES[vintage]
    else:
        as_of = compute_as_of_date(as_of_date)

    key = _load_api_key()
    url = ACS_URL_TEMPLATE.format(vintage=vintage)
    logger.info(
        "Starting ACS 5yr ingest (vintage=%d, as_of_date=%s, url=%s)",
        vintage, as_of.isoformat(), url,
    )

    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_dl = Path(tmpdir) / f"acs5_{vintage}.json"
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
        "ACS 5yr %d complete: %d clean rows (%d counties), %d quarantined, out=%s",
        vintage, len(clean), clean["fips"].nunique(),
        len(quarantined), curated_path,
    )
    return curated_path


def _download_all_counties(url: str, key: str, dest: Path) -> None:
    """One API call gets all US counties for the requested vintage.

    httpx's INFO logger normally prints the full URL including query
    params — that would leak the API key into stdout/log files. Silence
    it locally around the call to avoid that.
    """
    variables = ",".join(["NAME", *ACS_VARIABLES.keys()])
    params = {
        "get": variables,
        "for": "county:*",
        "in": "state:*",
        "key": key,
    }
    logger.info("Fetching ACS 5yr for all counties (variables: %d)", len(ACS_VARIABLES))
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
    """Parse the JSON list-of-lists into a wide DataFrame.

    ACS API returns [headers, row1, row2, ...] format. First row is column
    names; subsequent rows are county-level records.
    """
    data = json.loads(source_file.read_bytes())
    if not data or len(data) < 2:
        raise ValueError(f"ACS response has {len(data)} rows — expected header + counties")

    headers = data[0]
    rows = data[1:]
    df = pd.DataFrame(rows, columns=headers)
    logger.info("Parsed %d county rows for ACS vintage %d", len(df), vintage)

    # Required columns from the API's shape: NAME, all ACS vars, state, county
    required = {"NAME", "state", "county", *ACS_VARIABLES.keys()}
    missing = required - set(df.columns)
    if missing:
        raise ValueError(f"ACS response missing columns: {missing}")

    # Build 5-digit FIPS from state (2) + county (3), keeping leading zeros.
    df["fips_raw"] = df["state"].str.zfill(2) + df["county"].str.zfill(3)

    # Coerce ACS variables to numeric. NULL sentinels: negative values in
    # some cases (Census codes for suppressed/insufficient sample) and
    # 'null' strings. We treat both as NaN.
    for var, alias in ACS_VARIABLES.items():
        df[alias] = pd.to_numeric(df[var], errors="coerce")
        # Census sometimes uses very negative sentinels (e.g. -666666666)
        # for suppressed data. Clip to NaN.
        df.loc[df[alias] < 0, alias] = pd.NA

    # Compute rental vacancy rate: for-rent / (for-rent + renter-occupied).
    denom = df["renter_occupied_units"].fillna(0) + df["vacant_for_rent_units"].fillna(0)
    df["rental_vacancy_rate"] = df["vacant_for_rent_units"] / denom.where(denom > 0)

    # ACS 5-year vintage YYYY covers (YYYY-4) through YYYY. Use vintage's
    # midpoint as period_end_date (following Census convention that 5yr
    # estimates are "centered" on year YYYY-2).
    center_year = vintage - 2
    df["period_end_date"] = date(center_year, 12, 31)

    # Rename NAME to something clean.
    df = df.rename(columns={"NAME": "county_state_name"})

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
        "median_household_income",
        "median_gross_rent",
        "median_home_value",
        "owner_occupied_units",
        "renter_occupied_units",
        "vacant_for_rent_units",
        "rental_vacancy_rate",
        "total_population",
        "county_state_name",
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
    parser = argparse.ArgumentParser(description="Ingest Census ACS 5-year county estimates")
    parser.add_argument(
        "--vintage", type=int, default=LATEST_VINTAGE,
        choices=sorted(VINTAGE_RELEASE_DATES),
        help=f"ACS 5yr vintage year (default: {LATEST_VINTAGE})",
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
