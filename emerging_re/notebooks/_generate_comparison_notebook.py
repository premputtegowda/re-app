"""Generate strategy_comparison.ipynb — Option D: regime-informed default + all alternatives.

Structure:
  1. Title + description
  2. Config
  3. Data load (universe + FRED + opex + return metrics)
  4. Regime detector (5-signal consensus, both bug fixes applied)
  5. Regime timeline
  6. Strategy implementations (HC v1-v4 inline, ELITE imported)
  7. Regime → recommendation mapping
  8. Current year view (regime + recommendation + all 5 picks)
  9. Historical backtest — regime-conditional vs static HC v4
"""
from __future__ import annotations
import json
from pathlib import Path

NB_DIR = Path(__file__).resolve().parent

def md(source): return {"cell_type": "markdown", "metadata": {}, "source": source.splitlines(keepends=True)}
def code(source): return {"cell_type": "code", "execution_count": None, "metadata": {}, "outputs": [], "source": source.splitlines(keepends=True)}
def wrap(cells): return {"cells": cells, "metadata": {"kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"}}, "nbformat": 4, "nbformat_minor": 5}

TITLE = """# Strategy Comparison + Regime-Informed Recommendation

Compares all 5 strategies (HC v1, v2, v3, v4, ELITE) side-by-side per cohort year.
Uses a **5-signal consensus regime detector** to recommend a DEFAULT strategy for
the current year — but shows all 5 alternatives so you can override the default
with your own judgment.

## Design (Option D — informed default + alternatives visible)

- Regime detector uses HPI, unemployment change, CPI, real Fed funds, yield curve
- Requires 2+ signals to agree before firing HOT or COLD (anti-single-signal-noise)
- Regime states: `EXTREME HOT` / `HOT` / `normal` / `COLD` / `EXTREME COLD`
- Recommendation mapping (based on strategy design affinity):
  - `HOT` / `EXTREME HOT` → **HC v3** (tops-guard exclusion, protects against overheated markets)
  - `COLD` / `EXTREME COLD` → **HC v1** (raw cap ranking, buy the deep distressed)
  - `normal` → **HC v4** (cap shortlist + momentum, best default performer)

**Why not fully automatic?** With only 2-3 observable years per regime state, we can't
statistically validate the routing rule. Recommendation is offered as a default; all
5 strategies' picks are shown so you can compare.
"""

CONFIG = """# Config
import sys
sys.path.insert(0, '/Users/premputtegowda/reps/reps-tracker/emerging_re')
import duckdb, numpy as np, pandas as pd

WAREHOUSE = '/Users/premputtegowda/reps/reps-tracker/emerging_re/data/warehouse/emerging_re.duckdb'

POP_MIN       = 1_000_000
POP_MAX       = 10_000_000
HHI_MAX       = 0.10
TOP_N         = 5
MAX_PER_STATE = 2
HORIZON_YEARS = 3
LTV           = 0.70
CURRENT_YEAR  = 2025
TARGET_ROE_ANNUAL = 0.15

pd.set_option('display.width', 250); pd.set_option('display.max_rows', 200); pd.set_option('display.max_columns', 30)
"""

