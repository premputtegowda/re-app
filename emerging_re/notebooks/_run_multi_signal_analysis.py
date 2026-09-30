"""Multi-signal analysis: identify uncorrelated leading indicators and backtest.

Methodology:
  1. Compute correlation matrix across ~20 candidate signals in the VALUE pool
  2. Cluster by |r| > 0.6, keep representative from each cluster
  3. Univariate test each kept signal (solo +0.5 weight addition)
  4. Rank by improvement over baseline
  5. Combine survivors into final multi-signal model, test at both horizons
"""
from __future__ import annotations
import duckdb, numpy as np, pandas as pd

WAREHOUSE = '/Users/premputtegowda/reps/reps-tracker/emerging_re/data/warehouse/emerging_re.duckdb'
POP_MIN, POP_MAX = 300_000, 1_000_000
TOP_N, MAX_PER_STATE = 10, 3
GATEWAY_FIPS = ['06037','36061','36047','36081','06075','25025','11001','17031']

# Full candidate signal list — everything leading in the mart
CANDIDATE_SIGNALS = [
    # Currently used in baseline (for reference — will show correlation with candidates)
    'cap_spread_to_gateway_pp', 'cap_rate_proxy', 'wage_growth_yoy',
    'pop_yoy_pct', 'business_apps_per_1000', 'permits_per_new_job',
    # Demand-side
    'renter_ind_emp_yoy', 'renter_ind_emp_cagr_3yr', 'renter_ind_emp_growth_vs_state_pp',
    'age_20_34_share_yoy_chg', 'domesticmig_per_1000', 'domesticmig_accel_3yr',
    'irs_inflow_rate', 'irs_income_gap', 'foreign_born_share',
    # Employment quality
    'knowledge_emp_yoy', 'pcpi_yoy', 'pcpi_cagr_3yr', 'unemployment_rate_yoy_chg',
    # Supply-side
    'mf_permit_ratio', 'mf_permit_ratio_change_3yr',
    # Rent/price dynamics
    'hpi_rent_gap_pp', 'rent_growth_vs_wage_growth', 'mf_cap_rate_change_3yr',
    # Vacancy
    'rental_vacancy_change_3yr',
]

con = duckdb.connect(WAREHOUSE, read_only=True)
# Load ALL candidate signals (broad SELECT)
sig_cols = ",\n           ".join([f'"{c}"' for c in CANDIDATE_SIGNALS if c not in
    ('cap_spread_to_gateway_pp','permits_per_new_job','pop_yoy_pct')])  # these are derived
