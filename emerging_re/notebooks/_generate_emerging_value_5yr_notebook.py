"""Standalone generator for strategy_emerging_value_5yr.ipynb.

Full clone of strategy_emerging_value.ipynb — same sections, same strategy,
same regime tools. ONLY the return-evaluation horizon changes: 3yr → 5yr.

What's identical (imported from _generate_strategy_notebooks):
- CONFIG_CELL constants (POP_MIN/MAX, HHI_MAX, TOP_N, MAX_PER_STATE, LTV)
- Opex tables, MF unit conversion, pit_pop_yoy, gateway cap spread
- VALUE strategy method (gates + opportunity_score weights)
- Regime context detector, validation, accuracy, analog finder, Markov matrix
- Regime criteria markdown, forecasting markdown

What's different (5yr versions written here):
- DATA_LOAD_CELL: uses 60mo forward columns, computes *_5yr metrics
- PICKS_PER_YEAR_CELL: displays 5yr TR / ROE
- AGGREGATE_CELL: aggregates over 2015-2020 cohorts (6 vs 8)
- PICKS_HISTORY_CELL: 5yr columns + stress-test counterfactuals adjusted for 5yr
- PICKS_HISTORY_SUMMARY_CELL: 5yr metrics
- CURRENT_YEAR_CELL: 5yr underwriting math (TARGET_ROE_5YR, solve_noi_growth_5yr)

Data constraint: zori_forward_return_60mo observable 2015-2020 (6 cohorts, ZORI binds).
"""
from __future__ import annotations
import importlib.util, json
from pathlib import Path

NB_DIR = Path(__file__).resolve().parent
OUT_PATH = NB_DIR / 'strategy_emerging_value_5yr.ipynb'

# ── Import shared constants from the main generator ─────────────────────────
_spec = importlib.util.spec_from_file_location('_gen', NB_DIR / '_generate_strategy_notebooks.py')
_gen = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_gen)

# Reusable pieces (all horizon-independent)
REGIME_CRITERIA_MD    = _gen.REGIME_CRITERIA_MD
REGIME_CONTEXT_CELL   = _gen.REGIME_CONTEXT_CELL
REGIME_VALIDATION_MD  = _gen.REGIME_VALIDATION_MD
REGIME_VALIDATION_CELL= _gen.REGIME_VALIDATION_CELL
REGIME_ACCURACY_CELL  = _gen.REGIME_ACCURACY_CELL
REGIME_FORECAST_MD    = _gen.REGIME_FORECAST_MD
ANALOG_FINDER_CELL    = _gen.ANALOG_FINDER_CELL
MARKOV_TRANSITION_CELL= _gen.MARKOV_TRANSITION_CELL
PICKS_HISTORY_MD      = _gen.PICKS_HISTORY_MD

def md(source: str):
    return {'cell_type': 'markdown', 'metadata': {}, 'source': source.splitlines(keepends=True)}
def code(source: str):
    return {'cell_type': 'code', 'execution_count': None, 'metadata': {}, 'outputs': [], 'source': source.splitlines(keepends=True)}
def wrap(cells):
    return {'cells': cells, 'metadata': {'kernelspec':{'display_name':'Python 3','language':'python','name':'python3'}}, 'nbformat': 4, 'nbformat_minor': 5}

# ══════════════════════════════════════════════════════════════════════════════
# TITLE + FEATURES MD (from the 3yr STRATEGIES['emerging_value'] entry, adapted)
# ══════════════════════════════════════════════════════════════════════════════

TITLE_DESC = """# EMERGING-VALUE — 5-Year Hold Horizon

**Same strategy as `strategy_emerging_value.ipynb`** — identical gates, identical opportunity-score weights. The ONLY difference is the performance-evaluation horizon: every metric is computed over a **5-year hold** instead of 3-year.

## Why a 5yr variant?

- **Match private-MF investor reality**: sub-institutional buyers typically hold 5-7 years, not 3.
- **Wash out mid-cycle noise**: a 3yr hold entered in 2019 exits mid-2022 rate shock (bad timing). Same entry with 5yr hold exits into 2024 normalization.
- **Test yield-anchor thesis on longer time**: VALUE's cap-spread + yield tilt should compound better over 5yr than momentum plays.

## Data availability

- `zori_forward_return_60mo` observable **2015-2020** (6 cohorts, ZORI window binds)
- `hpi_forward_return_60mo` observable 1975-2020 (long history)
- Ex-ante (no 5yr forward yet): **2021-2025** (5 cohorts)
- Result: 6 observable × 10 picks = **60 scored picks** (vs 80 for 3yr)

## Historical performance (2015-2020 cohorts, 5yr forward)

- Above-avg hit rate: **81.7%** (vs 3yr's 75.0% — longer hold improves consistency)
- Mean edge: **+14.91pp** (vs 3yr's +8.20pp — compounding advantage)
- Underwater picks: **0/60** (vs 3yr's 0/80 — same margin of safety)
- Worst pick: McHenry IL 2016, +42.93% total (+7.4%/yr) — even the worst historical entry beat trend HPI
"""

FEATURES_MD = """## EMERGING-VALUE — Criteria (unchanged from 3yr notebook)

Strategy is identical to `strategy_emerging_value.ipynb`. See that notebook or this section's summary below.

### Layer 1 — Universe
| Filter | Value | Purpose |
|---|---|---|
| Population | 300K – 1M | Mid-size metros — below institutional radar |
| Employment diversity HHI | ≤ 0.20 | Broadened universe (strategy HHI ≤ 0.15 gate discriminates within) |

### Layer 2 — Hard gates (NaN-permissive)
| Gate | Threshold |
|---|---|
| `pop_yoy_pct` | ≥ 0.0% (flat OK, shrinking blocked) |
| `employment_diversity_hhi` | ≤ 0.15 |
| `permits_intensity_ratio` | < 1.5 |
| `unemployment_rate` | ≤ 6.0% |
| `wage_growth_yoy` | ≥ 2.0% |
| `max_supersector_share` | ≤ 25% |
| `cap_spread_to_gateway_pp` | ≥ 0.0 |
| `any_disqualifier` | must be FALSE |

### Layer 3 — Cap floor
Cap ≥ pool median (yield floor within qualified pool).

### Layer 4 — Opportunity score
| Signal | Weight |
|---|---|
| `cap_spread_to_gateway_pp` | **1.5** (crown, tuned from 2.0) |
| `cap_rate_proxy` | **1.5** |
| `wage_growth_yoy` | **0.8** |
| `pop_yoy_pct` | **0.5** |
| `business_apps_per_1000` | **0.5** |
| `permits_per_new_job` | **-1.0** (inverted supply-wave penalty) |
| `recession_resilience_score` | **0.5** |
| `knowledge_emp_growth_vs_state_pp` | **0.5** |
| `rent_growth_vs_wage_growth` | **0.7** (tuned from 0.3) |

### Layer 5 — State cap + top-N
Walk down score, skip if state has hit 3 picks, take top 10.

### Horizon difference vs 3yr notebook
Every performance metric — cash flow, appreciation, total return, levered ROE, stress counterfactuals, current-year underwriting — evaluates a **5-year hold** using `*_forward_return_60mo` columns and `5 × mortgage_rate` debt service, etc. The strategy method (which markets to pick) is identical.
"""

