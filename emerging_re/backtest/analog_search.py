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
Walk-forward: for test year Y, use only winners from cohorts <= Y-3
              (need observed forward returns for training).

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

TARGET_COL = "target_acs_rent_36mo_demeaned"  # winner-identification target (2008-2019 observable)
REALIZED_RETURN_COL_ACS = "acs_forward_return_36mo"     # ACS 36mo observable only through cohort 2019
REALIZED_RETURN_COL_ZORI36 = "zori_forward_return_36mo" # ZORI 36mo observable through cohort 2022
REALIZED_RETURN_COL_ZORI24 = "zori_forward_return_24mo" # ZORI 24mo observable through cohort 2023
HORIZON_YEARS = 3

WINNER_TOP_PCT = 0.10  # top 10% per cohort year
TOP_K_ANALOGS = 5      # aggregate similarity: mean of top-K winner matches
DIVERSITY_HHI_MAX = 0.10  # filter to diversified employment (drops top ~13% concentrated)

# Reuse same feature exclusions as ml_walk_forward.
LEAKY_FEATURES = {
    "rental_vacancy_rate", "rent_to_income_ratio", "cap_rate_proxy",
    "renter_share", "mf_permit_ratio", "rental_vacancy_change_3yr",
    "pcpi_cagr_5yr", "n_supersectors_reporting",
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
    REALIZED_RETURN_COL_ACS, TARGET_COL,
    REALIZED_RETURN_COL_ZORI36, REALIZED_RETURN_COL_ZORI24,
    "year",
}
CATEGORICAL_COLS = {"anchor_type", "macro_regime"}


@dataclass
class StepResult:
    test_year: int
    n_winners: int
    n_train_cohorts: int
    top5: pd.DataFrame  # with realized returns + matched winners
    universe_mean_acs_36mo: float   # NaN if not observable
    universe_mean_zori_36mo: float  # NaN if not observable
    universe_mean_zori_24mo: float  # NaN if not observable


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


def build_acs_target(horizon_years: int = 3) -> pd.DataFrame:
    """ACS median gross rent 36mo forward change, demeaned by NATIONAL mean.

    Uses latest as_of per (fips, period_end_date). National demeaning uses
    all counties in the ACS 5yr panel (not just tertiary) to match the
    demeaning convention of target_zori_*_demeaned in the mart.

    Returns: (fips, period_end_date, acs_forward_return_36mo,
              target_acs_rent_36mo_demeaned)
    """
    con = duckdb.connect(str(WAREHOUSE_PATH), read_only=True)
    acs = con.execute("""
        SELECT fips, period_end_date, median_gross_rent
        FROM main_staging.stg_census_acs
        WHERE median_gross_rent IS NOT NULL
        QUALIFY row_number() OVER (
            PARTITION BY fips, period_end_date ORDER BY as_of_date DESC
        ) = 1
    """).df()
    acs["period_end_date"] = pd.to_datetime(acs["period_end_date"])
    acs["year"] = acs["period_end_date"].dt.year

    # Forward join: rent[year + horizon] onto rent[year].
    forward = acs[["fips", "year", "median_gross_rent"]].rename(
        columns={"median_gross_rent": "median_gross_rent_forward"}
    )
    forward["year"] = forward["year"] - horizon_years  # shift back for join
    merged = acs.merge(forward, on=["fips", "year"], how="left")
    merged[REALIZED_RETURN_COL_ACS] = (
        merged["median_gross_rent_forward"] / merged["median_gross_rent"] - 1
    )

    # Demean by NATIONAL mean per cohort year (across ALL counties with target).
    year_mean = (
        merged.dropna(subset=[REALIZED_RETURN_COL_ACS])
        .groupby("year")[REALIZED_RETURN_COL_ACS].mean()
    )
    merged[TARGET_COL] = merged[REALIZED_RETURN_COL_ACS] - merged["year"].map(year_mean)

    return merged[["fips", "period_end_date", REALIZED_RETURN_COL_ACS, TARGET_COL]]


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


def identify_winners(panel: pd.DataFrame, train_years: list[int]) -> pd.DataFrame:
    """Top-decile counties by target_zori_36mo_demeaned within each train year."""
    train = panel[panel["year"].isin(train_years)].dropna(subset=[TARGET_COL]).copy()
    if train.empty:
        return train
    winners = []
    for year, sub in train.groupby("year"):
        threshold = sub[TARGET_COL].quantile(1 - WINNER_TOP_PCT)
        w = sub[sub[TARGET_COL] >= threshold].copy()
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


def walk_forward(
    panel_z: pd.DataFrame,
    panel_raw: pd.DataFrame,
    feature_cols: list[str],
    test_years: list[int],
) -> list[StepResult]:
    results: list[StepResult] = []
    for Y in test_years:
        train_years = [y for y in panel_z["year"].unique() if y <= Y - HORIZON_YEARS]
        if not train_years:
            print(f"  SKIP {Y}: no train years available")
            continue
        winners = identify_winners(panel_z, train_years)
        if winners.empty:
            print(f"  SKIP {Y}: no winners identified in train {train_years}")
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

        # Merge realized returns from raw panel — ACS 36mo + ZORI 36mo + ZORI 24mo.
        realized_cols = [REALIZED_RETURN_COL_ACS, REALIZED_RETURN_COL_ZORI36, REALIZED_RETURN_COL_ZORI24]
        realized = panel_raw[panel_raw["year"] == Y][["fips", *realized_cols]]
        drop_from_test = [c for c in realized_cols if c in test_z.columns]
        test_z = test_z.drop(columns=drop_from_test).merge(realized, on="fips", how="left")

        top5 = pick_top_n_with_state_cap(test_z, "analog_score", n=5, max_per_state=2)

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
            universe_mean_zori_36mo=_mean(REALIZED_RETURN_COL_ZORI36),
            universe_mean_zori_24mo=_mean(REALIZED_RETURN_COL_ZORI24),
        ))

    return results


