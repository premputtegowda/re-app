"""HUD Fair Market Rents loader — county-level, annual (fiscal year).

Source: US Department of Housing and Urban Development (public data,
requires free HUD USER API token — same token used for USPS Crosswalk
API; no eligibility gate for FMR).

Fair Market Rents are the 40th-percentile rent for standard-quality
rentals in each area. HUD uses them to set Section 8 voucher payment
standards. Because Section 8 usage is heavily multi-family, FMR is a
better MF-rent proxy than Zillow ZORI (which blends SFR + condo + MF).

**Bedroom counts:** FMR is published by unit size (Efficiency/0BR, 1BR,
2BR, 3BR, 4BR). We load all five but 2BR is the primary MF proxy
(2BR is ~40-50% of typical US apartment inventory).

**Geography:** FMR is set at "FMR Area" level, which can be:
   - Single county (rural / small metros)
   - Multi-county HUD Metro FMR Area (most metros)
   - Sometimes sub-metro Small Area FMRs at ZIP level (not covered here)
The API returns county-level rows via /statedata/{state} — the same
metro-area FMR is repeated for each constituent county. That's the
right shape for our county-keyed model.

**FMR Percentile caveat:** FMR = 40th percentile of standard-quality
rentals. This UNDERSTATES market-rate rent by ~10-25% for typical
markets. For Class B/C properties, close to actual rents charged. For
Class A luxury, FMR is well below market. Downstream analysis should
apply appropriate premium if targeting higher-end properties.

**Bitemporal note:** HUD publishes each fiscal year's FMR in early
October of the previous calendar year (FY2026 FMR published Oct 2025).
Snapshotted under actual release date.

Run: `uv run python -m ingest.hud_fmr`
    or single year: `uv run python -m ingest.hud_fmr --year 2024`
"""

from __future__ import annotations

import argparse
import json
import logging
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

SOURCE_NAME = "hud_fmr"

FMR_STATE_URL = "https://www.huduser.gov/hudapi/public/fmr/statedata/{state}?year={year}"
LIST_STATES_URL = "https://www.huduser.gov/hudapi/public/fmr/listStates"

# HUD FMR is set on the federal fiscal year (Oct 1 - Sep 30). API "year"
# param = fiscal year. Released ~early October of the previous year.
# Latest available today (Aug 2026): FY2026 (released Oct 2025).
LATEST_YEAR = 2026

VINTAGE_RELEASE_DATES: dict[int, date] = {
    2019: date(2018, 10, 1),
    2020: date(2019, 10, 1),
    2021: date(2020, 10, 1),
    2022: date(2021, 10, 1),
    2023: date(2022, 10, 1),
    2024: date(2023, 10, 1),
    2025: date(2024, 10, 1),
    2026: date(2025, 10, 1),
}


def _load_hud_token() -> str:
    env_path = Path(__file__).parent.parent / ".env"
    if not env_path.exists():
        raise RuntimeError(f"{env_path} not found — need HUD_API_TOKEN")
    for line in env_path.read_text().splitlines():
        if line.startswith("HUD_API_TOKEN="):
            token = line.split("=", 1)[1].strip().strip('"').strip("'")
            if not token or token.startswith("PASTE"):
                raise RuntimeError("HUD_API_TOKEN empty or placeholder in .env")
            return token
    raise RuntimeError(f"HUD_API_TOKEN= not found in {env_path}")


def load(year: int = LATEST_YEAR, as_of_date: date | None = None) -> Path:
    """Full ingest pipeline for one HUD FMR fiscal-year vintage."""
    if year not in VINTAGE_RELEASE_DATES:
        raise ValueError(
            f"Unknown FMR year {year}. Known: {sorted(VINTAGE_RELEASE_DATES)}"
        )
    as_of = VINTAGE_RELEASE_DATES[year] if as_of_date is None else compute_as_of_date(as_of_date)

    token = _load_hud_token()
    logger.info("Starting HUD FMR ingest (FY%d, as_of=%s)", year, as_of.isoformat())

    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_dl = Path(tmpdir) / f"hud_fmr_{year}.json"
        _download_all_states(token, year, tmp_dl)
        snapshot_raw(SOURCE_NAME, as_of, tmp_dl)
        df_wide = _parse_and_validate(tmp_dl, year)

    clean, quarantined = _normalize_and_partition(df_wide, as_of)
    if not quarantined.empty:
        quarantine(SOURCE_NAME, as_of, quarantined, reason="fips_unknown_or_invalid")
    if clean.empty:
        raise RuntimeError("All rows failed FIPS normalization")

    curated_path = write_curated(SOURCE_NAME, as_of, clean)
    logger.info(
        "HUD FMR FY%d complete: %d clean rows (%d counties), %d quarantined, out=%s",
        year, len(clean), clean["fips"].nunique(),
        len(quarantined), curated_path,
    )
    return curated_path


