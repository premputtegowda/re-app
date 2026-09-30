"""Sensitivity test — how much does each 2025 pick rely on business_apps signal?

Compare opportunity_score WITH business_apps (current) vs WITHOUT.
Markets with big score collapses when business_apps is removed =
signal is doing heavy lifting → potentially artifact (DE) or overweighted.
Markets with stable score = business_apps is confirming, not driving → real signal.
"""
from __future__ import annotations
import duckdb, numpy as np, pandas as pd

WAREHOUSE = '/Users/premputtegowda/reps/reps-tracker/emerging_re/data/warehouse/emerging_re.duckdb'
POP_MIN, POP_MAX = 300_000, 1_000_000
TOP_N, MAX_PER_STATE = 10, 3
GATEWAY_FIPS = ['06037','36061','36047','36081','06075','25025','11001','17031']

# Profile B (BALANCED — MID CYCLE) — business_apps at 1.0 weight
W_WITH_APPS = {
    'cap_spread_to_gateway_pp':          1.5, 'cap_rate_proxy':              1.0,
    'wage_growth_yoy':                   1.0, 'pop_yoy_pct':                 0.5,
    'business_apps_per_1000':            1.0, 'permits_per_new_job':        -0.8,
    'recession_resilience_score':        0.3, 'knowledge_emp_growth_vs_state_pp':0.5,
    'rent_growth_vs_wage_growth':        0.5,
}
W_WITHOUT_APPS = {k:v for k,v in W_WITH_APPS.items() if k != 'business_apps_per_1000'}
GATES = {'min_pop_yoy_pct':0.0,'max_permit_ratio':1.5,'max_unemp_pct':6.0,'min_wage_growth':0.02,'max_sector_share':0.25,'min_cap_spread_pp':0.0,'max_hhi_strategy':0.15,'require_no_disq':True}

