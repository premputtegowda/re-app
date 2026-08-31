"""FAA Passenger Boarding (Enplanement) loader — county-level, annual.

Source: FAA Air Carrier Activity database (public data, no auth).
    https://www.faa.gov/airports/planning_capacity/passenger_allcargo_stats/passenger

FAA publishes annual "Commercial Service Enplanements" per airport with
Rank / State / Locid / City / Airport Name / Hub tier (L/M/S/N) /
enplanements for the reporting calendar year + prior year. ~520 rows
per year covering primary commercial + nonprimary commercial service.

**"Next big market" value:** airport traffic is a real-time economic
activity signal. YoY growth outpacing peers = new corporate travel,
population inflow, tourism uptick — all precede real-estate demand by
6-18 months. Especially useful for identifying regional markets before
they're obvious (e.g., BNA Nashville enplanements grew 60%+ 2015-2019
before the tech-migration story went mainstream).

**Airport→county mapping:** FAA files give Locid (e.g., ATL, DFW) but
no lat/lon or FIPS. We build a persistent crosswalk once by joining
Locid → OurAirports lat/lon → FCC Census Block API → county FIPS.
Cached at `data/crosswalks/faa_airport_fips.csv`; only new airports
trigger fresh API lookups on subsequent runs.

**Aggregation:** one county can host multiple airports (e.g., LAX +
BUR + LGB all in LA/Orange counties). We sum enplanements + count
airports + keep the largest hub tier per county.

**Years:** FAA URL patterns changed 3 times (2013-2020, 2021-2023,
2024+) — hardcoded per-year in `YEAR_URLS`. Loaded CY2019-CY2025
(preliminary). Extendable back to CY2000 if needed.

Run: `uv run python -m ingest.faa_enplanements`         # latest year
     `uv run python -m ingest.faa_enplanements --year 2022`
     `uv run python -m ingest.faa_enplanements --all`   # all vintages
"""

from __future__ import annotations

import argparse
import csv
import logging
import tempfile
import time
from datetime import date
from pathlib import Path

import httpx
import pandas as pd

from crosswalks.normalize_fips import normalize_fips_series
from ingest._common import (
    CROSSWALKS_ROOT,
    compute_as_of_date,
    configure_logging,
    download,
    quarantine,
    snapshot_raw,
    write_curated,
)

logger = logging.getLogger(__name__)

SOURCE_NAME = "faa_enplanements"

# FAA URL patterns changed over time — hardcoded per year to survive schema
# drift. Add newer years as they publish (~August of following year for final,
# ~June for preliminary).
YEAR_URLS: dict[int, str] = {
    2019: "https://www.faa.gov/sites/faa.gov/files/airports/planning_capacity/passenger_allcargo_stats/passenger/cy19-commercial-service-enplanements.xlsx",
    2020: "https://www.faa.gov/sites/faa.gov/files/airports/planning_capacity/passenger_allcargo_stats/passenger/cy20-commercial-service-enplanements.xlsx",
    2021: "https://www.faa.gov/sites/faa.gov/files/2022-09/cy21-commercial-service-enplanements.xlsx",
    2022: "https://www.faa.gov/sites/faa.gov/files/2023-09/cy22-commercial-service-enplanements.xlsx",
    2023: "https://www.faa.gov/sites/faa.gov/files/2024-10/cy23-commercial-service-enplanements.xlsx",
    2024: "https://www.faa.gov/airports/planning_capacity/passenger_allcargo_stats/passenger/arp-cy2024-commercial-service-enplanements.xlsx",
    2025: "https://www.faa.gov/airports/planning_capacity/passenger_allcargo_stats/passenger/arp-cy2025-commercial-service-enplanements-preliminary.xlsx",
}

# FAA typically releases final data ~August of the following year.
# Approximate release dates (used as as_of_date for bitemporal snapshot).
YEAR_RELEASE_DATES: dict[int, date] = {
    2019: date(2020, 3, 1),
    2020: date(2021, 8, 1),
    2021: date(2022, 9, 1),
    2022: date(2023, 9, 1),
    2023: date(2024, 10, 1),
    2024: date(2025, 9, 15),
    2025: date(2026, 7, 8),  # preliminary
}

LATEST_YEAR = 2025

OURAIRPORTS_URL = "https://davidmegginson.github.io/ourairports-data/airports.csv"
FCC_CENSUS_URL = "https://geo.fcc.gov/api/census/area"

CROSSWALK_PATH = CROSSWALKS_ROOT / "faa_airport_fips.csv"


