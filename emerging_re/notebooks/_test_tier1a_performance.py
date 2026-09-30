"""Test performance: VALUE baseline vs VALUE + Tier 1a signals.

Tier 1a additions:
  + knowledge_emp_growth_vs_state_pp @ 0.5
  + rent_growth_vs_wage_growth @ 0.3

Compare on:
  - 3yr and 5yr horizons
  - Full VALUE, intersection, single-strategy picks
  - 2025 pick list changes
"""
from __future__ import annotations
import duckdb, numpy as np, pandas as pd

WAREHOUSE = '/Users/premputtegowda/reps/reps-tracker/emerging_re/data/warehouse/emerging_re.duckdb'
POP_MIN, POP_MAX = 300_000, 1_000_000
TOP_N, MAX_PER_STATE = 10, 3
GATEWAY_FIPS = ['06037','36061','36047','36081','06075','25025','11001','17031']

con = duckdb.connect(WAREHOUSE, read_only=True)
uni = con.execute(f'''
    SELECT fips, county_name, state_name, pop_latest,
           EXTRACT(YEAR FROM period_end_date)::INT AS year,
           cap_rate_proxy, zori_yoy, unemployment_rate, hpi_yoy,
           permits_intensity_ratio, permits_per_1000, any_disqualifier,
           wage_growth_yoy, emp_growth_yoy, business_apps_per_1000,
           max_supersector_share, employment_diversity_hhi,
           renter_ind_emp_yoy, mf_permit_ratio_change_3yr,
           unemployment_rate_yoy_chg, domesticmig_per_1000,
           knowledge_emp_growth_vs_state_pp, rent_growth_vs_wage_growth,
           zori_forward_return_36mo, hpi_forward_return_36mo,
           zori_forward_return_60mo, hpi_forward_return_60mo
    FROM main_marts.mart_county_features
    WHERE EXTRACT(MONTH FROM period_end_date) = 12
      AND pop_latest > {POP_MIN} AND pop_latest <= {POP_MAX}
      AND employment_diversity_hhi IS NOT NULL AND employment_diversity_hhi <= 0.20
''').df()
mortgage = con.execute('SELECT EXTRACT(YEAR FROM observation_date)::INT AS year, value/100.0 AS mortgage_rate FROM main_staging.stg_fred_macro WHERE series_id = \'MORTGAGE30US\' QUALIFY row_number() OVER (PARTITION BY EXTRACT(YEAR FROM observation_date) ORDER BY observation_date DESC)=1').df()
pep_raw = con.execute('SELECT fips, EXTRACT(YEAR FROM period_end_date)::INT AS ref_year, popestimate, as_of_date FROM main_staging.stg_census_pep').df()
gateway_caps = con.execute(f'SELECT EXTRACT(YEAR FROM period_end_date)::INT AS year, MEDIAN(cap_rate_proxy) AS gateway_cap_median FROM main_marts.mart_county_features WHERE EXTRACT(MONTH FROM period_end_date)=12 AND fips IN ({",".join(repr(f) for f in GATEWAY_FIPS)}) GROUP BY year').df()
_all_fips_str = ",".join(repr(f) for f in uni['fips'].unique().tolist())
_hpi_all = con.execute(f'SELECT fips, EXTRACT(YEAR FROM period_end_date)::INT AS year, hpi FROM main_staging.stg_fhfa_hpi WHERE fips IN ({_all_fips_str}) AND EXTRACT(MONTH FROM period_end_date)=12 QUALIFY row_number() OVER (PARTITION BY fips, EXTRACT(YEAR FROM period_end_date) ORDER BY as_of_date DESC)=1').df()
con.close()
pep_raw['as_of_date'] = pd.to_datetime(pep_raw['as_of_date'])
uni = uni.merge(mortgage, on='year', how='left').merge(gateway_caps, on='year', how='left')
uni['cap_spread_to_gateway_pp'] = (uni['cap_rate_proxy'] - uni['gateway_cap_median']) * 100
uni['permits_per_new_job']      = uni['permits_per_1000'] / (uni['emp_growth_yoy'].clip(lower=0.005) * 450)
_lag5 = _hpi_all.rename(columns={'hpi':'hpi_5yr_prior','year':'year_join'})
_lag5['year_join'] = _lag5['year_join'] + 5
_hpi_all = _hpi_all.merge(_lag5[['fips','year_join','hpi_5yr_prior']], left_on=['fips','year'], right_on=['fips','year_join'], how='left').drop(columns='year_join')
_hpi_all['trailing_5yr_hpi_ann'] = (_hpi_all['hpi'] / _hpi_all['hpi_5yr_prior']) ** (1/5) - 1
uni = uni.merge(_hpi_all[['fips','year','trailing_5yr_hpi_ann']], on=['fips','year'], how='left')

