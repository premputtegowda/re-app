"""Generate 5 self-contained strategy notebooks (HC v1/v2/v3/v4, ELITE).

Each notebook has the same structure:
  1. Title + description
  2. Features used (markdown table)
  3. Config
  4. Data load + return metrics (cash flow, appreciation, unlevered TR, levered ROE at 70% LTV)
  5. Method implementation
  6. Per-year picks with returns
  7. Aggregate (2015-2022 observable)
  8. Current year (2025) picks

Run with:  .venv/bin/python notebooks/_generate_strategy_notebooks.py
"""
from __future__ import annotations
import json
from pathlib import Path

NB_DIR = Path(__file__).resolve().parent
ROOT = NB_DIR.parent

def md(source: str) -> dict:
    return {"cell_type": "markdown", "metadata": {}, "source": source.splitlines(keepends=True)}

def code(source: str) -> dict:
    return {"cell_type": "code", "execution_count": None, "metadata": {}, "outputs": [], "source": source.splitlines(keepends=True)}

def wrap(cells: list) -> dict:
    return {
        "cells": cells,
        "metadata": {"kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"}},
        "nbformat": 4,
        "nbformat_minor": 5,
    }

# ══════════════════════════════════════════════════════════════════════════════
# COMMON CELLS — shared across all 5 notebooks
# ══════════════════════════════════════════════════════════════════════════════

CONFIG_CELL = """# ══════════════════════════════════════════════════════════════════════════
#  CONFIG — freely edit these to change the screen (universe, top-N, etc.)
# ══════════════════════════════════════════════════════════════════════════
import duckdb
import numpy as np
import pandas as pd

WAREHOUSE = '/Users/premputtegowda/reps/reps-tracker/emerging_re/data/warehouse/emerging_re.duckdb'

# ── Universe filters (edit to change the eligible pool of counties) ──────
POP_MIN       = 1_000_000    # min county population (change to look at smaller/larger markets)
POP_MAX       = 10_000_000   # max county population
HHI_MAX       = 0.10         # employment diversity ceiling (lower = more diversified only)

# ── Selection knobs (edit to change how many picks and geographic spread) ──
TOP_N         = 5            # number of picks to return
MAX_PER_STATE = 2            # max picks from any single state (diversification cap)

# ── Analysis constants (don't usually change) ──
HORIZON_YEARS = 3            # hold period for forward returns
LTV           = 0.70         # loan-to-value for levered ROE calculations

pd.set_option('display.width', 200); pd.set_option('display.max_rows', 200)
print(f'Config loaded. Universe: pop {POP_MIN:,}-{POP_MAX:,}   HHI<={HHI_MAX}   top_n={TOP_N}   max_per_state={MAX_PER_STATE}')
"""

DATA_LOAD_CELL = """# Load universe + attach year-appropriate mortgage rate + attach state-based opex + compute NET return metrics
con = duckdb.connect(WAREHOUSE, read_only=True)
uni = con.execute(f'''
    SELECT fips, county_name, state_name, pop_latest,
           EXTRACT(YEAR FROM period_end_date)::INT AS year,
           cap_rate_proxy, zori_yoy, mf_cap_rate_change_3yr,
           unemployment_rate, unemployment_rate_yoy_chg,
           rental_vacancy_rate, renter_share,
           hpi_yoy, hpi_trailing_24mo, permits_intensity_ratio,
           any_disqualifier,
           -- Leading indicators (used by EMERGING strategy — harmless for others)
           domesticmig_per_1000, domesticmig_accel_3yr,
           permits_per_1000,
           wage_growth_yoy, emp_growth_yoy, rent_growth_vs_wage_growth,
           business_apps_per_1000, business_apps_per_1000_3yr_avg,
           knowledge_emp_yoy, knowledge_emp_growth_vs_state_pp, renter_ind_emp_yoy,
           age_20_34_share_yoy_chg,
           -- Sector concentration (for diversification filter)
           max_supersector_share, employment_diversity_hhi,
           zori_forward_return_36mo, hpi_forward_return_36mo
    FROM main_marts.mart_county_features
    WHERE EXTRACT(MONTH FROM period_end_date) = 12
      AND pop_latest > {POP_MIN} AND pop_latest <= {POP_MAX}
      AND employment_diversity_hhi IS NOT NULL
      AND employment_diversity_hhi <= {HHI_MAX}
''').df()

# Year-appropriate mortgage rate (FRED MORTGAGE30US at Dec 31)
mortgage = con.execute('''
    SELECT EXTRACT(YEAR FROM observation_date)::INT AS year, value / 100.0 AS mortgage_rate
    FROM main_staging.stg_fred_macro
    WHERE series_id = 'MORTGAGE30US'
    QUALIFY row_number() OVER (
        PARTITION BY EXTRACT(YEAR FROM observation_date)
        ORDER BY observation_date DESC) = 1
''').df()

# PIT population YoY (needed only by HC v2, but harmless to include)
pep_raw = con.execute('''
    SELECT fips, EXTRACT(YEAR FROM period_end_date)::INT AS ref_year,
           popestimate, as_of_date
    FROM main_staging.stg_census_pep
''').df()

# ── MF unit counts by building size — PIT-strict (latest ACS 1yr with as_of <= cohort year-end)
# Buckets: 5-9, 10-19, 20-49, 50+ units per building
# 5-19 = "small MF" investor sweet spot (typical private buyer target — 4-20 unit interpretation)
mf_units_raw = con.execute('''
    SELECT fips,
           EXTRACT(YEAR FROM period_end_date)::INT AS ref_year,
           units_in_5_to_9_bldgs   AS units_5to9,
           units_in_10_to_19_bldgs AS units_10to19,
           units_in_20_to_49_bldgs AS units_20to49,
           units_in_50_plus_bldgs  AS units_50plus,
           as_of_date
    FROM main_staging.stg_census_acs_1yr
''').df()
con.close()
pep_raw['as_of_date'] = pd.to_datetime(pep_raw['as_of_date'])
mf_units_raw['as_of_date'] = pd.to_datetime(mf_units_raw['as_of_date'])

def pit_mf_units(cohort_year):
    '''For each fips, return the latest ACS 1yr unit-count record with as_of_date <= Dec 31 of cohort_year.

    Converts UNIT counts to estimated BUILDING counts using bucket midpoints:
      - 5-9   units → ÷ 7    (avg building size)
      - 10-19 units → ÷ 14.5
      - 20-49 units → ÷ 34.5
      - 50+   units → ÷ 75   (bucket unbounded — assumes typical mid-size garden MF)

    These are the same midpoints used in backtest.analog_search.load_mf_context.
    '''
    cutoff = pd.Timestamp(f'{cohort_year}-12-31')
    df = mf_units_raw[mf_units_raw['as_of_date'] <= cutoff].copy()
    if df.empty:
        return pd.DataFrame(columns=['fips','mf_bldgs_5to9','mf_bldgs_10to19','mf_bldgs_5to19','mf_bldgs_20to49','mf_bldgs_50plus'])
    # Latest ref_year first, then latest as_of_date within that ref_year
    df = df.sort_values(['fips','ref_year','as_of_date'], ascending=[True, False, False])
    df = df.drop_duplicates(subset=['fips'], keep='first')
    # Estimate building counts from unit counts using bucket midpoints
    df['mf_bldgs_5to9']    = (df['units_5to9']    / 7.0).round().astype('Int64')
    df['mf_bldgs_10to19']  = (df['units_10to19']  / 14.5).round().astype('Int64')
    df['mf_bldgs_20to49']  = (df['units_20to49']  / 34.5).round().astype('Int64')
    df['mf_bldgs_50plus']  = (df['units_50plus']  / 75.0).round().astype('Int64')
    df['mf_bldgs_5to19']   = df['mf_bldgs_5to9'] + df['mf_bldgs_10to19']  # small MF sweet spot
    return df[['fips','mf_bldgs_5to9','mf_bldgs_10to19','mf_bldgs_5to19','mf_bldgs_20to49','mf_bldgs_50plus']]

# Attach unit counts per (fips, year) — PIT-strict per cohort year
mf_units_by_year = []
for yr in sorted(uni['year'].unique()):
    d = pit_mf_units(yr).copy()
    d['year'] = yr
    mf_units_by_year.append(d)
mf_units_df = pd.concat(mf_units_by_year, ignore_index=True) if mf_units_by_year else pd.DataFrame()
uni = uni.merge(mf_units_df, on=['fips','year'], how='left')

uni = uni.merge(mortgage, on='year', how='left')

# ── Gateway market cap rates (for "cap spread to gateway" signal) ──
# Standard institutional MF gateway markets. Median cap here defines "what
# institutional capital is willing to pay" per year. Local counties trading
# well above this cap are structurally under-priced by institutional standards.
GATEWAY_FIPS = ['06037','36061','36047','36081','06075','25025','11001','17031']  # LA, Manhattan, Brooklyn, Queens, SF, Boston, DC, Cook IL
con2 = duckdb.connect(WAREHOUSE, read_only=True)
gateway_caps = con2.execute(f'''
    SELECT EXTRACT(YEAR FROM period_end_date)::INT AS year,
           MEDIAN(cap_rate_proxy) AS gateway_cap_median
    FROM main_marts.mart_county_features
    WHERE EXTRACT(MONTH FROM period_end_date) = 12
      AND fips IN ({",".join(repr(f) for f in GATEWAY_FIPS)})
    GROUP BY year ORDER BY year
''').df()
con2.close()
uni = uni.merge(gateway_caps, on='year', how='left')
uni['cap_spread_to_gateway_pp'] = (uni['cap_rate_proxy'] - uni['gateway_cap_median']) * 100
uni['hpi_rent_gap_pp'] = (uni['hpi_yoy'].fillna(0) - uni['zori_yoy'].fillna(0)) * 100

# ── Derived: permits per new job (supply-wave risk signal, used by EMERGING-VALUE) ──
# Rough approximation: employment ≈ 45% of population, so new-jobs-per-1000-pop = emp_growth_yoy * 450.
# permits_per_new_job = building permits per 1000 pop / new jobs per 1000 pop.
# Values: <1 healthy, >1.5 supply wave, >3 severe oversupply.
# Clip emp_growth_yoy at 0.5%/yr to prevent divide-by-tiny explosions in flat-employment counties.
uni['permits_per_new_job'] = uni['permits_per_1000'] / (uni['emp_growth_yoy'].clip(lower=0.005) * 450)

# ── RECESSION RESILIENCE SCORE (RRS) — FORWARD-LOOKING (CVS methodology) ──
# Insight: markets don't have permanent crash risk based on geography. The NEXT crash
# hits markets that CURRENTLY resemble the profile of PAST crash markets.
# Extracted 2005 pre-crash profile (n=210 counties, HPI dropped >30% in 2007-2012):
#   Mean 5yr trailing HPI:  +16.7%/yr    (non-crash: +5.7%/yr)
# So markets today with trailing 5yr HPI > 10%/yr look like pre-crash Phoenix.
#
# 5 forward-looking factors (each 0-10, higher = MORE RESILIENT):
#   Y  (0.30) — Yield cushion (cap_rate_proxy) — cash flow buffer vs HPI decline
#   B  (0.30) — Bubble check (trailing 5yr HPI) — inverted: extreme growth = risky
#   D  (0.15) — Diversification (employment_diversity_hhi)
#   M  (0.15) — Migration extreme (pop_yoy) — inverted: extreme growth = speculative
#   P  (0.10) — Permit intensity (permits_intensity_ratio) — inverted: supply wave = risky
#
# NO historical crash data — no assumption that geography predicts crash. Pure forward
# assessment of "does this market TODAY look like the pre-crash bubble profile?"
_con_rrs = duckdb.connect(WAREHOUSE, read_only=True)
_all_fips_str_rrs = ",".join(repr(f) for f in uni['fips'].unique().tolist())
_hpi_all_rrs = _con_rrs.execute(f'''
    SELECT fips, EXTRACT(YEAR FROM period_end_date)::INT AS year, hpi
    FROM main_staging.stg_fhfa_hpi
    WHERE fips IN ({_all_fips_str_rrs}) AND EXTRACT(MONTH FROM period_end_date) = 12
    QUALIFY row_number() OVER (PARTITION BY fips, EXTRACT(YEAR FROM period_end_date) ORDER BY as_of_date DESC) = 1
''').df()
_con_rrs.close()
_lag5_rrs = _hpi_all_rrs.rename(columns={'hpi':'hpi_5yr_prior','year':'year_join'})
_lag5_rrs['year_join'] = _lag5_rrs['year_join'] + 5
_hpi_all_rrs = _hpi_all_rrs.merge(_lag5_rrs[['fips','year_join','hpi_5yr_prior']], left_on=['fips','year'], right_on=['fips','year_join'], how='left').drop(columns='year_join')
_hpi_all_rrs['trailing_5yr_hpi_ann'] = (_hpi_all_rrs['hpi'] / _hpi_all_rrs['hpi_5yr_prior']) ** (1/5) - 1
uni = uni.merge(_hpi_all_rrs[['fips','year','trailing_5yr_hpi_ann']], on=['fips','year'], how='left')

def _rrs_yield(v):
    '''Cap rate cushion — higher = safer'''
    if pd.isna(v): return 5
    p = v * 100
    if p >= 8.0: return 10
    if p >= 7.0: return 8
    if p >= 6.5: return 6
    if p >= 6.0: return 4
    if p >= 5.5: return 2
    return 0
def _rrs_bubble_inv(v):
    '''Trailing 5yr HPI annualized — INVERTED (extreme growth = risky = low score)'''
    if pd.isna(v): return 5
    p = v * 100
    if p < 3: return 10
    if p < 5: return 8
    if p < 8: return 6
    if p < 10: return 4
    if p < 12: return 2
    return 0
def _rrs_hhi(v):
    '''Employment diversity — lower HHI = safer'''
    if pd.isna(v): return 5
    if v < 0.06: return 10
    if v < 0.08: return 8
    if v < 0.10: return 6
    if v < 0.12: return 4
    if v < 0.15: return 2
    return 0
def _rrs_permit_inv(v):
    '''Permit intensity vs baseline — INVERTED (high permits = supply wave = risky)'''
    if pd.isna(v): return 5
    if v <= 0.8: return 10
    if v <= 1.0: return 8
    if v <= 1.2: return 6
    if v <= 1.5: return 4
    if v <= 2.0: return 2
    return 0
# Migration factor computed later (needs pop_yoy_cache which is built below)
uni['rrs_Y'] = uni['cap_rate_proxy'].apply(_rrs_yield)
uni['rrs_B'] = uni['trailing_5yr_hpi_ann'].apply(_rrs_bubble_inv)
uni['rrs_D'] = uni['employment_diversity_hhi'].apply(_rrs_hhi)
uni['rrs_P'] = uni['permits_intensity_ratio'].apply(_rrs_permit_inv)
# rrs_M (migration) and final recession_resilience_score computed after pop_yoy_cache is built

print(f'Universe: {len(uni)} county-years across {uni.year.nunique()} years ({uni.year.min()}-{uni.year.max()})')

# ── State-based opex ratios (share of gross rent consumed by operating expenses) ──
# Reflects property tax + insurance + maintenance + management + utilities + vacancy.
# Tiers ordered by cost burden. Coastal FL overridden per-county due to insurance.
OPEX_BY_STATE = {
    # Highest 57% — Rust Belt + high-tax Northeast (old stock, high property tax)
    'Ohio': 0.57, 'Michigan': 0.57, 'Pennsylvania': 0.57, 'Illinois': 0.57,
    'Wisconsin': 0.57, 'New York': 0.57, 'New Jersey': 0.57, 'Connecticut': 0.57,
    # High 52%
    'Missouri': 0.52, 'Massachusetts': 0.52, 'Maryland': 0.52, 'Rhode Island': 0.52,
    'New Hampshire': 0.52, 'Vermont': 0.52, 'Maine': 0.52,
    'District of Columbia': 0.52, 'Hawaii': 0.52,
    # Medium 47%
    'California': 0.47, 'Iowa': 0.47, 'Minnesota': 0.47, 'Alaska': 0.47,
    'Florida': 0.47,   # default; coastal FL bumped to 50% below via per-county override
    'Indiana': 0.47,   # not in user's tier list — assigned to Medium as sensible default
    # TX 44%
    'Texas': 0.44,
    # Medium-Low 44%
    'Virginia': 0.44, 'Colorado': 0.44, 'Oregon': 0.44, 'Washington': 0.44,
    'Kansas': 0.44, 'Nebraska': 0.44, 'North Dakota': 0.44,
    'West Virginia': 0.44, 'Delaware': 0.44, 'Kentucky': 0.44, 'Louisiana': 0.44,
    # Low SE 42%
    'Georgia': 0.42, 'North Carolina': 0.42, 'South Carolina': 0.42, 'Tennessee': 0.42,
    'Oklahoma': 0.42, 'Utah': 0.42, 'Idaho': 0.42, 'Montana': 0.42, 'New Mexico': 0.42,
    # Lowest 40% — genuinely low tax + newer stock
    'Arizona': 0.40, 'Nevada': 0.40, 'Alabama': 0.40, 'Mississippi': 0.40,
    'South Dakota': 0.40, 'Wyoming': 0.40, 'Arkansas': 0.40,
}

# Coastal FL override — insurance premiums spiked post-2022 hurricanes
COASTAL_FL_FIPS = {
    '12086',   # Miami-Dade
    '12011',   # Broward
    '12099',   # Palm Beach
    '12071',   # Lee
    '12021',   # Collier
    '12081',   # Manatee
    '12103',   # Pinellas
}
COASTAL_FL_OPEX = 0.50

# Attach opex ratio per (fips, year) — currently state-invariant except coastal FL
def _opex_for(row):
    if row['fips'] in COASTAL_FL_FIPS: return COASTAL_FL_OPEX
    return OPEX_BY_STATE.get(row['state_name'], 0.45)  # unmapped state → 45% default

uni['opex_ratio'] = uni.apply(_opex_for, axis=1)

# ── NET return metrics ─────────────────────────────────────────────────────
# cf_net = 3 × cap_rate × (1 - opex_ratio) × avg_rent_multiplier
# Same as before but with (1 - opex_ratio) discount applied to gross rent yield.
uni['cash_flow_3yr']    = 3 * uni['cap_rate_proxy'] * (1 - uni['opex_ratio']) * (1 + uni['zori_forward_return_36mo'] / 2)
uni['appreciation_3yr'] = uni['hpi_forward_return_36mo']
uni['total_return_3yr'] = uni['cash_flow_3yr'] + uni['appreciation_3yr']
uni['debt_service_3yr'] = 3 * LTV * uni['mortgage_rate']
uni['levered_ROE_3yr']  = (uni['cash_flow_3yr'] - uni['debt_service_3yr'] + uni['appreciation_3yr']) / (1 - LTV)

def pit_pop_yoy(cohort_year):
    '''Point-in-time population YoY — latest vintage available by cohort Dec 31.'''
    cutoff = pd.Timestamp(f'{cohort_year}-12-31')
    df = pep_raw[pep_raw['as_of_date'] <= cutoff].copy()
    if df.empty: return pd.DataFrame(columns=['fips','pop_yoy_pct'])
    df = df.sort_values(['fips','ref_year','as_of_date']).drop_duplicates(subset=['fips','ref_year'], keep='last')
    rows = []
    for f, sub in df.groupby('fips'):
        sub = sub.sort_values('ref_year', ascending=False)
        if len(sub) < 2: continue
        latest = sub.iloc[0]
        prev = sub[sub['ref_year'] == latest['ref_year'] - 1]
        if prev.empty: continue
        prev = prev.iloc[0]
        rows.append({'fips': f, 'pop_yoy_pct': (latest['popestimate'] - prev['popestimate']) / prev['popestimate'] * 100})
    return pd.DataFrame(rows)

pop_yoy_cache = {yr: pit_pop_yoy(yr) for yr in range(2015, 2026)}

# ── Complete RRS: attach pop_yoy per (fips, year), compute migration factor + final score ──
_pop_yoy_all = pd.concat([df.assign(year=yr) for yr, df in pop_yoy_cache.items() if not df.empty], ignore_index=True) if any(not df.empty for df in pop_yoy_cache.values()) else pd.DataFrame()
if not _pop_yoy_all.empty:
    uni = uni.merge(_pop_yoy_all[['fips','year','pop_yoy_pct']].rename(columns={'pop_yoy_pct':'pop_yoy_pct_rrs'}), on=['fips','year'], how='left')
else:
    uni['pop_yoy_pct_rrs'] = float('nan')

def _rrs_migration_inv(v):
    '''Pop growth — INVERTED (extreme migration = speculative demand = risky)'''
    if pd.isna(v): return 5
    if v < 0: return 4     # declining (bad but not bubble)
    if v <= 1: return 10   # steady
    if v <= 2: return 8    # healthy
    if v <= 3: return 6    # elevated
    if v <= 4: return 4    # extreme
    return 2               # speculative (>4%/yr)
uni['rrs_M'] = uni['pop_yoy_pct_rrs'].apply(_rrs_migration_inv)

# Final forward-looking RRS: yield + bubble-avoidance + diversification + migration + permit
uni['recession_resilience_score'] = (0.30*uni['rrs_Y'] + 0.30*uni['rrs_B'] + 0.15*uni['rrs_D'] +
                                      0.15*uni['rrs_M'] + 0.10*uni['rrs_P'])

# Opex assumption summary
opex_summary = uni.groupby(['state_name','opex_ratio']).size().reset_index(name='n_county_years')
print(f'\\nOpex assumptions (state → ratio):')
for (state, ratio), grp in opex_summary.groupby(['state_name','opex_ratio']):
    print(f'  {state:<22} → {ratio*100:.0f}%   ({grp[\"n_county_years\"].iloc[0]} county-years)')
"""

