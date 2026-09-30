"""Walk-forward backtest comparing EMERGING vs EMERGING-STRESS vs EMERGING-VALUE.

Purpose: verify the proposed EMERGING-VALUE weight structure before wiring it
into the strategy notebooks. Reports per-year hit rate (ABOVE AVG %), edge vs
universe mean, absolute-loss counts, and cohort-level pass rates.

EMERGING-VALUE spec (per design discussion):
  Gates:
    pop_yoy_pct        >= 0.0    (loosened from EMERGING's 0.3)
    employment_diversity_hhi <= 0.15 (NEW hard gate)
    max_permit_ratio   <  1.5
    max_unemp_pct      <= 6.0
    min_wage_growth    >= 0.02
    max_sector_share   <= 0.25
    min_cap_spread_pp  >= 0.0
  Weights:
    pop_yoy_pct              0.5   (down from 1.0)
    wage_growth_yoy          0.8   (down from 1.0)
    business_apps_per_1000   0.5   (down from 0.7)
    cap_rate_proxy           1.5   (up from 0.5)
    cap_spread_to_gateway_pp 2.0   (NEW — the crown)
    permits_per_new_job     -1.0   (NEW — inverted, penalizes supply waves)
"""
from __future__ import annotations
import duckdb, numpy as np, pandas as pd

WAREHOUSE     = '/Users/premputtegowda/reps/reps-tracker/emerging_re/data/warehouse/emerging_re.duckdb'
POP_MIN       = 300_000
POP_MAX       = 1_000_000
HHI_MAX_UNI   = 0.10   # universe-level cap (matches EMERGING notebook default)
HHI_MAX_VALUE = 0.15   # EMERGING-VALUE gate (looser than universe — reconsider below)
TOP_N         = 10
MAX_PER_STATE = 3
LTV           = 0.70
GATEWAY_FIPS  = ['06037','36061','36047','36081','06075','25025','11001','17031']

# ── Load universe ───────────────────────────────────────────────────────────
con = duckdb.connect(WAREHOUSE, read_only=True)
# NOTE: the standard EMERGING notebook filters universe at HHI <= 0.10.
# We loosen to 0.20 here so the diversity gate (0.15) actually has room to
# discriminate — otherwise everything left in the universe already passes.
uni = con.execute(f'''
    SELECT fips, county_name, state_name, pop_latest,
           EXTRACT(YEAR FROM period_end_date)::INT AS year,
           cap_rate_proxy, zori_yoy, unemployment_rate,
           hpi_yoy, permits_intensity_ratio, permits_per_1000,
           any_disqualifier,
           wage_growth_yoy, emp_growth_yoy,
           business_apps_per_1000,
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
    FROM main_staging.stg_fred_macro
    WHERE series_id = 'MORTGAGE30US'
    QUALIFY row_number() OVER (
        PARTITION BY EXTRACT(YEAR FROM observation_date)
        ORDER BY observation_date DESC) = 1
''').df()

pep_raw = con.execute('''
    SELECT fips, EXTRACT(YEAR FROM period_end_date)::INT AS ref_year,
           popestimate, as_of_date
    FROM main_staging.stg_census_pep
''').df()

gateway_caps = con.execute(f'''
    SELECT EXTRACT(YEAR FROM period_end_date)::INT AS year,
           MEDIAN(cap_rate_proxy) AS gateway_cap_median
    FROM main_marts.mart_county_features
    WHERE EXTRACT(MONTH FROM period_end_date) = 12
      AND fips IN ({",".join(repr(f) for f in GATEWAY_FIPS)})
    GROUP BY year ORDER BY year
''').df()
con.close()

pep_raw['as_of_date'] = pd.to_datetime(pep_raw['as_of_date'])
uni = uni.merge(mortgage, on='year', how='left')
uni = uni.merge(gateway_caps, on='year', how='left')
uni['cap_spread_to_gateway_pp'] = (uni['cap_rate_proxy'] - uni['gateway_cap_median']) * 100

# ── Derived: permits per new job ────────────────────────────────────────────
# Rough approximation: emp ≈ 45% of pop → new_jobs_per_1000_pop = emp_growth_yoy * 450
# Building permits per new job = permits_per_1000 / (emp_growth_yoy * 450)
# High value = building faster than hiring = supply-wave risk
# Clip emp_growth_yoy at 0.005 (0.5%/yr) to prevent divide-by-tiny explosions
uni['permits_per_new_job'] = uni['permits_per_1000'] / (uni['emp_growth_yoy'].clip(lower=0.005) * 450)

