"""ELITE v2 vs current ELITE: HPI target + regime-family conditioning + slim features.

Runs both configurations on the same universe (1M-10M pop, HHI<=0.10) and
prints per-year picks side-by-side. The key question: does ELITE v2's 2022
top-5 avoid the Sunbelt/tech names (Travis TX, Santa Clara CA) that current
ELITE keeps picking, and lean toward the 2005-2006 TOPPING-cohort analogs?
"""
from __future__ import annotations
import sys
from pathlib import Path
import pandas as pd
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from backtest.analog_search import (
    load_tertiary_panel, load_mf_context, build_acs_target,
    build_feature_matrix, zscore_within_cohort, walk_forward,
    TARGET_COL_TOTAL_RETURN, TARGET_COL_HPI_36MO, SLIM_FEATURES, REALIZED_HPI_36MO,
)

POP_MIN, POP_MAX, HHI_MAX = 1_000_000, 10_000_000, 0.10
TOP_N, MAX_PER_STATE = 5, 2
ELITE_TOP_PCT = 0.25
HORIZON_YEARS = 3

pd.set_option("display.width", 200); pd.set_option("display.max_rows", 200)

print("=" * 100)
print("ELITE v1a (current) vs v1b (HPI + all features) vs v2 (HPI + regime + slim)")
print(f"Universe: pop {POP_MIN:,}-{POP_MAX:,}   HHI<={HHI_MAX}   top_n={TOP_N}   max_per_state={MAX_PER_STATE}")
print("=" * 100)

# ── Panel setup ────────────────────────────────────────────────────────────
panel = load_tertiary_panel(pop_min=POP_MIN, pop_max=POP_MAX, hhi_max=HHI_MAX)
panel = panel.merge(build_acs_target(horizon_years=HORIZON_YEARS), on=["fips", "period_end_date"], how="left")
panel = panel.merge(load_mf_context(), on="fips", how="left")
print(f"\nPanel: {len(panel)} rows, years {panel['year'].min()}-{panel['year'].max()}")

# ── ELITE v1a: current config (ZORI-based total-return target, all features) ──
print("\n" + "─" * 60)
print("ELITE v1a (current) — target=total_return (ZORI-based), all features, no regime")
print("─" * 60)
panel_full_fe, feat_full = build_feature_matrix(panel)  # full ~91 features
panel_full_z = zscore_within_cohort(panel_full_fe, feat_full)
print(f"Feature count: {len(feat_full)}")
v1a_results = walk_forward(
    panel_full_z, panel_full_fe, feat_full,
    target_col=TARGET_COL_TOTAL_RETURN,
    top_n=TOP_N, max_per_state=MAX_PER_STATE, elite_top_pct=ELITE_TOP_PCT,
    strict_pit_targets=True, regime_family_filter=False,
)

# ── ELITE v1b: HPI target + all features + no regime (isolates target-swap effect) ─
print("\n" + "─" * 60)
print("ELITE v1b (baseline) — target=HPI, all features, no regime (isolates target-swap)")
print("─" * 60)
# Reuse same panel_full_z since features + z-scoring are identical
v1b_results = walk_forward(
    panel_full_z, panel_full_fe, feat_full,
    target_col=TARGET_COL_HPI_36MO,
    top_n=TOP_N, max_per_state=MAX_PER_STATE, elite_top_pct=ELITE_TOP_PCT,
    strict_pit_targets=True, regime_family_filter=False,
)

# ── ELITE v2b: HPI target + full features + regime-family filter ───────────
# Isolates the regime-filter effect alone (no slim-features contamination).
print("\n" + "─" * 60)
print("ELITE v2b — target=HPI, ALL features, regime-family filter ON (regime-only test)")
print("─" * 60)
v2b_results = walk_forward(
    panel_full_z, panel_full_fe, feat_full,
    target_col=TARGET_COL_HPI_36MO,
    top_n=TOP_N, max_per_state=MAX_PER_STATE, elite_top_pct=ELITE_TOP_PCT,
    strict_pit_targets=True, regime_family_filter=True, min_regime_train_years=2,
)

# ── ELITE v2: HPI target + slim features + regime-family filter (kept for reference) ─
print("\n" + "─" * 60)
print("ELITE v2 — target=HPI, slim features, regime-family filter ON")
print("─" * 60)
panel_slim_fe, feat_slim = build_feature_matrix(panel, feature_whitelist=SLIM_FEATURES)
panel_slim_z = zscore_within_cohort(panel_slim_fe, feat_slim)
print(f"Feature count: {len(feat_slim)}  → {feat_slim}")
v2_results = walk_forward(
    panel_slim_z, panel_slim_fe, feat_slim,
    target_col=TARGET_COL_HPI_36MO,
    top_n=TOP_N, max_per_state=MAX_PER_STATE, elite_top_pct=ELITE_TOP_PCT,
    strict_pit_targets=True, regime_family_filter=True, min_regime_train_years=2,
)

# ── Per-year picks side-by-side ─────────────────────────────────────────────
def _name(row):
    return f"{row['county_name'].replace(' County','')}, {row['state_name'][:2]}"

def _picks(results, yr):
    for r in results:
        if r.test_year == yr:
            return r.top5.head(TOP_N)
    return None

print("\n" + "=" * 180)
print(" PER-YEAR PICKS  —  v1a (current) | v1b (HPI target only) | v2b (HPI + regime, ALL feat) | v2 (HPI + regime + slim)")
print("=" * 180)

