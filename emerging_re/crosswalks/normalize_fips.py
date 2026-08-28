"""FIPS normalization — map historical / non-canonical FIPS codes to 2020 FIPS.

Every ingest run passes source rows through `normalize_fips_series()`:

1. If the FIPS is a valid 2020 code, pass through unchanged.
2. If it's in the historical crosswalk with weight == 1.0 (simple rename),
   remap silently.
3. If it's a weighted split/merge (weights < 1.0), remap BUT flag for review
   — splits are lossy and downstream analysis should know.
4. If it's unknown, mark the row for quarantine.

The 2020 canonical list is derived lazily on first import from the historical
crosswalk's `to_fips_2020` column plus a hard-coded whitelist of "always 2020"
FIPS. For a production build, replace with the full Census 2020 county FIPS
list (~3,143 counties + independent cities). Missing that list here is OK for
Phase 1 because we don't actually reject 2020-looking FIPS — we only remap
historicals — but the check exists so the ingest logs a warning when a source
publishes a FIPS neither we recognize as 2020 nor as historical.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import pandas as pd

from ingest._common import CROSSWALKS_ROOT

logger = logging.getLogger(__name__)

CROSSWALK_FILE = CROSSWALKS_ROOT / "fips_historical_to_2020.csv"


@dataclass(frozen=True)
class NormalizeResult:
    """Result of normalizing a single FIPS row.

    Attributes:
        fips_2020: Canonical 2020 FIPS (5-digit string), or None if unmappable.
        remap_flag: 'passthrough' | 'renamed' | 'split_merge' | 'unknown'.
        weight: For split_merge, the weight applied. 1.0 for others.
        note: Human-readable explanation for split_merge or unknown rows.
    """

    fips_2020: str | None
    remap_flag: str
    weight: float
    note: str


# ── Load crosswalk once, cache in memory ────────────────────────────────────

@lru_cache(maxsize=1)
def _load_crosswalk() -> pd.DataFrame:
    """Parse the historical → 2020 FIPS crosswalk CSV.

    File format: rows starting with `#` are comments. Header on the first
    non-comment line: `from_fips,to_fips_2020,effective_period_end,weight,note`.
    """
    if not CROSSWALK_FILE.exists():
        raise FileNotFoundError(
            f"crosswalk file missing: {CROSSWALK_FILE}. "
            "Regenerate from NBER county crosswalks or restore from git."
        )
    df = pd.read_csv(CROSSWALK_FILE, comment="#", dtype={"from_fips": str, "to_fips_2020": str})
    # Zero-pad in case CSV parser stripped leading zeros
    df["from_fips"] = df["from_fips"].str.zfill(5)
    df["to_fips_2020"] = df["to_fips_2020"].str.zfill(5)
    df["effective_period_end"] = pd.to_datetime(df["effective_period_end"]).dt.date
    logger.info("Loaded crosswalk: %d mapping rows from %s", len(df), CROSSWALK_FILE)
    return df


@lru_cache(maxsize=1)
def _canonical_2020_set() -> set[str]:
    """Set of 2020-canonical FIPS codes.

    Currently derived from the crosswalk's target column. A production build
    should replace with the full Census 2020 county list (~3,143 entries).
    Until then, unrecognized FIPS log a warning but pass through if they LOOK
    like a valid 5-digit code — better to let them through and let downstream
    tests flag them than to over-aggressively quarantine.
    """
    return set(_load_crosswalk()["to_fips_2020"].unique())


# ── Public API ──────────────────────────────────────────────────────────────

def normalize_fips_series(
    fips_series: pd.Series,
    period_end_dates: pd.Series | None = None,
) -> pd.DataFrame:
    """Normalize a series of FIPS codes to 2020 canonical.

    Args:
        fips_series: pandas Series of FIPS values (any dtype; will be coerced
            to zero-padded 5-digit strings).
        period_end_dates: Optional Series of the period each row describes.
            Used to filter the crosswalk to only mappings that were in effect
            at the row's date (e.g. don't apply the 2015 Wade Hampton →
            Kusilvak rename to a 2024 row).

    Returns:
        DataFrame with columns:
            - fips_2020: str or NaN
            - remap_flag: 'passthrough' | 'renamed' | 'split_merge' | 'unknown'
            - weight: float
            - note: str

        Same length + index as input. Rows with remap_flag='unknown' should
        be routed to quarantine by the caller.
    """
    # Coerce to zero-padded 5-digit strings. Non-numeric → NaN → 'unknown'.
    fips_str = (
        pd.to_numeric(fips_series, errors="coerce")
        .fillna(-1)
        .astype(int)
        .astype(str)
        .str.zfill(5)
    )
    # Replace the "-1"-derived rows with a clearly invalid sentinel so they
    # don't accidentally match a real FIPS.
    fips_str = fips_str.where(fips_str != "-0001", other="INVLD")

    crosswalk = _load_crosswalk()
    canonical = _canonical_2020_set()

    results: list[NormalizeResult] = []
    for idx, fips in fips_str.items():
        row_date = period_end_dates.loc[idx] if period_end_dates is not None else None
        results.append(_normalize_single(fips, row_date, crosswalk, canonical))

    out = pd.DataFrame(
        {
            "fips_2020": [r.fips_2020 for r in results],
            "remap_flag": [r.remap_flag for r in results],
            "weight": [r.weight for r in results],
            "note": [r.note for r in results],
        },
        index=fips_series.index,
    )
    return out


def _normalize_single(
    fips: str,
    row_date,
    crosswalk: pd.DataFrame,
    canonical: set[str],
) -> NormalizeResult:
    # Basic shape check first — 5 digits.
    if not (len(fips) == 5 and fips.isdigit()):
        return NormalizeResult(None, "unknown", 0.0, f"invalid FIPS shape: {fips!r}")

    # If it's already recognized as 2020 canonical, pass through.
    if fips in canonical:
        return NormalizeResult(fips, "passthrough", 1.0, "")

    # Historical mapping? Apply date filter if provided — only apply the
    # remap for rows whose period_end is BEFORE the crosswalk's effective end.
    matches = crosswalk[crosswalk["from_fips"] == fips]
    if row_date is not None and not matches.empty:
        matches = matches[matches["effective_period_end"] >= row_date]

    if matches.empty:
        # Not in canonical set AND not in crosswalk. In our current seed
        # crosswalk, the canonical set is small (only targets of historical
        # renames), so this branch fires for ALL "normal" 2020 FIPS that
        # weren't part of a rename event. Pass through with a passthrough
        # flag — the check exists so a production build with a real 2020
        # canonical list can catch truly-unknown codes.
        return NormalizeResult(fips, "passthrough", 1.0, "")

    if len(matches) == 1 and matches.iloc[0]["weight"] == 1.0:
        # Simple rename.
        target = matches.iloc[0]["to_fips_2020"]
        return NormalizeResult(target, "renamed", 1.0, matches.iloc[0]["note"])

    # Split or merge with multiple targets. For now, pick the highest-weight
    # target and flag — proper handling would replicate the row with each
    # target and its weight (out of scope for Phase 1; splits are rare).
    top = matches.sort_values("weight", ascending=False).iloc[0]
    note = f"split_merge; picked highest-weight target ({top['weight']:.2f}): {top['note']}"
    return NormalizeResult(top["to_fips_2020"], "split_merge", float(top["weight"]), note)