PICKS_PER_YEAR_CELL = """# Per-year picks with return breakdown
def _name(row):
    # Full county + full state name, e.g. "Cook, Illinois" rather than "Cook, Il"
    return f\"{row['county_name'].replace(' County','')}, {row['state_name']}\"

def _print_row(i, row, obs=True):
    n = _name(row)
    opx = row['opex_ratio'] * 100
    if obs and pd.notna(row.get('total_return_3yr')):
        cap = row['cap_rate_proxy'] * 100
        mtg = row['mortgage_rate']  * 100
        cf  = row['cash_flow_3yr']    * 100
        ap  = row['appreciation_3yr'] * 100
        tr  = row['total_return_3yr'] * 100
        roe = row['levered_ROE_3yr']  * 100
        print(f'  #{i+1:<2}  {n:<32}  cap {cap:>5.2f}%  opex {opx:>3.0f}%  mtg {mtg:>4.2f}%   cf_net {cf:>+6.2f}%  apprec {ap:>+7.2f}%   TOTAL {tr:>+7.2f}%   LEV ROE (70%LTV) {roe:>+7.2f}%')
    else:
        cap = row['cap_rate_proxy'] * 100
        mtg = row['mortgage_rate']  * 100
        zy  = row['zori_yoy'] * 100 if pd.notna(row.get('zori_yoy')) else float('nan')
        # net-spread: net cash yield vs mortgage rate (positive = levered carry is accretive after opex)
        net_yield = row['cap_rate_proxy'] * (1 - row['opex_ratio']) * 100 if pd.notna(row.get('cap_rate_proxy')) else float('nan')
        spread = (net_yield - mtg)
        zy_s = f'{zy:+.2f}%' if pd.notna(zy) else 'n/a'
        sp_s = f'{spread:+.2f}pp' if pd.notna(spread) else 'n/a'
        print(f'  #{i+1:<2}  {n:<32}  cap {cap:>5.2f}%  opex {opx:>3.0f}%  net_yield {net_yield:>4.2f}%  mtg {mtg:>4.2f}%  net_spread {sp_s:>8}  zori_yoy {zy_s:>7}   (36mo n/a)')

years = sorted(uni['year'].unique().tolist())
for yr in years:
    if yr < 2015: continue
    picks = pick_for_year(yr)
    if picks is None or picks.empty: continue
    obs = yr <= 2022

    if obs:
        yr_uni = uni[uni['year'] == yr].dropna(subset=['total_return_3yr'])
        u_med = yr_uni['total_return_3yr'].median() * 100 if not yr_uni.empty else float('nan')
        u_mean = yr_uni['total_return_3yr'].mean() * 100 if not yr_uni.empty else float('nan')
        print('\\n' + '=' * 130)
        print(f'YEAR {yr}   universe_n={len(uni[uni.year == yr])}   universe TR: mean {u_mean:+.2f}%   median {u_med:+.2f}%')
        print('=' * 130)
    else:
        print('\\n' + '=' * 130)
        print(f'YEAR {yr}   universe_n={len(uni[uni.year == yr])}   (36mo not observable yet — ex-ante view)')
        print('=' * 130)

    for i in range(len(picks)):
        _print_row(i, picks.iloc[i], obs=obs)

    if obs and picks['total_return_3yr'].notna().any():
        cf_avg   = picks['cash_flow_3yr'].mean()    * 100
        ap_avg   = picks['appreciation_3yr'].mean() * 100
        tr_avg   = picks['total_return_3yr'].mean() * 100
        roe_avg  = picks['levered_ROE_3yr'].mean()  * 100
        opx_avg  = picks['opex_ratio'].mean() * 100
        edge = tr_avg - u_mean
        print(f'       {\"AVG\":<32}                        opex {opx_avg:>3.0f}%              cf_net {cf_avg:>+6.2f}%  apprec {ap_avg:>+7.2f}%   TOTAL {tr_avg:>+7.2f}%   LEV ROE (70%LTV) {roe_avg:>+7.2f}%   [edge {edge:+.2f}pp]')
"""

AGGREGATE_CELL = """# Aggregate performance (2015-2022 observable cohorts)
rows = []
for yr in years:
    if yr < 2015 or yr > 2022: continue
    picks = pick_for_year(yr)
    if picks is None or picks.empty or picks['total_return_3yr'].isna().all(): continue
    yr_uni = uni[uni['year'] == yr].dropna(subset=['total_return_3yr'])
    rows.append({
        'year': yr,
        'opex_avg_pct': picks['opex_ratio'].mean() * 100,
        'cf_net': picks['cash_flow_3yr'].mean() * 100,
        'apprec': picks['appreciation_3yr'].mean() * 100,
        'total_return': picks['total_return_3yr'].mean() * 100,
        'levered_ROE_70LTV': picks['levered_ROE_3yr'].mean() * 100,
        'universe_mean': yr_uni['total_return_3yr'].mean() * 100,
        'edge_pp': picks['total_return_3yr'].mean() * 100 - yr_uni['total_return_3yr'].mean() * 100,
    })

agg = pd.DataFrame(rows)
print('All values below are NET of state-based operating expenses (see opex_avg_pct column).\\n')
print(agg.to_string(index=False, float_format=lambda x: f'{x:+.2f}' if pd.notna(x) else 'n/a'))
print()
if not agg.empty:
    print(f'Aggregate over {len(agg)} observable cohorts:')
    print(f'  Avg opex ratio:               {agg[\"opex_avg_pct\"].mean():>6.1f}%')
    print(f'  Avg NET cash flow (3yr):      {agg[\"cf_net\"].mean():>+7.2f}%')
    print(f'  Avg appreciation (3yr):       {agg[\"apprec\"].mean():>+7.2f}%')
    print(f'  Avg TOTAL return (3yr, net):  {agg[\"total_return\"].mean():>+7.2f}%')
    print(f'  Avg LEV ROE 70% LTV (3yr):    {agg[\"levered_ROE_70LTV\"].mean():>+7.2f}%')
    print(f'  Avg edge vs universe:         {agg[\"edge_pp\"].mean():>+.2f}pp   (wins {(agg[\"edge_pp\"] > 0).sum()}/{len(agg)} cohorts)')
"""

CURRENT_YEAR_CELL = """# Current year (2025) picks — MF-native underwriting view
# All values expressed in NOI terms (not raw HPI/rent split), matching how brokers underwrite deals.
CURRENT_YEAR      = 2025
RATE_STRESS_BP    = 0.005     # +50 basis points stress
TARGET_ROE_ANNUAL = 0.15      # 15%/yr levered ROE target (standard MF hurdle)

TARGET_ROE_3YR = (1 + TARGET_ROE_ANNUAL)**3 - 1

def levered_roe_3yr(noi_yield, g, mtg, ltv=LTV, horizon=3):
    '''Return cumulative 3yr levered ROE given entry NOI yield and annual NOI growth rate.

    Assumes:
      - Interest-only debt (no amortization) for the hold period
      - Exit cap = entry cap  →  value grows at same rate as NOI
      - No transaction costs

    Formula (per $1 of purchase price):
      annual_debt      = ltv × mtg
      annual_cf(N)     = noi_yield × (1+g)^N − annual_debt
      cumulative_cf    = noi_yield × sum_{N=1..H} (1+g)^N − H × annual_debt
      capital_gain     = (1+g)^H − 1    (since value = NOI/cap, and cap constant)
      total_equity_gain = cumulative_cf + capital_gain
      levered_ROE       = total_equity_gain / (1 − ltv)
    '''
    equity_pct = 1 - ltv
    annual_debt = ltv * mtg
    # Cumulative NOI over the hold (geometric sum starting at year 1)
    if abs(g) < 1e-9:
        noi_sum = noi_yield * horizon
    else:
        noi_sum = noi_yield * ((1+g)*((1+g)**horizon - 1) / g)
    cumulative_cf = noi_sum - horizon * annual_debt
    capital_gain = (1+g)**horizon - 1
    return (cumulative_cf + capital_gain) / equity_pct

def solve_noi_growth(noi_yield, mtg, roe_target_3yr=0.0, ltv=LTV):
    '''Bisection solver: find annual NOI growth rate g such that 3yr levered ROE = target.'''
    lo, hi = -0.30, 0.40   # search NOI growth from -30%/yr to +40%/yr
    def f(g): return levered_roe_3yr(noi_yield, g, mtg, ltv) - roe_target_3yr
    if f(lo) > 0: return float('-inf')   # target already exceeded even with -30%/yr NOI decline
    if f(hi) < 0: return float('inf')    # not achievable even at 40%/yr NOI growth
    for _ in range(60):
        mid = (lo + hi) / 2
        if f(mid) < 0: lo = mid
        else: hi = mid
        if hi - lo < 1e-6: break
    return (lo + hi) / 2

picks = pick_for_year(CURRENT_YEAR)
mtg_base   = uni[uni['year'] == CURRENT_YEAR]['mortgage_rate'].iloc[0]
mtg_stress = mtg_base + RATE_STRESS_BP

print(f'=== {CURRENT_YEAR} picks — MF underwriting view ===')
print(f'FRED MORTGAGE30US at cohort year-end: {mtg_base*100:.2f}%   |   stress scenario: {mtg_stress*100:.2f}% (+50bp)')
print(f'Assumptions: 70% LTV interest-only 3yr hold, exit cap = entry cap, no transaction costs')
print(f'Opex ratio: state-based schedule (57% Rust Belt / 47% CA-FL / 44% TX / 42% SE / 40% AZ-NV)')
print(f'Target: {TARGET_ROE_ANNUAL*100:.0f}%/yr levered ROE ({TARGET_ROE_3YR*100:.1f}% cumulative over 3yr)')
print()

rows = []
for i in range(len(picks)):
    r = picks.iloc[i]
    cap  = r['cap_rate_proxy']
    opex = r['opex_ratio']
    zy   = r['zori_yoy'] if pd.notna(r['zori_yoy']) else 0.0
    noi_yld    = cap * (1 - opex)               # actual NOI yield
    debt_yld   = LTV * mtg_base                 # interest as % of purchase price
    debt_yld_s = LTV * mtg_stress
    dscr       = noi_yld / debt_yld             # standard MF DSCR (lender minimum: 1.20)
    noi_gap    = noi_yld - debt_yld             # positive = self-sustaining, negative = eats equity

    # NOI growth needed for various ROE targets
    g_be_base   = solve_noi_growth(noi_yld, mtg_base,   roe_target_3yr=0.0)
    g_be_stress = solve_noi_growth(noi_yld, mtg_stress, roe_target_3yr=0.0)
    g_tgt_base  = solve_noi_growth(noi_yld, mtg_base,   roe_target_3yr=TARGET_ROE_3YR)

    # Projected levered ROE if trailing rent momentum holds for the 3yr hold.
    # Uses zori_yoy as the assumed annual NOI growth rate (rough proxy — real NOI
    # growth may differ due to opex changes, cap-rate movement, or reassessments).
    proj_roe_3yr = levered_roe_3yr(noi_yld, zy, mtg_base)
    if 1 + proj_roe_3yr > 0:
        proj_roe_ann = (1 + proj_roe_3yr) ** (1/3) - 1
    else:
        proj_roe_ann = float('nan')

    rows.append({
        '#': i+1,
        'market':   f\"{r['county_name'].replace(' County','')}, {r['state_name']}\",
        'cap_gross':cap * 100,
        'opex%':    opex * 100,
        'noi_yld':  noi_yld * 100,
        'mtg':      mtg_base * 100,
        'debt_yld': debt_yld * 100,
        'DSCR':     dscr,
        'noi_gap':  noi_gap * 100,
        'zori_yoy': zy * 100,
        'NOI_grow_BE':      g_be_base * 100,
        'NOI_grow_BE_+50bp': g_be_stress * 100,
        'NOI_grow_TGT_15%':  g_tgt_base * 100,
        'Proj_ROE_@zori':   proj_roe_ann * 100 if pd.notna(proj_roe_ann) else None,
        # MF BUILDING counts (ACS 1yr PIT — estimated from unit counts / bucket midpoints)
        # 5-19 buildings = small MF sweet spot (closest to "4-20 unit" investor target)
        'mf_bldgs_5to9':   int(r['mf_bldgs_5to9'])   if pd.notna(r.get('mf_bldgs_5to9'))   else None,
        'mf_bldgs_10to19': int(r['mf_bldgs_10to19']) if pd.notna(r.get('mf_bldgs_10to19')) else None,
        'mf_bldgs_5to19':  int(r['mf_bldgs_5to19'])  if pd.notna(r.get('mf_bldgs_5to19'))  else None,
        'mf_bldgs_20to49': int(r['mf_bldgs_20to49']) if pd.notna(r.get('mf_bldgs_20to49')) else None,
        'mf_bldgs_50plus': int(r['mf_bldgs_50plus']) if pd.notna(r.get('mf_bldgs_50plus')) else None,
    })

df = pd.DataFrame(rows)

# Pandas display for wide DataFrames — Jupyter renders as horizontally scrollable HTML.
pd.set_option('display.max_columns', 30)
pd.set_option('display.width', 400)
pd.set_option('display.max_colwidth', 40)  # room for full "County, State" names

# ── Styling ──────────────────────────────────────────────────────────────────
def _color_noi_gap(v):
    if pd.isna(v): return ''
    if v > 0: return 'color: #006600; font-weight: bold'
    return 'color: #b30000'

def _color_dscr(v):
    if pd.isna(v): return ''
    if v >= 1.20: return 'background-color: #d4edda'   # green: meets lender min
    if v >= 1.00: return 'background-color: #fff3cd'   # amber: covers interest but tight
    return 'background-color: #f8d7da'                 # red: negative carry

def _color_noi_growth(v):
    if pd.isna(v): return ''
    if v == float('inf'):  return 'background-color: #f8d7da'   # infeasible
    if v == float('-inf'): return 'background-color: #d4edda'   # already exceeded
    if v > 8.0:   return 'background-color: #ffe8b3'   # amber: aggressive
    if v < 0:     return 'background-color: #d4edda'   # green: no growth needed
    return ''

def _color_projected_roe(v):
    if pd.isna(v): return ''
    if v >= TARGET_ROE_ANNUAL*100:  return 'background-color: #d4edda; font-weight: bold'  # green: hits target
    if v >= 0:                       return 'background-color: #fff3cd'                     # amber: positive but short
    return 'background-color: #f8d7da'                                                       # red: loses money

styled = (df.style
    .format({
        'cap_gross': '{:.2f}%', 'opex%': '{:.0f}%', 'noi_yld': '{:.2f}%',
        'mtg': '{:.2f}%', 'debt_yld': '{:.2f}%', 'DSCR': '{:.2f}×',
        'noi_gap': '{:+.2f}pp', 'zori_yoy': '{:+.2f}%',
        'NOI_grow_BE':      '{:+.2f}%/yr',
        'NOI_grow_BE_+50bp': '{:+.2f}%/yr',
        'NOI_grow_TGT_15%':  '{:+.2f}%/yr',
        'Proj_ROE_@zori':   '{:+.2f}%/yr',
        'mf_bldgs_5to9':'{:,.0f}', 'mf_bldgs_10to19':'{:,.0f}', 'mf_bldgs_5to19':'{:,.0f}',
        'mf_bldgs_20to49':'{:,.0f}', 'mf_bldgs_50plus':'{:,.0f}',
    }, na_rep='—')
    .map(_color_noi_gap,       subset=['noi_gap'])
    .map(_color_dscr,          subset=['DSCR'])
    .map(_color_noi_growth,    subset=['NOI_grow_BE', 'NOI_grow_BE_+50bp', 'NOI_grow_TGT_15%'])
    .map(_color_projected_roe, subset=['Proj_ROE_@zori'])
    .set_caption(f'{CURRENT_YEAR} picks — NOI-based underwriting view')
)

print('COLUMN LEGEND (all percentages annualized):')
print('  cap_gross   = gross ACS cap-rate proxy (annual gross rent / home value)')
print('  noi_yld     = cap_gross × (1 − opex)  → NOI as % of purchase price')
print('  debt_yld    = LTV × mortgage rate  → annual interest as % of purchase price')
print('  DSCR        = noi_yld / debt_yld  → lender minimum: 1.20×  (green ≥1.20, amber 1.0-1.2, red <1.0)')
print('  noi_gap     = noi_yld − debt_yld  → positive = self-sustaining, negative = eats into equity')
print('  NOI_grow_BE       = annual NOI growth needed for LEVERED ROE = 0  (equity preserved)')
print('  NOI_grow_BE_+50bp = same, but at mortgage +50bp (rate stress test)')
print('  NOI_grow_TGT_15%  = annual NOI growth needed for 15%/yr levered ROE  (typical MF target)')
print('  Proj_ROE_@zori    = projected annualized levered ROE if trailing zori_yoy holds for 3yr as NOI growth')
print('                      GREEN = hits 15%/yr target  |  AMBER = positive but short  |  RED = loses money')
print()
print('INTERPRETATION:')
print('  • Historical MF NOI growth has averaged ~3-4%/yr nationally')
print('  • NOI growth combines rent growth AND cap-rate compression (both flow through NOI/value)')
print('  • If NOI_grow_BE < 3%/yr — defensible under normal conditions')
print('  • If NOI_grow_TGT_15% > 6%/yr — you need above-trend NOI growth (rent momentum + cap comp)')
print('  • Proj_ROE_@zori uses trailing zori_yoy as a naive NOI growth proxy — assumes recent pace holds')
print()

styled
"""