DATA_LOAD = """# Load universe + FRED macro + opex + return metrics
con = duckdb.connect(WAREHOUSE, read_only=True)

uni = con.execute(f'''
    SELECT fips, county_name, state_name, pop_latest,
           EXTRACT(YEAR FROM period_end_date)::INT AS year,
           cap_rate_proxy, zori_yoy, mf_cap_rate_change_3yr,
           unemployment_rate, unemployment_rate_yoy_chg,
           rental_vacancy_rate, renter_share,
           hpi_yoy, hpi_trailing_24mo, permits_intensity_ratio,
           any_disqualifier,
           zori_forward_return_36mo, hpi_forward_return_36mo
    FROM main_marts.mart_county_features
    WHERE EXTRACT(MONTH FROM period_end_date) = 12
      AND pop_latest > {POP_MIN} AND pop_latest <= {POP_MAX}
      AND employment_diversity_hhi IS NOT NULL AND employment_diversity_hhi <= {HHI_MAX}
''').df()

mortgage = con.execute('''
    SELECT EXTRACT(YEAR FROM observation_date)::INT AS year, value/100.0 AS mortgage_rate
    FROM main_staging.stg_fred_macro WHERE series_id='MORTGAGE30US'
    QUALIFY row_number() OVER (PARTITION BY EXTRACT(YEAR FROM observation_date) ORDER BY observation_date DESC)=1
''').df()

pep_raw = con.execute('''
    SELECT fips, EXTRACT(YEAR FROM period_end_date)::INT AS ref_year, popestimate, as_of_date
    FROM main_staging.stg_census_pep
''').df()
pep_raw['as_of_date'] = pd.to_datetime(pep_raw['as_of_date'])

# National HPI (for regime detector — long history back to 1976)
hpi_nat = con.execute('''
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

# FRED annual snapshots (for regime detector)
fred = con.execute('''
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
con.close()

uni = uni.merge(mortgage, on='year', how='left')

# ── State-based opex ratios ──
OPEX_BY_STATE = {
    'Ohio':0.57,'Michigan':0.57,'Pennsylvania':0.57,'Illinois':0.57,'Wisconsin':0.57,'New York':0.57,'New Jersey':0.57,'Connecticut':0.57,
    'Missouri':0.52,'Massachusetts':0.52,'Maryland':0.52,'Rhode Island':0.52,'New Hampshire':0.52,'Vermont':0.52,'Maine':0.52,'District of Columbia':0.52,'Hawaii':0.52,
    'California':0.47,'Iowa':0.47,'Minnesota':0.47,'Alaska':0.47,'Florida':0.47,'Indiana':0.47,
    'Texas':0.44,
    'Virginia':0.44,'Colorado':0.44,'Oregon':0.44,'Washington':0.44,'Kansas':0.44,'Nebraska':0.44,'North Dakota':0.44,'West Virginia':0.44,'Delaware':0.44,'Kentucky':0.44,'Louisiana':0.44,
    'Georgia':0.42,'North Carolina':0.42,'South Carolina':0.42,'Tennessee':0.42,'Oklahoma':0.42,'Utah':0.42,'Idaho':0.42,'Montana':0.42,'New Mexico':0.42,
    'Arizona':0.40,'Nevada':0.40,'Alabama':0.40,'Mississippi':0.40,'South Dakota':0.40,'Wyoming':0.40,'Arkansas':0.40,
}
COASTAL_FL_FIPS = {'12086','12011','12099','12071','12021','12081','12103'}
COASTAL_FL_OPEX = 0.50

def _opex_for(row):
    if row['fips'] in COASTAL_FL_FIPS: return COASTAL_FL_OPEX
    return OPEX_BY_STATE.get(row['state_name'], 0.45)
uni['opex_ratio'] = uni.apply(_opex_for, axis=1)

# Return metrics (net of opex)
uni['cash_flow_3yr']    = 3 * uni['cap_rate_proxy'] * (1 - uni['opex_ratio']) * (1 + uni['zori_forward_return_36mo'] / 2)
uni['appreciation_3yr'] = uni['hpi_forward_return_36mo']
uni['total_return_3yr'] = uni['cash_flow_3yr'] + uni['appreciation_3yr']
uni['debt_service_3yr'] = 3 * LTV * uni['mortgage_rate']
uni['levered_ROE_3yr']  = (uni['cash_flow_3yr'] - uni['debt_service_3yr'] + uni['appreciation_3yr']) / (1 - LTV)

def pit_pop_yoy(cohort_year):
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
        rows.append({'fips': f, 'pop_yoy_pct': (latest['popestimate']-prev['popestimate'])/prev['popestimate']*100})
    return pd.DataFrame(rows)

pop_yoy_cache = {yr: pit_pop_yoy(yr) for yr in range(2015, 2026)}

print(f'Universe loaded: {len(uni)} county-years, {uni.year.nunique()} years ({uni.year.min()}-{uni.year.max()})')
print(f'National HPI history: {hpi_nat.year.min()}-{hpi_nat.year.max()} ({len(hpi_nat)} years — long enough for stable z-scores)')
"""

