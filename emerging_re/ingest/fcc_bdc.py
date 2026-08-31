"""FCC Broadband Data Collection (BDC) loader — county-level, biannual.

Source: US Federal Communications Commission (public data).
    https://broadbandmap.fcc.gov/data-download/nationwide-data

The BDC replaced the old Form 477 in mid-2022. ISPs submit availability at
each Broadband Serviceable Location (BSL) semi-annually (as of June 30 and
December 31 each year). FCC publishes summary rollups by geography (state,
county, CBSA, congressional district) about 5 months after the as-of date.

**MF / "next big market" value:** the framework has no infrastructure
signals. Broadband deployment — especially **residential fiber @ 1 Gbps**
— is a strong LEADING indicator for remote-work migration:
    - ISPs deploy fiber based on projected demand + tax incentives
    - Gigabit fiber precedes remote-worker inflows by 12-24 months
    - Counties transitioning from cable-only to fiber = about to become
      remote-work-viable

**Manual-download-required:** FCC's Akamai WAF blocks all programmatic
access. This loader reads from a manually-downloaded zip under
    data/raw/fcc_bdc/manual/bdc_us_fixed_broadband_summary_by_geography_*.zip
To refresh (every ~6 months):
    1. Browse to https://broadbandmap.fcc.gov/data-download/nationwide-data
    2. Select the latest "As of" date
    3. Download "Fixed Broadband Summary by Geography" (single CSV, ~10 MB zip)
    4. Drop the zip in data/raw/fcc_bdc/manual/ (keep original filename)
    5. Run this loader

**File naming (FCC convention):**
    bdc_us_fixed_broadband_summary_by_geography_{J|D}{YY}_{DDmmYYYY}.zip
    - J25 = June 30, 2025 data as-of
    - D25 = December 31, 2025 data as-of
    - Trailing DDmmYYYY = FCC publication date

**Aggregation:** the summary CSV has ~15 rows per county (5 area types ×
2 biz/res × 8 technologies). We filter to (Total, Residential) and pivot
technology to columns, keeping the two most informative speed thresholds:
    - speed_100_20: current FCC broadband definition (100 down / 20 up)
    - speed_1000_100: gigabit (leading indicator for tech migration)

Run: `uv run python -m ingest.fcc_bdc`
"""

from __future__ import annotations

import argparse
import logging
import re
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

SOURCE_NAME = "fcc_bdc"

MANUAL_DIR = Path(__file__).parent.parent / "data" / "raw" / "fcc_bdc" / "manual"
DOWNLOAD_URL = "https://broadbandmap.fcc.gov/data-download/nationwide-data"

# Filename regex: `bdc_us_fixed_broadband_summary_by_geography_{J|D}{YY}_{DDmmmYYYY}.zip`.
# Group 1 = J|D (June/December), Group 2 = 2-digit year, Group 3 = publish date.
FILENAME_RE = re.compile(
    r"bdc_us_fixed_broadband_summary_by_geography_([JD])(\d{2})_(\d{1,2}[a-z]{3}\d{4})\.zip",
    re.IGNORECASE,
)

# Technologies we surface. "Fiber" alone is the strongest leading signal;
# "Cable/Fiber" is broader coverage; "Any Terrestrial" excludes satellite
# (starlink availability is nearly 100% everywhere and washes out variance).
TECH_KEEP = ("Fiber", "Cable/Fiber", "Any Terrestrial")

# Speed thresholds we surface. FCC redefined "broadband" from 25/3 → 100/20
# in March 2024, so 100/20 is the current standard. Gigabit is the leading
# indicator for new fiber build-outs.
SPEED_KEEP = ("speed_100_20", "speed_1000_100")


def load(zip_path: Path | None = None, as_of_date: date | None = None) -> Path:
    """Full ingest pipeline for one BDC vintage. If `zip_path` is not given,
    picks the newest matching file from `MANUAL_DIR`."""
    if zip_path is None:
        zip_path = _find_latest_zip()
    if not zip_path.exists():
        raise RuntimeError(
            f"BDC zip not found: {zip_path}\n"
            f"Manual download required from {DOWNLOAD_URL}.\n"
            f"Save to {MANUAL_DIR} keeping the original filename."
        )

    parsed = _parse_filename(zip_path.name)
    data_as_of = parsed["data_as_of"]
    as_of = data_as_of if as_of_date is None else compute_as_of_date(as_of_date)

    logger.info(
        "Reading FCC BDC from %s (data as of %s, published %s)",
        zip_path.name, data_as_of.isoformat(), parsed["publish_date"].isoformat(),
    )

    snapshot_raw(SOURCE_NAME, as_of, zip_path)
    df_raw = _read_csv_from_zip(zip_path)
    df_county = _filter_and_pivot(df_raw, data_as_of)

    clean, quarantined = _normalize_and_partition(df_county, as_of)
    if not quarantined.empty:
        quarantine(SOURCE_NAME, as_of, quarantined, reason="fips_unknown_or_invalid")
    if clean.empty:
        raise RuntimeError("All rows failed FIPS normalization")

    curated_path = write_curated(SOURCE_NAME, as_of, clean)
    logger.info(
        "FCC BDC complete: %d clean rows (%d counties), %d quarantined, out=%s",
        len(clean), clean["fips"].nunique(),
        len(quarantined), curated_path,
    )
    return curated_path


