"""Test business_apps moving-average acceleration as a signal.

Signal: `apps_ma_ratio` = current_year_apps / avg(prior 3 years)
- > 1.15  STRONG_ACCEL   (current 15%+ above trend)
- 1.05-1.15 MODERATE_ACCEL
- 0.95-1.05 FLAT
- < 0.95  DECEL          (current below trend)

Tests:
  1. Historical hit rate by tier (does ratio predict outperformance?)
  2. Backtest VALUE with ma_ratio added as a scoring weight
  3. 2025 picks with their ma_ratio (which are actually accelerating?)
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
           zori_forward_return_36mo, hpi_forward_return_36mo,
           zori_forward_return_60mo, hpi_forward_return_60mo
    FROM main_marts.mart_county_features
    WHERE EXTRACT(MONTH FROM period_end_date) = 12
      AND pop_latest > {POP_MIN} AND pop_latest <= {POP_MAX}
      AND employment_diversity_hhi IS NOT NULL
      AND employment_diversity_hhi <= 0.20
''').df()
mortgage = con.execute('''
    SELECT EXTRACT(YEAR FROM observation_date)::INT AS year, value/100.0 AS mortgage_rate
    FROM main_staging.stg_fred_macro WHERE series_id = 'MORTGAGE30US'
    QUALIFY row_number() OVER (PARTITION BY EXTRACT(YEAR FROM observation_date) ORDER BY observation_date DESC)=1
''').df()
pep_raw = con.execute('''
    SELECT fips, EXTRACT(YEAR FROM period_end_date)::INT AS ref_year, popestimate, as_of_date
    FROM main_staging.stg_census_pep
''').df()
gateway_caps = con.execute(f'''
    SELECT EXTRACT(YEAR FROM period_end_date)::INT AS year,
           MEDIAN(cap_rate_proxy) AS gateway_cap_median
    FROM main_marts.mart_county_features
    WHERE EXTRACT(MONTH FROM period_end_date) = 12
      AND fips IN ({",".join(repr(f) for f in GATEWAY_FIPS)})
    GROUP BY year
''').df()
con.close()
pep_raw['as_of_date'] = pd.to_datetime(pep_raw['as_of_date'])
uni = uni.merge(mortgage, on='year', how='left').merge(gateway_caps, on='year', how='left')
uni['cap_spread_to_gateway_pp'] = (uni['cap_rate_proxy'] - uni['gateway_cap_median']) * 100
uni['permits_per_new_job']      = uni['permits_per_1000'] / (uni['emp_growth_yoy'].clip(lower=0.005) * 450)

# ── Business apps moving-average ratio ─────────────────────────────────────
# For each (fips, year), compute avg of prior 3 years (year-3, year-2, year-1)
uni_sorted = uni.sort_values(['fips','year']).reset_index(drop=True)
uni_sorted['apps_prior_3yr_avg'] = (uni_sorted.groupby('fips')['business_apps_per_1000']
                                     .transform(lambda s: s.shift(1).rolling(3, min_periods=3).mean()))
uni_sorted['apps_ma_ratio'] = uni_sorted['business_apps_per_1000'] / uni_sorted['apps_prior_3yr_avg']

# 5yr version for comparison
uni_sorted['apps_prior_5yr_avg'] = (uni_sorted.groupby('fips')['business_apps_per_1000']
                                     .transform(lambda s: s.shift(1).rolling(5, min_periods=5).mean()))
uni_sorted['apps_ma_ratio_5yr'] = uni_sorted['business_apps_per_1000'] / uni_sorted['apps_prior_5yr_avg']
uni = uni_sorted.copy()

def _tier(r):
    if pd.isna(r): return 'unknown'
    if r > 1.15:  return 'STRONG_ACCEL'
    if r > 1.05:  return 'MOD_ACCEL'
    if r > 0.95:  return 'FLAT'
    return 'DECEL'
uni['apps_ma_tier'] = uni['apps_ma_ratio'].apply(_tier)

STATE_OPEX = {
    'Ohio':0.57,'Michigan':0.57,'Pennsylvania':0.57,'Illinois':0.57,'Wisconsin':0.57,
    'New York':0.57,'New Jersey':0.57,'Connecticut':0.57,
    'Missouri':0.52,'Massachusetts':0.52,'Maryland':0.52,
    'California':0.47,'Iowa':0.47,'Minnesota':0.47,'Florida':0.47,'Indiana':0.47,
    'Texas':0.44,'Virginia':0.44,'Colorado':0.44,'Washington':0.44,'Kansas':0.44,'Kentucky':0.44,
    'Georgia':0.42,'North Carolina':0.42,'South Carolina':0.42,'Tennessee':0.42,
    'Oklahoma':0.42,'Utah':0.42,'Idaho':0.42,
    'Arizona':0.40,'Nevada':0.40,'Alabama':0.40,'Mississippi':0.40,'Arkansas':0.40,
}
uni['opex_ratio'] = uni['state_name'].map(STATE_OPEX).fillna(0.45)
for h, zc, hc in [(3,'zori_forward_return_36mo','hpi_forward_return_36mo'),
                  (5,'zori_forward_return_60mo','hpi_forward_return_60mo')]:
    uni[f'cash_flow_{h}yr']  = h * uni['cap_rate_proxy'] * (1-uni['opex_ratio']) * (1 + uni[zc]/2)
    uni[f'total_return_{h}yr'] = uni[f'cash_flow_{h}yr'] + uni[hc]

def pit_pop_yoy(cohort_year):
    cutoff = pd.Timestamp(f'{cohort_year}-12-31')
    df = pep_raw[pep_raw['as_of_date'] <= cutoff].copy()
    if df.empty: return pd.DataFrame(columns=['fips','pop_yoy_pct'])
    df = df.sort_values(['fips','ref_year','as_of_date']).drop_duplicates(subset=['fips','ref_year'], keep='last')
    rows = []
    for f, sub in df.groupby('fips'):
        sub = sub.sort_values('ref_year', ascending=False)
        if len(sub) < 2: continue
        latest, prev = sub.iloc[0], sub[sub['ref_year']==sub.iloc[0]['ref_year']-1]
        if prev.empty: continue
        prev = prev.iloc[0]
        rows.append({'fips':f,'pop_yoy_pct':(latest['popestimate']-prev['popestimate'])/prev['popestimate']*100})
    return pd.DataFrame(rows)
pop_yoy_cache = {yr: pit_pop_yoy(yr) for yr in range(2015, 2026)}

W_BASE = {
    'cap_spread_to_gateway_pp':2.0,'cap_rate_proxy':1.5,'wage_growth_yoy':0.8,
    'pop_yoy_pct':0.5,'business_apps_per_1000':0.5,'permits_per_new_job':-1.0,
}
W_MA05 = {**W_BASE, 'apps_ma_ratio':0.5}    # ma_ratio as extra weight 0.5
W_MA10 = {**W_BASE, 'apps_ma_ratio':1.0}    # ma_ratio as extra weight 1.0
W_MA_REPLACE = {                             # replace apps level with ma_ratio
    'cap_spread_to_gateway_pp':2.0,'cap_rate_proxy':1.5,'wage_growth_yoy':0.8,
    'pop_yoy_pct':0.5,'apps_ma_ratio':1.0,'permits_per_new_job':-1.0,
}
GATES = {
    'min_pop_yoy_pct':0.0,'max_permit_ratio':1.5,'max_unemp_pct':6.0,
    'min_wage_growth':0.02,'max_sector_share':0.25,'min_cap_spread_pp':0.0,
    'max_hhi_strategy':0.15,'require_no_disq':True,
}

def pick_for_year(year, weights, gates=GATES):
    c = uni[uni['year']==year].dropna(subset=['cap_rate_proxy']).copy()
    if c.empty: return pd.DataFrame()
    pop_yr = pop_yoy_cache.get(year, pd.DataFrame())
    c = c.merge(pop_yr[['fips','pop_yoy_pct']], on='fips', how='left') if not pop_yr.empty else c.assign(pop_yoy_pct=np.nan)
    c = c[c['pop_yoy_pct'].isna()             | (c['pop_yoy_pct']             >= gates['min_pop_yoy_pct'])]
    c = c[c['permits_intensity_ratio'].isna() | (c['permits_intensity_ratio'] <  gates['max_permit_ratio'])]
    c = c[c['unemployment_rate'].isna()       | (c['unemployment_rate']       <= gates['max_unemp_pct'])]
    c = c[c['wage_growth_yoy'].isna()         | (c['wage_growth_yoy']         >= gates['min_wage_growth'])]
    c = c[c['max_supersector_share'].isna()   | (c['max_supersector_share']   <= gates['max_sector_share'])]
    c = c[c['cap_spread_to_gateway_pp'].isna()| (c['cap_spread_to_gateway_pp']>= gates['min_cap_spread_pp'])]
    c = c[c['employment_diversity_hhi'].isna()| (c['employment_diversity_hhi']<= gates['max_hhi_strategy'])]
    if gates['require_no_disq']:
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

# ── TEST 1: Hit rate by MA tier ────────────────────────────────────────────
print('='*110)
print('TEST 1 — HIT RATE BY apps_ma_ratio TIER (using baseline VALUE picks)')
print('='*110)
print('Ratio = current_apps / avg(prior 3 years). Higher = accelerating vs own trend.')
print()

all_picks = []
for yr in range(2015, 2023):
    p = pick_for_year(yr, W_BASE)
    if not p.empty:
        p = p.copy(); p['cohort_year'] = yr
        all_picks.append(p)
all_picks = pd.concat(all_picks, ignore_index=True)

for horizon in (3, 5):
    tr_col = f'total_return_{horizon}yr'
    p = all_picks[all_picks[tr_col].notna() & all_picks['apps_ma_ratio'].notna()].copy()
    if p.empty: continue
    p['universe_mean_tr'] = p['cohort_year'].map(
        lambda y: uni[uni['year']==y].dropna(subset=[tr_col])[tr_col].mean() * 100
    )
    p['tr_pct'] = p[tr_col] * 100
    p['edge'] = p['tr_pct'] - p['universe_mean_tr']
    p['above_avg'] = (p['edge'] > 2).astype(int)
    print(f'\n─── {horizon}yr horizon — hit rate by apps_ma_ratio tier ───')
    by_tier = p.groupby('apps_ma_tier').agg(
        n=('tr_pct','count'),
        hit_rate_pct=('above_avg', lambda s: s.mean()*100),
        avg_edge=('edge','mean'),
        avg_tr=('tr_pct','mean'),
        avg_ratio=('apps_ma_ratio','mean'),
    ).round(2)
    order = ['STRONG_ACCEL','MOD_ACCEL','FLAT','DECEL']
    by_tier = by_tier.reindex([o for o in order if o in by_tier.index])
    print(by_tier.to_string())

# ── TEST 2: Backtest with ma_ratio as a weight ────────────────────────────
def backtest(name, weights, horizon, years):
    tr_col = f'total_return_{horizon}yr'
    rows = []
    for yr in years:
        picks = pick_for_year(yr, weights)
        if picks.empty: continue
        yr_uni = uni[uni['year']==yr].dropna(subset=[tr_col])
        uni_mean = yr_uni[tr_col].mean() * 100 if not yr_uni.empty else np.nan
        obs = picks.dropna(subset=[tr_col]).copy()
        if obs.empty: continue
        obs['tr_pct'] = obs[tr_col] * 100
        obs['edge']   = obs['tr_pct'] - uni_mean
        above = int((obs['edge']>2).sum()); below = int((obs['edge']<-2).sum())
        under = int((obs['tr_pct']<0).sum())
        rows.append({'year':yr,'strategy':name,'n':len(obs),'above':above,'below':below,
                     'hit_rate':above/len(obs)*100,'edge':obs['edge'].mean(),
                     'mean_tr':obs['tr_pct'].mean(),'underwater':under})
    return pd.DataFrame(rows)

def summarize(df, name):
    if df.empty: return {'strategy':name,'n':'0','above':'—','below':'—','edge':'—','tr':'—'}
    total = df['n'].sum()
    return {
        'strategy':name,
        'n_picks':int(total),
        'above_avg':f'{int(df["above"].sum())}/{int(total)} ({df["above"].sum()/total*100:.1f}%)',
        'below_avg':f'{int(df["below"].sum())}/{int(total)}',
        'underwater':f'{int(df["underwater"].sum())}/{int(total)}',
        'mean_edge':f'{(df["edge"]*df["n"]).sum()/total:+.2f}pp',
        'mean_tr':f'{(df["mean_tr"]*df["n"]).sum()/total:+.2f}%',
    }

print('\n' + '='*110)
print('TEST 2 — BACKTEST WITH apps_ma_ratio AS A SCORING WEIGHT')
print('='*110)
for horizon, years in [(3, range(2015,2023)), (5, range(2015,2021))]:
    print(f'\n═══ {horizon}yr horizon ═══\n')
    variants = [
        ('A. BASELINE VALUE',          W_BASE),
        ('B. + ma_ratio 0.5',          W_MA05),
        ('C. + ma_ratio 1.0',          W_MA10),
        ('D. replace apps level w/ma', W_MA_REPLACE),
    ]
    summaries = [summarize(backtest(n, w, horizon, list(years)), n) for n, w in variants]
    print(pd.DataFrame(summaries).to_string(index=False))

# ── TEST 3: 2025 picks with ma_ratio ──────────────────────────────────────
print('\n' + '='*110)
print('TEST 3 — 2025 BASELINE VALUE PICKS WITH THEIR apps_ma_ratio')
print('='*110)
picks_2025 = pick_for_year(2025, W_BASE)
if not picks_2025.empty:
    picks_2025['apps_ma_ratio'] = picks_2025['apps_ma_ratio'].round(2)
    picks_2025['apps_ma_ratio_5yr'] = picks_2025['apps_ma_ratio_5yr'].round(2)
    picks_2025['apps_prior_3yr_avg'] = picks_2025['apps_prior_3yr_avg'].round(1)
    display_cols = ['county_name','state_name','cap_rate_proxy','business_apps_per_1000','apps_prior_3yr_avg','apps_ma_ratio','apps_ma_ratio_5yr','apps_ma_tier']
    df = picks_2025[display_cols].copy()
    df['cap_rate_proxy'] = (df['cap_rate_proxy']*100).round(2)
    df.columns = ['county','state','cap%','apps_2024','apps_3yr_avg','ma_3yr','ma_5yr','tier']
    print()
    print(df.to_string(index=False))