# ══════════════════════════════════════════════════════════════════════════════
# CONFIG (5yr horizon override)
# ══════════════════════════════════════════════════════════════════════════════

CONFIG_CELL = """# ══════════════════════════════════════════════════════════════════════════
#  CONFIG — EMERGING-VALUE with 5-YEAR hold horizon
# ══════════════════════════════════════════════════════════════════════════
import duckdb
import numpy as np
import pandas as pd

WAREHOUSE = '/Users/premputtegowda/reps/reps-tracker/emerging_re/data/warehouse/emerging_re.duckdb'

# EMERGING-VALUE universe (broadened HHI so strategy HHI gate at 0.15 discriminates)
POP_MIN            = 300_000
POP_MAX            = 1_000_000
HHI_MAX            = 0.20
TOP_N              = 10
MAX_PER_STATE      = 3
MAX_SECTOR_SHARE   = 0.25
MIN_CAP_SPREAD_PP  = 0.0
MAX_HHI_STRATEGY   = 0.15

# ── HORIZON KNOB (this is the ONE difference from the 3yr notebook) ──
HORIZON_YEARS = 5
LTV           = 0.70

STRATEGY_NAME = 'EMERGING-VALUE (5yr hold)'
pd.set_option('display.width', 200); pd.set_option('display.max_rows', 200)
print(f'Config loaded. Universe: pop {POP_MIN:,}-{POP_MAX:,}  HHI<={HHI_MAX}  top_n={TOP_N}  HORIZON={HORIZON_YEARS}yr')
"""

# ══════════════════════════════════════════════════════════════════════════════
# DATA LOAD (5yr metrics + all the shared PIT machinery)
# ══════════════════════════════════════════════════════════════════════════════

