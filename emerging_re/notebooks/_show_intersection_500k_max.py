"""Intersection picks with universe restricted to POP ≤ 500K (was 1M).
Compare performance vs the wider 300K-1M universe.
"""
from __future__ import annotations
import duckdb, numpy as np, pandas as pd

WAREHOUSE = '/Users/premputtegowda/reps/reps-tracker/emerging_re/data/warehouse/emerging_re.duckdb'
POP_MIN, POP_MAX = 300_000, 500_000    # ← RESTRICTED
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
mortgage = con.execute('SELECT EXTRACT(YEAR FROM observation_date)::INT AS year, value/100.0 AS mortgage_rate FROM main_staging.stg_fred_macro WHERE series_id = \'MORTGAGE30US\' QUALIFY row_number() OVER (PARTITION BY EXTRACT(YEAR FROM observation_date) ORDER BY observation_date DESC)=1').df()
pep_raw = con.execute('SELECT fips, EXTRACT(YEAR FROM period_end_date)::INT AS ref_year, popestimate, as_of_date FROM main_staging.stg_census_pep').df()
gateway_caps = con.execute(f'SELECT EXTRACT(YEAR FROM period_end_date)::INT AS year, MEDIAN(cap_rate_proxy) AS gateway_cap_median FROM main_marts.mart_county_features WHERE EXTRACT(MONTH FROM period_end_date)=12 AND fips IN ({",".join(repr(f) for f in GATEWAY_FIPS)}) GROUP BY year').df()
_all_fips_str = ",".join(repr(f) for f in uni['fips'].unique().tolist())
_hpi_all = con.execute(f'SELECT fips, EXTRACT(YEAR FROM period_end_date)::INT AS year, hpi FROM main_staging.stg_fhfa_hpi WHERE fips IN ({_all_fips_str}) AND EXTRACT(MONTH FROM period_end_date)=12 QUALIFY row_number() OVER (PARTITION BY fips, EXTRACT(YEAR FROM period_end_date) ORDER BY as_of_date DESC)=1').df()
con.close()
pep_raw['as_of_date'] = pd.to_datetime(pep_raw['as_of_date'])
uni = uni.merge(mortgage, on='year', how='left').merge(gateway_caps, on='year', how='left')
uni['cap_spread_to_gateway_pp'] = (uni['cap_rate_proxy'] - uni['gateway_cap_median']) * 100
uni['permits_per_new_job']      = uni['permits_per_1000'] / (uni['emp_growth_yoy'].clip(lower=0.005) * 450)
_lag5 = _hpi_all.rename(columns={'hpi':'hpi_5yr_prior','year':'year_join'})
_lag5['year_join'] = _lag5['year_join'] + 5
_hpi_all = _hpi_all.merge(_lag5[['fips','year_join','hpi_5yr_prior']], left_on=['fips','year'], right_on=['fips','year_join'], how='left').drop(columns='year_join')
_hpi_all['trailing_5yr_hpi_ann'] = (_hpi_all['hpi'] / _hpi_all['hpi_5yr_prior']) ** (1/5) - 1
uni = uni.merge(_hpi_all[['fips','year','trailing_5yr_hpi_ann']], on=['fips','year'], how='left')

def _y(v):
    if pd.isna(v): return 5
    p=v*100; return 10 if p>=8 else 8 if p>=7 else 6 if p>=6.5 else 4 if p>=6 else 2 if p>=5.5 else 0
def _b(v):
    if pd.isna(v): return 5
    p=v*100; return 10 if p<3 else 8 if p<5 else 6 if p<8 else 4 if p<10 else 2 if p<12 else 0
def _d(v):
    if pd.isna(v): return 5
    return 10 if v<0.06 else 8 if v<0.08 else 6 if v<0.10 else 4 if v<0.12 else 2 if v<0.15 else 0
def _p(v):
    if pd.isna(v): return 5
    return 10 if v<=0.8 else 8 if v<=1.0 else 6 if v<=1.2 else 4 if v<=1.5 else 2 if v<=2.0 else 0
