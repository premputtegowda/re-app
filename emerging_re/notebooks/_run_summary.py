"""Reproduce Cells 2/4/6/8/23-portion/28/30 + a losers table.

Standalone — mirrors the notebook logic. Prints:
  1) Per-year ELITE / HC v1 / HC v2 pick names for all test years
  2) Overall per-strategy performance (avg TR, edge vs universe, win-rate)
  3) Worst individual picks across all cohorts ("losers") for each strategy
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

# --- Cell 2: Config -----------------------------------------------------------
WAREHOUSE = str(ROOT / "data" / "warehouse" / "emerging_re.duckdb")
POP_MIN = 1_000_000
POP_MAX = 10_000_000
HHI_MAX = 0.10
TOP_N = 5
MAX_PER_STATE = 2
ELITE_TOP_PCT = 0.25
HORIZON_YEARS = 3

pd.set_option("display.width", 200)
pd.set_option("display.max_rows", 300)
pd.set_option("display.max_colwidth", 60)

print("=" * 100)
print(f"Config: POP {POP_MIN:,}-{POP_MAX:,}   HHI<={HHI_MAX}   TOP_N={TOP_N}   MAX_PER_STATE={MAX_PER_STATE}")
print(f"        ELITE_TOP_PCT={ELITE_TOP_PCT}   HORIZON_YEARS={HORIZON_YEARS}   strict_pit=True")
print("=" * 100)

# --- Cell 4: Universe ---------------------------------------------------------
sql_uni = f"""
    SELECT fips, county_name, state_name, pop_latest,
           EXTRACT(YEAR FROM period_end_date)::INT AS year,
           cap_rate_proxy, mf_cap_rate_estimated, employment_diversity_hhi,
           zori_forward_return_36mo
    FROM main_marts.mart_county_features
    WHERE EXTRACT(MONTH FROM period_end_date) = 12
      AND pop_latest > {POP_MIN} AND pop_latest <= {POP_MAX}
      AND employment_diversity_hhi IS NOT NULL
      AND employment_diversity_hhi <= {HHI_MAX}
"""
con = duckdb.connect(WAREHOUSE, read_only=True)
uni = con.execute(sql_uni).df()
con.close()
exit_lookup = uni[["fips", "year", "cap_rate_proxy"]].copy()
exit_lookup["year"] = exit_lookup["year"] - HORIZON_YEARS
exit_lookup = exit_lookup.rename(columns={"cap_rate_proxy": "cap_exit"})
uni = uni.merge(exit_lookup, on=["fips", "year"], how="left")
uni["tr_zori36"] = (1 + uni["zori_forward_return_36mo"]) * (uni["cap_rate_proxy"] / uni["cap_exit"]) - 1
print(f"\nUniverse rows: {len(uni)}   years: {sorted(uni['year'].unique().tolist())[:3]}...{sorted(uni['year'].unique().tolist())[-3:]}")

# --- Cell 6: ELITE walk-forward -----------------------------------------------
panel = load_tertiary_panel(pop_min=POP_MIN, pop_max=POP_MAX, hhi_max=HHI_MAX)
panel = panel.merge(build_acs_target(horizon_years=HORIZON_YEARS), on=["fips", "period_end_date"], how="left")
panel = panel.merge(load_mf_context(), on="fips", how="left")
panel_fe, feature_cols = build_feature_matrix(panel)
panel_z = zscore_within_cohort(panel_fe, feature_cols)
print(f"Panel: {len(panel)} rows, {len(feature_cols)} features")

elite_results = walk_forward(
    panel_z, panel_fe, feature_cols,
    target_col=TARGET_COL_TOTAL_RETURN,
    top_n=TOP_N,
    max_per_state=MAX_PER_STATE,
    elite_top_pct=ELITE_TOP_PCT,
    strict_pit_targets=True,
)
print(f"\nELITE completed: {len(elite_results)} iterations")

# --- Cell 8: HighCap v1 -------------------------------------------------------
def highcap_v1_picks_for(year):
    c = uni[uni["year"] == year].dropna(subset=["cap_rate_proxy"]).sort_values("cap_rate_proxy", ascending=False)
    picked, sc = [], {}
    for _, r in c.iterrows():
        if sc.get(r["state_name"], 0) >= MAX_PER_STATE:
            continue
        picked.append(r); sc[r["state_name"]] = sc.get(r["state_name"], 0) + 1
        if len(picked) >= TOP_N: break
    return pd.DataFrame(picked) if picked else pd.DataFrame()

# --- Cell 23-portion: PIT pop-YoY cache ---------------------------------------
con = duckdb.connect(WAREHOUSE, read_only=True)
pep_raw = con.execute("""
    SELECT fips, EXTRACT(YEAR FROM period_end_date)::INT AS ref_year,
           popestimate, as_of_date
    FROM main_staging.stg_census_pep