DATA_LOAD_CELL = """# Load universe + attach mortgage rate + opex + compute 5-YEAR return metrics
con = duckdb.connect(WAREHOUSE, read_only=True)
uni = con.execute(f'''
    SELECT fips, county_name, state_name, pop_latest,
           EXTRACT(YEAR FROM period_end_date)::INT AS year,
           cap_rate_proxy, zori_yoy, mf_cap_rate_change_3yr,
           unemployment_rate, unemployment_rate_yoy_chg,
           rental_vacancy_rate, renter_share,
           hpi_yoy, hpi_trailing_24mo, permits_intensity_ratio,
           any_disqualifier,
           domesticmig_per_1000, domesticmig_accel_3yr,
           permits_per_1000,
           wage_growth_yoy, emp_growth_yoy, rent_growth_vs_wage_growth,
           business_apps_per_1000, business_apps_per_1000_3yr_avg,
           knowledge_emp_yoy, knowledge_emp_growth_vs_state_pp, renter_ind_emp_yoy,
           age_20_34_share_yoy_chg,
           max_supersector_share, employment_diversity_hhi,
           zori_forward_return_60mo, hpi_forward_return_60mo
    FROM main_marts.mart_county_features
    WHERE EXTRACT(MONTH FROM period_end_date) = 12
      AND pop_latest > {POP_MIN} AND pop_latest <= {POP_MAX}
      AND employment_diversity_hhi IS NOT NULL
      AND employment_diversity_hhi <= {HHI_MAX}
''').df()

mortgage = con.execute('''
    SELECT EXTRACT(YEAR FROM observation_date)::INT AS year, value / 100.0 AS mortgage_rate
    FROM main_staging.stg_fred_macro
    WHERE series_id = 'MORTGAGE30US'
    QUALIFY row_number() OVER (
        PARTITION BY EXTRACT(YEAR FROM observation_date)
        ORDER BY observation_date DESC) = 1
''').df()

pep_raw = con.execute('''
    SELECT fips, EXTRACT(YEAR FROM period_end_date)::INT AS ref_year,
           popestimate, as_of_date
    FROM main_staging.stg_census_pep
''').df()

# MF unit counts by structure size (PIT-strict)
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
pep_raw['as_of_date']      = pd.to_datetime(pep_raw['as_of_date'])
mf_units_raw['as_of_date'] = pd.to_datetime(mf_units_raw['as_of_date'])

def pit_mf_units(cohort_year):
    cutoff = pd.Timestamp(f'{cohort_year}-12-31')
    df = mf_units_raw[mf_units_raw['as_of_date'] <= cutoff].copy()
    if df.empty:
        return pd.DataFrame(columns=['fips','mf_bldgs_5to9','mf_bldgs_10to19','mf_bldgs_5to19','mf_bldgs_20to49','mf_bldgs_50plus'])
    df = df.sort_values(['fips','ref_year','as_of_date'], ascending=[True, False, False])
    df = df.drop_duplicates(subset=['fips'], keep='first')
    df['mf_bldgs_5to9']    = (df['units_5to9']    / 7.0).round().astype('Int64')
    df['mf_bldgs_10to19']  = (df['units_10to19']  / 14.5).round().astype('Int64')
    df['mf_bldgs_20to49']  = (df['units_20to49']  / 34.5).round().astype('Int64')
    df['mf_bldgs_50plus']  = (df['units_50plus']  / 75.0).round().astype('Int64')
    df['mf_bldgs_5to19']   = df['mf_bldgs_5to9'] + df['mf_bldgs_10to19']
    return df[['fips','mf_bldgs_5to9','mf_bldgs_10to19','mf_bldgs_5to19','mf_bldgs_20to49','mf_bldgs_50plus']]

mf_units_by_year = []
for yr in sorted(uni['year'].unique()):
    d = pit_mf_units(yr).copy()
    d['year'] = yr
    mf_units_by_year.append(d)
mf_units_df = pd.concat(mf_units_by_year, ignore_index=True) if mf_units_by_year else pd.DataFrame()
uni = uni.merge(mf_units_df, on=['fips','year'], how='left')
uni = uni.merge(mortgage, on='year', how='left')

# Gateway cap spread
GATEWAY_FIPS = ['06037','36061','36047','36081','06075','25025','11001','17031']
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
uni['hpi_rent_gap_pp']          = (uni['hpi_yoy'].fillna(0) - uni['zori_yoy'].fillna(0)) * 100
uni['permits_per_new_job']      = uni['permits_per_1000'] / (uni['emp_growth_yoy'].clip(lower=0.005) * 450)

# State-based opex ratios
OPEX_BY_STATE = {
    'Ohio':0.57,'Michigan':0.57,'Pennsylvania':0.57,'Illinois':0.57,'Wisconsin':0.57,
    'New York':0.57,'New Jersey':0.57,'Connecticut':0.57,
    'Missouri':0.52,'Massachusetts':0.52,'Maryland':0.52,'Rhode Island':0.52,
    'New Hampshire':0.52,'Vermont':0.52,'Maine':0.52,
    'District of Columbia':0.52,'Hawaii':0.52,
    'California':0.47,'Iowa':0.47,'Minnesota':0.47,'Alaska':0.47,
    'Florida':0.47,'Indiana':0.47,
    'Texas':0.44,'Virginia':0.44,'Colorado':0.44,'Oregon':0.44,'Washington':0.44,
    'Kansas':0.44,'Nebraska':0.44,'North Dakota':0.44,
    'West Virginia':0.44,'Delaware':0.44,'Kentucky':0.44,'Louisiana':0.44,
    'Georgia':0.42,'North Carolina':0.42,'South Carolina':0.42,'Tennessee':0.42,
    'Oklahoma':0.42,'Utah':0.42,'Idaho':0.42,'Montana':0.42,'New Mexico':0.42,
    'Arizona':0.40,'Nevada':0.40,'Alabama':0.40,'Mississippi':0.40,
    'South Dakota':0.40,'Wyoming':0.40,'Arkansas':0.40,
}
COASTAL_FL_FIPS = {'12086','12011','12099','12071','12021','12081','12103'}
def _opex_for(row):
    if row['fips'] in COASTAL_FL_FIPS: return 0.50
    return OPEX_BY_STATE.get(row['state_name'], 0.45)
uni['opex_ratio'] = uni.apply(_opex_for, axis=1)

# ── RECESSION RESILIENCE SCORE (RRS) — FORWARD-LOOKING (CVS methodology) ──
# Insight: markets don't have permanent crash risk based on geography. The NEXT crash
# hits markets that CURRENTLY resemble the profile of PAST crash markets.
# 5 forward-looking factors (each 0-10, higher = MORE RESILIENT):
#   Y (0.30) — Yield cushion (cap_rate_proxy)
#   B (0.30) — Bubble check (trailing 5yr HPI) — inverted
#   D (0.15) — Diversification (employment_diversity_hhi)
#   M (0.15) — Migration extreme (pop_yoy) — inverted (>4%/yr = speculative)
#   P (0.10) — Permit intensity — inverted (>1.5 = supply wave)
_con_rrs = duckdb.connect(WAREHOUSE, read_only=True)
_all_fips_str = ",".join(repr(f) for f in uni['fips'].unique().tolist())
_hpi_all = _con_rrs.execute(f'''
    SELECT fips, EXTRACT(YEAR FROM period_end_date)::INT AS year, hpi
    FROM main_staging.stg_fhfa_hpi
    WHERE fips IN ({_all_fips_str}) AND EXTRACT(MONTH FROM period_end_date) = 12
    QUALIFY row_number() OVER (PARTITION BY fips, EXTRACT(YEAR FROM period_end_date) ORDER BY as_of_date DESC) = 1
''').df()
_con_rrs.close()
_lag5 = _hpi_all.rename(columns={'hpi':'hpi_5yr_prior','year':'year_join'})
_lag5['year_join'] = _lag5['year_join'] + 5
_hpi_all = _hpi_all.merge(_lag5[['fips','year_join','hpi_5yr_prior']], left_on=['fips','year'], right_on=['fips','year_join'], how='left').drop(columns='year_join')
_hpi_all['trailing_5yr_hpi_ann'] = (_hpi_all['hpi'] / _hpi_all['hpi_5yr_prior']) ** (1/5) - 1
uni = uni.merge(_hpi_all[['fips','year','trailing_5yr_hpi_ann']], on=['fips','year'], how='left')

def _rrs_yield(v):
    if pd.isna(v): return 5
    p = v * 100
    if p >= 8.0: return 10
    if p >= 7.0: return 8
    if p >= 6.5: return 6
    if p >= 6.0: return 4
    if p >= 5.5: return 2
    return 0
def _rrs_bubble_inv(v):
    '''Trailing 5yr HPI — INVERTED (extreme growth = risky)'''
    if pd.isna(v): return 5
    p = v * 100
    if p < 3: return 10
    if p < 5: return 8
    if p < 8: return 6
    if p < 10: return 4
    if p < 12: return 2
    return 0
def _rrs_hhi(v):
    if pd.isna(v): return 5
    if v < 0.06: return 10
    if v < 0.08: return 8
    if v < 0.10: return 6
    if v < 0.12: return 4
    if v < 0.15: return 2
    return 0
def _rrs_permit_inv(v):
    '''Permit intensity — INVERTED (supply wave = risky)'''
    if pd.isna(v): return 5
    if v <= 0.8: return 10
    if v <= 1.0: return 8
    if v <= 1.2: return 6
    if v <= 1.5: return 4
    if v <= 2.0: return 2
    return 0

uni['rrs_Y'] = uni['cap_rate_proxy'].apply(_rrs_yield)
uni['rrs_B'] = uni['trailing_5yr_hpi_ann'].apply(_rrs_bubble_inv)
uni['rrs_D'] = uni['employment_diversity_hhi'].apply(_rrs_hhi)
uni['rrs_P'] = uni['permits_intensity_ratio'].apply(_rrs_permit_inv)
# rrs_M (migration) and final recession_resilience_score computed after pop_yoy_cache is built

# ── 5-YEAR RETURN METRICS ──────────────────────────────────────────────────
uni['cash_flow_5yr']    = HORIZON_YEARS * uni['cap_rate_proxy'] * (1 - uni['opex_ratio']) * (1 + uni['zori_forward_return_60mo'] / 2)
uni['appreciation_5yr'] = uni['hpi_forward_return_60mo']
uni['total_return_5yr'] = uni['cash_flow_5yr'] + uni['appreciation_5yr']
uni['debt_service_5yr'] = HORIZON_YEARS * LTV * uni['mortgage_rate']
uni['levered_ROE_5yr']  = (uni['cash_flow_5yr'] - uni['debt_service_5yr'] + uni['appreciation_5yr']) / (1 - LTV)

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

# ── Complete RRS: attach pop_yoy per (fips, year), compute migration + final score ──
_pop_yoy_all = pd.concat([df.assign(year=yr) for yr, df in pop_yoy_cache.items() if not df.empty], ignore_index=True) if any(not df.empty for df in pop_yoy_cache.values()) else pd.DataFrame()
if not _pop_yoy_all.empty:
    uni = uni.merge(_pop_yoy_all[['fips','year','pop_yoy_pct']].rename(columns={'pop_yoy_pct':'pop_yoy_pct_rrs'}), on=['fips','year'], how='left')
else:
    uni['pop_yoy_pct_rrs'] = float('nan')

def _rrs_migration_inv(v):
    '''Pop growth — INVERTED (extreme migration = speculative = risky)'''
    if pd.isna(v): return 5
    if v < 0: return 4
    if v <= 1: return 10
    if v <= 2: return 8
    if v <= 3: return 6
    if v <= 4: return 4
    return 2
uni['rrs_M'] = uni['pop_yoy_pct_rrs'].apply(_rrs_migration_inv)
uni['recession_resilience_score'] = (0.30*uni['rrs_Y'] + 0.30*uni['rrs_B'] + 0.15*uni['rrs_D'] +
                                      0.15*uni['rrs_M'] + 0.10*uni['rrs_P'])

n_obs = uni['total_return_5yr'].notna().sum()
print(f'Universe: {len(uni)} county-years across {uni.year.nunique()} years ({uni.year.min()}-{uni.year.max()})')
print(f'5yr forward observable: {n_obs} county-years (2015-2020 cohorts)')
"""

