"""3-way comparison: EMERGING-VALUE at different universe sizes.

Same strategy (gates + weights identical). Only the universe pop range changes.

  SMALL:  100K-300K  (SMALL notebook — genuinely off-radar)
  MID:    300K-500K  (NEW — the "lower half" of main universe)
  MAIN:   300K-1M    (main VALUE notebook)
  UPPER:  500K-1M    (NEW — the "upper half" of main universe)

Backtest at both 3yr and 5yr horizons. Reports hit rate, edge, underwater.

Note: SMALL uses the SMALL variant's tighter gates (min_cap 6.5%, min bldgs 500,
min business apps 10, pop_yoy >= 0.3, HHI <= 0.12). MID/MAIN/UPPER use the standard
VALUE gates (pop_yoy >= 0.0, HHI <= 0.15, cap floor = pool median).
"""
from __future__ import annotations
import duckdb, numpy as np, pandas as pd

WAREHOUSE = '/Users/premputtegowda/reps/reps-tracker/emerging_re/data/warehouse/emerging_re.duckdb'
LTV = 0.70
GATEWAY_FIPS = ['06037','36061','36047','36081','06075','25025','11001','17031']

# Load full universe 100K-1M (superset)
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
      AND pop_latest > 100000 AND pop_latest <= 1000000
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
mf_units_raw = con.execute('''
    SELECT fips, EXTRACT(YEAR FROM period_end_date)::INT AS ref_year,
           units_in_5_to_9_bldgs AS u5, units_in_10_to_19_bldgs AS u10, as_of_date
    FROM main_staging.stg_census_acs_1yr
''').df()
con.close()

pep_raw['as_of_date']      = pd.to_datetime(pep_raw['as_of_date'])
mf_units_raw['as_of_date'] = pd.to_datetime(mf_units_raw['as_of_date'])
uni = uni.merge(mortgage, on='year', how='left').merge(gateway_caps, on='year', how='left')
uni['cap_spread_to_gateway_pp'] = (uni['cap_rate_proxy'] - uni['gateway_cap_median']) * 100
uni['permits_per_new_job']      = uni['permits_per_1000'] / (uni['emp_growth_yoy'].clip(lower=0.005) * 450)

# PIT MF bldgs
def pit_mf(cohort_year):
    cutoff = pd.Timestamp(f'{cohort_year}-12-31')
    df = mf_units_raw[mf_units_raw['as_of_date'] <= cutoff].copy()
    if df.empty: return pd.DataFrame(columns=['fips','mf_bldgs_5to19'])
    df = df.sort_values(['fips','ref_year','as_of_date'], ascending=[True, False, False]).drop_duplicates(subset=['fips'], keep='first')
    df['mf_bldgs_5to19'] = ((df['u5']/7.0) + (df['u10']/14.5)).round().astype('Int64')
    return df[['fips','mf_bldgs_5to19']]
mf_by_year = []
for yr in sorted(uni['year'].unique()):
    d = pit_mf(yr).copy(); d['year'] = yr
    mf_by_year.append(d)
uni = uni.merge(pd.concat(mf_by_year, ignore_index=True), on=['fips','year'], how='left')

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

# ── Strategy (same as main VALUE) ───────────────────────────────────────────
WEIGHTS = {
    'cap_spread_to_gateway_pp':2.0,'cap_rate_proxy':1.5,'wage_growth_yoy':0.8,
    'pop_yoy_pct':0.5,'business_apps_per_1000':0.5,'permits_per_new_job':-1.0,
}
STD_GATES = {
    'min_pop_yoy_pct':0.0,'max_permit_ratio':1.5,'max_unemp_pct':6.0,
    'min_wage_growth':0.02,'max_sector_share':0.25,'min_cap_spread_pp':0.0,
    'max_hhi_strategy':0.15,'require_no_disq':True,
    'min_cap_floor':None,'min_business_apps':None,'min_mf_bldgs':None,
}
SMALL_GATES = {**STD_GATES,
    'min_pop_yoy_pct':0.3,'max_hhi_strategy':0.12,
    'min_cap_floor':0.065,'min_business_apps':10.0,'min_mf_bldgs':500,
}

def pick_for_year(year, pop_min, pop_max, gates, top_n, max_per_state, horizon):
    c = uni[(uni['year']==year) & (uni['pop_latest']>pop_min) & (uni['pop_latest']<=pop_max)].dropna(subset=['cap_rate_proxy']).copy()
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
    if gates.get('min_business_apps') is not None:
        c = c[c['business_apps_per_1000'].isna() | (c['business_apps_per_1000'] >= gates['min_business_apps'])]
    if gates['require_no_disq']:
        c = c[(c['any_disqualifier']==False) | (c['any_disqualifier'].isna())]
    if gates.get('min_cap_floor') is not None:
        c = c[c['cap_rate_proxy'] >= gates['min_cap_floor']]
    else:
        # Pool-median cap floor (main VALUE default)
        if len(c) > 0:
            c = c[c['cap_rate_proxy'] >= c['cap_rate_proxy'].median()]
    if gates.get('min_mf_bldgs') is not None:
        c = c[c['mf_bldgs_5to19'].notna() & (c['mf_bldgs_5to19'] >= gates['min_mf_bldgs'])]
    if c.empty: return pd.DataFrame()

    c['opportunity_score'] = 0.0
    for col, w in WEIGHTS.items():
        if col in c.columns and c[col].notna().any():
            mu, sig = c[col].mean(), c[col].std()
            if sig > 0:
                z = (c[col] - mu) / sig
                c['opportunity_score'] = c['opportunity_score'] + w * z.fillna(0)
    c = c.sort_values('opportunity_score', ascending=False)

    picked, sc = [], {}
    for _, r in c.iterrows():
        if sc.get(r['state_name'], 0) >= max_per_state: continue
        picked.append(r); sc[r['state_name']] = sc.get(r['state_name'], 0) + 1
        if len(picked) >= top_n: break
    return pd.DataFrame(picked) if picked else pd.DataFrame()

