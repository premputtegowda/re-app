"""Standalone generator for strategy_emerging_value_small.ipynb.

Companion to strategy_emerging_value.ipynb. Same VALUE philosophy but applied
to a SMALLER universe (100K-300K pop) — genuinely off-radar markets that the
main strategy (300K-1M pop) doesn't screen.

Key differences from main VALUE strategy:
- Universe: 100K-300K pop (372 counties, mostly off institutional radar)
- Cap floor: ≥ 6.5% (require real yield to compensate for illiquidity)
- Pop growth gate: ≥ +0.3% (stricter — smaller markets can genuinely shrink)
- HHI gate: ≤ 0.12 (tighter — single-employer risk is bigger deal at small scale)
- Business apps floor: ≥ 10 (filter out truly declining economies)
- MF inventory HARD GATE: bldgs_5to19 ≥ 500 (executability filter)
- Top-N: 20 (more diversification since smaller markets cluster geographically)
- Max per state: 4

Uses 3yr horizon (36mo forwards) — matches primary VALUE notebook.
"""
from __future__ import annotations
import importlib.util, json
from pathlib import Path

NB_DIR = Path(__file__).resolve().parent
OUT_PATH = NB_DIR / 'strategy_emerging_value_small.ipynb'

# ── Import shared regime/forecast/history-md pieces from main generator ─────
_spec = importlib.util.spec_from_file_location('_gen', NB_DIR / '_generate_strategy_notebooks.py')
_gen = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_gen)

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
# TITLE + FEATURES MD
# ══════════════════════════════════════════════════════════════════════════════

TITLE_DESC = """# EMERGING-VALUE-SMALL — Genuinely Off-Radar Markets (100K-300K pop)

**Companion to `strategy_emerging_value.ipynb`.** Same VALUE philosophy — yield-anchored, institutional-absence-focused — but screens the **smaller-metro universe** (100K-300K pop) that the primary VALUE strategy ignores.

## Why a smaller-metro variant?

The primary EMERGING-VALUE strategy screens 300K-1M pop metros. By definition, any market of that size is on institutional radar — the picks (Marion FL, Marion IN, Montgomery OH, El Paso TX) are **under-priced known markets**, not undiscovered ones. The cap-spread signal detects institutional avoidance, but these markets are avoided for known reasons (Rust Belt story, border-economy, hurricane risk), not obscurity.

This variant explores **genuinely off-radar markets** — the 100K-300K pop universe has ~372 counties, most of which have zero institutional MF activity. Markets like Muncie IN, Terre Haute IN, Watertown NY, Amarillo TX, Charleston WV — nobody talks about these on CRE podcasts. If mispricing exists anywhere, it exists here.

## Tighter parameters — margin of safety matters more at smaller scale

Smaller markets carry structural risks that the main strategy doesn't have to worry about:
- Single-employer dependence (military base, university, one factory)
- Population decline (many small metros are shrinking)
- Thin MF inventory (some counties have <200 5-19 unit buildings)
- Weaker exit liquidity
- Higher property tax volatility

To compensate, this variant tightens the gates:

| Parameter | Main VALUE | **SMALL variant** |
|---|---|---|
| Population | 300K-1M | **100K-300K** |
| Cap rate floor | ≥ pool median | **≥ 6.5% hard floor** |
| Pop growth gate | ≥ 0.0% | **≥ +0.3%** (block shrinking) |
| Employment diversity HHI | ≤ 0.15 | **≤ 0.12** (tighter) |
| Business apps floor | none | **≥ 10** (block declining economies) |
| **MF inventory HARD GATE** | none | **≥ 500 bldgs 5-19 units** (executability) |
| Top-N | 10 | **20** (more diversification) |
| Max per state | 3 | **4** |

## Honest disclosure

**This is exploratory.** No historical backtest of THIS specific parameter set exists yet — it gets built and evaluated fresh in this notebook. Historical pass rates for the tighter gates may filter aggressively; result could be very few observable picks per cohort.

The primary VALUE strategy is empirically validated (0/80 underwater, 60/80 above avg at 3yr). This SMALL variant is an experiment. Compare metrics before deploying.
"""