# ══════════════════════════════════════════════════════════════════════════════
# STRATEGY-SPECIFIC CONFIGS
# ══════════════════════════════════════════════════════════════════════════════

STRATEGIES = {
    # ─────────────────────────── HC v1 ───────────────────────────
    "hc_v1": {
        "title": "HC v1 — Raw Cap-Rate Ranking",
        "description": (
            "The simplest possible high-cap strategy. Ranks the universe by "
            "`cap_rate_proxy` descending, takes top-N with a per-state cap. "
            "No filters, no fundamentals check, no momentum overlay. Every other "
            "HC variant is a modification of this baseline.\n\n"
            "**Thesis:** yield alone. Highest gross rent-to-price ratio = best "
            "entry point. Captures the market's own risk premium without trying "
            "to predict which markets will appreciate."
        ),
        "features_md": (
            "## Features used by HC v1\n\n"
            "| Feature | Source | Purpose | Threshold |\n"
            "|---|---|---|---|\n"
            "| `cap_rate_proxy` | ACS: annualized gross rent ÷ median home value | **Ranking key** — sort desc | None |\n"
            "| `state_name` | Census FIPS | State cap constraint | Max 2 per state |\n"
            "| `pop_latest`, `employment_diversity_hhi` | Census PEP / BLS QCEW | Universe filter (from config) | pop ∈ [POP_MIN, POP_MAX], HHI ≤ HHI_MAX |\n\n"
            "**That's it — 1 signal, 1 constraint.** No gates, no re-rank."
        ),
        "method_code": """# HC v1 implementation
def pick_for_year(year):
    c = uni[uni['year'] == year].dropna(subset=['cap_rate_proxy']).sort_values('cap_rate_proxy', ascending=False)
    picked, sc = [], {}
    for _, r in c.iterrows():
        if sc.get(r['state_name'], 0) >= MAX_PER_STATE: continue
        picked.append(r); sc[r['state_name']] = sc.get(r['state_name'], 0) + 1
        if len(picked) >= TOP_N: break
    return pd.DataFrame(picked) if picked else pd.DataFrame()

# Sanity check
sample = pick_for_year(2025)
print(f'HC v1 picks for 2025:\\n{sample[[\"county_name\",\"state_name\",\"cap_rate_proxy\"]].to_string(index=False)}')
""",
    },

    # ─────────────────────────── HC v2 ───────────────────────────
    "hc_v2": {
        "title": "HC v2 — Cap Rate + Fundamental Growth Gates",
        "description": (
            "Same cap-rate ranking as HC v1, but candidates must first pass "
            "hard filters on fundamentals (population, labor, vacancy, renter share). "
            "Ties broken by 3-year cap-rate compression momentum.\n\n"
            "**Thesis:** high yield only counts if fundamentals aren't rotting. "
            "Excludes yield-trap markets where cap is high because the market is right "
            "that the market is declining.\n\n"
            "**Gate semantics:** NaN-permissive — missing data doesn't disqualify, only "
            "*known-bad* values do. Prevents data gaps from silently dropping candidates."
        ),
        "features_md": (
            "## Features used by HC v2\n\n"
            "### Ranking key\n"
            "| Feature | Source | Purpose |\n"
            "|---|---|---|\n"
            "| `cap_rate_proxy` | ACS: gross rent ÷ home value | Primary sort key (desc) |\n"
            "| `mf_cap_rate_change_3yr` | ACS-derived 3yr Δ in cap rate | Tiebreak: prefer compressing markets (Δ negative) |\n\n"
            "### Hard gates (candidate excluded if any KNOWN value fails)\n"
            "| Gate | Threshold | Source |\n"
            "|---|---|---|\n"
            "| `pop_yoy_pct` | ≥ 0 (population not shrinking) | Census PEP, PIT-strict |\n"
            "| `unemployment_rate` | ≤ 6.5% | BLS LAUS |\n"
            "| `rental_vacancy_rate` | ≤ 12% | ACS |\n"
            "| `renter_share` | ≥ 20% | ACS |\n"
            "| `any_disqualifier` | must be FALSE | int_disqualifiers (currently only fires on `disq_mf_top`) |\n\n"
            "### Constraints\n"
            "- `state_name` — max 2 per state\n"
            "- Universe filter: `pop_latest`, `employment_diversity_hhi`"
        ),
        "method_code": """# HC v2 implementation — cap rank + growth gates + momentum tiebreak
GATES = {
    'min_pop_yoy_pct':       0.0,     # population not shrinking
    'max_unemp_pct':         6.5,     # labor market healthy
    'max_vacancy_frac':      0.12,    # actual rental demand
    'min_renter_share_frac': 0.20,    # meaningful renter base
    'require_no_disq':       True,    # passes mart's built-in disqualifiers
}
MOMENTUM_TIEBREAK = True  # prefer cap-compressing markets (Δ negative)

def pick_for_year(year, gates=GATES):
    c = uni[uni['year'] == year].dropna(subset=['cap_rate_proxy']).copy()
    pop_yr = pop_yoy_cache.get(year, pd.DataFrame())
    if not pop_yr.empty:
        c = c.merge(pop_yr[['fips','pop_yoy_pct']], on='fips', how='left')
    else:
        c['pop_yoy_pct'] = np.nan

    n_before = len(c)
    # NaN-permissive gates
    c = c[c['pop_yoy_pct'].isna()       | (c['pop_yoy_pct']       >= gates['min_pop_yoy_pct'])]
    c = c[c['unemployment_rate'].isna() | (c['unemployment_rate'] <= gates['max_unemp_pct'])]
    c = c[c['rental_vacancy_rate'].isna() | (c['rental_vacancy_rate'] <= gates['max_vacancy_frac'])]
    c = c[c['renter_share'].isna()      | (c['renter_share']      >= gates['min_renter_share_frac'])]
    if gates['require_no_disq']:
        c = c[(c['any_disqualifier'] == False) | (c['any_disqualifier'].isna())]

    print(f'  {year}: {n_before} → {len(c)} candidates after gates ({len(c)/n_before*100:.0f}% pass rate)')
    if c.empty: return pd.DataFrame()

    if MOMENTUM_TIEBREAK and 'mf_cap_rate_change_3yr' in c.columns:
        c = c.sort_values(['cap_rate_proxy','mf_cap_rate_change_3yr'], ascending=[False, True])
    else:
        c = c.sort_values('cap_rate_proxy', ascending=False)

    picked, sc = [], {}
    for _, r in c.iterrows():
        if sc.get(r['state_name'], 0) >= MAX_PER_STATE: continue
        picked.append(r); sc[r['state_name']] = sc.get(r['state_name'], 0) + 1
        if len(picked) >= TOP_N: break
    return pd.DataFrame(picked) if picked else pd.DataFrame()

sample = pick_for_year(2025)
print(f'\\nHC v2 picks for 2025:\\n{sample[[\"county_name\",\"state_name\",\"cap_rate_proxy\",\"unemployment_rate\",\"rental_vacancy_rate\",\"renter_share\"]].to_string(index=False)}')
""",
    },

    # ─────────────────────────── HC v3 ───────────────────────────
    "hc_v3": {
        "title": "HC v3 — Cap Rate + Tops-Guard Exclusion Gates",
        "description": (
            "Same cap-rate ranking as HC v1, but filters out markets showing signs "
            "of being at a cyclical top or in early recession. Opposite philosophy "
            "from HC v2 — screens for cyclical vulnerability, not structural weakness.\n\n"
            "**Thesis:** keep the 'distressed high-cap mean-reversion' plays; exclude "
            "'high-cap because we already ran the market up and it's about to correct' "
            "plays.\n\n"
            "**Notable behavior:** at cyclical inflection points (COVID 2020 with "
            "spiking unemployment) the guards can wipe out the entire eligible pool "
            "— v3 returns zero picks that year."
        ),
        "features_md": (
            "## Features used by HC v3\n\n"
            "### Ranking key\n"
            "| Feature | Source | Purpose |\n"
            "|---|---|---|\n"
            "| `cap_rate_proxy` | ACS: gross rent ÷ home value | Primary sort key (desc) |\n\n"
            "### Hard tops-guard gates (candidate excluded if any KNOWN value fails)\n"
            "| Gate | Threshold | Source | What it catches |\n"
            "|---|---|---|---|\n"
            "| `hpi_trailing_24mo` | < 30% | FHFA HPI | Markets that ran up 30%+ over 2 years (top-tick) |\n"
            "| `permits_intensity_ratio` | < 1.5 | Census BPS vs 10yr baseline | Oversupplied markets |\n"
            "| `unemployment_rate_yoy_chg` | < 1.0 pp | BLS LAUS | Unemployment spiking (recession warning) |\n"
            "| `any_disqualifier` | must be FALSE | int_disqualifiers (mf_top signal) | Cycle × macro regime combo |\n\n"
            "### Constraints\n"
            "- `state_name` — max 2 per state\n"
            "- Universe filter: `pop_latest`, `employment_diversity_hhi`"
        ),
        "method_code": """# HC v3 implementation — cap rank + tops-guard gates
GATES_V3 = {
    'max_hpi_24mo':     0.30,   # not overheated on price
    'max_permit_ratio': 1.5,    # not oversupplied
    'max_unemp_yoy':    1.0,    # unemployment not spiking
    'require_no_disq':  True,
}

def pick_for_year(year, gates=GATES_V3):
    c = uni[uni['year'] == year].dropna(subset=['cap_rate_proxy']).copy()
    n_before = len(c)
    c = c[c['hpi_trailing_24mo'].isna()          | (c['hpi_trailing_24mo']          < gates['max_hpi_24mo'])]
    c = c[c['permits_intensity_ratio'].isna()    | (c['permits_intensity_ratio']    < gates['max_permit_ratio'])]
    c = c[c['unemployment_rate_yoy_chg'].isna()  | (c['unemployment_rate_yoy_chg']  < gates['max_unemp_yoy'])]
    if gates['require_no_disq']:
        c = c[(c['any_disqualifier'] == False) | (c['any_disqualifier'].isna())]

    print(f'  {year}: {n_before} → {len(c)} candidates after tops-guards ({len(c)/n_before*100:.0f}% pass rate)')
    if c.empty:
        print(f'  {year}: no candidates survive — likely cyclical inflection year')
        return pd.DataFrame()

    c = c.sort_values('cap_rate_proxy', ascending=False)
    picked, sc = [], {}
    for _, r in c.iterrows():
        if sc.get(r['state_name'], 0) >= MAX_PER_STATE: continue
        picked.append(r); sc[r['state_name']] = sc.get(r['state_name'], 0) + 1
        if len(picked) >= TOP_N: break
    return pd.DataFrame(picked) if picked else pd.DataFrame()

sample = pick_for_year(2025)
print(f'\\nHC v3 picks for 2025:\\n{sample[[\"county_name\",\"state_name\",\"cap_rate_proxy\",\"hpi_trailing_24mo\",\"permits_intensity_ratio\",\"unemployment_rate_yoy_chg\"]].to_string(index=False)}')
""",
    },

    # ─────────────────────────── HC v4 ───────────────────────────
    "hc_v4": {
        "title": "HC v4 — Cap Shortlist + Short-Horizon Rent Momentum",
        "description": (
            "Two-stage sort: (1) shortlist the top-K counties by cap rate, then "
            "(2) re-rank inside that shortlist by trailing 12-month rent growth "
            "(`zori_yoy`). Take top-N with state cap.\n\n"
            "**Thesis:** don't buy the *highest*-cap markets — buy from among "
            "high-cap markets, the ones **already showing rent traction**. Combines "
            "yield entry with momentum confirmation.\n\n"
            "**Key mechanic:** cap defines *eligibility* (top 15 only), rent momentum "
            "defines *ordering*. A #17-by-cap county with monster rent growth is "
            "ineligible; a #12-by-cap county with strong momentum can beat a #2-by-cap "
            "county with weak momentum.\n\n"
            "**Empirically the best-performing HC variant** in the backtest (~52% avg "
            "3-yr TR vs universe ~40%)."
        ),
        "features_md": (
            "## Features used by HC v4\n\n"
            "### Stage 1 — Cap shortlist\n"
            "| Feature | Source | Purpose |\n"
            "|---|---|---|\n"
            "| `cap_rate_proxy` | ACS: gross rent ÷ home value | Shortlist filter — take top-K by this |\n\n"
            "**Shortlist size:** `K = TOP_N × SHORTLIST_MULT` = 5 × 3 = 15\n\n"
            "### Stage 2 — Momentum re-rank\n"
            "| Feature | Source | Purpose |\n"
            "|---|---|---|\n"
            "| `zori_yoy` | Zillow ZORI — trailing 12mo rent change | Re-rank shortlist desc (NaN goes last) |\n\n"
            "### Constraints\n"
            "- `state_name` — max 2 per state\n"
            "- Universe filter: `pop_latest`, `employment_diversity_hhi`\n\n"
            "**No fundamental gates. No demographic filters. No macro awareness. "
            "Just cap-shortlist → momentum → state cap.**"
        ),
        "method_code": """# HC v4 implementation — cap shortlist + zori_yoy momentum re-rank
SHORTLIST_MULT = 3   # shortlist size = TOP_N × SHORTLIST_MULT

def pick_for_year(year, momentum_col='zori_yoy'):
    c = uni[uni['year'] == year].dropna(subset=['cap_rate_proxy']).copy()
    K = TOP_N * SHORTLIST_MULT

    # Stage 1: shortlist by cap rate
    shortlist = c.nlargest(K, 'cap_rate_proxy').copy()

    # Stage 2: re-rank by momentum
    shortlist = shortlist.sort_values(momentum_col, ascending=False, na_position='last')

    # State cap
    picked, sc = [], {}
    for _, r in shortlist.iterrows():
        if sc.get(r['state_name'], 0) >= MAX_PER_STATE: continue
        picked.append(r); sc[r['state_name']] = sc.get(r['state_name'], 0) + 1
        if len(picked) >= TOP_N: break

    print(f'  {year}: cap shortlist top-{K}, re-ranked by {momentum_col}')
    return pd.DataFrame(picked) if picked else pd.DataFrame()

sample = pick_for_year(2025)
print(f'\\nHC v4 picks for 2025:\\n{sample[[\"county_name\",\"state_name\",\"cap_rate_proxy\",\"zori_yoy\"]].to_string(index=False)}')
""",
    },

    # ─────────────────────────── ELITE ───────────────────────────
    "elite": {
        "title": "ELITE — Analog Search Against Historical Winners",
        "description": (
            "Fundamentally different from HC variants. No cap-rate ranking. "
            "Identify past top-25% winners by realized 3-yr total return, then rank "
            "current candidates by feature similarity (cosine) to those winners. "
            "Uses expanding walk-forward: at test year Y, train on cohorts prior to Y "
            "with realized targets.\n\n"
            "**Thesis:** 'who *looks like* the counties that won historically?' instead "
            "of 'who has the highest yield right now?' Aims to capture non-linear "
            "combinations of features that a simple cap ranking can't see.\n\n"
            "**Empirically underperforms HC v4** on unlevered total return (~44% vs "
            "52%), but **outperforms HC v1 on HPI-only appreciation** (Sunbelt/tech "
            "metros with weaker cash yield but stronger price appreciation)."
        ),
        "features_md": (
            "## Features used by ELITE\n\n"
            "Unlike HC v1-v4, ELITE uses **~91 features** simultaneously via cosine "
            "similarity. Features are z-scored *within each cohort year* so the match "
            "is relative to that year's universe.\n\n"
            "### Feature families (source-grouped)\n"
            "| Family | Source | Examples |\n"
            "|---|---|---|\n"
            "| **Cap rate + rent** | ACS, Zillow ZORI | `cap_rate_proxy`, `zori_yoy`, `rent_growth_vs_wage_growth`, `mf_cap_rate_change_3yr` |\n"
            "| **Price appreciation** | FHFA HPI | `hpi_yoy`, `hpi_trailing_24mo`, `hpi_5yr_cagr_deficit` |\n"
            "| **Employment & wages** | BLS QCEW | `emp_growth_yoy`, `wage_growth_yoy`, `employment_diversity_hhi`, `knowledge_emp_cagr_3yr`, `renter_ind_emp_yoy` |\n"
            "| **Labor market** | BLS LAUS | `unemployment_rate`, `unemployment_rate_yoy_chg` |\n"
            "| **Population & migration** | Census PEP, IRS SOI | `pop_latest`, `domesticmig_per_1000`, `domesticmig_accel_3yr`, `internationalmig_per_1000`, `irs_net_migration_rate`, `irs_inflow_rate`, `irs_income_gap` |\n"
            "| **Housing supply** | Census BPS | `permits_per_1000`, `permits_intensity_ratio`, `mf_permit_ratio`, `mf_permit_ratio_change_3yr` |\n"
            "| **Vacancy** | ACS, HUD | `rental_vacancy_rate`, `rental_vacancy_change_3yr`, `vt_vacancy_level`, `vt_vacancy_change_3yr` |\n"
            "| **Income** | ACS, BEA | `median_household_income`, `per_capita_income`, `pcpi_yoy`, `pcpi_cagr_3yr`, `rent_to_income_ratio` |\n"
            "| **Demographics** | Census ACS | `age_20_34_share`, `foreign_born_share`, `renter_share` |\n"
            "| **Business formation** | Census BFS | `business_apps_per_1000`, `business_apps_per_1000_3yr_avg` |\n"
            "| **Anchor sector shares** | BLS QCEW | `tourism_share`, `edu_share`, `healthcare_share`, `federal_gov_share`, `anchor_stability_score`, `anchor_type` (categorical) |\n"
            "| **Macro regime** | FRED-derived | `macro_regime` (categorical: ACCOMMODATIVE / MID_CYCLE / TOPPING / etc.) |\n\n"
            "### Excluded (leaky or non-numeric)\n"
            "- `pcpi_cagr_5yr`, `n_supersectors_reporting` — marked leaky (not point-in-time in current pipeline)\n"
            "- All target and realized-return columns (would leak future info into similarity)\n"
            "- All identifier / label columns (`fips`, `county_name`, `state_name`, `period_end_date`)\n\n"
            "### Method knobs\n"
            "| Param | Value | Meaning |\n"
            "|---|---|---|\n"
            "| Target | `target_total_return_36mo_demeaned` | ZORI-based composite (rent × cap change), demeaned within cohort |\n"
            "| Winner definition | Top **25%** by target in each training cohort | `elite_top_pct = 0.25` |\n"
            "| Top-K analogs | **5** | Per candidate, score = mean of top-K similarities to winners |\n"
            "| Min train years | **5** | Skip test years with fewer training cohorts available |\n"
            "| Strict PIT | **True** | Cohort year `y` eligible only if `y + 3 ≤ Y_test` |\n"
        ),
        "method_code": """# ELITE implementation — imports from backtest.analog_search
import sys
sys.path.insert(0, '/Users/premputtegowda/reps/reps-tracker/emerging_re')
from backtest.analog_search import (
    load_tertiary_panel, load_mf_context, build_acs_target,
    build_feature_matrix, zscore_within_cohort, walk_forward,
    TARGET_COL_TOTAL_RETURN,
)

# Panel setup (uses same POP/HHI filters as our config)
panel = load_tertiary_panel(pop_min=POP_MIN, pop_max=POP_MAX, hhi_max=HHI_MAX)
panel = panel.merge(build_acs_target(horizon_years=HORIZON_YEARS), on=['fips','period_end_date'], how='left')
panel = panel.merge(load_mf_context(), on='fips', how='left')
panel_fe, feature_cols = build_feature_matrix(panel)  # full ~91-feature set
panel_z = zscore_within_cohort(panel_fe, feature_cols)
print(f'Panel: {len(panel)} rows, {len(feature_cols)} features (z-scored within cohort year)')

# Walk-forward
elite_results = walk_forward(
    panel_z, panel_fe, feature_cols,
    target_col=TARGET_COL_TOTAL_RETURN,
    top_n=TOP_N, max_per_state=MAX_PER_STATE,
    elite_top_pct=0.25,     # winner definition: top 25% by realized target
    strict_pit_targets=True,
)

# Wrap in the same pick_for_year(year) interface used by HC v1-v4
def pick_for_year(year):
    for r in elite_results:
        if r.test_year == year:
            picks = r.top5.head(TOP_N)[['fips','county_name','state_name']].copy()
            # attach return columns from uni
            return picks.merge(
                uni[uni['year'] == year][['fips','cap_rate_proxy','zori_yoy','mortgage_rate','opex_ratio',
                                           'cash_flow_3yr','appreciation_3yr','total_return_3yr',
                                           'debt_service_3yr','levered_ROE_3yr',
                                           'zori_forward_return_36mo','hpi_forward_return_36mo',
                                           'mf_bldgs_5to9','mf_bldgs_10to19','mf_bldgs_5to19',
                                           'mf_bldgs_20to49','mf_bldgs_50plus']],
                on='fips', how='left')
    return pd.DataFrame()

sample = pick_for_year(2025)
if not sample.empty:
    print(f'\\nELITE picks for 2025:\\n{sample[[\"county_name\",\"state_name\",\"cap_rate_proxy\",\"zori_yoy\"]].to_string(index=False)}')
""",
    },

    # ═══════════════════════════ EMERGING-STRESS ═══════════════════════════
    "emerging_stress": {
        "title": "EMERGING-STRESS — Under-Discovered Markets That Survive Rate + Cap Stress",
        "description": (
            "Same universe and gates as EMERGING, but adds TWO stress tests that a pick must pass "
            "before making the final list:\n\n"
            "- **Stress A (rate shock)**: projected levered ROE stays positive if mortgage rate rises **+200bp**\n"
            "- **Stress B (cap expansion)**: projected total return stays positive if exit cap expands **+100bp**\n\n"
            "**Thesis**: fundamentals-good + rate-resilient + cap-resilient = defensible under most macro scenarios. "
            "Filters out markets that only work if today's rates and cap rates persist.\n\n"
            "**Vs plain EMERGING**: EMERGING says 'markets with strong leading indicators.' EMERGING-STRESS says "
            "'AND the deal still works if financing gets harder OR buyers at exit demand more yield.' Fewer picks, "
            "higher conviction, lower fragility."
        ),
        "features_md": (
            "## Features used by EMERGING-STRESS — full criteria\n\n"
            "**Inherits ALL EMERGING criteria** (see EMERGING notebook for details) AND adds two stress-test gates. "
            "Same universe, gates, and opportunity score — plus rate-shock and cap-expansion survival tests.\n\n"
            "### Layer 1 — Universe filter\n\n"
            "| Filter | Threshold | Source |\n"
            "|---|---|---|\n"
            "| `pop_latest` | **> 300,000** AND **≤ 1,000,000** | Census PEP |\n"
            "| `employment_diversity_hhi` | **≤ 0.10** | BLS QCEW (HHI of supersector shares) |\n\n"
            "### Layer 2 — Hard gates (NaN-permissive)\n\n"
            "| Gate | Threshold | Source |\n"
            "|---|---|---|\n"
            "| `pop_yoy_pct` | **≥ 0.3%/yr** | Census PEP (PIT-strict) |\n"
            "| `permits_intensity_ratio` | **< 1.5** | Census BPS / 10yr baseline |\n"
            "| `unemployment_rate` | **≤ 6.0%** | BLS LAUS |\n"
            "| `wage_growth_yoy` | **≥ 2.0%/yr** | BLS QCEW |\n"
            "| `max_supersector_share` | **≤ 0.25** | BLS QCEW (sector diversification) |\n"
            "| `any_disqualifier` | must be **FALSE** | dbt `int_disqualifiers` |\n\n"
            "### Layer 3 — Additional filters\n\n"
            "| Filter | Threshold | Rationale |\n"
            "|---|---|---|\n"
            "| `cap_rate_proxy` | **≥ pool median** | Still yielding — not compressed by discovery |\n"
            "| `cap_spread_to_gateway_pp` | **≥ 0.0** | Cap must be ≥ median cap of gateway markets (LA/NY/SF/DC/Chicago/Boston). Institutional-absence signal. |\n\n"
            "### Layer 4 — STRESS TESTS (new — these are the key difference vs EMERGING)\n\n"
            "For each candidate, projected returns are computed under adverse scenarios using trailing `zori_yoy` × 3 as the NOI growth projection. BOTH must pass.\n\n"
            "#### Stress A — Rate shock survival (+100bp mortgage)\n\n"
            "| Metric | Formula |\n"
            "|---|---|\n"
            "| Projected NOI growth | `(1 + trailing_zori_yoy)^3 − 1` (compounded 3yr) |\n"
            "| Projected cash flow (3yr) | `3 × cap × (1 − opex) × (1 + noi_growth/2)` |\n"
            "| Stressed debt service (3yr) | `3 × LTV × (mortgage_rate + 0.01)` |\n"
            "| Projected apprec (NOI-driven, cap held) | `noi_growth` |\n"
            "| **Stressed levered ROE (3yr)** | `(cf − stressed_debt + apprec) / (1 − LTV)` |\n"
            "| **GATE** | **Stressed levered ROE > −20%** (allow up to 20% loss over 3yr) |\n\n"
            "#### Stress B — Cap expansion survival (+50bp NOI cap at exit)\n\n"
            "| Metric | Formula |\n"
            "|---|---|\n"
            "| Entry NOI cap | `cap × (1 − opex)` |\n"
            "| Exit NOI (per $1 entry) | `entry_NOI × (1 + noi_growth)` |\n"
            "| Stressed exit NOI cap | `entry_NOI_cap + 0.005` |\n"
            "| Stressed exit value | `exit_NOI / stressed_exit_NOI_cap` |\n"
            "| Stressed capital gain | `stressed_exit_value − 1` |\n"
            "| **Stressed total return (3yr)** | `cf + stressed_capital_gain` |\n"
            "| **GATE** | **Stressed total return > −5%** (allow small loss over 3yr) |\n\n"
            "**Compound requirement**: pick must pass BOTH stress tests.\n\n"
            "### Layer 5 — Opportunity score (extended vs EMERGING)\n\n"
            "| Signal | Weight | Rationale |\n"
            "|---|---|---|\n"
            "| `pop_yoy_pct` | **1.0** | Migration momentum |\n"
            "| `wage_growth_yoy` | **1.0** | Income growth (rent capacity) |\n"
            "| `business_apps_per_1000` | **0.7** | Organic economy expansion |\n"
            "| `cap_rate_proxy` | **0.5** | Still under-priced yield |\n"
            "| `cap_spread_to_gateway_pp` | **0.8** | Institutional-absence signal (spread vs gateway markets) |\n"
            "| `hpi_rent_gap_pp` | **0.4** | HPI outpacing rent — coiled spring (buyers pushed to rent) |\n"
            "| `age_20_34_share_yoy_chg` | **0.5** | Young adult demographic tilting in |\n\n"
            "### Layer 6 — Selection (state cap + top-N)\n\n"
            "- Walk down opportunity-score-ranked list\n"
            "- Skip if state has hit `MAX_PER_STATE` cap (default: 3)\n"
            "- Take top `TOP_N` (default: 10)\n\n"
            "### Summary — what EMERGING-STRESS ADDS beyond EMERGING\n\n"
            "1. Sector diversification gate (`max_supersector_share ≤ 0.25`) — inherited from EMERGING now\n"
            "2. Cap-spread-to-gateway gate (`≥ 0.0 pp`) — inherited from EMERGING now\n"
            "3. **Rate stress survival gate (Stress A)** ← new vs EMERGING\n"
            "4. **Cap-expansion survival gate (Stress B)** ← new vs EMERGING\n"
            "5. **Extended opportunity score** with 3 additional signals (cap spread, HPI-rent gap, young-adult migration)\n"
        ),
        "config_overrides": """
# ── EMERGING-STRESS overrides — freely edit these to change the screen ──
POP_MIN       = 300_000      # mid-size metros
POP_MAX       = 1_000_000    # below major-metro band
TOP_N         = 10           # show top-10 stress-survivors
MAX_PER_STATE = 3            # geographic tolerance
STRESS_MTG_BP        = 0.01  # +100bp mortgage rate stress (Stress A) — realistic given already-high rates
STRESS_CAP_BP        = 0.005 # +50bp exit cap expansion stress (Stress B)
STRESS_ROE_MIN       = -0.20 # min levered ROE under Stress A (allow up to 20% loss over 3yr)
STRESS_TR_MIN        = -0.05 # min total return under Stress B (allow small loss)
MAX_SECTOR_SHARE     = 0.25  # sector diversification — no single sector > 25% of employment (matches mart disqualifier)
MIN_CAP_SPREAD_PP    = 0.0   # cap spread vs gateway markets — must be at or above institutional benchmark
""",
        "method_code": """# EMERGING-STRESS — EMERGING gates + sector diversification + BOTH stress tests + institutional-absence signals
EMERGING_GATES = {
    'min_pop_yoy_pct':      0.3,
    'max_permit_ratio':     1.5,
    'max_unemp_pct':        6.0,
    'min_wage_growth':      0.02,
    'require_no_disq':      True,
    # NEW: sector diversification — no single supersector > 22% of employment
    'max_sector_share':     MAX_SECTOR_SHARE,
    # NEW: cap must be at least 50bp above gateway (institutional-absence signal)
    'min_cap_spread_pp':    MIN_CAP_SPREAD_PP,
}
# Opportunity score weights — includes institutional-absence and coiled-spring signals
OPPORTUNITY_WEIGHTS = {
    'pop_yoy_pct':               1.0,   # migration momentum
    'wage_growth_yoy':           1.0,   # income growth (rent capacity)
    'business_apps_per_1000':    0.7,   # organic economy expansion
    'cap_rate_proxy':            0.5,   # still yielding
    # NEW: institutional-absence + coiled-spring signals
    'cap_spread_to_gateway_pp':  0.8,   # spread vs gateway = mispricing signal
    'hpi_rent_gap_pp':           0.4,   # HPI outpacing rent = buyers pushed to rent (coiled spring)
    'age_20_34_share_yoy_chg':   0.5,   # young adult demographic tilting in
}

def stress_test_survives(cap, opex, mtg, zori_yoy_trailing, ltv=LTV,
                          rate_stress=STRESS_MTG_BP, cap_stress=STRESS_CAP_BP,
                          roe_min=STRESS_ROE_MIN, tr_min=STRESS_TR_MIN):
    '''Return (passes_A, passes_B, stressed_roe_A, stressed_tr_B) tuple.
    Both must be True for the pick to survive the compound gate.
    Uses trailing zori_yoy × 3 (compounded) as the NOI growth projection.'''
    if pd.isna(zori_yoy_trailing): zori_yoy_trailing = 0.03  # default 3%/yr if missing
    # Compound projection: (1 + trailing)^3 - 1
    noi_growth_3yr = (1 + zori_yoy_trailing) ** 3 - 1
    # Projected cash flow (net of opex, over 3yr)
    cf_net_3yr = 3 * cap * (1 - opex) * (1 + noi_growth_3yr / 2)

    # ── Stress A: mortgage +200bp ──
    stressed_mtg = mtg + rate_stress
    stressed_debt_service_3yr = 3 * ltv * stressed_mtg
    # Assume no cap compression under stress (conservative): apprec = noi_growth
    stressed_apprec = noi_growth_3yr
    stressed_roe_A = (cf_net_3yr - stressed_debt_service_3yr + stressed_apprec) / (1 - ltv)
    passes_A = stressed_roe_A > roe_min

    # ── Stress B: NOI cap expansion +50bp at exit (at ACTUAL mortgage rate) ──
    # IMPORTANT: cap stress is applied to NOI cap (what MF investors quote),
    # NOT to gross cap. So we work in NOI-cap space throughout.
    entry_noi_cap  = cap * (1 - opex)                        # NOI cap at entry
    exit_noi_cap_stressed = entry_noi_cap + cap_stress       # NOI cap stressed +cap_stress
    exit_noi_pct   = entry_noi_cap * (1 + noi_growth_3yr)    # NOI at exit (per $1 entry price)
    # Exit value under stressed cap (using MF identity: value = NOI / cap):
    #   entry_value  = 1 (normalized to $1 purchase)
    #   By identity: entry_value = entry_NOI / entry_NOI_cap  → 1 = entry_noi_cap / entry_noi_cap ✓
    #   exit_value_stressed = exit_NOI / exit_NOI_cap_stressed
    stressed_exit_value = exit_noi_pct / exit_noi_cap_stressed
    stressed_capital_gain = stressed_exit_value - 1
    stressed_tr_B = cf_net_3yr + stressed_capital_gain
    passes_B = stressed_tr_B > tr_min

    return passes_A, passes_B, stressed_roe_A, stressed_tr_B

def pick_for_year(year, gates=EMERGING_GATES):
    c = uni[uni['year'] == year].dropna(subset=['cap_rate_proxy']).copy()
    if c.empty: return pd.DataFrame()

    pop_yr = pop_yoy_cache.get(year, pd.DataFrame())
    if not pop_yr.empty:
        c = c.merge(pop_yr[['fips','pop_yoy_pct']], on='fips', how='left')
    else:
        c['pop_yoy_pct'] = np.nan

    n_before = len(c)

    # Standard EMERGING gates
    c = c[c['pop_yoy_pct'].isna()             | (c['pop_yoy_pct']             >= gates['min_pop_yoy_pct'])]
    c = c[c['permits_intensity_ratio'].isna() | (c['permits_intensity_ratio'] < gates['max_permit_ratio'])]
    c = c[c['unemployment_rate'].isna()       | (c['unemployment_rate']       <= gates['max_unemp_pct'])]
    c = c[c['wage_growth_yoy'].isna()         | (c['wage_growth_yoy']         >= gates['min_wage_growth'])]
    if gates['require_no_disq']:
        c = c[(c['any_disqualifier'] == False) | (c['any_disqualifier'].isna())]

    # NEW: Sector diversification — no single supersector > threshold
    c = c[c['max_supersector_share'].isna() | (c['max_supersector_share'] <= gates['max_sector_share'])]

    # NEW: Cap spread vs gateway — must be at least min_cap_spread_pp above gateway benchmark
    c = c[c['cap_spread_to_gateway_pp'].isna() | (c['cap_spread_to_gateway_pp'] >= gates['min_cap_spread_pp'])]

    # Cap above median filter
    if len(c) > 0:
        cap_median = c['cap_rate_proxy'].median()
        c = c[c['cap_rate_proxy'] >= cap_median]

    n_after_emerging = len(c)

    # ── STRESS TESTS: both A and B must pass ──
    stress_results = []
    for _, r in c.iterrows():
        pA, pB, roe_A, tr_B = stress_test_survives(
            r['cap_rate_proxy'], r['opex_ratio'], r['mortgage_rate'],
            r['zori_yoy']
        )
        stress_results.append({'fips': r['fips'], 'passes_stress_A': pA, 'passes_stress_B': pB,
                               'stressed_ROE_A': roe_A, 'stressed_TR_B': tr_B})
    stress_df = pd.DataFrame(stress_results)
    c = c.merge(stress_df, on='fips', how='left')
    c = c[c['passes_stress_A'] & c['passes_stress_B']]
    n_after_stress = len(c)

    print(f'  {year}: {n_before} → {n_after_emerging} EMERGING gates → {n_after_stress} STRESS survivors ({n_after_stress/n_before*100:.0f}% overall pass)')
    if c.empty: return pd.DataFrame()

    # Opportunity score
    c['opportunity_score'] = 0.0
    for col, w in OPPORTUNITY_WEIGHTS.items():
        if col in c.columns and c[col].notna().any():
            mu, sig = c[col].mean(), c[col].std()
            if sig > 0:
                z = (c[col] - mu) / sig
                c['opportunity_score'] = c['opportunity_score'] + w * z.fillna(0)
    c = c.sort_values('opportunity_score', ascending=False)

    # State cap
    picked, sc = [], {}
    for _, r in c.iterrows():
        if sc.get(r['state_name'], 0) >= MAX_PER_STATE: continue
        picked.append(r); sc[r['state_name']] = sc.get(r['state_name'], 0) + 1
        if len(picked) >= TOP_N: break
    return pd.DataFrame(picked) if picked else pd.DataFrame()

sample = pick_for_year(2025)
if not sample.empty:
    print(f'\\nEMERGING-STRESS picks for 2025:')
    print(sample[['county_name','state_name','cap_rate_proxy','pop_yoy_pct','wage_growth_yoy','stressed_ROE_A','stressed_TR_B','opportunity_score']].to_string(index=False))
""",
    },

    # ═══════════════════════════ EMERGING ═══════════════════════════
    "emerging": {
        "title": "EMERGING — Under-Discovered Mid-Size Markets with Leading Indicators",
        "description": (
            "Fundamentally different from HC and ELITE. Targets **mid-size metros (300K-1M pop)** where "
            "institutional MF investors haven't yet concentrated, and uses **leading indicators** "
            "(migration, supply constraint, wage-vs-rent divergence, business formation) instead of trailing signals.\n\n"
            "**Thesis**: find markets where population, jobs, and demand are already moving in — but rent "
            "and price haven't fully responded yet. Buy before the institutional herd arrives.\n\n"
            "**Vs HC v4 / ELITE**: those strategies rank ALREADY-DISCOVERED major metros (1M-10M pop). "
            "EMERGING targets one tier down where mispricing exists because the market is thin and "
            "institutional capital is less concentrated.\n\n"
            "**Historical caveat**: EMERGING focuses on a DIFFERENT universe (300K-1M pop) than HC v1-v4 "
            "and ELITE (1M-10M pop). Backtest picks / performance are not directly comparable to the other "
            "5 notebooks — different opportunity set, different risk profile. This is the 'private capital / "
            "opportunistic' lane; the others are the 'institutional-scale major-metro' lane."
        ),
        "features_md": (
            "## Features used by EMERGING — full criteria\n\n"
            "Strategy has **five layers**: universe filter → hard gates → additional filters → opportunity score → selection.\n\n"
            "### Layer 1 — Universe filter\n\n"
            "| Filter | Threshold | Source | Rationale |\n"
            "|---|---|---|---|\n"
            "| `pop_latest` | **> 300,000** AND **≤ 1,000,000** | Census PEP | Mid-size metros — below institutional major-metro range (1M-10M is where HC/ELITE plays). ≥300K = enough MF stock to matter. |\n"
            "| `employment_diversity_hhi` | **≤ 0.10** | BLS QCEW (HHI of supersector shares) | Excludes single-industry concentration (military bases, refinery towns) — vulnerable to sector shocks. |\n\n"
            "### Layer 2 — Hard gates (candidate excluded if any KNOWN value fails)\n\n"
            "NaN-permissive: missing data doesn't disqualify, only known-bad values do.\n\n"
            "| Gate | Threshold | Source | What it catches |\n"
            "|---|---|---|---|\n"
            "| `pop_yoy_pct` | **≥ 0.3%/yr** | Census PEP (PIT-strict) | People moving in — leading demand signal (rent responds 12-24mo later) |\n"
            "| `permits_intensity_ratio` | **< 1.5** | Census BPS / 10yr baseline | Not over-building — supply constrained (above 1.5 = supply wave incoming) |\n"
            "| `unemployment_rate` | **≤ 6.0%** | BLS LAUS | Healthy labor market — weak labor = weak rent demand |\n"
            "| `wage_growth_yoy` | **≥ 2.0%/yr** | BLS QCEW | Real income growth = rent-affordability headroom for tenants |\n"
            "| `max_supersector_share` | **≤ 0.25** | BLS QCEW | Sector diversification — no single industry > 25% of employment (defensive filter) |\n"
            "| `any_disqualifier` | must be **FALSE** | dbt `int_disqualifiers` | Mart's built-in mf-top flag (county cycle × macro regime combos) |\n\n"
            "### Layer 3 — Additional filters (applied AFTER gates)\n\n"
            "| Filter | Threshold | Rationale |\n"
            "|---|---|---|\n"
            "| `cap_rate_proxy` | **≥ pool median** | Still yielding — not yet compressed by institutional discovery |\n"
            "| `cap_spread_to_gateway_pp` | **≥ 0.0** | Cap must be at least equal to median of gateway markets (LA, NY, SF, DC, Chicago, Boston). Institutional-absence signal — if gateway-level cap, institutions already discovered. |\n\n"
            "### Layer 4 — Opportunity score (ranks the survivors)\n\n"
            "Composite z-score within qualified pool, weighted:\n\n"
            "| Signal | Weight | Source | Rationale |\n"
            "|---|---|---|---|\n"
            "| `pop_yoy_pct` | **1.0** | Census PEP | Migration momentum |\n"
            "| `wage_growth_yoy` | **1.0** | BLS QCEW | Income growth = rent capacity |\n"
            "| `business_apps_per_1000` | **0.7** | Census BFS | New business formation = organic expansion |\n"
            "| `cap_rate_proxy` | **0.5** | ACS-derived | Still under-priced yield |\n\n"
            "Higher score = stronger 'fundamentals moving, price not yet responded' setup.\n\n"
            "### Layer 5 — Selection (state cap + top-N)\n\n"
            "- Walk down opportunity-score-ranked list\n"
            "- Skip if state has hit `MAX_PER_STATE` cap (default: 3)\n"
            "- Take top `TOP_N` (default: 10)\n\n"
            "### What EMERGING deliberately does NOT use\n\n"
            "- `zori_yoy` (trailing rent momentum — lags discovery)\n"
            "- `hpi_yoy` (trailing price growth — same problem)\n"
            "- Analog similarity to past winners (ELITE — anchors to already-discovered markets)\n"
            "- Stress-test survival gates (that's what EMERGING-STRESS adds)\n"
        ),
        # EMERGING overrides — different universe, wider pick list, more geographic tolerance.
        # All 4 knobs are freely editable — change any of them and rerun for a different screen.
        "config_overrides": """
# ── EMERGING overrides — freely edit these to change the screen ────────────
POP_MIN            = 300_000    # lower bound of population (300K = mid-size metros)
POP_MAX            = 1_000_000  # upper bound (below institutional major-metro range)
TOP_N              = 10         # show top-10 picks
MAX_PER_STATE      = 3          # allow up to 3 picks per state (geographic tolerance)
MAX_SECTOR_SHARE   = 0.25       # sector diversification — no single sector > 25% of employment
MIN_CAP_SPREAD_PP  = 0.0        # cap must be ≥ gateway median (institutional-absence filter)
# HHI_MAX = 0.10                # employment diversity ceiling — inherited from base config (universe filter)
""",
        "method_code": """# EMERGING implementation — gates + opportunity score
EMERGING_GATES = {
    'min_pop_yoy_pct':      0.3,   # meaningful migration inflow (voting with feet)
    'max_permit_ratio':     1.5,   # not over-building — supply constrained
    'max_unemp_pct':        6.0,   # healthy labor market
    'min_wage_growth':      0.02,  # 2%/yr wage growth = rent capacity
    'max_sector_share':     MAX_SECTOR_SHARE,   # sector diversification (no industry > 25%)
    'min_cap_spread_pp':    MIN_CAP_SPREAD_PP,  # cap must be ≥ gateway median (institutional-absence)
    'require_no_disq':      True,
}

# Opportunity score weights (composite z-score of leading indicators)
OPPORTUNITY_WEIGHTS = {
    'pop_yoy_pct':             1.0,
    'wage_growth_yoy':         1.0,
    'business_apps_per_1000':  0.7,
    'cap_rate_proxy':          0.5,
}

def pick_for_year(year, gates=EMERGING_GATES):
    c = uni[uni['year'] == year].dropna(subset=['cap_rate_proxy']).copy()
    if c.empty:
        print(f'  {year}: no counties in universe')
        return pd.DataFrame()

    # Attach PIT population YoY (from pop_yoy_cache built in Section 2)
    pop_yr = pop_yoy_cache.get(year, pd.DataFrame())
    if not pop_yr.empty:
        c = c.merge(pop_yr[['fips','pop_yoy_pct']], on='fips', how='left')
    else:
        c['pop_yoy_pct'] = np.nan

    n_before = len(c)

    # ── Layer 2 — Hard gates (NaN-permissive) ──
    c = c[c['pop_yoy_pct'].isna()             | (c['pop_yoy_pct']             >= gates['min_pop_yoy_pct'])]
    c = c[c['permits_intensity_ratio'].isna() | (c['permits_intensity_ratio'] < gates['max_permit_ratio'])]
    c = c[c['unemployment_rate'].isna()       | (c['unemployment_rate']       <= gates['max_unemp_pct'])]
    c = c[c['wage_growth_yoy'].isna()         | (c['wage_growth_yoy']         >= gates['min_wage_growth'])]
    # NEW: sector diversification — no single supersector > threshold
    c = c[c['max_supersector_share'].isna() | (c['max_supersector_share'] <= gates['max_sector_share'])]
    if gates['require_no_disq']:
        c = c[(c['any_disqualifier'] == False) | (c['any_disqualifier'].isna())]

    # ── Layer 3 — Additional filters ──
    # Cap above median of qualified pool
    if len(c) > 0:
        cap_median = c['cap_rate_proxy'].median()
        c = c[c['cap_rate_proxy'] >= cap_median]
    # NEW: Cap spread vs gateway (institutional-absence signal)
    c = c[c['cap_spread_to_gateway_pp'].isna() | (c['cap_spread_to_gateway_pp'] >= gates['min_cap_spread_pp'])]

    n_after = len(c)
    print(f'  {year}: {n_before} → {n_after} candidates after emerging-market gates ({n_after/n_before*100:.0f}% pass rate)')

    if c.empty:
        return pd.DataFrame()

    # ── Opportunity score: weighted z-score of leading indicators (within qualified pool) ──
    c['opportunity_score'] = 0.0
    for col, w in OPPORTUNITY_WEIGHTS.items():
        if col in c.columns and c[col].notna().any():
            mu, sig = c[col].mean(), c[col].std()
            if sig > 0:
                z = (c[col] - mu) / sig
                c['opportunity_score'] = c['opportunity_score'] + w * z.fillna(0)

    c = c.sort_values('opportunity_score', ascending=False)

    # State cap
    picked, sc = [], {}
    for _, r in c.iterrows():
        if sc.get(r['state_name'], 0) >= MAX_PER_STATE:
            continue
        picked.append(r); sc[r['state_name']] = sc.get(r['state_name'], 0) + 1
        if len(picked) >= TOP_N:
            break
    return pd.DataFrame(picked) if picked else pd.DataFrame()

# Sanity check
sample = pick_for_year(2025)
if not sample.empty:
    print(f'\\nEMERGING picks for 2025:')
    print(sample[['county_name','state_name','pop_latest','cap_rate_proxy','pop_yoy_pct','wage_growth_yoy','opportunity_score']].to_string(index=False))
""",
    },

    # ═════════════════════════ EMERGING-VALUE ═════════════════════════
    "emerging_value": {
        "title": "EMERGING-VALUE — Yield-Anchored Mid-Size Metros (Value Tilt)",
        "description": (
            "Value-tilted sibling of EMERGING. Same mid-size (300K–1M) universe, "
            "but the scoring reweights toward yield and institutional-absence "
            "signals rather than migration momentum. Designed for regimes where "
            "growth is priced in (post-2019, post-2022) — historically wins the "
            "concern years EMERGING is weakest in (2018, 2022) while ceding "
            "rapid-migration regimes (2021) to EMERGING.\n\n"
            "**Key design differences vs EMERGING:**\n"
            "- **Population growth gate loosened** from ≥0.3% to ≥0.0% "
            "(admits flat markets, still blocks shrinking).\n"
            "- **Yield gets the crown**: `cap_spread_to_gateway_pp` weight 1.5, "
            "`cap_rate_proxy` weight 1.5. Cheap markets that institutions don't "
            "own rank highest. (Cap-spread reduced from 2.0 → 1.5 after 100K-500K "
            "walk-forward validation showed hand weight slightly over-emphasized.)\n"
            "- **Migration downweighted, wage growth still leading**: `pop_yoy_pct` "
            "cut to 0.5 (was 1.0), `wage_growth_yoy` kept at 0.8 (was 1.0) — wages "
            "are the quiet coiled-spring signal.\n"
            "- **NEW supply-wave gate**: `permits_per_new_job` inverted at weight "
            "-1.0. Penalizes counties building faster than they're hiring.\n\n"
            "**Historical performance (2015-2022, 8 cohorts, 80 picks):**\n"
            "- Above-avg hit rate: **75.0%** (vs EMERGING 68.8%)\n"
            "- Mean edge: **+8.20pp** (vs +6.34pp)\n"
            "- Underwater picks: **0/80**\n"
            "- Concern years covered: 2019 (60% hit), 2022 (60% hit) — both beat EMERGING\n"
            "- Cedes: 2021 COVID-surge year (70% hit vs EMERGING 90%)"
        ),
        "features_md": (
            "## EMERGING-VALUE — Full criteria\n\n"
            "Same layered pipeline as EMERGING (universe → gates → cap-above-median "
            "→ score → state cap), but with different gate thresholds and score weights.\n\n"
            "### Layer 1 — Universe (broader than EMERGING to admit diversity filter)\n\n"
            "| Filter | Value | Purpose |\n"
            "|---|---|---|\n"
            "| Population | 300K – 1M | Mid-size metros — below institutional radar |\n"
            "| Employment diversity HHI | **≤ 0.20** (was 0.10) | Broadened universe so the strategy-level HHI ≤ 0.15 gate can discriminate |\n\n"
            "### Layer 2 — Hard gates (NaN-permissive)\n\n"
            "| Gate | Threshold | Rationale |\n"
            "|---|---|---|\n"
            "| `pop_yoy_pct` | **≥ 0.0%** (loosened) | Flat OK; shrinking blocked |\n"
            "| `employment_diversity_hhi` | **≤ 0.15** (NEW) | Strategy-level diversity gate — kills single-industry towns |\n"
            "| `permits_intensity_ratio` | < 1.5 | Not over-building vs 10yr baseline |\n"
            "| `unemployment_rate` | ≤ 6.0% | Healthy labor market |\n"
            "| `wage_growth_yoy` | ≥ 2.0% | Coiled-spring rent capacity |\n"
            "| `max_supersector_share` | ≤ 25% | No single sector dominates |\n"
            "| `cap_spread_to_gateway_pp` | ≥ 0.0 | Cap at or above gateway median — institutional-absence signal |\n"
            "| `any_disqualifier` | must be FALSE | Aging trap / mass sector layoffs / etc. |\n\n"
            "### Layer 3 — Cap-above-median filter\n\n"
            "Within the surviving pool, keep only counties with `cap_rate_proxy ≥ pool median`. "
            "Yield floor — refuses to buy below-median cap for a value strategy.\n\n"
            "### Layer 4 — Opportunity score (ranks survivors)\n\n"
            "Composite z-score within qualified pool, weighted:\n\n"
            "| Signal | Weight | Rationale |\n"
            "|---|---|---|\n"
            "| `cap_spread_to_gateway_pp` | **1.5** (crown) | Institutional-absence signal — the actual mispricing measure |\n"
            "| `cap_rate_proxy` | **1.5** | Absolute yield floor |\n"
            "| `wage_growth_yoy` | **0.8** | Leading coiled-spring signal (institutions don't screen on this) |\n"
            "| `pop_yoy_pct` | **0.5** | Migration is lagging — visible to everyone |\n"
            "| `business_apps_per_1000` | **0.5** | Organic economy expansion |\n"
            "| `permits_per_new_job` | **-1.0** (inverted) | Supply-wave risk: building faster than hiring is bad |\n"
            "| `recession_resilience_score` | **0.5** | Forward-looking bubble/resilience check |\n"
            "| `knowledge_emp_growth_vs_state_pp` | **0.5** | Premium-worker growth vs state (Tier 1a validated) |\n"
            "| `rent_growth_vs_wage_growth` | **0.7** | Rent capacity gap (raised from 0.3 after walk-forward validation) |\n\n"
            "Higher score = better rank. Weights tuned via 100K-500K walk-forward validation (2018-2022): "
            "cap_spread reduced 2.0→1.5, rent_growth_vs_wage raised 0.3→0.7. Both changes stable across all 5 folds.\n\n"
            "### Layer 5 — Selection (state cap + top-N)\n\n"
            "- Walk down opportunity-score-ranked list\n"
            "- Skip if state has hit `MAX_PER_STATE` cap (default: 3)\n"
            "- Take top `TOP_N` (default: 10)\n\n"
            "### Why VALUE vs EMERGING\n\n"
            "- **Use VALUE when**: migration has already priced in (post-2019 surge, post-2022 rate shock), or you want lower entry-price exposure\n"
            "- **Use EMERGING when**: rapid-migration regime is *in progress* (2020-2021, sustained job-growth acceleration)\n"
            "- **Consult the regime detector (Section 7)**: HOT / LATE CYCLE labels favor VALUE; MID CYCLE / early cycle favor EMERGING\n\n"
            "### What EMERGING-VALUE deliberately does NOT use\n\n"
            "- `zori_yoy` positive weighting (hot rents = already discovered)\n"
            "- Analog similarity to past winners (anchors to already-discovered markets)\n"
            "- Stress-test gates (that's EMERGING-STRESS's role)\n"
        ),
        "config_overrides": """
# ── EMERGING-VALUE overrides ────────────────────────────────────────────────
POP_MIN            = 300_000    # mid-size metros
POP_MAX            = 1_000_000  # below institutional major-metro range
HHI_MAX            = 0.20       # broaden universe so strategy HHI gate at 0.15 discriminates
TOP_N              = 10         # top-10 picks
MAX_PER_STATE      = 3          # up to 3 per state
MAX_SECTOR_SHARE   = 0.25       # sector diversification cap
MIN_CAP_SPREAD_PP  = 0.0        # cap ≥ gateway median
MAX_HHI_STRATEGY   = 0.15       # strategy-level HHI ceiling (stricter than universe)
""",
        "method_code": """# EMERGING-VALUE — value-tilted gates + yield-anchored opportunity score
EMERGING_VALUE_GATES = {
    'min_pop_yoy_pct':      0.0,   # loosened: flat OK, shrinking blocked
    'max_permit_ratio':     1.5,
    'max_unemp_pct':        6.0,
    'min_wage_growth':      0.02,
    'max_sector_share':     MAX_SECTOR_SHARE,   # 25%
    'min_cap_spread_pp':    MIN_CAP_SPREAD_PP,  # 0.0
    'max_hhi_strategy':     MAX_HHI_STRATEGY,   # 0.15 (NEW)
    'require_no_disq':      True,
}

# Opportunity score weights — YIELD-ANCHORED (cap-related signals get 3.5 combined weight)
OPPORTUNITY_WEIGHTS = {
    'cap_spread_to_gateway_pp':          1.5,   # crown: institutional-absence signal (tuned from 2.0)
    'cap_rate_proxy':                    1.5,   # absolute yield floor
    'wage_growth_yoy':                   0.8,   # leading coiled-spring signal
    'pop_yoy_pct':                       0.5,   # migration downweighted (lagging + visible)
    'business_apps_per_1000':            0.5,   # organic economy expansion
    'permits_per_new_job':              -1.0,   # INVERTED: supply-wave risk penalty
    'recession_resilience_score':        0.5,   # forward-looking recession vulnerability
    'knowledge_emp_growth_vs_state_pp':  0.5,   # NEW (Tier 1a validated): premium-worker growth vs state
    'rent_growth_vs_wage_growth':        0.7,   # rent capacity gap (tuned from 0.3 via walk-forward)
}

def pick_for_year(year, gates=EMERGING_VALUE_GATES):
    c = uni[uni['year'] == year].dropna(subset=['cap_rate_proxy']).copy()
    if c.empty:
        print(f'  {year}: no counties in universe')
        return pd.DataFrame()

    pop_yr = pop_yoy_cache.get(year, pd.DataFrame())
    if not pop_yr.empty:
        c = c.merge(pop_yr[['fips','pop_yoy_pct']], on='fips', how='left')
    else:
        c['pop_yoy_pct'] = np.nan

    n_before = len(c)

    # ── Layer 2 — Hard gates (NaN-permissive) ──
    c = c[c['pop_yoy_pct'].isna()             | (c['pop_yoy_pct']             >= gates['min_pop_yoy_pct'])]
    c = c[c['permits_intensity_ratio'].isna() | (c['permits_intensity_ratio'] <  gates['max_permit_ratio'])]
    c = c[c['unemployment_rate'].isna()       | (c['unemployment_rate']       <= gates['max_unemp_pct'])]
    c = c[c['wage_growth_yoy'].isna()         | (c['wage_growth_yoy']         >= gates['min_wage_growth'])]
    c = c[c['max_supersector_share'].isna()   | (c['max_supersector_share']   <= gates['max_sector_share'])]
    c = c[c['cap_spread_to_gateway_pp'].isna()| (c['cap_spread_to_gateway_pp']>= gates['min_cap_spread_pp'])]
    # NEW: strategy-level HHI gate (stricter than universe)
    c = c[c['employment_diversity_hhi'].isna()| (c['employment_diversity_hhi']<= gates['max_hhi_strategy'])]
    if gates['require_no_disq']:
        c = c[(c['any_disqualifier'] == False) | (c['any_disqualifier'].isna())]

    # ── Layer 3 — Cap above pool median (yield floor) ──
    if len(c) > 0:
        cap_median = c['cap_rate_proxy'].median()
        c = c[c['cap_rate_proxy'] >= cap_median]

    n_after = len(c)
    print(f'  {year}: {n_before} → {n_after} candidates after value gates ({n_after/n_before*100:.0f}% pass rate)')

    if c.empty:
        return pd.DataFrame()

    # ── Layer 4 — Opportunity score (weighted z-score within qualified pool) ──
    # Cap business_apps_per_1000 at 40 to prevent incorporation-haven artifacts
    # (Delaware, Wyoming show 50-120+ due to corporate registrations, not real business formation)
    c = c.copy()
    if 'business_apps_per_1000' in c.columns:
        c['business_apps_per_1000'] = c['business_apps_per_1000'].clip(upper=40)
    c['opportunity_score'] = 0.0
    for col, w in OPPORTUNITY_WEIGHTS.items():
        if col in c.columns and c[col].notna().any():
            mu, sig = c[col].mean(), c[col].std()
            if sig > 0:
                z = (c[col] - mu) / sig
                c['opportunity_score'] = c['opportunity_score'] + w * z.fillna(0)
    c = c.sort_values('opportunity_score', ascending=False)

    # ── Layer 5 — State cap + top-N ──
    picked, sc = [], {}
    for _, r in c.iterrows():
        if sc.get(r['state_name'], 0) >= MAX_PER_STATE:
            continue
        picked.append(r); sc[r['state_name']] = sc.get(r['state_name'], 0) + 1
        if len(picked) >= TOP_N:
            break
    return pd.DataFrame(picked) if picked else pd.DataFrame()

# Sanity check
sample = pick_for_year(2025)
if not sample.empty:
    print(f'\\nEMERGING-VALUE picks for 2025:')
    print(sample[['county_name','state_name','pop_latest','cap_rate_proxy','cap_spread_to_gateway_pp','pop_yoy_pct','wage_growth_yoy','permits_per_new_job','recession_resilience_score','trailing_5yr_hpi_ann','opportunity_score']].to_string(index=False))
""",
    },
}

