"""For each strategy's picks in each cohort year, show:
  - trailing zori_yoy at pick time (backward-looking)
  - realized 3yr forward zori annualized (what actually happened)
  - delta

Answers the question: was trailing rent momentum predictive of forward rent growth?
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
pd.set_option('display.width', 250); pd.set_option('display.max_rows', 500)

# ── Load universe with zori data ────────────────────────────────────────────
WAREHOUSE = ROOT / 'data' / 'warehouse' / 'emerging_re.duckdb'
con = duckdb.connect(str(WAREHOUSE), read_only=True)
uni = con.execute(f"""
    SELECT fips, county_name, state_name, pop_latest,
           EXTRACT(YEAR FROM period_end_date)::INT AS year,
           cap_rate_proxy, zori_yoy,
           hpi_trailing_24mo, permits_intensity_ratio, unemployment_rate_yoy_chg,
           unemployment_rate, rental_vacancy_rate, renter_share,
           mf_cap_rate_change_3yr, any_disqualifier,
           zori_forward_return_36mo
    FROM main_marts.mart_county_features
    WHERE EXTRACT(MONTH FROM period_end_date) = 12
      AND pop_latest > {POP_MIN} AND pop_latest <= {POP_MAX}
      AND employment_diversity_hhi IS NOT NULL
      AND employment_diversity_hhi <= {HHI_MAX}
""").df()

# PIT population YoY for HC v2
pep_raw = con.execute("""
    SELECT fips, EXTRACT(YEAR FROM period_end_date)::INT AS ref_year,
           popestimate, as_of_date
    FROM main_staging.stg_census_pep