def print_report(results: list[StepResult]) -> None:
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
        top5_zori36_mean = _top5_mean(REALIZED_RETURN_COL_ZORI36)
        top5_zori24_mean = _top5_mean(REALIZED_RETURN_COL_ZORI24)

        def _edge(top: float, uni: float) -> float:
            return (top - uni) * 100 if pd.notna(top) and pd.notna(uni) else float("nan")

        acs_edge = _edge(top5_acs_mean, r.universe_mean_acs_36mo)
        zori36_edge = _edge(top5_zori36_mean, r.universe_mean_zori_36mo)
        zori24_edge = _edge(top5_zori24_mean, r.universe_mean_zori_24mo)

        def _fmt(v: float, unit: str = "%") -> str:
            return f"{v:+7.2f}{unit}" if pd.notna(v) else "   n/a  "

        print(f"\n===== TEST YEAR {r.test_year}  (train cohorts={r.n_train_cohorts}, winners={r.n_winners}) =====")
        print(f"  ACS 36mo:   top5={_fmt(top5_acs_mean*100)}  uni={_fmt(r.universe_mean_acs_36mo*100)}  edge={_fmt(acs_edge, 'pp')}")
        print(f"  ZORI 36mo:  top5={_fmt(top5_zori36_mean*100)}  uni={_fmt(r.universe_mean_zori_36mo*100)}  edge={_fmt(zori36_edge, 'pp')}")
        print(f"  ZORI 24mo:  top5={_fmt(top5_zori24_mean*100)}  uni={_fmt(r.universe_mean_zori_24mo*100)}  edge={_fmt(zori24_edge, 'pp')}")

        if r.top5.empty:
            print("  (no picks)")
            continue

        for i, (_, row) in enumerate(r.top5.iterrows(), start=1):
            acs_ret = row.get(REALIZED_RETURN_COL_ACS, float("nan"))
            zori36_ret = row.get(REALIZED_RETURN_COL_ZORI36, float("nan"))
            zori24_ret = row.get(REALIZED_RETURN_COL_ZORI24, float("nan"))
            def _rf(v):
                return f"{v*100:+6.2f}%" if pd.notna(v) else "  n/a "
            print(f"  #{i}  {row['county_name']:<22} {row['state_name']:<16} "
                  f"pop={int(row['pop_latest']):>7,}   sim={row['analog_score']:.4f}   "
                  f"ACS36={_rf(acs_ret)}  ZORI36={_rf(zori36_ret)}  ZORI24={_rf(zori24_ret)}")
            print(f"      top analogs: {row['top_analogs']}")

        summary_rows.append({
            "year": r.test_year,
            "n_train_cohorts": r.n_train_cohorts,
            "n_winners": r.n_winners,
            "acs36_top5": top5_acs_mean * 100 if pd.notna(top5_acs_mean) else None,
            "acs36_uni": r.universe_mean_acs_36mo * 100 if pd.notna(r.universe_mean_acs_36mo) else None,
            "acs36_edge_pp": acs_edge if pd.notna(acs_edge) else None,
            "zori36_top5": top5_zori36_mean * 100 if pd.notna(top5_zori36_mean) else None,
            "zori36_uni": r.universe_mean_zori_36mo * 100 if pd.notna(r.universe_mean_zori_36mo) else None,
            "zori36_edge_pp": zori36_edge if pd.notna(zori36_edge) else None,
            "zori24_top5": top5_zori24_mean * 100 if pd.notna(top5_zori24_mean) else None,
            "zori24_uni": r.universe_mean_zori_24mo * 100 if pd.notna(r.universe_mean_zori_24mo) else None,
            "zori24_edge_pp": zori24_edge if pd.notna(zori24_edge) else None,
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


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--test-years", type=int, nargs="+", default=[2019, 2020, 2021, 2022, 2023])
    args = parser.parse_args()

    print("Loading tertiary panel (100-300K, Dec-31 cohorts)...")
    panel = load_tertiary_panel()
    print(f"  {len(panel)} rows across years {panel['year'].min()}-{panel['year'].max()}")

    print("Building ACS 36mo target from stg_census_acs...")
    acs_target = build_acs_target(horizon_years=HORIZON_YEARS)
    print(f"  {len(acs_target)} ACS rows, {acs_target[TARGET_COL].notna().sum()} with observed 36mo target")

    panel = panel.merge(acs_target, on=["fips", "period_end_date"], how="left")
    n_with_target = panel[TARGET_COL].notna().sum()
    print(f"  After merge: {n_with_target} panel rows have observed ACS 36mo target")

    print("Building feature matrix + z-scoring within cohort...")
    panel_fe, feature_cols = build_feature_matrix(panel)
    print(f"  {len(feature_cols)} features")
    panel_z = zscore_within_cohort(panel_fe, feature_cols)

    print(f"Walk-forward analog search on test years: {args.test_years}")
    results = walk_forward(panel_z, panel_fe, feature_cols, args.test_years)

    print_report(results)


if __name__ == "__main__":
    main()