# Opex (simplified — flat 0.45 default; state overrides not material for the rank comparison)
STATE_OPEX = {
    'Ohio':0.57,'Michigan':0.57,'Pennsylvania':0.57,'Illinois':0.57,'Wisconsin':0.57,
    'New York':0.57,'New Jersey':0.57,'Connecticut':0.57,
    'Missouri':0.52,'Massachusetts':0.52,'Maryland':0.52,'Rhode Island':0.52,
    'California':0.47,'Iowa':0.47,'Minnesota':0.47,'Florida':0.47,'Indiana':0.47,
    'Texas':0.44,'Virginia':0.44,'Colorado':0.44,'Oregon':0.44,'Washington':0.44,
    'Kansas':0.44,'Nebraska':0.44,'Louisiana':0.44,'Kentucky':0.44,
    'Georgia':0.42,'North Carolina':0.42,'South Carolina':0.42,'Tennessee':0.42,
    'Oklahoma':0.42,'Utah':0.42,'Idaho':0.42,
    'Arizona':0.40,'Nevada':0.40,'Alabama':0.40,'Mississippi':0.40,'Arkansas':0.40,
}
uni['opex_ratio'] = uni['state_name'].map(STATE_OPEX).fillna(0.45)

# ── Return metrics ──────────────────────────────────────────────────────────
HORIZON = 5
uni['cash_flow_5yr']    = HORIZON * uni['cap_rate_proxy'] * (1 - uni['opex_ratio']) * (1 + uni['zori_forward_return_60mo']/2)
uni['appreciation_5yr'] = uni['hpi_forward_return_60mo']
uni['total_return_5yr'] = uni['cash_flow_5yr'] + uni['appreciation_5yr']

# ── PIT pop_yoy ─────────────────────────────────────────────────────────────
def pit_pop_yoy(cohort_year):
    cutoff = pd.Timestamp(f'{cohort_year}-12-31')
    df = pep_raw[pep_raw['as_of_date'] <= cutoff].copy()
    if df.empty: return pd.DataFrame(columns=['fips','pop_yoy_pct'])
    df = df.sort_values(['fips','ref_year','as_of_date']).drop_duplicates(subset=['fips','ref_year'], keep='last')
    rows=[]
    for f, sub in df.groupby('fips'):
        sub = sub.sort_values('ref_year', ascending=False)
        if len(sub) < 2: continue
        latest = sub.iloc[0]
        prev = sub[sub['ref_year'] == latest['ref_year']-1]
        if prev.empty: continue
        prev = prev.iloc[0]
        rows.append({'fips':f,'pop_yoy_pct':(latest['popestimate']-prev['popestimate'])/prev['popestimate']*100})
    return pd.DataFrame(rows)

pop_yoy_cache = {yr: pit_pop_yoy(yr) for yr in range(2015, 2026)}

# ── Strategy: EMERGING (baseline) ───────────────────────────────────────────
EMERGING_GATES = {
    'min_pop_yoy_pct':0.3, 'max_permit_ratio':1.5, 'max_unemp_pct':6.0,
    'min_wage_growth':0.02, 'max_sector_share':0.25, 'min_cap_spread_pp':0.0,
    'require_no_disq':True,
}
EMERGING_WEIGHTS = {'pop_yoy_pct':1.0,'wage_growth_yoy':1.0,'business_apps_per_1000':0.7,'cap_rate_proxy':0.5}

# ── Strategy: EMERGING-VALUE (proposed) ─────────────────────────────────────
VALUE_GATES = {
    'min_pop_yoy_pct':0.0,       # loosened
    'max_hhi':HHI_MAX_VALUE,     # NEW hard gate
    'max_permit_ratio':1.5, 'max_unemp_pct':6.0, 'min_wage_growth':0.02,
    'max_sector_share':0.25, 'min_cap_spread_pp':0.0,
    'require_no_disq':True,
}
VALUE_WEIGHTS = {
    'pop_yoy_pct':               0.5,
    'wage_growth_yoy':           0.8,
    'business_apps_per_1000':    0.5,
    'cap_rate_proxy':            1.5,
    'cap_spread_to_gateway_pp':  2.0,
    'permits_per_new_job':      -1.0,  # inverted (negative weight)
}

def _score_pool(c: pd.DataFrame, weights: dict) -> pd.Series:
    s = pd.Series(0.0, index=c.index)
    for col, w in weights.items():
        if col in c.columns and c[col].notna().any():
            mu, sig = c[col].mean(), c[col].std()
            if sig > 0:
                z = (c[col] - mu) / sig
                s = s + w * z.fillna(0)
    return s

