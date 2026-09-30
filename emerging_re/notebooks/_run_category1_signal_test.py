"""Systematic test of Category 1 signals — loaded in mart but not currently scored.

For each candidate signal:
  1. Add as +0.5 weight to VALUE baseline
  2. Backtest at 3yr and 5yr horizons
  3. Report hit rate + edge delta vs baseline
"""
from __future__ import annotations
import duckdb, numpy as np, pandas as pd

WAREHOUSE = '/Users/premputtegowda/reps/reps-tracker/emerging_re/data/warehouse/emerging_re.duckdb'
POP_MIN, POP_MAX = 300_000, 1_000_000
TOP_N, MAX_PER_STATE = 10, 3
GATEWAY_FIPS = ['06037','36061','36047','36081','06075','25025','11001','17031']

# Category 1 signals to test (already in mart, not in VALUE scoring)
TEST_SIGNALS = [
    'foreign_born_cagr_3yr',
    'age_20_34_growth_3yr_cagr',
    'knowledge_emp_growth_vs_state_pp',
    'rent_growth_vs_wage_growth',
    'pcpi_growth_vs_state_1yr_pp',
    'high_wage_share_yoy_chg',
    'rental_vacancy_change_3yr',
    'mf_cap_rate_change_3yr',
    'renter_ind_emp_cagr_3yr',       # smoothed variant already used at yoy
    'irs_net_migration_rate',        # migration proxy
]

con = duckdb.connect(WAREHOUSE, read_only=True)
sig_cols = ", ".join(f'"{c}"' for c in TEST_SIGNALS)
uni = con.execute(f'''
    SELECT fips, county_name, state_name, pop_latest,
           EXTRACT(YEAR FROM period_end_date)::INT AS year,
           cap_rate_proxy, zori_yoy, unemployment_rate, hpi_yoy,
           permits_intensity_ratio, permits_per_1000, any_disqualifier,
           wage_growth_yoy, emp_growth_yoy, business_apps_per_1000,
           max_supersector_share, employment_diversity_hhi,
           zori_forward_return_36mo, hpi_forward_return_36mo,
           zori_forward_return_60mo, hpi_forward_return_60mo,
           {sig_cols}
    FROM main_marts.mart_county_features
    WHERE EXTRACT(MONTH FROM period_end_date) = 12
      AND pop_latest > {POP_MIN} AND pop_latest <= {POP_MAX}
      AND employment_diversity_hhi IS NOT NULL AND employment_diversity_hhi <= 0.20
''').df()
mortgage = con.execute('SELECT EXTRACT(YEAR FROM observation_date)::INT AS year, value/100.0 AS mortgage_rate FROM main_staging.stg_fred_macro WHERE series_id = \'MORTGAGE30US\' QUALIFY row_number() OVER (PARTITION BY EXTRACT(YEAR FROM observation_date) ORDER BY observation_date DESC)=1').df()
pep_raw = con.execute('SELECT fips, EXTRACT(YEAR FROM period_end_date)::INT AS ref_year, popestimate, as_of_date FROM main_staging.stg_census_pep').df()
gateway_caps = con.execute(f'SELECT EXTRACT(YEAR FROM period_end_date)::INT AS year, MEDIAN(cap_rate_proxy) AS gateway_cap_median FROM main_marts.mart_county_features WHERE EXTRACT(MONTH FROM period_end_date)=12 AND fips IN ({",".join(repr(f) for f in GATEWAY_FIPS)}) GROUP BY year').df()
con.close()
pep_raw['as_of_date'] = pd.to_datetime(pep_raw['as_of_date'])
uni = uni.merge(mortgage, on='year', how='left').merge(gateway_caps, on='year', how='left')
uni['cap_spread_to_gateway_pp'] = (uni['cap_rate_proxy'] - uni['gateway_cap_median']) * 100
uni['permits_per_new_job']      = uni['permits_per_1000'] / (uni['emp_growth_yoy'].clip(lower=0.005) * 450)

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

W_BASE = {'cap_spread_to_gateway_pp':2.0,'cap_rate_proxy':1.5,'wage_growth_yoy':0.8,'pop_yoy_pct':0.5,'business_apps_per_1000':0.5,'permits_per_new_job':-1.0}
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

def backtest_metric(weights, horizon, years):
    tr_col = f'total_return_{horizon}yr'
    total_n = total_above = total_below = 0
    total_edge = 0.0
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
        total_n += len(obs)
        total_above += int((obs['edge'] > 2).sum())
        total_below += int((obs['edge'] < -2).sum())
        total_edge += obs['edge'].sum()
    if total_n == 0: return {'n':0,'hit':0,'below':0,'edge':0}
    return {'n':total_n, 'hit': total_above/total_n*100, 'below':total_below,
            'edge': total_edge/total_n}

# Baseline
base_3 = backtest_metric(W_BASE, 3, range(2015,2023))
base_5 = backtest_metric(W_BASE, 5, range(2015,2021))

print('='*130)
print('CATEGORY 1 SIGNAL TEST — each candidate added at +0.5 weight to VALUE baseline')
print('='*130)
print(f'\nBaseline VALUE:  3yr hit {base_3["hit"]:.1f}%  edge {base_3["edge"]:+.2f}pp  below {base_3["below"]}   |   5yr hit {base_5["hit"]:.1f}%  edge {base_5["edge"]:+.2f}pp  below {base_5["below"]}')
print()

results = []
for signal in TEST_SIGNALS:
    if signal not in uni.columns:
        results.append({'signal':signal,'note':'NOT IN MART'})
        continue
    n_nonnull = uni[signal].notna().sum()
    if n_nonnull < 100:
        results.append({'signal':signal,'note':f'sparse ({n_nonnull} non-null)'})
        continue
    w = {**W_BASE, signal: 0.5}
    r3 = backtest_metric(w, 3, range(2015,2023))
    r5 = backtest_metric(w, 5, range(2015,2021))
    results.append({
        'signal':          signal,
        '3yr_hit_delta':   f'{r3["hit"] - base_3["hit"]:+.1f}pp',
        '3yr_edge_delta':  f'{r3["edge"] - base_3["edge"]:+.2f}pp',
        '3yr_below_delta': r3['below'] - base_3['below'],
        '5yr_hit_delta':   f'{r5["hit"] - base_5["hit"]:+.1f}pp',
        '5yr_edge_delta':  f'{r5["edge"] - base_5["edge"]:+.2f}pp',
        '5yr_below_delta': r5['below'] - base_5['below'],
        'combined_score':  round((r3['hit'] - base_3['hit']) + (r5['hit'] - base_5['hit']) +
                                 (r3['edge'] - base_3['edge']) + (r5['edge'] - base_5['edge']), 2),
    })

df = pd.DataFrame(results)
if 'combined_score' in df.columns:
    df = df.sort_values('combined_score', ascending=False, na_position='last')
print(df.to_string(index=False))

print()
print('='*130)
print('INTERPRETATION')
print('='*130)
print('  combined_score > +1  → probably helps (add to VALUE at +0.5)')
print('  combined_score  0-1  → marginal (test at multiple weights)')
print('  combined_score < 0   → hurts (skip)')