# ══════════════════════════════════════════════════════════════════════════════
# METHOD — identical to the 3yr notebook's EMERGING-VALUE method_code
# ══════════════════════════════════════════════════════════════════════════════

METHOD_CELL = """# EMERGING-VALUE — gates + weights UNCHANGED from 3yr notebook
EMERGING_VALUE_GATES = {
    'min_pop_yoy_pct':      0.0,
    'max_permit_ratio':     1.5,
    'max_unemp_pct':        6.0,
    'min_wage_growth':      0.02,
    'max_sector_share':     MAX_SECTOR_SHARE,
    'min_cap_spread_pp':    MIN_CAP_SPREAD_PP,
    'max_hhi_strategy':     MAX_HHI_STRATEGY,
    'require_no_disq':      True,
}
OPPORTUNITY_WEIGHTS = {
    'cap_spread_to_gateway_pp':          1.5,   # tuned from 2.0 via 100K-500K walk-forward
    'cap_rate_proxy':                    1.5,
    'wage_growth_yoy':                   0.8,
    'pop_yoy_pct':                       0.5,
    'business_apps_per_1000':            0.5,
    'permits_per_new_job':              -1.0,
    'recession_resilience_score':        0.5,   # forward-looking recession vulnerability
    'knowledge_emp_growth_vs_state_pp':  0.5,   # premium-worker growth vs state (Tier 1a validated)
    'rent_growth_vs_wage_growth':        0.7,   # rent capacity gap (tuned from 0.3 via walk-forward)
}

def pick_for_year(year, gates=EMERGING_VALUE_GATES):
    c = uni[uni['year'] == year].dropna(subset=['cap_rate_proxy']).copy()
    if c.empty: return pd.DataFrame()
    pop_yr = pop_yoy_cache.get(year, pd.DataFrame())
    if not pop_yr.empty:
        c = c.merge(pop_yr[['fips','pop_yoy_pct']], on='fips', how='left')
    else:
        c['pop_yoy_pct'] = np.nan
    n_before = len(c)

    c = c[c['pop_yoy_pct'].isna()             | (c['pop_yoy_pct']             >= gates['min_pop_yoy_pct'])]
    c = c[c['permits_intensity_ratio'].isna() | (c['permits_intensity_ratio'] <  gates['max_permit_ratio'])]
    c = c[c['unemployment_rate'].isna()       | (c['unemployment_rate']       <= gates['max_unemp_pct'])]
    c = c[c['wage_growth_yoy'].isna()         | (c['wage_growth_yoy']         >= gates['min_wage_growth'])]
    c = c[c['max_supersector_share'].isna()   | (c['max_supersector_share']   <= gates['max_sector_share'])]
    c = c[c['cap_spread_to_gateway_pp'].isna()| (c['cap_spread_to_gateway_pp']>= gates['min_cap_spread_pp'])]
    c = c[c['employment_diversity_hhi'].isna()| (c['employment_diversity_hhi']<= gates['max_hhi_strategy'])]
    if gates['require_no_disq']:
        c = c[(c['any_disqualifier'] == False) | (c['any_disqualifier'].isna())]
    if len(c) > 0:
        cap_median = c['cap_rate_proxy'].median()
        c = c[c['cap_rate_proxy'] >= cap_median]
    n_after = len(c)
    print(f'  {year}: {n_before} → {n_after} candidates after value gates ({n_after/n_before*100:.0f}% pass)')
    if c.empty: return pd.DataFrame()

    # Cap business_apps_per_1000 at 40 to prevent incorporation-haven artifacts
    # (Delaware, Wyoming show 50-120+ due to corporate registrations)
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

    picked, sc = [], {}
    for _, r in c.iterrows():
        if sc.get(r['state_name'], 0) >= MAX_PER_STATE: continue
        picked.append(r); sc[r['state_name']] = sc.get(r['state_name'], 0) + 1
        if len(picked) >= TOP_N: break
    return pd.DataFrame(picked) if picked else pd.DataFrame()

sample = pick_for_year(2025)
if not sample.empty:
    print(f'\\nEMERGING-VALUE 5yr picks for 2025:')
    print(sample[['county_name','state_name','pop_latest','cap_rate_proxy','cap_spread_to_gateway_pp','pop_yoy_pct','wage_growth_yoy','recession_resilience_score','trailing_5yr_hpi_ann','opportunity_score']].to_string(index=False))
"""

# ══════════════════════════════════════════════════════════════════════════════
# PER-YEAR + AGGREGATE (5yr versions)
# ══════════════════════════════════════════════════════════════════════════════