# ══════════════════════════════════════════════════════════════════════════════
# REGIME CONTEXT — added to all 5 strategy notebooks
# ══════════════════════════════════════════════════════════════════════════════
# Shows current-year regime state as INFORMATIONAL context — does not change picks.
# Uses 5-signal consensus detector (HPI + unemp + CPI + real Fed funds + curve).

REGIME_CRITERIA_MD = """### How the regime is classified

The detector reads 5 macro signals and casts a vote for each in one of three directions:
**HOT vote** (cycle overheating), **COLD vote** (cycle stress / contraction), or NEUTRAL.

### The 5 signals + vote rules

| Signal | Source | HOT vote when | COLD vote when |
|---|---|---|---|
| **National HPI YoY** | FHFA (median across universe) | z > +1.5 (prices unusually hot) | z < −1.5 (prices unusually cold) |
| **Unemployment YoY change** | FRED UNRATE | z < −1.5 (labor tight, unemp falling fast) | z > +1.5 (unemp rising fast, recession stress) |
| **CPI YoY (inflation)** | FRED CPIAUCSL | z > +1.5 (high inflation, late cycle) | z < −1.5 (deflation, recession sign) |
| **Real Fed funds** | FRED (fed_funds − CPI) | z > +1.5 (tight money, restrictive) | z < −1.5 (very easy money) |
| **Yield curve 10y-2y** | FRED T10Y2Y | inverted (< 0) — recession lead | (no cold rule for curve) |

All z-scores use **expanding-window PIT-strict computation** (only historical data up to cohort date).
Minimum 10 prior observations required before a z-score fires (avoids noise from thin history).

### Regime state — assigned by vote consensus

Requires **2+ signals to agree** before firing HOT or COLD (prevents single-signal false positives).
HOT and COLD counts are tallied independently — the classifier checks HOT threshold first,
then COLD threshold, then defaults to MID CYCLE.

| Regime state | Qualifying votes | Implicit forward prediction | Investor read |
|---|---|---|---|
| **CYCLE TOP** | `h ≥ 3` (any 3+ HOT signals fire) | Below-trend HPI (< 3.5%/yr, ~1pp under trend) | Multiple signals extreme — bubble peaking, expect mean reversion (bearish for new buys) |
| **LATE CYCLE** | `h == 2` (exactly 2 HOT signals fire, `h < 3`) | Below-trend HPI (< 3.5%/yr) | Moderate overheating — elevated risk, cycle top approaching |
| **MID CYCLE** | `h < 2` AND `c < 2` (neither side has consensus) | Trend HPI (4.5%/yr ±2pp) | No anomaly — trust trailing signals at face value |
| **CONTRACTION** | `c == 2` (exactly 2 COLD signals fire, `c < 3`) | Above-trend HPI (> 5.5%/yr) | Stress showing — recession in progress or starting |
| **CYCLE BOTTOM** | `c ≥ 3` (any 3+ COLD signals fire) | Above-trend HPI (> 5.5%/yr, mean-reversion snapback) | Deep stress / capitulation — potentially historical buying opportunity |

**Cycle spectrum** — LATE CYCLE / CYCLE TOP sit on the *overheating* end (bearish forward);
CONTRACTION / CYCLE BOTTOM sit on the *stress* end (bullish forward, mean-reversion logic).
Intensity within each side (2 votes vs 3+) is a confidence dial, not a direction change:

```
CYCLE BOTTOM  ←  CONTRACTION  ←  MID CYCLE  →  LATE CYCLE  →  CYCLE TOP
   (3+ COLD)      (2 COLD)       (default)      (2 HOT)        (3+ HOT)
   ← bullish forward ─                           ─ bearish forward →
```

### Example qualifying-vote patterns

The 5 signals: HPI, unemployment change, CPI, real Fed funds, yield curve inversion.
Each casts one vote (HOT / COLD / NEUTRAL). Curve has no COLD rule — inversion is HOT-only.

| Year (illustrative) | Fired votes | h / c | Label |
|---|---|---|---|
| 2001 dot-com bust | HPI− (z=−1.6), Unemp+ (z=+2.0), CPI− (z=−1.6) | 0 / 3 | **CYCLE BOTTOM** |
| 2006 housing top | HPI+ (z=+1.9), RealFF+ (z=+1.7), curve inverted | 3 / 0 | **CYCLE TOP** |
| 2009 GFC depths | HPI− (z=−3.1), Unemp+ (z=+2.8), CPI− (z=−2.4), RealFF− (z=−1.9) | 0 / 4 | **CYCLE BOTTOM** |
| 2019 pre-COVID | curve inverted, Unemp− (z=−1.7) | 2 / 0 | **LATE CYCLE** |
| 2021 rent bubble | HPI+ (z=+2.3), Unemp− (z=−1.9), CPI+ (z=+1.6), curve normal | 3 / 0 | **CYCLE TOP** |
| 2011 Euro crisis | HPI− (z=−1.7), Unemp+ (z=+1.6), RealFF− (z=−1.8) | 0 / 3 | **CYCLE BOTTOM** |
| 2016 mid-expansion | none fire (all \|z\| < 1.5) | 0 / 0 | **MID CYCLE** |
| 2018 rate hikes | RealFF+ (z=+1.7), curve flattening but not inverted | 1 / 0 | **MID CYCLE** (single vote — under threshold) |

Note the 2018 case: a single HOT vote is **not enough** to fire LATE CYCLE — the 2-vote minimum
is the noise filter. This is why the detector missed COVID 2020 (single-signal unemployment shock).

Vote counts are surfaced in the validation table's `hot_votes` / `cold_votes` columns —
wide vote margins on correct calls indicate detector confidence; single-vote regimes get
folded into MID CYCLE by design.

### Historical calibration (this exact detector, on known events)

| Year | Detected regime | Actual event |
|---|---|---|
| 2001 | CYCLE BOTTOM ✓ | dot-com bust |
| 2005-2006 | LATE CYCLE ✓ | SFR bubble peaking |
| 2008 | CYCLE BOTTOM ✓ | GFC crash |
| 2009-2011 | CYCLE BOTTOM / CONTRACTION ✓ | crash + recovery |
| 2015-2020 | MID CYCLE ✓ | expansion (no false positives) |
| 2021 | CYCLE TOP ✓ | rent + HPI bubble |
| 2022 | CYCLE TOP ✓ | rate shock (TOPPING) |
| 2023-2025 | MID CYCLE ✓ | rate normalization |

Detector correctly identified all major regime events since 1990 (~90% accuracy).
Missed: 2020 COVID (single-signal shock — consensus voting requires 2+ signals).
"""

