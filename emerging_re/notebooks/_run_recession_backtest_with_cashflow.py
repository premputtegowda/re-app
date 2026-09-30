"""Recession backtest 2007-2010 WITH cash flow (not just HPI).

Since we don't have pre-2015 cap_rate_proxy or ZORI, we BACKFILL:
  1. Get 2015 cap_rate_proxy per county (from mart)
  2. Use FHFA HPI to estimate 2007 home value: value_2007 = value_2015 × HPI_2007/HPI_2015
  3. Use national CPI Rent (CUUR0000SEHA) to estimate 2007 rent: rent_2007 = rent_2015 × CPI_2007/CPI_2015
  4. cap_2007 = cap_2015 × (rent_2007/rent_2015) / (HPI_2007/HPI_2015)
  5. For rent growth 2007-2010: use national CPI Rent series

Note: this assumes rent moved with national trend per county. Rough for CA/FL vs Rust Belt,
but usable as first-order estimate to add cash flow to the HPI-only recession backtest.
"""
from __future__ import annotations
import duckdb, numpy as np, pandas as pd, urllib.request
from io import StringIO

WAREHOUSE = '/Users/premputtegowda/reps/reps-tracker/emerging_re/data/warehouse/emerging_re.duckdb'
POP_MIN, POP_MAX = 300_000, 1_000_000
TOP_N, MAX_PER_STATE = 10, 3
LTV = 0.70

# ── Pull national CPI Rent from FRED ────────────────────────────────────────
url = 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=CUUR0000SEHA'
req = urllib.request.Request(url, headers={'User-Agent':'Mozilla/5.0'})
with urllib.request.urlopen(req, timeout=30) as resp:
    df = pd.read_csv(StringIO(resp.read().decode('utf-8')))
df.columns = ['date','value']
df['date'] = pd.to_datetime(df['date'])
df['value'] = pd.to_numeric(df['value'], errors='coerce')
df = df.dropna()
df['year'] = df['date'].dt.year
# Take December value each year
cpi_rent_annual = df[df['date'].dt.month == 12].set_index('year')['value'].to_dict()
print(f'CPI Rent loaded: {len(cpi_rent_annual)} years, {min(cpi_rent_annual.keys())}-{max(cpi_rent_annual.keys())}')

# ── Load universe from mart ─────────────────────────────────────────────────
con = duckdb.connect(WAREHOUSE, read_only=True)
# Get 2015 cap_rate_proxy per county (need this as anchor for backfilling)
cap_2015 = con.execute('''
    SELECT fips, cap_rate_proxy AS cap_2015
    FROM main_marts.mart_county_features
    WHERE EXTRACT(YEAR FROM period_end_date) = 2015 AND EXTRACT(MONTH FROM period_end_date) = 12
      AND cap_rate_proxy IS NOT NULL
''').df()

# Get FHFA HPI for 2007, 2008, 2009, 2010, 2015 per county
hpi_pts = con.execute('''
    SELECT fips, EXTRACT(YEAR FROM period_end_date)::INT AS year, hpi
    FROM main_staging.stg_fhfa_hpi
    WHERE EXTRACT(MONTH FROM period_end_date) = 12
      AND EXTRACT(YEAR FROM period_end_date) IN (2007, 2008, 2009, 2010, 2011, 2012, 2013, 2015)
    QUALIFY row_number() OVER (PARTITION BY fips, EXTRACT(YEAR FROM period_end_date) ORDER BY as_of_date DESC)=1
''').df()
hpi_wide = hpi_pts.pivot(index='fips', columns='year', values='hpi').reset_index()
hpi_wide.columns = ['fips'] + [f'hpi_{c}' for c in hpi_wide.columns[1:]]