def _m(v):
    if pd.isna(v): return 5
    if v<0: return 4
    return 10 if v<=1 else 8 if v<=2 else 6 if v<=3 else 4 if v<=4 else 2

uni['rrs_Y'] = uni['cap_rate_proxy'].apply(_y)
uni['rrs_B'] = uni['trailing_5yr_hpi_ann'].apply(_b)
uni['rrs_D'] = uni['employment_diversity_hhi'].apply(_d)
uni['rrs_P'] = uni['permits_intensity_ratio'].apply(_p)

STATE_OPEX = {'Ohio':0.57,'Michigan':0.57,'Pennsylvania':0.57,'Illinois':0.57,'Wisconsin':0.57,'New York':0.57,'New Jersey':0.57,'Connecticut':0.57,'Missouri':0.52,'Massachusetts':0.52,'Maryland':0.52,'California':0.47,'Iowa':0.47,'Minnesota':0.47,'Florida':0.47,'Indiana':0.47,'Texas':0.44,'Virginia':0.44,'Colorado':0.44,'Washington':0.44,'Kansas':0.44,'Kentucky':0.44,'Georgia':0.42,'North Carolina':0.42,'South Carolina':0.42,'Tennessee':0.42,'Oklahoma':0.42,'Utah':0.42,'Idaho':0.42,'Arizona':0.40,'Nevada':0.40,'Alabama':0.40,'Mississippi':0.40,'Arkansas':0.40}
uni['opex_ratio'] = uni['state_name'].map(STATE_OPEX).fillna(0.45)
for h, zc, hc in [(3,'zori_forward_return_36mo','hpi_forward_return_36mo'),(5,'zori_forward_return_60mo','hpi_forward_return_60mo')]:
    uni[f'total_return_{h}yr'] = h * uni['cap_rate_proxy'] * (1-uni['opex_ratio']) * (1 + uni[zc]/2) + uni[hc]

def pit_pop_yoy(cohort_year):
    cutoff = pd.Timestamp(f'{cohort_year}-12-31')
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

W_VALUE = {'cap_spread_to_gateway_pp':2.0,'cap_rate_proxy':1.5,'wage_growth_yoy':0.8,'pop_yoy_pct':0.5,'business_apps_per_1000':0.5,'permits_per_new_job':-1.0,'recession_resilience_score':0.5}
W_LEADING = {'domesticmig_per_1000':0.5,'renter_ind_emp_yoy':0.5,'business_apps_per_1000':0.5,'mf_permit_ratio_change_3yr':0.5,'unemployment_rate_yoy_chg':-0.5,'wage_growth_yoy':0.5}
GATES = {'min_pop_yoy_pct':0.0,'max_permit_ratio':1.5,'max_unemp_pct':6.0,'min_wage_growth':0.02,'max_sector_share':0.25,'min_cap_spread_pp':0.0,'max_hhi_strategy':0.15,'require_no_disq':True}

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

# ── Per-year intersection ────────────────────────────────────────────────
print('='*135)
print(f'INTERSECTION PICKS (VALUE ∩ LEADING) — universe restricted to pop {POP_MIN:,}–{POP_MAX:,}')
print('='*135)
n_universe = uni[uni['year']==2024]['fips'].nunique()
print(f'\nUniverse size (2024): {n_universe} counties (vs ~191 for 300K-1M range)')
print()

