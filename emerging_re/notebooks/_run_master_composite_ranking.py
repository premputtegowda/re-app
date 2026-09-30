"""Master Composite Score — combines ALL signals into a single ranking.

Six dimensions, each 0-10, weighted:
  1. VALUE opportunity score (relative within pool)      — 25%
  2. LEADING agreement (intersection premium)             — 20%
  3. Recession Resilience Score (forward-looking)         — 15%
  4. Deployability (inventory + MSA scale + track record) — 15%
  5. Cap yield (absolute cash flow floor)                 — 15%
  6. Historical hit rate (proven track record)            — 10%

Final Master Score 0-10. Higher = more defensible single-market bet.
"""
from __future__ import annotations
import duckdb, numpy as np, pandas as pd, math

WAREHOUSE = '/Users/premputtegowda/reps/reps-tracker/emerging_re/data/warehouse/emerging_re.duckdb'
POP_MIN, POP_MAX = 300_000, 1_000_000
TOP_N, MAX_PER_STATE = 10, 3
GATEWAY_FIPS = ['06037','36061','36047','36081','06075','25025','11001','17031']

# Load universe
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
_hpi_all = con.execute(f'SELECT fips, EXTRACT(YEAR FROM period_end_date)::INT AS year, hpi FROM main_staging.stg_fhfa_hpi WHERE fips IN ({_all_fips_str}) AND EXTRACT(MONTH FROM period_end_date)=12 QUALIFY row_number() OVER (PARTITION BY fips, EXTRACT(YEAR FROM period_end_date) ORDER BY as_of_date DESC)=1').df()

# MF building inventory
mf_units = con.execute(f'''
    SELECT fips,
           units_in_5_to_9_bldgs/7 + units_in_10_to_19_bldgs/14.5 AS bldgs_5to19
    FROM main_staging.stg_census_acs_1yr
    WHERE fips IN ({_all_fips_str})
    QUALIFY row_number() OVER (PARTITION BY fips ORDER BY as_of_date DESC) = 1
''').df()
mf_units['bldgs_5to19'] = mf_units['bldgs_5to19'].round().astype(int)
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

W_VALUE = {'cap_spread_to_gateway_pp':2.0,'cap_rate_proxy':1.5,'wage_growth_yoy':0.8,'pop_yoy_pct':0.5,'business_apps_per_1000':0.5,'permits_per_new_job':-1.0,'recession_resilience_score':0.5,'knowledge_emp_growth_vs_state_pp':0.5,'rent_growth_vs_wage_growth':0.3}
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

# ── Compute historical intersection track record per fips ─────────────────
intersection_years = {}
for year in range(2015, 2026):
    v = pick_for_year(year, W_VALUE)
    l = pick_for_year(year, W_LEADING)
    if v.empty or l.empty: continue
    both = set(v['fips']) & set(l['fips'])
    for f in both:
        intersection_years.setdefault(f, []).append(year)

# Historical VALUE picks with hit rate
value_history = {}
for year in range(2015, 2023):  # observable 3yr
    v = pick_for_year(year, W_VALUE)
    if v.empty: continue
    yr_uni = uni[uni['year']==year].dropna(subset=['total_return_3yr'])
    if yr_uni.empty: continue
    uni_mean = yr_uni['total_return_3yr'].mean() * 100
    for _, r in v.iterrows():
        if pd.notna(r['total_return_3yr']):
            tr = r['total_return_3yr']*100
            edge = tr - uni_mean
            value_history.setdefault(r['fips'], []).append({'year':year, 'above':edge > 2, 'below':edge < -2, 'edge':edge})

# ── Get 2025 picks and score each on 6 dimensions ────────────────────────
picks_2025 = pick_for_year(2025, W_VALUE)
lead_2025 = pick_for_year(2025, W_LEADING)
lead_fips = set(lead_2025['fips']) if not lead_2025.empty else set()

# Deployability scoring inputs
picks_2025 = picks_2025.merge(mf_units, on='fips', how='left')
picks_2025['bldgs_5to19'] = picks_2025['bldgs_5to19'].fillna(0).astype(int)