""").df()
con.close()
pep_raw['as_of_date'] = pd.to_datetime(pep_raw['as_of_date'])

def pit_pop_yoy(cohort_year):
    cutoff = pd.Timestamp(f'{cohort_year}-12-31')
    df = pep_raw[pep_raw['as_of_date'] <= cutoff].copy()
    if df.empty: return pd.DataFrame(columns=['fips','pop_yoy_pct'])
    df = df.sort_values(['fips','ref_year','as_of_date']).drop_duplicates(subset=['fips','ref_year'], keep='last')
    rows = []
    for f, sub in df.groupby('fips'):
        sub = sub.sort_values('ref_year', ascending=False)
        if len(sub) < 2: continue
        latest = sub.iloc[0]
        prev = sub[sub['ref_year'] == latest['ref_year'] - 1]
        if prev.empty: continue
        prev = prev.iloc[0]
        rows.append({'fips': f, 'pop_yoy_pct': (latest['popestimate']-prev['popestimate'])/prev['popestimate']*100})
    return pd.DataFrame(rows)

pop_yoy_cache = {yr: pit_pop_yoy(yr) for yr in range(2015, 2026)}

# Annualize forward
uni['zori_fwd_ann'] = (1 + uni['zori_forward_return_36mo']) ** (1/3) - 1

# ── Strategy implementations ─────────────────────────────────────────────────
def hc_v1_picks(year):
    c = uni[uni['year']==year].dropna(subset=['cap_rate_proxy']).sort_values('cap_rate_proxy', ascending=False)
    picked, sc = [], {}
    for _, r in c.iterrows():
        if sc.get(r['state_name'], 0) >= MAX_PER_STATE: continue
        picked.append(r); sc[r['state_name']] = sc.get(r['state_name'], 0) + 1
        if len(picked) >= TOP_N: break
    return pd.DataFrame(picked) if picked else pd.DataFrame()

GATES_V2 = {'min_pop_yoy_pct':0.0, 'max_unemp_pct':6.5, 'max_vacancy_frac':0.12, 'min_renter_share_frac':0.20, 'require_no_disq':True}
def hc_v2_picks(year):
    c = uni[uni['year']==year].dropna(subset=['cap_rate_proxy']).copy()
    pop_yr = pop_yoy_cache.get(year, pd.DataFrame())
    if not pop_yr.empty: c = c.merge(pop_yr[['fips','pop_yoy_pct']], on='fips', how='left')
    else: c['pop_yoy_pct'] = np.nan
    c = c[c['pop_yoy_pct'].isna() | (c['pop_yoy_pct'] >= 0.0)]
    c = c[c['unemployment_rate'].isna() | (c['unemployment_rate'] <= 6.5)]
    c = c[c['rental_vacancy_rate'].isna() | (c['rental_vacancy_rate'] <= 0.12)]
    c = c[c['renter_share'].isna() | (c['renter_share'] >= 0.20)]
    c = c[(c['any_disqualifier'] == False) | (c['any_disqualifier'].isna())]
    if c.empty: return pd.DataFrame()
    c = c.sort_values(['cap_rate_proxy','mf_cap_rate_change_3yr'], ascending=[False, True])
    picked, sc = [], {}
    for _, r in c.iterrows():
        if sc.get(r['state_name'], 0) >= MAX_PER_STATE: continue
        picked.append(r); sc[r['state_name']] = sc.get(r['state_name'], 0) + 1
        if len(picked) >= TOP_N: break
    return pd.DataFrame(picked) if picked else pd.DataFrame()

GATES_V3 = {'max_hpi_24mo':0.30, 'max_permit_ratio':1.5, 'max_unemp_yoy':1.0, 'require_no_disq':True}
def hc_v3_picks(year):
    c = uni[uni['year']==year].dropna(subset=['cap_rate_proxy']).copy()
    c = c[c['hpi_trailing_24mo'].isna() | (c['hpi_trailing_24mo'] < GATES_V3['max_hpi_24mo'])]
    c = c[c['permits_intensity_ratio'].isna() | (c['permits_intensity_ratio'] < GATES_V3['max_permit_ratio'])]
    c = c[c['unemployment_rate_yoy_chg'].isna() | (c['unemployment_rate_yoy_chg'] < GATES_V3['max_unemp_yoy'])]
    c = c[(c['any_disqualifier'] == False) | (c['any_disqualifier'].isna())]
    if c.empty: return pd.DataFrame()
    c = c.sort_values('cap_rate_proxy', ascending=False)
    picked, sc = [], {}
    for _, r in c.iterrows():
        if sc.get(r['state_name'], 0) >= MAX_PER_STATE: continue
        picked.append(r); sc[r['state_name']] = sc.get(r['state_name'], 0) + 1
        if len(picked) >= TOP_N: break
    return pd.DataFrame(picked) if picked else pd.DataFrame()

def hc_v4_picks(year, shortlist_mult=3):
    c = uni[uni['year']==year].dropna(subset=['cap_rate_proxy']).copy()
    K = TOP_N * shortlist_mult
    shortlist = c.nlargest(K, 'cap_rate_proxy').copy()
    shortlist = shortlist.sort_values('zori_yoy', ascending=False, na_position='last')
    picked, sc = [], {}
    for _, r in shortlist.iterrows():
        if sc.get(r['state_name'], 0) >= MAX_PER_STATE: continue
        picked.append(r); sc[r['state_name']] = sc.get(r['state_name'], 0) + 1
        if len(picked) >= TOP_N: break
    return pd.DataFrame(picked) if picked else pd.DataFrame()

# ELITE
print('Running ELITE walk-forward...\n')
panel = load_tertiary_panel(pop_min=POP_MIN, pop_max=POP_MAX, hhi_max=HHI_MAX)
panel = panel.merge(build_acs_target(horizon_years=HORIZON_YEARS), on=['fips','period_end_date'], how='left')
panel = panel.merge(load_mf_context(), on='fips', how='left')
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
            base = r.top5.head(TOP_N)[['fips','county_name','state_name']].copy()
            return base.merge(
                uni[uni['year']==year][['fips','zori_yoy','zori_forward_return_36mo','zori_fwd_ann']],
                on='fips', how='left')
    return pd.DataFrame()

# ── Build the master table: one row per (strategy, year, pick) ──────────────
STRATEGIES = [
    ('HC_v1', hc_v1_picks),
    ('HC_v2', hc_v2_picks),
    ('HC_v3', hc_v3_picks),
    ('HC_v4', hc_v4_picks),
    ('ELITE', elite_picks),
]

rows = []
for strat_name, pick_fn in STRATEGIES:
    for yr in range(2015, 2023):  # observable cohorts only (need 3yr forward)
        picks = pick_fn(yr)
        if picks.empty: continue
        for i, (_, r) in enumerate(picks.iterrows()):
            trailing = r.get('zori_yoy', np.nan)
            forward_cum = r.get('zori_forward_return_36mo', np.nan)
            forward_ann = r.get('zori_fwd_ann', np.nan)
            if pd.notna(forward_cum) and 'zori_fwd_ann' not in r.index:
                forward_ann = (1 + forward_cum) ** (1/3) - 1
            rows.append({
                'strategy': strat_name,
                'year':     yr,
                'rank':     i+1,
                'market':   f"{r['county_name'].replace(' County','')}, {r['state_name'][:2]}",
                'trailing_zori_yoy': trailing*100 if pd.notna(trailing) else None,
                'realized_fwd_3yr_cum': forward_cum*100 if pd.notna(forward_cum) else None,
                'realized_fwd_3yr_ann': forward_ann*100 if pd.notna(forward_ann) else None,
                'delta_fwd_minus_trailing': (forward_ann - trailing)*100 if pd.notna(forward_ann) and pd.notna(trailing) else None,
            })

df = pd.DataFrame(rows)

# ── Print per-strategy tables ────────────────────────────────────────────────
print('\n\n' + '=' * 130)
print(' PER-STRATEGY / PER-YEAR / PER-PICK — trailing zori_yoy at entry vs realized 3yr forward zori (annualized)')
print('=' * 130)

for strat_name, _ in STRATEGIES:
    sub = df[df['strategy'] == strat_name].copy()
    if sub.empty: continue
    print(f'\n╔══ {strat_name} ═══════════════════════════════════════════════════════════════════════════════════')
    display_cols = ['year','rank','market','trailing_zori_yoy','realized_fwd_3yr_ann','delta_fwd_minus_trailing']
    print(sub[display_cols].to_string(index=False,
        float_format=lambda x: f'{x:+.2f}%' if isinstance(x, float) else str(x)))
    # Aggregate stats
    obs = sub.dropna(subset=['trailing_zori_yoy','realized_fwd_3yr_ann'])
    if len(obs) > 1:
        corr = obs[['trailing_zori_yoy','realized_fwd_3yr_ann']].corr().iloc[0,1]
        mean_delta = obs['delta_fwd_minus_trailing'].mean()
        n_beat = (obs['realized_fwd_3yr_ann'] > obs['trailing_zori_yoy']).sum()
        print(f'    Aggregate: correlation trailing→forward = {corr:+.2f}   mean delta = {mean_delta:+.2f}pp   forward beat trailing in {n_beat}/{len(obs)} picks')

# ── Cross-strategy summary ─────────────────────────────────────────────────
print('\n\n' + '=' * 100)
print(' CROSS-STRATEGY SUMMARY (aggregated over all picks 2015-2022 observable cohorts)')
print('=' * 100)
summary = []
for strat_name, _ in STRATEGIES:
    sub = df[df['strategy'] == strat_name].dropna(subset=['trailing_zori_yoy','realized_fwd_3yr_ann'])
    if sub.empty: continue
    corr = sub[['trailing_zori_yoy','realized_fwd_3yr_ann']].corr().iloc[0,1]
    summary.append({
        'strategy': strat_name,
        'n_picks': len(sub),
        'avg_trailing_zori_yoy': sub['trailing_zori_yoy'].mean(),
        'avg_realized_fwd_ann': sub['realized_fwd_3yr_ann'].mean(),
        'avg_delta': sub['delta_fwd_minus_trailing'].mean(),
        'corr_trailing_fwd': corr,
        'forward_beat_trailing': f"{(sub['realized_fwd_3yr_ann'] > sub['trailing_zori_yoy']).sum()}/{len(sub)}",
    })
print(pd.DataFrame(summary).to_string(index=False, float_format=lambda x: f'{x:+.2f}%' if isinstance(x, float) else str(x)))
