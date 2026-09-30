"""Apply employer concentration gate to 100K-500K EMERGING-VALUE and see which 2025 picks flip.

Signal: max_size_ratio = max across supersectors of (county_avg_estab_size / national_avg_estab_size).
Excludes sector '99' (unclassified). Higher = more employer-concentrated.

Tests gate thresholds ≤3.0, ≤3.5, ≤4.0 to see effect on picks.
Also annotates all current 2025 picks with their max_size_ratio.
"""
from __future__ import annotations
import duckdb, numpy as np, pandas as pd
import sys
from pathlib import Path

NB_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(NB_DIR))

WAREHOUSE = '/Users/premputtegowda/reps/reps-tracker/emerging_re/data/warehouse/emerging_re.duckdb'
POP_MIN, POP_MAX = 100_000, 500_000
HHI_MAX = 0.20
TOP_N = 10
MAX_PER_STATE = 3
LTV = 0.70

from _generate_strategy_notebooks import DATA_LOAD_CELL

ns = {'duckdb': duckdb, 'np': np, 'pd': pd, 'WAREHOUSE': WAREHOUSE,
      'POP_MIN': POP_MIN, 'POP_MAX': POP_MAX, 'HHI_MAX': HHI_MAX,
      'TOP_N': TOP_N, 'MAX_PER_STATE': MAX_PER_STATE, 'LTV': LTV}
exec(DATA_LOAD_CELL, ns)
uni = ns['uni']
pop_yoy_cache = ns['pop_yoy_cache']

# ─── Compute employer concentration per (county, year) ──────────────────
con = duckdb.connect(WAREHOUSE, read_only=True)
emp_conc = con.execute("""
    WITH dedup AS (
        SELECT fips, period_end_date, industry_code, annual_avg_emplvl, annual_avg_estabs
        FROM main_staging.stg_bls_qcew
        WHERE agglvl_code = 74 AND own_code = 5
          AND industry_code NOT IN ('10', '99')  -- exclude 'all industries' + 'unclassified'
        QUALIFY row_number() OVER (PARTITION BY fips, period_end_date, industry_code ORDER BY as_of_date DESC) = 1
    ),
    county_sector AS (
        SELECT fips, EXTRACT(YEAR FROM period_end_date)::INT AS year, industry_code AS sector,
               SUM(annual_avg_emplvl)::DOUBLE AS emp,
               SUM(annual_avg_estabs)::DOUBLE AS estabs
        FROM dedup GROUP BY fips, EXTRACT(YEAR FROM period_end_date), industry_code
    ),
    national_sector AS (
        SELECT year, sector,
               SUM(emp) / NULLIF(SUM(estabs), 0) AS natl_avg_size
        FROM county_sector GROUP BY year, sector
    ),
    ratios AS (
        SELECT cs.fips, cs.year, cs.sector,
               cs.emp / NULLIF(cs.estabs, 0) AS county_avg_size,
               ns.natl_avg_size,
               (cs.emp / NULLIF(cs.estabs, 0)) / NULLIF(ns.natl_avg_size, 0) AS size_ratio
        FROM county_sector cs JOIN national_sector ns USING (year, sector)
        WHERE cs.estabs >= 5
    ),
    ranked AS (
        SELECT fips, year, sector, size_ratio,
               row_number() OVER (PARTITION BY fips, year ORDER BY size_ratio DESC NULLS LAST) AS rn
        FROM ratios
    )
    SELECT fips, year, size_ratio AS max_size_ratio, sector AS top_sector
    FROM ranked WHERE rn = 1
""").df()
con.close()
print(f'Loaded employer concentration signal: {len(emp_conc):,} county-years')

# Merge into universe
uni = uni.merge(emp_conc, on=['fips','year'], how='left')

# ─── EMERGING-VALUE picker with optional employer concentration gate ─────
EMERGING_VALUE_GATES = {
    'min_pop_yoy_pct':      0.0,
    'max_permit_ratio':     1.5,
    'max_unemp_pct':        6.0,
    'min_wage_growth':      0.02,
    'max_sector_share':     0.25,
    'min_cap_spread_pp':    0.0,
    'max_hhi_strategy':     0.15,
    'require_no_disq':      True,
}