def _y(v):
    if pd.isna(v): return 5
    p=v*100; return 10 if p>=8 else 8 if p>=7 else 6 if p>=6.5 else 4 if p>=6 else 2 if p>=5.5 else 0
def _b(v):
    if pd.isna(v): return 5
    p=v*100; return 10 if p<3 else 8 if p<5 else 6 if p<8 else 4 if p<10 else 2 if p<12 else 0
def _d(v):
    if pd.isna(v): return 5
    return 10 if v<0.06 else 8 if v<0.08 else 6 if v<0.10 else 4 if v<0.12 else 2 if v<0.15 else 0
def _p(v):
    if pd.isna(v): return 5
    return 10 if v<=0.8 else 8 if v<=1.0 else 6 if v<=1.2 else 4 if v<=1.5 else 2 if v<=2.0 else 0
def _m(v):
    if pd.isna(v): return 5
    if v<0: return 4
    return 10 if v<=1 else 8 if v<=2 else 6 if v<=3 else 4 if v<=4 else 2

uni['rrs_Y'] = uni['cap_rate_proxy'].apply(_y); uni['rrs_B'] = uni['trailing_5yr_hpi_ann'].apply(_b)
uni['rrs_D'] = uni['employment_diversity_hhi'].apply(_d); uni['rrs_P'] = uni['permits_intensity_ratio'].apply(_p)
STATE_OPEX = {'Ohio':0.57,'Michigan':0.57,'Pennsylvania':0.57,'Illinois':0.57,'Wisconsin':0.57,'New York':0.57,'New Jersey':0.57,'Connecticut':0.57,'Missouri':0.52,'Massachusetts':0.52,'Maryland':0.52,'California':0.47,'Iowa':0.47,'Minnesota':0.47,'Florida':0.47,'Indiana':0.47,'Texas':0.44,'Virginia':0.44,'Colorado':0.44,'Washington':0.44,'Kansas':0.44,'Kentucky':0.44,'Georgia':0.42,'North Carolina':0.42,'South Carolina':0.42,'Tennessee':0.42,'Oklahoma':0.42,'Utah':0.42,'Idaho':0.42,'Arizona':0.40,'Nevada':0.40,'Alabama':0.40,'Mississippi':0.40,'Arkansas':0.40}
uni['opex_ratio'] = uni['state_name'].map(STATE_OPEX).fillna(0.45)
for h, zc, hc in [(3,'zori_forward_return_36mo','hpi_forward_return_36mo'),(5,'zori_forward_return_60mo','hpi_forward_return_60mo')]:
    uni[f'total_return_{h}yr'] = h * uni['cap_rate_proxy'] * (1-uni['opex_ratio']) * (1 + uni[zc]/2) + uni[hc]

def pit_pop_yoy(cy):
    cutoff = pd.Timestamp(f'{cy}-12-31')
    df = pep_raw[pep_raw['as_of_date'] <= cutoff].sort_values(['fips','ref_year','as_of_date']).drop_duplicates(subset=['fips','ref_year'], keep='last')
    rows=[]
    for f, sub in df.groupby('fips'):
        sub = sub.sort_values('ref_year', ascending=False)
        if len(sub)<2: continue
        latest, prev = sub.iloc[0], sub[sub['ref_year']==sub.iloc[0]['ref_year']-1]
        if prev.empty: continue
        rows.append({'fips':f,'pop_yoy_pct':(latest['popestimate']-prev.iloc[0]['popestimate'])/prev.iloc[0]['popestimate']*100})
    return pd.DataFrame(rows)
pop_yoy_cache = {yr: pit_pop_yoy(yr) for yr in range(2015, 2026)}
_pop_all = pd.concat([df.assign(year=yr) for yr,df in pop_yoy_cache.items() if not df.empty], ignore_index=True)
uni = uni.merge(_pop_all[['fips','year','pop_yoy_pct']].rename(columns={'pop_yoy_pct':'pop_yoy_rrs'}), on=['fips','year'], how='left')
uni['rrs_M'] = uni['pop_yoy_rrs'].apply(_m)
uni['recession_resilience_score'] = (0.30*uni['rrs_Y'] + 0.30*uni['rrs_B'] + 0.15*uni['rrs_D'] + 0.15*uni['rrs_M'] + 0.10*uni['rrs_P'])