con = duckdb.connect(WAREHOUSE, read_only=True)
uni = con.execute(f'''
    SELECT fips, county_name, state_name, pop_latest,
           EXTRACT(YEAR FROM period_end_date)::INT AS year,
           cap_rate_proxy, zori_yoy, unemployment_rate, hpi_yoy,
           permits_intensity_ratio, permits_per_1000, any_disqualifier,
           wage_growth_yoy, emp_growth_yoy, business_apps_per_1000,
           max_supersector_share, employment_diversity_hhi,
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
_hpi = con.execute(f'SELECT fips, EXTRACT(YEAR FROM period_end_date)::INT AS year, hpi FROM main_staging.stg_fhfa_hpi WHERE fips IN ({_all_fips_str}) AND EXTRACT(MONTH FROM period_end_date)=12 QUALIFY row_number() OVER (PARTITION BY fips, EXTRACT(YEAR FROM period_end_date) ORDER BY as_of_date DESC)=1').df()
con.close()
pep_raw['as_of_date'] = pd.to_datetime(pep_raw['as_of_date'])
uni = uni.merge(mortgage, on='year', how='left').merge(gateway_caps, on='year', how='left')
uni['cap_spread_to_gateway_pp'] = (uni['cap_rate_proxy'] - uni['gateway_cap_median']) * 100
uni['permits_per_new_job'] = uni['permits_per_1000'] / (uni['emp_growth_yoy'].clip(lower=0.005) * 450)
_lag5 = _hpi.rename(columns={'hpi':'hpi_5yr_prior','year':'year_join'})
_lag5['year_join'] = _lag5['year_join'] + 5
_hpi = _hpi.merge(_lag5[['fips','year_join','hpi_5yr_prior']], left_on=['fips','year'], right_on=['fips','year_join'], how='left').drop(columns='year_join')
_hpi['trailing_5yr_hpi_ann'] = (_hpi['hpi'] / _hpi['hpi_5yr_prior']) ** (1/5) - 1
uni = uni.merge(_hpi[['fips','year','trailing_5yr_hpi_ann']], on=['fips','year'], how='left')

def _y(v):
    if pd.isna(v): return 5
    p=v*100; return 10 if p>=8 else 8 if p>=7 else 6 if p>=6.5 else 4 if p>=6 else 2 if p>=5.5 else 0
def _b(v):
    if pd.isna(v): return 5
    p=v*100; return 10 if p<3 else 8 if p<5 else 6 if p<8 else 4 if p<10 else 2 if p<12 else 0
def _d(v):
    if pd.isna(v): return 5
    return 10 if v<0.06 else 8 if v<0.08 else 6 if v<0.10 else 4 if v<0.12 else 2 if v<0.15 else 0
def _pfn(v):
    if pd.isna(v): return 5
    return 10 if v<=0.8 else 8 if v<=1.0 else 6 if v<=1.2 else 4 if v<=1.5 else 2 if v<=2.0 else 0
def _m(v):
    if pd.isna(v): return 5
    if v<0: return 4
    return 10 if v<=1 else 8 if v<=2 else 6 if v<=3 else 4 if v<=4 else 2
uni['rrs_Y'] = uni['cap_rate_proxy'].apply(_y); uni['rrs_B'] = uni['trailing_5yr_hpi_ann'].apply(_b)
uni['rrs_D'] = uni['employment_diversity_hhi'].apply(_d); uni['rrs_P'] = uni['permits_intensity_ratio'].apply(_pfn)
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

def score_pool(c, weights):
    c = c.copy()
    c['score'] = 0.0
    for col, w in weights.items():
        if col in c.columns and c[col].notna().any():
            mu, sig = c[col].mean(), c[col].std()
            if sig > 0:
                z = (c[col] - mu) / sig
                c['score'] = c['score'] + w * z.fillna(0)
    return c

def qualified_pool(year):
    c = uni[uni['year']==year].dropna(subset=['cap_rate_proxy']).copy()
    if c.empty: return c
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
    if c.empty: return c
    c = c[c['cap_rate_proxy'] >= c['cap_rate_proxy'].median()]
    return c

def state_cap_pick(c, weights, top_n=TOP_N):
    c = score_pool(c, weights).sort_values('score', ascending=False)
    picked, sc = [], {}
    for _, r in c.iterrows():
        if sc.get(r['state_name'], 0) >= MAX_PER_STATE: continue
        picked.append(r); sc[r['state_name']] = sc.get(r['state_name'], 0) + 1
        if len(picked) >= top_n: break
    return pd.DataFrame(picked) if picked else pd.DataFrame()

# ── SENSITIVITY TEST for 2025 picks ────────────────────────────────────────
pool_2025 = qualified_pool(2025)
scored_with = score_pool(pool_2025, W_WITH_APPS).sort_values('score', ascending=False).reset_index(drop=True)
scored_without = score_pool(pool_2025, W_WITHOUT_APPS).sort_values('score', ascending=False).reset_index(drop=True)

# Merge on fips to compare rank
merged = scored_with[['fips','county_name','state_name','pop_latest','business_apps_per_1000','cap_rate_proxy','score']].rename(columns={'score':'score_with'})
merged['rank_with'] = merged.reset_index().index + 1
without_rank = scored_without[['fips','score']].rename(columns={'score':'score_without'}).reset_index(drop=True)
without_rank['rank_without'] = without_rank.reset_index().index + 1
merged = merged.merge(without_rank, on='fips', how='left')
merged['score_delta'] = merged['score_with'] - merged['score_without']
merged['rank_change'] = merged['rank_without'] - merged['rank_with']  # positive = dropped when apps removed

# Get top-15 by score_with
print('='*140)
print('BUSINESS_APPS SENSITIVITY — top 15 markets under Profile B (2025)')
print('='*140)
print(f'\n{"rank":>5}{"market":<30}{"pop":>10}{"apps":>8}{"cap":>7}{"score_with":>12}{"score_without":>15}{"score_Δ":>10}{"rank_without":>15}{"artifact_risk"}')
print('-'*140)
top15 = merged.head(15)
for i, r in top15.iterrows():
    name = f"{r['county_name'].replace(' County','')}, {r['state_name']}"
    delta_pct = (r['score_delta'] / max(abs(r['score_with']), 0.1)) * 100 if abs(r['score_with']) > 0 else 0
    flag = ''
    if r['score_delta'] > 0.5 and r['business_apps_per_1000'] > 30:
        flag = 'FLAGGED — high apps + big score drop'
    elif r['score_delta'] > 0.3:
        flag = 'moderate reliance on apps'
    elif r['business_apps_per_1000'] > 30 and r['score_delta'] < 0.2:
        flag = 'high apps but not driving score (OK)'
    print(f'{int(r["rank_with"]):>5}   {name:<28}{int(r["pop_latest"]):>10,}{r["business_apps_per_1000"]:>8.1f}{r["cap_rate_proxy"]*100:>6.2f}%{r["score_with"]:>+11.2f}{r["score_without"]:>+14.2f}{r["score_delta"]:>+9.2f}{int(r["rank_without"]):>15}   {flag}')

# ── Same test for the SPECIFIC potential-artifact states ──────────────────
print()
print('='*140)
print('SPECIFIC STATES CHECK — DE, NV, WY (any pop, in universe)')
print('='*140)
haven_mask = merged['state_name'].isin(['Delaware','Nevada','Wyoming'])
if not merged[haven_mask].empty:
    for _, r in merged[haven_mask].sort_values('score_with', ascending=False).iterrows():
        name = f"{r['county_name'].replace(' County','')}, {r['state_name']}"
        print(f'  {name:<30} apps={r["business_apps_per_1000"]:>6.1f}  cap={r["cap_rate_proxy"]*100:.2f}%  score_with={r["score_with"]:+.2f}  score_without={r["score_without"]:+.2f}  Δ={r["score_delta"]:+.2f}  rank_with={int(r["rank_with"])}, rank_without={int(r["rank_without"])}')

# ── Show top 10 picks side-by-side ────────────────────────────────────────
print()
print('='*140)
print('TOP 10 PICKS: WITH business_apps vs WITHOUT (Profile B, 2025)')
print('='*140)
picks_with = state_cap_pick(pool_2025, W_WITH_APPS, TOP_N)
picks_without = state_cap_pick(pool_2025, W_WITHOUT_APPS, TOP_N)
print(f'\n{"#":<3}{"WITH business_apps":<32}{"WITHOUT business_apps":<32}')
print('-'*70)
for i in range(TOP_N):
    w_name = f"{picks_with.iloc[i]['county_name'].replace(' County','')}, {picks_with.iloc[i]['state_name']}" if i < len(picks_with) else '-'
    wo_name = f"{picks_without.iloc[i]['county_name'].replace(' County','')}, {picks_without.iloc[i]['state_name']}" if i < len(picks_without) else '-'
    flag = ' <-- CHANGED' if w_name != wo_name else ''
    print(f'{i+1:<3}{w_name:<32}{wo_name:<32}{flag}')

# Diff summary
with_set = set(picks_with['fips'])
without_set = set(picks_without['fips'])
same = with_set & without_set
w_only = with_set - without_set
wo_only = without_set - with_set
def _name_of(df, f):
    row = df[df['fips']==f].iloc[0]
    return row['county_name'].replace(' County','') + ', ' + row['state_name']
print(f'\n  In BOTH: {len(same)}')
if w_only:
    dropped = [_name_of(picks_with, f) for f in w_only]
    print(f'  DROPPED when apps removed (was propped by apps): {dropped}')
if wo_only:
    added = [_name_of(picks_without, f) for f in wo_only]
    print(f'  ADDED when apps removed (was suppressed):        {added}')
