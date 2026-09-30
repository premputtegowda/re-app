"""Regime-adaptive weights + perfect-hindsight ceiling comparison.

Part 1: Test 3 weight profiles routed by regime detector
  Profile A (DEFENSIVE)     — CYCLE TOP / LATE CYCLE: current VALUE weights
  Profile B (BALANCED)      — MID CYCLE: modest growth tilt
  Profile C (OPPORTUNISTIC) — CONTRACTION / CYCLE BOTTOM: cap spread + growth
  Weights are theoretically-derived, NOT optimized on 2015-2022 data.

Part 2: Compare framework picks vs perfect-hindsight top-10
  Shows the "alpha ceiling" — best possible picks with perfect foresight.
"""
from __future__ import annotations
import duckdb, numpy as np, pandas as pd

WAREHOUSE = '/Users/premputtegowda/reps/reps-tracker/emerging_re/data/warehouse/emerging_re.duckdb'
POP_MIN, POP_MAX = 300_000, 1_000_000
TOP_N, MAX_PER_STATE = 10, 3
GATEWAY_FIPS = ['06037','36061','36047','36081','06075','25025','11001','17031']

# ── THREE WEIGHT PROFILES (theoretically-derived, not optimized) ─────────
# Profile A: DEFENSIVE — current VALUE weights (validated through 2007-2010 crash)
PROFILE_A = {
    'cap_spread_to_gateway_pp':          2.0,
    'cap_rate_proxy':                    1.5,
    'wage_growth_yoy':                   0.8,
    'pop_yoy_pct':                       0.5,
    'business_apps_per_1000':            0.5,
    'permits_per_new_job':              -1.0,
    'recession_resilience_score':        0.5,
    'knowledge_emp_growth_vs_state_pp':  0.5,
    'rent_growth_vs_wage_growth':        0.3,
}
# Profile B: BALANCED — modest tilt toward employment/growth for MID CYCLE
PROFILE_B = {
    'cap_spread_to_gateway_pp':          1.5,
    'cap_rate_proxy':                    1.0,
    'wage_growth_yoy':                   1.0,
    'pop_yoy_pct':                       0.5,
    'business_apps_per_1000':            1.0,
    'permits_per_new_job':              -0.8,
    'recession_resilience_score':        0.3,
    'knowledge_emp_growth_vs_state_pp':  0.5,
    'rent_growth_vs_wage_growth':        0.5,
}
# Profile C: OPPORTUNISTIC — cap spread + growth momentum for CONTRACTION recovery
PROFILE_C = {
    'cap_spread_to_gateway_pp':          2.5,
    'cap_rate_proxy':                    1.0,
    'wage_growth_yoy':                   1.0,
    'pop_yoy_pct':                       1.0,
    'business_apps_per_1000':            1.5,
    'permits_per_new_job':              -0.5,
    'recession_resilience_score':        0.0,
    'knowledge_emp_growth_vs_state_pp':  0.5,
    'rent_growth_vs_wage_growth':        0.5,
}

# ── Historical regime labels (from prior regime detector output) ────────
REGIME_BY_YEAR = {
    2015: 'MID CYCLE',    2016: 'MID CYCLE',
    2017: 'MID CYCLE',    2018: 'MID CYCLE',
    2019: 'MID CYCLE',    2020: 'MID CYCLE',
    2021: 'CYCLE TOP',    2022: 'CYCLE TOP',
    2023: 'MID CYCLE',    2024: 'MID CYCLE',    2025: 'MID CYCLE',
}
def weights_for(year):
    reg = REGIME_BY_YEAR.get(year, 'MID CYCLE')
    if reg in ('CYCLE TOP','LATE CYCLE'):        return PROFILE_A, 'A_DEFENSIVE'
    if reg in ('CONTRACTION','CYCLE BOTTOM'):    return PROFILE_C, 'C_OPPORTUNISTIC'
    return PROFILE_B, 'B_BALANCED'

GATES = {'min_pop_yoy_pct':0.0,'max_permit_ratio':1.5,'max_unemp_pct':6.0,'min_wage_growth':0.02,'max_sector_share':0.25,'min_cap_spread_pp':0.0,'max_hhi_strategy':0.15,'require_no_disq':True}