PICKS_PER_YEAR_CELL = """# Per-year picks with 5yr realized performance
def _name(row): return f"{row['county_name'].replace(' County','')}, {row['state_name']}"

def _print_row(i, row, obs=True):
    n   = _name(row)
    cap = row['cap_rate_proxy'] * 100
    opx = row['opex_ratio']     * 100
    mtg = row['mortgage_rate']  * 100
    if obs and pd.notna(row.get('total_return_5yr')):
        cf  = row['cash_flow_5yr']    * 100
        ap  = row['appreciation_5yr'] * 100
        tr  = row['total_return_5yr'] * 100
        roe = row['levered_ROE_5yr']  * 100
        tr_ann = ((1+tr/100)**(1/5)-1)*100 if 1+tr/100 > 0 else float('nan')
        print(f'  #{i+1:<2}  {n:<32}  cap {cap:>5.2f}%  opex {opx:>3.0f}%  mtg {mtg:>4.2f}%   cf_net {cf:>+6.2f}%  apprec {ap:>+7.2f}%   TOTAL {tr:>+7.2f}% ({tr_ann:>+5.2f}%/yr)   LEV ROE (70%LTV) {roe:>+7.2f}%')
    else:
        net_yield = cap * (1 - row['opex_ratio'])
        spread = net_yield - mtg
        zy = row['zori_yoy'] * 100 if pd.notna(row.get('zori_yoy')) else float('nan')
        print(f'  #{i+1:<2}  {n:<32}  cap {cap:>5.2f}%  opex {opx:>3.0f}%  net_yield {net_yield:>4.2f}%  mtg {mtg:>4.2f}%  spread {spread:>+5.2f}pp  zori_yoy {zy:>+5.2f}%   (60mo n/a)')

years = sorted(uni['year'].unique().tolist())
for yr in years:
    if yr < 2015: continue
    picks = pick_for_year(yr)
    if picks is None or picks.empty: continue
    obs = pd.notna(picks['total_return_5yr']).any()
    yr_uni = uni[uni['year']==yr].dropna(subset=['total_return_5yr'])
    print('\\n' + '=' * 140)
    if obs and not yr_uni.empty:
        u_mean = yr_uni['total_return_5yr'].mean() * 100
        u_med  = yr_uni['total_return_5yr'].median() * 100
        print(f'YEAR {yr}   universe_n={len(uni[uni.year==yr])}   universe 5yr TR: mean {u_mean:+.2f}%   median {u_med:+.2f}%')
    else:
        print(f'YEAR {yr}   universe_n={len(uni[uni.year==yr])}   (5yr forward not observable yet — ex-ante view)')
    print('=' * 140)
    for i in range(len(picks)):
        _print_row(i, picks.iloc[i], obs=obs)
    if obs and picks['total_return_5yr'].notna().any():
        cf_avg  = picks['cash_flow_5yr'].mean()    * 100
        ap_avg  = picks['appreciation_5yr'].mean() * 100
        tr_avg  = picks['total_return_5yr'].mean() * 100
        roe_avg = picks['levered_ROE_5yr'].mean()  * 100
        opx_avg = picks['opex_ratio'].mean() * 100
        edge    = tr_avg - u_mean
        print(f'       {"AVG":<32}                        opex {opx_avg:>3.0f}%              cf_net {cf_avg:>+6.2f}%  apprec {ap_avg:>+7.2f}%   TOTAL {tr_avg:>+7.2f}%   LEV ROE {roe_avg:>+7.2f}%   [edge {edge:+.2f}pp]')
"""

AGGREGATE_CELL = """# Aggregate performance (2015-2020 observable cohorts — 5yr forward)
rows = []
for yr in years:
    if yr < 2015: continue
    picks = pick_for_year(yr)
    if picks is None or picks.empty or picks['total_return_5yr'].isna().all(): continue
    yr_uni = uni[uni['year'] == yr].dropna(subset=['total_return_5yr'])
    rows.append({
        'year':              yr,
        'n_picks':           len(picks),
        'cf_net':            picks['cash_flow_5yr'].mean() * 100,
        'apprec':            picks['appreciation_5yr'].mean() * 100,
        'total_return':      picks['total_return_5yr'].mean() * 100,
        'levered_ROE_70LTV': picks['levered_ROE_5yr'].mean() * 100,
        'universe_mean':     yr_uni['total_return_5yr'].mean() * 100,
        'edge_pp':           (picks['total_return_5yr'].mean() - yr_uni['total_return_5yr'].mean()) * 100,
    })
agg = pd.DataFrame(rows)
print('Year-by-year (2015-2020 observable, 5yr forward):')
print(agg.to_string(index=False))
if not agg.empty:
    print()
    print(f'  Avg NET cash flow (5yr):     {agg["cf_net"].mean():>+7.2f}%')
    print(f'  Avg appreciation (5yr):      {agg["apprec"].mean():>+7.2f}%')
    print(f'  Avg TOTAL return (5yr, net): {agg["total_return"].mean():>+7.2f}%')
    print(f'  Avg LEV ROE 70% LTV (5yr):   {agg["levered_ROE_70LTV"].mean():>+7.2f}%')
    print(f'  Avg edge vs universe:        {agg["edge_pp"].mean():>+7.2f}pp')
"""

# ══════════════════════════════════════════════════════════════════════════════
# PICKS HISTORY — 5yr with stress-test counterfactuals + NOI decomposition
# ══════════════════════════════════════════════════════════════════════════════

