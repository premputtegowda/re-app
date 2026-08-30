"""FEMA National Risk Index loader — county-level natural hazard risk.

Source: US Federal Emergency Management Agency (public domain).
    https://www.fema.gov/about/openfema/data-sets/national-risk-index-data

The NRI is FEMA's composite natural-hazard risk index across 18 hazard
types. Per county, it gives:
    - Overall composite risk score (0-100 + rating like "Very High")
    - Expected Annual Loss ($ + score/rating)
    - Community Resilience score (protective factor)
    - Social Vulnerability score
    - Per-hazard scores + ratings for 18 hazards (hurricane, wildfire,
      coastal flood, earthquake, tornado, etc.)

**MF investor value:** the framework has ZERO climate/hazard risk
signals. NRI adds:
    - Coastal Florida = high flood + hurricane risk (insurance $$)
    - California = high wildfire + earthquake risk
    - Gulf Coast = hurricane + coastal flood
    - Midwest = tornado risk
    - Onondaga NY = essentially zero major hazards

Two counties can have identical composite scores + cap rates but VERY
different insurance premium trajectories. FEMA NRI quantifies this.

**Manual-download-required:** FEMA's Akamai WAF blocks all programmatic
access. This loader reads from a manually-downloaded zip at
    data/raw/fema_nri/manual/NRI_Table_Counties.zip
Refresh (rarely needed): download from
    https://www.fema.gov/about/reports-and-data/openfema/nri/v120/NRI_Table_Counties.zip
NRI updates ~annually; a manual refresh once a year is fine.

**Column selection:** the raw CSV has 465 columns (18 hazards × ~15
detail cols each). We keep only:
    - Identity: fips, state, county, population
    - Composite: RISK_SCORE, RISK_RATNG, EAL_SCORE/RATNG, SOVI, RESL
    - Per-hazard: {H}_RISKS score + {H}_RISKR rating for 18 hazards
Total: ~50 output columns.

Run: `uv run python -m ingest.fema_nri`
"""

from __future__ import annotations

import argparse
import logging
import zipfile
from datetime import date
from pathlib import Path

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

SOURCE_NAME = "fema_nri"

# Manual-download location (Akamai WAF blocks programmatic access).
MANUAL_ZIP_PATH = Path(__file__).parent.parent / "data" / "raw" / "fema_nri" / "manual" / "NRI_Table_Counties.zip"
DOWNLOAD_URL = "https://www.fema.gov/about/reports-and-data/openfema/nri/v120/NRI_Table_Counties.zip"

# 18 hazard codes used by NRI. See NRI_HazardInfo.csv in the zip.
HAZARDS = [
    "AVLN",  # Avalanche
    "CFLD",  # Coastal Flooding
    "CWAV",  # Cold Wave
    "DRGT",  # Drought
    "ERQK",  # Earthquake
    "HAIL",  # Hail
    "HWAV",  # Heat Wave
    "HRCN",  # Hurricane
    "ISTM",  # Ice Storm
    "LNDS",  # Landslide
    "LTNG",  # Lightning
    "RFLD",  # Riverine Flooding
    "SWND",  # Strong Wind
    "TRND",  # Tornado
    "TSUN",  # Tsunami
    "VLCN",  # Volcanic Activity
    "WFIR",  # Wildfire
    "WNTW",  # Winter Weather
]

# NRI v1.20 was compiled from data collected 6/2021 - 12/2022, published
# Dec 2025. Use publication date for bitemporal snapshot.
DATA_AS_OF = date(2025, 12, 13)


def load(as_of_date: date | None = None) -> Path:
    """Load FEMA NRI from the manual zip and write curated Parquet."""
    as_of = DATA_AS_OF if as_of_date is None else compute_as_of_date(as_of_date)

    if not MANUAL_ZIP_PATH.exists():
        raise RuntimeError(
            f"FEMA NRI zip not found at {MANUAL_ZIP_PATH}.\n"
            f"Manual download required: FEMA's Akamai WAF blocks programmatic access.\n"
            f"1. In browser, download: {DOWNLOAD_URL}\n"
            f"2. Move to: {MANUAL_ZIP_PATH}\n"
        )

    logger.info("Reading FEMA NRI from %s (as_of=%s)", MANUAL_ZIP_PATH, as_of.isoformat())

    # Snapshot the raw zip under bitemporal partition (idempotent — same
    # file content = same md5, so re-snapshots are noops).
    snapshot_raw(SOURCE_NAME, as_of, MANUAL_ZIP_PATH)

    df = _parse_and_filter(MANUAL_ZIP_PATH)

    clean, quarantined = _normalize_and_partition(df, as_of)
    if not quarantined.empty:
        quarantine(SOURCE_NAME, as_of, quarantined, reason="fips_unknown_or_invalid")
    if clean.empty:
        raise RuntimeError("All rows failed FIPS normalization")

    curated_path = write_curated(SOURCE_NAME, as_of, clean)
    logger.info(
        "FEMA NRI complete: %d clean rows (%d counties), %d quarantined, out=%s",
        len(clean), clean["fips"].nunique(),
        len(quarantined), curated_path,
    )
    return curated_path