# Weight configurations to compare
W_BASELINE = {
    'cap_spread_to_gateway_pp':2.0,'cap_rate_proxy':1.5,'wage_growth_yoy':0.8,
    'pop_yoy_pct':0.5,'business_apps_per_1000':0.5,'permits_per_new_job':-1.0,
    'recession_resilience_score':0.5,
}
W_TIER1A = {
    **W_BASELINE,
    'knowledge_emp_growth_vs_state_pp':0.5,
    'rent_growth_vs_wage_growth':0.3,
}
W_LEADING = {'domesticmig_per_1000':0.5,'renter_ind_emp_yoy':0.5,'business_apps_per_1000':0.5,'mf_permit_ratio_change_3yr':0.5,'unemployment_rate_yoy_chg':-0.5,'wage_growth_yoy':0.5}
GATES = {'min_pop_yoy_pct':0.0,'max_permit_ratio':1.5,'max_unemp_pct':6.0,'min_wage_growth':0.02,'max_sector_share':0.25,'min_cap_spread_pp':0.0,'max_hhi_strategy':0.15,'require_no_disq':True}

def pick_for_year(year, weights):
    c = uni[uni['year']==year].dropna(subset=['cap_rate_proxy']).copy()
    if c.empty: return pd.DataFrame()
    pop_yr = pop_yoy_cache.get(year, pd.DataFrame())
    c = c.merge(pop_yr[['fips','pop_yoy_pct']], on='fips', how='left') if not pop_yr.empty else c.assign(pop_yoy_pct=np.nan)
    c = c[c['pop_yoy_pct'].isna() | (c['pop_yoy_pct'] >= GATES['min_pop_yoy_pct'])]
    c = c[c['permits_intensity_ratio'].isna() | (c['permits_intensity_ratio'] < GATES['max_permit_ratio'])]
    c = c[c['unemployment_rate'].isna() | (c['unemployment_rate'] <= GATES['max_unemp_pct'])]
    c = c[c['wage_growth_yoy'].isna() | (c['wage_growth_yoy'] >= GATES['min_wage_growth'])]
    c = c[c['max_supersector_share'].isna() | (c['max_supersector_share'] <= GATES['max_sector_share'])]
    c = c[c['cap_spread_to_gateway_pp'].isna() | (c['cap_spread_to_gateway_pp'] >= GATES['min_cap_spread_pp'])]
    c = c[c['employment_diversity_hhi'].isna() | (c['employment_diversity_hhi'] <= GATES['max_hhi_strategy'])]
    c = c[(c['any_disqualifier']==False) | (c['any_disqualifier'].isna())]
    if c.empty: return pd.DataFrame()
    c = c[c['cap_rate_proxy'] >= c['cap_rate_proxy'].median()]
    if c.empty: return pd.DataFrame()
    c['opportunity_score'] = 0.0
    for col, w in weights.items():
        if col in c.columns and c[col].notna().any():
            mu, sig = c[col].mean(), c[col].std()
            if sig > 0:
                z = (c[col] - mu) / sig
                c['opportunity_score'] = c['opportunity_score'] + w * z.fillna(0)
    c = c.sort_values('opportunity_score', ascending=False)
    picked, sc = [], {}
    for _, r in c.iterrows():
        if sc.get(r['state_name'], 0) >= MAX_PER_STATE: continue
        picked.append(r); sc[r['state_name']] = sc.get(r['state_name'], 0) + 1
        if len(picked) >= TOP_N: break
    return pd.DataFrame(picked) if picked else pd.DataFrame()

def backtest_perf(weights, horizon, years):
    tr_col = f'total_return_{horizon}yr'
    per_yr = []
    for yr in years:
        picks = pick_for_year(yr, weights)
        if picks.empty: continue
        yr_uni = uni[uni['year']==yr].dropna(subset=[tr_col])
        if yr_uni.empty: continue
        uni_mean = yr_uni[tr_col].mean() * 100
        obs = picks.dropna(subset=[tr_col]).copy()
        if obs.empty: continue
        obs['tr_pct'] = obs[tr_col] * 100
        obs['edge']   = obs['tr_pct'] - uni_mean
        per_yr.append({'year':yr,'n':len(obs),
                        'above':int((obs['edge']>2).sum()),
                        'avg':int((abs(obs['edge'])<=2).sum()),
                        'below':int((obs['edge']<-2).sum()),
                        'under':int((obs['tr_pct']<0).sum()),
                        'edge':obs['edge'].mean(),'mean_tr':obs['tr_pct'].mean()})
    return pd.DataFrame(per_yr)