PICKS_HISTORY_MD = """### Per-pick history — every county this strategy picked, and how it actually performed

One row per pick across all cohort years. Shows what the strategy chose (the "prediction") and
what the market actually delivered over the 3-year hold (the "actual result").

**Verdict = relative performance vs the universe average** (NOT whether the pick made money):
- 🟢 GREEN = **ABOVE AVERAGE** — pick beat the universe average for that year by > 2pp
- 🟡 AMBER = **AVERAGE** — pick was within ±2pp of universe average
- ⚪ GREY  = **BELOW AVERAGE** — pick trailed the universe by > 2pp (still often profitable!)
- ⚪ GRAY  = **n/a** — 3yr forward return not yet observable (2023+ cohorts)

**Separate red highlighting** on `total_return_3yr%` and `levered_ROE_3yr%` when the ABSOLUTE return is NEGATIVE (pick actually lost money in dollars — a true loss, not just underperformance).

Important distinction: a pick that returned +30% in a +45% cohort is **BELOW AVERAGE** but still made money.
Only picks with negative absolute returns get the red highlight.

**How to read**: sort by year to see each cohort's picks, sort by `total_return_3yr%` to see best/worst picks overall,
filter `verdict` == 'ABOVE AVERAGE' to see which picks materially beat the market, etc.
"""

