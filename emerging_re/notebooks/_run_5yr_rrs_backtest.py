"""5-year-based RRS backtest — RRS uses 5yr windows, VALUE uses 5yr hold.

Changes from prior:
  - Historical crash: 2007→2012 (5yr window — captures full crash trough)
  - Trailing HPI bubble: 5yr annualized (smoother than 3yr)
  - Applied to 5yr VALUE horizon
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

# ── 5yr crash HPI: 2007 → 2012 (captures full trough) ──────────────────────
all_fips = uni['fips'].unique().tolist()
all_fips_str = ",".join(repr(f) for f in all_fips)
hpi_hist = con.execute(f'''
    WITH hpi_pts AS (
        SELECT fips, EXTRACT(YEAR FROM period_end_date)::INT AS year, hpi
        FROM main_staging.stg_fhfa_hpi
        WHERE fips IN ({all_fips_str})
          AND EXTRACT(MONTH FROM period_end_date) = 12
          AND EXTRACT(YEAR FROM period_end_date) IN (2007, 2012)
        QUALIFY row_number() OVER (PARTITION BY fips, EXTRACT(YEAR FROM period_end_date) ORDER BY as_of_date DESC) = 1
    )
    SELECT fips,
           MAX(CASE WHEN year=2007 THEN hpi END) as hpi_2007,
           MAX(CASE WHEN year=2012 THEN hpi END) as hpi_2012
    FROM hpi_pts GROUP BY fips
''').df()
hpi_hist['crash_2007_2012_5yr'] = (hpi_hist['hpi_2012'] / hpi_hist['hpi_2007'] - 1) * 100

# ── Trailing 5yr HPI (annualized) ──────────────────────────────────────────
hpi_all = con.execute(f'''
    SELECT fips, EXTRACT(YEAR FROM period_end_date)::INT AS year, hpi
    FROM main_staging.stg_fhfa_hpi
    WHERE fips IN ({all_fips_str})
      AND EXTRACT(MONTH FROM period_end_date) = 12
    QUALIFY row_number() OVER (PARTITION BY fips, EXTRACT(YEAR FROM period_end_date) ORDER BY as_of_date DESC) = 1
''').df()
con.close()

# For each (fips, year), get HPI at year-5
lag5 = hpi_all.rename(columns={'hpi':'hpi_5yr_prior','year':'year_join'})
lag5['year_join'] = lag5['year_join'] + 5
hpi_all = hpi_all.merge(lag5[['fips','year_join','hpi_5yr_prior']], left_on=['fips','year'], right_on=['fips','year_join'], how='left').drop(columns='year_join')
hpi_all['trailing_5yr_hpi_ann'] = (hpi_all['hpi'] / hpi_all['hpi_5yr_prior']) ** (1/5) - 1

pep_raw['as_of_date'] = pd.to_datetime(pep_raw['as_of_date'])
uni = uni.merge(mortgage, on='year', how='left').merge(gateway_caps, on='year', how='left')
uni['cap_spread_to_gateway_pp'] = (uni['cap_rate_proxy'] - uni['gateway_cap_median']) * 100
uni['permits_per_new_job']      = uni['permits_per_1000'] / (uni['emp_growth_yoy'].clip(lower=0.005) * 450)
uni = uni.merge(hpi_hist[['fips','crash_2007_2012_5yr']], on='fips', how='left')
uni = uni.merge(hpi_all[['fips','year','trailing_5yr_hpi_ann']], on=['fips','year'], how='left')

STATE_OPEX = {
    'Ohio':0.57,'Michigan':0.57,'Pennsylvania':0.57,'Illinois':0.57,'Wisconsin':0.57,
    'New York':0.57,'New Jersey':0.57,'Connecticut':0.57,'Missouri':0.52,'Massachusetts':0.52,
    'Maryland':0.52,'California':0.47,'Iowa':0.47,'Minnesota':0.47,'Florida':0.47,'Indiana':0.47,
    'Texas':0.44,'Virginia':0.44,'Colorado':0.44,'Washington':0.44,'Kansas':0.44,'Kentucky':0.44,
    'Georgia':0.42,'North Carolina':0.42,'South Carolina':0.42,'Tennessee':0.42,'Oklahoma':0.42,
    'Utah':0.42,'Idaho':0.42,'Arizona':0.40,'Nevada':0.40,'Alabama':0.40,'Mississippi':0.40,'Arkansas':0.40,
}
uni['opex_ratio'] = uni['state_name'].map(STATE_OPEX).fillna(0.45)
uni['total_return_5yr'] = 5 * uni['cap_rate_proxy'] * (1-uni['opex_ratio']) * (1 + uni['zori_forward_return_60mo']/2) + uni['hpi_forward_return_60mo']

# ── RRS scoring functions — 5yr calibrated ────────────────────────────────
def s_hist5(v):
    '''2007→2012 5yr crash HPI (deeper than 2007-2010 because catches full trough)'''
    if pd.isna(v): return 5
    if v >= 0: return 10          # appreciated during full 5yr crash — exceptional
    if v >= -10: return 8         # mild damage over 5yr
    if v >= -20: return 6         # moderate
    if v >= -35: return 4         # severe
    if v >= -50: return 2         # very severe
    return 0                       # catastrophic
def s_hhi(v):
    if pd.isna(v): return 5
    if v < 0.06: return 10
    if v < 0.08: return 8
    if v < 0.10: return 6
    if v < 0.12: return 4
    if v < 0.15: return 2
    return 0
def s_bubble5(v):
    '''Trailing 5yr HPI annualized — smoother than 3yr'''
    if pd.isna(v): return 5
    v_pct = v * 100
    if v_pct < 3: return 10
    if v_pct < 5: return 8
    if v_pct < 8: return 6
    if v_pct < 12: return 4
    if v_pct < 18: return 2
    return 0
def s_cap(v):
    if pd.isna(v): return 5
    v_pct = v * 100
    if v_pct >= 8.0: return 10
    if v_pct >= 7.0: return 8
    if v_pct >= 6.5: return 6
    if v_pct >= 6.0: return 4
    if v_pct >= 5.5: return 2
    return 0

uni['s_H5']  = uni['crash_2007_2012_5yr'].apply(s_hist5)
uni['s_D']   = uni['employment_diversity_hhi'].apply(s_hhi)
uni['s_B5']  = uni['trailing_5yr_hpi_ann'].apply(s_bubble5)
uni['s_Y']   = uni['cap_rate_proxy'].apply(s_cap)
uni['s_S']   = 5   # sticky employment placeholder
uni['rrs_5yr'] = (0.30*uni['s_H5'] + 0.20*uni['s_D'] + 0.20*uni['s_B5'] + 0.20*uni['s_Y'] + 0.10*uni['s_S'])

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

W_VALUE = {
    'cap_spread_to_gateway_pp':2.0,'cap_rate_proxy':1.5,'wage_growth_yoy':0.8,
    'pop_yoy_pct':0.5,'business_apps_per_1000':0.5,'permits_per_new_job':-1.0,
}
GATES = {
    'min_pop_yoy_pct':0.0,'max_permit_ratio':1.5,'max_unemp_pct':6.0,
    'min_wage_growth':0.02,'max_sector_share':0.25,'min_cap_spread_pp':0.0,
    'max_hhi_strategy':0.15,'require_no_disq':True,
}

def pick_for_year(year, weights):
    c = uni[uni['year']==year].dropna(subset=['cap_rate_proxy']).copy()
    if c.empty: return pd.DataFrame()
    pop_yr = pop_yoy_cache.get(year, pd.DataFrame())
    c = c.merge(pop_yr[['fips','pop_yoy_pct']], on='fips', how='left') if not pop_yr.empty else c.assign(pop_yoy_pct=np.nan)
    c = c[c['pop_yoy_pct'].isna()             | (c['pop_yoy_pct']             >= GATES['min_pop_yoy_pct'])]
    c = c[c['permits_intensity_ratio'].isna() | (c['permits_intensity_ratio'] <  GATES['max_permit_ratio'])]
    c = c[c['unemployment_rate'].isna()       | (c['unemployment_rate']       <= GATES['max_unemp_pct'])]
    c = c[c['wage_growth_yoy'].isna()         | (c['wage_growth_yoy']         >= GATES['min_wage_growth'])]
    c = c[c['max_supersector_share'].isna()   | (c['max_supersector_share']   <= GATES['max_sector_share'])]
    c = c[c['cap_spread_to_gateway_pp'].isna()| (c['cap_spread_to_gateway_pp']>= GATES['min_cap_spread_pp'])]
    c = c[c['employment_diversity_hhi'].isna()| (c['employment_diversity_hhi']<= GATES['max_hhi_strategy'])]
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

def backtest_5yr(weights, years):
    tr_col = 'total_return_5yr'
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
        above = int((obs['edge']>2).sum())
        below = int((obs['edge']<-2).sum())
        under = int((obs['tr_pct']<0).sum())
        rows.append({'year':yr,'n':len(obs),'above':above,'below':below,
                     'hit_rate':above/len(obs)*100,'edge':obs['edge'].mean(),
                     'mean_tr':obs['tr_pct'].mean(),'underwater':under})
    return pd.DataFrame(rows)

def summarize(df):
    if df.empty: return None
    n = df['n'].sum()
    return {
        'n_picks': int(n),
        'above': int(df['above'].sum()),
        'below': int(df['below'].sum()),
        'underwater': int(df['underwater'].sum()),
        'hit_rate': df['above'].sum() / n * 100,
        'edge': (df['edge']*df['n']).sum() / n,
        'mean_tr': (df['mean_tr']*df['n']).sum() / n,
    }

# ── Backtest — 5yr horizon with 5yr-based RRS ──────────────────────────────
print('='*120)
print('5-YEAR HORIZON — VALUE + RRS (5yr-calibrated) as scoring criterion')
print('='*120)
print('\nRRS 5yr changes: crash 2007-2012 (5yr trough) + trailing 5yr HPI annualized')
print()

variants = [
    ('A. BASELINE VALUE (5yr)',       W_VALUE),
    ('B. + RRS 5yr, weight 0.5',      {**W_VALUE, 'rrs_5yr':0.5}),
    ('C. + RRS 5yr, weight 1.0',      {**W_VALUE, 'rrs_5yr':1.0}),
    ('D. + RRS 5yr, weight 1.5',      {**W_VALUE, 'rrs_5yr':1.5}),
    ('E. + RRS 5yr, weight 2.0',      {**W_VALUE, 'rrs_5yr':2.0}),
]
print(f'{"variant":<32}{"n":>4}{"above":>7}{"below":>7}{"under":>7}{"hit%":>8}{"edge":>10}{"mean TR":>10}')
print('-'*95)
for name, w in variants:
    bt = backtest_5yr(w, range(2015, 2021))
    s = summarize(bt)
    if s:
        print(f'{name:<32}{s["n_picks"]:>4}{s["above"]:>7}{s["below"]:>7}{s["underwater"]:>7}{s["hit_rate"]:>7.1f}%{s["edge"]:>+9.2f}pp{s["mean_tr"]:>+9.2f}%')

# ── 2025 picks at each weight ──────────────────────────────────────────────
print('\n' + '='*120)
print('2025 PICKS at each RRS weight')
print('='*120)
for name, w in variants:
    picks = pick_for_year(2025, w)
    print(f'\n── {name} ──')
    if picks.empty: continue
    for i, r in picks.iterrows():
        n = f"{r['county_name'].replace(' County','')}, {r['state_name']}"
        crash = r['crash_2007_2012_5yr']
        crash_s = f'{crash:+.1f}%' if pd.notna(crash) else 'n/a'
        trail = r['trailing_5yr_hpi_ann']
        trail_s = f'{trail*100:+.1f}%/yr' if pd.notna(trail) else 'n/a'
        print(f'  #{i+1} {n:<28}  cap {r["cap_rate_proxy"]*100:>5.2f}%  RRS_5yr {r["rrs_5yr"]:.2f}   07-12 HPI: {crash_s:<8}  trail 5yr: {trail_s}')
