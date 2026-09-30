"""Print EMERGING-VALUE per-year picks with per-pick performance and verdict.

Mirrors the notebook's Section 6 (PICKS_HISTORY_CELL) logic in plain-text form.
Verdict rules (from _generate_strategy_notebooks.py:1611-1616):
  edge > +2pp  → ABOVE AVERAGE
  edge < -2pp  → BELOW AVERAGE
  otherwise    → AVERAGE
Underwater flag: total_return_3yr < 0 (independent of verdict).
"""
from __future__ import annotations
import duckdb, numpy as np, pandas as pd

WAREHOUSE     = '/Users/premputtegowda/reps/reps-tracker/emerging_re/data/warehouse/emerging_re.duckdb'
POP_MIN, POP_MAX = 300_000, 1_000_000
HHI_MAX_UNI   = 0.20    # EMERGING-VALUE universe (broadened so 0.15 gate discriminates)
HHI_MAX_STRAT = 0.15    # strategy-level HHI gate
TOP_N         = 10
MAX_PER_STATE = 3
LTV           = 0.70
GATEWAY_FIPS  = ['06037','36061','36047','36081','06075','25025','11001','17031']

# ── Load ────────────────────────────────────────────────────────────────────
con = duckdb.connect(WAREHOUSE, read_only=True)
uni = con.execute(f'''
    SELECT fips, county_name, state_name, pop_latest,
           EXTRACT(YEAR FROM period_end_date)::INT AS year,
           cap_rate_proxy, zori_yoy, unemployment_rate,
           hpi_yoy, permits_intensity_ratio, permits_per_1000,
           any_disqualifier,
           wage_growth_yoy, emp_growth_yoy,
           business_apps_per_1000,
           max_supersector_share, employment_diversity_hhi,
           zori_forward_return_36mo, hpi_forward_return_36mo
    FROM main_marts.mart_county_features
    WHERE EXTRACT(MONTH FROM period_end_date) = 12
      AND pop_latest > {POP_MIN} AND pop_latest <= {POP_MAX}
      AND employment_diversity_hhi IS NOT NULL
      AND employment_diversity_hhi <= {HHI_MAX_UNI}
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
uni['permits_per_new_job'] = uni['permits_per_1000'] / (uni['emp_growth_yoy'].clip(lower=0.005) * 450)

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
uni['cash_flow_3yr']    = 3 * uni['cap_rate_proxy'] * (1 - uni['opex_ratio']) * (1 + uni['zori_forward_return_36mo']/2)
uni['appreciation_3yr'] = uni['hpi_forward_return_36mo']
uni['total_return_3yr'] = uni['cash_flow_3yr'] + uni['appreciation_3yr']
uni['debt_service_3yr'] = 3 * LTV * uni['mortgage_rate']
uni['levered_ROE_3yr']  = (uni['cash_flow_3yr'] - uni['debt_service_3yr'] + uni['appreciation_3yr']) / (1 - LTV)

def pit_pop_yoy(cohort_year):
    cutoff = pd.Timestamp(f'{cohort_year}-12-31')
    df = pep_raw[pep_raw['as_of_date'] <= cutoff].copy()
    if df.empty: return pd.DataFrame(columns=['fips','pop_yoy_pct'])
    df = df.sort_values(['fips','ref_year','as_of_date']).drop_duplicates(subset=['fips','ref_year'], keep='last')
    rows=[]
    for f, sub in df.groupby('fips'):
        sub = sub.sort_values('ref_year', ascending=False)
        if len(sub) < 2: continue
        latest, prev = sub.iloc[0], sub[sub['ref_year']==sub.iloc[0]['ref_year']-1]
        if prev.empty: continue
        prev = prev.iloc[0]
        rows.append({'fips':f,'pop_yoy_pct':(latest['popestimate']-prev['popestimate'])/prev['popestimate']*100})
    return pd.DataFrame(rows)
pop_yoy_cache = {yr: pit_pop_yoy(yr) for yr in range(2015, 2026)}

VALUE_GATES = {
    'min_pop_yoy_pct':0.0,'max_permit_ratio':1.5,'max_unemp_pct':6.0,
    'min_wage_growth':0.02,'max_sector_share':0.25,'min_cap_spread_pp':0.0,
    'max_hhi_strategy':HHI_MAX_STRAT,'require_no_disq':True,
}
VALUE_WEIGHTS = {
    'cap_spread_to_gateway_pp':2.0,'cap_rate_proxy':1.5,'wage_growth_yoy':0.8,
    'pop_yoy_pct':0.5,'business_apps_per_1000':0.5,'permits_per_new_job':-1.0,
}

def pick_for_year(year, weights=VALUE_WEIGHTS, gates=VALUE_GATES):
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
    if gates.get('require_no_disq'):
        c = c[(c['any_disqualifier']==False) | (c['any_disqualifier'].isna())]
    if c.empty: return pd.DataFrame()
    cap_median = c['cap_rate_proxy'].median()
    c = c[c['cap_rate_proxy'] >= cap_median]
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

# ── Assemble picks_df with verdict + underwater ─────────────────────────────
def _verdict(edge):
    if edge is None or pd.isna(edge): return 'n/a — not observable'
    if edge > 2:  return 'ABOVE AVERAGE'
    if edge < -2: return 'BELOW AVERAGE'
    return 'AVERAGE'

rows = []
for yr in range(2015, 2026):
    picks = pick_for_year(yr)
    if picks.empty: continue
    yr_uni = uni[uni['year']==yr].dropna(subset=['total_return_3yr'])
    uni_mean_tr = yr_uni['total_return_3yr'].mean() * 100 if not yr_uni.empty else np.nan
    uni_n       = len(yr_uni)
    for i, r in picks.iterrows():
        tr  = r['total_return_3yr'] * 100 if pd.notna(r['total_return_3yr']) else None
        roe = r['levered_ROE_3yr']  * 100 if pd.notna(r['levered_ROE_3yr'])  else None
        cap = r['cap_rate_proxy']   * 100
        edge = (tr - uni_mean_tr) if (tr is not None and pd.notna(uni_mean_tr)) else None
        rows.append({
            'year':  yr,
            'rank':  len([x for x in rows if x['year']==yr]) + 1,
            'market': f"{r['county_name'].replace(' County','')}, {r['state_name']}",
            'entry_cap%': cap,
            'total_return_3yr%': tr,
            'universe_mean_TR%': uni_mean_tr if pd.notna(uni_mean_tr) else None,
            'edge_pp': edge,
            'levered_ROE_3yr%': roe,
            'verdict': _verdict(edge),
            'underwater': (tr is not None and tr < 0),
        })
picks_df = pd.DataFrame(rows)

# ── Print per-year ───────────────────────────────────────────────────────────
print('=' * 130)
print('EMERGING-VALUE — Per-year picks with performance, verdict, and underwater flag')
print('=' * 130)
print()
print('Verdict rules: ABOVE AVERAGE = edge > +2pp | BELOW AVERAGE = edge < -2pp | AVERAGE = within ±2pp')
print('Underwater = pick lost money in absolute terms (total_return_3yr < 0), independent of verdict.')
print()

for yr in sorted(picks_df['year'].unique()):
    g = picks_df[picks_df['year']==yr].copy()
    umn = g['universe_mean_TR%'].iloc[0]
    obs = pd.notna(umn)
    print('─' * 130)
    if obs:
        print(f'YEAR {yr}   universe mean TR (3yr) = {umn:+.2f}%   |   picks are observable')
    else:
        print(f'YEAR {yr}   (36mo forward not yet observable — ex-ante picks only)')
    print('─' * 130)
    print(f'{"rank":<5}{"market":<32}{"cap":>8}{"TR 3yr":>10}{"edge":>10}{"lev ROE":>10}  {"verdict":<16}  {"⚠":<3}')
    for _, r in g.iterrows():
        cap = f"{r['entry_cap%']:>6.2f}%"
        tr  = f"{r['total_return_3yr%']:>+8.2f}%" if pd.notna(r['total_return_3yr%']) else '     n/a'
        ed  = f"{r['edge_pp']:>+7.2f}pp" if pd.notna(r['edge_pp']) else '     n/a'
        roe = f"{r['levered_ROE_3yr%']:>+8.2f}%" if pd.notna(r['levered_ROE_3yr%']) else '     n/a'
        uw  = '💧' if r['underwater'] else ' '
        print(f"{int(r['rank']):<5}{r['market']:<32}{cap:>8}{tr:>10}{ed:>10}{roe:>10}  {r['verdict']:<16}  {uw}")

# ── Aggregate summary ────────────────────────────────────────────────────────
obs = picks_df[picks_df['verdict'].isin(['ABOVE AVERAGE','AVERAGE','BELOW AVERAGE'])]
n_above = int((obs['verdict']=='ABOVE AVERAGE').sum())
n_avg   = int((obs['verdict']=='AVERAGE').sum())
n_below = int((obs['verdict']=='BELOW AVERAGE').sum())
n_und   = int(obs['underwater'].sum())
n_total = len(obs)

print()
print('=' * 130)
print('AGGREGATE — 2015-2022 observable cohorts (excludes 2023-2025 which have no 3yr forward yet)')
print('=' * 130)
print()
print(f'  Total scored picks:  {n_total}')
print(f'  ABOVE AVERAGE:       {n_above:>3}/{n_total}  ({n_above/n_total*100:.1f}%)')
print(f'  AVERAGE:             {n_avg:>3}/{n_total}  ({n_avg/n_total*100:.1f}%)')
print(f'  BELOW AVERAGE:       {n_below:>3}/{n_total}  ({n_below/n_total*100:.1f}%)')
print(f'  Underwater (TR < 0): {n_und:>3}/{n_total}  ({n_und/n_total*100:.1f}%)')
print()
print(f'  Mean edge vs universe: {obs["edge_pp"].mean():+.2f}pp')
print(f'  Mean total return:     {obs["total_return_3yr%"].mean():+.2f}%')
print(f'  Mean levered ROE:      {obs["levered_ROE_3yr%"].mean():+.2f}%')
print(f'  Best pick TR:          {obs["total_return_3yr%"].max():+.2f}%')
print(f'  Worst pick TR:         {obs["total_return_3yr%"].min():+.2f}%')
