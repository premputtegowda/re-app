"""kNN walk-forward picker — classical k-nearest-neighbors regression.

Sibling to analog_search.py. Key difference:
  - analog_search: reference set = top-decile "winners" only; score = mean
    of top-K cosine similarities to those winners.
  - knn_search   : reference set = ALL prior observable training rows;
    prediction = mean of top-K neighbors' realized target values.

Same universe, same features, same cosine distance, same state cap, same
strict-PIT flag — the only algorithmic difference is the reference set and
the aggregation. This makes the two directly A/B-comparable on the same
realized-return metric.

Run: `python -m backtest.knn_search --target total_return --k 5`
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd

from backtest.analog_search import (
    WAREHOUSE_PATH,
    DIVERSITY_HHI_MAX, HORIZON_YEARS, MIN_TRAIN_YEARS,
    TARGET_COL, TARGET_COL_TOTAL_RETURN,
    REALIZED_RETURN_COL_ACS, REALIZED_RETURN_COL_TOTAL,
    REALIZED_CAP_ENTRY_COL, REALIZED_CAP_EXIT_COL,
    REALIZED_RETURN_COL_ZORI36, REALIZED_RETURN_COL_ZORI24,
    REALIZED_TOTAL_ZORI36_COL, REALIZED_TOTAL_ZORI24_COL,
    load_tertiary_panel, load_mf_context, build_acs_target,
    build_feature_matrix, zscore_within_cohort,
    cosine_similarity_matrix, pick_top_n_with_state_cap,
    build_walk_forward_schedule,
)

DEFAULT_K = 5


@dataclass
class KNNResult:
    test_year: int
    n_train_rows: int
    n_train_cohorts: int
    top5: pd.DataFrame
    universe_mean_acs_36mo: float
    universe_mean_total_36mo: float
    universe_mean_zori_36mo: float
    universe_mean_zori_24mo: float


def knn_predict(sim_matrix: np.ndarray, train_targets: np.ndarray, k: int) -> tuple[np.ndarray, np.ndarray]:
    """For each candidate row in sim_matrix, average target across its top-k neighbors.

    sim_matrix    : (n_candidates, n_train)   cosine similarities
    train_targets : (n_train,)                realized target per training row
    k             : neighbors to average (clamped to n_train)

    Returns (predictions, top_k_idx):
      predictions : (n_candidates,)
      top_k_idx   : (n_candidates, k_eff) — which training rows were chosen (for interpretability)
    """
    n_cand, n_train = sim_matrix.shape
    if n_train == 0:
        return np.full(n_cand, np.nan), np.empty((n_cand, 0), dtype=int)
    k_eff = min(k, n_train)
    top_k_idx = np.argsort(sim_matrix, axis=1)[:, -k_eff:]      # highest sims last
    top_k_targets = train_targets[top_k_idx]                    # (n_cand, k_eff)
    predictions = np.nanmean(top_k_targets, axis=1)
    return predictions, top_k_idx


def knn_walk_forward(
    panel_z: pd.DataFrame,
    panel_raw: pd.DataFrame,
    feature_cols: list[str],
    test_years: list[int] | None = None,
    min_train_years: int = MIN_TRAIN_YEARS,
    target_col: str = TARGET_COL_TOTAL_RETURN,
    strict_pit_targets: bool = False,
    k: int = DEFAULT_K,
) -> list[KNNResult]:
    schedule = build_walk_forward_schedule(
        panel_z, test_years, min_train_years,
        target_col=target_col, strict_pit_targets=strict_pit_targets,
    )
    pit_note = " STRICT-PIT" if strict_pit_targets else ""
    print(f"\nkNN walk-forward schedule{pit_note} (k={k}, target={target_col}, {len(schedule)} iterations):")
    for step in schedule:
        n = step["n_train_years"]
        marker = "  " if n >= min_train_years else "  SKIP "
        span = f"{min(step['train_years'])}-{max(step['train_years'])}" if step["train_years"] else "(none)"
        print(f"{marker}test={step['test_year']}   train_cohorts={n:2d}   span={span}")

    results: list[KNNResult] = []
    for step in schedule:
        Y = step["test_year"]
        train_years = step["train_years"]
        if len(train_years) < min_train_years:
            continue

        # Full training pool: ALL prior observable rows (not just winners).
        train_pool = panel_z[
            panel_z["year"].isin(train_years) & panel_z[target_col].notna()
        ].copy()
        if train_pool.empty:
            print(f"  SKIP {Y}: empty training pool")
            continue

        # Build interpretability labels for each training row.
        train_pool["_train_label"] = (
            train_pool["county_name"] + ", " + train_pool["state_name"] + " ("
            + train_pool["year"].astype(str) + ")"
        )

        train_features = train_pool[feature_cols].astype(float).values
        train_targets = train_pool[target_col].values

        test_z = panel_z[panel_z["year"] == Y].copy()
        cand_features = test_z[feature_cols].astype(float).values

        # (n_candidates, n_train)
        sim = cosine_similarity_matrix(cand_features, train_features)
        preds, top_k_idx = knn_predict(sim, train_targets, k=k)

        test_z["knn_predicted_target"] = preds
        train_labels = train_pool["_train_label"].values
        test_z["top_neighbors"] = [
            ", ".join(train_labels[top_k_idx[i]]) for i in range(len(test_z))
        ]

        # ── Attach realized returns (mirror analog_search.walk_forward) ──
        realized_cols = [
            REALIZED_RETURN_COL_ACS, REALIZED_RETURN_COL_TOTAL,
            REALIZED_CAP_ENTRY_COL, REALIZED_CAP_EXIT_COL,
            REALIZED_RETURN_COL_ZORI36, REALIZED_RETURN_COL_ZORI24,
        ]
        available_cols = [c for c in realized_cols if c in panel_raw.columns]
        realized = panel_raw[panel_raw["year"] == Y][["fips", *available_cols]]
        drop_from_test = [c for c in available_cols if c in test_z.columns]
        test_z = test_z.drop(columns=drop_from_test).merge(realized, on="fips", how="left")

        entry_cap = panel_raw[panel_raw["year"] == Y][["fips", "cap_rate_proxy"]].rename(
            columns={"cap_rate_proxy": "cap_rate_entry"}
        )
        test_z = test_z.merge(entry_cap, on="fips", how="left")

        exit_year_panel = panel_raw[panel_raw["year"] == Y + HORIZON_YEARS]
        if not exit_year_panel.empty:
            exit_cap = exit_year_panel[["fips", "cap_rate_proxy"]].rename(
                columns={"cap_rate_proxy": "cap_rate_exit"}
            )
            test_z = test_z.merge(exit_cap, on="fips", how="left")
        else:
            test_z["cap_rate_exit"] = np.nan

        exit_2yr_panel = panel_raw[panel_raw["year"] == Y + 2]
        if not exit_2yr_panel.empty:
            exit_cap_2yr = exit_2yr_panel[["fips", "cap_rate_proxy"]].rename(
                columns={"cap_rate_proxy": "cap_rate_exit_2yr"}
            )
            test_z = test_z.merge(exit_cap_2yr, on="fips", how="left")
        else:
            test_z["cap_rate_exit_2yr"] = np.nan

        # ZORI-based composite total returns (same math as analog_search).
        test_z[REALIZED_TOTAL_ZORI36_COL] = (
            (1 + test_z[REALIZED_RETURN_COL_ZORI36])
            * (test_z["cap_rate_entry"] / test_z["cap_rate_exit"]) - 1
        )
        test_z[REALIZED_TOTAL_ZORI24_COL] = (
            (1 + test_z[REALIZED_RETURN_COL_ZORI24])
            * (test_z["cap_rate_entry"] / test_z["cap_rate_exit_2yr"]) - 1
        )

        top5 = pick_top_n_with_state_cap(test_z, "knn_predicted_target", n=5, max_per_state=2)

        results.append(KNNResult(
            test_year=Y,
            n_train_rows=len(train_pool),
            n_train_cohorts=len(train_years),
            top5=top5,
            universe_mean_acs_36mo=(
                test_z[REALIZED_RETURN_COL_ACS].mean()
                if REALIZED_RETURN_COL_ACS in test_z.columns else np.nan
            ),
            universe_mean_total_36mo=(
                test_z[REALIZED_TOTAL_ZORI36_COL].mean()
                if REALIZED_TOTAL_ZORI36_COL in test_z.columns else np.nan
            ),
            universe_mean_zori_36mo=(
                test_z[REALIZED_RETURN_COL_ZORI36].mean()
                if REALIZED_RETURN_COL_ZORI36 in test_z.columns else np.nan
            ),
            universe_mean_zori_24mo=(
                test_z[REALIZED_RETURN_COL_ZORI24].mean()
                if REALIZED_RETURN_COL_ZORI24 in test_z.columns else np.nan
            ),
        ))
    return results


def print_knn_report(results: list[KNNResult]) -> None:
    print("\n" + "=" * 130)
    print(f"kNN TOP-5 — predicted target = mean of top-{DEFAULT_K} nearest-neighbors' realized targets (cosine over z-scored features)")
    print("=" * 130)

    summary_rows = []
    for r in results:
        top5 = r.top5
        def _mean(col):
            return top5[col].mean(skipna=True) if col in top5.columns else np.nan

        top5_acs36    = _mean(REALIZED_RETURN_COL_ACS)
        top5_total36  = _mean(REALIZED_TOTAL_ZORI36_COL)
        top5_zori36   = _mean(REALIZED_RETURN_COL_ZORI36)
        top5_zori24   = _mean(REALIZED_RETURN_COL_ZORI24)

        uni_acs36     = r.universe_mean_acs_36mo
        uni_total36   = r.universe_mean_total_36mo
        uni_zori36    = r.universe_mean_zori_36mo
        uni_zori24    = r.universe_mean_zori_24mo

        def _fmt(v, w=6):
            return f"{v*100:+{w}.2f}%" if pd.notna(v) else f"{'   n/a  ':>{w+1}s}"
        def _edge(a, b):
            return f"{(a-b)*100:+.2f}pp" if pd.notna(a) and pd.notna(b) else "   n/a "

        print(f"\n===== TEST YEAR {r.test_year}  (train rows={r.n_train_rows}, cohorts={r.n_train_cohorts}) =====")
        print(f"  ACS RENT 36mo:   top5={_fmt(top5_acs36)}   uni={_fmt(uni_acs36)}   edge={_edge(top5_acs36, uni_acs36)}")
        print(f"  TOTAL RETN 36mo: top5={_fmt(top5_total36)}   uni={_fmt(uni_total36)}   edge={_edge(top5_total36, uni_total36)}")
        print(f"  ZORI 36mo:       top5={_fmt(top5_zori36)}   uni={_fmt(uni_zori36)}   edge={_edge(top5_zori36, uni_zori36)}")
        print(f"  ZORI 24mo:       top5={_fmt(top5_zori24)}   uni={_fmt(uni_zori24)}   edge={_edge(top5_zori24, uni_zori24)}")

        for i, (_, row) in enumerate(top5.iterrows(), 1):
            pred = row["knn_predicted_target"] * 100
            cap_e = row.get("cap_rate_entry", np.nan)
            cap_x = row.get("cap_rate_exit", np.nan)
            cap_str = (
                f"cap {cap_e*100:.2f}%→{cap_x*100:.2f}% ({(cap_x-cap_e)*10000:+.0f}bps)"
                if pd.notna(cap_e) and pd.notna(cap_x)
                else (f"cap {cap_e*100:.2f}% (exit n/a)" if pd.notna(cap_e) else "cap n/a")
            )
            zori36 = row.get(REALIZED_RETURN_COL_ZORI36, np.nan)
            tr36 = row.get(REALIZED_TOTAL_ZORI36_COL, np.nan)
            zori_str = f"ZORI36={zori36*100:+.2f}%" if pd.notna(zori36) else "ZORI36=  n/a "
            tr_str = f"TR-ZORI36={tr36*100:+.2f}%" if pd.notna(tr36) else "TR-ZORI36=  n/a "
            print(f"  #{i}  {row['county_name']:22s} {row['state_name']:16s}  pop={int(row['pop_latest']):>7,}   "
                  f"pred={pred:+.2f}%   {cap_str}   {zori_str}   {tr_str}")
            neighbors = row.get("top_neighbors", "")
            if neighbors:
                # Show only first 5 for readability if there are many
                nlist = neighbors.split(", ")
                shown = ", ".join(nlist[:5])
                print(f"      top neighbors: {shown}")

        summary_rows.append({
            "year": r.test_year, "n_train_rows": r.n_train_rows, "n_cohorts": r.n_train_cohorts,
            "top5_TR36": top5_total36 * 100 if pd.notna(top5_total36) else np.nan,
            "uni_TR36":  uni_total36 * 100 if pd.notna(uni_total36) else np.nan,
            "top5_ZORI36": top5_zori36 * 100 if pd.notna(top5_zori36) else np.nan,
            "uni_ZORI36":  uni_zori36 * 100 if pd.notna(uni_zori36) else np.nan,
        })

    print("\n" + "=" * 130)
    print("kNN SUMMARY ACROSS TEST YEARS")
    print("=" * 130)
    s = pd.DataFrame(summary_rows)
    s["edge_TR36"]   = s["top5_TR36"]   - s["uni_TR36"]
    s["edge_ZORI36"] = s["top5_ZORI36"] - s["uni_ZORI36"]
    print(s.to_string(index=False, float_format=lambda x: f"{x:+.2f}"))
    obs = s.dropna(subset=["edge_TR36"])
    if len(obs):
        print(f"\nAvg TR36 edge:   {obs['edge_TR36'].mean():+.2f}pp   won {(obs['edge_TR36']>0).sum()}/{len(obs)}")
    obs_z = s.dropna(subset=["edge_ZORI36"])
    if len(obs_z):
        print(f"Avg ZORI36 edge: {obs_z['edge_ZORI36'].mean():+.2f}pp   won {(obs_z['edge_ZORI36']>0).sum()}/{len(obs_z)}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--test-years", type=int, nargs="+", default=None)
    parser.add_argument("--min-train-years", type=int, default=MIN_TRAIN_YEARS)
    parser.add_argument("--target", choices=["rent", "total_return"], default="total_return")
    parser.add_argument("--pop-min", type=int, default=300_000)
    parser.add_argument("--pop-max", type=int, default=500_000)
    parser.add_argument("--hhi-max", type=float, default=DIVERSITY_HHI_MAX)
    parser.add_argument("--strict-pit", action="store_true")
    parser.add_argument("--k", type=int, default=DEFAULT_K,
                        help=f"Neighbors to average per prediction (default: {DEFAULT_K})")
    args = parser.parse_args()

    target_col = TARGET_COL if args.target == "rent" else TARGET_COL_TOTAL_RETURN

    print(f"Loading panel (pop {args.pop_min//1000}K-{args.pop_max//1000}K + HHI <= {args.hhi_max}, Dec-31 cohorts)...")
    panel = load_tertiary_panel(pop_min=args.pop_min, pop_max=args.pop_max, hhi_max=args.hhi_max)
    print(f"  {len(panel)} rows across {panel['year'].min()}-{panel['year'].max()}")

    panel = panel.merge(build_acs_target(horizon_years=HORIZON_YEARS), on=["fips", "period_end_date"], how="left")
    panel = panel.merge(load_mf_context(), on="fips", how="left")

    panel_fe, feature_cols = build_feature_matrix(panel)
    print(f"  {len(feature_cols)} features")
    panel_z = zscore_within_cohort(panel_fe, feature_cols)

    results = knn_walk_forward(
        panel_z, panel_fe, feature_cols,
        test_years=args.test_years,
        min_train_years=args.min_train_years,
        target_col=target_col,
        strict_pit_targets=args.strict_pit,
        k=args.k,
    )
    print_knn_report(results)


if __name__ == "__main__":
    main()