OPPORTUNITY_WEIGHTS = {
    'cap_spread_to_gateway_pp':          1.5,
    'cap_rate_proxy':                    1.5,
    'wage_growth_yoy':                   0.8,
    'pop_yoy_pct':                       0.5,
    'business_apps_per_1000':            0.5,
    'permits_per_new_job':              -1.0,
    'recession_resilience_score':        0.5,
    'knowledge_emp_growth_vs_state_pp':  0.5,
    'rent_growth_vs_wage_growth':        0.7,
}


def pick_for_year(year, max_emp_conc=None):
    c = uni[uni['year'] == year].dropna(subset=['cap_rate_proxy']).copy()
    if c.empty: return pd.DataFrame()
    pop_yr = pop_yoy_cache.get(year, pd.DataFrame())
    if not pop_yr.empty:
        c = c.merge(pop_yr[['fips','pop_yoy_pct']], on='fips', how='left')
    else:
        c['pop_yoy_pct'] = np.nan

    g = EMERGING_VALUE_GATES
    c = c[c['pop_yoy_pct'].isna()             | (c['pop_yoy_pct']             >= g['min_pop_yoy_pct'])]
    c = c[c['permits_intensity_ratio'].isna() | (c['permits_intensity_ratio'] <  g['max_permit_ratio'])]
    c = c[c['unemployment_rate'].isna()       | (c['unemployment_rate']       <= g['max_unemp_pct'])]
    c = c[c['wage_growth_yoy'].isna()         | (c['wage_growth_yoy']         >= g['min_wage_growth'])]
    c = c[c['max_supersector_share'].isna()   | (c['max_supersector_share']   <= g['max_sector_share'])]
    c = c[c['cap_spread_to_gateway_pp'].isna()| (c['cap_spread_to_gateway_pp']>= g['min_cap_spread_pp'])]
    c = c[c['employment_diversity_hhi'].isna()| (c['employment_diversity_hhi']<= g['max_hhi_strategy'])]
    if g['require_no_disq']:
        c = c[(c['any_disqualifier'] == False) | (c['any_disqualifier'].isna())]

    if max_emp_conc is not None:
        c = c[c['max_size_ratio'].isna() | (c['max_size_ratio'] <= max_emp_conc)]

    if len(c) > 0:
        cap_median = c['cap_rate_proxy'].median()
        c = c[c['cap_rate_proxy'] >= cap_median]
    if c.empty: return c

    c = c.copy()
    if 'business_apps_per_1000' in c.columns:
        c['business_apps_per_1000'] = c['business_apps_per_1000'].clip(upper=40)

    c['score'] = 0.0
    for sig, w in OPPORTUNITY_WEIGHTS.items():
        if sig not in c.columns: continue
        if c[sig].notna().sum() < 3: continue
        mu, sd = c[sig].mean(), c[sig].std()
        if sd == 0 or pd.isna(sd): continue
        z = ((c[sig] - mu) / sd).fillna(0)
        c['score'] = c['score'] + w * z
    c = c.sort_values('score', ascending=False)

    picked, sc = [], {}
    for _, r in c.iterrows():
        if sc.get(r['state_name'], 0) >= MAX_PER_STATE: continue
        picked.append(r); sc[r['state_name']] = sc.get(r['state_name'], 0) + 1
        if len(picked) >= TOP_N: break
    return pd.DataFrame(picked)


def _nm(r): return f"{r['county_name'].replace(' County','')}, {r['state_name']}"