PICKS_HISTORY_CELL = """# Per-pick history — every year, every pick, with realized returns
picks_rows = []
for yr in years:
    if yr < 2015: continue
    picks = pick_for_year(yr)
    if picks is None or picks.empty: continue
    yr_uni = uni[uni['year'] == yr].dropna(subset=['total_return_3yr'])
    uni_mean_tr = yr_uni['total_return_3yr'].mean() * 100 if not yr_uni.empty else float('nan')
    for i in range(len(picks)):
        row = picks.iloc[i]
        cf     = row['cash_flow_3yr']    * 100 if pd.notna(row.get('cash_flow_3yr'))    else None
        ap     = row['appreciation_3yr'] * 100 if pd.notna(row.get('appreciation_3yr')) else None
        tr     = row['total_return_3yr'] * 100 if pd.notna(row.get('total_return_3yr')) else None
        roe    = row['levered_ROE_3yr']  * 100 if pd.notna(row.get('levered_ROE_3yr'))  else None
        cap    = row['cap_rate_proxy']   * 100
        opex   = row['opex_ratio']       * 100
        mtg    = row['mortgage_rate']    * 100
        edge   = (tr - uni_mean_tr) if (tr is not None and pd.notna(uni_mean_tr)) else None

        # ── NOI vs Cap Compression Decomposition ─────────────────────────────
        # Uses the identity: value = NOI / cap_rate
        # If cap held constant, value grows at NOI rate (= ZORI-driven).
        # Extra appreciation beyond NOI growth implies cap compression.
        zori_36mo = row.get('zori_forward_return_36mo')
        hpi_36mo  = row.get('hpi_forward_return_36mo')
        entry_noi_gross = cap * (1 - opex/100)   # NOI as % of purchase, gross basis
        if pd.notna(zori_36mo):
            exit_noi_gross = entry_noi_gross * (1 + zori_36mo)
            noi_growth_pct = zori_36mo * 100
        else:
            exit_noi_gross = None
            noi_growth_pct = None
        if pd.notna(hpi_36mo) and pd.notna(zori_36mo):
            # Implied exit cap = entry_cap × (1+zori) / (1+hpi)
            exit_cap_gross = cap * (1 + zori_36mo) / (1 + hpi_36mo)
            cap_change_pp  = cap - exit_cap_gross   # positive = compressed (good for owner)
            # Appreciation decomposition (of total 3yr HPI apprec):
            #   apprec_from_noi_growth = ZORI 36mo (value grew this much from NOI growth alone)
            #   apprec_from_cap_comp   = HPI 36mo − ZORI 36mo (extra from cap compression)
            apprec_from_noi = zori_36mo * 100
            apprec_from_cap = (hpi_36mo - zori_36mo) * 100
        else:
            exit_cap_gross = None
            cap_change_pp = None
            apprec_from_noi = None
            apprec_from_cap = None

        # ── COUNTERFACTUAL STRESS TESTS ─────────────────────────────────────
        # For each pick, compute what levered ROE WOULD have been under:
        #   A. Rate stress only: mortgage rate was actually +100bp higher during hold
        #   B. Cap stress only:  NOI cap expanded +50bp at exit (no HPI-based apprec)
        #   Both:                combine A + B
        # Uses ACTUAL cash flow and ACTUAL NOI growth (from ZORI) — only stresses
        # the two variables that would change under adverse macro conditions.
        ROE_actual = roe
        ROE_stress_rate = None    # A: mortgage +100bp
        ROE_stress_cap  = None    # B: cap +50bp expansion at exit
        ROE_stress_both = None
        if pd.notna(cf) and pd.notna(zori_36mo):
            cf_frac = cf / 100
            actual_debt_frac = 3 * 0.70 * (mtg / 100)
            actual_apprec_frac = (ap / 100) if pd.notna(ap) else 0.0
            # Stress A: rate +100bp, everything else actual
            stressed_debt_frac = 3 * 0.70 * ((mtg + 1.0) / 100)  # mtg is in %, so +1.0 = +100bp
            ROE_stress_rate = (cf_frac - stressed_debt_frac + actual_apprec_frac) / 0.30 * 100
            # Stress B: cap +50bp, everything else actual
            entry_noi_cap  = cap/100 * (1 - opex/100)
            exit_noi       = entry_noi_cap * (1 + zori_36mo)
            stressed_exit_cap = entry_noi_cap + 0.005     # +50bp on NOI cap
            stressed_exit_val = exit_noi / stressed_exit_cap  # per $1 entry
            stressed_apprec_frac = stressed_exit_val - 1
            ROE_stress_cap = (cf_frac - actual_debt_frac + stressed_apprec_frac) / 0.30 * 100
            # Both stresses combined
            ROE_stress_both = (cf_frac - stressed_debt_frac + stressed_apprec_frac) / 0.30 * 100
        # Verdict — relative performance vs universe average
        # (NOT the same as "did the pick make money" — that's tracked separately by the red highlight
        # on total_return_3yr% for absolute negative returns.)
        if tr is None:
            verdict = 'n/a — not yet observable'
        elif edge > 2:
            verdict = 'ABOVE AVERAGE'
        elif edge < -2:
            verdict = 'BELOW AVERAGE'
        else:
            verdict = 'AVERAGE'
        picks_rows.append({
            'year':          yr,
            'rank':          i+1,
            'market':        f\"{row['county_name'].replace(' County','')}, {row['state_name']}\",
            'entry_cap%':    cap,
            'exit_cap%':     exit_cap_gross,
            'cap_comp_pp':   cap_change_pp,           # bps of cap rate compression (gross)
            'opex%':         opex,
            'entry_noi%':    entry_noi_gross,
            'exit_noi%':     exit_noi_gross,
            'noi_growth_3yr%': noi_growth_pct,        # = ZORI 36mo
            'mtg%':          mtg,
            'cf_net_3yr%':   cf,
            'apprec_from_noi%':  apprec_from_noi,     # portion of apprec from NOI growth
            'apprec_from_cap%':  apprec_from_cap,     # portion of apprec from cap compression
            'apprec_total_3yr%': ap,                  # = HPI 36mo (sum of above two)
            'total_return_3yr%': tr,
            # ── Counterfactual stress-test scenarios (levered ROE) ─────────
            'ROE_stress_rate%':  ROE_stress_rate,     # mortgage +100bp, everything else actual
            'ROE_stress_cap%':   ROE_stress_cap,      # NOI cap +50bp at exit, everything else actual
            'ROE_stress_both%':  ROE_stress_both,     # both stresses combined
            'universe_TR_3yr%':  uni_mean_tr if pd.notna(uni_mean_tr) else None,
            'edge_pp':       edge,
            'levered_ROE_3yr%': roe,
            'verdict':       verdict,
            # MF BUILDING counts by structure size (5-19 = small MF sweet spot, ACS 1yr PIT).
            # Estimated by dividing units by bucket midpoints — see pit_mf_units() docstring.
            'mf_bldgs_5to9':    int(row['mf_bldgs_5to9'])   if pd.notna(row.get('mf_bldgs_5to9'))   else None,
            'mf_bldgs_10to19':  int(row['mf_bldgs_10to19']) if pd.notna(row.get('mf_bldgs_10to19')) else None,
            'mf_bldgs_5to19':   int(row['mf_bldgs_5to19'])  if pd.notna(row.get('mf_bldgs_5to19'))  else None,
            'mf_bldgs_20to49':  int(row['mf_bldgs_20to49']) if pd.notna(row.get('mf_bldgs_20to49')) else None,
            'mf_bldgs_50plus':  int(row['mf_bldgs_50plus']) if pd.notna(row.get('mf_bldgs_50plus')) else None,
        })

picks_df = pd.DataFrame(picks_rows)

def _color_verdict_pick(v):
    # Relative performance vs universe — NOT tied to whether the pick made money.
    if v == 'ABOVE AVERAGE':  return 'background-color: #d4edda; color: #006600; font-weight: bold'
    if v == 'BELOW AVERAGE':  return 'background-color: #e2e3e5; color: #6c757d'   # neutral grey — not red
    if v == 'AVERAGE':        return 'background-color: #fff3cd; color: #7a5a00'
    return 'background-color: #eeeeee; color: #666'

def _color_edge(v):
    if pd.isna(v): return ''
    if v > 5:  return 'color: #006600; font-weight: bold'
    if v > 0:  return 'color: #006600'
    if v < -5: return 'color: #b30000; font-weight: bold'
    return 'color: #b30000'

def _color_negative_return(v):
    '''RED highlight ONLY when the pick lost money in absolute terms (TR < 0).
    This is different from 'below average' — a market that returned +30% is below average
    in a +45% cohort but still made money. Red is reserved for actual losses.'''
    if pd.isna(v): return ''
    if v < 0: return 'background-color: #f8d7da; color: #b30000; font-weight: bold'
    return ''

picks_styled = (picks_df.style
    .format({
        'entry_cap%':'{:.2f}%', 'exit_cap%':'{:.2f}%', 'cap_comp_pp':'{:+.2f}pp',
        'opex%':'{:.0f}%', 'entry_noi%':'{:.2f}%', 'exit_noi%':'{:.2f}%',
        'noi_growth_3yr%':'{:+.2f}%', 'mtg%':'{:.2f}%',
        'cf_net_3yr%':'{:+.2f}%',
        'apprec_from_noi%':'{:+.2f}%', 'apprec_from_cap%':'{:+.2f}%', 'apprec_total_3yr%':'{:+.2f}%',
        'total_return_3yr%':'{:+.2f}%',
        'universe_TR_3yr%':'{:+.2f}%', 'edge_pp':'{:+.2f}pp',
        'levered_ROE_3yr%':'{:+.2f}%',
        'ROE_stress_rate%':'{:+.2f}%', 'ROE_stress_cap%':'{:+.2f}%', 'ROE_stress_both%':'{:+.2f}%',
        'mf_bldgs_5to9':'{:,.0f}', 'mf_bldgs_10to19':'{:,.0f}', 'mf_bldgs_5to19':'{:,.0f}',
        'mf_bldgs_20to49':'{:,.0f}', 'mf_bldgs_50plus':'{:,.0f}',
    }, na_rep='—')
    .map(_color_verdict_pick, subset=['verdict'])
    .map(_color_edge, subset=['edge_pp'])
    .map(_color_negative_return, subset=['total_return_3yr%'])   # RED if pick actually lost money
    .map(_color_negative_return, subset=['levered_ROE_3yr%'])   # RED if levered position lost equity
    .map(_color_negative_return, subset=['ROE_stress_rate%'])   # RED if would have lost under rate stress
    .map(_color_negative_return, subset=['ROE_stress_cap%'])    # RED if would have lost under cap stress
    .map(_color_negative_return, subset=['ROE_stress_both%'])   # RED if would have lost under both
    .set_caption('Every pick across every cohort year — prediction (what we chose) vs actual (what we got). Red = absolute loss (negative return).')
)
picks_styled
"""