years = sorted(set([r.test_year for r in v1a_results]
                   + [r.test_year for r in v1b_results]
                   + [r.test_year for r in v2b_results]
                   + [r.test_year for r in v2_results]))

def _hpi_mean(picks):
    if picks is None or REALIZED_HPI_36MO not in picks or picks[REALIZED_HPI_36MO].isna().all():
        return np.nan
    return picks[REALIZED_HPI_36MO].mean() * 100

for yr in years:
    if yr < 2015: continue
    v1a = _picks(v1a_results, yr); v1b = _picks(v1b_results, yr)
    v2b = _picks(v2b_results, yr); v2 = _picks(v2_results, yr)
    a = [_name(v1a.iloc[i]) for i in range(len(v1a))] if v1a is not None else []
    b = [_name(v1b.iloc[i]) for i in range(len(v1b))] if v1b is not None else []
    b2 = [_name(v2b.iloc[i]) for i in range(len(v2b))] if v2b is not None else []
    c = [_name(v2.iloc[i]) for i in range(len(v2))]  if v2  is not None else []
    ha = _hpi_mean(v1a); hb = _hpi_mean(v1b); hb2 = _hpi_mean(v2b); hc = _hpi_mean(v2)
    fmt = lambda h: f"{h:+.2f}%" if not np.isnan(h) else "n/a"
    print(f"\n=== YEAR {yr}   v1a: {fmt(ha):>7}   v1b: {fmt(hb):>7}   v2b: {fmt(hb2):>7}   v2: {fmt(hc):>7}")
    print(f"    {'#':<3}  {'v1a (current)':<24}  {'v1b (HPI)':<24}  {'v2b (HPI+regime)':<24}  {'v2 (HPI+regime+slim)':<24}")
    for i in range(TOP_N):
        n_a = a[i] if i < len(a) else ""
        n_b = b[i] if i < len(b) else ""
        n_b2 = b2[i] if i < len(b2) else ""
        n_c = c[i] if i < len(c) else ""
        print(f"    #{i+1:<2}  {n_a:<24}  {n_b:<24}  {n_b2:<24}  {n_c:<24}")

# ── Aggregate HPI TR ─────────────────────────────────────────────────────────
def _agg(results, label):
    rows = []
    for r in results:
        if r.test_year < 2015: continue
        picks = r.top5.head(TOP_N)
        if REALIZED_HPI_36MO in picks and picks[REALIZED_HPI_36MO].notna().any():
            rows.append({"year": r.test_year, "hpi_tr": picks[REALIZED_HPI_36MO].mean()*100})
    df = pd.DataFrame(rows)
    obs = df.dropna(subset=["hpi_tr"])
    if not obs.empty:
        print(f"  {label:<44}  avg HPI TR: {obs['hpi_tr'].mean():+.2f}%   n_observable={len(obs)}")
    return df

print("\n" + "=" * 100)
print(" AGGREGATE (realized HPI 36mo TR, observable cohorts only)")
print("=" * 100)
a_df  = _agg(v1a_results, "v1a  (current: ZORI target, all features)")
b_df  = _agg(v1b_results, "v1b  (HPI target, all features, no regime)")
b2_df = _agg(v2b_results, "v2b  (HPI target, ALL features, regime filter ON)")
c_df  = _agg(v2_results,  "v2   (HPI target, slim features, regime filter ON)")

# Deltas — isolate each intervention
print()
if not a_df.empty and not b_df.empty and not b2_df.empty and not c_df.empty:
    m = (a_df.rename(columns={"hpi_tr":"a"})
         .merge(b_df.rename(columns={"hpi_tr":"b"}), on="year")
         .merge(b2_df.rename(columns={"hpi_tr":"b2"}), on="year")
         .merge(c_df.rename(columns={"hpi_tr":"c"}), on="year"))
    print(f"  Δ (v1b  − v1a) target-swap alone:                    {(m['b']  - m['a']).mean():+.2f}pp")
    print(f"  Δ (v2b  − v1b) regime-filter alone (no slim):        {(m['b2'] - m['b']).mean():+.2f}pp   ← the key result")
    print(f"  Δ (v2   − v2b) slim-features effect (given regime):  {(m['c']  - m['b2']).mean():+.2f}pp")
    print(f"  Δ (v2b  − v1a) full v2b impact (target+regime):      {(m['b2'] - m['a']).mean():+.2f}pp")
    print(f"  Δ (v2   − v1a) full v2 impact (target+regime+slim):  {(m['c']  - m['a']).mean():+.2f}pp")

# ── 2022 focus ──────────────────────────────────────────────────────────────
print("\n" + "=" * 100)
print(" 2022 FOCUS (flagship failure year for v1a — Travis TX & Clark NV)")
print("=" * 100)
for label, results in [("v1a", v1a_results), ("v1b", v1b_results), ("v2b", v2b_results), ("v2 ", v2_results)]:
    p = _picks(results, 2022)
    if p is None: continue
    names = [_name(p.iloc[i]) for i in range(len(p))]
    hpi = _hpi_mean(p)
    per_pick = [(n, p.iloc[i].get(REALIZED_HPI_36MO, np.nan)*100 if pd.notna(p.iloc[i].get(REALIZED_HPI_36MO, np.nan)) else np.nan)
                for i, n in enumerate(names)]
    print(f"  {label}  avg HPI TR: {hpi:+.2f}%   picks: " + ", ".join(f"{n}({r:+.1f}%)" for n, r in per_pick))