uni = con.execute(f'''
    SELECT fips, county_name, state_name, pop_latest,
           EXTRACT(YEAR FROM period_end_date)::INT AS year,
           unemployment_rate, hpi_yoy, permits_intensity_ratio, permits_per_1000,
           any_disqualifier, emp_growth_yoy, zori_yoy,
           max_supersector_share, employment_diversity_hhi,
           zori_forward_return_36mo, hpi_forward_return_36mo,
           zori_forward_return_60mo, hpi_forward_return_60mo,
           {sig_cols}
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
GATES = {
    'min_pop_yoy_pct':0.0,'max_permit_ratio':1.5,'max_unemp_pct':6.0,
    'min_wage_growth':0.02,'max_sector_share':0.25,'min_cap_spread_pp':0.0,
    'max_hhi_strategy':0.15,'require_no_disq':True,
}

def apply_gates(year):
    c = uni[uni['year']==year].dropna(subset=['cap_rate_proxy']).copy()
    if c.empty: return c
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
    if c.empty: return c
    c = c[c['cap_rate_proxy'] >= c['cap_rate_proxy'].median()]
    return c

# ── STEP 1: Correlation matrix within qualified pool ─────────────────────────
qualified_all_years = []
for yr in range(2015, 2023):
    c = apply_gates(yr)
    if not c.empty: qualified_all_years.append(c)
qualified = pd.concat(qualified_all_years, ignore_index=True) if qualified_all_years else pd.DataFrame()

available_signals = [s for s in CANDIDATE_SIGNALS if s in qualified.columns]
missing = [s for s in CANDIDATE_SIGNALS if s not in qualified.columns]
if missing:
    print(f'MISSING FROM MART: {missing}')

corr_data = qualified[available_signals].copy()
corr_matrix = corr_data.corr()

print('='*110)
print(f'STEP 1 — CORRELATION MATRIX ({len(qualified)} qualified picks, {len(available_signals)} signals)')
print('='*110)
print()
print('Signals sorted by mean absolute correlation with others (higher = more redundant):')
mean_abs_corr = corr_matrix.abs().mean().sort_values(ascending=False)
print(mean_abs_corr.round(3).to_string())

# ── STEP 2: Identify uncorrelated cluster reps ──────────────────────────────
print('\n' + '='*110)
print('STEP 2 — HIGH-CORRELATION PAIRS (|r| > 0.6)')
print('='*110)
pairs = []
for i, a in enumerate(available_signals):
    for b in available_signals[i+1:]:
        r = corr_matrix.loc[a, b]
        if pd.notna(r) and abs(r) > 0.6:
            pairs.append((a, b, r))
pairs.sort(key=lambda x: -abs(x[2]))
if pairs:
    for a, b, r in pairs:
        print(f'  |r|={abs(r):.2f}  ({r:+.2f})   {a}   <->   {b}')
else:
    print('  (none — all pairs uncorrelated at threshold)')

# ── STEP 3: Univariate hit-rate tests ────────────────────────────────────────
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
    c = apply_gates(year)
    if c.empty: return pd.DataFrame()
    c = apply_score(c, weights)
    return state_cap(c)

def backtest_metric(weights, horizon, years):
    tr_col = f'total_return_{horizon}yr'
    total_n = 0; total_above = 0; total_below = 0; total_edge_weighted = 0.0
    for yr in years:
        picks = pick_year(yr, weights)
        if picks.empty: continue
        yr_uni = uni[uni['year']==yr].dropna(subset=[tr_col])
        uni_mean = yr_uni[tr_col].mean() * 100 if not yr_uni.empty else np.nan
        obs = picks.dropna(subset=[tr_col]).copy()
        if obs.empty: continue
        obs['tr_pct'] = obs[tr_col] * 100
        obs['edge']   = obs['tr_pct'] - uni_mean
        total_n += len(obs)
        total_above += int((obs['edge']>2).sum())
        total_below += int((obs['edge']<-2).sum())
        total_edge_weighted += obs['edge'].sum()
    if total_n == 0: return {'n':0,'hit':0,'edge':0}
    return {'n':total_n, 'hit':total_above/total_n*100, 'edge':total_edge_weighted/total_n}

# Only test candidates NOT already in W_BASE
new_signals = [s for s in available_signals if s not in W_BASE]
baseline_3yr = backtest_metric(W_BASE, 3, range(2015,2023))
baseline_5yr = backtest_metric(W_BASE, 5, range(2015,2021))

print('\n' + '='*110)
print('STEP 3 — UNIVARIATE TEST: add each signal solo at weight +0.5')
print('='*110)
print(f'Baseline: 3yr hit {baseline_3yr["hit"]:.1f}% edge {baseline_3yr["edge"]:+.2f}pp   |   5yr hit {baseline_5yr["hit"]:.1f}% edge {baseline_5yr["edge"]:+.2f}pp')
print()

univariate_results = []
for signal in new_signals:
    w = {**W_BASE, signal: 0.5}
    r3 = backtest_metric(w, 3, range(2015,2023))
    r5 = backtest_metric(w, 5, range(2015,2021))
    hit_delta_3 = r3['hit'] - baseline_3yr['hit']
    edge_delta_3 = r3['edge'] - baseline_3yr['edge']
    hit_delta_5 = r5['hit'] - baseline_5yr['hit']
    edge_delta_5 = r5['edge'] - baseline_5yr['edge']
    # Combined score for ranking — average of delta hit + delta edge across horizons
    score = (hit_delta_3 + hit_delta_5 + edge_delta_3 + edge_delta_5) / 4
    univariate_results.append({
        'signal': signal,
        '3yr_hit_Δ': f'{hit_delta_3:+.1f}pp',
        '3yr_edge_Δ': f'{edge_delta_3:+.2f}pp',
        '5yr_hit_Δ': f'{hit_delta_5:+.1f}pp',
        '5yr_edge_Δ': f'{edge_delta_5:+.2f}pp',
        'score': round(score, 2),
    })
uni_df = pd.DataFrame(univariate_results).sort_values('score', ascending=False)
print(uni_df.to_string(index=False))

# ── STEP 4: Filter — keep signals with positive score + uncorrelated ─────────
print('\n' + '='*110)
print('STEP 4 — SIGNAL SELECTION (positive score + uncorrelated cluster reps)')
print('='*110)

# Get all signals with positive score
scored = [(row['signal'], row['score']) for _, row in uni_df.iterrows() if row['score'] > 0]
print(f'\nSignals with POSITIVE score: {len(scored)}')
for s, sc in scored:
    print(f'  {sc:+.2f}   {s}')

# Greedy selection: iterate signals by score, keep if uncorrelated with kept set
selected = []
CORR_THRESHOLD = 0.6
for signal, score in scored:
    is_uncorrelated = all(abs(corr_matrix.loc[signal, kept]) < CORR_THRESHOLD for kept in selected
                           if signal in corr_matrix.index and kept in corr_matrix.columns
                           and pd.notna(corr_matrix.loc[signal, kept]))
    # Also uncorrelated with W_BASE signals
    is_uncorrelated_with_base = all(
        (b not in corr_matrix.columns) or
        (pd.isna(corr_matrix.loc[signal, b])) or
        (abs(corr_matrix.loc[signal, b]) < CORR_THRESHOLD)
        for b in W_BASE if signal != b
    )
    if is_uncorrelated and is_uncorrelated_with_base:
        selected.append(signal)

print(f'\nSelected (positive score AND |r| < {CORR_THRESHOLD} with all others): {len(selected)}')
for s in selected:
    print(f'  {s}')

# ── STEP 5: Combined multi-signal backtest ───────────────────────────────────
print('\n' + '='*110)
print('STEP 5 — MULTI-SIGNAL BACKTEST (combining survivors)')
print('='*110)

# Weight each survivor at 0.5 (uniform for simplicity — could optimize later)
W_MULTI = {**W_BASE, **{s: 0.5 for s in selected}}
print(f'\nFinal weights ({len(W_MULTI)} signals):')
for k, v in W_MULTI.items():
    marker = ' (NEW)' if k not in W_BASE else ''
    print(f'  {v:+.2f}   {k}{marker}')

for horizon, years in [(3, range(2015,2023)), (5, range(2015,2021))]:
    base = backtest_metric(W_BASE, horizon, list(years))
    multi = backtest_metric(W_MULTI, horizon, list(years))
    print(f'\n{horizon}yr horizon:')
    print(f'  Baseline:  n={base["n"]}  hit={base["hit"]:.1f}%  edge={base["edge"]:+.2f}pp')
    print(f'  Multi:     n={multi["n"]}  hit={multi["hit"]:.1f}%  edge={multi["edge"]:+.2f}pp')
    print(f'  Delta:                hit={multi["hit"]-base["hit"]:+.1f}pp  edge={multi["edge"]-base["edge"]:+.2f}pp')

# ── STEP 6: Apply to 2025 picks — show what changes ─────────────────────────
print('\n' + '='*110)
print('STEP 6 — 2025 PICKS: baseline vs multi-signal')
print('='*110)
base_2025 = pick_year(2025, W_BASE)
multi_2025 = pick_year(2025, W_MULTI)
if not base_2025.empty:
    print('\nBASELINE picks:')
    for i, r in base_2025.iterrows():
        name = f"{r['county_name'].replace(' County','')}, {r['state_name']}"
        print(f'  {name}')
if not multi_2025.empty:
    print('\nMULTI-SIGNAL picks:')
    for i, r in multi_2025.iterrows():
        name = f"{r['county_name'].replace(' County','')}, {r['state_name']}"
        print(f'  {name}')
    # Which changed?
    base_set = set(base_2025['fips'].tolist())
    multi_set = set(multi_2025['fips'].tolist())
    removed = base_set - multi_set
    added   = multi_set - base_set
    if removed or added:
        print(f'\n  Removed: {[dict(zip(base_2025.fips, base_2025.county_name+", "+base_2025.state_name))[f] for f in removed]}')
        print(f'  Added:   {[dict(zip(multi_2025.fips, multi_2025.county_name+", "+multi_2025.state_name))[f] for f in added]}')
