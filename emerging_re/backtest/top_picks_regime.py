"""Top-10 ZORI picks per cohort year — regime-conditional composite variants.

Compares three composites cohort by cohort:
  BASELINE  — regime-blind, current 4-feature ZORI_MAX
  VARIANT_A — hostile-regime: drop `zori_yoy` (3 features)
  VARIANT_B — hostile-regime: flip `zori_yoy` sign to −1 (4 features, momentum reversed)

Regime bucketing (from int_national_macro_regime):
  FAVORABLE = {ACCOMMODATIVE, EARLY_RECOVERY, MID_CYCLE, LATE_CYCLE}
  HOSTILE   = {TIGHTENING, TOPPING}

For FAVORABLE cohorts, all three variants use the baseline composite and
top-10 lists are identical — collapsed to one table. For HOSTILE cohorts,
three side-by-side tables show the divergence.

Caveat: neither hostile variant is OOF-validated. TRAIN window (<=2018)
contains no TIGHTENING/TOPPING observations, so hostile-regime feature
selection can't be validated OOF. Variants are motivated a priori
(theory: momentum leads in expansions, reverses in contractions), not fit.

Run: `uv run python -m backtest.top_picks_regime`
"""

from __future__ import annotations

import argparse
from pathlib import Path

import duckdb
import pandas as pd

from ._scoring import ZORI_MAX_FEATURES, FeatureSpec, _subset
from .oof_backtest import score_with_features

WAREHOUSE_PATH = Path("data/warehouse/emerging_re.duckdb")
SNAPSHOT_YEARS = range(2015, 2024)

FAVORABLE_REGIMES = {"ACCOMMODATIVE", "EARLY_RECOVERY", "MID_CYCLE", "LATE_CYCLE"}
HOSTILE_REGIMES = {"TIGHTENING", "TOPPING"}

# Baseline = current pruned ZORI-max (4 features).
FEATURES_BASELINE = ZORI_MAX_FEATURES

# Variant A: drop momentum in hostile regime.
FEATURES_HOSTILE_A = _subset(
    "domesticmig_per_1000",
    "domesticmig_accel_3yr",
    "mf_permit_ratio_ts",
)

# Variant B: flip zori_yoy sign in hostile regime. Hand-build the tuple
# since _subset() pulls from _FEATURES_BY_COL where zori_yoy has sign +1.
FEATURES_HOSTILE_B = (
    *_subset("domesticmig_per_1000", "domesticmig_accel_3yr", "mf_permit_ratio_ts"),
    FeatureSpec("zori_yoy", "tier4_momentum", -1),
)


def load_snapshots() -> pd.DataFrame:
    con = duckdb.connect(str(WAREHOUSE_PATH), read_only=True)
    df = con.execute("""
        SELECT * FROM main_marts.mart_county_features
        WHERE EXTRACT(MONTH FROM period_end_date) = 12
          AND EXTRACT(YEAR FROM period_end_date) BETWEEN 2015 AND 2023
    """).df()
    df["period_end_date"] = pd.to_datetime(df["period_end_date"])
    return df


def load_regime_map() -> dict[int, str]:
    con = duckdb.connect(str(WAREHOUSE_PATH), read_only=True)
    df = con.execute("""
        SELECT year, macro_regime
        FROM main_intermediate.int_national_macro_regime
        WHERE year BETWEEN 2015 AND 2023
    """).df()
    return dict(zip(df["year"].astype(int), df["macro_regime"]))


def bucket(regime: str) -> str:
    if regime in HOSTILE_REGIMES:
        return "HOSTILE"
    return "FAVORABLE"


def top_n_with_edge(scored: pd.DataFrame, score_col: str, n: int) -> tuple[pd.DataFrame, float, float]:
    """Return (top-n rows, universe_mean_36mo, top_mean_36mo)."""
    top = scored.dropna(subset=[score_col]).nlargest(n, score_col)
    uni_mean = scored["zori_forward_return_36mo"].mean()
    top_mean = top["zori_forward_return_36mo"].mean()
    return top, uni_mean, top_mean