# Get universe features for cohort years 2007-2010 (pre-2015 reduced feature set)
uni = con.execute(f'''
    SELECT fips, county_name, state_name, pop_latest,
           EXTRACT(YEAR FROM period_end_date)::INT AS year,
           unemployment_rate, unemployment_rate_yoy_chg,
           wage_growth_yoy, emp_growth_yoy,
           renter_ind_emp_yoy, employment_diversity_hhi, max_supersector_share,
           mf_permit_ratio_change_3yr, any_disqualifier,
           hpi_forward_return_36mo
    FROM main_marts.mart_county_features
    WHERE EXTRACT(MONTH FROM period_end_date) = 12
      AND EXTRACT(YEAR FROM period_end_date) BETWEEN 2007 AND 2015
      AND pop_latest > {POP_MIN} AND pop_latest <= {POP_MAX}
      AND employment_diversity_hhi IS NOT NULL AND employment_diversity_hhi <= 0.20
''').df()

mortgage = con.execute('''
    SELECT EXTRACT(YEAR FROM observation_date)::INT AS year, value/100.0 AS mortgage_rate
    FROM main_staging.stg_fred_macro WHERE series_id = 'MORTGAGE30US'
    QUALIFY row_number() OVER (PARTITION BY EXTRACT(YEAR FROM observation_date) ORDER BY observation_date DESC)=1
''').df()
con.close()

uni = uni.merge(mortgage, on='year', how='left').merge(cap_2015, on='fips', how='left').merge(hpi_wide, on='fips', how='left')

# ── Backfill cap_rate for each cohort year ─────────────────────────────────
# cap_year = cap_2015 × (CPI_rent_year / CPI_rent_2015) / (HPI_year / HPI_2015)
CPI_2015 = cpi_rent_annual.get(2015)
def backfill_cap(row):
    yr = row['year']
    cap15 = row['cap_2015']
    hpi_yr = row.get(f'hpi_{yr}')
    hpi_15 = row.get('hpi_2015')
    cpi_yr = cpi_rent_annual.get(yr)
    if any(pd.isna(v) for v in [cap15, hpi_yr, hpi_15, cpi_yr]): return np.nan
    return cap15 * (cpi_yr / CPI_2015) / (hpi_yr / hpi_15)
uni['cap_rate_est'] = uni.apply(backfill_cap, axis=1)

# ── Compute rent growth 3yr forward (national CPI Rent proxy) ──────────────
def rent_growth_3yr(cohort_year):
    end = cpi_rent_annual.get(cohort_year + 3)
    start = cpi_rent_annual.get(cohort_year)
    if end is None or start is None: return np.nan
    return end / start - 1
uni['rent_growth_3yr'] = uni['year'].apply(rent_growth_3yr)

# ── State opex ratios ───────────────────────────────────────────────────────
STATE_OPEX = {'Ohio':0.57,'Michigan':0.57,'Pennsylvania':0.57,'Illinois':0.57,'Wisconsin':0.57,'New York':0.57,'New Jersey':0.57,'Connecticut':0.57,'Missouri':0.52,'Massachusetts':0.52,'Maryland':0.52,'California':0.47,'Iowa':0.47,'Minnesota':0.47,'Florida':0.47,'Indiana':0.47,'Texas':0.44,'Virginia':0.44,'Colorado':0.44,'Washington':0.44,'Kansas':0.44,'Kentucky':0.44,'Georgia':0.42,'North Carolina':0.42,'South Carolina':0.42,'Tennessee':0.42,'Oklahoma':0.42,'Utah':0.42,'Idaho':0.42,'Arizona':0.40,'Nevada':0.40,'Alabama':0.40,'Mississippi':0.40,'Arkansas':0.40}
uni['opex_ratio'] = uni['state_name'].map(STATE_OPEX).fillna(0.45)

# ── Full return: cash flow + HPI appreciation ──────────────────────────────
uni['cash_flow_3yr']  = 3 * uni['cap_rate_est'] * (1 - uni['opex_ratio']) * (1 + uni['rent_growth_3yr']/2)
uni['appreciation_3yr'] = uni['hpi_forward_return_36mo']
uni['total_return_3yr']  = uni['cash_flow_3yr'] + uni['appreciation_3yr']
uni['debt_service_3yr']  = 3 * LTV * uni['mortgage_rate']
uni['levered_ROE_3yr']   = (uni['cash_flow_3yr'] - uni['debt_service_3yr'] + uni['appreciation_3yr']) / (1 - LTV)