# ─── 2025 picks — annotate current picks with employer concentration ─────
print()
print('=' * 130)
print('2025 EMERGING-VALUE (100K-500K) — current picks annotated with employer concentration signal')
print('=' * 130)
current = pick_for_year(2025)
print(f'  {"rk":<4} {"county":<32} {"cap":>6} {"max_size_ratio":>16} {"top_sector":>12}   interpretation')
print('  ' + '-' * 125)
for i, r in current.reset_index(drop=True).iterrows():
    ratio = r.get('max_size_ratio')
    top_sec = r.get('top_sector', '?')
    if pd.isna(ratio):
        interp = 'no data'
    elif ratio < 2.0:  interp = 'diverse employers'
    elif ratio < 3.0:  interp = 'normal urban mix'
    elif ratio < 4.0:  interp = 'moderate concentration'
    elif ratio < 6.0:  interp = 'notable concentration'
    else:              interp = 'DOMINANT EMPLOYER'
    r_str = f'{ratio:.2f}' if pd.notna(ratio) else 'n/a'
    print(f'  #{i+1:<3} {_nm(r):<32} {r["cap_rate_proxy"]*100:>5.2f}% {r_str:>16} {top_sec:>12}   {interp}')

# Sector reference
print()
print('Sector codes: 11=Ag, 21=Mining, 22=Utilities, 23=Construction, 31-33=Manufacturing, 42=Wholesale, ')
print('              44-45=Retail, 48-49=Trans/Warehousing, 51=Info, 52=Finance, 53=Real Estate,')
print('              54=Prof Services, 55=Management, 56=Admin/Waste, 61=Education, 62=Health,')
print('              71=Arts/Entertainment, 72=Accommodation/Food, 81=Other Services')

# ─── Compare picks across gate thresholds ─────────────────────────────
print()
print('=' * 130)
print('2025 picks under different employer concentration thresholds')
print('=' * 130)
print(f'  {"rk":<3}  {"NO GATE":<34}  |  {"≤4.0":<34}  |  {"≤3.5":<34}  |  {"≤3.0":<34}')
print('  ' + '-' * 152)
base = pick_for_year(2025)
gate40 = pick_for_year(2025, max_emp_conc=4.0)
gate35 = pick_for_year(2025, max_emp_conc=3.5)
gate30 = pick_for_year(2025, max_emp_conc=3.0)

for i in range(TOP_N):
    def _cell(df, i):
        if i >= len(df): return ' ' * 34
        r = df.iloc[i]
        return f'{_nm(r):<24} ({r.get("max_size_ratio", float("nan")):.2f})'.ljust(34) if pd.notna(r.get('max_size_ratio')) else f'{_nm(r):<24} (n/a)'.ljust(34)
    print(f'  #{i+1:<2}  {_cell(base,i)}  |  {_cell(gate40,i)}  |  {_cell(gate35,i)}  |  {_cell(gate30,i)}')

# ─── Backtest: does the gate help or hurt 2015-2022 returns? ─────────────
print()
print('=' * 130)
print('BACKTEST 2015-2022 — mean 3yr TR by gate threshold')
print('=' * 130)
print(f'  {"year":<6} {"no_gate":>10} {"≤4.0":>10} {"≤3.5":>10} {"≤3.0":>10}')
print('  ' + '-' * 50)

results = []
for yr in range(2015, 2023):
    row = {'year': yr}
    for label, thr in [('no_gate', None), ('≤4.0', 4.0), ('≤3.5', 3.5), ('≤3.0', 3.0)]:
        picks = pick_for_year(yr, max_emp_conc=thr)
        if picks.empty:
            row[label] = float('nan')
            continue
        obs = picks.dropna(subset=['total_return_3yr'])
        row[label] = obs['total_return_3yr'].mean() * 100 if not obs.empty else float('nan')
    results.append(row)
    print(f'  {yr:<6} {row["no_gate"]:>+9.2f}% {row["≤4.0"]:>+9.2f}% {row["≤3.5"]:>+9.2f}% {row["≤3.0"]:>+9.2f}%')

df = pd.DataFrame(results).dropna()
print()
print(f'  Averages across {len(df)} observable cohorts:')
for col in ['no_gate','≤4.0','≤3.5','≤3.0']:
    mean = df[col].mean()
    delta = mean - df['no_gate'].mean()
    print(f'    {col:<10}  {mean:+.2f}%    delta vs no-gate: {delta:+.2f}pp')