def pick_emerging(year, weights=EMERGING_WEIGHTS, gates=EMERGING_GATES):
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
    if gates.get('require_no_disq'):
        c = c[(c['any_disqualifier']==False) | (c['any_disqualifier'].isna())]
    if 'max_hhi' in gates:
        c = c[c['employment_diversity_hhi'].isna() | (c['employment_diversity_hhi'] <= gates['max_hhi'])]
    if c.empty: return pd.DataFrame()
    cap_median = c['cap_rate_proxy'].median()
    c = c[c['cap_rate_proxy'] >= cap_median]
    if c.empty: return pd.DataFrame()

    c['opportunity_score'] = _score_pool(c, weights)
    c = c.sort_values('opportunity_score', ascending=False)

    picked, sc = [], {}
    for _, r in c.iterrows():
        if sc.get(r['state_name'], 0) >= MAX_PER_STATE: continue
        picked.append(r); sc[r['state_name']] = sc.get(r['state_name'], 0) + 1
        if len(picked) >= TOP_N: break
    return pd.DataFrame(picked) if picked else pd.DataFrame()

def pick_value(year):
    return pick_emerging(year, weights=VALUE_WEIGHTS, gates=VALUE_GATES)

# Sensitivity variant: VALUE weights + strict pop gate (0.3 like EMERGING)
VALUE_GATES_STRICT_POP = {**VALUE_GATES, 'min_pop_yoy_pct': 0.3}
def pick_value_strict_pop(year):
    return pick_emerging(year, weights=VALUE_WEIGHTS, gates=VALUE_GATES_STRICT_POP)

# ── Backtest runner ─────────────────────────────────────────────────────────
def backtest(name, pick_fn, years):
    rows = []
    for yr in years:
        picks = pick_fn(yr)
        if picks is None or picks.empty:
            rows.append({'year':yr,'strategy':name,'n_picks':0,'hit_rate':np.nan,
                        'above':0,'avg':0,'below':0,'edge_pp':np.nan,
                        'underwater':0,'mean_tr':np.nan,'universe_mean':np.nan})
            continue
        yr_uni = uni[uni['year']==yr].dropna(subset=['total_return_5yr'])
        uni_mean = yr_uni['total_return_5yr'].mean() * 100 if not yr_uni.empty else float('nan')
        obs = picks.dropna(subset=['total_return_5yr']).copy()
        if obs.empty:
            rows.append({'year':yr,'strategy':name,'n_picks':len(picks),'hit_rate':np.nan,
                        'above':0,'avg':0,'below':0,'edge_pp':np.nan,
                        'underwater':0,'mean_tr':np.nan,'universe_mean':uni_mean})
            continue
        obs['tr_pct'] = obs['total_return_5yr'] * 100
        obs['edge']   = obs['tr_pct'] - uni_mean
        above = int((obs['edge'] >  2).sum())
        below = int((obs['edge'] < -2).sum())
        avg_c = int(((obs['edge'] >= -2) & (obs['edge'] <= 2)).sum())
        under = int((obs['tr_pct'] < 0).sum())
        rows.append({
            'year':yr,'strategy':name,'n_picks':len(obs),
            'hit_rate':above/len(obs)*100,
            'above':above,'avg':avg_c,'below':below,
            'edge_pp':obs['edge'].mean(),
            'underwater':under,
            'mean_tr':obs['tr_pct'].mean(),
            'universe_mean':uni_mean,
        })
    return pd.DataFrame(rows)

YEARS = list(range(2015, 2021))  # 2020 is last cohort with observable 5yr forward (through 2025)

print('='*100)
print('EMERGING-VALUE BACKTEST — 5-YEAR HOLD — comparing to baseline EMERGING')
print('='*100)
print(f'\nUniverse: {len(uni)} county-years across {uni.year.nunique()} years, pop {POP_MIN:,}-{POP_MAX:,}')
print(f'Universe filter: employment_diversity_hhi <= 0.20 (loosened from 0.10 so diversity gate can discriminate)')
print(f'Cohorts backtested: {YEARS[0]}-{YEARS[-1]} ({len(YEARS)} years, 5yr forwards observable through 2025)\n')

# Run baseline
print('Running EMERGING (baseline)...')
bt_em = backtest('EMERGING', lambda y: pick_emerging(y), YEARS)
print('Running EMERGING-VALUE (proposed)...')
bt_va = backtest('EMERGING-VALUE', pick_value, YEARS)
print('Running EMERGING-VALUE (strict pop gate 0.3)...')
bt_vs = backtest('VALUE pop>=0.3', pick_value_strict_pop, YEARS)