FEATURES_MD = """## EMERGING-VALUE-SMALL — Full Criteria

### Layer 1 — Universe
| Filter | Value | Purpose |
|---|---|---|
| Population | **100K – 300K** | Genuinely off institutional radar |
| Employment diversity HHI | ≤ 0.15 (universe) | Broadened, tightened at gate |

### Layer 2 — Hard gates (NaN-permissive except MF inventory)
| Gate | Threshold | Rationale |
|---|---|---|
| `pop_yoy_pct` | **≥ +0.3%** | Block genuinely shrinking markets (stricter than main VALUE's 0.0%) |
| `permits_intensity_ratio` | < 1.5 | Not over-building |
| `unemployment_rate` | ≤ 6.0% | Healthy labor market |
| `wage_growth_yoy` | ≥ 2.0% | Rent capacity |
| `business_apps_per_1000` | **≥ 10** (NEW hard floor) | Block declining entrepreneurial economies |
| `employment_diversity_hhi` | **≤ 0.12** (tighter) | Kill single-employer risk (military base only, university only) |
| `cap_spread_to_gateway_pp` | ≥ 0.0 | Cap ≥ gateway median |
| `bldgs_5to19` | **≥ 500** (NEW HARD gate, not NaN-permissive) | Must have executable MF inventory |
| `cap_rate_proxy` | **≥ 6.5%** (hard floor) | Real yield to compensate for illiquidity |
| `any_disqualifier` | must be FALSE | Aging trap / sector layoffs / etc. |

### Layer 3 — Opportunity score (unchanged from main VALUE)
Same weights, same yield-anchored philosophy:
| Signal | Weight |
|---|---|
| `cap_spread_to_gateway_pp` | 1.5 (tuned from 2.0) |
| `cap_rate_proxy` | 1.5 |
| `wage_growth_yoy` | 0.8 |
| `pop_yoy_pct` | 0.5 |
| `business_apps_per_1000` | 0.5 |
| `permits_per_new_job` | -1.0 |

### Layer 4 — Selection
- Take top 20 by opportunity score
- Max 4 picks per state
- More picks + higher state cap = more geographic diversification (small markets cluster)

### Layer 5 — Same regime tools, 3yr hold underwriting
Regime detector, analog finder, Markov matrix, picks history — all identical to main VALUE. Only the universe and gates differ.
"""

# ══════════════════════════════════════════════════════════════════════════════
# CONFIG
# ══════════════════════════════════════════════════════════════════════════════

CONFIG_CELL = """# ══════════════════════════════════════════════════════════════════════════
#  CONFIG — EMERGING-VALUE-SMALL (100K-300K pop universe)
# ══════════════════════════════════════════════════════════════════════════
import duckdb
import numpy as np
import pandas as pd

WAREHOUSE = '/Users/premputtegowda/reps/reps-tracker/emerging_re/data/warehouse/emerging_re.duckdb'

# SMALL universe — genuinely off-radar territory
POP_MIN            = 100_000
POP_MAX            = 300_000
HHI_MAX            = 0.15         # universe filter (looser than strategy gate)
TOP_N              = 20           # more picks for diversification
MAX_PER_STATE      = 4            # higher state cap since small markets cluster
MAX_SECTOR_SHARE   = 0.25
MIN_CAP_SPREAD_PP  = 0.0
MAX_HHI_STRATEGY   = 0.12         # TIGHTER than main VALUE (0.15) — single-employer risk
MIN_CAP_FLOOR      = 0.065        # 6.5% cap hard floor
MIN_BUSINESS_APPS  = 10.0         # entrepreneurial vitality floor
MIN_MF_BLDGS       = 500          # HARD executability gate
MIN_POP_YOY_PCT    = 0.3          # STRICTER than main VALUE (0.0)

HORIZON_YEARS = 3
LTV           = 0.70

STRATEGY_NAME = 'EMERGING-VALUE-SMALL (100K-300K pop, 3yr hold)'
pd.set_option('display.width', 200); pd.set_option('display.max_rows', 200)
print(f'Config loaded. Universe: pop {POP_MIN:,}-{POP_MAX:,}  HHI<={HHI_MAX}  top_n={TOP_N}  HORIZON={HORIZON_YEARS}yr')
print(f'Strategy-level gates: cap ≥ {MIN_CAP_FLOOR*100:.1f}%  HHI ≤ {MAX_HHI_STRATEGY}  bldgs 5-19 ≥ {MIN_MF_BLDGS}  apps ≥ {MIN_BUSINESS_APPS}')
"""