""").df()
gate_ctx = con.execute("""
    SELECT fips, EXTRACT(YEAR FROM period_end_date)::INT AS year,
           unemployment_rate, rental_vacancy_rate, renter_share,
           mf_cap_rate_change_3yr, any_disqualifier
    FROM main_marts.mart_county_features
    WHERE EXTRACT(MONTH FROM period_end_date) = 12
""").df()
con.close()
pep_raw["as_of_date"] = pd.to_datetime(pep_raw["as_of_date"])

def pit_pop_yoy(cohort_year):
    cutoff = pd.Timestamp(f"{cohort_year}-12-31")
    df = pep_raw[pep_raw["as_of_date"] <= cutoff].copy()
    if df.empty: return pd.DataFrame(columns=["fips", "pop_yoy_pct"])
    df = df.sort_values(["fips", "ref_year", "as_of_date"]).drop_duplicates(subset=["fips", "ref_year"], keep="last")
    rows = []
    for f, sub in df.groupby("fips"):
        sub = sub.sort_values("ref_year", ascending=False)
        if len(sub) < 2: continue
        r_latest = sub.iloc[0]
        r_prev = sub[sub["ref_year"] == r_latest["ref_year"] - 1]
        if r_prev.empty: continue
        r_prev = r_prev.iloc[0]
        rows.append({
            "fips": f,
            "pop_yoy_pct": (r_latest["popestimate"] - r_prev["popestimate"]) / r_prev["popestimate"] * 100,
        })
    return pd.DataFrame(rows)

pop_yoy_cache = {yr: pit_pop_yoy(yr) for yr in range(2015, 2026)}

# --- Cell 23-portion: HighCap v4 ---------------------------------------------
con = duckdb.connect(WAREHOUSE, read_only=True)
_zori_yoy_df = con.execute("""
    SELECT fips, EXTRACT(YEAR FROM period_end_date)::INT AS year, zori_yoy
    FROM main_marts.mart_county_features
    WHERE EXTRACT(MONTH FROM period_end_date) = 12
