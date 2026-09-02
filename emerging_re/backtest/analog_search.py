"""Analog-search top-5 picker — find markets that look like historical winners.

Alternative to ML: rather than train a model to predict forward returns,
identify past top-decile winners and rank current candidates by feature
similarity (cosine) to those winners.

Universe:  tertiary (pop 100K-300K), same as ml_walk_forward.
Target:    winner definition uses target_zori_36mo_demeaned. A "winner"
           is a county in the top 10% of demeaned 36mo ZORI return within
           its cohort year.
Similarity: cosine between z-scored feature vectors (z-scored within
            each cohort so features are relative to that year's universe).
Aggregation: for each candidate, score = mean of top-K similarities to
             historical winners. K=5 default.
Walk-forward: EXPANDING window. At each test year Y, train on all prior
              cohort years [first_panel_year, Y-1] that have observed targets.
              Training pool grows by 1 each iteration until it hits the
              observability cap (latest cohort year with observed ACS 36mo
              target), then stays frozen for later test years. Minimum
              MIN_TRAIN_YEARS = 5 cohorts required or the iteration is
              skipped.

State cap: max 2 per state in top-5 (same as ml_walk_forward).

Reports per test year: top-5 picks, realized ZORI 36mo returns, edge vs
tertiary universe, AND which historical winners each pick matched to
(interpretability).

Run: `uv run python -m backtest.analog_search`
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from pathlib import Path

import duckdb
import numpy as np
import pandas as pd

WAREHOUSE_PATH = Path("/Users/premputtegowda/reps/reps-tracker/emerging_re/data/warehouse/emerging_re.duckdb")

TARGET_COL = "target_acs_rent_36mo_demeaned"  # rent-only training target (backward compat)
TARGET_COL_TOTAL_RETURN = "target_total_return_36mo_demeaned"  # composite: rent × cap change
REALIZED_RETURN_COL_ACS = "acs_forward_return_36mo"     # ACS 36mo observable only through cohort 2019
REALIZED_RETURN_COL_TOTAL = "total_return_36mo"         # composite realized return
REALIZED_CAP_ENTRY_COL = "target_cap_entry"             # cap rate at cohort year (for target)
REALIZED_CAP_EXIT_COL = "target_cap_exit"               # cap rate at cohort year + horizon
REALIZED_RETURN_COL_ZORI36 = "zori_forward_return_36mo" # ZORI 36mo observable through cohort 2022
REALIZED_RETURN_COL_ZORI24 = "zori_forward_return_24mo" # ZORI 24mo observable through cohort 2023
REALIZED_TOTAL_ZORI36_COL  = "total_return_zori36_36mo" # ZORI-based composite (rent × cap Δ)
REALIZED_TOTAL_ZORI24_COL  = "total_return_zori24_24mo" # ZORI 24mo × cap Δ (24mo horizon)
HORIZON_YEARS = 3

WINNER_TOP_PCT = 0.10  # top 10% per cohort year
TOP_K_ANALOGS = 5      # aggregate similarity: mean of top-K winner matches
DIVERSITY_HHI_MAX = 0.10  # filter to diversified employment (drops top ~13% concentrated)
MIN_TRAIN_YEARS = 5    # walk-forward: skip test years with fewer training cohorts available

# Reuse same feature exclusions as ml_walk_forward.
LEAKY_FEATURES = {
    # As of 2026-09-02 PIT rewrite: int_acs_features + int_mf_features +
    # int_mf_inventory now emit one row per (fips, scoring_period) with
    # as_of-aware source lookups. The following features that were previously
    # leaky-latest are now PIT-correct and safe to include as ML/analog inputs:
    #   - rental_vacancy_rate, rent_to_income_ratio, cap_rate_proxy (int_acs_features)
    #   - renter_share, mf_permit_ratio, rental_vacancy_change_3yr (int_mf_features)
    #
    # Remaining exclusions — these weren't rebuilt in the PIT pass, so treat as leaky:
    "pcpi_cagr_5yr",              # int_bea_income — still latest-per-fips
    "n_supersectors_reporting",   # int_employment_diversity — likely latest-per-fips
}
NON_FEATURE_COLS = {
    "fips", "period_end_date", "county_name", "state_name", "pop_latest",
    "any_disqualifier",
    "hpi_forward_return_24mo", "target_hpi_24mo_demeaned",
    "zori_forward_return_24mo", "target_zori_24mo_demeaned",
    "hpi_forward_return_36mo", "target_hpi_36mo_demeaned",
    "zori_forward_return_36mo", "target_zori_36mo_demeaned",
    "hpi_forward_return_60mo", "target_hpi_60mo_demeaned",
    "zori_forward_return_60mo", "target_zori_60mo_demeaned",
    # ACS-derived target cols we add (must not be features).
    REALIZED_RETURN_COL_ACS, TARGET_COL, "target_source",
    REALIZED_RETURN_COL_TOTAL, TARGET_COL_TOTAL_RETURN,
    REALIZED_CAP_ENTRY_COL, REALIZED_CAP_EXIT_COL,
    REALIZED_RETURN_COL_ZORI36, REALIZED_RETURN_COL_ZORI24,
    REALIZED_TOTAL_ZORI36_COL, REALIZED_TOTAL_ZORI24_COL,
    "cap_rate_entry", "cap_rate_exit", "cap_rate_exit_2yr",
    # MF market-size context — display-only, not for similarity matching.
    "mf_units_5plus", "mf_bldgs_est", "mf_units_10_19",
    "year",
}
CATEGORICAL_COLS = {"anchor_type", "macro_regime"}


@dataclass
class StepResult:
    test_year: int
    n_winners: int
    n_train_cohorts: int
    top5: pd.DataFrame  # with realized returns + matched winners
    universe_mean_acs_36mo: float    # NaN if not observable
    universe_mean_total_36mo: float  # composite total return (rent × cap)
    universe_mean_zori_36mo: float   # NaN if not observable
    universe_mean_zori_24mo: float   # NaN if not observable


def load_tertiary_panel() -> pd.DataFrame:
    """Tertiary (pop 100-300K) + diversified employment (HHI <= threshold)."""
    con = duckdb.connect(str(WAREHOUSE_PATH), read_only=True)
    df = con.execute(f"""
        SELECT f.*, mr.macro_regime
        FROM main_marts.mart_county_features f
        LEFT JOIN main_intermediate.int_national_macro_regime mr
            ON EXTRACT(YEAR FROM f.period_end_date) = mr.year
        WHERE EXTRACT(MONTH FROM f.period_end_date) = 12
          AND f.pop_latest > 100000
          AND f.pop_latest <= 300000
          AND f.employment_diversity_hhi IS NOT NULL
          AND f.employment_diversity_hhi <= {DIVERSITY_HHI_MAX}
    """).df()
    df["period_end_date"] = pd.to_datetime(df["period_end_date"])
    df["year"] = df["period_end_date"].dt.year
    return df


def load_mf_context() -> pd.DataFrame:
    """MF market-size context per county from ACS 1-year (latest vintage).

    Returns per fips:
      - mf_units_5plus: total housing units in buildings of 5+ units (5-9, 10-19, 20-49, 50+)
      - mf_bldgs_est: estimated MF building count = sum(units / bucket midpoint)
                     midpoints: 7 (5-9), 14.5 (10-19), 34.5 (20-49), 75 (50+)
      - mf_units_10_19: units in the 10-19 bucket alone (primary MF investor target size)

    ACS 1-year covers all counties with pop >= 65K, which is our full tertiary
    universe. Uses latest as_of per fips (a snapshot of the most recent vintage
    published for that county — same "latest" convention as int_acs_features).
    """
    con = duckdb.connect(str(WAREHOUSE_PATH), read_only=True)
    df = con.execute("""
        SELECT fips,
               units_in_5_to_9_bldgs,
               units_in_10_to_19_bldgs,
               units_in_20_to_49_bldgs,
               units_in_50_plus_bldgs
        FROM main_staging.stg_census_acs_1yr
        QUALIFY row_number() OVER (
            PARTITION BY fips ORDER BY period_end_date DESC, as_of_date DESC
        ) = 1
    """).df()
    for col in ["units_in_5_to_9_bldgs", "units_in_10_to_19_bldgs",
                "units_in_20_to_49_bldgs", "units_in_50_plus_bldgs"]:
        df[col] = df[col].fillna(0)
    df["mf_units_5plus"] = (
        df["units_in_5_to_9_bldgs"] + df["units_in_10_to_19_bldgs"]
        + df["units_in_20_to_49_bldgs"] + df["units_in_50_plus_bldgs"]
    )
    df["mf_bldgs_est"] = (
        df["units_in_5_to_9_bldgs"] / 7.0
        + df["units_in_10_to_19_bldgs"] / 14.5
        + df["units_in_20_to_49_bldgs"] / 34.5
        + df["units_in_50_plus_bldgs"] / 75.0
    )
    df["mf_units_10_19"] = df["units_in_10_to_19_bldgs"]
    return df[["fips", "mf_units_5plus", "mf_bldgs_est", "mf_units_10_19"]]


def build_acs_target(horizon_years: int = 3) -> pd.DataFrame:
    """ACS median gross rent 36mo forward change, demeaned by NATIONAL mean.

    Hybrid source (2026-09-03): prefer ACS 1-year (calendar-year snapshot,
    single-year precision) where available for the (fips, year) pair;
    fall back to ACS 5-year (rolling window, smoothed) otherwise. ACS 1-year
    is the more direct point-in-time measurement — a "2022 rent" value is
    actual 2022 rent, not a 2020-2022 rolling average — but covers only
    pop >= 65K counties and skips 2020 vintage (Census pandemic pause).
    5-year fills those gaps.

    Uses latest as_of per (fips, period_end_date) as the "realized value" at
    each period. Target is by definition forward-looking (measures what
    eventually happens), so we use the most-revised ACS estimate — no PIT
    filter needed on the target side. The PIT concern is on FEATURES, which
    is handled by int_acs_features + int_mf_features (as of 2026-09-02).

    National demeaning uses all counties in the pooled ACS panel to match the
    demeaning convention of target_zori_*_demeaned.

    Returns: (fips, period_end_date, acs_forward_return_36mo,
              target_acs_rent_36mo_demeaned, target_source)
      target_source: '1yr' | '5yr' — provenance of the anchor value used
    """
    con = duckdb.connect(str(WAREHOUSE_PATH), read_only=True)
    # Now pulling BOTH rent and home_value so we can compute cap rate
    # (cap_rate_proxy = 12 × rent / home_value) at entry and exit for the
    # composite total-return target.
    acs_1yr = con.execute("""
        SELECT fips, period_end_date, median_gross_rent, median_home_value
        FROM main_staging.stg_census_acs_1yr
        WHERE median_gross_rent IS NOT NULL AND median_home_value IS NOT NULL AND median_home_value > 0
        QUALIFY row_number() OVER (
            PARTITION BY fips, period_end_date ORDER BY as_of_date DESC
        ) = 1
    """).df()
    acs_1yr["period_end_date"] = pd.to_datetime(acs_1yr["period_end_date"])
    acs_1yr["year"] = acs_1yr["period_end_date"].dt.year
    acs_1yr["source"] = "1yr"
    acs_1yr["cap_rate"] = 12.0 * acs_1yr["median_gross_rent"] / acs_1yr["median_home_value"]

    acs_5yr = con.execute("""
        SELECT fips, period_end_date, median_gross_rent, median_home_value
        FROM main_staging.stg_census_acs
        WHERE median_gross_rent IS NOT NULL AND median_home_value IS NOT NULL AND median_home_value > 0
        QUALIFY row_number() OVER (
            PARTITION BY fips, period_end_date ORDER BY as_of_date DESC
        ) = 1
    """).df()
    acs_5yr["period_end_date"] = pd.to_datetime(acs_5yr["period_end_date"])
    acs_5yr["year"] = acs_5yr["period_end_date"].dt.year
    acs_5yr["source"] = "5yr"
    acs_5yr["cap_rate"] = 12.0 * acs_5yr["median_gross_rent"] / acs_5yr["median_home_value"]

    # For each source (1yr or 5yr), compute BOTH rent forward return and
    # cap rate at entry+exit within the same source. INNER join ensures
    # both endpoints exist for a valid (fips, year) target.
    def _forward_return_within_source(src_df: pd.DataFrame) -> pd.DataFrame:
        fwd = src_df[["fips", "year", "median_gross_rent", "cap_rate"]].rename(
            columns={"median_gross_rent": "median_gross_rent_forward",
                     "cap_rate": "cap_rate_forward"}
        ).copy()
        fwd["year"] = fwd["year"] - horizon_years
        joined = src_df.merge(fwd, on=["fips", "year"], how="inner")
        joined[REALIZED_RETURN_COL_ACS] = (
            joined["median_gross_rent_forward"] / joined["median_gross_rent"] - 1
        )
        # Composite total return: (1 + rent_growth) × (cap_entry / cap_exit) - 1
        # Same formula as V_end/V_start = (NOI_end/NOI_start) × (cap_start/cap_end).
        joined[REALIZED_RETURN_COL_TOTAL] = (
            (1 + joined[REALIZED_RETURN_COL_ACS])
            * (joined["cap_rate"] / joined["cap_rate_forward"]) - 1
        )
        joined[REALIZED_CAP_ENTRY_COL] = joined["cap_rate"]
        joined[REALIZED_CAP_EXIT_COL]  = joined["cap_rate_forward"]
        return joined[[
            "fips", "year", "period_end_date",
            REALIZED_RETURN_COL_ACS, REALIZED_RETURN_COL_TOTAL,
            REALIZED_CAP_ENTRY_COL, REALIZED_CAP_EXIT_COL,
            "source",
        ]]

    ret_1yr = _forward_return_within_source(acs_1yr)
    ret_5yr = _forward_return_within_source(acs_5yr)

    # Coalesce: prefer 1yr where the 1yr-consistent target is available,
    # else use 5yr-consistent. Anti-join filter keeps 5yr rows only where
    # 1yr is absent for (fips, year).
    ret_5yr_fallback = ret_5yr.merge(
        ret_1yr[["fips", "year"]].drop_duplicates(),
        on=["fips", "year"], how="left", indicator=True
    )
    ret_5yr_fallback = ret_5yr_fallback[ret_5yr_fallback["_merge"] == "left_only"].drop(columns=["_merge"])
    merged = pd.concat([ret_1yr, ret_5yr_fallback], ignore_index=True).sort_values(["fips", "year"])

    # Demean each target by its NATIONAL mean per cohort year.
    for col, target_col in [
        (REALIZED_RETURN_COL_ACS,   TARGET_COL),
        (REALIZED_RETURN_COL_TOTAL, TARGET_COL_TOTAL_RETURN),
    ]:
        year_mean = merged.dropna(subset=[col]).groupby("year")[col].mean()
        merged[target_col] = merged[col] - merged["year"].map(year_mean)

    return merged[[
        "fips", "period_end_date",
        REALIZED_RETURN_COL_ACS, TARGET_COL,
        REALIZED_RETURN_COL_TOTAL, TARGET_COL_TOTAL_RETURN,
        REALIZED_CAP_ENTRY_COL, REALIZED_CAP_EXIT_COL,
        "source",
    ]].rename(columns={"source": "target_source"})


def build_feature_matrix(panel: pd.DataFrame) -> tuple[pd.DataFrame, list[str]]:
    df = panel.copy()
    for col in CATEGORICAL_COLS:
        if col in df.columns:
            dummies = pd.get_dummies(df[col], prefix=col, dummy_na=True)
            df = pd.concat([df, dummies], axis=1)
    drop_cols = LEAKY_FEATURES | NON_FEATURE_COLS | CATEGORICAL_COLS
    feature_cols = [
        c for c in df.columns
        if c not in drop_cols and df[c].dtype != "object"
    ]
    return df, feature_cols


def zscore_within_cohort(
    df: pd.DataFrame,
    feature_cols: list[str],
) -> pd.DataFrame:
    """Median-impute per-cohort, then z-score per-cohort. Cast feature cols to
    float so boolean one-hot columns accept the numeric z-scores."""
    out = df.copy()
    for col in feature_cols:
        out[col] = out[col].astype(float)
    for _, group_idx in df.groupby("year").groups.items():
        for col in feature_cols:
            vals = out.loc[group_idx, col]
            med = vals.median(skipna=True)
            filled = vals.fillna(med if pd.notna(med) else 0.0)
            mu = filled.mean()
            sigma = filled.std(ddof=0)
            if sigma == 0 or pd.isna(sigma):
                out.loc[group_idx, col] = 0.0
            else:
                out.loc[group_idx, col] = (filled - mu) / sigma
    return out


def identify_winners(panel: pd.DataFrame, train_years: list[int], target_col: str = TARGET_COL) -> pd.DataFrame:
    """Top-decile counties by the specified target column within each train year.

    target_col options:
      - TARGET_COL (default): rent-only demeaned ACS 36mo growth
      - TARGET_COL_TOTAL_RETURN: composite (rent × cap-rate compression) demeaned
    """
    train = panel[panel["year"].isin(train_years)].dropna(subset=[target_col]).copy()
    if train.empty:
        return train
    winners = []
    for year, sub in train.groupby("year"):
        threshold = sub[target_col].quantile(1 - WINNER_TOP_PCT)
        w = sub[sub[target_col] >= threshold].copy()
        winners.append(w)
    return pd.concat(winners, ignore_index=False) if winners else pd.DataFrame()


def cosine_similarity_matrix(A: np.ndarray, B: np.ndarray) -> np.ndarray:
    """A: (n_candidates, d), B: (n_winners, d). Returns (n_candidates, n_winners)."""
    a_norm = np.linalg.norm(A, axis=1, keepdims=True)
    b_norm = np.linalg.norm(B, axis=1, keepdims=True)
    a_norm = np.where(a_norm == 0, 1.0, a_norm)
    b_norm = np.where(b_norm == 0, 1.0, b_norm)
    A_unit = A / a_norm
    B_unit = B / b_norm
    return A_unit @ B_unit.T


def pick_top_n_with_state_cap(
    scored_df: pd.DataFrame,
    score_col: str,
    n: int,
    max_per_state: int = 2,
) -> pd.DataFrame:
    ranked = scored_df.dropna(subset=[score_col]).sort_values(score_col, ascending=False)
    picked: list[pd.Series] = []
    state_counts: dict[str, int] = {}
    for _, row in ranked.iterrows():
        state = row["state_name"]
        if state_counts.get(state, 0) >= max_per_state:
            continue
        picked.append(row)
        state_counts[state] = state_counts.get(state, 0) + 1
        if len(picked) >= n:
            break
    return pd.DataFrame(picked) if picked else pd.DataFrame()


def build_walk_forward_schedule(
    panel_z: pd.DataFrame,
    test_years: list[int] | None,
    min_train_years: int,
    target_col: str = TARGET_COL,
) -> list[dict]:
    """Expanding walk-forward: at each test year, train on all prior cohort
    years that have observed targets. Training pool grows by 1 each iteration
    until it hits the observability cap (latest cohort year with observed
    ACS 36mo target), then stays frozen for later test years.

    If `test_years` is None, auto-generate all test years from
    (first_panel_year + min_train_years) through the last panel year.
    """
    obs_years = set(panel_z.dropna(subset=[target_col])["year"].unique().tolist())
    all_years = sorted(panel_z["year"].unique().tolist())
    if not all_years:
        return []
    first_year = int(all_years[0])
    last_year = int(all_years[-1])

    if test_years is None:
        test_years = list(range(first_year + min_train_years, last_year + 1))

    schedule: list[dict] = []
    for Y in test_years:
        train_years = [y for y in all_years if first_year <= y < Y and y in obs_years]
        schedule.append({
            "test_year": int(Y),
            "train_years": train_years,
            "n_train_years": len(train_years),
        })
    return schedule


def walk_forward(
    panel_z: pd.DataFrame,
    panel_raw: pd.DataFrame,
    feature_cols: list[str],
    test_years: list[int] | None = None,
    min_train_years: int = MIN_TRAIN_YEARS,
    target_col: str = TARGET_COL,
) -> list[StepResult]:
    schedule = build_walk_forward_schedule(panel_z, test_years, min_train_years, target_col=target_col)
    print(f"\nWalk-forward schedule ({len(schedule)} iterations, min_train_years={min_train_years}, target={target_col}):")
    for step in schedule:
        n = step["n_train_years"]
        marker = "  " if n >= min_train_years else "  SKIP "
        train_span = f"{min(step['train_years'])}-{max(step['train_years'])}" if step["train_years"] else "(none)"
        print(f"{marker}test={step['test_year']}   train_cohorts={n:2d}   span={train_span}")

    results: list[StepResult] = []
    for step in schedule:
        Y = step["test_year"]
        train_years = step["train_years"]
        if len(train_years) < min_train_years:
            continue
        winners = identify_winners(panel_z, train_years, target_col=target_col)
        if winners.empty:
            print(f"  SKIP {Y}: no winners identified in train cohorts")
            continue

        # Attach winner label (fips + year) for interpretability.
        winners["_winner_label"] = (
            winners["county_name"] + ", " + winners["state_name"] + " (" +
            winners["year"].astype(str) + ")"
        )
        winner_features = winners[feature_cols].astype(float).values

        test_z = panel_z[panel_z["year"] == Y].copy()
        candidate_features = test_z[feature_cols].astype(float).values

        # Cosine similarity: (n_candidates, n_winners)
        sim = cosine_similarity_matrix(candidate_features, winner_features)

        # Aggregate: mean of top-K winner matches per candidate.
        k = min(TOP_K_ANALOGS, sim.shape[1])
        top_k_idx = np.argsort(sim, axis=1)[:, -k:]
        top_k_sim = np.take_along_axis(sim, top_k_idx, axis=1)
        analog_score = top_k_sim.mean(axis=1)

        test_z["analog_score"] = analog_score
        # Also record which winners were top matches for interpretability.
        winner_labels = winners["_winner_label"].values
        matched_labels = [
            ", ".join(winner_labels[top_k_idx[i]])
            for i in range(len(test_z))
        ]
        test_z["top_analogs"] = matched_labels

        # Merge realized returns from raw panel — ACS 36mo + total return + ZORI 36mo + ZORI 24mo.
        # Also pull cap rate at entry/exit as computed in the target build (same
        # source semantics as target — 1yr or 5yr-consistent).
        realized_cols = [
            REALIZED_RETURN_COL_ACS, REALIZED_RETURN_COL_TOTAL,
            REALIZED_CAP_ENTRY_COL, REALIZED_CAP_EXIT_COL,
            REALIZED_RETURN_COL_ZORI36, REALIZED_RETURN_COL_ZORI24,
        ]
        available_cols = [c for c in realized_cols if c in panel_raw.columns]
        realized = panel_raw[panel_raw["year"] == Y][["fips", *available_cols]]
        drop_from_test = [c for c in available_cols if c in test_z.columns]
        test_z = test_z.drop(columns=drop_from_test).merge(realized, on="fips", how="left")

        # Attach entry + exit cap rate (cap_rate_proxy = ACS gross rent × 12 / home value).
        # Entry cap = cohort year Y; exit cap = Y + HORIZON_YEARS if observable in panel.
        entry_cap = panel_raw[panel_raw["year"] == Y][["fips", "cap_rate_proxy"]].rename(
            columns={"cap_rate_proxy": "cap_rate_entry"}
        )
        test_z = test_z.merge(entry_cap, on="fips", how="left")
        exit_year = Y + HORIZON_YEARS
        exit_year_in_panel = panel_raw[panel_raw["year"] == exit_year]
        if not exit_year_in_panel.empty:
            exit_cap = exit_year_in_panel[["fips", "cap_rate_proxy"]].rename(
                columns={"cap_rate_proxy": "cap_rate_exit"}
            )
            test_z = test_z.merge(exit_cap, on="fips", how="left")
        else:
            test_z["cap_rate_exit"] = np.nan

        # Also attach exit cap at Y+2 (for the ZORI 24mo composite total return).
        exit_year_2yr = Y + 2
        exit_2yr_panel = panel_raw[panel_raw["year"] == exit_year_2yr]
        if not exit_2yr_panel.empty:
            exit_cap_2yr = exit_2yr_panel[["fips", "cap_rate_proxy"]].rename(
                columns={"cap_rate_proxy": "cap_rate_exit_2yr"}
            )
            test_z = test_z.merge(exit_cap_2yr, on="fips", how="left")
        else:
            test_z["cap_rate_exit_2yr"] = np.nan

        # Compute ZORI-based composite total return: (1 + ZORI_growth) × (cap_entry / cap_exit) - 1
        # Uses ACS-derived cap change (same for all rent measures — cap is a valuation ratio).
        # 36mo version:
        test_z[REALIZED_TOTAL_ZORI36_COL] = (
            (1 + test_z[REALIZED_RETURN_COL_ZORI36])
            * (test_z["cap_rate_entry"] / test_z["cap_rate_exit"]) - 1
        )
        # 24mo version:
        test_z[REALIZED_TOTAL_ZORI24_COL] = (
            (1 + test_z[REALIZED_RETURN_COL_ZORI24])
            * (test_z["cap_rate_entry"] / test_z["cap_rate_exit_2yr"]) - 1
        )

        top5 = pick_top_n_with_state_cap(test_z, "analog_score", n=5, max_per_state=2)

        # ── In-shortlist tie-breaker composite ──────────────────────────
        # Rerank the top-5 by a decision-support composite (not replacing
        # cosine — augmenting it). Signals within the top-5:
        #   0.50 × cap_rate_entry percentile      (higher yield = better)
        #   0.30 × zori_yoy percentile           (rent momentum trajectory)
        #   0.20 × similarity_score percentile   (residual conviction from cosine)
        # All percentiles computed WITHIN the top-5 (not universe) — this is
        # a within-shortlist ranker, not a replacement for the primary model.
        if not top5.empty:
            top5 = top5.copy()
            top5["_sim_rank"] = range(1, len(top5) + 1)  # preserve original order
            # zori_yoy comes from mart_county_features (already in test_z / top5 if present)
            for col in ["cap_rate_entry", "zori_yoy", "analog_score"]:
                if col not in top5.columns:
                    top5[col] = np.nan
            def _rank_pct(series):
                # percentile within top-5. NaN → 0.5 (neutral)
                vals = series.astype(float)
                if vals.notna().sum() == 0:
                    return pd.Series([0.5] * len(vals), index=vals.index)
                ranked = vals.rank(pct=True, na_option="bottom")
                return ranked.fillna(0.5)
            cap_pct  = _rank_pct(top5["cap_rate_entry"])
            rent_pct = _rank_pct(top5["zori_yoy"])
            sim_pct  = _rank_pct(top5["analog_score"])
            top5["tie_breaker_score"] = 0.50 * cap_pct + 0.30 * rent_pct + 0.20 * sim_pct
            top5["tb_cap_pct"]  = cap_pct
            top5["tb_rent_pct"] = rent_pct
            top5["tb_sim_pct"]  = sim_pct
            # Rerank: highest tie-breaker score = new #1
            top5 = top5.sort_values("tie_breaker_score", ascending=False).reset_index(drop=True)
            top5["_tb_rank"] = range(1, len(top5) + 1)
            # Restore original ordering by _sim_rank so display still shows model's picks in order
            top5 = top5.sort_values("_sim_rank").reset_index(drop=True)

        # Universe means (universe = same filtered diverse-tertiary panel at year Y).
        def _mean(col: str) -> float:
            s = realized[col].dropna()
            return float(s.mean()) if not s.empty else float("nan")

        results.append(StepResult(
            test_year=Y,
            n_winners=len(winners),
            n_train_cohorts=len(train_years),
            top5=top5,
            universe_mean_acs_36mo=_mean(REALIZED_RETURN_COL_ACS),
            universe_mean_total_36mo=_mean(REALIZED_RETURN_COL_TOTAL),
            universe_mean_zori_36mo=_mean(REALIZED_RETURN_COL_ZORI36),
            universe_mean_zori_24mo=_mean(REALIZED_RETURN_COL_ZORI24),
        ))

    return results


def print_report(results: list[StepResult], panel_raw: pd.DataFrame | None = None) -> None:
    print("\n" + "=" * 130)
    print("ANALOG-SEARCH TOP-5 — feature similarity to historical top-decile winners")
    print("=" * 130)
    print(f"Universe: tertiary 100-300K + emp_diversity_hhi <= {DIVERSITY_HHI_MAX}   "
          f"Training: 2008-2018 cohorts   Winner def: top {WINNER_TOP_PCT*100:.0f}% by ACS 36mo demeaned")
    print(f"Similarity: cosine on z-scored features (within cohort). Score = mean of top-{TOP_K_ANALOGS} matches.")
    print("Eval: report BOTH ACS 36mo (observable 2019 only) AND ZORI 36mo (observable 2015+ through 2022).")
    print()

    summary_rows = []
    for r in results:
        def _top5_mean(col: str) -> float:
            if col not in r.top5.columns:
                return float("nan")
            s = r.top5[col].dropna()
            return float(s.mean()) if not s.empty else float("nan")

        top5_acs_mean = _top5_mean(REALIZED_RETURN_COL_ACS)
        top5_total_mean = _top5_mean(REALIZED_RETURN_COL_TOTAL)
        top5_zori36_mean = _top5_mean(REALIZED_RETURN_COL_ZORI36)
        top5_zori24_mean = _top5_mean(REALIZED_RETURN_COL_ZORI24)

        def _edge(top: float, uni: float) -> float:
            return (top - uni) * 100 if pd.notna(top) and pd.notna(uni) else float("nan")

        acs_edge = _edge(top5_acs_mean, r.universe_mean_acs_36mo)
        zori36_edge = _edge(top5_zori36_mean, r.universe_mean_zori_36mo)
        zori24_edge = _edge(top5_zori24_mean, r.universe_mean_zori_24mo)

        def _fmt(v: float, unit: str = "%") -> str:
            return f"{v:+7.2f}{unit}" if pd.notna(v) else "   n/a  "

        # Annualize a cumulative return over horizon years: (1+r)^(1/n) - 1.
        # Returns nan for null or invalid (negative denom) inputs.
        def _annualize(cumulative: float, horizon_years: int) -> float:
            if not pd.notna(cumulative) or (1 + cumulative) <= 0:
                return float("nan")
            return (1 + cumulative) ** (1.0 / horizon_years) - 1

        # Per-location CAGR then average — this matches the "typical single
        # market CAGR" perspective an investor picking one market cares about.
        # Portfolio-CAGR (annualize the aggregate cumulative) would be a
        # different number appropriate for equal-weight portfolio view.
        def _mean_of_annualized(cum_series, horizon_years: int) -> float:
            if cum_series is None:
                return float("nan")
            cagrs = cum_series.dropna().apply(lambda r: _annualize(r, horizon_years))
            cagrs = cagrs.dropna()
            return float(cagrs.mean()) if not cagrs.empty else float("nan")

        # Universe universes recompute from raw panel (need per-fips cumulative
        # returns to annualize each then average). Pull from panel_raw via r.top5's
        # cohort year — we need the full universe returns for that year.
        top5_acs_annual   = _mean_of_annualized(r.top5[REALIZED_RETURN_COL_ACS]   if REALIZED_RETURN_COL_ACS   in r.top5.columns else None, 3)
        top5_total_annual = _mean_of_annualized(r.top5[REALIZED_RETURN_COL_TOTAL] if REALIZED_RETURN_COL_TOTAL in r.top5.columns else None, 3)
        top5_zori36_annual = _mean_of_annualized(r.top5[REALIZED_RETURN_COL_ZORI36] if REALIZED_RETURN_COL_ZORI36 in r.top5.columns else None, 3)
        top5_zori24_annual = _mean_of_annualized(r.top5[REALIZED_RETURN_COL_ZORI24] if REALIZED_RETURN_COL_ZORI24 in r.top5.columns else None, 2)

        # Universe per-location CAGR mean requires the full universe cumulative
        # series for that cohort year. Recompute via panel_raw filtered to the year.
        uni_year_df = panel_raw[panel_raw["year"] == r.test_year] if panel_raw is not None else None
        uni_acs_annual    = _mean_of_annualized(uni_year_df[REALIZED_RETURN_COL_ACS]   if uni_year_df is not None and REALIZED_RETURN_COL_ACS   in uni_year_df.columns else None, 3)
        uni_total_annual  = _mean_of_annualized(uni_year_df[REALIZED_RETURN_COL_TOTAL] if uni_year_df is not None and REALIZED_RETURN_COL_TOTAL in uni_year_df.columns else None, 3)
        uni_zori36_annual = _mean_of_annualized(uni_year_df[REALIZED_RETURN_COL_ZORI36] if uni_year_df is not None and REALIZED_RETURN_COL_ZORI36 in uni_year_df.columns else None, 3)
        uni_zori24_annual = _mean_of_annualized(uni_year_df[REALIZED_RETURN_COL_ZORI24] if uni_year_df is not None and REALIZED_RETURN_COL_ZORI24 in uni_year_df.columns else None, 2)

        total_edge = _edge(top5_total_mean, r.universe_mean_total_36mo)
        acs_edge_annual   = (top5_acs_annual - uni_acs_annual)     * 100 if pd.notna(top5_acs_annual)   and pd.notna(uni_acs_annual)   else float("nan")
        total_edge_annual = (top5_total_annual - uni_total_annual) * 100 if pd.notna(top5_total_annual) and pd.notna(uni_total_annual) else float("nan")
        zori36_edge_annual = (top5_zori36_annual - uni_zori36_annual) * 100 if pd.notna(top5_zori36_annual) and pd.notna(uni_zori36_annual) else float("nan")
        zori24_edge_annual = (top5_zori24_annual - uni_zori24_annual) * 100 if pd.notna(top5_zori24_annual) and pd.notna(uni_zori24_annual) else float("nan")

        print(f"\n===== TEST YEAR {r.test_year}  (train cohorts={r.n_train_cohorts}, winners={r.n_winners}) =====")
        print(f"  ACS RENT 36mo:  top5={_fmt(top5_acs_mean*100)} ({_fmt(top5_acs_annual*100,'%/yr')})   uni={_fmt(r.universe_mean_acs_36mo*100)} ({_fmt(uni_acs_annual*100,'%/yr')})   edge={_fmt(acs_edge,'pp')} ({_fmt(acs_edge_annual,'pp/yr')})")
        print(f"  TOTAL RETN 36mo:top5={_fmt(top5_total_mean*100)} ({_fmt(top5_total_annual*100,'%/yr')})   uni={_fmt(r.universe_mean_total_36mo*100)} ({_fmt(uni_total_annual*100,'%/yr')})   edge={_fmt(total_edge,'pp')} ({_fmt(total_edge_annual,'pp/yr')})")
        print(f"  ZORI 36mo:      top5={_fmt(top5_zori36_mean*100)} ({_fmt(top5_zori36_annual*100,'%/yr')})   uni={_fmt(r.universe_mean_zori_36mo*100)} ({_fmt(uni_zori36_annual*100,'%/yr')})   edge={_fmt(zori36_edge,'pp')} ({_fmt(zori36_edge_annual,'pp/yr')})")
        print(f"  ZORI 24mo:      top5={_fmt(top5_zori24_mean*100)} ({_fmt(top5_zori24_annual*100,'%/yr')})   uni={_fmt(r.universe_mean_zori_24mo*100)} ({_fmt(uni_zori24_annual*100,'%/yr')})   edge={_fmt(zori24_edge,'pp')} ({_fmt(zori24_edge_annual,'pp/yr')})")

        if r.top5.empty:
            print("  (no picks)")
            continue

        for i, (_, row) in enumerate(r.top5.iterrows(), start=1):
            acs_ret = row.get(REALIZED_RETURN_COL_ACS, float("nan"))
            zori36_ret = row.get(REALIZED_RETURN_COL_ZORI36, float("nan"))
            zori24_ret = row.get(REALIZED_RETURN_COL_ZORI24, float("nan"))
            # Per-pick annualized (cumulative -> per-year rate).
            acs_annual   = _annualize(acs_ret,   3)
            zori36_annual = _annualize(zori36_ret, 3)
            zori24_annual = _annualize(zori24_ret, 2)
            def _rf(v):
                return f"{v*100:+6.2f}%" if pd.notna(v) else "  n/a "
            def _rfa(v):
                return f"{v*100:+5.2f}%/yr" if pd.notna(v) else "  n/a   "
            mf_units = row.get("mf_units_5plus", float("nan"))
            mf_bldgs = row.get("mf_bldgs_est", float("nan"))
            mf_10_19 = row.get("mf_units_10_19", float("nan"))
            mf_units_str = f"{int(mf_units):>6,}" if pd.notna(mf_units) else "   n/a"
            mf_bldgs_str = f"{int(mf_bldgs):>4,}" if pd.notna(mf_bldgs) else " n/a"
            mf_10_19_str = f"{int(mf_10_19):>5,}" if pd.notna(mf_10_19) else "  n/a"
            tb_rank = row.get("_tb_rank", None)
            tb_score = row.get("tie_breaker_score", None)
            tb_str = f"  [TB #{int(tb_rank)}, score={tb_score:.3f}]" if pd.notna(tb_rank) else ""
            # Cap rate — prefer the target-source cap values (same-source as
            # rent for consistency), fall back to mart panel cap_rate_proxy
            # (which is PIT-correct as of the scoring date).
            cap_entry = row.get(REALIZED_CAP_ENTRY_COL, float("nan"))
            cap_exit  = row.get(REALIZED_CAP_EXIT_COL,  float("nan"))
            if pd.isna(cap_entry):
                cap_entry = row.get("cap_rate_entry", float("nan"))
            if pd.isna(cap_exit):
                cap_exit = row.get("cap_rate_exit", float("nan"))
            # Compact inline cap summary for the main pick line.
            if pd.notna(cap_entry) and pd.notna(cap_exit):
                inline_cap = f"cap {cap_entry*100:4.2f}%→{cap_exit*100:4.2f}% ({(cap_exit-cap_entry)*10000:+4.0f}bps)"
            elif pd.notna(cap_entry):
                inline_cap = f"cap {cap_entry*100:4.2f}% (exit n/a)      "
            else:
                inline_cap = "cap n/a                            "
            # ZORI-based total returns (rent × cap compression) — separate from ACS total return
            zori36_total = row.get(REALIZED_TOTAL_ZORI36_COL, float("nan"))
            zori24_total = row.get(REALIZED_TOTAL_ZORI24_COL, float("nan"))
            zori36_total_annual = _annualize(zori36_total, 3)
            zori24_total_annual = _annualize(zori24_total, 2)
            print(f"  #{i}{tb_str}  {row['county_name']:<22} {row['state_name']:<16} "
                  f"pop={int(row['pop_latest']):>7,}   sim={row['analog_score']:.4f}   {inline_cap}   "
                  f"ACS36={_rf(acs_ret)} ({_rfa(acs_annual)})  ZORI36={_rf(zori36_ret)} ({_rfa(zori36_annual)})  ZORI24={_rf(zori24_ret)} ({_rfa(zori24_annual)})  "
                  f"TR-ZORI36={_rf(zori36_total)} ({_rfa(zori36_total_annual)})  TR-ZORI24={_rf(zori24_total)} ({_rfa(zori24_total_annual)})")
            def _cap(v):
                return f"{v*100:5.2f}%" if pd.notna(v) else "  n/a"
            if pd.notna(cap_entry) and pd.notna(cap_exit):
                delta_bps = (cap_exit - cap_entry) * 10000
                cap_str = f"{_cap(cap_entry)} → {_cap(cap_exit)}  Δ={delta_bps:+.0f} bps"
            elif pd.notna(cap_entry):
                cap_str = f"{_cap(cap_entry)} → {_cap(cap_exit)}  Δ=n/a (exit not yet observable)"
            else:
                cap_str = "n/a"
            # Total return: rent + cap-compression stacked.
            total_ret = row.get(REALIZED_RETURN_COL_TOTAL, float("nan"))
            total_annual = _annualize(total_ret, 3)
            total_str = f"{total_ret*100:+6.2f}% ({total_annual*100:+5.2f}%/yr)" if pd.notna(total_ret) else "n/a"
            print(f"      MF context: units_5plus={mf_units_str}  est_bldgs={mf_bldgs_str}  units_10-19={mf_10_19_str}")
            print(f"      Cap rate (ACS-proxy): {cap_str}   Total return 36mo: {total_str}")
            print(f"      top analogs: {row['top_analogs']}")

        summary_rows.append({
            "year": r.test_year,
            "n_train_cohorts": r.n_train_cohorts,
            "n_winners": r.n_winners,
            "acs36_top5": top5_acs_mean * 100 if pd.notna(top5_acs_mean) else None,
            "acs36_top5_annual": top5_acs_annual * 100 if pd.notna(top5_acs_annual) else None,
            "acs36_uni": r.universe_mean_acs_36mo * 100 if pd.notna(r.universe_mean_acs_36mo) else None,
            "acs36_edge_pp": acs_edge if pd.notna(acs_edge) else None,
            "acs36_edge_pp_annual": acs_edge_annual if pd.notna(acs_edge_annual) else None,
            "zori36_top5": top5_zori36_mean * 100 if pd.notna(top5_zori36_mean) else None,
            "zori36_top5_annual": top5_zori36_annual * 100 if pd.notna(top5_zori36_annual) else None,
            "zori36_uni": r.universe_mean_zori_36mo * 100 if pd.notna(r.universe_mean_zori_36mo) else None,
            "zori36_edge_pp": zori36_edge if pd.notna(zori36_edge) else None,
            "zori36_edge_pp_annual": zori36_edge_annual if pd.notna(zori36_edge_annual) else None,
            "zori24_top5": top5_zori24_mean * 100 if pd.notna(top5_zori24_mean) else None,
            "zori24_top5_annual": top5_zori24_annual * 100 if pd.notna(top5_zori24_annual) else None,
            "zori24_uni": r.universe_mean_zori_24mo * 100 if pd.notna(r.universe_mean_zori_24mo) else None,
            "zori24_edge_pp": zori24_edge if pd.notna(zori24_edge) else None,
            "zori24_edge_pp_annual": zori24_edge_annual if pd.notna(zori24_edge_annual) else None,
        })

    print("\n" + "=" * 130)
    print("SUMMARY ACROSS TEST YEARS")
    print("=" * 130)
    sdf = pd.DataFrame(summary_rows)
    for c in sdf.columns:
        if c in ("year", "n_train_cohorts", "n_winners"):
            continue
        sdf[c] = sdf[c].astype(float).round(2)
    print(sdf.to_string(index=False))

    # ── Tie-breaker validation: does TB #1 beat cosine-similarity #1? ──
    print("\n" + "=" * 130)
    print("TIE-BREAKER VALIDATION — did the tie-breaker composite pick a better #1 than cosine similarity alone?")
    print("=" * 130)
    print("For each cohort, compare the realized return of the model's SIMILARITY #1 vs the TIE-BREAKER #1 pick.")
    print("Also show BEST-of-5 for reference (perfect hindsight ceiling).")
    print()
    tb_rows = []
    for r in results:
        if r.top5.empty:
            continue
        # Pick the return metric with best observability
        for ret_col, label, horizon in (
            (REALIZED_RETURN_COL_TOTAL,  "TOTAL 36mo", 3),
            (REALIZED_RETURN_COL_ACS,    "ACS 36mo",   3),
            (REALIZED_RETURN_COL_ZORI36, "ZORI 36mo",  3),
            (REALIZED_RETURN_COL_ZORI24, "ZORI 24mo",  2),
        ):
            if ret_col not in r.top5.columns:
                continue
            picks_with_ret = r.top5.dropna(subset=[ret_col])
            if picks_with_ret.empty:
                continue
            # Cosine #1 (top5 is currently ordered by _sim_rank)
            sim1 = r.top5.sort_values("_sim_rank").iloc[0]
            sim1_ret = sim1.get(ret_col, float("nan"))
            # Tie-breaker #1
            tb1 = r.top5.sort_values("_tb_rank").iloc[0]
            tb1_ret = tb1.get(ret_col, float("nan"))
            # Best-of-5 (hindsight)
            best5_ret = picks_with_ret[ret_col].max()
            best5_row = picks_with_ret.loc[picks_with_ret[ret_col].idxmax()]
            tb_rows.append({
                "year": r.test_year,
                "metric": label,
                "sim_#1_pick": f"{sim1['county_name']}, {sim1['state_name']}",
                "sim_#1_ret_pct": sim1_ret * 100 if pd.notna(sim1_ret) else None,
                "tb_#1_pick": f"{tb1['county_name']}, {tb1['state_name']}",
                "tb_#1_ret_pct": tb1_ret * 100 if pd.notna(tb1_ret) else None,
                "best_pick": f"{best5_row['county_name']}, {best5_row['state_name']}",
                "best_ret_pct": best5_ret * 100 if pd.notna(best5_ret) else None,
                "tb_lift_pp": (tb1_ret - sim1_ret) * 100 if pd.notna(tb1_ret) and pd.notna(sim1_ret) else None,
            })
            break  # take first observable metric only

    tbdf = pd.DataFrame(tb_rows)
    if not tbdf.empty:
        for c in ("sim_#1_ret_pct", "tb_#1_ret_pct", "best_ret_pct", "tb_lift_pp"):
            tbdf[c] = tbdf[c].astype(float).round(2)
        print(tbdf.to_string(index=False))
        # Aggregate: does TB beat sim on average?
        agg = tbdf.dropna(subset=["tb_lift_pp"])
        if not agg.empty:
            n = len(agg)
            wins = (agg["tb_lift_pp"] > 0).sum()
            losses = (agg["tb_lift_pp"] < 0).sum()
            ties = n - wins - losses
            avg_lift = agg["tb_lift_pp"].mean()
            print(f"\nAggregate over {n} observable cohorts:")
            print(f"  TB beat SIM: {wins}   TB lost to SIM: {losses}   ties: {ties}")
            print(f"  Avg lift (TB #1 return − SIM #1 return): {avg_lift:+.2f} pp")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--test-years", type=int, nargs="+", default=None,
        help="Test cohort years (default: auto-generate expanding schedule from first panel year + min_train_years)",
    )
    parser.add_argument(
        "--min-train-years", type=int, default=MIN_TRAIN_YEARS,
        help=f"Minimum training cohorts required to run an iteration (default: {MIN_TRAIN_YEARS})",
    )
    parser.add_argument(
        "--target", choices=["rent", "total_return"], default="rent",
        help="Training target: 'rent' = ACS 36mo demeaned rent growth; "
             "'total_return' = composite (rent × cap compression) demeaned",
    )
    args = parser.parse_args()
    target_col = TARGET_COL if args.target == "rent" else TARGET_COL_TOTAL_RETURN

    print("Loading tertiary panel (100-300K, Dec-31 cohorts)...")
    panel = load_tertiary_panel()
    print(f"  {len(panel)} rows across years {panel['year'].min()}-{panel['year'].max()}")

    print("Building ACS 36mo target from stg_census_acs...")
    acs_target = build_acs_target(horizon_years=HORIZON_YEARS)
    print(f"  {len(acs_target)} ACS rows, {acs_target[TARGET_COL].notna().sum()} with observed 36mo target")

    panel = panel.merge(acs_target, on=["fips", "period_end_date"], how="left")
    n_with_target = panel[TARGET_COL].notna().sum()
    print(f"  After merge: {n_with_target} panel rows have observed ACS 36mo target")

    print("Loading MF market-size context (ACS 1-year, latest vintage per fips)...")
    mf_ctx = load_mf_context()
    panel = panel.merge(mf_ctx, on="fips", how="left")
    n_with_mf = panel["mf_units_5plus"].notna().sum()
    print(f"  {n_with_mf} panel rows have MF unit-count context ({len(mf_ctx)} fips in ACS 1yr)")

    print("Building feature matrix + z-scoring within cohort...")
    panel_fe, feature_cols = build_feature_matrix(panel)
    print(f"  {len(feature_cols)} features")
    panel_z = zscore_within_cohort(panel_fe, feature_cols)

    results = walk_forward(
        panel_z, panel_fe, feature_cols,
        test_years=args.test_years,
        min_train_years=args.min_train_years,
        target_col=target_col,
    )

    print_report(results, panel_raw=panel_fe)


if __name__ == "__main__":
    main()
