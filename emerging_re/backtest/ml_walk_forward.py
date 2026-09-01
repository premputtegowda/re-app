"""ML walk-forward top-5 picker with ACS median rent as target.

Universe: pop_latest > 100K, Dec-31 cohorts.
Target:   ACS median gross rent 12mo forward change, demeaned by national mean.
          (Chosen because ACS 5-year data only observable through 2022 — 12mo
          horizon gives 3 test cohorts 2019-2021. 24mo/36mo horizons would
          only allow 1-2 test cohorts.)
Model:    LightGBM regression + Ridge baseline.
Split:    strict walk-forward per test year (train on cohorts <= Y-1).
Output:   per test year, top-5 picks with realized returns (ACS + ZORI for
          comparability with prior work), feature importance.

State cap: max 2 counties per state in top-5 to force geographic diversity.

Excludes stale/leaky features (values that don't vary over time within a fips,
because the mart carried the latest value backward — using them would leak
future info into historical rows).

Run: `uv run python -m backtest.ml_walk_forward`
"""

from __future__ import annotations

import argparse
import warnings
from dataclasses import dataclass
from pathlib import Path

import duckdb
import numpy as np
import pandas as pd

from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.impute import SimpleImputer
from sklearn.inspection import permutation_importance
from sklearn.linear_model import Ridge
from sklearn.preprocessing import StandardScaler
from scipy import stats

WAREHOUSE_PATH = Path("/Users/premputtegowda/reps/reps-tracker/emerging_re/data/warehouse/emerging_re.duckdb")
OUTPUT_DIR = Path("/Users/premputtegowda/reps/reps-tracker/emerging_re/data/curated/backtest/ml")

TARGET_COL = "target_acs_rent_12mo_demeaned"
HORIZON_YEARS = 1  # 12mo

# Features carried "latest value backward" in the mart — using them leaks
# future info. Verified by n_unique=1 over 8 years for sample fips.
LEAKY_FEATURES = {
    "rental_vacancy_rate",
    "rent_to_income_ratio",
    "cap_rate_proxy",
    "renter_share",
    "mf_permit_ratio",
    "rental_vacancy_change_3yr",
    "pcpi_cagr_5yr",
    "n_supersectors_reporting",
}

NON_FEATURE_COLS = {
    "fips", "period_end_date", "county_name", "state_name", "pop_latest",
    "any_disqualifier",
    # Existing target family from the mart — drop all so training only uses features.
    "hpi_forward_return_24mo", "target_hpi_24mo_demeaned",
    "zori_forward_return_24mo", "target_zori_24mo_demeaned",
    "hpi_forward_return_36mo", "target_hpi_36mo_demeaned",
    "zori_forward_return_36mo", "target_zori_36mo_demeaned",
    "hpi_forward_return_60mo", "target_hpi_60mo_demeaned",
    "zori_forward_return_60mo", "target_zori_60mo_demeaned",
    # ACS-derived cols we're adding — drop the raw ones, keep as target only.
    "median_gross_rent", "median_gross_rent_forward",
    "acs_forward_return", "national_mean_return",
    TARGET_COL,
    "year",
}

CATEGORICAL_COLS = {"anchor_type", "macro_regime"}


@dataclass
class WalkStepResult:
    test_year: int
    n_train: int
    n_test: int
    gbm_top5: pd.DataFrame
    ridge_top5: pd.DataFrame
    feature_importance: pd.DataFrame
    gbm_spearman: float
    ridge_spearman: float


def load_mart_panel() -> pd.DataFrame:
    """Load full annual panel (Dec-31), join macro_regime, filter tertiary (100-300K)."""
    con = duckdb.connect(str(WAREHOUSE_PATH), read_only=True)
    df = con.execute("""
        SELECT f.*, mr.macro_regime
        FROM main_marts.mart_county_features f
        LEFT JOIN main_intermediate.int_national_macro_regime mr
            ON EXTRACT(YEAR FROM f.period_end_date) = mr.year
        WHERE EXTRACT(MONTH FROM f.period_end_date) = 12
          AND f.pop_latest > 100000
          AND f.pop_latest <= 300000
    """).df()
    df["period_end_date"] = pd.to_datetime(df["period_end_date"])
    df["year"] = df["period_end_date"].dt.year
    return df


