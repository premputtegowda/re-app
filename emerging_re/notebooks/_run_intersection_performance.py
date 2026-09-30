"""Intersection performance: markets picked by BOTH VALUE and LEADING strategies.

For each year, isolate picks that appear in BOTH pick lists.
Report performance of these intersection picks vs full VALUE, full LEADING,
and vs VALUE-only / LEADING-only picks.

The hypothesis: multi-signal-confirmed picks (in both lists) should be
higher-conviction and outperform single-strategy picks.
"""
from __future__ import annotations
import duckdb, numpy as np, pandas as pd

WAREHOUSE = '/Users/premputtegowda/reps/reps-tracker/emerging_re/data/warehouse/emerging_re.duckdb'
POP_MIN, POP_MAX = 300_000, 1_000_000
TOP_N, MAX_PER_STATE = 10, 3
LTV = 0.70
GATEWAY_FIPS = ['06037','36061','36047','36081','06075','25025','11001','17031']

con = duckdb.connect(WAREHOUSE, read_only=True)
uni = con.execute(f'''
    SELECT fips, county_name, state_name, pop_latest,
           EXTRACT(YEAR FROM period_end_date)::INT AS year,
           cap_rate_proxy, zori_yoy, unemployment_rate, hpi_yoy,
           permits_intensity_ratio, permits_per_1000, any_disqualifier,
           wage_growth_yoy, emp_growth_yoy, business_apps_per_1000,
           max_supersector_share, employment_diversity_hhi,
           renter_ind_emp_yoy, mf_permit_ratio_change_3yr,
           unemployment_rate_yoy_chg, domesticmig_per_1000,
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
    uni[f'debt_service_{h}yr'] = h * LTV * uni['mortgage_rate']
    uni[f'levered_ROE_{h}yr']  = (uni[f'cash_flow_{h}yr'] - uni[f'debt_service_{h}yr'] + uni[hc]) / (1 - LTV)

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
W_LEADING = {
    'domesticmig_per_1000':0.5,'renter_ind_emp_yoy':0.5,'business_apps_per_1000':0.5,
    'mf_permit_ratio_change_3yr':0.5,'unemployment_rate_yoy_chg':-0.5,'wage_growth_yoy':0.5,
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

def evaluate_bucket(picks_by_year, horizon):
    tr_col = f'total_return_{horizon}yr'
    roe_col = f'levered_ROE_{horizon}yr'
    per_year_stats = []
    for year, picks in picks_by_year.items():
        if picks.empty or tr_col not in picks.columns: continue
        yr_uni = uni[uni['year']==year].dropna(subset=[tr_col])
        if yr_uni.empty: continue
        uni_mean = yr_uni[tr_col].mean() * 100
        obs = picks.dropna(subset=[tr_col]).copy()
        if obs.empty: continue
        obs['tr_pct'] = obs[tr_col] * 100
        obs['edge']   = obs['tr_pct'] - uni_mean
        per_year_stats.append({
            'year': year,
            'n': len(obs),
            'above': int((obs['edge'] > 2).sum()),
            'avg': int((abs(obs['edge']) <= 2).sum()),
            'below': int((obs['edge'] < -2).sum()),
            'underwater': int((obs['tr_pct'] < 0).sum()),
            'mean_tr': obs['tr_pct'].mean(),
            'mean_roe': (obs[roe_col] * 100).mean() if roe_col in obs.columns else None,
            'edge': obs['edge'].mean(),
            'uni_mean': uni_mean,
        })
    return per_year_stats

def totals(per_year_stats):
    if not per_year_stats: return None
    n = sum(x['n'] for x in per_year_stats)
    if n == 0: return None
    return {
        'n': n,
        'above': sum(x['above'] for x in per_year_stats),
        'avg': sum(x['avg'] for x in per_year_stats),
        'below': sum(x['below'] for x in per_year_stats),
        'underwater': sum(x['underwater'] for x in per_year_stats),
        'hit_rate': sum(x['above'] for x in per_year_stats) / n * 100,
        'edge': sum(x['edge']*x['n'] for x in per_year_stats) / n,
        'mean_tr': sum(x['mean_tr']*x['n'] for x in per_year_stats) / n,
        'mean_roe': sum(x['mean_roe']*x['n'] for x in per_year_stats if x['mean_roe'] is not None) / n if all(x['mean_roe'] is not None for x in per_year_stats) else None,
    }

# ── Build buckets for each strategy variant ─────────────────────────────────
value_by_year = {}
leading_by_year = {}
intersection_by_year = {}
value_only_by_year = {}
leading_only_by_year = {}

for year in range(2015, 2026):
    val_picks = pick_for_year(year, W_VALUE)
    lead_picks = pick_for_year(year, W_LEADING)
    if val_picks.empty or lead_picks.empty: continue
    val_fips = set(val_picks['fips'].tolist())
    lead_fips = set(lead_picks['fips'].tolist())
    inter = val_fips & lead_fips
    v_only = val_fips - lead_fips
    l_only = lead_fips - val_fips
    value_by_year[year] = val_picks
    leading_by_year[year] = lead_picks
    intersection_by_year[year] = val_picks[val_picks['fips'].isin(inter)]
    value_only_by_year[year] = val_picks[val_picks['fips'].isin(v_only)]
    leading_only_by_year[year] = lead_picks[lead_picks['fips'].isin(l_only)]

# ── Report per-year intersection detail ─────────────────────────────────────
print('='*135)
print('INTERSECTION PICKS PER YEAR — markets in BOTH VALUE and LEADING lists')
print('='*135)
for horizon in [3, 5]:
    tr_col = f'total_return_{horizon}yr'
    print(f'\n═══ {horizon}yr horizon ═══\n')
    print(f'{"year":<6}{"# in":<6}{"picks":<70}{"mean TR":>10}{"edge":>10}{"above":>8}{"below":>8}{"under":>8}')
    print('-'*135)
    for year in sorted(intersection_by_year.keys()):
        inter = intersection_by_year[year]
        if inter.empty: continue
        yr_uni = uni[uni['year']==year].dropna(subset=[tr_col])
        if yr_uni.empty:
            picks_str = ', '.join([f"{r['county_name'].replace(' County','')}, {r['state_name']}" for _, r in inter.iterrows()])
            print(f'{year:<6}{len(inter):<6}{picks_str[:70]:<70}{"n/a":>10}{"n/a":>10}{"":>8}{"":>8}{"":>8}')
            continue
        uni_mean = yr_uni[tr_col].mean() * 100
        obs = inter.dropna(subset=[tr_col])
        if obs.empty:
            picks_str = ', '.join([f"{r['county_name'].replace(' County','')}, {r['state_name']}" for _, r in inter.iterrows()])
            print(f'{year:<6}{len(inter):<6}{picks_str[:70]:<70}{"n/a":>10}{"n/a":>10}{"":>8}{"":>8}{"":>8}')
            continue
        tr_pct = obs[tr_col] * 100
        edge = tr_pct - uni_mean
        above = int((edge > 2).sum())
        below = int((edge < -2).sum())
        under = int((tr_pct < 0).sum())
        picks_str = ', '.join([f"{r['county_name'].replace(' County','')}, {r['state_name']}" for _, r in obs.iterrows()])
        print(f'{year:<6}{len(obs):<6}{picks_str[:70]:<70}{tr_pct.mean():>+9.2f}%{edge.mean():>+9.2f}pp{above:>8}{below:>8}{under:>8}')

# ── Aggregate comparison table ──────────────────────────────────────────────
def print_agg_row(name, per_year_stats):
    t = totals(per_year_stats)
    if not t: return
    hit = f'{t["above"]}/{t["n"]} ({t["hit_rate"]:.1f}%)'
    avg = f'{t["avg"]}/{t["n"]}'
    bel = f'{t["below"]}/{t["n"]}'
    und = f'{t["underwater"]}/{t["n"]}'
    edge = f'{t["edge"]:+.2f}pp'
    tr = f'{t["mean_tr"]:+.2f}%'
    roe = f'{t["mean_roe"]:+.2f}%' if t["mean_roe"] is not None else 'n/a'
    print(f'  {name:<24} {hit:<17} {avg:<10} {bel:<10} {und:<10} {edge:<11} {tr:<11} {roe}')

for horizon, years in [(3, range(2015, 2023)), (5, range(2015, 2021))]:
    print('\n' + '='*135)
    print(f'AGGREGATE — {horizon}yr horizon ({min(years)}-{max(years)} cohorts)')
    print('='*135)
    print()
    val_stats = evaluate_bucket({y:p for y,p in value_by_year.items() if y in years}, horizon)
    lead_stats = evaluate_bucket({y:p for y,p in leading_by_year.items() if y in years}, horizon)
    inter_stats = evaluate_bucket({y:p for y,p in intersection_by_year.items() if y in years}, horizon)
    val_only_stats = evaluate_bucket({y:p for y,p in value_only_by_year.items() if y in years}, horizon)
    lead_only_stats = evaluate_bucket({y:p for y,p in leading_only_by_year.items() if y in years}, horizon)
    print(f'  {"strategy":<24} {"above avg":<17} {"average":<10} {"below":<10} {"under":<10} {"edge":<11} {"mean TR":<11} {"lev ROE"}')
    print('  ' + '-'*128)
    print_agg_row('VALUE (full 10)',    val_stats)
    print_agg_row('LEADING (full 10)',  lead_stats)
    print_agg_row('INTERSECTION',       inter_stats)
    print_agg_row('VALUE-only',         val_only_stats)
    print_agg_row('LEADING-only',       lead_only_stats)