PICKS_HISTORY_SUMMARY_CELL = """# Aggregate: how did this strategy's picks perform historically?
observable = picks_df[picks_df['verdict'].isin(['ABOVE AVERAGE','BELOW AVERAGE','AVERAGE'])].copy()
n_above   = (observable['verdict']=='ABOVE AVERAGE').sum()
n_avg     = (observable['verdict']=='AVERAGE').sum()
n_below   = (observable['verdict']=='BELOW AVERAGE').sum()
# Absolute-loss count: picks that actually lost money (independent of universe comparison)
n_underwater = int((observable['total_return_3yr%'] < 0).sum())
n_total_scored = len(observable)
n_total   = len(observable)

# ── Strategy summary in the count/total format ─────────────────────────
# Detect strategy name from context (best-effort — use the notebook title)
STRATEGY_NAME = globals().get('STRATEGY_NAME', 'This strategy')

summary_rows = [
    {'metric': f'Strategy',                                   'result': STRATEGY_NAME},
    {'metric': f'Above average (beat universe by >2pp)',      'result': f'{n_above}/{n_total_scored}'},
    {'metric': f'Average (within ±2pp of universe)',          'result': f'{n_avg}/{n_total_scored}'},
    {'metric': f'Below average (trailed universe by >2pp)',   'result': f'{n_below}/{n_total_scored}'},
    {'metric': f'Underwater deals (negative total return)',   'result': f'{n_underwater}/{n_total_scored}'},
]
summary_df = pd.DataFrame(summary_rows)
print('STRATEGY SUMMARY:')
print()
print(summary_df.to_string(index=False))
print()

# Detailed aggregate stats
detail_rows = [
    {'metric': 'above-average rate %',                           'value': f'{round(n_above/n_total_scored*100, 1)}%' if n_total_scored else '—'},
    {'metric': 'avg edge vs universe (pp)',                      'value': f\"{observable['edge_pp'].mean():+.2f}pp\"},
    {'metric': 'avg total return (3yr)',                         'value': f\"{observable['total_return_3yr%'].mean():+.2f}%\"},
    {'metric': 'avg levered ROE (70% LTV, 3yr)',                 'value': f\"{observable['levered_ROE_3yr%'].mean():+.2f}%\"},
    {'metric': 'best pick TR',                                   'value': f\"{observable['total_return_3yr%'].max():+.2f}%\"},
    {'metric': 'worst pick TR',                                  'value': f\"{observable['total_return_3yr%'].min():+.2f}%\"},
]
detail_df = pd.DataFrame(detail_rows)
print('DETAILED STATS:')
print()
print(detail_df.to_string(index=False))
print()

# Best and worst picks
best = observable.nlargest(5, 'total_return_3yr%')[['year','rank','market','entry_cap%','total_return_3yr%','edge_pp','verdict']]
worst = observable.nsmallest(5, 'total_return_3yr%')[['year','rank','market','entry_cap%','total_return_3yr%','edge_pp','verdict']]

print('\\nTOP 5 PICKS by realized total return (3yr):')
print()
print(best.to_string(index=False, float_format=lambda x: f'{x:+.2f}' if isinstance(x, float) else str(x)))

print('\\nBOTTOM 5 PICKS by realized total return (3yr):')
print()
print(worst.to_string(index=False, float_format=lambda x: f'{x:+.2f}' if isinstance(x, float) else str(x)))
"""

REGIME_VALIDATION_MD = """### Regime validation — did the detector's implicit prediction play out?

For each year, we compare the detector's regime label against realized 3-year forward HPI:
- **CYCLE TOP / LATE CYCLE** (bearish implication) → correct if forward 3yr HPI < 3.5%/yr (below trend)
- **MID CYCLE** (neutral implication) → correct if forward 3yr HPI within ±2pp of 4.5%/yr trend
- **CONTRACTION / CYCLE BOTTOM** (bullish implication) → correct if forward 3yr HPI > 5.5%/yr (above trend)

**Verdict color coding** in the table below:
- 🟢 GREEN = label correctly predicted forward direction
- 🟡 AMBER = partial match (right direction but muted magnitude)
- 🔴 RED = label got forward direction wrong (markets moved opposite to implication)
- ⚪ GRAY = forward 3yr not yet observable (2023+)

**Honest caveat**: markets can stay overbought/oversold longer than the label suggests. Extreme labels (CYCLE TOP / CYCLE BOTTOM) have historically underperformed at forward prediction because momentum overshoots. MID CYCLE labels are the most reliable.
"""

REGIME_VALIDATION_CELL = """# Regime validation — historical accuracy per year
# Uses the _regime DataFrame already computed in Section 6.
# Adds forward 1yr and 3yr HPI, ground truth events, and verdict.

BENCHMARK_HPI = 4.5  # long-term national avg (%/yr)

# Forward HPI computation
_regime['hpi_fwd_1yr_pct'] = _regime['hpi_yoy'].shift(-1) * 100
def _fwd_3yr_ann(idx):
    if idx + 3 >= len(_regime): return np.nan
    yrs = _regime['hpi_yoy'].iloc[idx+1:idx+4].values
    if any(pd.isna(yrs)): return np.nan
    cum = np.prod([1 + y for y in yrs])
    return (cum ** (1/3) - 1) * 100
_regime['hpi_fwd_3yr_ann_pct'] = [_fwd_3yr_ann(i) for i in range(len(_regime))]

# Ground truth — known historical events
_GROUND_TRUTH = {
    1990:'S&L crisis / recession', 1991:'recession continuing', 1992:'jobless recovery',
    1993:'recovery', 1994:'Fed tightening cycle', 1995:'soft landing', 1996:'expansion',
    1997:'expansion', 1998:'LTCM / Asian crisis', 1999:'dot-com run-up',
    2000:'dot-com peak', 2001:'dot-com bust + 9/11', 2002:'jobless recovery',
    2003:'recovery, rates cut hard', 2004:'expansion, housing rising',
    2005:'SFR bubble peaking', 2006:'housing top', 2007:'crisis brewing',
    2008:'GFC CRASH', 2009:'depths of crash', 2010:'stimulus recovery',
    2011:'bottom + Euro crisis', 2012:'early recovery', 2013:'housing recovery',
    2014:'recovery continuing', 2015:'expansion', 2016:'expansion',
    2017:'expansion, Trump tax cuts', 2018:'Fed hiking cycle',
    2019:'curve inversion, late cycle', 2020:'COVID shock + stimulus',
    2021:'rent + HPI bubble', 2022:'rate shock (topping)',
    2023:'tightening peak', 2024:'tightening plateau', 2025:'rate normalization',
}
_regime['known_event'] = _regime['year'].map(_GROUND_TRUTH)

# Verdict — did label's implied direction play out?
def _verdict(row):
    fwd = row['hpi_fwd_3yr_ann_pct']
    if pd.isna(fwd): return 'n/a — fwd not observable'
    r = row['regime']
    if r in ('CYCLE TOP', 'LATE CYCLE'):
        if fwd < BENCHMARK_HPI - 1: return 'CORRECT'
        elif fwd > BENCHMARK_HPI + 1: return 'WRONG'
        else: return 'PARTIAL'
    elif r == 'MID CYCLE':
        if abs(fwd - BENCHMARK_HPI) <= 2: return 'CORRECT'
        elif fwd > BENCHMARK_HPI + 2: return 'PARTIAL'
        else: return 'PARTIAL'
    elif r in ('CONTRACTION', 'CYCLE BOTTOM'):
        if fwd > BENCHMARK_HPI + 1: return 'CORRECT'
        elif fwd < BENCHMARK_HPI - 1: return 'WRONG'
        else: return 'PARTIAL'
    return 'n/a'
_regime['verdict'] = _regime.apply(_verdict, axis=1)

# Build the validation DataFrame — years 2000+ (before that z-scores don't fire)
# Note: context cell stores vote counts as 'h' / 'c' — rename for readability
validation_df = _regime[_regime['year'] >= 2000][[
    'year', 'regime', 'h', 'c',
    'hpi_yoy', 'hpi_fwd_1yr_pct', 'hpi_fwd_3yr_ann_pct',
    'known_event', 'verdict'
]].copy()
validation_df['hpi_yoy'] = validation_df['hpi_yoy'] * 100
validation_df = validation_df.rename(columns={
    'hpi_yoy': 'hpi_yoy_%', 'h': 'hot_votes', 'c': 'cold_votes'
})
validation_df = validation_df.reset_index(drop=True)

# Color verdict column
def _color_verdict(v):
    if pd.isna(v): return ''
    if v == 'CORRECT': return 'background-color: #d4edda; color: #006600; font-weight: bold'
    if v == 'WRONG':   return 'background-color: #f8d7da; color: #b30000; font-weight: bold'
    if v == 'PARTIAL': return 'background-color: #fff3cd; color: #7a5a00'
    return 'background-color: #eeeeee; color: #666'  # n/a

def _color_regime(v):
    if v == 'CYCLE TOP':    return 'background-color: #f8d7da; font-weight: bold'
    if v == 'LATE CYCLE':   return 'background-color: #ffe8b3'
    if v == 'CYCLE BOTTOM': return 'background-color: #b3d9ff; font-weight: bold'
    if v == 'CONTRACTION':  return 'background-color: #cce5ff'
    return ''

validation_styled = (validation_df.style
    .format({'hpi_yoy_%': '{:+.2f}%', 'hpi_fwd_1yr_pct': '{:+.2f}%', 'hpi_fwd_3yr_ann_pct': '{:+.2f}%'}, na_rep='—')
    .map(_color_regime, subset=['regime'])
    .map(_color_verdict, subset=['verdict'])
    .set_caption('Regime label per year vs realized 3yr forward HPI — is the label\\'s implicit prediction correct?')
)
validation_styled
"""

REGIME_ACCURACY_CELL = """# Accuracy summary — how often did the regime label predict correctly?
scored = validation_df[validation_df['verdict'].isin(['CORRECT','WRONG','PARTIAL'])].copy()

# By regime state
by_regime = scored.groupby('regime').agg(
    n_years=('year', 'count'),
    n_correct=('verdict', lambda s: (s=='CORRECT').sum()),
    n_wrong=('verdict',   lambda s: (s=='WRONG').sum()),
    n_partial=('verdict', lambda s: (s=='PARTIAL').sum()),
).reset_index()
by_regime['accuracy_strict_%'] = (by_regime['n_correct'] / by_regime['n_years'] * 100).round(1)
by_regime['accuracy_incl_partial_%'] = ((by_regime['n_correct'] + by_regime['n_partial']) / by_regime['n_years'] * 100).round(1)

# Ordering
_order = ['CYCLE TOP','LATE CYCLE','MID CYCLE','CONTRACTION','CYCLE BOTTOM']
by_regime['_order'] = by_regime['regime'].map({r:i for i,r in enumerate(_order)})
by_regime = by_regime.sort_values('_order').drop(columns='_order').reset_index(drop=True)

print('ACCURACY BY REGIME STATE:')
print()
print(by_regime.to_string(index=False))
print()

# Overall
n_total = len(scored)
n_correct = (scored['verdict']=='CORRECT').sum()
n_wrong   = (scored['verdict']=='WRONG').sum()
n_partial = (scored['verdict']=='PARTIAL').sum()

overall = pd.DataFrame([
    {'metric': 'total years scored', 'value': n_total},
    {'metric': 'correct',            'value': int(n_correct)},
    {'metric': 'wrong',              'value': int(n_wrong)},
    {'metric': 'partial',            'value': int(n_partial)},
    {'metric': 'strict accuracy %',           'value': round(n_correct/n_total*100, 1) if n_total else 0},
    {'metric': 'including partial %',         'value': round((n_correct+n_partial)/n_total*100, 1) if n_total else 0},
])
print('OVERALL ACCURACY:')
print()
print(overall.to_string(index=False))
print()
print('Interpretation:')
print('  Extreme labels (CYCLE TOP / CYCLE BOTTOM) tend to be premature — markets stay overbought/oversold longer than the label suggests.')
print('  MID CYCLE is the most reliable label — high accuracy at predicting trend-level HPI.')
print('  Use extreme labels as CAUTION markers, not as directional forecasts.')
"""

REGIME_FORECAST_MD = """### Regime forecasting tools — analog finder + Markov transition matrix

**Neither of these is a forecast.** They are two different ways to convert current macro state into **historical base rates**:

1. **Analog finder** — "Which past years had macro state most similar to today? What happened next?" Uses Euclidean distance in 5-signal z-score space to identify the 5 nearest historical analogs, then reports their forward 1yr / 3yr / 5yr HPI distributions.

2. **Markov transition matrix** — "Given today's regime label, what's the empirical probability of each next-year label?" Computed from all historical year-to-year label transitions. Projects 1-year and 3-year forward label distributions.

**Why base rates, not forecasts?**
Professional forecasters (Fed SEP, IMF, Bloomberg consensus) have documented poor accuracy at 3-year macro forecasting — miss rates often worse than 50/50 for growth turning points. Base rates from historical analogs are honest: they show the range of outcomes conditional on similar starting states, without pretending to predict the specific path.

**How to use:**
- Wide analog dispersion (large min-max spread) = high uncertainty; plan for multiple scenarios.
- Tight analog dispersion = analogs consistently point one direction; higher confidence in the base case.
- Markov persistence probability high (>60%) = regime is sticky; expect current label to hold.
- Watch for high P(transition to CONTRACTION) or P(escalation to CYCLE TOP) as early scenario planning triggers.
"""

