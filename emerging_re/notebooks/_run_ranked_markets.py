"""Single-market ranking — cash flow + appreciation total return.

For each cohort year, computes 3-year total return per county:
    cash_flow_3yr    = 3 × cap_entry × (1 + zori_forward_return_36mo / 2)
    appreciation_3yr = hpi_forward_return_36mo
    total_return_3yr = cash_flow_3yr + appreciation_3yr

Then produces:
  - HC v4 top-5 with realized components
  - ELITE v1a top-5 with realized components
  - UNIVERSE top-5 (oracle) with realized components
  - UNION top-10 (HC v4 ∪ ELITE) sorted by realized total return
For 2023-2025 (unobservable), shows ex-ante cap + zori_yoy for entry-side comparison.
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
    TARGET_COL_TOTAL_RETURN,
)

POP_MIN, POP_MAX, HHI_MAX = 1_000_000, 10_000_000, 0.10
TOP_N, MAX_PER_STATE = 5, 2
ELITE_TOP_PCT = 0.25
HORIZON_YEARS = 3

pd.set_option("display.width", 220); pd.set_option("display.max_rows", 200)

# ── Load universe with everything needed for scoring ────────────────────────
WAREHOUSE = ROOT / "data" / "warehouse" / "emerging_re.duckdb"
con = duckdb.connect(str(WAREHOUSE), read_only=True)
uni = con.execute(f"""
    SELECT fips, county_name, state_name, pop_latest,
           EXTRACT(YEAR FROM period_end_date)::INT AS year,
           cap_rate_proxy, zori_yoy, mf_cap_rate_change_3yr,
           zori_forward_return_36mo, hpi_forward_return_36mo
    FROM main_marts.mart_county_features
    WHERE EXTRACT(MONTH FROM period_end_date) = 12
      AND pop_latest > {POP_MIN} AND pop_latest <= {POP_MAX}
      AND employment_diversity_hhi IS NOT NULL
      AND employment_diversity_hhi <= {HHI_MAX}
""").df()

# Year-appropriate mortgage rates (FRED MORTGAGE30US at Dec 31 of cohort year)
mortgage = con.execute("""
    SELECT EXTRACT(YEAR FROM observation_date)::INT AS year, value / 100.0 AS mortgage_rate
    FROM main_staging.stg_fred_macro
    WHERE series_id = 'MORTGAGE30US'
    QUALIFY row_number() OVER (
        PARTITION BY EXTRACT(YEAR FROM observation_date)
        ORDER BY observation_date DESC) = 1