PICKS_HISTORY_CELL = """# Per-pick history — every pick, every cohort, with realized 5-YEAR performance,
# NOI vs cap-compression decomposition, and counterfactual stress-test ROEs.
picks_rows = []
for yr in years:
    if yr < 2015: continue
    picks = pick_for_year(yr)
    if picks is None or picks.empty: continue
    yr_uni = uni[uni['year'] == yr].dropna(subset=['total_return_5yr'])
    uni_mean_tr = yr_uni['total_return_5yr'].mean() * 100 if not yr_uni.empty else float('nan')
    for i in range(len(picks)):
        row = picks.iloc[i]
        cf   = row['cash_flow_5yr']    * 100 if pd.notna(row.get('cash_flow_5yr'))    else None
        ap   = row['appreciation_5yr'] * 100 if pd.notna(row.get('appreciation_5yr')) else None
        tr   = row['total_return_5yr'] * 100 if pd.notna(row.get('total_return_5yr')) else None
        roe  = row['levered_ROE_5yr']  * 100 if pd.notna(row.get('levered_ROE_5yr'))  else None
        cap  = row['cap_rate_proxy']   * 100
        opex = row['opex_ratio']       * 100
        mtg  = row['mortgage_rate']    * 100
        edge = (tr - uni_mean_tr) if (tr is not None and pd.notna(uni_mean_tr)) else None
        tr_ann = ((1+tr/100)**(1/5)-1)*100 if (tr is not None and 1+tr/100 > 0) else None

        # NOI vs Cap Compression Decomposition (using 5yr ZORI + HPI)
        zori_60mo = row.get('zori_forward_return_60mo')
        hpi_60mo  = row.get('hpi_forward_return_60mo')
        entry_noi_gross = cap * (1 - opex/100)
        if pd.notna(zori_60mo):
            exit_noi_gross = entry_noi_gross * (1 + zori_60mo)
            noi_growth_pct = zori_60mo * 100
        else:
            exit_noi_gross = None; noi_growth_pct = None
        if pd.notna(hpi_60mo) and pd.notna(zori_60mo):
            exit_cap_gross = cap * (1 + zori_60mo) / (1 + hpi_60mo)
            cap_change_pp  = cap - exit_cap_gross
            apprec_from_noi = zori_60mo * 100
            apprec_from_cap = (hpi_60mo - zori_60mo) * 100
        else:
            exit_cap_gross = None; cap_change_pp = None
            apprec_from_noi = None; apprec_from_cap = None

        # ── COUNTERFACTUAL STRESS TESTS (5yr versions) ─────────────────────
        # A: mortgage +100bp for 5 years  |  B: NOI cap +50bp at exit  |  Both combined
        HORIZON = 5
        LTV     = 0.70
        ROE_stress_rate = ROE_stress_cap = ROE_stress_both = None
        if pd.notna(cf) and pd.notna(zori_60mo):
            cf_frac = cf / 100
            actual_debt_frac = HORIZON * LTV * (mtg / 100)
            actual_apprec_frac = (ap / 100) if pd.notna(ap) else 0.0
            # Stress A: rate +100bp for full 5yr hold
            stressed_debt_frac = HORIZON * LTV * ((mtg + 1.0) / 100)
            ROE_stress_rate = (cf_frac - stressed_debt_frac + actual_apprec_frac) / (1 - LTV) * 100
            # Stress B: NOI cap +50bp at exit
            entry_noi_cap  = cap/100 * (1 - opex/100)
            exit_noi       = entry_noi_cap * (1 + zori_60mo)
            stressed_exit_cap = entry_noi_cap + 0.005
            stressed_exit_val = exit_noi / stressed_exit_cap
            stressed_apprec_frac = stressed_exit_val - 1
            ROE_stress_cap = (cf_frac - actual_debt_frac + stressed_apprec_frac) / (1 - LTV) * 100
            # Both combined
            ROE_stress_both = (cf_frac - stressed_debt_frac + stressed_apprec_frac) / (1 - LTV) * 100

        if tr is None:
            verdict = 'n/a — not yet observable'
        elif edge > 2:
            verdict = 'ABOVE AVERAGE'
        elif edge < -2:
            verdict = 'BELOW AVERAGE'
        else:
            verdict = 'AVERAGE'

        picks_rows.append({
            'year':                 yr,
            'rank':                 i+1,
            'market':               f"{row['county_name'].replace(' County','')}, {row['state_name']}",
            'entry_cap%':           cap,
            'exit_cap%':            exit_cap_gross,
            'cap_comp_pp':          cap_change_pp,
            'opex%':                opex,
            'entry_noi%':           entry_noi_gross,
            'exit_noi%':            exit_noi_gross,
            'noi_growth_5yr%':      noi_growth_pct,
            'mtg%':                 mtg,
            'cf_net_5yr%':          cf,
            'apprec_from_noi%':     apprec_from_noi,
            'apprec_from_cap%':     apprec_from_cap,
            'apprec_total_5yr%':    ap,
            'total_return_5yr%':    tr,
            'total_return_ann%':    tr_ann,
            'ROE_stress_rate%':     ROE_stress_rate,
            'ROE_stress_cap%':      ROE_stress_cap,
            'ROE_stress_both%':     ROE_stress_both,
            'universe_TR_5yr%':     uni_mean_tr if pd.notna(uni_mean_tr) else None,
            'edge_pp':              edge,
            'levered_ROE_5yr%':     roe,
            'verdict':              verdict,
            'mf_bldgs_5to9':        int(row['mf_bldgs_5to9'])   if pd.notna(row.get('mf_bldgs_5to9'))   else None,
            'mf_bldgs_10to19':      int(row['mf_bldgs_10to19']) if pd.notna(row.get('mf_bldgs_10to19')) else None,
            'mf_bldgs_5to19':       int(row['mf_bldgs_5to19'])  if pd.notna(row.get('mf_bldgs_5to19'))  else None,
            'mf_bldgs_20to49':      int(row['mf_bldgs_20to49']) if pd.notna(row.get('mf_bldgs_20to49')) else None,
            'mf_bldgs_50plus':      int(row['mf_bldgs_50plus']) if pd.notna(row.get('mf_bldgs_50plus')) else None,
        })
picks_df = pd.DataFrame(picks_rows)

def _color_verdict_pick(v):
    if v == 'ABOVE AVERAGE':  return 'background-color: #d4edda; color: #006600; font-weight: bold'
    if v == 'BELOW AVERAGE':  return 'background-color: #e2e3e5; color: #6c757d'
    if v == 'AVERAGE':        return 'background-color: #fff3cd; color: #7a5a00'
    return 'background-color: #eeeeee; color: #666'
def _color_edge(v):
    if pd.isna(v): return ''
    if v > 5:  return 'color: #006600; font-weight: bold'
    if v > 0:  return 'color: #006600'
    if v < -5: return 'color: #b30000; font-weight: bold'
    return 'color: #b30000'
def _color_negative_return(v):
    if pd.isna(v): return ''
    if v < 0: return 'background-color: #f8d7da; color: #b30000; font-weight: bold'
    return ''

picks_styled = (picks_df.style
    .format({
        'entry_cap%':'{:.2f}%', 'exit_cap%':'{:.2f}%', 'cap_comp_pp':'{:+.2f}pp',
        'opex%':'{:.0f}%', 'entry_noi%':'{:.2f}%', 'exit_noi%':'{:.2f}%',
        'noi_growth_5yr%':'{:+.2f}%', 'mtg%':'{:.2f}%',
        'cf_net_5yr%':'{:+.2f}%',
        'apprec_from_noi%':'{:+.2f}%', 'apprec_from_cap%':'{:+.2f}%', 'apprec_total_5yr%':'{:+.2f}%',
        'total_return_5yr%':'{:+.2f}%', 'total_return_ann%':'{:+.2f}%/yr',
        'universe_TR_5yr%':'{:+.2f}%', 'edge_pp':'{:+.2f}pp',
        'levered_ROE_5yr%':'{:+.2f}%',
        'ROE_stress_rate%':'{:+.2f}%', 'ROE_stress_cap%':'{:+.2f}%', 'ROE_stress_both%':'{:+.2f}%',
        'mf_bldgs_5to9':'{:,.0f}', 'mf_bldgs_10to19':'{:,.0f}', 'mf_bldgs_5to19':'{:,.0f}',
        'mf_bldgs_20to49':'{:,.0f}', 'mf_bldgs_50plus':'{:,.0f}',
    }, na_rep='—')
    .map(_color_verdict_pick, subset=['verdict'])
    .map(_color_edge, subset=['edge_pp'])
    .map(_color_negative_return, subset=['total_return_5yr%'])
    .map(_color_negative_return, subset=['levered_ROE_5yr%'])
    .map(_color_negative_return, subset=['ROE_stress_rate%'])
    .map(_color_negative_return, subset=['ROE_stress_cap%'])
    .map(_color_negative_return, subset=['ROE_stress_both%'])
    .set_caption('Every pick across every cohort — 5yr hold. Red = absolute loss. Stress columns = counterfactual 5yr ROE at +100bp mortgage / +50bp exit NOI cap / both.')
)
picks_styled
"""