def load(year: int = LATEST_YEAR, as_of_date: date | None = None) -> Path:
    """Full ingest pipeline for one FAA CY enplanements vintage."""
    if year not in YEAR_URLS:
        raise ValueError(f"No URL configured for CY{year}. Known: {sorted(YEAR_URLS)}")
    as_of = YEAR_RELEASE_DATES[year] if as_of_date is None else compute_as_of_date(as_of_date)

    logger.info("Starting FAA enplanements ingest (CY%d, as_of=%s)", year, as_of.isoformat())

    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_xlsx = Path(tmpdir) / f"faa_cy{year}.xlsx"
        download(YEAR_URLS[year], tmp_xlsx)
        snapshot_raw(SOURCE_NAME, as_of, tmp_xlsx)
        df_airports = _parse_xlsx(tmp_xlsx, year)

    airport_to_fips = _build_or_update_crosswalk(df_airports["locid"].unique().tolist())
    df_airports["fips_raw"] = df_airports["locid"].map(airport_to_fips)

    df_county = _aggregate_to_county(df_airports, year)

    clean, quarantined = _normalize_and_partition(df_county, as_of)
    if not quarantined.empty:
        quarantine(SOURCE_NAME, as_of, quarantined, reason="fips_unknown_or_invalid")
    if clean.empty:
        raise RuntimeError("All rows failed FIPS normalization")

    curated_path = write_curated(SOURCE_NAME, as_of, clean)
    logger.info(
        "FAA enplanements CY%d complete: %d clean rows (%d counties), %d quarantined, out=%s",
        year, len(clean), clean["fips"].nunique(),
        len(quarantined), curated_path,
    )
    return curated_path


def _parse_xlsx(xlsx_path: Path, year: int) -> pd.DataFrame:
    """Parse FAA xlsx. Column names include the 2-digit year (e.g. 'CY 24
    Enplanements') so we resolve them dynamically."""
    df = pd.read_excel(xlsx_path, sheet_name=0)
    yy = year % 100
    enp_col = f"CY {yy:02d} Enplanements"
    if enp_col not in df.columns:
        # Try alternate spellings (some years have no leading zero space).
        candidates = [c for c in df.columns if "Enplanements" in c and f"{yy}" in c]
        if not candidates:
            raise ValueError(f"Cannot find enplanements column for CY{year}. Cols: {list(df.columns)}")
        enp_col = candidates[0]

    # Filter to rows with valid Locid + enplanements (drops footer rows).
    df = df[df["Locid"].notna() & df[enp_col].notna()].copy()
    df["enplanements"] = pd.to_numeric(df[enp_col], errors="coerce")
    df = df[df["enplanements"] > 0]

    out = pd.DataFrame({
        "locid": df["Locid"].astype(str).str.strip().str.upper(),
        "state": df["ST"].astype(str).str.strip(),
        "city": df["City"].astype(str).str.strip(),
        "airport_name": df["Airport Name"].astype(str).str.strip(),
        "service_level": df["S/L"].astype(str).str.strip(),
        "hub_tier": df["Hub"].fillna("").astype(str).str.strip(),
        "enplanements": df["enplanements"].astype(int),
    })
    logger.info("Parsed %d airport rows for CY%d", len(out), year)
    return out


def _build_or_update_crosswalk(locids: list[str]) -> dict[str, str]:
    """Return {locid: fips_5digit}. Loads existing crosswalk from disk; for
    any locids not yet mapped, resolves via OurAirports lat/lon → FCC API
    and appends. Persistent so repeat runs skip network calls."""
    existing: dict[str, str] = {}
    if CROSSWALK_PATH.exists():
        with CROSSWALK_PATH.open() as f:
            reader = csv.DictReader(f)
            for row in reader:
                if row.get("fips"):
                    existing[row["locid"]] = row["fips"]
        logger.info("Loaded %d existing airport→fips mappings from crosswalk", len(existing))

    missing = [lid for lid in locids if lid not in existing]
    if not missing:
        logger.info("Crosswalk covers all %d airports, no API calls needed", len(locids))
        return existing

    logger.info("Resolving %d new airports via OurAirports + FCC API", len(missing))

    # Fetch OurAirports lat/lon for missing locids.
    oa_df = pd.read_csv(OURAIRPORTS_URL, low_memory=False)
    oa_us = oa_df[oa_df["iso_country"] == "US"].copy()

    # FAA Locid matches OurAirports local_code (preferred) or ident.
    # Rank airport types so we prefer the "biggest" match when a code has
    # duplicates (e.g., a large_airport and a heliport share the same code).
    type_rank = {
        "large_airport": 5, "medium_airport": 4, "small_airport": 3,
        "seaplane_base": 2, "heliport": 1, "balloonport": 0, "closed": -1,
    }
    oa_us["_type_rank"] = oa_us["type"].map(type_rank).fillna(0)
    oa_us = oa_us.sort_values("_type_rank", ascending=False)

    def _build_lookup(col: str) -> dict[str, dict[str, float]]:
        sub = oa_us.dropna(subset=[col]).copy()
        sub["_key"] = sub[col].astype(str).str.upper()
        sub = sub.drop_duplicates(subset=["_key"], keep="first")
        return sub.set_index("_key")[["latitude_deg", "longitude_deg"]].to_dict("index")

    local_lookup = _build_lookup("local_code")
    ident_lookup = _build_lookup("ident")
    iata_lookup = _build_lookup("iata_code")

    resolved: dict[str, str] = {}
    unresolved: list[str] = []

    # httpx logger prints request URLs at INFO — mute during the batch to
    # avoid drowning the log.
    httpx_logger = logging.getLogger("httpx")
    prev_level = httpx_logger.level
    httpx_logger.setLevel(logging.WARNING)

    try:
        for i, locid in enumerate(missing, 1):
            coords = (
                local_lookup.get(locid)
                or ident_lookup.get(locid)
                or ident_lookup.get(f"K{locid}")  # ICAO prefix for lower-48
                or iata_lookup.get(locid)
            )
            if not coords:
                unresolved.append(locid)
                continue

            try:
                r = httpx.get(
                    FCC_CENSUS_URL,
                    params={
                        "lat": coords["latitude_deg"],
                        "lon": coords["longitude_deg"],
                        "censusYear": "2020",
                        "format": "json",
                    },
                    timeout=15.0,
                )
                r.raise_for_status()
                data = r.json()
                results = data.get("results", [])
                if results and results[0].get("county_fips"):
                    resolved[locid] = results[0]["county_fips"]
                else:
                    unresolved.append(locid)
            except httpx.HTTPError as e:
                logger.warning("FCC API failed for %s: %s", locid, e)
                unresolved.append(locid)

            if i % 25 == 0:
                logger.info("  %d/%d resolved (%d unresolved so far)",
                            i, len(missing), len(unresolved))
            time.sleep(0.05)  # polite pacing
    finally:
        httpx_logger.setLevel(prev_level)

    # Append to crosswalk file (create with header if new).
    CROSSWALK_PATH.parent.mkdir(parents=True, exist_ok=True)
    file_is_new = not CROSSWALK_PATH.exists()
    with CROSSWALK_PATH.open("a", newline="") as f:
        writer = csv.writer(f)
        if file_is_new:
            writer.writerow(["locid", "fips"])
        for locid, fips in resolved.items():
            writer.writerow([locid, fips])
        for locid in unresolved:
            writer.writerow([locid, ""])  # record the miss so we skip re-lookup

    logger.info(
        "Crosswalk update: %d newly resolved, %d unresolved (%s)",
        len(resolved), len(unresolved),
        ", ".join(unresolved[:10]) + (" ..." if len(unresolved) > 10 else ""),
    )

    existing.update(resolved)
    return existing