rows = []
opp_max = picks_2025['opportunity_score'].max() if not picks_2025.empty else 1
opp_min = picks_2025['opportunity_score'].min() if not picks_2025.empty else 0
for _, r in picks_2025.iterrows():
    fips = r['fips']
    name = f"{r['county_name'].replace(' County','')}, {r['state_name']}"

    # 1. VALUE opportunity score (relative within 2025 pool, 0-10)
    opp = r['opportunity_score']
    opp_norm = (opp - opp_min) / (opp_max - opp_min) * 10 if opp_max != opp_min else 5

    # 2. LEADING agreement (in intersection = 10, VALUE-only = 5)
    in_lead = fips in lead_fips
    lead_score = 10 if in_lead else 5

    # 3. RRS (already 0-10)
    rrs = r['recession_resilience_score']

    # 4. Deployability (inventory + MSA + track record)
    inv = r['bldgs_5to19']
    inv_score = min(10, max(0, math.log10(max(inv, 1)) * 2.5)) if inv > 0 else 0
    pop = r['pop_latest']
    msa_score = min(10, math.log10(max(pop, 100000)) * 1.5 - 5.5)  # 300K→3.7, 1M→4.5→scaled
    msa_score = min(10, max(0, (math.log10(pop) - 5.4) * 20))  # normalized
    track = value_history.get(fips, [])
    n_track = len(track)
    if n_track > 0:
        n_above = sum(1 for t in track if t['above'])
        n_below = sum(1 for t in track if t['below'])
        track_score = min(10, max(0, min(n_track, 5) + 5 * (n_above / n_track) - 3 * (n_below / n_track)))
    else:
        track_score = 5  # neutral for new picks
    deploy = (inv_score * 0.4 + msa_score * 0.3 + track_score * 0.3)

    # 5. Cap yield (absolute, 0-10)
    cap_pct = r['cap_rate_proxy'] * 100
    yield_score = min(10, max(0, (cap_pct - 5.0) * 3))  # 5%→0, 7%→6, 8.3%→10

    # 6. Historical hit rate (VALUE picks in this market)
    hist_score = 5  # baseline
    if n_track >= 1:
        hist_score = min(10, max(0, (n_above / n_track) * 10))
    intersection_count = len(intersection_years.get(fips, []))

    # Master Composite Score
    master = (0.25 * opp_norm + 0.20 * lead_score + 0.15 * rrs + 0.15 * deploy +
              0.15 * yield_score + 0.10 * hist_score)

    rows.append({
        'market':        name,
        'pop':           int(r['pop_latest']),
        'cap%':          round(cap_pct, 2),
        'bldgs_5to19':   int(inv),
        'in_intersection': 'YES' if in_lead else 'no',
        'hist_appearances': n_track,
        'hist_above':    sum(1 for t in track if t['above']) if track else 0,
        'hist_below':    sum(1 for t in track if t['below']) if track else 0,
        'intersection_yrs': intersection_count,
        '1_VALUE':       round(opp_norm, 2),
        '2_LEAD':        round(lead_score, 2),
        '3_RRS':         round(rrs, 2),
        '4_DEPLOY':      round(deploy, 2),
        '5_YIELD':       round(yield_score, 2),
        '6_HIST':        round(hist_score, 2),
        'MASTER':        round(master, 2),
    })
df = pd.DataFrame(rows).sort_values('MASTER', ascending=False).reset_index(drop=True)

print('='*140)
print('MASTER COMPOSITE SCORE — 2025 EMERGING-VALUE picks')
print('='*140)
print('\nWeights: 25% VALUE opp × 20% LEADING agreement × 15% RRS × 15% Deployability × 15% Yield × 10% Historical hit rate')
print()
cols = ['market','pop','cap%','bldgs_5to19','in_intersection','1_VALUE','2_LEAD','3_RRS','4_DEPLOY','5_YIELD','6_HIST','MASTER']
compact = df[cols].copy()
compact.index = compact.index + 1
print(compact.to_string())

# ── Deep dive on top 3 ────────────────────────────────────────────────────
print()
print('='*140)
print('TOP 3 MARKETS — full detail')
print('='*140)
for i, r in df.head(3).iterrows():
    print()
    print(f'#{i+1}  {r["market"]}   MASTER SCORE: {r["MASTER"]:.2f}')
    print(f'    Population: {r["pop"]:,}   Cap: {r["cap%"]:.2f}%   MF Bldgs 5-19: {r["bldgs_5to19"]:,}')
    print(f'    In VALUE ∩ LEADING intersection: {r["in_intersection"]}   |   Intersection years since 2015: {r["intersection_yrs"]}')
    print(f'    Historical VALUE picks: {r["hist_appearances"]} (above avg: {r["hist_above"]}, below avg: {r["hist_below"]})')
    print(f'    Component scores:')
    print(f'      1. VALUE opportunity:      {r["1_VALUE"]}/10')
    print(f'      2. LEADING agreement:      {r["2_LEAD"]}/10')
    print(f'      3. Recession resilience:   {r["3_RRS"]}/10')
    print(f'      4. Deployability:          {r["4_DEPLOY"]}/10')
    print(f'      5. Cap yield floor:        {r["5_YIELD"]}/10')
    print(f'      6. Historical hit rate:    {r["6_HIST"]}/10')

# Final recommendation
print()
print('='*140)
top = df.iloc[0]
runner = df.iloc[1]
gap = top['MASTER'] - runner['MASTER']
print(f'RECOMMENDATION: {top["market"]}  (Master Score {top["MASTER"]:.2f})')
if gap >= 0.5:
    print(f'  → CLEAR winner ({gap:.2f} points ahead of #2 {runner["market"]} at {runner["MASTER"]:.2f})')
elif gap >= 0.2:
    print(f'  → Modest lead over #2 {runner["market"]} ({runner["MASTER"]:.2f}) — Master is defensible but consider both')
else:
    print(f'  → Tie with #2 {runner["market"]} ({runner["MASTER"]:.2f}) — split allocation is reasonable')
print('='*140)