def format_top(top: pd.DataFrame, score_col: str) -> pd.DataFrame:
    d = top[[
        "fips", "county_name", "state_name", "pop_latest",
        score_col, "zori_forward_return_36mo", "target_zori_36mo_demeaned",
    ]].copy()
    d.insert(0, "rank", range(1, len(d) + 1))
    d["pop_latest"] = d["pop_latest"].astype("Int64")
    d[score_col] = d[score_col].round(3)
    d["zori_36mo_pct"] = (d["zori_forward_return_36mo"] * 100).round(2)
    d["alpha_pp"] = (d["target_zori_36mo_demeaned"] * 100).round(2)
    return d.drop(columns=["zori_forward_return_36mo", "target_zori_36mo_demeaned"])


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--top-n", type=int, default=10)
    args = parser.parse_args()

    df = load_snapshots()
    regime_map = load_regime_map()

    # Pre-score all three variants once across the full snapshot panel.
    scored_baseline = score_with_features(df, FEATURES_BASELINE, score_col="s_baseline")
    scored_a = score_with_features(df, FEATURES_HOSTILE_A, score_col="s_a")
    scored_b = score_with_features(df, FEATURES_HOSTILE_B, score_col="s_b")

    # Merge score columns onto one frame keyed by (fips, period_end_date).
    keys = ["fips", "period_end_date"]
    merged = scored_baseline.copy()
    merged["s_a"] = scored_a.set_index(keys)["s_a"].reindex(
        list(zip(merged["fips"], merged["period_end_date"]))
    ).values
    merged["s_b"] = scored_b.set_index(keys)["s_b"].reindex(
        list(zip(merged["fips"], merged["period_end_date"]))
    ).values

    print("=" * 100)
    print(f"TOP {args.top_n} ZORI PICKS — REGIME-CONDITIONAL COMPOSITE COMPARISON")
    print(f"Baseline features: {[s.column for s in FEATURES_BASELINE]}")
    print(f"Variant A (hostile): drop zori_yoy → {[s.column for s in FEATURES_HOSTILE_A]}")
    print(f"Variant B (hostile): flip zori_yoy sign to −1 → "
          f"{[(s.column, s.sign) for s in FEATURES_HOSTILE_B]}")
    print("=" * 100)

    for year in SNAPSHOT_YEARS:
        snap = merged[merged["period_end_date"] == pd.Timestamp(f"{year}-12-31")]
        if snap.empty:
            continue

        regime = regime_map.get(year, "?")
        b = bucket(regime)
        header = f"COHORT {year}-12  |  regime={regime}  |  bucket={b}  |  n_universe={len(snap)}"

        # Which score column applies under regime-conditioning?
        # Baseline is always s_baseline. Under regime conditioning:
        #   FAVORABLE → s_baseline (same as baseline)
        #   HOSTILE   → variants diverge
        if b == "FAVORABLE":
            top, uni, tm = top_n_with_edge(snap, "s_baseline", args.top_n)
            print(f"\n\n----- {header} -----")
            print(f"  All variants identical in FAVORABLE regime.")
            print(f"  universe_mean_36mo={uni*100:+.2f}%  top{args.top_n}_mean_36mo={tm*100:+.2f}%  "
                  f"edge={(tm-uni)*100:+.2f} pp")
            print(format_top(top, "s_baseline").to_string(index=False))
            continue

        # HOSTILE — three variants diverge.
        print(f"\n\n===== {header} =====")

        for label, score_col in (
            ("BASELINE (regime-blind, 4-feat)", "s_baseline"),
            ("VARIANT A (drop zori_yoy)",        "s_a"),
            ("VARIANT B (flip zori_yoy sign)",   "s_b"),
        ):
            top, uni, tm = top_n_with_edge(snap, score_col, args.top_n)
            edge = (tm - uni) * 100 if pd.notna(tm) and pd.notna(uni) else float("nan")
            print(f"\n  --- {label} ---")
            print(f"    universe_mean_36mo={uni*100:+.2f}%  top{args.top_n}_mean_36mo={tm*100:+.2f}%  "
                  f"edge={edge:+.2f} pp")
            print(format_top(top, score_col).to_string(index=False))


if __name__ == "__main__":
    main()