""").df()
con.close()

def highcap_v4_picks_for(year, momentum_col="zori_yoy", shortlist_mult=3):
    c = uni[uni["year"] == year].dropna(subset=["cap_rate_proxy"]).copy()
    c = c.merge(_zori_yoy_df[_zori_yoy_df["year"] == year][["fips", "zori_yoy"]], on="fips", how="left")
    K = TOP_N * shortlist_mult
    shortlist = c.nlargest(K, "cap_rate_proxy").copy()
    shortlist = shortlist.sort_values(momentum_col, ascending=False, na_position="last")
    picked, sc = [], {}
    for _, r in shortlist.iterrows():
        if sc.get(r["state_name"], 0) >= MAX_PER_STATE: continue
        picked.append(r); sc[r["state_name"]] = sc.get(r["state_name"], 0) + 1
        if len(picked) >= TOP_N: break
    return pd.DataFrame(picked), len(shortlist)

# --- Cell 28: HighCap v2 ------------------------------------------------------
GATES = {
    "min_pop_yoy_pct": 0.0,
    "max_unemp_pct": 6.5,
    "max_vacancy_frac": 0.12,
    "min_renter_share_frac": 0.20,
    "require_no_disq": True,
}
MOMENTUM_TIEBREAK = True

def highcap_v2_picks_for(year):
    c = uni[uni["year"] == year].dropna(subset=["cap_rate_proxy"]).copy()
    c = c.merge(
        gate_ctx[gate_ctx["year"] == year][["fips", "unemployment_rate", "rental_vacancy_rate",
                                             "renter_share", "mf_cap_rate_change_3yr", "any_disqualifier"]],
        on="fips", how="left")
    pop_yr = pop_yoy_cache.get(year, pd.DataFrame())
    if not pop_yr.empty:
        c = c.merge(pop_yr[["fips", "pop_yoy_pct"]], on="fips", how="left")
    else:
        c["pop_yoy_pct"] = np.nan
    n_before = len(c)
    c = c[c["pop_yoy_pct"].isna() | (c["pop_yoy_pct"] >= GATES["min_pop_yoy_pct"])]
    c = c[c["unemployment_rate"].isna() | (c["unemployment_rate"] <= GATES["max_unemp_pct"])]
    c = c[c["rental_vacancy_rate"].isna() | (c["rental_vacancy_rate"] <= GATES["max_vacancy_frac"])]
    c = c[c["renter_share"].isna() | (c["renter_share"] >= GATES["min_renter_share_frac"])]
    if GATES["require_no_disq"]:
        c = c[(c["any_disqualifier"] == False) | (c["any_disqualifier"].isna())]
    n_after = len(c)
    if c.empty: return pd.DataFrame(), (n_before, n_after)
    if MOMENTUM_TIEBREAK and "mf_cap_rate_change_3yr" in c.columns:
        c = c.sort_values(["cap_rate_proxy", "mf_cap_rate_change_3yr"], ascending=[False, True])
    else:
        c = c.sort_values("cap_rate_proxy", ascending=False)
    picked, sc = [], {}
    for _, r in c.iterrows():
        if sc.get(r["state_name"], 0) >= MAX_PER_STATE: continue
        picked.append(r); sc[r["state_name"]] = sc.get(r["state_name"], 0) + 1
        if len(picked) >= TOP_N: break
    return pd.DataFrame(picked), (n_before, n_after)

# --- Per-year summary + collect per-pick performance --------------------------
year_tr_lookup = uni[["fips", "year", "tr_zori36"]].dropna(subset=["tr_zori36"])
pick_rows = []
year_summary = []

def name_of(picks, i):
    if i >= len(picks): return ""
    r = picks.iloc[i]
    return f"{r['county_name'].replace(' County','')}, {r['state_name'][:2]}"

def compute_avg_tr(picks, tr_map):
    if picks.empty: return np.nan
    trs = [tr_map.get(f) for f in picks["fips"] if tr_map.get(f) is not None]
    return np.nanmean(trs) * 100 if trs else np.nan

print("\n" + "=" * 130)
print(" PER-YEAR PICKS  —  HighCap v1 (raw cap)  |  HighCap v2 (gates)  |  ELITE (analog-search)")
print("=" * 130)

for r in elite_results:
    yr = r.test_year
    if yr < 2015: continue
    el_top = r.top5.head(TOP_N)[["fips", "county_name", "state_name"]].copy()
    hc_v1 = highcap_v1_picks_for(yr)
    hc_v1_top = hc_v1.head(TOP_N)[["fips", "county_name", "state_name"]].copy() if not hc_v1.empty else pd.DataFrame()
    hc_v2_all, (n_b, n_a) = highcap_v2_picks_for(yr)
    hc_v2_top = hc_v2_all.head(TOP_N)[["fips", "county_name", "state_name"]].copy() if not hc_v2_all.empty else pd.DataFrame()
    hc_v4_all, _ = highcap_v4_picks_for(yr)
    hc_v4_top = hc_v4_all.head(TOP_N)[["fips", "county_name", "state_name"]].copy() if not hc_v4_all.empty else pd.DataFrame()

    year_tr = year_tr_lookup[year_tr_lookup["year"] == yr]
    tr_map = dict(zip(year_tr["fips"], year_tr["tr_zori36"])) if len(year_tr) else {}
    uni_tr = year_tr["tr_zori36"].mean() * 100 if len(year_tr) else np.nan

    hc1_tr = compute_avg_tr(hc_v1_top, tr_map)
    hc2_tr = compute_avg_tr(hc_v2_top, tr_map)
    hc4_tr = compute_avg_tr(hc_v4_top, tr_map)
    el_tr = compute_avg_tr(el_top, tr_map)

    print(f"\n=== YEAR {yr}   universe_n={len(uni[uni['year']==yr])}   v2 gate pass: {n_a}/{n_b} ({n_a/n_b*100 if n_b else 0:.0f}%)")
    fmt = lambda v: "n/a" if pd.isna(v) else f"{v:+.2f}%"
    print(f"    HC_v1: {fmt(hc1_tr):>8}   HC_v2: {fmt(hc2_tr):>8}   HC_v4: {fmt(hc4_tr):>8}   ELITE: {fmt(el_tr):>8}   Uni: {fmt(uni_tr):>8}")
    print(f"    {'#':<3}  {'HC_v1':<24}  {'HC_v2':<24}  {'HC_v4':<24}  {'ELITE':<24}")
    for i in range(TOP_N):
        print(f"    #{i+1:<2}  {name_of(hc_v1_top,i):<24}  {name_of(hc_v2_top,i):<24}  {name_of(hc_v4_top,i):<24}  {name_of(el_top,i):<24}")

    year_summary.append({
        "year": yr, "uni_TR": uni_tr,
        "HC_v1_TR": hc1_tr, "HC_v2_TR": hc2_tr, "HC_v4_TR": hc4_tr, "ELITE_TR": el_tr,
    })

    for strat, picks in [("ELITE", el_top), ("HC_v1", hc_v1_top), ("HC_v2", hc_v2_top), ("HC_v4", hc_v4_top)]:
        for _, row in picks.iterrows():
            pick_rows.append({
                "year": yr, "strategy": strat, "fips": row["fips"],
                "county": row["county_name"].replace(" County", ""),
                "state": row["state_name"], "tr": tr_map.get(row["fips"]),
                "uni_tr": uni_tr / 100 if pd.notna(uni_tr) else np.nan,
            })

# --- Overall performance ------------------------------------------------------
sdf = pd.DataFrame(year_summary)
sdf["HC_v1_edge"] = sdf["HC_v1_TR"] - sdf["uni_TR"]
sdf["HC_v2_edge"] = sdf["HC_v2_TR"] - sdf["uni_TR"]
sdf["HC_v4_edge"] = sdf["HC_v4_TR"] - sdf["uni_TR"]
sdf["ELITE_edge"] = sdf["ELITE_TR"] - sdf["uni_TR"]

print("\n" + "=" * 100)
print(" OVERALL PERFORMANCE")
print("=" * 100)
print(sdf.to_string(index=False, float_format=lambda x: f"{x:+.2f}" if pd.notna(x) else "n/a"))

obs = sdf.dropna(subset=["HC_v1_TR", "HC_v2_TR", "HC_v4_TR", "ELITE_TR", "uni_TR"])
print()
print(f"Aggregate over {len(obs)} observable cohorts (with realized 36mo returns):")
for label, tr_col, edge_col in [
    ("HC v1 (raw cap)         ", "HC_v1_TR", "HC_v1_edge"),
    ("HC v2 (gates)           ", "HC_v2_TR", "HC_v2_edge"),
    ("HC v4 (cap + momentum)  ", "HC_v4_TR", "HC_v4_edge"),
    ("ELITE (analog-search)   ", "ELITE_TR", "ELITE_edge"),
]:
    if len(obs):
        avg = obs[tr_col].mean()
        edge = obs[edge_col].mean()
        wins = (obs[edge_col] > 0).sum()
        print(f"  {label}: avg TR {avg:+.2f}%   avg edge vs universe {edge:+.2f}pp   beats universe {wins}/{len(obs)} cohorts")

# --- Cross-strategy agreement + negative-return analysis ---------------------
prow = pd.DataFrame(pick_rows).dropna(subset=["tr"])
prow["edge"] = prow["tr"] - prow["uni_tr"]

# For each (year, fips), how many strategies picked it, and was TR negative?
by_market = (prow.groupby(["year", "fips", "county", "state"])
                  .agg(n_strats=("strategy", "nunique"),
                       strats=("strategy", lambda s: "+".join(sorted(set(s)))),
                       tr=("tr", "first"))
                  .reset_index())

print("\n" + "=" * 100)
print(" MARKETS PICKED BY ALL 3 STRATEGIES IN THE SAME YEAR")
print("=" * 100)
all3 = by_market[by_market["n_strats"] == 3].sort_values("tr")
if all3.empty:
    print("None.")
else:
    print(f"{'yr':<5} {'market':<32} {'TR':>10}  status")
    for _, r in all3.iterrows():
        status = "LOSER (negative)" if r["tr"] < 0 else "positive"
        print(f"{r['year']:<5} {r['county']+', '+r['state'][:2]:<32} {r['tr']*100:>+9.2f}%  {status}")

print("\n" + "=" * 100)
print(" NEGATIVE-RETURN PICKS (any strategy) — observable cohorts")
print("=" * 100)
neg = prow[prow["tr"] < 0].sort_values(["fips", "year"])
if neg.empty:
    print("None — no picked market had a negative 36mo total return in observable cohorts.")
else:
    print(f"{'yr':<5} {'market':<32} {'strategy':<7} {'TR':>10} {'edge':>10}")
    for _, r in neg.iterrows():
        print(f"{r['year']:<5} {r['county']+', '+r['state'][:2]:<32} {r['strategy']:<7} {r['tr']*100:>+9.2f}% {r['edge']*100:>+9.2f}pp")

    # markets negative in *at least one* strategy — check if same market was also picked by others in same year
    neg_by_market = (neg.groupby(["year", "fips", "county", "state"])
                        .agg(picked_by=("strategy", lambda s: "+".join(sorted(set(s)))),
                             n=("strategy", "nunique"),
                             tr=("tr", "first"))
                        .reset_index()
                        .sort_values(["n", "tr"], ascending=[False, True]))
    print("\n  Grouped by market — # of strategies that picked it while it was negative:")
    for _, r in neg_by_market.iterrows():
        print(f"    {r['year']}  {r['county']+', '+r['state'][:2]:<28}  TR {r['tr']*100:+.2f}%  picked by: {r['picked_by']}")

# --- Losers (original tables retained for context) ---------------------------

print("\n" + "=" * 100)
print(" WORST INDIVIDUAL PICKS (LOSERS) — sorted by realized TR ascending, observable cohorts only")
print("=" * 100)
for strat in ["ELITE", "HC_v1", "HC_v2", "HC_v4"]:
    sub = prow[prow["strategy"] == strat].sort_values("tr", ascending=True).head(10)
    print(f"\n--- {strat} — 10 worst picks ---")
    print(f"{'yr':<5} {'market':<32} {'realized TR':>12} {'edge vs uni':>12}")
    for _, r in sub.iterrows():
        print(f"{r['year']:<5} {r['county']+', '+r['state'][:2]:<32} {r['tr']*100:>+11.2f}% {r['edge']*100:>+11.2f}pp")

# also print biggest single misses vs universe
print("\n" + "=" * 100)
print(" WORST EDGE-vs-UNIVERSE PICKS (biggest single-pick underperformance)")
print("=" * 100)
for strat in ["ELITE", "HC_v1", "HC_v2"]:
    sub = prow[prow["strategy"] == strat].sort_values("edge", ascending=True).head(5)
    print(f"\n--- {strat} — 5 worst edges ---")
    for _, r in sub.iterrows():
        print(f"  {r['year']}  {r['county']}, {r['state'][:2]:<3}  TR {r['tr']*100:+.2f}%  edge {r['edge']*100:+.2f}pp")
