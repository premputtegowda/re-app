"""Census PEP (Population Estimates Program) loader — county-level, annual.

Source: US Census Bureau (public domain).
    https://www.census.gov/programs-surveys/popest/data.html

Publishes annual county-level population estimates + components of change:
- POPESTIMATE — total population at July 1 of the year
- BIRTHS, DEATHS, NATURALCHG — natural population change
- INTERNATIONALMIG — net international migration
- DOMESTICMIG — **net domestic migration** ← Tier 1 signal (framework)
- NETMIG — international + domestic

Also captures birth/death separation so the "aging trap" disqualifier
(population declining despite positive migration = deaths > births) is
computable.

**Vintage note.** PEP publishes annual "vintages" — each vintage restates
prior years' estimates. Loading the LATEST vintage (2025 as of 2026-08)
gives us 2020-2025 with the most current revisions. Pre-2020 data requires
loading earlier vintages (2019 for 2010-2019, etc.); deferred to a later
pass since 2020-2025 alone gives us enough history for the framework's
"3-year accelerating migration" feature and Phase 3 backtest.

**period_end_date convention.** PEP estimates are "as of July 1" of each
year. We store this as July 1 in the bitemporal schema.

Run: `uv run python -m ingest.census_pep`
"""

from __future__ import annotations

import argparse
import logging
import re
import tempfile
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

SOURCE_NAME = "census_pep"

# PEP publishes annual "vintages" — each restates prior years' estimates
# using the latest methodology. To build multi-decade history we load
# multiple vintages under different as_of_date values (bitemporal schema
# preserves each vintage's point-in-time view).
#
# Vintage → decade span mapping. URL pattern:
#   https://www2.census.gov/programs-surveys/popest/datasets/{start}-{end}/counties/totals/co-est{end}-alldata.csv
LATEST_VINTAGE = 2025

# Known PEP vintage release dates. Used as default as_of_date when loading a
# specific vintage — reflects when the data was actually publicly available,
# which is what the bitemporal schema requires (no look-ahead bias).
# Source: Census Bureau release calendars.
VINTAGE_RELEASE_DATES: dict[int, date] = {
    2019: date(2020, 3, 26),   # V2019 — final pre-decennial vintage
    2020: date(2021, 5, 4),    # V2020 — delayed by 2020 Census
    2021: date(2022, 3, 24),
    2022: date(2023, 3, 30),
    2023: date(2024, 3, 14),
    2024: date(2025, 3, 20),
    2025: date(2026, 3, 13),
}

# Metrics we extract per year — one column per metric per year in the source.
# Skipping ESTIMATESBASE* (starting-point-only), CENSUS*POP (decennial anchor),
# and RESIDUAL (statistical reconciliation, not a substantive signal).
# NATURALCHG (V2020+) and NATURALINC (V2019 and earlier) are the same
# quantity (births − deaths); we normalize both to `naturalchg` in output.
METRIC_STEMS = (
    "POPESTIMATE",       # total population
    "NPOPCHG",           # net population change
    "BIRTHS",
    "DEATHS",
    "NATURALCHG",        # V2020+ name for births − deaths
    "NATURALINC",        # V2019− name for the same quantity
    "INTERNATIONALMIG",
    "DOMESTICMIG",       # ← Tier 1 signal
    "NETMIG",            # international + domestic
)

# Older vintages (V2019 and earlier) name the yearly-change columns with an
# underscore: NPOPCHG_2010, NBIRTHS_2010. Newer vintages drop the underscore.
# The optional `_?` accommodates both without splitting the loader in two.
METRIC_COLUMN_RE = re.compile(r"^(" + "|".join(METRIC_STEMS) + r")_?(\d{4})$")

# Rename map applied after melt so both vintages produce identically-named
# columns in the curated Parquet.
METRIC_ALIASES = {"naturalinc": "naturalchg"}

# SUMLEV = 50 → county-level rows. Other values are national (10), regional
# (20), state (40) aggregates that we don't want in the county universe.
COUNTY_SUMLEV = 50