# ── Load universe (same as prior) ─────────────────────────────────────────
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

def perfect_hindsight_top10(year, horizon):
    '''What the perfect-foresight strategy would have picked: top-10 by realized return within qualified pool.'''
    tr_col = f'total_return_{horizon}yr'
    c = uni[uni['year']==year].dropna(subset=['cap_rate_proxy', tr_col]).copy()
    if c.empty: return pd.DataFrame()
    pop_yr = pop_yoy_cache.get(year, pd.DataFrame())
    c = c.merge(pop_yr[['fips','pop_yoy_pct']], on='fips', how='left') if not pop_yr.empty else c.assign(pop_yoy_pct=np.nan)
    # Apply SAME gates as strategy — this is fair comparison
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
    # Rank by realized total return (perfect hindsight)
    c = c.sort_values(tr_col, ascending=False)
    picked, sc = [], {}
    for _, r in c.iterrows():
        if sc.get(r['state_name'], 0) >= MAX_PER_STATE: continue
        picked.append(r); sc[r['state_name']] = sc.get(r['state_name'], 0) + 1
        if len(picked) >= TOP_N: break
    return pd.DataFrame(picked) if picked else pd.DataFrame()

def backtest(name, pick_func, horizon, years):
    tr_col = f'total_return_{horizon}yr'
    rows = []
    for yr in years:
        picks = pick_func(yr)
        if picks.empty: continue
        yr_uni = uni[uni['year']==yr].dropna(subset=[tr_col])
        if yr_uni.empty: continue
        uni_mean = yr_uni[tr_col].mean() * 100
        obs = picks.dropna(subset=[tr_col]).copy()
        if obs.empty: continue
        obs['tr_pct'] = obs[tr_col] * 100
        obs['edge']   = obs['tr_pct'] - uni_mean
        rows.append({'year':yr, 'n':len(obs),
                     'above':int((obs['edge']>2).sum()),
                     'below':int((obs['edge']<-2).sum()),
                     'under':int((obs['tr_pct']<0).sum()),
                     'edge':obs['edge'].mean(), 'mean_tr':obs['tr_pct'].mean()})
    return pd.DataFrame(rows)

def summarize(df, name):
    if df.empty: return None
    n = df['n'].sum()
    return {'strategy':name, 'n':int(n),
            'above':f'{int(df["above"].sum())}/{int(n)} ({df["above"].sum()/n*100:.1f}%)',
            'below':f'{int(df["below"].sum())}/{int(n)}',
            'under':f'{int(df["under"].sum())}/{int(n)}',
            'edge':f'{(df["edge"]*df["n"]).sum()/n:+.2f}pp',
            'mean_tr':f'{(df["mean_tr"]*df["n"]).sum()/n:+.2f}%'}

# ── PART 1: Static vs Regime-Adaptive ─────────────────────────────────────
print('='*130)
print('PART 1 — STATIC (current) vs REGIME-ADAPTIVE weights')
print('='*130)
for horizon, years in [(3, range(2015,2023)), (5, range(2015,2021))]:
    print(f'\n═══ {horizon}yr horizon ═══\n')
    bt_static = backtest('Static current', lambda y: pick_for_year(y, PROFILE_A), horizon, list(years))
    bt_adaptive = backtest('Regime-adaptive', lambda y: pick_for_year(y, weights_for(y)[0]), horizon, list(years))
    bt_perfect = backtest('Perfect hindsight', lambda y: perfect_hindsight_top10(y, horizon), horizon, list(years))
    df = pd.DataFrame([summarize(bt_static,'A. STATIC (current)'),
                       summarize(bt_adaptive,'B. REGIME-ADAPTIVE'),
                       summarize(bt_perfect,'C. PERFECT HINDSIGHT (ceiling)')])
    print(df.to_string(index=False))

