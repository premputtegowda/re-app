"""Feature importance analysis for VALUE strategy signals.

Three analyses:
  1. Rank correlation of each signal with realized 3yr forward return
  2. Leave-one-out backtest — how much does each signal contribute?
  3. Time stability — has the signal degraded (compare early vs recent cohorts)?
  4. Pairwise correlation matrix — which signals are redundant?
"""
from __future__ import annotations
import duckdb, numpy as np, pandas as pd

WAREHOUSE = '/Users/premputtegowda/reps/reps-tracker/emerging_re/data/warehouse/emerging_re.duckdb'
POP_MIN, POP_MAX = 300_000, 1_000_000
TOP_N, MAX_PER_STATE = 10, 3
GATEWAY_FIPS = ['06037','36061','36047','36081','06075','25025','11001','17031']

VALUE_SIGNALS = ['cap_spread_to_gateway_pp','cap_rate_proxy','wage_growth_yoy','pop_yoy_pct',
                 'business_apps_per_1000','permits_per_new_job','recession_resilience_score',
                 'knowledge_emp_growth_vs_state_pp','rent_growth_vs_wage_growth']

W_VALUE = {'cap_spread_to_gateway_pp':2.0,'cap_rate_proxy':1.5,'wage_growth_yoy':0.8,'pop_yoy_pct':0.5,'business_apps_per_1000':0.5,'permits_per_new_job':-1.0,'recession_resilience_score':0.5,'knowledge_emp_growth_vs_state_pp':0.5,'rent_growth_vs_wage_growth':0.3}
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

# ── Build the QUALIFIED POOL across all cohort years (after gates) ────────
qualified_all = []
for year in range(2015, 2023):
    c = uni[uni['year']==year].dropna(subset=['cap_rate_proxy']).copy()
    if c.empty: continue
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
    if c.empty: continue
    c = c[c['cap_rate_proxy'] >= c['cap_rate_proxy'].median()]
    qualified_all.append(c)
pool = pd.concat(qualified_all, ignore_index=True).dropna(subset=['total_return_3yr']).copy()
pool['tr_pct'] = pool['total_return_3yr'] * 100
# Add year universe mean
year_uni_mean = uni.dropna(subset=['total_return_3yr']).groupby('year')['total_return_3yr'].mean() * 100
pool['universe_mean_tr'] = pool['year'].map(year_uni_mean)
pool['edge'] = pool['tr_pct'] - pool['universe_mean_tr']

# ── ANALYSIS 1: Rank correlation with realized edge ────────────────────────
print('='*130)
print('ANALYSIS 1 — SIGNAL RANK CORRELATION WITH REALIZED EDGE (across all qualified picks 2015-2022)')
print('='*130)
print(f'\nPool size: {len(pool)} qualified county-years across 2015-2022 cohorts\n')
print(f'{"signal":<40}{"rank_corr":>12}{"weight_now":>12}{"aligned?":>12}')
print('-'*80)
corrs = []
for sig in VALUE_SIGNALS:
    if sig not in pool.columns: continue
    subset = pool[[sig,'edge']].dropna()
    if len(subset) < 100: continue
    r = subset[sig].rank().corr(subset['edge'].rank())
    weight = W_VALUE.get(sig, 0)
    aligned = 'OK' if (r > 0 and weight > 0) or (r < 0 and weight < 0) else 'MISMATCH'
    corrs.append((sig, r, weight, aligned))
    print(f'{sig:<40}{r:>+11.3f} {weight:>+11.2f} {aligned:>12}')

# ── ANALYSIS 2: Leave-one-out backtest ─────────────────────────────────────
print()
print('='*130)
print('ANALYSIS 2 — LEAVE-ONE-OUT BACKTEST (remove each signal, measure hit rate + edge delta)')
print('='*130)

def apply_score(c, weights):
    c = c.copy()
    c['opportunity_score'] = 0.0
    for col, w in weights.items():
        if col in c.columns and c[col].notna().any():
            mu, sig = c[col].mean(), c[col].std()
            if sig > 0:
                z = (c[col] - mu) / sig
                c['opportunity_score'] = c['opportunity_score'] + w * z.fillna(0)
    return c.sort_values('opportunity_score', ascending=False)

def state_cap(c):
    picked, sc = [], {}
    for _, r in c.iterrows():
        if sc.get(r['state_name'], 0) >= MAX_PER_STATE: continue
        picked.append(r); sc[r['state_name']] = sc.get(r['state_name'], 0) + 1
        if len(picked) >= TOP_N: break
    return pd.DataFrame(picked) if picked else pd.DataFrame()

def pick_year(year, weights):
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
    c = apply_score(c, weights)
    return state_cap(c)

def backtest(weights, horizon, years):
    tr_col = f'total_return_{horizon}yr'
    tot_n=tot_above=tot_below=0; tot_edge=0.0
    for yr in years:
        picks = pick_year(yr, weights)
        if picks.empty: continue
        yr_uni = uni[uni['year']==yr].dropna(subset=[tr_col])
        if yr_uni.empty: continue
        uni_mean = yr_uni[tr_col].mean() * 100
        obs = picks.dropna(subset=[tr_col]).copy()
        if obs.empty: continue
        obs['tr_pct'] = obs[tr_col]*100; obs['edge'] = obs['tr_pct'] - uni_mean
        tot_n += len(obs)
        tot_above += int((obs['edge']>2).sum())
        tot_below += int((obs['edge']<-2).sum())
        tot_edge += obs['edge'].sum()
    return {'n':tot_n,'hit':tot_above/tot_n*100 if tot_n else 0,'edge':tot_edge/tot_n if tot_n else 0}