# ══════════════════════════════════════════════════════════════════════════════
# DATA LOAD (3yr metrics, includes MF building counts for the hard gate)
# ══════════════════════════════════════════════════════════════════════════════

DATA_LOAD_CELL = """# Load universe + attach mortgage rate + opex + MF inventory + compute 3yr return metrics
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
           wage_growth_yoy, emp_growth_yoy,
           business_apps_per_1000,
           max_supersector_share, employment_diversity_hhi,
           zori_forward_return_36mo, hpi_forward_return_36mo
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

# State-based opex
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

# 3yr return metrics
uni['cash_flow_3yr']    = HORIZON_YEARS * uni['cap_rate_proxy'] * (1 - uni['opex_ratio']) * (1 + uni['zori_forward_return_36mo'] / 2)
uni['appreciation_3yr'] = uni['hpi_forward_return_36mo']
uni['total_return_3yr'] = uni['cash_flow_3yr'] + uni['appreciation_3yr']
uni['debt_service_3yr'] = HORIZON_YEARS * LTV * uni['mortgage_rate']
uni['levered_ROE_3yr']  = (uni['cash_flow_3yr'] - uni['debt_service_3yr'] + uni['appreciation_3yr']) / (1 - LTV)

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

# Diagnostic: how many counties have MF inventory data?
n_with_mf = uni['mf_bldgs_5to19'].notna().sum()
n_meet_mf_floor = (uni['mf_bldgs_5to19'] >= MIN_MF_BLDGS).sum()
print(f'Universe: {len(uni)} county-years across {uni.year.nunique()} years')
print(f'  With MF inventory data: {n_with_mf}   Meeting MF floor ({MIN_MF_BLDGS}+ bldgs 5-19): {n_meet_mf_floor}')
"""

# ══════════════════════════════════════════════════════════════════════════════
# METHOD — tighter gates + MF inventory hard gate
# ══════════════════════════════════════════════════════════════════════════════