def summarize(df, name):
    if df.empty: return None
    n = df['n'].sum()
    return {
        'strategy':name,
        'n':int(n),
        'above':f'{int(df["above"].sum())}/{int(n)} ({df["above"].sum()/n*100:.1f}%)',
        'avg':f'{int(df["avg"].sum())}/{int(n)}',
        'below':f'{int(df["below"].sum())}/{int(n)}',
        'under':f'{int(df["under"].sum())}/{int(n)}',
        'edge':f'{(df["edge"]*df["n"]).sum()/n:+.2f}pp',
        'mean_tr':f'{(df["mean_tr"]*df["n"]).sum()/n:+.2f}%',
    }

# Full VALUE
print('='*130)
print('VALUE STRATEGY — BASELINE vs +TIER 1A signals')
print('='*130)
for horizon, years in [(3, range(2015,2023)), (5, range(2015,2021))]:
    print(f'\n═══ {horizon}yr horizon ═══\n')
    bt_base = backtest_perf(W_BASELINE, horizon, list(years))
    bt_tier1 = backtest_perf(W_TIER1A, horizon, list(years))
    print(pd.DataFrame([summarize(bt_base, 'A. BASELINE VALUE'), summarize(bt_tier1, 'B. + TIER 1A signals')]).to_string(index=False))

# Intersection with LEADING
print('\n' + '='*130)
print('INTERSECTION (VALUE ∩ LEADING) — BASELINE vs +TIER 1A')
print('='*130)
for horizon, years in [(3, range(2015,2023)), (5, range(2015,2021))]:
    print(f'\n═══ {horizon}yr horizon ═══\n')
    for name, W in [('A. BASELINE VALUE ∩ LEADING', W_BASELINE), ('B. +TIER 1A ∩ LEADING', W_TIER1A)]:
        tr_col = f'total_return_{horizon}yr'
        per_yr = []
        for yr in years:
            v = pick_for_year(yr, W)
            l = pick_for_year(yr, W_LEADING)
            if v.empty or l.empty: continue
            both = set(v['fips']) & set(l['fips'])
            inter = v[v['fips'].isin(both)]
            yr_uni = uni[uni['year']==yr].dropna(subset=[tr_col])
            if yr_uni.empty: continue
            uni_mean = yr_uni[tr_col].mean() * 100
            obs = inter.dropna(subset=[tr_col]).copy()
            if obs.empty: continue
            obs['tr_pct'] = obs[tr_col] * 100
            obs['edge'] = obs['tr_pct'] - uni_mean
            per_yr.append({'year':yr,'n':len(obs),
                            'above':int((obs['edge']>2).sum()),
                            'avg':int((abs(obs['edge'])<=2).sum()),
                            'below':int((obs['edge']<-2).sum()),
                            'under':int((obs['tr_pct']<0).sum()),
                            'edge':obs['edge'].mean(),'mean_tr':obs['tr_pct'].mean()})
        s = summarize(pd.DataFrame(per_yr), name)
        print(pd.DataFrame([s]).to_string(index=False))

# 2025 pick shift
print('\n' + '='*130)
print('2025 PICKS — baseline vs +TIER 1A')
print('='*130)
for name, W in [('BASELINE VALUE', W_BASELINE), ('+ TIER 1A', W_TIER1A)]:
    picks = pick_for_year(2025, W)
    print(f'\n── {name} ──')
    if picks.empty: continue
    for i, r in picks.reset_index(drop=True).iterrows():
        n = f"{r['county_name'].replace(' County','')}, {r['state_name']}"
        cap = r['cap_rate_proxy']*100
        kwg = r.get('knowledge_emp_growth_vs_state_pp', float('nan'))
        rwg = r.get('rent_growth_vs_wage_growth', float('nan'))
        kwg_s = f'{kwg*100:+.2f}pp' if pd.notna(kwg) else 'n/a'
        rwg_s = f'{rwg*100:+.2f}pp' if pd.notna(rwg) else 'n/a'
        print(f'  #{i+1} {n:<28}  cap {cap:>5.2f}%   knowledge_emp_vs_state {kwg_s}   rent_vs_wage {rwg_s}')