# ── Strategy: reduced-feature (same as prior recession backtest) ──────────
W_RECESSION = {
    'wage_growth_yoy':           0.8,
    'renter_ind_emp_yoy':        0.5,
    'emp_growth_yoy':            0.5,
    'unemployment_rate_yoy_chg': -0.5,
    'mf_permit_ratio_change_3yr':-0.3,
}
GATES = {
    'max_unemp_pct':   6.0,
    'min_wage_growth': 0.02,
    'max_sector_share':0.25,
    'max_hhi':         0.15,
    'require_no_disq': True,
}

def pick_for_year(year, weights=W_RECESSION, gates=GATES):
    c = uni[uni['year']==year].copy()
    if c.empty: return pd.DataFrame()
    c = c[c['unemployment_rate'].isna()       | (c['unemployment_rate']       <= gates['max_unemp_pct'])]
    c = c[c['wage_growth_yoy'].isna()         | (c['wage_growth_yoy']         >= gates['min_wage_growth'])]
    c = c[c['max_supersector_share'].isna()   | (c['max_supersector_share']   <= gates['max_sector_share'])]
    c = c[c['employment_diversity_hhi'].isna()| (c['employment_diversity_hhi']<= gates['max_hhi'])]
    if gates['require_no_disq']:
        c = c[(c['any_disqualifier']==False) | (c['any_disqualifier'].isna())]
    if c.empty: return pd.DataFrame()
    c['score'] = 0.0
    for col, w in weights.items():
        if col in c.columns and c[col].notna().any():
            mu, sig = c[col].mean(), c[col].std()
            if sig > 0:
                z = (c[col] - mu) / sig
                c['score'] = c['score'] + w * z.fillna(0)
    c = c.sort_values('score', ascending=False)
    picked, sc = [], {}
    for _, r in c.iterrows():
        if sc.get(r['state_name'], 0) >= MAX_PER_STATE: continue
        picked.append(r); sc[r['state_name']] = sc.get(r['state_name'], 0) + 1
        if len(picked) >= TOP_N: break
    return pd.DataFrame(picked) if picked else pd.DataFrame()

# ── Recession backtest — WITH cash flow this time ─────────────────────────
print()
print('='*140)
print('RECESSION BACKTEST 2007-2013 — WITH CASH FLOW (estimated from CPI Rent + HPI)')
print('='*140)
print()
print(f'Assumptions:')
print(f'  - cap_rate_year = cap_2015 × (CPI_rent_year/CPI_rent_2015) / (HPI_year/HPI_2015)')
print(f'  - Rent growth 3yr = national CPI Rent {chr(0x394)} (rough — same for all counties)')
print(f'  - opex by state, mortgage rate from FRED per year')
print()
print(f'{"year":<6}{"n":<4}{"pick_TR_mean":>15}{"pick_HPI_only":>15}{"pick_CF_add":>14}{"below_avg":>12}{"underwater":>12}')
print('-'*90)

for yr in [2007, 2008, 2009, 2010, 2011, 2012, 2013]:
    picks = pick_for_year(yr)
    if picks.empty:
        print(f'{yr:<6}(no picks)')
        continue
    yr_uni = uni[uni['year']==yr].dropna(subset=['total_return_3yr'])
    if yr_uni.empty:
        print(f'{yr:<6}(no observable universe)')
        continue
    uni_mean_tr = yr_uni['total_return_3yr'].mean() * 100

    obs = picks.dropna(subset=['total_return_3yr']).copy()
    if obs.empty: continue
    obs['tr_pct']   = obs['total_return_3yr'] * 100
    obs['hpi_pct']  = obs['appreciation_3yr'] * 100
    obs['cf_pct']   = obs['cash_flow_3yr'] * 100
    obs['edge']     = obs['tr_pct'] - uni_mean_tr

    below = int((obs['edge'] < -2).sum())
    under = int((obs['tr_pct'] < 0).sum())
    print(f'{yr:<6}{len(obs):<4}{obs["tr_pct"].mean():>+14.2f}%{obs["hpi_pct"].mean():>+14.2f}%{obs["cf_pct"].mean():>+13.2f}%{below:>12}{under:>12}')