def _aggregate_to_county(df: pd.DataFrame, year: int) -> pd.DataFrame:
    """Sum enplanements + count airports per county. Keep the largest hub
    tier (L > M > S > N > CS-only) as a categorical signal."""
    # Filter to rows with a resolved FIPS.
    df = df[df["fips_raw"].notna() & (df["fips_raw"] != "")].copy()

    hub_rank = {"L": 4, "M": 3, "S": 2, "N": 1, "": 0}
    df["_hub_rank"] = df["hub_tier"].map(hub_rank).fillna(0)

    agg = (
        df.groupby("fips_raw", as_index=False)
        .agg(
            total_enplanements=("enplanements", "sum"),
            num_airports=("locid", "count"),
            largest_hub_rank=("_hub_rank", "max"),
        )
    )
    rank_to_tier = {4: "Large", 3: "Medium", 2: "Small", 1: "Nonhub", 0: "CS_only"}
    agg["largest_hub_tier"] = agg["largest_hub_rank"].map(rank_to_tier)
    agg = agg.drop(columns=["largest_hub_rank"])
    agg["period_end_date"] = date(year, 12, 31)
    return agg


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
        "total_enplanements", "num_airports", "largest_hub_tier",
        "_fips_remap_flag",
    ]
    clean = clean[[c for c in keep_cols if c in clean.columns]]

    # Multiple locids can normalize to the same fips (via 2020 FIPS remaps);
    # collapse into one row per (fips, period).
    dupes = clean.duplicated(subset=["fips", "period_end_date"]).sum()
    if dupes:
        logger.info("Collapsing %d (fips, period) duplicates from remaps", dupes)
        agg = clean.groupby(["fips", "period_end_date"], as_index=False).agg(
            total_enplanements=("total_enplanements", "sum"),
            num_airports=("num_airports", "sum"),
            largest_hub_tier=("largest_hub_tier", "first"),
            _fips_remap_flag=("_fips_remap_flag", "first"),
        )
        clean = agg

    logger.info(
        "FIPS normalization: %d clean, %d quarantined",
        len(clean), len(quarantined),
    )
    return clean, quarantined


def _main() -> None:
    parser = argparse.ArgumentParser(description="Ingest FAA airport enplanements (county-level)")
    parser.add_argument(
        "--year", type=int, default=LATEST_YEAR,
        choices=sorted(YEAR_URLS),
        help=f"FAA calendar year (default: {LATEST_YEAR})",
    )
    parser.add_argument(
        "--all", action="store_true",
        help="Load all configured years (default: latest only)",
    )
    parser.add_argument(
        "--as-of", type=date.fromisoformat, default=None,
        help="Override as_of_date. Default: approximate FAA release date.",
    )
    parser.add_argument("--verbose", "-v", action="store_true", help="DEBUG logging")
    args = parser.parse_args()

    configure_logging(logging.DEBUG if args.verbose else logging.INFO)
    if args.all:
        for y in sorted(YEAR_URLS):
            load(year=y)
    else:
        load(year=args.year, as_of_date=args.as_of)


if __name__ == "__main__":
    _main()
