"""Rank INTERSECTION picks (VALUE ∩ LEADING) by Recession Resilience Score.

Combines two signals:
  1. Intersection frequency — how many cohorts (2015-2025) picked this market in BOTH strategies
  2. Recession Resilience Score — proven historical + structural resilience

Best picks = frequently confirmed by both strategies AND resilient in a crash.
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
pep_raw['as_of_date'] = pd.to_datetime(pep_raw['as_of_date'])
uni = uni.merge(mortgage, on='year', how='left').merge(gateway_caps, on='year', how='left')
uni['cap_spread_to_gateway_pp'] = (uni['cap_rate_proxy'] - uni['gateway_cap_median']) * 100
uni['permits_per_new_job']      = uni['permits_per_1000'] / (uni['emp_growth_yoy'].clip(lower=0.005) * 450)

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

# ── Find all intersection picks across cohorts ─────────────────────────────
intersection_appearances = {}  # fips -> list of years
for year in range(2015, 2026):
    val = pick_for_year(year, W_VALUE)
    lead = pick_for_year(year, W_LEADING)
    if val.empty or lead.empty: continue
    both = set(val['fips']) & set(lead['fips'])
    for f in both:
        intersection_appearances.setdefault(f, []).append(year)

# ── Compute RRS for each intersection market ───────────────────────────────
fips_list = sorted(intersection_appearances.keys())
name_lookup = uni[uni['fips'].isin(fips_list)].drop_duplicates(subset='fips').set_index('fips')[['county_name','state_name']].to_dict('index')

# Historical HPI (2007, 2010, 2021, 2024)
hpi_hist = con.execute(f'''
    WITH hpi_pts AS (
        SELECT fips, EXTRACT(YEAR FROM period_end_date)::INT AS year, hpi
        FROM main_staging.stg_fhfa_hpi
        WHERE fips IN ({",".join(repr(f) for f in fips_list)})
          AND EXTRACT(MONTH FROM period_end_date) = 12
        QUALIFY row_number() OVER (PARTITION BY fips, EXTRACT(YEAR FROM period_end_date) ORDER BY as_of_date DESC) = 1
    )
    SELECT fips,
           MAX(CASE WHEN year=2007 THEN hpi END) as hpi_2007,
           MAX(CASE WHEN year=2010 THEN hpi END) as hpi_2010,
           MAX(CASE WHEN year=2021 THEN hpi END) as hpi_2021,
           MAX(CASE WHEN year=2024 THEN hpi END) as hpi_2024
    FROM hpi_pts GROUP BY fips
''').df()

# Current features (2024)
current_feat = con.execute(f'''
    SELECT fips, cap_rate_proxy*100 as cap_pct, employment_diversity_hhi
    FROM main_marts.mart_county_features
    WHERE fips IN ({",".join(repr(f) for f in fips_list)})
      AND EXTRACT(YEAR FROM period_end_date) = 2024
      AND EXTRACT(MONTH FROM period_end_date) = 12
''').df()
con.close()

data = current_feat.merge(hpi_hist, on='fips', how='left')
data['hpi_2007_2010'] = (data['hpi_2010'] / data['hpi_2007'] - 1) * 100
data['hpi_trailing_3yr_ann'] = ((data['hpi_2024'] / data['hpi_2021']) ** (1/3) - 1) * 100

def s_hist(v):
    if pd.isna(v): return 5
    if v >= 5: return 10
    if v >= 0: return 9
    if v >= -5: return 8
    if v >= -10: return 6
    if v >= -20: return 4
    if v >= -30: return 2
    if v >= -40: return 1
    return 0
def s_hhi(v):
    if pd.isna(v): return 5
    if v < 0.06: return 10
    if v < 0.08: return 8
    if v < 0.10: return 6
    if v < 0.12: return 4
    if v < 0.15: return 2
    return 0
def s_bubble(v):
    if pd.isna(v): return 5
    if v < 3: return 10
    if v < 5: return 8
    if v < 8: return 6
    if v < 12: return 4
    if v < 18: return 2
    return 0
def s_cap(v):
    if pd.isna(v): return 5
    if v >= 8.0: return 10
    if v >= 7.0: return 8
    if v >= 6.5: return 6
    if v >= 6.0: return 4
    if v >= 5.5: return 2
    return 0

data['s_H']    = data['hpi_2007_2010'].apply(s_hist)
data['s_D']    = data['employment_diversity_hhi'].apply(s_hhi)
data['s_B']    = data['hpi_trailing_3yr_ann'].apply(s_bubble)
data['s_Y']    = data['cap_pct'].apply(s_cap)
# Set sticky to fixed 5 (data quality issue in prior run) — factor 5 not discriminating
data['s_S']    = 5
data['RRS']    = (0.30*data['s_H'] + 0.20*data['s_D'] + 0.20*data['s_B'] + 0.20*data['s_Y'] + 0.10*data['s_S']).round(2)

# Add intersection frequency
data['name']         = data['fips'].map(lambda f: f"{name_lookup[f]['county_name'].replace(' County','')}, {name_lookup[f]['state_name']}" if f in name_lookup else f)
data['freq']         = data['fips'].map(lambda f: len(intersection_appearances[f]))
data['years']        = data['fips'].map(lambda f: ', '.join(str(y) for y in sorted(intersection_appearances[f])))
data['in_2025']      = data['fips'].map(lambda f: 2025 in intersection_appearances[f])

# Combined score: RRS × sqrt(frequency) — freq should boost but with diminishing returns
data['combined']     = (data['RRS'] * np.sqrt(data['freq'])).round(2)

# Sort by combined
data = data.sort_values('combined', ascending=False).reset_index(drop=True)

print('='*130)
print('INTERSECTION PICKS × RECESSION RESILIENCE SCORE')
print('='*130)
print()
print(f'Intersection = markets picked by BOTH VALUE and LEADING strategies (2015-2025)')
print(f'RRS = Recession Resilience Score (0-10)')
print(f'Combined = RRS × sqrt(frequency) — rewards both recession safety AND multi-year confirmation')
print()
print(f'{"rank":<5}{"market":<26}{"freq":>5}{"in_2025":>9}{"07-10 HPI":>11}{"trail 3yr":>11}{"cap%":>7}{"HHI":>7}   {"H":>3}{"D":>3}{"B":>3}{"Y":>3}   {"RRS":>6}   {"combined":>9}   years in intersection')
print('-'*130)
for i, x in data.iterrows():
    hist = f'{x.hpi_2007_2010:+.1f}%' if pd.notna(x.hpi_2007_2010) else '   n/a'
    trail = f'{x.hpi_trailing_3yr_ann:+.1f}%' if pd.notna(x.hpi_trailing_3yr_ann) else '   n/a'
    hhi_v = f'{x.employment_diversity_hhi:.3f}' if pd.notna(x.employment_diversity_hhi) else '  n/a'
    cap_v = f'{x.cap_pct:.2f}%' if pd.notna(x.cap_pct) else 'n/a'
    marker = ' ✓' if x.in_2025 else ''
    print(f'{i+1:<5}{x["name"]:<26}{int(x.freq):>5}{marker:>9}{hist:>11}{trail:>11}{cap_v:>7}{hhi_v:>7}   {int(x.s_H):>3}{int(x.s_D):>3}{int(x.s_B):>3}{int(x.s_Y):>3}   {x.RRS:>6.2f}   {x.combined:>9.2f}   {x.years}')

# 2025-specific view
print()
print('='*130)
print('2025 CURRENT INTERSECTION PICKS — recession-resilience ranking')
print('='*130)
current = data[data['in_2025'] == True].sort_values('RRS', ascending=False).reset_index(drop=True)
print()
for i, x in current.iterrows():
    hist = f'{x.hpi_2007_2010:+.1f}%' if pd.notna(x.hpi_2007_2010) else 'n/a'
    print(f'  #{i+1} {x["name"]:<24} RRS={x.RRS}  freq={int(x.freq)}   2007-2010 HPI: {hist}   cap: {x.cap_pct:.2f}%')