def _parse_and_filter(zip_path: Path) -> pd.DataFrame:
    """Read the CSV from the zip, keep only the ~50 columns we need."""
    # Build the column subset we want to KEEP.
    identity_cols = ["STCOFIPS", "STATE", "STATEABBRV", "COUNTY", "COUNTYFIPS",
                      "POPULATION", "BUILDVALUE", "AGRIVALUE", "AREA"]
    composite_cols = [
        "RISK_VALUE", "RISK_SCORE", "RISK_RATNG", "RISK_SPCTL",
        "EAL_SCORE", "EAL_RATNG", "EAL_VALT",
        "SOVI_SCORE", "SOVI_RATNG",
        "RESL_SCORE", "RESL_RATNG",
    ]
    # Per-hazard: just score + rating (skip 13+ detail cols per hazard).
    hazard_cols: list[str] = []
    for h in HAZARDS:
        hazard_cols.extend([f"{h}_RISKS", f"{h}_RISKR", f"{h}_AFREQ"])

    want = identity_cols + composite_cols + hazard_cols

    with zipfile.ZipFile(zip_path) as zf:
        with zf.open("NRI_Table_Counties.csv") as f:
            # Read header first to filter usecols dynamically (skips missing).
            header = pd.read_csv(f, nrows=0, encoding="utf-8-sig").columns.tolist()
        available = [c for c in want if c in header]
        missing = set(want) - set(available)
        if missing:
            logger.warning("Skipping %d columns not in NRI schema: %s",
                            len(missing), sorted(missing)[:5])

        with zf.open("NRI_Table_Counties.csv") as f:
            df = pd.read_csv(
                f,
                usecols=available,
                dtype={"STCOFIPS": str, "STATEFIPS": str, "COUNTYFIPS": str,
                        "STATE": str, "STATEABBRV": str, "COUNTY": str},
                encoding="utf-8-sig",
            )

    logger.info("Parsed %d county rows, %d columns from NRI", len(df), len(df.columns))

    # Rename to snake_case + lowercase for consistency with other loaders.
    rename_map = {c: c.lower() for c in df.columns}
    rename_map["STCOFIPS"] = "fips_raw"
    df = df.rename(columns=rename_map)

    # NRI is a snapshot; there's no natural period_end_date. Use the
    # data collection midpoint (early 2022 per FEMA notes).
    df["period_end_date"] = date(2022, 6, 1)

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

    # Reorder: fips + period first, then everything else.
    lead_cols = ["fips", "period_end_date", "state", "stateabbrv", "county",
                  "population", "_fips_remap_flag"]
    other_cols = [c for c in clean.columns if c not in lead_cols
                    and c not in ("fips_raw", "_fips_remap_note", "countyfips")]
    keep = [c for c in lead_cols + sorted(other_cols) if c in clean.columns]
    clean = clean[keep]

    dupes = clean.duplicated(subset=["fips", "period_end_date"]).sum()
    if dupes:
        logger.warning("Deduping %d (fips, period) duplicates", dupes)
        clean = clean.drop_duplicates(subset=["fips", "period_end_date"], keep="first")

    logger.info("FIPS normalization: %d clean, %d quarantined", len(clean), len(quarantined))
    return clean, quarantined


def _main() -> None:
    parser = argparse.ArgumentParser(description="Ingest FEMA National Risk Index")
    parser.add_argument(
        "--as-of", type=date.fromisoformat, default=None,
        help=f"Override as_of_date. Default: {DATA_AS_OF} (NRI v1.20 pub date).",
    )
    parser.add_argument("--verbose", "-v", action="store_true", help="DEBUG logging")
    args = parser.parse_args()

    configure_logging(logging.DEBUG if args.verbose else logging.INFO)
    load(as_of_date=args.as_of)


if __name__ == "__main__":
    _main()