def _vintage_url(vintage: int) -> str:
    """Build the source CSV URL for a given PEP vintage year."""
    # V2019 and earlier belong to the 2010-decade file layout;
    # V2020+ belong to the 2020-decade layout.
    start = 2010 if vintage <= 2019 else 2020
    return (
        "https://www2.census.gov/programs-surveys/popest/datasets/"
        f"{start}-{vintage}/counties/totals/co-est{vintage}-alldata.csv"
    )


def load(vintage: int = LATEST_VINTAGE, as_of_date: date | None = None) -> Path:
    """Full ingest pipeline for a single Census PEP vintage.

    When loading an older vintage as a historical backfill, `as_of_date`
    defaults to the vintage's actual release date so the bitemporal schema
    correctly reflects when the data was publicly available. Callers can
    override via the `as_of_date` arg (e.g. for a "re-snapshot today"
    workflow that treats the historical file as freshly downloaded).

    Returns path to the curated Parquet file.
    """
    if vintage not in VINTAGE_RELEASE_DATES:
        raise ValueError(
            f"Unknown PEP vintage {vintage}. Known vintages: "
            f"{sorted(VINTAGE_RELEASE_DATES)}"
        )
    if as_of_date is None:
        as_of = VINTAGE_RELEASE_DATES[vintage]
    else:
        as_of = compute_as_of_date(as_of_date)

    url = _vintage_url(vintage)
    logger.info(
        "Starting Census PEP ingest (vintage=V%d, as_of_date=%s, url=%s)",
        vintage, as_of.isoformat(), url,
    )

    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_dl = Path(tmpdir) / f"co-est{vintage}-alldata.csv"
        download(url, tmp_dl)
        snapshot_raw(SOURCE_NAME, as_of, tmp_dl)
        df_wide = _parse_and_validate(tmp_dl)

    df_long = _melt_to_long(df_wide)
    clean, quarantined = _normalize_and_partition(df_long, as_of)
    if not quarantined.empty:
        quarantine(SOURCE_NAME, as_of, quarantined, reason="fips_unknown_or_invalid")

    if clean.empty:
        raise RuntimeError("All rows failed FIPS normalization — check crosswalk and source URL")

    curated_path = write_curated(SOURCE_NAME, as_of, clean)
    logger.info(
        "Census PEP ingest complete: %d clean rows (%d counties, %d years), "
        "%d quarantined, out=%s",
        len(clean),
        clean["fips"].nunique(),
        clean["period_end_date"].nunique(),
        len(quarantined),
        curated_path,
    )
    return curated_path


def _parse_and_validate(source_file: Path) -> pd.DataFrame:
    """Read CSV, filter to county rows, keep FIPS parts as strings.

    Census files are ASCII with occasional Latin-1 characters in county
    names ("Doña Ana County, NM"). Use latin-1 to avoid decode errors —
    the numeric data we care about is ASCII and unaffected.
    """
    df = pd.read_csv(
        source_file,
        encoding="latin-1",
        dtype={"STATE": str, "COUNTY": str, "SUMLEV": int},
    )
    logger.info("Parsed %d rows from Census PEP (all summary levels)", len(df))

    required_cols = {"SUMLEV", "STATE", "COUNTY", "STNAME", "CTYNAME"}
    missing = required_cols - set(df.columns)
    if missing:
        raise ValueError(
            f"Census PEP schema drift — missing columns: {missing}. "
            f"Got sample: {list(df.columns)[:10]}"
        )

    # Filter to county-level rows only. State/national aggregates would
    # break FIPS normalization (COUNTY='000' for state rollups).
    county_df = df[df["SUMLEV"] == COUNTY_SUMLEV].copy()
    logger.info(
        "Filtered to %d county rows (dropped %d aggregate rows)",
        len(county_df), len(df) - len(county_df),
    )

    # Check at least one metric column exists (schema drift check).
    metric_cols = [c for c in county_df.columns if METRIC_COLUMN_RE.match(c)]
    if not metric_cols:
        raise ValueError(
            f"Census PEP has no columns matching {METRIC_STEMS} with year suffix — "
            "URL may be pointing at a different file, or Census changed the schema."
        )
    logger.info("Found %d metric columns (across %d metric stems)", len(metric_cols), len(METRIC_STEMS))

    return county_df


