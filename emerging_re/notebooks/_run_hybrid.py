"""Hybrid ELITE ∩ HC v1: pattern matching restricted to top-quartile-by-cap.

Three configs on the same 1M-10M pop universe:
  - HC v1     : pure yield rank (raw cap_rate_proxy desc)
  - ELITE v1a : pure analog match (current ELITE)
  - Hybrid    : ELITE analog match restricted to top-25% by cap_rate_proxy

Comparison target: realized HPI 36mo total return (consistent across all three).
"""
from __future__ import annotations
import sys
from pathlib import Path
import duckdb
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from backtest.analog_search import (
    load_tertiary_panel, load_mf_context, build_acs_target,
    build_feature_matrix, zscore_within_cohort, walk_forward,
    TARGET_COL_TOTAL_RETURN, REALIZED_HPI_36MO,
)

POP_MIN, POP_MAX, HHI_MAX = 1_000_000, 10_000_000, 0.10
TOP_N, MAX_PER_STATE = 5, 2
ELITE_TOP_PCT = 0.25
HORIZON_YEARS = 3
CAP_FLOOR_PCT = 0.75  # candidates must be in top 25% by cap

pd.set_option("display.width", 200); pd.set_option("display.max_rows", 200)

print("=" * 100)
print(f"Hybrid ELITE ∩ HC v1 experiment   |   universe {POP_MIN:,}-{POP_MAX:,}   "
      f"cap floor: top-{int((1-CAP_FLOOR_PCT)*100)}%")
print("=" * 100)

# ── Panel setup ─────────────────────────────────────────────────────────────
panel = load_tertiary_panel(pop_min=POP_MIN, pop_max=POP_MAX, hhi_max=HHI_MAX)
panel = panel.merge(build_acs_target(horizon_years=HORIZON_YEARS), on=["fips", "period_end_date"], how="left")
panel = panel.merge(load_mf_context(), on="fips", how="left")
panel_fe, feat = build_feature_matrix(panel)
panel_z = zscore_within_cohort(panel_fe, feat)

# ── HC v1: raw cap rate rank ────────────────────────────────────────────────
# Rebuild the universe with HPI forward return for consistent scoring
WAREHOUSE = ROOT / "data" / "warehouse" / "emerging_re.duckdb"
con = duckdb.connect(str(WAREHOUSE), read_only=True)
uni = con.execute(f"""
    SELECT fips, county_name, state_name, pop_latest,
           EXTRACT(YEAR FROM period_end_date)::INT AS year,
           cap_rate_proxy, hpi_forward_return_36mo
    FROM main_marts.mart_county_features
    WHERE EXTRACT(MONTH FROM period_end_date) = 12
      AND pop_latest > {POP_MIN} AND pop_latest <= {POP_MAX}
      AND employment_diversity_hhi IS NOT NULL
      AND employment_diversity_hhi <= {HHI_MAX}
""").df()
con.close()

def hc_v1_picks(year):
    c = uni[uni["year"] == year].dropna(subset=["cap_rate_proxy"]).sort_values("cap_rate_proxy", ascending=False)
    picked, sc = [], {}
    for _, r in c.iterrows():
        if sc.get(r["state_name"], 0) >= MAX_PER_STATE: continue
        picked.append(r); sc[r["state_name"]] = sc.get(r["state_name"], 0) + 1
        if len(picked) >= TOP_N: break
    return pd.DataFrame(picked) if picked else pd.DataFrame()

# ── ELITE v1a (current, unchanged) ─────────────────────────────────────────
print("\n── ELITE v1a (current) — no yield floor ──")
v1a_results = walk_forward(
    panel_z, panel_fe, feat,
    target_col=TARGET_COL_TOTAL_RETURN,
    top_n=TOP_N, max_per_state=MAX_PER_STATE, elite_top_pct=ELITE_TOP_PCT,
    strict_pit_targets=True,
)

# ── Hybrid: ELITE v1a analog matching + top-25% cap floor ───────────────────
print(f"\n── HYBRID — ELITE + cap floor (top-{int((1-CAP_FLOOR_PCT)*100)}%) ──")
hybrid_results = walk_forward(
    panel_z, panel_fe, feat,
    target_col=TARGET_COL_TOTAL_RETURN,
    top_n=TOP_N, max_per_state=MAX_PER_STATE, elite_top_pct=ELITE_TOP_PCT,
    strict_pit_targets=True,
    min_cap_rate_percentile=CAP_FLOOR_PCT,
)

# ── Per-year picks side-by-side ─────────────────────────────────────────────
def _name(row):
    return f"{row['county_name'].replace(' County','')}, {row['state_name'][:2]}"

def _picks(results, yr):
    for r in results:
        if r.test_year == yr:
            return r.top5.head(TOP_N)
    return None

def _hpi_mean_from_results(picks):
    if picks is None or REALIZED_HPI_36MO not in picks or picks[REALIZED_HPI_36MO].isna().all():
        return np.nan
    return picks[REALIZED_HPI_36MO].mean() * 100

def _hpi_mean_from_uni(picks):
    if picks is None or picks.empty:
        return np.nan
    hpi = picks["hpi_forward_return_36mo"]
    return hpi.mean() * 100 if hpi.notna().any() else np.nan