METHOD_CELL = """# EMERGING-VALUE-SMALL method — tighter gates + MF inventory hard gate
SMALL_GATES = {
    'min_pop_yoy_pct':      MIN_POP_YOY_PCT,        # 0.3 stricter
    'max_permit_ratio':     1.5,
    'max_unemp_pct':        6.0,
    'min_wage_growth':      0.02,
    'max_sector_share':     MAX_SECTOR_SHARE,
    'min_cap_spread_pp':    MIN_CAP_SPREAD_PP,
    'max_hhi_strategy':     MAX_HHI_STRATEGY,       # 0.12 stricter
    'min_business_apps':    MIN_BUSINESS_APPS,      # 10 floor (NEW)
    'min_mf_bldgs':         MIN_MF_BLDGS,           # 500 HARD (NEW)
    'min_cap_floor':        MIN_CAP_FLOOR,          # 6.5% hard floor (NEW)
    'require_no_disq':      True,
}

# Same weights as main VALUE — the philosophy is identical, only the universe differs
# cap_spread reduced 2.0 → 1.5 after 100K-500K walk-forward showed hand weight slightly over-emphasized.
OPPORTUNITY_WEIGHTS = {
    'cap_spread_to_gateway_pp':  1.5,
    'cap_rate_proxy':            1.5,
    'wage_growth_yoy':           0.8,
    'pop_yoy_pct':               0.5,
    'business_apps_per_1000':    0.5,
    'permits_per_new_job':      -1.0,
}

def pick_for_year(year, gates=SMALL_GATES):
    c = uni[uni['year'] == year].dropna(subset=['cap_rate_proxy']).copy()
    if c.empty: return pd.DataFrame()
    pop_yr = pop_yoy_cache.get(year, pd.DataFrame())
    if not pop_yr.empty:
        c = c.merge(pop_yr[['fips','pop_yoy_pct']], on='fips', how='left')
    else:
        c['pop_yoy_pct'] = np.nan
    n_before = len(c)

    # Hard gates (some NaN-permissive, some strict)
    c = c[c['pop_yoy_pct'].isna()             | (c['pop_yoy_pct']             >= gates['min_pop_yoy_pct'])]
    c = c[c['permits_intensity_ratio'].isna() | (c['permits_intensity_ratio'] <  gates['max_permit_ratio'])]
    c = c[c['unemployment_rate'].isna()       | (c['unemployment_rate']       <= gates['max_unemp_pct'])]
    c = c[c['wage_growth_yoy'].isna()         | (c['wage_growth_yoy']         >= gates['min_wage_growth'])]
    c = c[c['max_supersector_share'].isna()   | (c['max_supersector_share']   <= gates['max_sector_share'])]
    c = c[c['cap_spread_to_gateway_pp'].isna()| (c['cap_spread_to_gateway_pp']>= gates['min_cap_spread_pp'])]
    c = c[c['employment_diversity_hhi'].isna()| (c['employment_diversity_hhi']<= gates['max_hhi_strategy'])]
    c = c[c['business_apps_per_1000'].isna()  | (c['business_apps_per_1000']  >= gates['min_business_apps'])]
    if gates['require_no_disq']:
        c = c[(c['any_disqualifier'] == False) | (c['any_disqualifier'].isna())]

    # HARD gates (NOT NaN-permissive — required for executability/yield floor)
    c = c[c['cap_rate_proxy']  >= gates['min_cap_floor']]           # 6.5% hard yield floor
    c = c[c['mf_bldgs_5to19'].notna() & (c['mf_bldgs_5to19'] >= gates['min_mf_bldgs'])]  # 500 bldgs required

    n_after = len(c)
    print(f'  {year}: {n_before} → {n_after} candidates after SMALL gates ({n_after/n_before*100:.0f}% pass rate)')
    if c.empty: return pd.DataFrame()

    # Opportunity score (identical to main VALUE)
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
    print(f'\\nEMERGING-VALUE-SMALL picks for 2025 (top {len(sample)}):')
    print(sample[['county_name','state_name','pop_latest','cap_rate_proxy','cap_spread_to_gateway_pp','pop_yoy_pct','wage_growth_yoy','business_apps_per_1000','mf_bldgs_5to19','opportunity_score']].to_string(index=False))
"""

# ══════════════════════════════════════════════════════════════════════════════
# PER-YEAR + AGGREGATE + PICKS HISTORY + SUMMARY — reuse main generator's cells
# (they operate on picks_df which is horizon-invariant in column names)
# ══════════════════════════════════════════════════════════════════════════════

# Reuse main generator's shared cells directly — they all use `pick_for_year` + 3yr columns
PICKS_PER_YEAR_CELL          = _gen.PICKS_PER_YEAR_CELL
AGGREGATE_CELL               = _gen.AGGREGATE_CELL
PICKS_HISTORY_CELL           = _gen.PICKS_HISTORY_CELL
PICKS_HISTORY_SUMMARY_CELL   = _gen.PICKS_HISTORY_SUMMARY_CELL
CURRENT_YEAR_CELL            = _gen.CURRENT_YEAR_CELL

# ══════════════════════════════════════════════════════════════════════════════
# ASSEMBLE
# ══════════════════════════════════════════════════════════════════════════════

cells = [
    md(TITLE_DESC),
    md(FEATURES_MD),
    md('## 1. Config'),
    code(CONFIG_CELL),
    md('## 2. Load universe + compute 3-year return metrics'),
    code(DATA_LOAD_CELL),
    md('## 3. Method implementation'),
    code(METHOD_CELL),
    md('## 4. Per-year picks (2015–2025)'),
    code(PICKS_PER_YEAR_CELL),
    md('## 5. Aggregate performance (2015–2022 observable)'),
    code(AGGREGATE_CELL),
    md('## 6. Per-pick history — every pick with realized returns'),
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
    md('## 10. Current year (2025) picks — actionable'),
    code(CURRENT_YEAR_CELL),
]

nb = wrap(cells)
OUT_PATH.write_text(json.dumps(nb, indent=1))
print(f'wrote {OUT_PATH.relative_to(NB_DIR.parent)}   ({len(cells)} cells)')