REGIME_DETECTOR = """# Multi-signal consensus regime detector (BOTH BUGS FIXED)
# 5 signals, expanding-window z-scores (PIT-strict, no look-ahead)
# Requires 2+ signals in same direction to fire HOT or COLD
regime_df = hpi_nat.merge(fred, on='year', how='inner').sort_values('year').reset_index(drop=True)

regime_df['cpi_yoy']         = regime_df['cpi_lvl'].pct_change() * 100
regime_df['unemp_yoy_chg']   = regime_df['unemp'].diff()
regime_df['real_fed_funds']  = regime_df['fed_funds'] - regime_df['cpi_yoy']
regime_df['curve_inverted']  = (regime_df['yield_curve'] < 0).astype(int)

def expanding_z(series, min_periods=10):
    out = pd.Series(index=series.index, dtype=float)
    for i in range(len(series)):
        w = series.iloc[:i].dropna()
        if len(w) < min_periods: out.iloc[i] = np.nan
        else:
            mu, sig = w.mean(), w.std()
            out.iloc[i] = (series.iloc[i] - mu) / sig if sig > 0 else 0.0
    return out

regime_df['z_hpi']       = expanding_z(regime_df['hpi_yoy'])
regime_df['z_unemp_chg'] = expanding_z(regime_df['unemp_yoy_chg'])
regime_df['z_cpi']       = expanding_z(regime_df['cpi_yoy'])
regime_df['z_real_ff']   = expanding_z(regime_df['real_fed_funds'])

def vote(row):
    votes_hot, votes_cold = 0, 0
    reasons = []
    if pd.notna(row['z_hpi']):
        if row['z_hpi'] > 1.5: votes_hot += 1; reasons.append(f'HPI+={row["z_hpi"]:+.1f}')
        elif row['z_hpi'] < -1.5: votes_cold += 1; reasons.append(f'HPI-={row["z_hpi"]:+.1f}')
    if pd.notna(row['z_unemp_chg']):
        # CORRECTED: rising unemp = COLD (recession stress), not HOT
        if row['z_unemp_chg'] > 1.5: votes_cold += 1; reasons.append(f'Unemp+={row["z_unemp_chg"]:+.1f}')
        elif row['z_unemp_chg'] < -1.5: votes_hot += 1; reasons.append(f'Unemp-={row["z_unemp_chg"]:+.1f}')
    if pd.notna(row['z_cpi']):
        if row['z_cpi'] > 1.5: votes_hot += 1; reasons.append(f'CPI+={row["z_cpi"]:+.1f}')
        # NEW: deflation = COLD signal
        elif row['z_cpi'] < -1.5: votes_cold += 1; reasons.append(f'CPI-={row["z_cpi"]:+.1f}')
    if pd.notna(row['z_real_ff']):
        if row['z_real_ff'] > 1.5: votes_hot += 1; reasons.append(f'RealFF+={row["z_real_ff"]:+.1f}')
        elif row['z_real_ff'] < -1.5: votes_cold += 1; reasons.append(f'RealFF-={row["z_real_ff"]:+.1f}')
    if row['curve_inverted'] == 1: votes_hot += 1; reasons.append('curve_inv')
    return pd.Series({'votes_hot': votes_hot, 'votes_cold': votes_cold, 'reasons': ' | '.join(reasons)})

votes = regime_df.apply(vote, axis=1)
regime_df = pd.concat([regime_df, votes], axis=1)

def classify(row):
    h, c = row['votes_hot'], row['votes_cold']
    if h >= 3: return 'EXTREME HOT'
    if h >= 2: return 'HOT'
    if c >= 3: return 'EXTREME COLD'
    if c >= 2: return 'COLD'
    return 'normal'
regime_df['regime'] = regime_df.apply(classify, axis=1)

print('Regime detector armed with corrected 5-signal consensus voting.')
"""

REGIME_TIMELINE = """# Regime timeline — 1990 to current
show = regime_df[regime_df['year'] >= 1990][['year','regime','votes_hot','votes_cold','reasons','hpi_yoy']].copy()
show['hpi_yoy'] = show['hpi_yoy'] * 100
show = show.rename(columns={'hpi_yoy': 'HPI_yoy_%'})

def _color_regime(v):
    if v == 'EXTREME HOT':  return 'background-color: #f8d7da; font-weight: bold'  # deep red
    if v == 'HOT':          return 'background-color: #ffe8b3'                     # amber
    if v == 'COLD':         return 'background-color: #cce5ff'                     # blue
    if v == 'EXTREME COLD': return 'background-color: #b3d9ff; font-weight: bold'  # deep blue
    return ''
show.style.map(_color_regime, subset=['regime']).format({'HPI_yoy_%': '{:+.2f}%'}).set_caption('Regime timeline 1990-2025')
"""