def _find_latest_zip() -> Path:
    """Return the newest zip in MANUAL_DIR that matches FCC's filename convention.
    "Newest" = highest data_as_of date parsed from filename."""
    if not MANUAL_DIR.exists():
        raise RuntimeError(f"{MANUAL_DIR} does not exist — create it and add a BDC zip.")
    candidates = [
        (p, _parse_filename(p.name)["data_as_of"])
        for p in MANUAL_DIR.glob("*.zip")
        if FILENAME_RE.match(p.name)
    ]
    if not candidates:
        raise RuntimeError(
            f"No BDC summary-by-geography zips in {MANUAL_DIR}. "
            f"Expected pattern: bdc_us_fixed_broadband_summary_by_geography_*.zip"
        )
    candidates.sort(key=lambda x: x[1], reverse=True)
    return candidates[0][0]


def _parse_filename(name: str) -> dict:
    """Extract data_as_of and publish_date from FCC filename convention."""
    m = FILENAME_RE.match(name)
    if not m:
        raise ValueError(f"Filename does not match FCC BDC convention: {name}")
    letter, yy, pub_str = m.groups()
    year = 2000 + int(yy)
    data_as_of = date(year, 6, 30) if letter.upper() == "J" else date(year, 12, 31)
    publish_date = pd.to_datetime(pub_str, format="%d%b%Y").date()
    return {"data_as_of": data_as_of, "publish_date": publish_date}


def _read_csv_from_zip(zip_path: Path) -> pd.DataFrame:
    with zipfile.ZipFile(zip_path) as zf:
        # There's typically exactly one CSV in the zip.
        csv_names = [n for n in zf.namelist() if n.endswith(".csv")]
        if not csv_names:
            raise ValueError(f"No CSV inside {zip_path}")
        with zf.open(csv_names[0]) as f:
            df = pd.read_csv(f, dtype={"geography_id": str})
    logger.info("Loaded %d rows from %s", len(df), csv_names[0])
    return df


def _filter_and_pivot(df: pd.DataFrame, data_as_of: date) -> pd.DataFrame:
    """Keep (Total, County, Residential, kept-technologies) rows, then pivot
    technology → wide columns. Output: one row per county with fiber /
    cable-or-fiber / terrestrial pct at 100/20 and 1000/100 Mbps."""
    df = df[
        (df["area_data_type"] == "Total")
        & (df["geography_type"] == "County")
        & (df["biz_res"] == "R")
        & (df["technology"].isin(TECH_KEEP))
    ].copy()

    df["fips_raw"] = df["geography_id"].str.zfill(5)

    logger.info(
        "After filter: %d rows across %d counties × %d tech tiers",
        len(df), df["fips_raw"].nunique(), df["technology"].nunique(),
    )

    # Pivot: rows = fips, cols = (tech, speed). Rename to compact snake_case.
    tech_slug = {"Fiber": "fiber", "Cable/Fiber": "cable_fiber", "Any Terrestrial": "terrestrial"}
    speed_slug = {"speed_100_20": "100_20", "speed_1000_100": "1000_100"}

    wide_frames: list[pd.DataFrame] = []
    for tech in TECH_KEEP:
        sub = df[df["technology"] == tech].set_index("fips_raw")[list(SPEED_KEEP) + ["total_units"]]
        sub.columns = [
            *[f"{tech_slug[tech]}_pct_{speed_slug[s]}" for s in SPEED_KEEP],
            "total_units",
        ]
        wide_frames.append(sub)

    wide = pd.concat(wide_frames, axis=1)
    # `total_units` repeats across tech rows for the same county; dedupe.
    wide = wide.loc[:, ~wide.columns.duplicated()]
    wide = wide.reset_index()
    wide["period_end_date"] = data_as_of

    logger.info("Pivoted to %d counties × %d metric cols", len(wide), wide.shape[1] - 2)
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

    lead_cols = ["fips", "period_end_date", "total_units", "_fips_remap_flag"]
    metric_cols = [c for c in clean.columns if c.endswith(("_100_20", "_1000_100"))]
    keep = [c for c in lead_cols + sorted(metric_cols) if c in clean.columns]
    clean = clean[keep]

    dupes = clean.duplicated(subset=["fips", "period_end_date"]).sum()
    if dupes:
        logger.info("Collapsing %d (fips, period) duplicates from remaps", dupes)
        # For remapped duplicates, take the largest total_units (bigger source county).
        clean = (
            clean.sort_values("total_units", ascending=False)
            .drop_duplicates(subset=["fips", "period_end_date"], keep="first")
        )

    logger.info("FIPS normalization: %d clean, %d quarantined", len(clean), len(quarantined))
    return clean, quarantined


def _main() -> None:
    parser = argparse.ArgumentParser(description="Ingest FCC BDC broadband summary (county-level)")
    parser.add_argument(
        "--zip", type=Path, default=None,
        help=f"Path to a specific BDC zip (default: newest in {MANUAL_DIR})",
    )
    parser.add_argument(
        "--as-of", type=date.fromisoformat, default=None,
        help="Override as_of_date. Default: BDC data as-of date (Jun 30 or Dec 31).",
    )
    parser.add_argument("--verbose", "-v", action="store_true", help="DEBUG logging")
    args = parser.parse_args()

    configure_logging(logging.DEBUG if args.verbose else logging.INFO)
    load(zip_path=args.zip, as_of_date=args.as_of)


if __name__ == "__main__":
    _main()