for year in range(2015, 2026):
    val = pick_for_year(year, W_VALUE)
    lead = pick_for_year(year, W_LEADING)
    if val.empty or lead.empty:
        print(f'── YEAR {year} ── (strategy returned no picks)')
        continue
    both = set(val['fips']) & set(lead['fips'])
    inter = val[val['fips'].isin(both)]
    yr_uni_3 = uni[uni['year']==year].dropna(subset=['total_return_3yr'])
    yr_uni_5 = uni[uni['year']==year].dropna(subset=['total_return_5yr'])
    u3 = yr_uni_3['total_return_3yr'].mean() * 100 if not yr_uni_3.empty else float('nan')
    u5 = yr_uni_5['total_return_5yr'].mean() * 100 if not yr_uni_5.empty else float('nan')

    if pd.notna(u3):
        print(f'\n── YEAR {year} ──   intersection: {len(inter)}/10  |  universe 3yr TR: {u3:+.2f}%  |  5yr TR: {u5:+.2f}%' if pd.notna(u5) else f'\n── YEAR {year} ──   intersection: {len(inter)}/10  |  universe 3yr TR: {u3:+.2f}%')
    else:
        print(f'\n── YEAR {year} ──   intersection: {len(inter)}/10 (fwd not observable)')
    if inter.empty:
        print('   (no overlap)')
        continue
    print(f'   {"#":<3}{"market":<30}{"pop":>10}{"cap%":>7}{"RRS":>7}   {"TR_3yr":>10}  {"edge_3yr":>10}   {"TR_5yr":>10}  {"edge_5yr":>10}')
    for i, r in inter.reset_index(drop=True).iterrows():
        name = f"{r['county_name'].replace(' County','')}, {r['state_name']}"
        cap = r['cap_rate_proxy']*100
        pop = int(r['pop_latest'])
        tr3 = r['total_return_3yr']*100 if pd.notna(r.get('total_return_3yr')) else None
        tr5 = r['total_return_5yr']*100 if pd.notna(r.get('total_return_5yr')) else None
        e3 = f'{tr3 - u3:+.2f}pp' if (tr3 is not None and pd.notna(u3)) else 'n/a'
        e5 = f'{tr5 - u5:+.2f}pp' if (tr5 is not None and pd.notna(u5)) else 'n/a'
        tr3_s = f'{tr3:+.2f}%' if tr3 is not None else 'n/a'
        tr5_s = f'{tr5:+.2f}%' if tr5 is not None else 'n/a'
        print(f'   {i+1:<3}{name:<30}{pop:>10,}{cap:>6.2f}%{r["recession_resilience_score"]:>7.2f}   {tr3_s:>10}  {e3:>10}   {tr5_s:>10}  {e5:>10}')

# ── Aggregate ────────────────────────────────────────────────────────────
print()
print('='*135)
print('AGGREGATE INTERSECTION PERFORMANCE — pop ≤500K only')
print('='*135)
for horizon, years in [(3, range(2015, 2023)), (5, range(2015, 2021))]:
    tr_col = f'total_return_{horizon}yr'
    tot_n = tot_above = tot_below = tot_under = 0
    tot_edge_w = tot_tr_w = 0.0
    for year in years:
        val = pick_for_year(year, W_VALUE)
        lead = pick_for_year(year, W_LEADING)
        if val.empty or lead.empty: continue
        both = set(val['fips']) & set(lead['fips'])
        inter = val[val['fips'].isin(both)]
        yr_uni = uni[uni['year']==year].dropna(subset=[tr_col])
        if yr_uni.empty: continue
        uni_mean = yr_uni[tr_col].mean() * 100
        obs = inter.dropna(subset=[tr_col]).copy()
        if obs.empty: continue
        tr_pct = obs[tr_col] * 100
        edge = tr_pct - uni_mean
        tot_n += len(obs)
        tot_above += int((edge > 2).sum())
        tot_below += int((edge < -2).sum())
        tot_under += int((tr_pct < 0).sum())
        tot_edge_w += edge.sum()
        tot_tr_w += tr_pct.sum()
    if tot_n > 0:
        print(f'\n  {horizon}yr horizon:  n={tot_n}  above={tot_above}/{tot_n} ({tot_above/tot_n*100:.1f}%)  below={tot_below}/{tot_n}  underwater={tot_under}/{tot_n}  edge={tot_edge_w/tot_n:+.2f}pp  mean_TR={tot_tr_w/tot_n:+.2f}%')