STRATEGIES = """# All 5 strategy implementations
def hc_v1_picks(year):
    c = uni[uni['year']==year].dropna(subset=['cap_rate_proxy']).sort_values('cap_rate_proxy', ascending=False)
    picked, sc = [], {}
    for _, r in c.iterrows():
        if sc.get(r['state_name'], 0) >= MAX_PER_STATE: continue
        picked.append(r); sc[r['state_name']] = sc.get(r['state_name'], 0) + 1
        if len(picked) >= TOP_N: break
    return pd.DataFrame(picked) if picked else pd.DataFrame()

def hc_v2_picks(year):
    GATES = {'min_pop_yoy_pct':0.0,'max_unemp_pct':6.5,'max_vacancy_frac':0.12,'min_renter_share_frac':0.20,'require_no_disq':True}
    c = uni[uni['year']==year].dropna(subset=['cap_rate_proxy']).copy()
    pop_yr = pop_yoy_cache.get(year, pd.DataFrame())
    if not pop_yr.empty: c = c.merge(pop_yr[['fips','pop_yoy_pct']], on='fips', how='left')
    else: c['pop_yoy_pct'] = np.nan
    c = c[c['pop_yoy_pct'].isna() | (c['pop_yoy_pct'] >= GATES['min_pop_yoy_pct'])]
    c = c[c['unemployment_rate'].isna() | (c['unemployment_rate'] <= GATES['max_unemp_pct'])]
    c = c[c['rental_vacancy_rate'].isna() | (c['rental_vacancy_rate'] <= GATES['max_vacancy_frac'])]
    c = c[c['renter_share'].isna() | (c['renter_share'] >= GATES['min_renter_share_frac'])]
    c = c[(c['any_disqualifier']==False) | (c['any_disqualifier'].isna())]
    if c.empty: return pd.DataFrame()
    c = c.sort_values(['cap_rate_proxy','mf_cap_rate_change_3yr'], ascending=[False, True])
    picked, sc = [], {}
    for _, r in c.iterrows():
        if sc.get(r['state_name'], 0) >= MAX_PER_STATE: continue
        picked.append(r); sc[r['state_name']] = sc.get(r['state_name'], 0) + 1
        if len(picked) >= TOP_N: break
    return pd.DataFrame(picked) if picked else pd.DataFrame()

def hc_v3_picks(year):
    GATES = {'max_hpi_24mo':0.30,'max_permit_ratio':1.5,'max_unemp_yoy':1.0,'require_no_disq':True}
    c = uni[uni['year']==year].dropna(subset=['cap_rate_proxy']).copy()
    c = c[c['hpi_trailing_24mo'].isna() | (c['hpi_trailing_24mo'] < GATES['max_hpi_24mo'])]
    c = c[c['permits_intensity_ratio'].isna() | (c['permits_intensity_ratio'] < GATES['max_permit_ratio'])]
    c = c[c['unemployment_rate_yoy_chg'].isna() | (c['unemployment_rate_yoy_chg'] < GATES['max_unemp_yoy'])]
    c = c[(c['any_disqualifier']==False) | (c['any_disqualifier'].isna())]
    if c.empty: return pd.DataFrame()
    c = c.sort_values('cap_rate_proxy', ascending=False)
    picked, sc = [], {}
    for _, r in c.iterrows():
        if sc.get(r['state_name'], 0) >= MAX_PER_STATE: continue
        picked.append(r); sc[r['state_name']] = sc.get(r['state_name'], 0) + 1
        if len(picked) >= TOP_N: break
    return pd.DataFrame(picked) if picked else pd.DataFrame()

def hc_v4_picks(year, shortlist_mult=3):
    c = uni[uni['year']==year].dropna(subset=['cap_rate_proxy']).copy()
    K = TOP_N * shortlist_mult
    shortlist = c.nlargest(K, 'cap_rate_proxy').copy()
    shortlist = shortlist.sort_values('zori_yoy', ascending=False, na_position='last')
    picked, sc = [], {}
    for _, r in shortlist.iterrows():
        if sc.get(r['state_name'], 0) >= MAX_PER_STATE: continue
        picked.append(r); sc[r['state_name']] = sc.get(r['state_name'], 0) + 1
        if len(picked) >= TOP_N: break
    return pd.DataFrame(picked) if picked else pd.DataFrame()

# ELITE — walk-forward using backtest.analog_search
print('Running ELITE walk-forward (takes ~30s)...')
from backtest.analog_search import (
    load_tertiary_panel, load_mf_context, build_acs_target,
    build_feature_matrix, zscore_within_cohort, walk_forward,
    TARGET_COL_TOTAL_RETURN,
)
_panel = load_tertiary_panel(pop_min=POP_MIN, pop_max=POP_MAX, hhi_max=HHI_MAX)
_panel = _panel.merge(build_acs_target(horizon_years=HORIZON_YEARS), on=['fips','period_end_date'], how='left')
_panel = _panel.merge(load_mf_context(), on='fips', how='left')
_panel_fe, _feat = build_feature_matrix(_panel)
_panel_z = zscore_within_cohort(_panel_fe, _feat)
elite_results = walk_forward(
    _panel_z, _panel_fe, _feat,
    target_col=TARGET_COL_TOTAL_RETURN,
    top_n=TOP_N, max_per_state=MAX_PER_STATE, elite_top_pct=0.25,
    strict_pit_targets=True,
)

def elite_picks(year):
    for r in elite_results:
        if r.test_year == year:
            base = r.top5.head(TOP_N)[['fips','county_name','state_name']].copy()
            return base.merge(uni[uni['year']==year].drop(columns=['county_name','state_name'], errors='ignore'),
                              on='fips', how='left')
    return pd.DataFrame()
"""

