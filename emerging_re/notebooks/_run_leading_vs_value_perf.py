"""Head-to-head performance: LEADING-indicator strategy vs VALUE strategy.

Both strategies use same universe (300K-1M pop) and same gates.
Only the OPPORTUNITY SCORE weights differ.
Backtest 2015-2022 (in-sample for both) + walk-forward test years 2018-2022.
Reports hit rate, edge, return, underwater, per-year detail, best/worst picks.
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

def evaluate(picks, year, horizon):
    tr_col = f'total_return_{horizon}yr'
    if picks.empty or tr_col not in picks.columns: return None
    yr_uni = uni[uni['year']==year].dropna(subset=[tr_col])
    if yr_uni.empty: return None
    uni_mean = yr_uni[tr_col].mean() * 100
    obs = picks.dropna(subset=[tr_col]).copy()
    if obs.empty: return None
    obs['tr_pct'] = obs[tr_col] * 100
    obs['edge']   = obs['tr_pct'] - uni_mean
    roe = obs[f'levered_ROE_{horizon}yr'] * 100 if f'levered_ROE_{horizon}yr' in obs.columns else pd.Series()
    return {
        'n':           len(obs),
        'above':       int((obs['edge'] > 2).sum()),
        'below':       int((obs['edge'] < -2).sum()),
        'underwater':  int((obs['tr_pct'] < 0).sum()),
        'hit_rate':    int((obs['edge'] > 2).sum()) / len(obs) * 100,
        'edge':        obs['edge'].mean(),
        'mean_tr':     obs['tr_pct'].mean(),
        'mean_roe':    roe.mean() if not roe.empty else None,
        'uni_mean':    uni_mean,
        'best_tr':     obs['tr_pct'].max(),
        'worst_tr':    obs['tr_pct'].min(),
    }

# ── HORIZON 3YR ──────────────────────────────────────────────────────────
for horizon, years in [(3, range(2015, 2023)), (5, range(2015, 2021))]:
    print('='*130)
    print(f'{horizon}YR HORIZON — VALUE vs LEADING head-to-head (2015-{max(years)} cohorts)')
    print('='*130)
    print()
    print(f'{"year":<6}{"strategy":<12}{"n":>4}{"above":>7}{"below":>7}{"under":>7}{"hit%":>8}{"edge":>10}{"mean TR":>10}{"lev ROE":>10}{"uni mean":>10}{"best":>10}{"worst":>10}')
    print('-'*130)
    all_value, all_leading = [], []
    for yr in years:
        val_picks = pick_for_year(yr, W_VALUE)
        lead_picks = pick_for_year(yr, W_LEADING)
        v = evaluate(val_picks, yr, horizon)
        l = evaluate(lead_picks, yr, horizon)
        if v: all_value.append({**v, 'year':yr})
        if l: all_leading.append({**l, 'year':yr})
        if v and l:
            print(f'{yr:<6}{"VALUE":<12}{v["n"]:>4}{v["above"]:>7}{v["below"]:>7}{v["underwater"]:>7}'
                  f'{v["hit_rate"]:>7.1f}%{v["edge"]:>+9.2f}pp{v["mean_tr"]:>+9.2f}%'
                  f'{("+%.2f%%" % v["mean_roe"]) if v["mean_roe"] is not None else "     n/a":>10}{v["uni_mean"]:>+9.2f}%{v["best_tr"]:>+9.2f}%{v["worst_tr"]:>+9.2f}%')
            print(f'{"":<6}{"LEADING":<12}{l["n"]:>4}{l["above"]:>7}{l["below"]:>7}{l["underwater"]:>7}'
                  f'{l["hit_rate"]:>7.1f}%{l["edge"]:>+9.2f}pp{l["mean_tr"]:>+9.2f}%'
                  f'{("+%.2f%%" % l["mean_roe"]) if l["mean_roe"] is not None else "     n/a":>10}{l["uni_mean"]:>+9.2f}%{l["best_tr"]:>+9.2f}%{l["worst_tr"]:>+9.2f}%')
            hit_diff = l['hit_rate'] - v['hit_rate']
            edge_diff = l['edge'] - v['edge']
            tr_diff = l['mean_tr'] - v['mean_tr']
            print(f'{"":<6}{"Δ LEAD-VAL":<12}{"":>4}{"":>7}{"":>7}{"":>7}{hit_diff:>+7.1f}pp{edge_diff:>+9.2f}pp{tr_diff:>+9.2f}%')

    # Aggregate
    def totals(results):
        if not results: return None
        n = sum(x['n'] for x in results)
        return {
            'n': n,
            'above': sum(x['above'] for x in results),
            'below': sum(x['below'] for x in results),
            'underwater': sum(x['underwater'] for x in results),
            'hit_rate': sum(x['above'] for x in results) / n * 100,
            'edge': sum(x['edge']*x['n'] for x in results) / n,
            'mean_tr': sum(x['mean_tr']*x['n'] for x in results) / n,
            'mean_roe': sum(x['mean_roe']*x['n'] for x in results if x['mean_roe'] is not None) / n if all(x['mean_roe'] is not None for x in results) else None,
            'best_tr': max(x['best_tr'] for x in results),
            'worst_tr': min(x['worst_tr'] for x in results),
        }
    tv = totals(all_value)
    tl = totals(all_leading)
    print('-'*130)
    if tv and tl:
        print(f'{"TOTAL":<6}{"VALUE":<12}{tv["n"]:>4}{tv["above"]:>7}{tv["below"]:>7}{tv["underwater"]:>7}'
              f'{tv["hit_rate"]:>7.1f}%{tv["edge"]:>+9.2f}pp{tv["mean_tr"]:>+9.2f}%'
              f'{("+%.2f%%" % tv["mean_roe"]) if tv["mean_roe"] is not None else "     n/a":>10}{"":<10}{tv["best_tr"]:>+9.2f}%{tv["worst_tr"]:>+9.2f}%')
        print(f'{"":<6}{"LEADING":<12}{tl["n"]:>4}{tl["above"]:>7}{tl["below"]:>7}{tl["underwater"]:>7}'
              f'{tl["hit_rate"]:>7.1f}%{tl["edge"]:>+9.2f}pp{tl["mean_tr"]:>+9.2f}%'
              f'{("+%.2f%%" % tl["mean_roe"]) if tl["mean_roe"] is not None else "     n/a":>10}{"":<10}{tl["best_tr"]:>+9.2f}%{tl["worst_tr"]:>+9.2f}%')
        print(f'{"":<6}{"Δ LEAD-VAL":<12}{"":>4}{"":>7}{"":>7}{"":>7}{tl["hit_rate"]-tv["hit_rate"]:>+7.1f}pp{tl["edge"]-tv["edge"]:>+9.2f}pp{tl["mean_tr"]-tv["mean_tr"]:>+9.2f}%')
    print()