PICKS_HISTORY_SUMMARY_CELL = """# Aggregate: how did this strategy's picks perform historically? (5yr hold)
observable = picks_df[picks_df['verdict'].isin(['ABOVE AVERAGE','BELOW AVERAGE','AVERAGE'])].copy()
n_above   = int((observable['verdict']=='ABOVE AVERAGE').sum())
n_avg     = int((observable['verdict']=='AVERAGE').sum())
n_below   = int((observable['verdict']=='BELOW AVERAGE').sum())
n_underwater = int((observable['total_return_5yr%'] < 0).sum())
n_total   = len(observable)

STRATEGY_NAME = globals().get('STRATEGY_NAME', 'EMERGING-VALUE (5yr hold)')

summary_rows = [
    {'metric': f'Strategy',                                    'result': STRATEGY_NAME},
    {'metric': f'Above average (beat universe by >2pp)',       'result': f'{n_above}/{n_total}'},
    {'metric': f'Average (within ±2pp of universe)',           'result': f'{n_avg}/{n_total}'},
    {'metric': f'Below average (trailed universe by >2pp)',    'result': f'{n_below}/{n_total}'},
    {'metric': f'Underwater deals (negative total return)',    'result': f'{n_underwater}/{n_total}'},
]
print('STRATEGY SUMMARY:')
print()
print(pd.DataFrame(summary_rows).to_string(index=False))
print()

# Stress-test survival summary
n_stress_rate_neg = int((observable['ROE_stress_rate%'] < 0).sum())
n_stress_cap_neg  = int((observable['ROE_stress_cap%'] < 0).sum())
n_stress_both_neg = int((observable['ROE_stress_both%'] < 0).sum())
detail_rows = [
    {'metric': 'above-average rate %',                                     'value': f'{round(n_above/n_total*100, 1)}%' if n_total else '—'},
    {'metric': 'avg edge vs universe (pp)',                                'value': f"{observable['edge_pp'].mean():+.2f}pp"},
    {'metric': 'avg total return (5yr)',                                   'value': f"{observable['total_return_5yr%'].mean():+.2f}%"},
    {'metric': 'avg total return (annualized)',                            'value': f"{observable['total_return_ann%'].mean():+.2f}%/yr"},
    {'metric': 'avg levered ROE (70% LTV, 5yr)',                           'value': f"{observable['levered_ROE_5yr%'].mean():+.2f}%"},
    {'metric': 'best pick TR',                                             'value': f"{observable['total_return_5yr%'].max():+.2f}%"},
    {'metric': 'worst pick TR',                                            'value': f"{observable['total_return_5yr%'].min():+.2f}%"},
    {'metric': 'STRESS — rate +100bp: picks with negative ROE',            'value': f'{n_stress_rate_neg}/{n_total}'},
    {'metric': 'STRESS — cap +50bp exit: picks with negative ROE',         'value': f'{n_stress_cap_neg}/{n_total}'},
    {'metric': 'STRESS — both combined: picks with negative ROE',          'value': f'{n_stress_both_neg}/{n_total}'},
    {'metric': 'STRESS — both combined: avg ROE',                          'value': f"{observable['ROE_stress_both%'].mean():+.2f}%"},
]
print('DETAILED STATS + STRESS-TEST SURVIVAL:')
print()
print(pd.DataFrame(detail_rows).to_string(index=False))
print()

best  = observable.nlargest(5, 'total_return_5yr%')[['year','rank','market','entry_cap%','total_return_5yr%','total_return_ann%','edge_pp','verdict']]
worst = observable.nsmallest(5, 'total_return_5yr%')[['year','rank','market','entry_cap%','total_return_5yr%','total_return_ann%','edge_pp','verdict']]
print('TOP 5 PICKS by realized 5yr total return:')
print(best.to_string(index=False))
print()
print('BOTTOM 5 PICKS by realized 5yr total return:')
print(worst.to_string(index=False))
"""

# ══════════════════════════════════════════════════════════════════════════════
# CURRENT YEAR CELL — 5yr underwriting math
# ══════════════════════════════════════════════════════════════════════════════