# ── Per-year comparison ─────────────────────────────────────────────────────
print('\n' + '='*100)
print('PER-YEAR RESULTS')
print('='*100)
print(f'\n{"year":<6} {"strategy":<16} {"n":>3}  {"above":>5} {"avg":>4} {"below":>5}  {"hit%":>6}  {"edge":>7}  {"mean_TR":>8}  {"underwater":>10}  {"uni_mean":>8}')
print('-'*110)
for yr in YEARS:
    r_e = bt_em[bt_em.year==yr].iloc[0]
    r_v = bt_va[bt_va.year==yr].iloc[0]
    r_s = bt_vs[bt_vs.year==yr].iloc[0]
    for r in (r_e, r_v, r_s):
        hit = f'{r.hit_rate:5.1f}%' if pd.notna(r.hit_rate) else '   n/a'
        edge = f'{r.edge_pp:+6.2f}pp' if pd.notna(r.edge_pp) else '     n/a'
        mtr = f'{r.mean_tr:+7.2f}%' if pd.notna(r.mean_tr) else '     n/a'
        umn = f'{r.universe_mean:+6.2f}%' if pd.notna(r.universe_mean) else '   n/a'
        print(f'{int(r.year):<6} {r.strategy:<16} {int(r.n_picks):>3}  {int(r.above):>5} {int(r.avg):>4} {int(r.below):>5}  {hit:>6}  {edge:>7}  {mtr:>8}  {int(r.underwater):>10}  {umn:>8}')

# ── Aggregate ───────────────────────────────────────────────────────────────
def _agg(df, name):
    obs = df.dropna(subset=['hit_rate'])
    n_total  = obs['n_picks'].sum()
    n_above  = obs['above'].sum()
    n_below  = obs['below'].sum()
    n_avg    = obs['avg'].sum()
    n_under  = obs['underwater'].sum()
    hit_rate = n_above / n_total * 100 if n_total else np.nan
    avg_edge = (obs['edge_pp'] * obs['n_picks']).sum() / n_total if n_total else np.nan
    avg_tr   = (obs['mean_tr'] * obs['n_picks']).sum() / n_total if n_total else np.nan
    return {
        'strategy':name,
        'total_picks':int(n_total),
        'above_avg':f'{int(n_above)}/{int(n_total)} ({hit_rate:.1f}%)',
        'below_avg':f'{int(n_below)}/{int(n_total)} ({n_below/n_total*100:.1f}%)' if n_total else 'n/a',
        'underwater':f'{int(n_under)}/{int(n_total)} ({n_under/n_total*100:.1f}%)' if n_total else 'n/a',
        'mean_edge_pp':f'{avg_edge:+.2f}',
        'mean_tr_pct':f'{avg_tr:+.2f}',
    }

print('\n' + '='*100)
print('AGGREGATE SUMMARY (2015-2022 cohorts, 3yr forward returns)')
print('='*100)
summary = pd.DataFrame([_agg(bt_em,'EMERGING'), _agg(bt_va,'EMERGING-VALUE'), _agg(bt_vs,'VALUE pop>=0.3')])
print('\n' + summary.to_string(index=False))

# ── Focus years 2019 & 2022 ─────────────────────────────────────────────────
print('\n' + '='*100)
print('FOCUS YEARS: 2019 (peak Sunbelt), 2021 (COVID surge), 2022 (post-COVID)')
print('='*100)
def _print_picks(name, picks):
    print(f'\n── {name} ──')
    if picks is None or picks.empty:
        print('  (no picks)')
        return
    for _, r in picks.iterrows():
        tr = r['total_return_5yr']*100 if pd.notna(r['total_return_5yr']) else float('nan')
        pop = r.get('pop_yoy_pct')
        pop_s = f'{pop:>+5.2f}%' if pd.notna(pop) else '  n/a '
        print(f"  {r['county_name']:<30} {r['state_name']:<20}  cap {r['cap_rate_proxy']*100:>4.2f}%  pop_yoy {pop_s}  TR {tr:>+6.2f}%")

for target_yr in (2019, 2021, 2022):
    print(f'\n{"="*20} {target_yr} {"="*20}')
    _print_picks(f'{target_yr} EMERGING',           pick_emerging(target_yr))
    _print_picks(f'{target_yr} EMERGING-VALUE',     pick_value(target_yr))
    _print_picks(f'{target_yr} VALUE pop>=0.3',     pick_value_strict_pop(target_yr))

print('\nDONE.')
