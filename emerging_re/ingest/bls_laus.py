"""BLS LAUS (Local Area Unemployment Statistics) loader — county-level, monthly.

Source: US Bureau of Labor Statistics (public domain, no auth required).
    https://download.bls.gov/pub/time.series/la/

LAUS measures unemployment rate, unemployment count, employment count, and
labor force at multiple geographies. We pull county-level monthly
unemployment RATE (measure code 03) — the direct MF-relevant tenant
payment risk signal that our current framework doesn't capture from
QCEW (which gives employment levels, not unemployment rates).

**File format.** BLS publishes bulk time-series files at
`download.bls.gov/pub/time.series/la/`. `la.data.64.County` contains all
county-level series (all measures, all years, all months) — 337MB
uncompressed with ~5M rows. We filter to measure_code=03 (unemployment
rate) which drops it to ~1.3M rows.

**Series ID format.** 20 chars: `LAUCN{fips_5}{padding_9}{measure_1}`
  Example: `LAUCN010010000000003` = Autauga County AL (FIPS 01001) unemployment rate
  - LAU = series prefix
  - CN  = county area type
  - 5 digits = state (2) + county (3) FIPS
  - 9-char padding
  - 1 digit = measure code (3 = unemployment rate)

**Data note.** Rates are published monthly with ~3 week lag. Latest data
today (Aug 2026) covers July 2026. Historical goes back to 1990. We
compute per-fips latest rate + YoY change (12mo delta).

**User-Agent requirement.** BLS blocks requests without a browser-like
User-Agent header. We set one identifying the loader.

Run: `uv run python -m ingest.bls_laus`
"""

from __future__ import annotations

import argparse
import io
import logging
import re
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

SOURCE_NAME = "bls_laus"

LAUS_URL = "https://download.bls.gov/pub/time.series/la/la.data.64.County"
# BLS requires a browser-like User-Agent or returns 403.
HTTP_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X) "
        "emerging-re-loader/1.0 (research@example.com)"
    ),
}

# Series ID = 20 chars: LAUCN + 5-digit FIPS + 8 chars zero-padding + 2-digit measure code.
# Example: LAUCN010010000000003 = LAUCN + 01001 + 00000000 + 03 (unemployment rate).
# Trailing whitespace common in BLS pipe-delim files.
SERIES_RE = re.compile(r"^LAUCN(\d{5})\d{8}(\d{2})\s*$")


def load(as_of_date: date | None = None) -> Path:
    """Full ingest pipeline for BLS LAUS county unemployment rate.

    Writes FULL monthly history per county (~1.4M rows since 1990).
    Downstream dbt (int_unemployment_features) computes derived features
    like YoY change per period — needs full history so historical
    backtest can look up unemployment at each scoring date without
    look-ahead bias.
    """
    as_of = compute_as_of_date(as_of_date)
    logger.info("Starting BLS LAUS ingest (as_of=%s)", as_of.isoformat())

    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_dl = Path(tmpdir) / "la.data.64.County"
        _download(LAUS_URL, tmp_dl)
        snapshot_raw(SOURCE_NAME, as_of, tmp_dl)
        df_long = _parse_and_filter(tmp_dl)

    clean, quarantined = _normalize_and_partition(df_long, as_of)
    if not quarantined.empty:
        quarantine(SOURCE_NAME, as_of, quarantined, reason="fips_unknown_or_invalid")

    if clean.empty:
        raise RuntimeError("All rows failed FIPS normalization")

    curated_path = write_curated(SOURCE_NAME, as_of, clean)
    logger.info(
        "BLS LAUS ingest complete: %d clean rows (%d counties), %d quarantined, out=%s",
        len(clean), clean["fips"].nunique(),
        len(quarantined), curated_path,
    )
    return curated_path