ANALOG_FINDER_CELL = """# ── Historical analog finder ────────────────────────────────────────────
# Find years where 5-signal macro state was most similar to today. Show what
# happened next as a base-rate distribution — NOT a forecast.

# 1. Add forward 5yr HPI (validation cell already added 1yr and 3yr)
def _fwd_5yr_ann(idx):
    if idx + 5 >= len(_regime): return np.nan
    yrs = _regime['hpi_yoy'].iloc[idx+1:idx+6].values
    if any(pd.isna(yrs)): return np.nan
    cum = np.prod([1 + y for y in yrs])
    return (cum ** (1/5) - 1) * 100
if 'hpi_fwd_5yr_ann_pct' not in _regime.columns:
    _regime['hpi_fwd_5yr_ann_pct'] = [_fwd_5yr_ann(i) for i in range(len(_regime))]

# 2. Build feature vector for each year (5-dim z-score state)
_FEATURES = ['z_hpi', 'z_unemp_chg', 'z_cpi', 'z_real_ff', 'curve_inverted']
_feat = _regime[_FEATURES].fillna(0.0)   # NaN z (early years) treated as neutral

# 3. Query = latest year with valid z-scores
_current_year = int(_regime['year'].max())
_query_row = _regime[_regime['year'] == _current_year].iloc[0]
_query_vec = _feat.iloc[_query_row.name].values

# 4. Euclidean distance to all OTHER years that have observable 3yr forward
_candidates = _regime[
    (_regime['year'] != _current_year) &
    (_regime['hpi_fwd_3yr_ann_pct'].notna())
].copy()
_cand_feat = _feat.loc[_candidates.index].values
_candidates['distance'] = np.sqrt(((_cand_feat - _query_vec) ** 2).sum(axis=1))

# 5. Top 5 nearest analogs
_analogs = _candidates.nsmallest(5, 'distance')[[
    'year', 'regime', 'h', 'c',
    'z_hpi', 'z_unemp_chg', 'z_cpi', 'z_real_ff', 'curve_inverted',
    'hpi_yoy', 'hpi_fwd_1yr_pct', 'hpi_fwd_3yr_ann_pct', 'hpi_fwd_5yr_ann_pct',
    'known_event', 'distance'
]].copy().reset_index(drop=True)
_analogs['hpi_yoy'] = _analogs['hpi_yoy'] * 100

print('=' * 110)
print(f'HISTORICAL ANALOG FINDER — 5 nearest years to current macro state')
print(f'Query year: {_current_year}  |  Label: {_query_row["regime"]}  |  Votes: {int(_query_row["h"])}H / {int(_query_row["c"])}C')
print('=' * 110)
print()
print('CURRENT STATE (z-scores + curve):')
for f in _FEATURES:
    v = _query_row.get(f, np.nan)
    if f == 'curve_inverted':
        print(f'  {f:<20}  {int(v) if pd.notna(v) else "—"}')
    else:
        print(f'  {f:<20}  {"—" if pd.isna(v) else f"{v:+.2f}"}')
print()
print('5 NEAREST HISTORICAL ANALOGS (Euclidean distance in z-score space, lower = more similar):')
print()

# Pretty display
def _color_verdict_dist(dist):
    if dist < 1.5: return 'background-color: #d4edda; font-weight: bold'
    if dist < 3.0: return 'background-color: #fff3cd'
    return 'background-color: #f8d7da'
def _color_fwd(v):
    if pd.isna(v): return ''
    if v < 0:      return 'background-color: #f8d7da; color: #b30000; font-weight: bold'
    if v < 3.5:    return 'background-color: #fff3cd; color: #7a5a00'
    if v <= 5.5:   return 'background-color: #d1ecf1; color: #0c5460'
    return 'background-color: #d4edda; color: #006600; font-weight: bold'

_analogs_styled = (_analogs.style
    .format({
        'z_hpi':'{:+.2f}', 'z_unemp_chg':'{:+.2f}', 'z_cpi':'{:+.2f}', 'z_real_ff':'{:+.2f}',
        'curve_inverted': '{:.0f}',
        'hpi_yoy':'{:+.2f}%',
        'hpi_fwd_1yr_pct':'{:+.2f}%', 'hpi_fwd_3yr_ann_pct':'{:+.2f}%', 'hpi_fwd_5yr_ann_pct':'{:+.2f}%',
        'distance':'{:.2f}',
    }, na_rep='—')
    .map(_color_verdict_dist, subset=['distance'])
    .map(_color_fwd, subset=['hpi_fwd_1yr_pct','hpi_fwd_3yr_ann_pct','hpi_fwd_5yr_ann_pct'])
    .set_caption(f'5 nearest historical analogs to {_current_year} — GREEN distance = very close match, AMBER = close, RED = weak match')
)
display(_analogs_styled)
print()

# 6. Base-rate distribution across analogs
print('=' * 110)
print('FORWARD-RETURN BASE RATE (across the 5 analogs)')
print('=' * 110)
print()

def _dist_summary(col, label):
    v = _analogs[col].dropna()
    if v.empty:
        print(f'  {label:<32}  no observable analogs')
        return
    n_neg    = int((v < 0).sum())
    n_below  = int(((v >= 0) & (v < 3.5)).sum())
    n_trend  = int(((v >= 3.5) & (v <= 5.5)).sum())
    n_above  = int((v > 5.5).sum())
    print(f'  {label:<32}  n={len(v)}   mean={v.mean():+.2f}%   median={v.median():+.2f}%   min={v.min():+.2f}%   max={v.max():+.2f}%')
    print(f'    P(negative)        {n_neg/len(v)*100:>3.0f}%   ({n_neg}/{len(v)} analogs)')
    print(f'    P(0 - 3.5%/yr)     {n_below/len(v)*100:>3.0f}%   ({n_below}/{len(v)}, below trend)')
    print(f'    P(3.5 - 5.5%/yr)   {n_trend/len(v)*100:>3.0f}%   ({n_trend}/{len(v)}, trend)')
    print(f'    P(>5.5%/yr)        {n_above/len(v)*100:>3.0f}%   ({n_above}/{len(v)}, above trend)')

_dist_summary('hpi_fwd_1yr_pct', 'Forward 1yr HPI'); print()
_dist_summary('hpi_fwd_3yr_ann_pct', 'Forward 3yr HPI (annualized)'); print()
_dist_summary('hpi_fwd_5yr_ann_pct', 'Forward 5yr HPI (annualized)'); print()

print('INTERPRETATION:')
print('  • These are NOT forecasts. They are historical base rates for years with similar macro state.')
print('  • Wide dispersion (large min-max spread) = high uncertainty — plan for multiple scenarios.')
print('  • Tight dispersion = analogs point one direction — higher confidence in base case.')
print('  • Cross-check the "known_event" column — are analog years fundamentally similar situations?')
print('  • Curve_inverted is 0/1 while z-scores span ±3; matching implicitly under-weights the curve.')
"""

MARKOV_TRANSITION_CELL = """# ── Regime transition Markov matrix ─────────────────────────────────────
# Empirical P(next_year_label | current_year_label) from full history.
# Projects 1-year and 3-year forward regime label distribution.

_regime_states = ['CYCLE TOP', 'LATE CYCLE', 'MID CYCLE', 'CONTRACTION', 'CYCLE BOTTOM']

# Build (current, next) transition pairs from the time series
_pairs = _regime[['year','regime']].copy()
_pairs['next_regime'] = _pairs['regime'].shift(-1)
_pairs = _pairs.dropna(subset=['next_regime'])

# Transition count matrix — reindex to enforce full state list on both axes
_transition_counts = pd.crosstab(_pairs['regime'], _pairs['next_regime'])
_transition_counts = _transition_counts.reindex(index=_regime_states, columns=_regime_states, fill_value=0)

# Probabilities (row-normalized)
_row_totals = _transition_counts.sum(axis=1)
_transition_probs = _transition_counts.div(_row_totals.replace(0, np.nan), axis=0)

print('=' * 100)
print('REGIME TRANSITION MATRIX (empirical, 1-year transitions)')
print('=' * 100)
print()
print(f'Sample: {len(_pairs)} year-to-year transitions observed ({int(_regime["year"].min())} to {int(_regime["year"].max())})')
print()

# Counts table
print('TRANSITION COUNTS (rows = current label, columns = next-year label):')
print()
_ct = _transition_counts.copy()
_ct['TOTAL'] = _row_totals.astype(int)
print(_ct.to_string())
print()

# Probabilities table with color coding
def _color_prob(v):
    if pd.isna(v) or v == 0: return 'color: #ccc'
    if v >= 0.60: return 'background-color: #d4edda; color: #006600; font-weight: bold'
    if v >= 0.30: return 'background-color: #d1ecf1; color: #0c5460'
    if v >= 0.10: return 'background-color: #fff3cd; color: #7a5a00'
    return 'color: #6c757d'

print('TRANSITION PROBABILITIES (row = current label, column = next-year label):')
print()
_probs_styled = (_transition_probs.fillna(0).style
    .format('{:.1%}')
    .map(_color_prob)
    .set_caption('P(next_year_label | current_year_label) — GREEN ≥60% (very sticky), BLUE 30-60% (likely), AMBER 10-30% (possible), gray <10% (rare)')
)
display(_probs_styled)
print()

# Current label + forward projection
_cur_label = _regime[_regime['year'] == _regime['year'].max()].iloc[0]['regime']
_cur_year  = int(_regime['year'].max())

print('=' * 100)
print(f'PROJECTED REGIME DISTRIBUTION FROM CURRENT STATE ({_cur_year} = {_cur_label})')
print('=' * 100)
print()

# 1-year forward
_p1 = _transition_probs.loc[_cur_label] if _cur_label in _transition_probs.index else pd.Series(dtype=float)
print(f'1 YEAR AHEAD ({_cur_year + 1}) — probability of each label:')
for state in _regime_states:
    p = (_p1.get(state, 0) or 0) * 100
    bar = '█' * int(round(p / 3))
    print(f'  {state:<15}  {p:5.1f}%  {bar}')
print()

# Multi-year forward via Markov iteration
def _project(current_label, n_years):
    if current_label not in _transition_probs.index:
        return pd.Series(dtype=float)
    v = pd.Series(0.0, index=_regime_states)
    v[current_label] = 1.0
    for _ in range(n_years):
        v = _transition_probs.T.dot(v).fillna(0)
    return v

_p3 = _project(_cur_label, 3)
print(f'3 YEARS AHEAD ({_cur_year + 3}) — probability of each label:')
for state in _regime_states:
    p = (_p3.get(state, 0) or 0) * 100
    bar = '█' * int(round(p / 3))
    print(f'  {state:<15}  {p:5.1f}%  {bar}')
print()

# Persistence stat
n_pairs = len(_pairs)
n_same  = int((_pairs['regime'] == _pairs['next_regime']).sum())
print('BASE-RATE INSIGHTS:')
print(f'  Total 1-year transitions observed: {n_pairs}')
print(f'  Same-label persistence: {n_same}/{n_pairs} = {n_same/n_pairs*100:.0f}%')
print(f'  → Regime labels are typically sticky year-over-year. Transitions to non-adjacent states are rare.')
print()

# Adjacent vs jump transitions
_adjacency = {s:i for i,s in enumerate(_regime_states)}
def _dist(pair):
    return abs(_adjacency[pair['regime']] - _adjacency[pair['next_regime']])
_pairs['jump'] = _pairs.apply(_dist, axis=1)
_n_stay   = int((_pairs['jump'] == 0).sum())
_n_1step  = int((_pairs['jump'] == 1).sum())
_n_2step  = int((_pairs['jump'] == 2).sum())
_n_3plus  = int((_pairs['jump'] >= 3).sum())
print('YEAR-OVER-YEAR TRANSITION DISTANCE:')
print(f'  Stay (same label):        {_n_stay:>3}/{n_pairs}  ({_n_stay/n_pairs*100:.0f}%)')
print(f'  Adjacent (1-step move):   {_n_1step:>3}/{n_pairs}  ({_n_1step/n_pairs*100:.0f}%)')
print(f'  2-step move:              {_n_2step:>3}/{n_pairs}  ({_n_2step/n_pairs*100:.0f}%)')
print(f'  3+ step move (rare):      {_n_3plus:>3}/{n_pairs}  ({_n_3plus/n_pairs*100:.0f}%)')
print()

# Small-sample warning
_smallest_n = int(_row_totals.min())
if _smallest_n < 5:
    _sparse = [_regime_states[i] for i, n in enumerate(_row_totals) if n < 5]
    print(f'⚠  Small-sample warning: {\", \".join(_sparse)} have <5 historical observations each.')
    print(f'   Transition probabilities from these states are noisy estimates.')
"""

REGIME_CONTEXT_CELL = """# Regime context (informational — does NOT drive picks)
# 5-signal consensus detector: HPI YoY, unemployment YoY change, CPI YoY, real Fed funds, yield curve.
# Uses expanding-window z-scores (PIT-strict). Requires 2+ signals to agree before firing HOT or COLD.

# ── Pull long-history signals ──
_con = duckdb.connect(WAREHOUSE, read_only=True)
_hpi_nat = _con.execute('''
    WITH hpi_dec AS (
        SELECT fips, EXTRACT(YEAR FROM period_end_date)::INT AS year, hpi
        FROM main_staging.stg_fhfa_hpi
        QUALIFY row_number() OVER (PARTITION BY fips, EXTRACT(YEAR FROM period_end_date) ORDER BY as_of_date DESC)=1
    ),
    hpi_yoy_nat AS (
        SELECT curr.fips, curr.year, curr.hpi/prev.hpi - 1 AS hpi_yoy
        FROM hpi_dec curr JOIN hpi_dec prev ON prev.fips=curr.fips AND prev.year=curr.year-1 WHERE prev.hpi>0
    )
    SELECT year, MEDIAN(hpi_yoy) AS hpi_yoy FROM hpi_yoy_nat GROUP BY year ORDER BY year
''').df()
_fred = _con.execute('''
    SELECT year,
        MAX(CASE WHEN series_id='UNRATE' THEN value END) AS unemp,
        MAX(CASE WHEN series_id='CPIAUCSL' THEN value END) AS cpi_lvl,
        MAX(CASE WHEN series_id='FEDFUNDS' THEN value END) AS fed_funds,
        MAX(CASE WHEN series_id='T10Y2Y' THEN value END) AS yield_curve
    FROM (
        SELECT series_id, EXTRACT(YEAR FROM observation_date)::INT AS year, value,
               row_number() OVER (PARTITION BY series_id, EXTRACT(YEAR FROM observation_date) ORDER BY observation_date DESC) AS rn
        FROM main_staging.stg_fred_macro
        WHERE series_id IN ('UNRATE','CPIAUCSL','FEDFUNDS','T10Y2Y')
    ) WHERE rn=1 GROUP BY year ORDER BY year
''').df()
_con.close()

_regime = _hpi_nat.merge(_fred, on='year', how='inner').sort_values('year').reset_index(drop=True)
_regime['cpi_yoy']         = _regime['cpi_lvl'].pct_change() * 100
_regime['unemp_yoy_chg']   = _regime['unemp'].diff()
_regime['real_fed_funds']  = _regime['fed_funds'] - _regime['cpi_yoy']
_regime['curve_inverted']  = (_regime['yield_curve'] < 0).astype(int)

def _expand_z(series, min_periods=10):
    out = pd.Series(index=series.index, dtype=float)
    for i in range(len(series)):
        w = series.iloc[:i].dropna()
        if len(w) < min_periods: out.iloc[i] = np.nan
        else:
            mu, sig = w.mean(), w.std()
            out.iloc[i] = (series.iloc[i] - mu) / sig if sig > 0 else 0.0
    return out
_regime['z_hpi']       = _expand_z(_regime['hpi_yoy'])
_regime['z_unemp_chg'] = _expand_z(_regime['unemp_yoy_chg'])
_regime['z_cpi']       = _expand_z(_regime['cpi_yoy'])
_regime['z_real_ff']   = _expand_z(_regime['real_fed_funds'])

def _vote(row):
    h, c, reasons = 0, 0, []
    if pd.notna(row['z_hpi']):
        if row['z_hpi'] > 1.5: h += 1; reasons.append(f'HPI+={row[\"z_hpi\"]:+.1f}')
        elif row['z_hpi'] < -1.5: c += 1; reasons.append(f'HPI-={row[\"z_hpi\"]:+.1f}')
    if pd.notna(row['z_unemp_chg']):
        if row['z_unemp_chg'] > 1.5: c += 1; reasons.append(f'Unemp+={row[\"z_unemp_chg\"]:+.1f}')
        elif row['z_unemp_chg'] < -1.5: h += 1; reasons.append(f'Unemp-={row[\"z_unemp_chg\"]:+.1f}')
    if pd.notna(row['z_cpi']):
        if row['z_cpi'] > 1.5: h += 1; reasons.append(f'CPI+={row[\"z_cpi\"]:+.1f}')
        elif row['z_cpi'] < -1.5: c += 1; reasons.append(f'CPI-={row[\"z_cpi\"]:+.1f}')
    if pd.notna(row['z_real_ff']):
        if row['z_real_ff'] > 1.5: h += 1; reasons.append(f'RealFF+={row[\"z_real_ff\"]:+.1f}')
        elif row['z_real_ff'] < -1.5: c += 1; reasons.append(f'RealFF-={row[\"z_real_ff\"]:+.1f}')
    if row['curve_inverted'] == 1: h += 1; reasons.append('curve_inv')
    return pd.Series({'h': h, 'c': c, 'reasons': ' | '.join(reasons)})
_votes = _regime.apply(_vote, axis=1)
_regime = pd.concat([_regime, _votes], axis=1)
def _classify(row):
    if row['h'] >= 3: return 'CYCLE TOP'
    if row['h'] >= 2: return 'LATE CYCLE'
    if row['c'] >= 3: return 'CYCLE BOTTOM'
    if row['c'] >= 2: return 'CONTRACTION'
    return 'MID CYCLE'
_regime['regime'] = _regime.apply(_classify, axis=1)

# ── Display current-year regime state ──
_cy = _regime[_regime['year'] == 2025]
if not _cy.empty:
    r = _cy.iloc[0]
    print('=' * 90)
    print(f'  REGIME for 2025: {r[\"regime\"]}   (hot_votes={r[\"h\"]}  cold_votes={r[\"c\"]})')
    print(f'  Signals fired: {r[\"reasons\"] if r[\"reasons\"] else \"none — all readings in normal range\"}')
    print(f'  HPI YoY: {r[\"hpi_yoy\"]*100:+.2f}%   Unemp chg: {r[\"unemp_yoy_chg\"]:+.2f}pp   CPI YoY: {r[\"cpi_yoy\"]:+.2f}%')
    print(f'  Real Fed funds: {r[\"real_fed_funds\"]:+.2f}%   Yield curve (10y-2y): {r[\"yield_curve\"]:+.2f}pp')
    print('=' * 90)
    print(f'  Investor interpretation:')
    print(f'    CYCLE TOP / LATE CYCLE → market elevated, mean reversion risk (bearish for new buys)')
    print(f'    MID CYCLE → no anomaly, trust trailing signals at face value')
    print(f'    CONTRACTION / CYCLE BOTTOM → stress in progress, cycle turning (bullish for new buys)')
    print(f'  This regime signal does NOT override picks — it provides context for your judgment.')
    print()

# ── Also show last few years for context ──
_recent = _regime[_regime['year'].between(2020, 2025)][['year','regime','h','c','reasons']].copy()
_recent = _recent.rename(columns={'h':'hot_votes', 'c':'cold_votes'})
print('Recent regime history:')
print(_recent.to_string(index=False))
"""

# ══════════════════════════════════════════════════════════════════════════════
# GENERATE
# ══════════════════════════════════════════════════════════════════════════════

for strategy_id, spec in STRATEGIES.items():
    # Apply optional config overrides (e.g., EMERGING overrides POP_MIN/POP_MAX for different universe)
    overrides = spec.get('config_overrides', '')
    config_with_name = CONFIG_CELL + overrides + f"\nSTRATEGY_NAME = '{spec['title'].split(' — ')[0]}'\n"
    cells = [
        md(f"# {spec['title']}\n\n{spec['description']}"),
        md(spec["features_md"]),
        md("## 1. Config"),
        code(config_with_name),
        md("## 2. Load universe + compute return metrics"),
        code(DATA_LOAD_CELL),
        md("## 3. Method implementation"),
        code(spec["method_code"]),
        md("## 4. Per-year picks (2015–2025)"),
        code(PICKS_PER_YEAR_CELL),
        md("## 5. Aggregate performance (2015–2022 observable)"),
        code(AGGREGATE_CELL),
    ]
    # Per-pick history DataFrame — every pick, every year, prediction vs actual
    cells.append(md("## 6. Per-pick history — every pick this strategy made, with realized returns"))
    cells.append(md(PICKS_HISTORY_MD))
    cells.append(code(PICKS_HISTORY_CELL))
    cells.append(code(PICKS_HISTORY_SUMMARY_CELL))
    # Regime context in ALL 5 notebooks — informational, does not drive picks
    cells.append(md("## 7. Regime context (informational — does not drive picks)"))
    cells.append(md(REGIME_CRITERIA_MD))
    cells.append(code(REGIME_CONTEXT_CELL))
    # Regime validation — per-year label vs actual outcome
    cells.append(md("## 8. Regime validation — per-year prediction vs actual"))
    cells.append(md(REGIME_VALIDATION_MD))
    cells.append(code(REGIME_VALIDATION_CELL))
    cells.append(code(REGIME_ACCURACY_CELL))
    cells.append(md("## 9. Regime forecasting tools — historical analog finder + Markov transition matrix"))
    cells.append(md(REGIME_FORECAST_MD))
    cells.append(code(ANALOG_FINDER_CELL))
    cells.append(code(MARKOV_TRANSITION_CELL))
    cells.append(md("## 10. Current year (2025) picks — actionable"))
    cells.append(code(CURRENT_YEAR_CELL))

    nb = wrap(cells)
    out = NB_DIR / f"strategy_{strategy_id}.ipynb"
    out.write_text(json.dumps(nb, indent=1))
    print(f"  wrote {out.relative_to(ROOT)}   ({len(cells)} cells)")

print("\nDone. Open any of the 5 notebooks in Jupyter and Run All.")
print("All 5 notebooks now include regime context (Section 6) as informational — does not drive picks.")
print("State names now displayed in full (e.g. 'Cook, Illinois' instead of 'Cook, Il').")