def build_acs_target(horizon_years: int) -> pd.DataFrame:
    """ACS median gross rent forward change (horizon_years), demeaned by universe mean.

    Uses latest as_of per (fips, period_end_date) — one row per calendar year.
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
    acs = acs.sort_values(["fips", "year"]).reset_index(drop=True)

    # Forward-join: rent[year + horizon] onto rent[year].
    forward = acs[["fips", "year", "median_gross_rent"]].rename(
        columns={"median_gross_rent": "median_gross_rent_forward"}
    )
    forward["year"] = forward["year"] - horizon_years  # shift back for join
    merged = acs.merge(forward, on=["fips", "year"], how="left")
    merged["acs_forward_return"] = (
        merged["median_gross_rent_forward"] / merged["median_gross_rent"] - 1
    )

    # Demean by national (universe) mean per cohort year — same convention
    # as target_zori_*_demeaned. Restrict to counties with observed target.
    year_mean = (
        merged.dropna(subset=["acs_forward_return"])
        .groupby("year")["acs_forward_return"].mean()
    )
    merged["national_mean_return"] = merged["year"].map(year_mean)
    merged[TARGET_COL] = merged["acs_forward_return"] - merged["national_mean_return"]

    return merged[[
        "fips", "period_end_date", "median_gross_rent",
        "median_gross_rent_forward", "acs_forward_return",
        "national_mean_return", TARGET_COL,
    ]]


def build_feature_matrix(panel: pd.DataFrame) -> tuple[pd.DataFrame, list[str]]:
    """One-hot encode categoricals + drop leaky/non-feature cols."""
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


def pick_top_n_with_state_cap(
    test_df: pd.DataFrame,
    score_col: str,
    n: int,
    max_per_state: int = 2,
) -> pd.DataFrame:
    ranked = test_df.dropna(subset=[score_col]).sort_values(score_col, ascending=False)
    picked_rows: list[pd.Series] = []
    state_counts: dict[str, int] = {}
    for _, row in ranked.iterrows():
        state = row["state_name"]
        if state_counts.get(state, 0) >= max_per_state:
            continue
        picked_rows.append(row)
        state_counts[state] = state_counts.get(state, 0) + 1
        if len(picked_rows) >= n:
            break
    return pd.DataFrame(picked_rows) if picked_rows else pd.DataFrame()


def evaluate_top5(top5: pd.DataFrame, universe: pd.DataFrame, return_col: str) -> dict:
    uni_returns = universe.dropna(subset=[return_col])[return_col]
    if uni_returns.empty or top5.empty or return_col not in top5.columns:
        return {"top5_mean": None, "universe_mean": None, "edge_pp": None, "avg_pct": None}
    top5_returns = top5[return_col].dropna()
    if top5_returns.empty:
        return {"top5_mean": None, "universe_mean": float(uni_returns.mean()),
                "edge_pp": None, "avg_pct": None}
    tm = float(top5_returns.mean())
    um = float(uni_returns.mean())
    percentiles = top5_returns.apply(lambda r: (uni_returns < r).mean() * 100)
    return {
        "top5_mean": tm,
        "universe_mean": um,
        "edge_pp": (tm - um) * 100,
        "avg_pct": float(percentiles.mean()),
    }


def train_and_predict(
    train: pd.DataFrame,
    test: pd.DataFrame,
    feature_cols: list[str],
) -> tuple[np.ndarray, np.ndarray, pd.DataFrame]:
    train_valid = train.dropna(subset=[TARGET_COL]).copy()
    X_train_full = train_valid[feature_cols].astype(float)
    y_train = train_valid[TARGET_COL].astype(float)

    # Drop features with < 2 distinct non-null values in training window —
    # HGB's binning fails on constant / all-null columns.
    valid_cols = [c for c in feature_cols if X_train_full[c].nunique(dropna=True) >= 2]
    dropped_cols = [c for c in feature_cols if c not in valid_cols]
    if dropped_cols:
        print(f"    Dropped {len(dropped_cols)} constant/all-null features "
              f"in this train window (e.g. {dropped_cols[:5]})")

    X_train = X_train_full[valid_cols]
    X_test = test[valid_cols].astype(float)
    feature_cols = valid_cols

    # HistGradientBoostingRegressor handles NaN natively (no imputation needed).
    gbm = HistGradientBoostingRegressor(
        max_iter=500, learning_rate=0.03, max_leaf_nodes=31,
        min_samples_leaf=20, l2_regularization=0.1,
        max_features=0.7,
        early_stopping=True, validation_fraction=0.15,
        n_iter_no_change=25, random_state=42,
    )
    gbm.fit(X_train, y_train)
    gbm_pred = gbm.predict(X_test)

    # Permutation importance on a training subset (for speed) — held-out
    # would be ideal but we've got tight sample sizes; use train as proxy.
    perm_sample = train_valid.sample(min(len(train_valid), 800), random_state=42)
    X_perm = perm_sample[feature_cols].astype(float)
    y_perm = perm_sample[TARGET_COL].astype(float)
    perm = permutation_importance(
        gbm, X_perm, y_perm, n_repeats=3, random_state=42, n_jobs=-1,
    )
    gbm_importance = perm.importances_mean

    imp = SimpleImputer(strategy="median")
    X_train_imp = imp.fit_transform(X_train)
    X_test_imp = imp.transform(X_test)
    sc = StandardScaler()
    X_train_sc = sc.fit_transform(X_train_imp)
    X_test_sc = sc.transform(X_test_imp)
    ridge = Ridge(alpha=10.0, random_state=42)
    ridge.fit(X_train_sc, y_train)
    ridge_pred = ridge.predict(X_test_sc)

    fi = pd.DataFrame({
        "feature": feature_cols,
        "gbm_importance": gbm_importance,
        "ridge_coef_abs": np.abs(ridge.coef_),
    }).sort_values("gbm_importance", ascending=False)

    return gbm_pred, ridge_pred, fi


def walk_forward(panel: pd.DataFrame, feature_cols: list[str], test_years: list[int]) -> list[WalkStepResult]:
    results: list[WalkStepResult] = []
    for Y in test_years:
        train = panel[panel["year"] <= Y - HORIZON_YEARS].copy()
        train = train.dropna(subset=[TARGET_COL])
        test = panel[panel["year"] == Y].copy()
        if train.empty or test.empty:
            print(f"  SKIP {Y}: train n={len(train)}, test n={len(test)}")
            continue

        gbm_pred, ridge_pred, fi = train_and_predict(train, test, feature_cols)
        test = test.copy()
        test["gbm_pred"] = gbm_pred
        test["ridge_pred"] = ridge_pred

        gbm_top5 = pick_top_n_with_state_cap(test, "gbm_pred", n=5)
        ridge_top5 = pick_top_n_with_state_cap(test, "ridge_pred", n=5)

        test_valid = test.dropna(subset=[TARGET_COL, "gbm_pred"])
        gbm_sp = float(stats.spearmanr(test_valid["gbm_pred"], test_valid[TARGET_COL]).statistic) if len(test_valid) >= 10 else float("nan")
        ridge_sp = float(stats.spearmanr(test_valid["ridge_pred"], test_valid[TARGET_COL]).statistic) if len(test_valid) >= 10 else float("nan")

        results.append(WalkStepResult(
            test_year=Y, n_train=len(train), n_test=len(test),
            gbm_top5=gbm_top5, ridge_top5=ridge_top5,
            feature_importance=fi,
            gbm_spearman=gbm_sp, ridge_spearman=ridge_sp,
        ))
    return results


def print_report(results: list[WalkStepResult], panel: pd.DataFrame) -> None:
    print("\n" + "=" * 110)
    print(f"ML WALK-FORWARD TOP-5 — ACS {HORIZON_YEARS*12}mo REL RENT GROWTH (universe: tertiary 100-300K)")
    print("=" * 110)

    for r in results:
        universe = panel[panel["year"] == r.test_year]
        print(f"\n===== TEST YEAR {r.test_year}   (n_train={r.n_train}, n_test={r.n_test}) =====")
        print(f"  Spearman on {TARGET_COL}:  GBM={r.gbm_spearman:+.4f}   Ridge={r.ridge_spearman:+.4f}")

        for label, top5 in [("GBM", r.gbm_top5), ("Ridge", r.ridge_top5)]:
            acs_stats = evaluate_top5(top5, universe, "acs_forward_return")
            zori_stats = evaluate_top5(top5, universe, "zori_forward_return_36mo")

            def _fmt(v, unit="%", decimals=2):
                if v is None or (isinstance(v, float) and np.isnan(v)):
                    return "  n/a "
                return f"{v:+.{decimals}f}{unit}"

            acs_edge_str = _fmt(acs_stats["edge_pp"], "pp")
            zori_edge_str = _fmt(zori_stats["edge_pp"], "pp")
            print(f"\n  --- {label} top-5 ---")
            print(f"    ACS {HORIZON_YEARS*12}mo:  top5_mean={_fmt(acs_stats['top5_mean']*100 if acs_stats['top5_mean'] is not None else None)}"
                  f"  uni_mean={_fmt(acs_stats['universe_mean']*100 if acs_stats['universe_mean'] is not None else None)}"
                  f"  edge={acs_edge_str}  avg_pct=p{acs_stats['avg_pct']:.1f}" if acs_stats['avg_pct'] is not None else
                  f"    ACS {HORIZON_YEARS*12}mo:  (no valid returns)")
            print(f"    ZORI 36mo:   top5_mean={_fmt(zori_stats['top5_mean']*100 if zori_stats['top5_mean'] is not None else None)}"
                  f"  uni_mean={_fmt(zori_stats['universe_mean']*100 if zori_stats['universe_mean'] is not None else None)}"
                  f"  edge={zori_edge_str}  avg_pct=p{zori_stats['avg_pct']:.1f}" if zori_stats['avg_pct'] is not None else
                  f"    ZORI 36mo:   (no valid returns)")

            if top5.empty:
                continue
            display = top5[["fips", "county_name", "state_name", "pop_latest",
                            f"{label.lower()}_pred",
                            "acs_forward_return", "zori_forward_return_36mo"]].copy()
            display.insert(0, "rank", range(1, len(display) + 1))
            display["pop_latest"] = display["pop_latest"].astype("Int64")
            display[f"{label.lower()}_pred"] = display[f"{label.lower()}_pred"].round(4)
            display["acs_ret_pct"] = (display["acs_forward_return"] * 100).round(2)
            display["zori36_ret_pct"] = (display["zori_forward_return_36mo"] * 100).round(2)
            display = display.drop(columns=["acs_forward_return", "zori_forward_return_36mo"])
            print(display.to_string(index=False))

        print(f"\n  --- Top 15 GBM features by permutation importance (of {len(r.feature_importance)} total) ---")
        top_fi = r.feature_importance.head(15).copy()
        top_fi["gbm_importance"] = top_fi["gbm_importance"].round(5)
        top_fi["ridge_coef_abs"] = top_fi["ridge_coef_abs"].round(4)
        print(top_fi.to_string(index=False))

    print("\n" + "=" * 110)
    print("SUMMARY ACROSS TEST YEARS")
    print("=" * 110)
    rows = []
    for r in results:
        universe = panel[panel["year"] == r.test_year]
        for label, top5 in [("GBM", r.gbm_top5), ("Ridge", r.ridge_top5)]:
            acs_s = evaluate_top5(top5, universe, "acs_forward_return")
            zori_s = evaluate_top5(top5, universe, "zori_forward_return_36mo")
            rows.append({
                "year": r.test_year, "model": label,
                "acs_top5_ret": acs_s["top5_mean"] * 100 if acs_s["top5_mean"] is not None else None,
                "acs_uni_ret": acs_s["universe_mean"] * 100 if acs_s["universe_mean"] is not None else None,
                "acs_edge_pp": acs_s["edge_pp"],
                "zori36_top5_ret": zori_s["top5_mean"] * 100 if zori_s["top5_mean"] is not None else None,
                "zori36_edge_pp": zori_s["edge_pp"],
                "spearman": r.gbm_spearman if label == "GBM" else r.ridge_spearman,
            })
    sdf = pd.DataFrame(rows)
    for c in sdf.select_dtypes(include=[float, "float64"]).columns:
        sdf[c] = sdf[c].astype(float).round(3)
    print(sdf.to_string(index=False))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--test-years", type=int, nargs="+", default=[2019, 2020, 2021])
    args = parser.parse_args()

    print("Loading mart panel (pop > 100K, Dec-31 cohorts)...")
    panel = load_mart_panel()
    print(f"  {len(panel)} rows across years {panel['year'].min()}-{panel['year'].max()}")

    print(f"Building ACS {HORIZON_YEARS*12}mo target from stg_census_acs...")
    acs_target = build_acs_target(HORIZON_YEARS)
    print(f"  {len(acs_target)} ACS rows, {acs_target[TARGET_COL].notna().sum()} with observed target")

    panel = panel.merge(acs_target, on=["fips", "period_end_date"], how="left")
    print(f"  After merge: {panel[TARGET_COL].notna().sum()} rows with ACS target in universe")

    print("Building feature matrix...")
    panel_fe, feature_cols = build_feature_matrix(panel)
    print(f"  {len(feature_cols)} features after leaky-column + target exclusion")

    print(f"Walking forward test years: {args.test_years}")
    results = walk_forward(panel_fe, feature_cols, args.test_years)

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    print_report(results, panel_fe)


if __name__ == "__main__":
    main()