def _download(url: str, dest: Path) -> None:
    """Download the 337MB county file with proper UA."""
    logger.info("Downloading BLS LAUS county file (~337MB)...")
    with httpx.stream("GET", url, headers=HTTP_HEADERS, timeout=180.0, follow_redirects=True) as r:
        r.raise_for_status()
        total_bytes = 0
        with dest.open("wb") as f:
            for chunk in r.iter_bytes(chunk_size=1024 * 1024):
                f.write(chunk)
                total_bytes += len(chunk)
                if total_bytes % (50 * 1024 * 1024) < len(chunk):
                    logger.info("  %d MB downloaded...", total_bytes // (1024 * 1024))
    logger.info("Downloaded %d bytes to %s", total_bytes, dest)


def _parse_and_filter(source_file: Path) -> pd.DataFrame:
    """Parse the tab-delimited file, filter to unemployment rate rows only.

    Each row: series_id \\t year \\t period \\t value \\t footnote_codes
    period is 'MXX' where XX is 01-12 (monthly) or 13 (annual).
    """
    # Read all rows. Fixed-column TSV with header.
    df = pd.read_csv(
        source_file,
        sep="\t",
        dtype={"series_id": str, "year": int, "period": str, "value": str, "footnote_codes": str},
        na_values=["-", "  "],
        skipinitialspace=True,
    )
    # Strip whitespace from series_id (BLS pipe format has trailing spaces).
    df.columns = [c.strip() for c in df.columns]
    df["series_id"] = df["series_id"].str.strip()
    df["period"] = df["period"].str.strip()
    logger.info("Parsed %d total rows from la.data.64.County", len(df))

    # Extract FIPS + measure code from series_id.
    extracted = df["series_id"].str.extract(SERIES_RE)
    extracted.columns = ["fips_raw", "measure_code"]
    df = pd.concat([df, extracted], axis=1)

    # Filter to unemployment rate (measure_code=03) + monthly (M01-M12) rows only.
    df = df[(df["measure_code"] == "03") & df["period"].str.match(r"^M(0[1-9]|1[012])$")]
    logger.info("Filtered to %d unemployment-rate monthly rows", len(df))

    # Coerce value to numeric (BLS sometimes has spaces).
    df["value"] = pd.to_numeric(df["value"], errors="coerce")
    df = df.dropna(subset=["value"])

    # Build period_end_date = last day of the M{mm} month in {year}.
    df["month"] = df["period"].str[1:].astype(int)
    date_strs = df["year"].astype(str) + "-" + df["month"].astype(str).str.zfill(2) + "-01"
    df["period_end_date"] = (pd.to_datetime(date_strs, errors="coerce")
                             + pd.offsets.MonthEnd(0)).dt.date

    keep = df[["fips_raw", "period_end_date", "value"]].rename(columns={"value": "unemployment_rate"})
    logger.info("Prepared %d unemployment-rate rows across %d counties",
                len(keep), keep["fips_raw"].nunique())
    return keep


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
        "unemployment_rate",
        "_fips_remap_flag",
    ]
    clean = clean[keep_cols]

    dupes = clean.duplicated(subset=["fips", "period_end_date"]).sum()
    if dupes:
        logger.warning("Deduping %d (fips, period) duplicates", dupes)
        clean = clean.drop_duplicates(subset=["fips", "period_end_date"], keep="first")

    logger.info("FIPS normalization: %d clean, %d quarantined",
                len(clean), len(quarantined))
    return clean, quarantined


def _main() -> None:
    parser = argparse.ArgumentParser(description="Ingest BLS LAUS county unemployment rates")
    parser.add_argument(
        "--as-of", type=date.fromisoformat, default=None,
        help="Override as_of_date. Default: today UTC.",
    )
    parser.add_argument("--verbose", "-v", action="store_true", help="DEBUG logging")
    args = parser.parse_args()

    configure_logging(logging.DEBUG if args.verbose else logging.INFO)
    load(as_of_date=args.as_of)


if __name__ == "__main__":
    _main()
