"""Compare picks: does the leading-indicator model find NEW markets vs VALUE?

For each year (2018-2025):
  - Run VALUE strategy (current, pricing-anchored)
  - Run LEADING-INDICATOR strategy (from walk-forward frozen selection)
  - Show overlap, VALUE-only picks, LEADING-only picks
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
           business_apps_per_1000_3yr_avg,
           max_supersector_share, employment_diversity_hhi,
           renter_ind_emp_yoy, mf_permit_ratio_change_3yr,
           unemployment_rate_yoy_chg, domesticmig_per_1000,
           zori_forward_return_36mo, hpi_forward_return_36mo
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
uni['total_return_3yr'] = 3 * uni['cap_rate_proxy'] * (1 - 0.45) * (1 + uni['zori_forward_return_36mo']/2) + uni['hpi_forward_return_36mo']

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
# Leading-indicator FROZEN weights (from walk-forward, features selected on 2015)
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

# ── Run overlap check for each year ─────────────────────────────────────────
print('='*130)
print('PICK OVERLAP: VALUE vs LEADING-INDICATOR-ONLY strategies')
print('='*130)

total_overlap = 0
total_picks = 0
years_data = []

for year in range(2018, 2026):
    val_picks = pick_for_year(year, W_VALUE)
    lead_picks = pick_for_year(year, W_LEADING)
    if val_picks.empty or lead_picks.empty: continue

    val_fips = set(val_picks['fips'].tolist())
    lead_fips = set(lead_picks['fips'].tolist())
    overlap_fips = val_fips & lead_fips
    val_only = val_fips - lead_fips
    lead_only = lead_fips - val_fips

    fips_to_name = dict(zip(uni[uni['year']==year]['fips'], uni[uni['year']==year]['county_name'].str.replace(' County','') + ', ' + uni[uni['year']==year]['state_name']))

    total_overlap += len(overlap_fips)
    total_picks += len(val_fips)

    print(f'\n── YEAR {year} ─────────────────────────────────────────────────────────')
    print(f'  Overlap: {len(overlap_fips)}/{len(val_fips)} picks ({len(overlap_fips)/len(val_fips)*100:.0f}% same)')
    print(f'  BOTH  ({len(overlap_fips)}): {sorted([fips_to_name.get(f, f) for f in overlap_fips])}')
    print(f'  VALUE only  ({len(val_only)}): {sorted([fips_to_name.get(f, f) for f in val_only])}')
    print(f'  LEADING only ({len(lead_only)}): {sorted([fips_to_name.get(f, f) for f in lead_only])}')
    years_data.append({'year':year, 'overlap':len(overlap_fips), 'val_only':len(val_only), 'lead_only':len(lead_only)})

print('\n' + '='*130)
print(f'AGGREGATE OVERLAP: {total_overlap}/{total_picks} picks ({total_overlap/total_picks*100:.0f}% same across all years)')
print('='*130)
print()
print(pd.DataFrame(years_data).to_string(index=False))