def _melt_to_long(df_wide: pd.DataFrame) -> pd.DataFrame:
    """Reshape wide (columns = metric+year) → long (fips, year, metric).

    Then pivot back to wide-by-metric (one row per fips+year, one col per
    metric) — much more useful downstream than a purely tall table.

    Output columns: fips_raw, period_end_date, state, county_name, +
                    one column per METRIC_STEMS entry (lowercased).
    """
    # Build FIPS = STATE (2ch, zero-padded) + COUNTY (3ch, zero-padded)
    df_wide = df_wide.copy()
    df_wide["fips_raw"] = df_wide["STATE"].str.zfill(2) + df_wide["COUNTY"].str.zfill(3)

    metric_cols = [c for c in df_wide.columns if METRIC_COLUMN_RE.match(c)]
    id_vars = ["fips_raw", "STATE", "STNAME", "CTYNAME"]

    # Two-step melt-then-pivot for a wide-by-metric layout:
    tall = df_wide.melt(
        id_vars=id_vars,
        value_vars=metric_cols,
        var_name="metric_year",
        value_name="value",
    )
    # Split "POPESTIMATE2020" → metric="popestimate", year=2020
    extract = tall["metric_year"].str.extract(METRIC_COLUMN_RE)
    tall["metric"] = extract[0].str.lower().replace(METRIC_ALIASES)
    tall["year"] = extract[1].astype(int)
    tall = tall.drop(columns=["metric_year"])

    # Pivot back: one row per (fips, year), one column per metric.
    wide = tall.pivot_table(
        index=id_vars + ["year"],
        columns="metric",
        values="value",
        aggfunc="first",
    ).reset_index()
    wide.columns.name = None

    # PEP estimates are "as of July 1" of the year.
    wide["period_end_date"] = pd.to_datetime(
        wide["year"].astype(str) + "-07-01", errors="coerce"
    ).dt.date
    wide = wide.rename(columns={"STNAME": "state_name", "CTYNAME": "county_name", "STATE": "state_fips"})

    # Drop the state_fips column (redundant with fips_raw); keep state_name
    wide = wide.drop(columns=["state_fips"])

    logger.info(
        "Melted+pivoted to %d rows (%d counties × %d years)",
        len(wide), wide["fips_raw"].nunique(), wide["year"].nunique(),
    )
    return wide


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
        # Metric columns (lowercased METRIC_STEMS)
        "popestimate", "npopchg",
        "births", "deaths", "naturalchg",
        "internationalmig", "domesticmig", "netmig",
        # Metadata
        "state_name", "county_name",
        "_fips_remap_flag",
    ]
    # Some metric columns might be missing if source omits them (defensive).
    keep_cols = [c for c in keep_cols if c in clean.columns]
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
    parser = argparse.ArgumentParser(description="Ingest Census PEP county population + migration")
    parser.add_argument(
        "--vintage", type=int, default=LATEST_VINTAGE,
        choices=sorted(VINTAGE_RELEASE_DATES),
        help=f"PEP vintage year (default: {LATEST_VINTAGE}). Older vintages "
             "provide pre-2020 history under their release-date as_of.",
    )
    parser.add_argument(
        "--as-of", type=date.fromisoformat, default=None,
        help="Override as_of_date (YYYY-MM-DD). Default: vintage's release date "
             "(preserves bitemporal correctness for historical backfills).",
    )
    parser.add_argument("--verbose", "-v", action="store_true", help="DEBUG-level logging")
    args = parser.parse_args()

    configure_logging(logging.DEBUG if args.verbose else logging.INFO)
    load(vintage=args.vintage, as_of_date=args.as_of)


if __name__ == "__main__":
    _main()