print("\n" + "=" * 150)
print(" PER-YEAR PICKS  —  HC v1  |  ELITE v1a  |  HYBRID (ELITE ∩ top-25% cap)")
print("=" * 150)

years = sorted(set([r.test_year for r in v1a_results]))
for yr in years:
    if yr < 2015: continue
    hcv1 = hc_v1_picks(yr)
    el = _picks(v1a_results, yr)
    hy = _picks(hybrid_results, yr)

    h1_names = [_name(hcv1.iloc[i]) for i in range(len(hcv1))] if not hcv1.empty else []
    el_names = [_name(el.iloc[i])  for i in range(len(el))]  if el  is not None else []
    hy_names = [_name(hy.iloc[i])  for i in range(len(hy))]  if hy  is not None else []

    h1_hpi = _hpi_mean_from_uni(hcv1)
    el_hpi = _hpi_mean_from_results(el)
    hy_hpi = _hpi_mean_from_results(hy)

    fmt = lambda v: f"{v:+.2f}%" if not np.isnan(v) else "n/a"
    print(f"\n=== YEAR {yr}   HC_v1 HPI: {fmt(h1_hpi):>7}   ELITE HPI: {fmt(el_hpi):>7}   HYBRID HPI: {fmt(hy_hpi):>7}")
    print(f"    {'#':<3}  {'HC v1':<28}  {'ELITE v1a':<28}  {'HYBRID':<28}")
    for i in range(TOP_N):
        n1 = h1_names[i] if i < len(h1_names) else ""
        n2 = el_names[i] if i < len(el_names) else ""
        n3 = hy_names[i] if i < len(hy_names) else ""
        print(f"    #{i+1:<2}  {n1:<28}  {n2:<28}  {n3:<28}")

# ── Aggregate ───────────────────────────────────────────────────────────────
def _agg_results(results, label, using_uni=False):
    rows = []
    for r in results:
        yr = r.test_year
        if yr < 2015: continue
        picks = r.top5.head(TOP_N)
        val = _hpi_mean_from_results(picks)
        if not np.isnan(val):
            rows.append({"year": yr, "hpi_tr": val})
    df = pd.DataFrame(rows)
    if not df.empty:
        print(f"  {label:<40}  avg HPI TR: {df['hpi_tr'].mean():+.2f}%   wins? see below   n={len(df)}")
    return df

def _agg_hcv1():
    rows = []
    for yr in years:
        if yr < 2015: continue
        picks = hc_v1_picks(yr)
        val = _hpi_mean_from_uni(picks)
        if not np.isnan(val):
            rows.append({"year": yr, "hpi_tr": val})
    df = pd.DataFrame(rows)
    if not df.empty:
        print(f"  {'HC v1 (yield only)':<40}  avg HPI TR: {df['hpi_tr'].mean():+.2f}%   n={len(df)}")
    return df

print("\n" + "=" * 100)
print(" AGGREGATE (realized HPI 36mo TR, observable cohorts only)")
print("=" * 100)
hc_df  = _agg_hcv1()
el_df  = _agg_results(v1a_results,    "ELITE v1a (current)")
hy_df  = _agg_results(hybrid_results, "HYBRID (ELITE ∩ top-25% cap)")

print()
if not hc_df.empty and not el_df.empty and not hy_df.empty:
    m = (hc_df.rename(columns={"hpi_tr":"hc"})
         .merge(el_df.rename(columns={"hpi_tr":"el"}), on="year")
         .merge(hy_df.rename(columns={"hpi_tr":"hy"}), on="year"))
    print(f"  Δ (ELITE  − HC v1) analog vs yield:   {(m['el'] - m['hc']).mean():+.2f}pp")
    print(f"  Δ (HYBRID − HC v1) hybrid vs yield:   {(m['hy'] - m['hc']).mean():+.2f}pp   ← key result")
    print(f"  Δ (HYBRID − ELITE) yield floor effect: {(m['hy'] - m['el']).mean():+.2f}pp")

# ── 2022 focus ──────────────────────────────────────────────────────────────
print("\n" + "=" * 100)
print(" 2022 FOCUS (flagship failure year — ELITE picked Travis TX -10%, Clark NV +10%)")
print("=" * 100)
hc22 = hc_v1_picks(2022); el22 = _picks(v1a_results, 2022); hy22 = _picks(hybrid_results, 2022)
def _detail(label, picks, use_uni=False):
    if picks is None or (hasattr(picks, "empty") and picks.empty): return
    if use_uni:
        hpi_series = picks["hpi_forward_return_36mo"]
    else:
        hpi_series = picks[REALIZED_HPI_36MO] if REALIZED_HPI_36MO in picks else pd.Series([np.nan]*len(picks))
    per_pick = []
    for i in range(len(picks)):
        n = _name(picks.iloc[i])
        v = hpi_series.iloc[i]
        per_pick.append(f"{n}({v*100:+.1f}%)" if pd.notna(v) else f"{n}(n/a)")
    avg = hpi_series.mean()*100 if hpi_series.notna().any() else np.nan
    print(f"  {label}  avg HPI TR: {avg:+.2f}%   picks: " + ", ".join(per_pick))

_detail("HC v1 ", hc22, use_uni=True)
_detail("ELITE ", el22)
_detail("HYBRID", hy22)