RECOMMENDATION = """# Regime → strategy recommendation mapping
STRATEGY_FOR_REGIME = {
    'EXTREME HOT': ('HC v3', hc_v3_picks, 'Tops-guard filter excludes overheated markets'),
    'HOT':         ('HC v3', hc_v3_picks, 'Tops-guard filter excludes overheated markets'),
    'normal':      ('HC v4', hc_v4_picks, 'Cap shortlist + rent momentum — best in stable regimes'),
    'COLD':        ('HC v1', hc_v1_picks, 'Buy deep-yield distressed — highest cap rate wins'),
    'EXTREME COLD':('HC v1', hc_v1_picks, 'Buy deep-yield distressed — highest cap rate wins'),
}

def recommend_strategy(regime_state):
    return STRATEGY_FOR_REGIME.get(regime_state, ('HC v4', hc_v4_picks, 'default fallback'))

# All strategies dict
ALL_STRATEGIES = {
    'HC v1': hc_v1_picks,
    'HC v2': hc_v2_picks,
    'HC v3': hc_v3_picks,
    'HC v4': hc_v4_picks,
    'ELITE': elite_picks,
}
"""

CURRENT_VIEW = """# Current year view: regime → recommendation → all 5 strategies' picks
current_row = regime_df[regime_df['year'] == CURRENT_YEAR]
if current_row.empty:
    print(f'No regime data for {CURRENT_YEAR}')
else:
    r = current_row.iloc[0]
    regime = r['regime']
    signals = r['reasons']
    votes_h, votes_c = r['votes_hot'], r['votes_cold']

    print('=' * 100)
    print(f'  {CURRENT_YEAR} CURRENT REGIME: {regime}   (H={votes_h}  C={votes_c})')
    print(f'  Signals: {signals if signals else \"none fired — all normal\"}')
    print('=' * 100)

    strat_name, strat_fn, rationale = recommend_strategy(regime)
    print(f'  RECOMMENDED DEFAULT: {strat_name}')
    print(f'  Rationale: {rationale}')
    print('=' * 100)
    print(f'  All 5 strategies\\' {CURRENT_YEAR} picks shown below.  Recommended strategy highlighted.')
    print()

def _enrich(picks, year):
    if picks.empty: return picks
    return picks[['fips','county_name','state_name','cap_rate_proxy','opex_ratio','zori_yoy','mortgage_rate']].copy()

# Build one big DataFrame with all 5 strategies' picks for current year
rows = []
for sname, sfn in ALL_STRATEGIES.items():
    picks = sfn(CURRENT_YEAR)
    if picks.empty: continue
    for i, (_, pk) in enumerate(picks.iterrows()):
        cap = pk['cap_rate_proxy']; opex = pk['opex_ratio']; mtg = pk['mortgage_rate']
        noi_yld = cap * (1 - opex)
        debt_yld = LTV * mtg
        dscr = noi_yld / debt_yld
        # NOI growth needed for breakeven
        def find_g(target_roe_3yr=0.0):
            lo, hi = -0.3, 0.4
            def f(g):
                if abs(g) < 1e-9: noi_sum = noi_yld * 3
                else: noi_sum = noi_yld * ((1+g)*((1+g)**3 - 1) / g)
                cf = noi_sum - 3 * LTV * mtg
                cap_gain = (1+g)**3 - 1
                return (cf + cap_gain) / (1 - LTV) - target_roe_3yr
            if f(lo) > 0: return float('-inf')
            if f(hi) < 0: return float('inf')
            for _ in range(50):
                mid = (lo+hi)/2
                if f(mid) < 0: lo = mid
                else: hi = mid
            return (lo+hi)/2
        g_be = find_g(0.0)
        g_tgt = find_g((1+TARGET_ROE_ANNUAL)**3 - 1)
        zy = pk['zori_yoy'] if pd.notna(pk['zori_yoy']) else 0.0
        # Projected ROE at trailing momentum
        try:
            if abs(zy) < 1e-9: noi_sum = noi_yld * 3
            else: noi_sum = noi_yld * ((1+zy)*((1+zy)**3 - 1) / zy)
            proj_roe_3yr = (noi_sum - 3 * LTV * mtg + (1+zy)**3 - 1) / (1 - LTV)
            proj_roe_ann = (1 + proj_roe_3yr) ** (1/3) - 1 if 1 + proj_roe_3yr > 0 else float('nan')
        except: proj_roe_ann = float('nan')

        rows.append({
            'strategy':   sname,
            '#':          i+1,
            'market':     f\"{pk['county_name'].replace(' County','')}, {pk['state_name'][:2]}\",
            'cap%':       cap * 100,
            'opex%':      opex * 100,
            'noi_yld%':   noi_yld * 100,
            'DSCR':       dscr,
            'zori_yoy%':  zy * 100,
            'NOI_grow_BE%/yr':      g_be * 100 if pd.notna(g_be) and not np.isinf(g_be) else np.nan,
            'NOI_grow_TGT_15%%/yr': g_tgt * 100 if pd.notna(g_tgt) and not np.isinf(g_tgt) else np.nan,
            'Proj_ROE_@zori%/yr':   proj_roe_ann * 100 if pd.notna(proj_roe_ann) else np.nan,
        })

df_current = pd.DataFrame(rows)
recommended_strategy = strat_name

def _color_recommended(row):
    if row['strategy'] == recommended_strategy:
        return ['background-color: #d4edda; font-weight: bold'] * len(row)
    return [''] * len(row)

styled = (df_current.style
    .format({
        'cap%': '{:.2f}', 'opex%': '{:.0f}', 'noi_yld%': '{:.2f}',
        'DSCR': '{:.2f}×', 'zori_yoy%': '{:+.2f}',
        'NOI_grow_BE%/yr': '{:+.2f}',
        'NOI_grow_TGT_15%%/yr': '{:+.2f}',
        'Proj_ROE_@zori%/yr': '{:+.2f}',
    }, na_rep='—')
    .apply(_color_recommended, axis=1)
    .set_caption(f'{CURRENT_YEAR} picks — all 5 strategies, recommended ({recommended_strategy}) highlighted green'))
styled
"""