# Detailed 2007 & 2008 picks
print()
print('='*140)
print('2007-2008 PICKS — full breakdown with cash flow')
print('='*140)
for yr in [2007, 2008, 2009]:
    picks = pick_for_year(yr)
    if picks.empty: continue
    print(f'\n── {yr} PICKS ──   (rent growth 3yr: {cpi_rent_annual.get(yr+3, 0)/cpi_rent_annual.get(yr, 1)*100 - 100:+.2f}% national)')
    obs = picks.dropna(subset=['total_return_3yr']).copy()
    if obs.empty:
        print('  (no observable picks)')
        continue
    obs['tr']     = obs['total_return_3yr'] * 100
    obs['hpi']    = obs['appreciation_3yr'] * 100
    obs['cf']     = obs['cash_flow_3yr'] * 100
    obs['roe']    = obs['levered_ROE_3yr'] * 100
    print(f'  {"#":<3}{"market":<32}{"cap_est":<10}{"CF_3yr":<10}{"HPI_3yr":<10}{"TOTAL_TR":<12}{"LevROE_70LTV":<15}{"underwater?"}')
    for i, r in obs.reset_index(drop=True).iterrows():
        name = f"{r['county_name'].replace(' County','')}, {r['state_name']}"
        under = '💧 LOST MONEY' if r['tr'] < 0 else ('     positive' if r['tr'] > 0 else '')
        cap = f'{r["cap_rate_est"]*100:.2f}%'
        print(f'  {i+1:<3}{name:<32}{cap:<10}{r["cf"]:>+7.2f}%  {r["hpi"]:>+7.2f}%  {r["tr"]:>+9.2f}%  {r["roe"]:>+12.2f}%  {under}')

# Aggregate
print()
print('='*140)
print('AGGREGATE — RECESSION-ERA (2007-2010) vs HPI-ONLY previous view')
print('='*140)
recession_stats = []
for yr in [2007, 2008, 2009, 2010]:
    picks = pick_for_year(yr)
    if picks.empty: continue
    yr_uni = uni[uni['year']==yr].dropna(subset=['total_return_3yr','hpi_forward_return_36mo'])
    if yr_uni.empty: continue
    uni_mean = yr_uni['total_return_3yr'].mean() * 100
    obs = picks.dropna(subset=['total_return_3yr']).copy()
    if obs.empty: continue
    obs['tr_pct'] = obs['total_return_3yr'] * 100
    obs['hpi_pct'] = obs['appreciation_3yr'] * 100
    recession_stats.append({
        'year':yr, 'n':len(obs),
        'mean_TR':obs['tr_pct'].mean(),
        'mean_HPI':obs['hpi_pct'].mean(),
        'cf_boost':obs['tr_pct'].mean() - obs['hpi_pct'].mean(),
        'below_avg':int((obs['tr_pct'] - uni_mean < -2).sum()),
        'underwater_TR':int((obs['tr_pct'] < 0).sum()),
        'underwater_HPI':int((obs['hpi_pct'] < 0).sum()),
    })
if recession_stats:
    n = sum(x['n'] for x in recession_stats)
    print(f'\n  Total observable recession-era picks: {n}')
    print(f'  Mean total return (with cash flow): {sum(x["mean_TR"]*x["n"] for x in recession_stats)/n:+.2f}%')
    print(f'  Mean HPI (appreciation only):       {sum(x["mean_HPI"]*x["n"] for x in recession_stats)/n:+.2f}%')
    print(f'  Cash flow boost:                    {sum(x["cf_boost"]*x["n"] for x in recession_stats)/n:+.2f}pp')
    print(f'  Underwater on total return:         {sum(x["underwater_TR"] for x in recession_stats)}/{n}')
    print(f'  Underwater on HPI only:             {sum(x["underwater_HPI"] for x in recession_stats)}/{n}')
    print(f'  → Cash flow saved {sum(x["underwater_HPI"] for x in recession_stats) - sum(x["underwater_TR"] for x in recession_stats)} picks from underwater status')