base_3 = backtest(W_VALUE, 3, range(2015,2023))
base_5 = backtest(W_VALUE, 5, range(2015,2021))
print(f'\nBaseline VALUE:  3yr {base_3["hit"]:.1f}% hit / {base_3["edge"]:+.2f}pp edge   |   5yr {base_5["hit"]:.1f}% hit / {base_5["edge"]:+.2f}pp edge')
print()
print(f'{"signal removed":<40}{"3yr hit Δ":>12}{"3yr edge Δ":>12}{"5yr hit Δ":>12}{"5yr edge Δ":>12}{"total impact":>15}')
print('-'*105)
impact = []
for sig in VALUE_SIGNALS:
    if sig not in uni.columns: continue
    w = {k:v for k,v in W_VALUE.items() if k != sig}
    r3 = backtest(w, 3, range(2015,2023))
    r5 = backtest(w, 5, range(2015,2021))
    hd3 = r3['hit'] - base_3['hit']; ed3 = r3['edge'] - base_3['edge']
    hd5 = r5['hit'] - base_5['hit']; ed5 = r5['edge'] - base_5['edge']
    # Impact score = sum of absolute deltas (higher = signal matters more)
    total_impact = abs(hd3) + abs(hd5) + abs(ed3)*2 + abs(ed5)*2   # edge weighted 2x
    # Negative sign means removing the signal HURTS (i.e., signal is valuable)
    signed_impact = -(hd3 + hd5 + ed3 + ed5)
    impact.append((sig, hd3, ed3, hd5, ed5, signed_impact))
    print(f'{sig:<40}{hd3:>+11.1f}pp{ed3:>+11.2f}pp{hd5:>+11.1f}pp{ed5:>+11.2f}pp{signed_impact:>+14.2f}')
print()
print('  Interpretation: NEGATIVE deltas = removing signal HURT performance (signal is VALUABLE)')
print('                  POSITIVE deltas = removing signal HELPED (signal is REDUNDANT or NOISY)')

# ── ANALYSIS 3: Time stability ─────────────────────────────────────────────
print()
print('='*130)
print('ANALYSIS 3 — TIME STABILITY (has each signal degraded over time?)')
print('='*130)
early = pool[pool['year'].between(2015, 2018)]
recent = pool[pool['year'].between(2019, 2022)]
print(f'\nEarly period (2015-2018): {len(early)} picks   |   Recent period (2019-2022): {len(recent)} picks\n')
print(f'{"signal":<40}{"early corr":>12}{"recent corr":>12}{"stability":>15}')
print('-'*80)
for sig in VALUE_SIGNALS:
    if sig not in pool.columns: continue
    if len(early[[sig,'edge']].dropna()) < 50 or len(recent[[sig,'edge']].dropna()) < 50: continue
    e_corr = early[sig].rank().corr(early['edge'].rank())
    r_corr = recent[sig].rank().corr(recent['edge'].rank())
    delta = r_corr - e_corr
    stab = 'stable' if abs(delta) < 0.05 else ('improved' if delta > 0 else 'DEGRADING')
    print(f'{sig:<40}{e_corr:>+11.3f} {r_corr:>+11.3f} {stab:>15}')

# ── ANALYSIS 4: Pairwise correlations (redundancy check) ──────────────────
print()
print('='*130)
print('ANALYSIS 4 — PAIRWISE CORRELATIONS (identify redundant signals |r| > 0.5)')
print('='*130)
corr_matrix = pool[VALUE_SIGNALS].corr()
pairs = []
for i, s1 in enumerate(VALUE_SIGNALS):
    for s2 in VALUE_SIGNALS[i+1:]:
        r = corr_matrix.loc[s1, s2]
        if pd.notna(r) and abs(r) > 0.5:
            pairs.append((s1, s2, r))
if pairs:
    pairs.sort(key=lambda x: -abs(x[2]))
    print()
    for a, b, r in pairs:
        print(f'  |r|={abs(r):.2f}  ({r:+.2f})   {a}  <->  {b}')
else:
    print('\n  (No pairs above |r| > 0.5 — signals are largely uncorrelated)')

print()
print('='*130)
print('SUMMARY — RANKED SIGNALS BY EMPIRICAL VALUE')
print('='*130)
impact_sorted = sorted(impact, key=lambda x: x[5], reverse=True)
print(f'\n{"rank":<5}{"signal":<40}{"weight_now":>12}{"impact":>10}{"verdict"}')
print('-'*90)
for i, (sig, _, _, _, _, imp) in enumerate(impact_sorted):
    weight = W_VALUE.get(sig, 0)
    if imp > 1.0: verdict = 'HIGH VALUE — keep, maybe increase weight'
    elif imp > 0.3: verdict = 'MODERATE VALUE — keep'
    elif imp > 0: verdict = 'MARGINAL — keep but small weight'
    elif imp > -0.5: verdict = 'NEGLIGIBLE — consider dropping'
    else: verdict = 'HURTING — drop or invert weight'
    print(f'{i+1:<5}{sig:<40}{weight:>+11.2f}{imp:>+9.2f}   {verdict}')