def backtest(name, pop_min, pop_max, gates, top_n, max_per_state, horizon, years):
    tr_col = f'total_return_{horizon}yr'
    rows = []
    for yr in years:
        picks = pick_for_year(yr, pop_min, pop_max, gates, top_n, max_per_state, horizon)
        if picks.empty: continue
        # Universe mean for THAT pop range
        yr_uni = uni[(uni['year']==yr) & (uni['pop_latest']>pop_min) & (uni['pop_latest']<=pop_max)].dropna(subset=[tr_col])
        uni_mean = yr_uni[tr_col].mean() * 100 if not yr_uni.empty else np.nan
        obs = picks.dropna(subset=[tr_col]).copy()
        if obs.empty: continue
        obs['tr_pct'] = obs[tr_col] * 100
        obs['edge'] = obs['tr_pct'] - uni_mean
        above = int((obs['edge']>2).sum())
        below = int((obs['edge']<-2).sum())
        under = int((obs['tr_pct']<0).sum())
        rows.append({'year':yr,'strategy':name,'n':len(obs),'above':above,'below':below,
                     'hit_rate':above/len(obs)*100,'edge':obs['edge'].mean(),
                     'mean_tr':obs['tr_pct'].mean(),'underwater':under})
    return pd.DataFrame(rows)

def summarize(df, name):
    if df.empty: return {'strategy':name,'n':'0','above':'—','below':'—','under':'—','edge':'—','tr':'—'}
    total = df['n'].sum()
    n_ab = df['above'].sum(); n_bl = df['below'].sum(); n_un = df['underwater'].sum()
    return {
        'strategy': name,
        'n_picks': int(total),
        'above_avg': f'{int(n_ab)}/{int(total)} ({n_ab/total*100:.1f}%)',
        'below_avg': f'{int(n_bl)}/{int(total)}',
        'underwater': f'{int(n_un)}/{int(total)}',
        'mean_edge': f'{(df["edge"]*df["n"]).sum()/total:+.2f}pp',
        'mean_tr':   f'{(df["mean_tr"]*df["n"]).sum()/total:+.2f}%',
    }

# ── Run ─────────────────────────────────────────────────────────────────────
variants = [
    ('SMALL   100K-300K', 100_000, 300_000, SMALL_GATES, 20, 4),
    ('MID     300K-500K', 300_000, 500_000, STD_GATES,   10, 3),
    ('MAIN    300K-1M',   300_000, 1_000_000, STD_GATES, 10, 3),
    ('UPPER   500K-1M',   500_000, 1_000_000, STD_GATES, 10, 3),
]

print('='*110)
print('VALUE STRATEGY — UNIVERSE POP RANGE COMPARISON')
print('='*110)
print('Same weights, same gates (except SMALL uses tighter thresholds appropriate for smaller markets).')
print()

for horizon, years in [(3, range(2015,2023)), (5, range(2015,2021))]:
    print(f'\n═══ {horizon}yr HORIZON (cohorts {min(years)}-{max(years)}) ═══\n')
    summaries = []
    for name, pmin, pmax, gates, tn, mps in variants:
        bt = backtest(name, pmin, pmax, gates, tn, mps, horizon, list(years))
        summaries.append(summarize(bt, name))
    print(pd.DataFrame(summaries).to_string(index=False))

# ── 2025 picks per variant ──────────────────────────────────────────────────
print('\n' + '='*110)
print('2025 PICKS PER UNIVERSE VARIANT (top 5 shown)')
print('='*110)
for name, pmin, pmax, gates, tn, mps in variants:
    picks = pick_for_year(2025, pmin, pmax, gates, tn, mps, 3)
    print(f'\n── {name} ── ({len(picks)} picks)')
    if picks.empty:
        print('   (no picks — over-constrained)')
        continue
    for i in range(min(5, len(picks))):
        r = picks.iloc[i]
        pop_k = int(r['pop_latest']/1000)
        cap = r['cap_rate_proxy']*100
        spread = r['cap_spread_to_gateway_pp']
        apps = r['business_apps_per_1000']
        bldgs = int(r['mf_bldgs_5to19']) if pd.notna(r.get('mf_bldgs_5to19')) else 0
        name_str = f"{r['county_name'].replace(' County','')}, {r['state_name']}"
        print(f'   #{i+1} {name_str:<32}  pop {pop_k}K  cap {cap:>5.2f}%  spread +{spread:>4.2f}pp  apps {apps:>5.1f}  bldgs {bldgs:>5,}')
