"""FRED macro data loader — national-level series for MF cycle regime.

Source: FRED (Federal Reserve Bank of St. Louis) public CSV downloads.
    https://fred.stlouisfed.org/graph/fredgraph.csv?id={series_id}
No auth required for basic time series.

Series pulled (all daily or monthly, we sample at year-end for annual
regime classification):
    DGS10       — 10-year Treasury yield (%)
    DGS2        — 2-year Treasury yield (%)
    T10Y2Y      — 10yr − 2yr spread (%) — yield curve inversion signal
    FEDFUNDS    — Effective Fed Funds Rate (%)
    CPIAUCSL    — CPI All Urban Consumers, index (base 1982-84=100)
    UNRATE      — Civilian unemployment rate (%)
    MORTGAGE30US — 30-year fixed mortgage rate (%)

**Not fips-keyed** — this data is national. Written to a custom-schema
Parquet at data/curated/fred_macro/fred_macro.parquet with one row per
(observation_date, series_id) in LONG format. Downstream dbt models
pivot to wide + resample to year-end.

Run: `uv run python -m ingest.fred_macro`
    or override end date: `uv run python -m ingest.fred_macro --end 2024-12-31`
"""

from __future__ import annotations

import argparse
import logging
from datetime import date, datetime, UTC
from pathlib import Path

import httpx
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

from ingest._common import CURATED_ROOT, RAW_ROOT, configure_logging, download

logger = logging.getLogger(__name__)

SOURCE_NAME = "fred_macro"

# Series to pull. Each is a FRED series_id.
SERIES = {
    "DGS10":        "10-Year Treasury Constant Maturity Rate (%)",
    "DGS2":         "2-Year Treasury Constant Maturity Rate (%)",
    "T10Y2Y":       "10-Year minus 2-Year Treasury spread (%)",
    "FEDFUNDS":     "Effective Federal Funds Rate (%)",
    "CPIAUCSL":     "CPI All Urban Consumers (index)",
    "UNRATE":       "Civilian Unemployment Rate (%)",
    "MORTGAGE30US": "30-Year Fixed Mortgage Rate (%)",
}

FRED_CSV_URL = "https://fred.stlouisfed.org/graph/fredgraph.csv?id={series_id}"


def fetch_series(series_id: str, start_date: date | None = None) -> pd.DataFrame:
    """Fetch one FRED series as CSV. Returns DataFrame with
    (observation_date, value, series_id) columns."""
    url = FRED_CSV_URL.format(series_id=series_id)
    logger.info("GET %s", url)
    r = httpx.get(url, timeout=60.0)
    r.raise_for_status()

    # Parse CSV. First column is observation_date, second is the value
    # (column name equals series_id).
    from io import StringIO
    df = pd.read_csv(StringIO(r.text), parse_dates=["observation_date"])
    if series_id not in df.columns:
        raise ValueError(f"Expected column '{series_id}' not found in FRED CSV: {list(df.columns)}")
    df = df.rename(columns={series_id: "value"})
    df["series_id"] = series_id
    # FRED uses "." as missing-value marker in CSV.
    df["value"] = pd.to_numeric(df["value"], errors="coerce")
    df = df.dropna(subset=["value"])
    if start_date is not None:
        df = df[df["observation_date"] >= pd.Timestamp(start_date)]
    logger.info("  %s: %d observations (%s → %s)",
                series_id, len(df),
                df["observation_date"].min().strftime("%Y-%m-%d"),
                df["observation_date"].max().strftime("%Y-%m-%d"))
    return df[["observation_date", "series_id", "value"]]


def load(end_date: date | None = None) -> Path:
    as_of = end_date or datetime.now(UTC).date()

    logger.info("Fetching %d FRED series", len(SERIES))
    frames = []
    for series_id in SERIES:
        try:
            frames.append(fetch_series(series_id, start_date=date(1990, 1, 1)))
        except Exception as e:
            logger.warning("Failed to fetch %s: %s", series_id, e)

    combined = pd.concat(frames, ignore_index=True)
    logger.info("Combined: %d rows across %d series", len(combined), combined["series_id"].nunique())

    # Write as long-format parquet. Adds as_of_date column for lineage.
    combined["as_of_date"] = as_of
    combined["observation_date"] = pd.to_datetime(combined["observation_date"]).dt.date

    out_dir = CURATED_ROOT / SOURCE_NAME / f"as_of_date={as_of.isoformat()}"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / "data.parquet"

    table = pa.Table.from_pandas(combined, preserve_index=False)
    pq.write_table(table, out_path, compression="zstd")
    logger.info("Wrote %d rows to %s", len(combined), out_path)
    return out_path


def _main() -> None:
    parser = argparse.ArgumentParser(description="Ingest FRED national macro series")
    parser.add_argument("--end", type=date.fromisoformat, default=None,
                        help="Override as_of_date (default: today UTC)")
    parser.add_argument("--verbose", "-v", action="store_true")
    args = parser.parse_args()

    configure_logging(logging.DEBUG if args.verbose else logging.INFO)
    load(end_date=args.end)


if __name__ == "__main__":
    _main()