HISTORICAL_BACKTEST = """# Historical backtest — regime-conditional routing vs static HC v4
# Metric: 3yr total return (net of opex), observable cohorts 2015-2022

def get_regime(year):
    row = regime_df[regime_df['year'] == year]
    return row.iloc[0]['regime'] if not row.empty else 'normal'

def avg_return(picks, year, metric='total_return_3yr'):
    if picks.empty: return np.nan
    yr_uni = uni[uni['year'] == year]
    merged = picks[['fips']].merge(yr_uni[['fips', metric]], on='fips', how='left')
    return merged[metric].mean() * 100 if merged[metric].notna().any() else np.nan

rows = []
for yr in range(2015, 2023):
    regime = get_regime(yr)
    strat_name, strat_fn, _ = recommend_strategy(regime)
    regime_cond_picks = strat_fn(yr)
    static_v4_picks = hc_v4_picks(yr)
    yr_uni = uni[uni['year'] == yr].dropna(subset=['total_return_3yr'])
    rows.append({
        'year': yr,
        'regime': regime,
        'recommended': strat_name,
        'regime_cond_TR%': avg_return(regime_cond_picks, yr),
        'static_v4_TR%':   avg_return(static_v4_picks, yr),
        'universe_TR%':    yr_uni['total_return_3yr'].mean() * 100 if not yr_uni.empty else np.nan,
    })

bt = pd.DataFrame(rows)
bt['delta_pp'] = bt['regime_cond_TR%'] - bt['static_v4_TR%']

def _color_regime_col(v):
    if v in ('EXTREME HOT', 'HOT'): return 'background-color: #ffe8b3'
    if v in ('EXTREME COLD', 'COLD'): return 'background-color: #cce5ff'
    return ''

def _color_delta(v):
    if pd.isna(v): return ''
    return 'color: #006600; font-weight: bold' if v > 0 else 'color: #b30000'

print('Historical backtest: regime-conditional routing vs static HC v4  (2015-2022 observable)')
print('=' * 100)
bt_styled = (bt.style
    .format({'regime_cond_TR%': '{:+.2f}%', 'static_v4_TR%': '{:+.2f}%',
             'universe_TR%': '{:+.2f}%', 'delta_pp': '{:+.2f}pp'}, na_rep='—')
    .map(_color_regime_col, subset=['regime'])
    .map(_color_delta, subset=['delta_pp'])
    .set_caption('Regime-conditional routing vs static HC v4'))

# Aggregate stats
obs = bt.dropna(subset=['regime_cond_TR%','static_v4_TR%'])
if not obs.empty:
    regime_avg = obs['regime_cond_TR%'].mean()
    static_avg = obs['static_v4_TR%'].mean()
    wins = (obs['delta_pp'] > 0).sum()
    print(f'\\nAggregate over {len(obs)} observable cohorts:')
    print(f'  Regime-conditional avg TR: {regime_avg:+.2f}%')
    print(f'  Static HC v4 avg TR:       {static_avg:+.2f}%')
    print(f'  Delta:                     {regime_avg - static_avg:+.2f}pp')
    print(f'  Regime routing beats v4 in {wins}/{len(obs)} years')
    print()
    if regime_avg > static_avg + 1:
        print('  → Regime routing SHOWS PROMISE. But note: only 2-3 non-normal years observable.')
    elif regime_avg > static_avg:
        print('  → Regime routing marginally better. Signal is thin.')
    else:
        print('  → Regime routing does not beat static HC v4 in this window. Trust HC v4 as default.')

bt_styled
"""

# ══════════════════════════════════════════════════════════════════════════════
# GENERATE
# ══════════════════════════════════════════════════════════════════════════════

cells = [
    md(TITLE),
    md("## 1. Config"),
    code(CONFIG),
    md("## 2. Load data (universe + FRED + opex + return metrics)"),
    code(DATA_LOAD),
    md("## 3. Regime detector (5-signal consensus voting — both bug fixes applied)"),
    code(REGIME_DETECTOR),
    md("## 4. Regime timeline"),
    code(REGIME_TIMELINE),
    md("## 5. Strategy implementations"),
    code(STRATEGIES),
    md("## 6. Regime → strategy recommendation mapping"),
    code(RECOMMENDATION),
    md(f"## 7. Current year view — regime + recommendation + all 5 strategies"),
    code(CURRENT_VIEW),
    md("## 8. Historical backtest — does regime routing beat static HC v4?"),
    code(HISTORICAL_BACKTEST),
]

nb = wrap(cells)
out = NB_DIR / 'strategy_comparison.ipynb'
out.write_text(json.dumps(nb, indent=1))
print(f'Wrote {out.relative_to(NB_DIR.parent)}   ({len(cells)} cells)')