# ── PART 2: How much alpha are we leaving on the table? ──────────────────
print()
print('='*130)
print('PART 2 — ALPHA GAP: framework vs perfect-hindsight ceiling')
print('='*130)
for horizon, years in [(3, range(2015,2023)), (5, range(2015,2021))]:
    print(f'\n═══ {horizon}yr horizon ═══\n')
    bt_adaptive = backtest('adaptive', lambda y: pick_for_year(y, weights_for(y)[0]), horizon, list(years))
    bt_perfect = backtest('perfect', lambda y: perfect_hindsight_top10(y, horizon), horizon, list(years))
    print(f'{"year":<6}{"adaptive_TR":>12}{"perfect_TR":>12}{"gap":>10}{"adaptive_edge":>14}{"perfect_edge":>14}{"gap_edge":>12}')
    print('-'*95)
    for _, r_a in bt_adaptive.iterrows():
        r_p = bt_perfect[bt_perfect['year']==r_a['year']]
        if r_p.empty: continue
        r_p = r_p.iloc[0]
        gap_tr = r_p['mean_tr'] - r_a['mean_tr']
        gap_edge = r_p['edge'] - r_a['edge']
        print(f'{int(r_a["year"]):<6}{r_a["mean_tr"]:>+11.2f}%{r_p["mean_tr"]:>+11.2f}%{gap_tr:>+9.2f}%{r_a["edge"]:>+13.2f}pp{r_p["edge"]:>+13.2f}pp{gap_edge:>+11.2f}pp')

    # Aggregate gap
    total_n_a = bt_adaptive['n'].sum(); total_n_p = bt_perfect['n'].sum()
    if total_n_a and total_n_p:
        a_tr = (bt_adaptive['mean_tr']*bt_adaptive['n']).sum()/total_n_a
        p_tr = (bt_perfect['mean_tr']*bt_perfect['n']).sum()/total_n_p
        a_e = (bt_adaptive['edge']*bt_adaptive['n']).sum()/total_n_a
        p_e = (bt_perfect['edge']*bt_perfect['n']).sum()/total_n_p
        pct_captured = a_e / p_e * 100 if p_e > 0 else 0
        print(f'\nAGGREGATE:')
        print(f'  Adaptive achieves:      +{a_e:.2f}pp edge  ({a_tr:+.2f}% mean TR)')
        print(f'  Perfect achieves:       +{p_e:.2f}pp edge  ({p_tr:+.2f}% mean TR)')
        print(f'  Alpha capture ratio:    {pct_captured:.1f}%   (adaptive edge / perfect edge)')
        print(f'  Alpha left on table:    {p_e - a_e:.2f}pp')

# ── Regime-adaptive picks for 2025 ────────────────────────────────────────
print()
print('='*130)
print('2025 PICKS — REGIME-ADAPTIVE strategy (current regime: MID CYCLE → Profile B)')
print('='*130)
w_2025, p_name = weights_for(2025)
print(f'\nUsing weight profile: {p_name}')
print(f'Weights:')
for k, v in w_2025.items():
    print(f'  {k:<40}  {v:+.2f}')
print()
picks_2025 = pick_for_year(2025, w_2025)
if not picks_2025.empty:
    for i, r in picks_2025.reset_index(drop=True).iterrows():
        name = f"{r['county_name'].replace(' County','')}, {r['state_name']}"
        print(f'  #{i+1} {name:<28}  cap {r["cap_rate_proxy"]*100:>5.2f}%  RRS {r["recession_resilience_score"]:.2f}  opp {r["opportunity_score"]:.2f}')

# Compare 2025 picks static vs adaptive
print()
print('2025 PICKS COMPARISON — Static Profile A vs Adaptive Profile B:')
picks_a = pick_for_year(2025, PROFILE_A)
picks_b = pick_for_year(2025, PROFILE_B)
if not picks_a.empty and not picks_b.empty:
    a_fips = set(picks_a['fips']); b_fips = set(picks_b['fips'])
    same = a_fips & b_fips
    a_only = a_fips - b_fips
    b_only = b_fips - a_fips
    name_lookup = uni.set_index('fips')[['county_name','state_name']].drop_duplicates()
    def _n(f): return f"{name_lookup.loc[f,'county_name'].replace(' County','')}, {name_lookup.loc[f,'state_name']}"
    print(f'  In BOTH ({len(same)}): {sorted([_n(f) for f in same])}')
    if a_only: print(f'  Static Profile A only ({len(a_only)}): {sorted([_n(f) for f in a_only])}')
    if b_only: print(f'  Adaptive Profile B only ({len(b_only)}): {sorted([_n(f) for f in b_only])}')