def _download_all_states(token: str, year: int, dest: Path) -> None:
    """Iterate all 56 states/territories, collect county-level FMR rows.

    Silences httpx URL logging so the bearer token doesn't leak to stdout.
    Small sleep between calls to be polite to the HUD API.
    """
    headers = {"Authorization": f"Bearer {token}"}
    httpx_logger = logging.getLogger("httpx")
    prev_level = httpx_logger.level
    httpx_logger.setLevel(logging.WARNING)

    try:
        # 1. List states.
        r = httpx.get(LIST_STATES_URL, headers=headers, timeout=30.0)
        r.raise_for_status()
        states = json.loads(r.text)
        state_codes = [s["state_code"] for s in states]
        logger.info("Fetching FMR for %d states/territories", len(state_codes))

        # 2. Pull each state's county rows.
        all_counties: list[dict] = []
        for i, code in enumerate(state_codes, 1):
            url = FMR_STATE_URL.format(state=code, year=year)
            try:
                r = httpx.get(url, headers=headers, timeout=30.0)
                r.raise_for_status()
                data = json.loads(r.text).get("data", {})
                counties = data.get("counties", [])
                for row in counties:
                    row["_state_code"] = code
                all_counties.extend(counties)
            except httpx.HTTPError as e:
                logger.warning("State %s failed: %s", code, e)
                continue
            if i % 10 == 0:
                logger.info("  %d/%d states fetched (%d counties so far)",
                            i, len(state_codes), len(all_counties))
            time.sleep(0.05)  # polite pacing
    finally:
        httpx_logger.setLevel(prev_level)

    dest.write_text(json.dumps(all_counties))
    logger.info("Fetched %d county-FMR rows total, wrote to %s", len(all_counties), dest)


def _parse_and_validate(source_file: Path, year: int) -> pd.DataFrame:
    """Parse consolidated JSON into DataFrame; extract 5-digit FIPS from
    HUD's 10-digit fips_code (state+county+trailing padding)."""
    rows = json.loads(source_file.read_text())
    if not rows:
        raise ValueError(f"HUD FMR response for {year} has 0 rows")

    df = pd.DataFrame(rows)
    logger.info("Parsed %d county FMR rows for FY%d", len(df), year)

    required = {"fips_code", "county_name", "Two-Bedroom"}
    missing = required - set(df.columns)
    if missing:
        raise ValueError(f"HUD FMR response missing columns: {missing}")

    # HUD fips_code is 10 chars: state(2) + county(3) + 5-char padding.
    # Real 5-digit FIPS = first 5 chars.
    df["fips_raw"] = df["fips_code"].str[:5]

    # Coerce bedroom rents to numeric. Missing = NaN.
    for col in ("Efficiency", "One-Bedroom", "Two-Bedroom", "Three-Bedroom", "Four-Bedroom"):
        df[col] = pd.to_numeric(df.get(col), errors="coerce")

    # Rename for tidy snake_case column names.
    df = df.rename(columns={
        "Efficiency": "fmr_0br",
        "One-Bedroom": "fmr_1br",
        "Two-Bedroom": "fmr_2br",
        "Three-Bedroom": "fmr_3br",
        "Four-Bedroom": "fmr_4br",
        "metro_name": "fmr_area_name",
        "FMR Percentile": "fmr_percentile",
    })

    # HUD FMR effective for federal fiscal year. FY2026 covers Oct 2025 -
    # Sep 2026, midpoint April 2026. Store period_end as Sep 30 of the FY.
    df["period_end_date"] = date(year, 9, 30)

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
        "fmr_0br", "fmr_1br", "fmr_2br", "fmr_3br", "fmr_4br",
        "fmr_percentile",
        "county_name", "fmr_area_name",
        "_fips_remap_flag",
    ]
    clean = clean[[c for c in keep_cols if c in clean.columns]]

    dupes = clean.duplicated(subset=["fips", "period_end_date"]).sum()
    if dupes:
        logger.warning("Deduping %d (fips, period) duplicates from remaps", dupes)
        clean = clean.drop_duplicates(subset=["fips", "period_end_date"], keep="first")

    logger.info(
        "FIPS normalization: %d clean, %d quarantined",
        len(clean), len(quarantined),
    )
    return clean, quarantined


def _main() -> None:
    parser = argparse.ArgumentParser(description="Ingest HUD Fair Market Rents (county-level)")
    parser.add_argument(
        "--year", type=int, default=LATEST_YEAR,
        choices=sorted(VINTAGE_RELEASE_DATES),
        help=f"HUD FMR fiscal year (default: {LATEST_YEAR})",
    )
    parser.add_argument(
        "--all", action="store_true",
        help="Load all known FMR years (default: latest only)",
    )
    parser.add_argument(
        "--as-of", type=date.fromisoformat, default=None,
        help="Override as_of_date. Default: vintage release date (Oct of previous year).",
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