""").df()
con.close()
uni = uni.merge(mortgage, on="year", how="left")

# ── Return columns ──────────────────────────────────────────────────────────
# UNLEVERED (all-cash purchase, gross cap rate — no opex haircut):
uni["cash_flow_3yr"]    = 3 * uni["cap_rate_proxy"] * (1 + uni["zori_forward_return_36mo"] / 2)
uni["appreciation_3yr"] = uni["hpi_forward_return_36mo"]
uni["total_return_3yr"] = uni["cash_flow_3yr"] + uni["appreciation_3yr"]

# LEVERED (70% LTV, interest-only, year-appropriate mortgage rate):
LTV = 0.70
EQUITY_PCT = 1 - LTV  # 0.30
uni["debt_service_3yr"] = 3 * LTV * uni["mortgage_rate"]
uni["levered_dollar_return_3yr"] = uni["cash_flow_3yr"] - uni["debt_service_3yr"] + uni["appreciation_3yr"]
uni["levered_ROE_3yr"] = uni["levered_dollar_return_3yr"] / EQUITY_PCT

# ── HC v4: cap shortlist (top-15) + zori_yoy re-rank + state cap ─────────────
def hc_v4_picks(year, shortlist_mult=3):
    c = uni[uni["year"] == year].dropna(subset=["cap_rate_proxy"]).copy()
    K = TOP_N * shortlist_mult
    shortlist = c.nlargest(K, "cap_rate_proxy").copy()
    shortlist = shortlist.sort_values("zori_yoy", ascending=False, na_position="last")
    picked, sc = [], {}
    for _, r in shortlist.iterrows():
        if sc.get(r["state_name"], 0) >= MAX_PER_STATE: continue
        picked.append(r); sc[r["state_name"]] = sc.get(r["state_name"], 0) + 1
        if len(picked) >= TOP_N: break
    return pd.DataFrame(picked) if picked else pd.DataFrame()

# ── ELITE v1a: analog matching ───────────────────────────────────────────────
print("Running ELITE walk-forward...\n")
panel = load_tertiary_panel(pop_min=POP_MIN, pop_max=POP_MAX, hhi_max=HHI_MAX)
panel = panel.merge(build_acs_target(horizon_years=HORIZON_YEARS), on=["fips", "period_end_date"], how="left")
panel = panel.merge(load_mf_context(), on="fips", how="left")
panel_fe, feat = build_feature_matrix(panel)
panel_z = zscore_within_cohort(panel_fe, feat)
elite_results = walk_forward(
    panel_z, panel_fe, feat,
    target_col=TARGET_COL_TOTAL_RETURN,
    top_n=TOP_N, max_per_state=MAX_PER_STATE, elite_top_pct=ELITE_TOP_PCT,
    strict_pit_targets=True,
)
def elite_picks(year):
    for r in elite_results:
        if r.test_year == year:
            return r.top5.head(TOP_N)[["fips", "county_name", "state_name"]]
    return pd.DataFrame()

# ── Helpers ──────────────────────────────────────────────────────────────────
def _enrich(picks, year):
    """Attach realized cash flow / appreciation / total to each pick."""
    if picks.empty: return picks
    return picks[["fips", "county_name", "state_name"]].merge(
        uni[uni["year"] == year][["fips", "cap_rate_proxy", "zori_yoy", "mortgage_rate",
                                    "cash_flow_3yr", "appreciation_3yr", "total_return_3yr",
                                    "debt_service_3yr", "levered_ROE_3yr",
                                    "zori_forward_return_36mo", "hpi_forward_return_36mo"]],
        on="fips", how="left")

def _name(row):
    return f"{row['county_name'].replace(' County','')}, {row['state_name'][:2]}"

def _print_pick_row(i, row, obs=True):
    n = _name(row)
    if obs and pd.notna(row.get("total_return_3yr")):
        cf = row["cash_flow_3yr"] * 100
        ap = row["appreciation_3yr"] * 100
        tr = row["total_return_3yr"] * 100
        cap = row["cap_rate_proxy"] * 100 if pd.notna(row.get("cap_rate_proxy")) else np.nan
        roe = row["levered_ROE_3yr"] * 100 if pd.notna(row.get("levered_ROE_3yr")) else np.nan
        mtg = row["mortgage_rate"] * 100 if pd.notna(row.get("mortgage_rate")) else np.nan
        print(f"  #{i+1:<2}  {n:<28}  cap {cap:>5.2f}%  mtg {mtg:>4.2f}%   cf {cf:>+6.2f}%  apprec {ap:>+7.2f}%   TOTAL {tr:>+7.2f}%   LEV ROE (70%LTV) {roe:>+7.2f}%")
    else:
        cap = row["cap_rate_proxy"] * 100 if pd.notna(row.get("cap_rate_proxy")) else np.nan
        zy  = row["zori_yoy"] * 100 if pd.notna(row.get("zori_yoy")) else np.nan
        mtg = row["mortgage_rate"] * 100 if pd.notna(row.get("mortgage_rate")) else np.nan
        # ex-ante: show static coupon spread (cap - mtg) which tells you if leverage is accretive at entry
        spread = (row.get("cap_rate_proxy", np.nan) - row.get("mortgage_rate", np.nan)) * 100
        spread_s = f"{spread:+.2f}pp" if pd.notna(spread) else "n/a"
        print(f"  #{i+1:<2}  {n:<28}  cap {cap:>5.2f}%  mtg {mtg:>4.2f}%   spread {spread_s:>8}   zori_yoy {zy:>+6.2f}%   (36mo n/a yet)")

# ── Main loop: per cohort year ───────────────────────────────────────────────
years = sorted(uni["year"].unique().tolist())
for yr in years:
    if yr < 2015: continue

    hcv4 = _enrich(hc_v4_picks(yr), yr)
    el   = _enrich(elite_picks(yr), yr)

    # Universe scored (only if 36mo observable)
    yr_uni = uni[uni["year"] == yr].dropna(subset=["total_return_3yr"]).copy() if yr <= 2022 else pd.DataFrame()

    # State cap for oracle picks
    def _pick_top_with_state_cap(df, n, cap):
        picked, sc = [], {}
        for _, r in df.iterrows():
            if sc.get(r["state_name"], 0) >= cap: continue
            picked.append(r); sc[r["state_name"]] = sc.get(r["state_name"], 0) + 1
            if len(picked) >= n: break
        return pd.DataFrame(picked) if picked else pd.DataFrame()

    oracle = _pick_top_with_state_cap(
        yr_uni.sort_values("total_return_3yr", ascending=False), TOP_N, MAX_PER_STATE
    ) if not yr_uni.empty else pd.DataFrame()

    # Union: HC v4 ∪ ELITE picks, ranked by realized total return
    union_fips = set(hcv4["fips"]).union(set(el["fips"]))
    union_df = yr_uni[yr_uni["fips"].isin(union_fips)].sort_values("total_return_3yr", ascending=False) if not yr_uni.empty else pd.DataFrame()

    obs = yr <= 2022

    print("\n" + "=" * 130)
    if obs:
        u_median = yr_uni["total_return_3yr"].median() * 100 if not yr_uni.empty else np.nan
        u_mean = yr_uni["total_return_3yr"].mean() * 100 if not yr_uni.empty else np.nan
        print(f"YEAR {yr}   universe_n={len(uni[uni.year == yr])}   median TR: {u_median:+.2f}%   mean TR: {u_mean:+.2f}%")
    else:
        print(f"YEAR {yr}   universe_n={len(uni[uni.year == yr])}   (36mo not yet observable — ex-ante view)")
    print("=" * 130)

    # HC v4
    print("\nHC v4 picks (cap-shortlist + zori_yoy momentum):")
    if not hcv4.empty:
        for i in range(len(hcv4)):
            _print_pick_row(i, hcv4.iloc[i], obs=obs)
        if obs and hcv4["total_return_3yr"].notna().any():
            print(f"       {'AVG':<28}                                cf {hcv4['cash_flow_3yr'].mean()*100:>+6.2f}%  apprec {hcv4['appreciation_3yr'].mean()*100:>+7.2f}%   TOTAL {hcv4['total_return_3yr'].mean()*100:>+7.2f}%   LEV ROE (70%LTV) {hcv4['levered_ROE_3yr'].mean()*100:>+7.2f}%")

    # ELITE v1a
    print("\nELITE v1a picks (analog match):")
    if not el.empty:
        for i in range(len(el)):
            _print_pick_row(i, el.iloc[i], obs=obs)
        if obs and el["total_return_3yr"].notna().any():
            print(f"       {'AVG':<28}                         cf {el['cash_flow_3yr'].mean()*100:>+6.2f}%   apprec {el['appreciation_3yr'].mean()*100:>+7.2f}%   TOTAL {el['total_return_3yr'].mean()*100:>+7.2f}%")

    if obs:
        # Union ranked
        print(f"\nUNION (HC v4 ∪ ELITE) — {len(union_df)} unique markets, ranked by REALIZED total return:")
        for i in range(len(union_df)):
            r = union_df.iloc[i]
            src = "HC" if r["fips"] in set(hcv4["fips"]) and r["fips"] not in set(el["fips"]) else \
                  "EL" if r["fips"] in set(el["fips"]) and r["fips"] not in set(hcv4["fips"]) else "BOTH"
            n = _name(r); cf = r["cash_flow_3yr"]*100; ap = r["appreciation_3yr"]*100
            tr = r["total_return_3yr"]*100; cap = r["cap_rate_proxy"]*100
            roe = r["levered_ROE_3yr"]*100
            print(f"  #{i+1:<2} [{src:<4}] {n:<26}  cap {cap:>5.2f}%  cf {cf:>+6.2f}%  apprec {ap:>+7.2f}%  TOTAL {tr:>+7.2f}%  LEV ROE {roe:>+7.2f}%")

        # Oracle
        print(f"\nORACLE — universe top-{TOP_N} by REALIZED total return (with state cap):")
        for i in range(len(oracle)):
            _print_pick_row(i, oracle.iloc[i], obs=True)
        if oracle["total_return_3yr"].notna().any():
            print(f"       {'AVG':<28}                                cf {oracle['cash_flow_3yr'].mean()*100:>+6.2f}%  apprec {oracle['appreciation_3yr'].mean()*100:>+7.2f}%   TOTAL {oracle['total_return_3yr'].mean()*100:>+7.2f}%   LEV ROE (70%LTV) {oracle['levered_ROE_3yr'].mean()*100:>+7.2f}%")

# ── Aggregate ────────────────────────────────────────────────────────────────
print("\n" + "=" * 130)
print(" AGGREGATE (realized total return = cash flow + appreciation)")
print("=" * 130)

def _agg(pick_fn, label):
    rows = []
    for yr in years:
        if yr < 2015 or yr > 2022: continue
        picks = _enrich(pick_fn(yr), yr)
        if picks.empty or picks["total_return_3yr"].isna().all(): continue
        rows.append({
            "year": yr,
            "tr": picks["total_return_3yr"].mean()*100,
            "roe": picks["levered_ROE_3yr"].mean()*100,
        })
    df = pd.DataFrame(rows)
    if not df.empty:
        print(f"  {label:<48}  avg TR: {df['tr'].mean():+7.2f}%    avg LEV ROE (70% LTV): {df['roe'].mean():+7.2f}%    n={len(df)}")
    return df

_agg(lambda y: hc_v4_picks(y), "HC v4 (cap + momentum)")
_agg(lambda y: elite_picks(y), "ELITE v1a (analog)")

def _agg_oracle():
    rows = []
    for yr in years:
        if yr < 2015 or yr > 2022: continue
        yr_uni = uni[uni["year"] == yr].dropna(subset=["total_return_3yr"]).copy()
        if yr_uni.empty: continue
        picked, sc = [], {}
        for _, r in yr_uni.sort_values("total_return_3yr", ascending=False).iterrows():
            if sc.get(r["state_name"], 0) >= MAX_PER_STATE: continue
            picked.append(r); sc[r["state_name"]] = sc.get(r["state_name"], 0) + 1
            if len(picked) >= TOP_N: break
        oracle = pd.DataFrame(picked)
        rows.append({"year": yr, "tr": oracle["total_return_3yr"].mean()*100,
                     "roe": oracle["levered_ROE_3yr"].mean()*100})
    df = pd.DataFrame(rows)
    if not df.empty:
        print(f"  {'ORACLE (universe top-5 by realized TR)':<48}  avg TR: {df['tr'].mean():+7.2f}%    avg LEV ROE (70% LTV): {df['roe'].mean():+7.2f}%    n={len(df)}")
_agg_oracle()

# Union
def _agg_union():
    rows = []
    for yr in years:
        if yr < 2015 or yr > 2022: continue
        yr_uni = uni[uni["year"] == yr].dropna(subset=["total_return_3yr"]).copy()
        h = hc_v4_picks(yr); e = elite_picks(yr)
        union_fips = set(h["fips"]).union(set(e["fips"]))
        u = yr_uni[yr_uni["fips"].isin(union_fips)].sort_values("total_return_3yr", ascending=False).head(TOP_N)
        rows.append({"year": yr, "tr": u["total_return_3yr"].mean()*100,
                     "roe": u["levered_ROE_3yr"].mean()*100})
    df = pd.DataFrame(rows)
    if not df.empty:
        print(f"  {'UNION top-5 (best of HC v4 ∪ ELITE, in hindsight)':<48}  avg TR: {df['tr'].mean():+7.2f}%    avg LEV ROE (70% LTV): {df['roe'].mean():+7.2f}%    n={len(df)}")
_agg_union()