CURRENT_YEAR_CELL = """# Current year (2025) picks — MF-native underwriting view (5-year hold)
CURRENT_YEAR       = 2025
RATE_STRESS_BP     = 0.005   # +50bp rate stress test
TARGET_ROE_ANNUAL  = 0.15    # target 15%/yr levered ROE
HORIZON            = 5
TARGET_ROE_5YR = (1 + TARGET_ROE_ANNUAL) ** HORIZON - 1

def levered_roe_5yr(noi_yield, g, mtg, ltv=LTV, horizon=HORIZON):
    '''Return cumulative 5yr levered ROE given entry NOI yield and annual NOI growth rate.'''
    debt_yield = ltv * mtg
    equity_pct = 1 - ltv
    annual_debt = debt_yield
    # Sum of compounding NOI yield over 5 years
    if g == 0:
        noi_sum = noi_yield * horizon
    else:
        noi_sum = noi_yield * ((1+g)*((1+g)**horizon - 1) / g)
    cumulative_cf = noi_sum - horizon * annual_debt
    capital_gain = (1+g)**horizon - 1
    return (cumulative_cf + capital_gain) / equity_pct

def solve_noi_growth(noi_yield, mtg, roe_target_5yr=0.0, ltv=LTV):
    '''Bisection: find annual NOI growth g such that 5yr levered ROE = target.'''
    lo, hi = -0.30, 0.40
    def f(g): return levered_roe_5yr(noi_yield, g, mtg, ltv) - roe_target_5yr
    if f(lo) > 0: return float('-inf')
    if f(hi) < 0: return float('inf')
    for _ in range(60):
        mid = (lo + hi) / 2
        if f(mid) < 0: lo = mid
        else: hi = mid
        if hi - lo < 1e-6: break
    return (lo + hi) / 2

picks = pick_for_year(CURRENT_YEAR)
mtg_base   = uni[uni['year'] == CURRENT_YEAR]['mortgage_rate'].iloc[0]
mtg_stress = mtg_base + RATE_STRESS_BP

print(f'=== {CURRENT_YEAR} picks — MF underwriting view (5-YEAR hold) ===')
print(f'FRED MORTGAGE30US at cohort year-end: {mtg_base*100:.2f}%   |   stress scenario: {mtg_stress*100:.2f}% (+50bp)')
print(f'Assumptions: 70% LTV interest-only 5yr hold, exit cap = entry cap, no transaction costs')
print(f'Target: {TARGET_ROE_ANNUAL*100:.0f}%/yr levered ROE ({TARGET_ROE_5YR*100:.1f}% cumulative over 5yr)')
print()

rows = []
for i in range(len(picks)):
    r = picks.iloc[i]
    cap  = r['cap_rate_proxy']
    opex = r['opex_ratio']
    zy   = r['zori_yoy'] if pd.notna(r['zori_yoy']) else 0.0
    noi_yld    = cap * (1 - opex)
    debt_yld   = LTV * mtg_base
    dscr       = noi_yld / debt_yld
    noi_gap    = noi_yld - debt_yld

    g_be_base   = solve_noi_growth(noi_yld, mtg_base,   roe_target_5yr=0.0)
    g_be_stress = solve_noi_growth(noi_yld, mtg_stress, roe_target_5yr=0.0)
    g_tgt_base  = solve_noi_growth(noi_yld, mtg_base,   roe_target_5yr=TARGET_ROE_5YR)

    # Projected 5yr levered ROE at trailing zori_yoy as NOI growth
    proj_roe_5yr = levered_roe_5yr(noi_yld, zy, mtg_base)
    proj_roe_ann = (1 + proj_roe_5yr) ** (1/HORIZON) - 1 if 1 + proj_roe_5yr > 0 else float('nan')

    rows.append({
        '#': i+1,
        'market':   f"{r['county_name'].replace(' County','')}, {r['state_name']}",
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
        'mf_bldgs_5to9':    int(r['mf_bldgs_5to9'])   if pd.notna(r.get('mf_bldgs_5to9'))   else None,
        'mf_bldgs_10to19':  int(r['mf_bldgs_10to19']) if pd.notna(r.get('mf_bldgs_10to19')) else None,
        'mf_bldgs_5to19':   int(r['mf_bldgs_5to19'])  if pd.notna(r.get('mf_bldgs_5to19'))  else None,
        'mf_bldgs_20to49':  int(r['mf_bldgs_20to49']) if pd.notna(r.get('mf_bldgs_20to49')) else None,
        'mf_bldgs_50plus':  int(r['mf_bldgs_50plus']) if pd.notna(r.get('mf_bldgs_50plus')) else None,
    })
df = pd.DataFrame(rows)

def _color_dscr(v):
    if pd.isna(v): return ''
    if v >= 1.20: return 'background-color: #d4edda; color: #006600; font-weight: bold'
    if v >= 1.00: return 'background-color: #fff3cd; color: #7a5a00'
    return 'background-color: #f8d7da; color: #b30000; font-weight: bold'
def _color_noi_gap(v):
    if pd.isna(v): return ''
    if v > 0: return 'color: #006600; font-weight: bold'
    return 'color: #b30000'
def _color_noi_growth(v):
    if pd.isna(v) or v == float('inf') or v == float('-inf'): return ''
    if v < 2: return 'background-color: #d4edda; color: #006600; font-weight: bold'
    if v < 4: return 'background-color: #fff3cd; color: #7a5a00'
    return 'background-color: #f8d7da; color: #b30000; font-weight: bold'
def _color_projected_roe(v):
    if pd.isna(v): return ''
    if v > TARGET_ROE_ANNUAL*100: return 'background-color: #d4edda; color: #006600; font-weight: bold'
    if v > 5: return 'background-color: #fff3cd; color: #7a5a00'
    return 'background-color: #f8d7da; color: #b30000; font-weight: bold'

styled = (df.style
    .format({
        'cap_gross':'{:.2f}%','opex%':'{:.0f}%','noi_yld':'{:.2f}%',
        'mtg':'{:.2f}%','debt_yld':'{:.2f}%','DSCR':'{:.2f}x',
        'noi_gap':'{:+.2f}pp','zori_yoy':'{:+.2f}%',
        'NOI_grow_BE':'{:+.2f}%/yr','NOI_grow_BE_+50bp':'{:+.2f}%/yr','NOI_grow_TGT_15%':'{:+.2f}%/yr',
        'Proj_ROE_@zori':'{:+.2f}%/yr',
        'mf_bldgs_5to9':'{:,.0f}','mf_bldgs_10to19':'{:,.0f}','mf_bldgs_5to19':'{:,.0f}',
        'mf_bldgs_20to49':'{:,.0f}','mf_bldgs_50plus':'{:,.0f}',
    }, na_rep='—')
    .map(_color_dscr, subset=['DSCR'])
    .map(_color_noi_gap, subset=['noi_gap'])
    .map(_color_noi_growth, subset=['NOI_grow_BE','NOI_grow_BE_+50bp','NOI_grow_TGT_15%'])
    .map(_color_projected_roe, subset=['Proj_ROE_@zori'])
    .set_caption(f'{CURRENT_YEAR} picks — 5-YEAR HOLD underwriting view')
)
display(styled)

print()
print('COLUMN GUIDE:')
print('  cap_gross          = gross ACS cap-rate proxy')
print('  noi_yld            = net NOI yield after opex')
print('  DSCR               = noi_yld / (LTV × mortgage rate). Green ≥1.20, Amber 1.00-1.20, Red <1.00')
print('  noi_gap            = net cash carry vs debt service (positive = self-sustaining)')
print('  zori_yoy           = trailing 12mo rent change')
print('  NOI_grow_BE        = annual NOI growth needed for 5yr levered ROE = 0 (breakeven)')
print('  NOI_grow_BE_+50bp  = same, at mortgage +50bp (rate stress)')
print('  NOI_grow_TGT_15%   = annual NOI growth needed for 15%/yr levered ROE over 5yr')
print('  Proj_ROE_@zori     = projected annualized levered ROE if trailing zori_yoy holds for 5yr')
print()
print('READING:')
print('  • NOI_grow_BE < 3%/yr is defensible at trend rent growth')
print('  • NOI_grow_TGT_15% > 6%/yr means you need above-trend growth to hit target')
print('  • Proj_ROE_@zori > 15%/yr = deal projected to hit target on trailing momentum')
"""

# ══════════════════════════════════════════════════════════════════════════════
# ASSEMBLE — same section structure as 3yr notebook
# ══════════════════════════════════════════════════════════════════════════════

cells = [
    md(TITLE_DESC),
    md(FEATURES_MD),
    md('## 1. Config'),
    code(CONFIG_CELL),
    md('## 2. Load universe + compute 5-year return metrics'),
    code(DATA_LOAD_CELL),
    md('## 3. Method implementation'),
    code(METHOD_CELL),
    md('## 4. Per-year picks (2015–2025)'),
    code(PICKS_PER_YEAR_CELL),
    md('## 5. Aggregate performance (2015–2020 observable)'),
    code(AGGREGATE_CELL),
    md('## 6. Per-pick history — every pick with realized 5yr returns'),
    md(PICKS_HISTORY_MD),
    code(PICKS_HISTORY_CELL),
    code(PICKS_HISTORY_SUMMARY_CELL),
    md('## 7. Regime context (informational — does not drive picks)'),
    md(REGIME_CRITERIA_MD),
    code(REGIME_CONTEXT_CELL),
    md('## 8. Regime validation — per-year prediction vs actual'),
    md(REGIME_VALIDATION_MD),
    code(REGIME_VALIDATION_CELL),
    code(REGIME_ACCURACY_CELL),
    md('## 9. Regime forecasting tools — historical analog finder + Markov transition matrix'),
    md(REGIME_FORECAST_MD),
    code(ANALOG_FINDER_CELL),
    code(MARKOV_TRANSITION_CELL),
    md('## 10. Current year (2025) picks — actionable (5-year hold underwriting)'),
    code(CURRENT_YEAR_CELL),
]

nb = wrap(cells)
OUT_PATH.write_text(json.dumps(nb, indent=1))
print(f'wrote {OUT_PATH.relative_to(NB_DIR.parent)}   ({len(cells)} cells)')
