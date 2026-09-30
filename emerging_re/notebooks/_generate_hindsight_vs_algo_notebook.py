"""Generate strategy_hindsight_vs_algo.ipynb.

For each vintage year 2015-2025, shows side-by-side:
  - HINDSIGHT top-N (oracle: best realized 3yr total return)
  - ALGORITHM top-N (EMERGING-VALUE opportunity score)
Plus overlap, alpha, hit rate, and an aggregate summary.

Post-2022 cohorts show algo picks only (forward returns not yet observable).

Run with: .venv/bin/python notebooks/_generate_hindsight_vs_algo_notebook.py
"""
from __future__ import annotations
import json, sys
from pathlib import Path

NB_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(NB_DIR))
from _generate_strategy_notebooks import (
    CONFIG_CELL, DATA_LOAD_CELL, STRATEGIES, md, code, wrap
)

EV = STRATEGIES['emerging_value']

# ══════════════════════════════════════════════════════════════════════════════
# CONFIGURABLE CONFIG CELL — all knobs live here
# ══════════════════════════════════════════════════════════════════════════════
CONFIGURABLE_CONFIG_CELL = """# ══════════════════════════════════════════════════════════════════════════
#  TUNABLE KNOBS — edit any value and re-run the cells below to change picks
# ══════════════════════════════════════════════════════════════════════════
import duckdb, numpy as np, pandas as pd

WAREHOUSE = '/Users/premputtegowda/reps/reps-tracker/emerging_re/data/warehouse/emerging_re.duckdb'

# ── Universe filter (data-load stage) ─────────────────────────────────────
POP_MIN              = 300_000     # min county population
POP_MAX              = 1_000_000   # max county population
HHI_MAX              = 0.20        # employment diversity ceiling for universe (looser than strategy gate)

# ── Strategy gates (drop counties that fail any of these) ─────────────────
MIN_POP_YOY_PCT      = 0.0         # required min pop growth (0 = flat OK, no shrinking)
MAX_PERMIT_RATIO     = 1.5         # max permits vs 10yr baseline (>1.5 = supply wave)
MAX_UNEMP_PCT        = 6.0         # max unemployment rate
MIN_WAGE_GROWTH      = 0.02        # min annual wage growth (2%)
MAX_SECTOR_SHARE     = 0.25        # max single-sector share (25%)
MIN_CAP_SPREAD_PP    = 0.0         # min cap spread vs gateway (0 = at or above)
MAX_HHI_STRATEGY     = 0.15        # strategy-level HHI ceiling (tighter than HHI_MAX)
REQUIRE_NO_DISQ      = True        # False = ignore any_disqualifier flag
APPLY_YIELD_FLOOR    = True        # False = don't drop below-median-cap counties

# ── Selection ──────────────────────────────────────────────────────────────
TOP_N                = 10          # number of picks to return
MAX_PER_STATE        = 3           # max picks per state.  0 = NO CAP (unlimited).

# ── Opportunity score weights (edit to change ranking) ────────────────────
OPPORTUNITY_WEIGHTS = {
    'cap_spread_to_gateway_pp':          1.5,
    'cap_rate_proxy':                    1.5,
    'wage_growth_yoy':                   0.8,
    'pop_yoy_pct':                       0.5,
    'business_apps_per_1000':            0.5,
    'permits_per_new_job':              -1.0,   # INVERTED (supply-wave penalty)
    'recession_resilience_score':        0.5,
    'knowledge_emp_growth_vs_state_pp':  0.5,
    'rent_growth_vs_wage_growth':        0.7,
}

# ── Analysis constants (rarely change) ────────────────────────────────────
LTV                  = 0.70        # loan-to-value for levered ROE calcs
HORIZON_YEARS        = 3
STRATEGY_NAME        = 'EMERGING-VALUE'

pd.set_option('display.width', 250); pd.set_option('display.max_rows', 200)
print(f'Config loaded.')
print(f'  Universe: pop {POP_MIN:,}-{POP_MAX:,}  HHI<={HHI_MAX}')
print(f'  Selection: top-{TOP_N}   state-cap: {\"NO CAP\" if MAX_PER_STATE == 0 else f\"max {MAX_PER_STATE}/state\"}')
"""

# ══════════════════════════════════════════════════════════════════════════════
# EMPLOYER CONCENTRATION SIGNAL — new annotation, not a gate
# ══════════════════════════════════════════════════════════════════════════════
EMP_CONCENTRATION_CELL = '''# Load employer concentration signal (informational annotation, not a gate)
# max_size_ratio = max across supersectors of (county avg estab size / national avg estab size)
# Higher = more employer-concentrated. Excludes sector '99' (unclassified).
_con_conc = duckdb.connect(WAREHOUSE, read_only=True)
emp_conc = _con_conc.execute("""
    WITH dedup AS (
        SELECT fips, period_end_date, industry_code, annual_avg_emplvl, annual_avg_estabs
        FROM main_staging.stg_bls_qcew
        WHERE agglvl_code = 74 AND own_code = 5 AND industry_code NOT IN ('10', '99')
        QUALIFY row_number() OVER (PARTITION BY fips, period_end_date, industry_code ORDER BY as_of_date DESC) = 1
    ),
    county_sector AS (
        SELECT fips, EXTRACT(YEAR FROM period_end_date)::INT AS year, industry_code AS sector,
               SUM(annual_avg_emplvl)::DOUBLE AS emp, SUM(annual_avg_estabs)::DOUBLE AS estabs
        FROM dedup GROUP BY fips, EXTRACT(YEAR FROM period_end_date), industry_code
    ),
    natl AS (
        SELECT year, sector, SUM(emp) / NULLIF(SUM(estabs), 0) AS natl_avg_size
        FROM county_sector GROUP BY year, sector
    ),
    ratios AS (
        SELECT cs.fips, cs.year, cs.sector,
               (cs.emp / NULLIF(cs.estabs, 0)) / NULLIF(n.natl_avg_size, 0) AS size_ratio
        FROM county_sector cs JOIN natl n USING (year, sector)
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
_con_conc.close()
uni = uni.merge(emp_conc, on=['fips','year'], how='left')
print(f'Loaded employer concentration for {len(emp_conc):,} county-years')
'''

# ══════════════════════════════════════════════════════════════════════════════
# CONFIGURABLE METHOD CODE — uses knobs from CONFIGURABLE_CONFIG_CELL
# ══════════════════════════════════════════════════════════════════════════════
CONFIGURABLE_METHOD_CODE = '''# EMERGING-VALUE picker — reads knobs from the config cell above
def pick_for_year(year, weights=None, gates=None):
    """Apply gates + opportunity score. Reads globals: OPPORTUNITY_WEIGHTS, MAX_PER_STATE, TOP_N, etc.
    Any knob overridable via kwargs for one-off experiments."""
    if weights is None:
        weights = OPPORTUNITY_WEIGHTS
    if gates is None:
        gates = {
            'min_pop_yoy_pct':      MIN_POP_YOY_PCT,
            'max_permit_ratio':     MAX_PERMIT_RATIO,
            'max_unemp_pct':        MAX_UNEMP_PCT,
            'min_wage_growth':      MIN_WAGE_GROWTH,
            'max_sector_share':     MAX_SECTOR_SHARE,
            'min_cap_spread_pp':    MIN_CAP_SPREAD_PP,
            'max_hhi_strategy':     MAX_HHI_STRATEGY,
            'require_no_disq':      REQUIRE_NO_DISQ,
            'apply_yield_floor':    APPLY_YIELD_FLOOR,
        }

    c = uni[uni['year'] == year].dropna(subset=['cap_rate_proxy']).copy()
    if c.empty: return pd.DataFrame()

    pop_yr = pop_yoy_cache.get(year, pd.DataFrame())
    if not pop_yr.empty:
        c = c.merge(pop_yr[['fips','pop_yoy_pct']], on='fips', how='left')
    else:
        c['pop_yoy_pct'] = np.nan

    n_before = len(c)

    # ── Hard gates (NaN-permissive) ──
    c = c[c['pop_yoy_pct'].isna()             | (c['pop_yoy_pct']             >= gates['min_pop_yoy_pct'])]
    c = c[c['permits_intensity_ratio'].isna() | (c['permits_intensity_ratio'] <  gates['max_permit_ratio'])]
    c = c[c['unemployment_rate'].isna()       | (c['unemployment_rate']       <= gates['max_unemp_pct'])]
    c = c[c['wage_growth_yoy'].isna()         | (c['wage_growth_yoy']         >= gates['min_wage_growth'])]
    c = c[c['max_supersector_share'].isna()   | (c['max_supersector_share']   <= gates['max_sector_share'])]
    c = c[c['cap_spread_to_gateway_pp'].isna()| (c['cap_spread_to_gateway_pp']>= gates['min_cap_spread_pp'])]
    c = c[c['employment_diversity_hhi'].isna()| (c['employment_diversity_hhi']<= gates['max_hhi_strategy'])]
    if gates['require_no_disq']:
        c = c[(c['any_disqualifier'] == False) | (c['any_disqualifier'].isna())]

    # ── Yield floor (cap ≥ pool median) ──
    if gates.get('apply_yield_floor', True) and len(c) > 0:
        cap_median = c['cap_rate_proxy'].median()
        c = c[c['cap_rate_proxy'] >= cap_median]

    n_after = len(c)
    print(f'  {year}: {n_before} → {n_after} candidates after gates ({n_after/max(1,n_before)*100:.0f}% pass)')

    if c.empty: return pd.DataFrame()

    # ── Opportunity score (weighted z-score within qualified pool) ──
    c = c.copy()
    if 'business_apps_per_1000' in c.columns:
        c['business_apps_per_1000'] = c['business_apps_per_1000'].clip(upper=40)
    c['opportunity_score'] = 0.0
    for col, w in weights.items():
        if col in c.columns and c[col].notna().any():
            mu, sig = c[col].mean(), c[col].std()
            if sig > 0:
                z = (c[col] - mu) / sig
                c['opportunity_score'] = c['opportunity_score'] + w * z.fillna(0)
    c = c.sort_values('opportunity_score', ascending=False)

    # ── State cap + top-N. MAX_PER_STATE = 0 means NO CAP. ──
    picked, sc = [], {}
    for _, r in c.iterrows():
        if MAX_PER_STATE > 0 and sc.get(r['state_name'], 0) >= MAX_PER_STATE:
            continue
        picked.append(r); sc[r['state_name']] = sc.get(r['state_name'], 0) + 1
        if len(picked) >= TOP_N:
            break
    return pd.DataFrame(picked) if picked else pd.DataFrame()

# Sanity check current-year picks
sample = pick_for_year(2025)
if not sample.empty:
    print(f'\\n{STRATEGY_NAME} picks for 2025 (top-{TOP_N}, state cap: {"none" if MAX_PER_STATE == 0 else MAX_PER_STATE}):')
    cols = ['county_name','state_name','pop_latest','cap_rate_proxy','cap_spread_to_gateway_pp',
            'wage_growth_yoy','recession_resilience_score','opportunity_score']
    print(sample[[c for c in cols if c in sample.columns]].to_string(index=False))
'''

TITLE = """# EMERGING-VALUE — Hindsight vs Algorithm (year-by-year)

For each cohort year, two lists side by side:

1. **HINDSIGHT top-N** — the top counties in the *qualified* universe sorted by realized 3yr total return (perfect foresight — what an oracle would have picked).
2. **ALGORITHM top-N** — what EMERGING-VALUE actually picked ex-ante (opportunity score sorted).

Then per year:
- **Overlap** — how many algorithm picks appear in the hindsight top-N
- **Alpha** — algorithm mean TR minus universe mean TR (percentage points)
- **Hit rate** — % of algorithm picks that beat the universe median TR

**Range:** 2015–2022 for full comparison (3yr forward returns observable). 2023–2025 shown as algorithm-only (forward returns not yet available).

Both lists are drawn from the *same qualified pool* — i.e. after all EMERGING-VALUE hard gates and the yield floor — so the hindsight benchmark reflects what was actually reachable, not the entire universe.
"""

COMPARISON_CELL = """# Year-by-year: hindsight top-N vs algorithm top-N
def _name(row):
    return f\"{row['county_name'].replace(' County','')}, {row['state_name']}\"

years_observable = list(range(2015, 2023))
years_forward    = list(range(2023, 2026))

summary_rows = []

for yr in years_observable:
    algo_picks = pick_for_year(yr)
    if algo_picks is None or algo_picks.empty:
        continue

    # Rebuild qualified pool exactly as pick_for_year does — but keep ALL passing rows
    # so we can sort by realized TR (hindsight) instead of opportunity_score (algo).
    yr_uni = uni[uni['year'] == yr].dropna(subset=['cap_rate_proxy']).copy()
    pop_yr = pop_yoy_cache.get(yr, pd.DataFrame())
    if not pop_yr.empty:
        yr_uni = yr_uni.merge(pop_yr[['fips','pop_yoy_pct']], on='fips', how='left')
    else:
        yr_uni['pop_yoy_pct'] = np.nan

    g = EMERGING_VALUE_GATES
    q = yr_uni.copy()
    q = q[q['pop_yoy_pct'].isna()             | (q['pop_yoy_pct']             >= g['min_pop_yoy_pct'])]
    q = q[q['permits_intensity_ratio'].isna() | (q['permits_intensity_ratio'] <  g['max_permit_ratio'])]
    q = q[q['unemployment_rate'].isna()       | (q['unemployment_rate']       <= g['max_unemp_pct'])]
    q = q[q['wage_growth_yoy'].isna()         | (q['wage_growth_yoy']         >= g['min_wage_growth'])]
    q = q[q['max_supersector_share'].isna()   | (q['max_supersector_share']   <= g['max_sector_share'])]
    q = q[q['cap_spread_to_gateway_pp'].isna()| (q['cap_spread_to_gateway_pp']>= g['min_cap_spread_pp'])]
    q = q[q['employment_diversity_hhi'].isna()| (q['employment_diversity_hhi']<= g['max_hhi_strategy'])]
    if g['require_no_disq']:
        q = q[(q['any_disqualifier'] == False) | (q['any_disqualifier'].isna())]
    if len(q) > 0:
        cap_median = q['cap_rate_proxy'].median()
        q = q[q['cap_rate_proxy'] >= cap_median]
    q = q.dropna(subset=['total_return_3yr'])

    if q.empty:
        print(f'YEAR {yr}: qualified universe empty after gates + forward return filter — skip')
        continue

    hindsight = q.sort_values('total_return_3yr', ascending=False).head(TOP_N)

    u_mean = q['total_return_3yr'].mean() * 100
    u_med  = q['total_return_3yr'].median() * 100
    hs_tr  = hindsight['total_return_3yr'].mean() * 100

    algo_obs = algo_picks.dropna(subset=['total_return_3yr'])
    algo_tr  = algo_obs['total_return_3yr'].mean() * 100 if not algo_obs.empty else float('nan')

    hs_fips = set(hindsight['fips'])
    overlap = len(set(algo_picks['fips']) & hs_fips)
    hit_rate = (algo_picks['total_return_3yr'] > q['total_return_3yr'].median()).sum() / max(1, len(algo_picks)) * 100

    print('\\n' + '=' * 132)
    print(f'YEAR {yr}   qualified_n={len(q)}   univ TR mean {u_mean:+.2f}%   median {u_med:+.2f}%   mortgage {algo_picks[\"mortgage_rate\"].iloc[0]*100:.2f}%')
    print('=' * 132)

    print(f'\\n  HINDSIGHT top-{TOP_N} (sorted by realized 3yr TR):')
    print(f'  {\"rk\":<3} {\"county\":<34} {\"cap\":>7} {\"opex\":>5} {\"cf_net\":>8} {\"apprec\":>8} {\"TOTAL\":>8}')
    print('  ' + '-' * 76)
    for i, r in hindsight.reset_index(drop=True).iterrows():
        print(f'  #{i+1:<2} {_name(r):<34} {r[\"cap_rate_proxy\"]*100:>6.2f}% {r[\"opex_ratio\"]*100:>4.0f}% '
              f'{r[\"cash_flow_3yr\"]*100:>+7.2f}% {r[\"appreciation_3yr\"]*100:>+7.2f}% {r[\"total_return_3yr\"]*100:>+7.2f}%')

    print(f'\\n  ALGORITHM top-{TOP_N} (sorted by opportunity_score):')
    print(f'  {\"rk\":<3} {\"county\":<34} {\"cap\":>7} {\"opex\":>5} {\"cf_net\":>8} {\"apprec\":>8} {\"TOTAL\":>8}  {\"in_hs\":>6}')
    print('  ' + '-' * 84)
    for i, r in algo_picks.reset_index(drop=True).iterrows():
        in_hs = '  Y' if r['fips'] in hs_fips else ''
        tr_str = f'{r[\"total_return_3yr\"]*100:>+7.2f}%' if pd.notna(r.get('total_return_3yr')) else '   n/a  '
        cf_str = f'{r[\"cash_flow_3yr\"]*100:>+7.2f}%'   if pd.notna(r.get('cash_flow_3yr'))   else '   n/a  '
        ap_str = f'{r[\"appreciation_3yr\"]*100:>+7.2f}%' if pd.notna(r.get('appreciation_3yr')) else '   n/a  '
        print(f'  #{i+1:<2} {_name(r):<34} {r[\"cap_rate_proxy\"]*100:>6.2f}% {r[\"opex_ratio\"]*100:>4.0f}% '
              f'{cf_str} {ap_str} {tr_str}  {in_hs:>6}')

    edge = algo_tr - u_mean if not pd.isna(algo_tr) else float('nan')
    print(f'\\n  COMPARISON:')
    print(f'    Hindsight top-{TOP_N} mean TR: {hs_tr:>+7.2f}%')
    print(f'    Algorithm top-{TOP_N} mean TR: {algo_tr:>+7.2f}%')
    print(f'    Universe mean TR:           {u_mean:>+7.2f}%')
    print(f'    Algorithm edge vs univ:     {edge:>+7.2f}pp')
    print(f'    Overlap w/ hindsight top:   {overlap}/{TOP_N}')
    print(f'    % algo picks beat median:   {hit_rate:.0f}%')

    summary_rows.append({
        'year': yr,
        'qual_n': len(q),
        'hindsight_mean_TR': hs_tr,
        'algo_mean_TR': algo_tr,
        'universe_mean_TR': u_mean,
        'edge_pp': edge,
        'overlap': overlap,
        'hit_rate_pct': hit_rate,
    })

# Post-2022 vintages — algo picks only (forward returns not observable)
for yr in years_forward:
    algo_picks = pick_for_year(yr)
    if algo_picks is None or algo_picks.empty:
        continue
    print('\\n' + '=' * 132)
    print(f'YEAR {yr}   ALGORITHM top-{TOP_N} (forward — 3yr return not yet observable)')
    print('=' * 132)
    print(f'  {\"rk\":<3} {\"county\":<34} {\"cap\":>7} {\"opex\":>5} {\"net_yield\":>10} {\"mtg\":>7} {\"net_spread\":>11}')
    print('  ' + '-' * 82)
    for i, r in algo_picks.reset_index(drop=True).iterrows():
        cap = r['cap_rate_proxy'] * 100
        opx = r['opex_ratio'] * 100
        net = cap * (1 - r['opex_ratio'])
        mtg = r['mortgage_rate'] * 100
        print(f'  #{i+1:<2} {_name(r):<34} {cap:>6.2f}% {opx:>4.0f}% {net:>9.2f}% {mtg:>6.2f}% {(net - mtg):>+10.2f}pp')
"""

SINGLE_DEAL_MD = """## 6. Deployment attributes per pick

The algorithm above ranks picks by *investment thesis* (yield, value, resilience).
For a **single-deal decision**, four additional operational attributes matter — but they're
kept as annotations rather than re-ranking factors, so you can weight them yourself:

1. **LL — Landlord-friendliness (0–10)** — eviction speed, rent-control exposure, court process.
   High (10): TX, FL, GA, IN, TN, NC, SC, AL. Low (2): CA, NY, NJ, OR, WA, DC.
2. **INS — Insurance environment (0–10)** — post-2022, coastal FL is near-uninsurable, CA wildfire
   zones are hard-market. Interior Midwest is cheapest (10). Coastal FL FIPS get a 2.
3. **spread** — net_yield minus mortgage rate in percentage points (shown directly, not scored).
   Positive = deal cash-flows before appreciation. Negative = paying to hold, betting on appreciation.
4. **RRS — Recession resilience (0–10)** — the forward-looking 5-factor score already in the algo.

Algorithm rank is preserved. The four columns are shown alongside so you can make the single-deal call yourself.
"""

SINGLE_DEAL_CELL = """# ══════════════════════════════════════════════════════════════════════════
#  Single-deal deployability filter
# ══════════════════════════════════════════════════════════════════════════
# Landlord-friendliness by state (10 = most landlord-friendly)
# Based on eviction timeline, rent control presence, security-deposit caps,
# judicial vs non-judicial process, and general court-culture toward landlords.
LANDLORD_FRIENDLY = {
    # Tier 10 — fast eviction, no rent control, favorable statutes
    'Texas': 10, 'Florida': 10, 'Georgia': 10, 'Alabama': 10, 'Mississippi': 10,
    'Arkansas': 10, 'Tennessee': 10, 'Indiana': 10, 'Kentucky': 10, 'Oklahoma': 10,
    'North Carolina': 10, 'South Carolina': 10, 'Missouri': 10, 'Kansas': 10, 'West Virginia': 10,
    'Wyoming': 10, 'Idaho': 10, 'Utah': 10,
    # Tier 8 — friendly, minor frictions
    'Ohio': 8, 'Pennsylvania': 8, 'Virginia': 8, 'Louisiana': 8, 'New Mexico': 8,
    'Iowa': 8, 'Nebraska': 8, 'North Dakota': 8, 'South Dakota': 8, 'Montana': 8,
    'Wisconsin': 8, 'Michigan': 8, 'Maine': 8, 'New Hampshire': 8, 'Alaska': 8,
    # Tier 6 — neutral to slightly tenant-tilted
    'Nevada': 6, 'Arizona': 6, 'Rhode Island': 6, 'Connecticut': 6, 'Delaware': 6,
    # Tier 4 — meaningfully tenant-friendly
    'Illinois': 4, 'Minnesota': 4, 'Colorado': 4, 'Maryland': 4, 'Massachusetts': 4,
    'Vermont': 4, 'Hawaii': 4,
    # Tier 2 — very tenant-friendly (rent control, long eviction timelines, strong statutes)
    'California': 2, 'Oregon': 2, 'Washington': 2, 'New York': 2, 'New Jersey': 2,
    'District of Columbia': 2,
}

# Insurance environment by state (10 = cheapest / simplest insurance market)
INSURANCE_ENV = {
    # Tier 10 — interior, low disaster exposure
    'Ohio': 10, 'Indiana': 10, 'Pennsylvania': 10, 'Michigan': 10, 'Wisconsin': 10,
    'Illinois': 10, 'Kentucky': 10, 'West Virginia': 10, 'New Hampshire': 10, 'Vermont': 10,
    'Maine': 10, 'Maryland': 10, 'Delaware': 10, 'New Jersey': 10, 'Rhode Island': 10,
    'Connecticut': 10, 'Massachusetts': 10, 'New York': 10, 'Virginia': 10,
    # Tier 8 — some tornado / hail exposure but functional market
    'Missouri': 8, 'Iowa': 8, 'Minnesota': 8, 'North Dakota': 8, 'South Dakota': 8,
    'Nebraska': 8, 'Kansas': 8, 'Wyoming': 8, 'Montana': 8, 'Idaho': 8, 'Utah': 8,
    'New Mexico': 8, 'Arizona': 8, 'Nevada': 8, 'Colorado': 8,
    # Tier 6 — moderate wind/tornado/hail, still insurable at reasonable premium
    'Texas': 6, 'Oklahoma': 6, 'Arkansas': 6, 'Tennessee': 6, 'Alabama': 6,
    'Mississippi': 6, 'Georgia': 6, 'North Carolina': 6, 'South Carolina': 6,
    # Tier 4 — inland Florida, coastal Georgia/Carolina — hurricane exposure but insurable
    'Florida': 4,      # default; coastal FL bumped to 2 below via per-county override
    'Louisiana': 4,
    # Tier 2 — hard market, insurance crisis
    'California': 2, 'Hawaii': 2, 'Alaska': 2,
    'Oregon': 4, 'Washington': 4, 'District of Columbia': 8,
}

# Coastal FL — insurance essentially uninsurable at reasonable premium since 2022
COASTAL_FL_FIPS = {'12086','12011','12099','12071','12021','12081','12103'}
def insurance_score(row):
    if row['fips'] in COASTAL_FL_FIPS: return 2
    return INSURANCE_ENV.get(row['state_name'], 6)

# Net-spread score (0-10 scale, higher = more accretive after debt)
# Positive spread → deal cash-flows before appreciation; negative → betting on appreciation
def net_spread_score(row):
    cap = row['cap_rate_proxy']
    opex = row['opex_ratio']
    mtg = row['mortgage_rate']
    if any(pd.isna(v) for v in [cap, opex, mtg]): return 5
    net_yield = cap * (1 - opex)
    spread_pp = (net_yield - mtg) * 100
    if spread_pp >= 1.5: return 10
    if spread_pp >= 0.5: return 8
    if spread_pp >= 0:   return 6
    if spread_pp >= -1:  return 4
    if spread_pp >= -2:  return 2
    return 0

# RRS is already 0-10 on uni — pass through
def rrs_score(row):
    v = row.get('recession_resilience_score')
    return 5 if pd.isna(v) else float(v)

def annotate_picks(picks_df):
    '''Add LL / INS / RRS columns alongside the algorithm's picks — no re-ranking.'''
    if picks_df is None or picks_df.empty: return pd.DataFrame()
    out = picks_df.reset_index(drop=True).copy()
    out['LL']  = out['state_name'].map(lambda s: LANDLORD_FRIENDLY.get(s, 6))
    out['INS'] = out.apply(insurance_score, axis=1)
    out['RRS'] = out.apply(rrs_score, axis=1)
    return out

def print_picks_with_attrs(year, picks_df):
    if picks_df is None or picks_df.empty: return
    ann = annotate_picks(picks_df)
    print('=' * 130)
    print(f'{year} — ALGORITHM top-{len(ann)} with deployment attributes (rank unchanged)')
    print('=' * 130)
    print(f'  {"rk":<3} {"county":<32} {"cap":>7} {"opex":>5} {"net_yld":>8} {"mtg":>7} {"spread":>10}  '
          f'{"LL":>4} {"INS":>4} {"RRS":>5}')
    print('  ' + '-' * 114)
    for i, r in ann.iterrows():
        cap = r['cap_rate_proxy'] * 100
        opx = r['opex_ratio'] * 100
        net = cap * (1 - r['opex_ratio'])
        mtg = r['mortgage_rate'] * 100
        sp  = net - mtg
        name = f"{r['county_name'].replace(' County','')}, {r['state_name']}"
        print(f'  #{i+1:<2} {name:<32} '
              f'{cap:>6.2f}% {opx:>4.0f}% {net:>7.2f}% {mtg:>6.2f}% {sp:>+9.2f}pp  '
              f'{r["LL"]:>4.0f} {r["INS"]:>4.0f} {r["RRS"]:>5.1f}')
    print()

# ── Current year — algorithm picks annotated with LL / INS / NS / RRS ──
CURRENT_YR_DEPLOY = 2025
print_picks_with_attrs(CURRENT_YR_DEPLOY, pick_for_year(CURRENT_YR_DEPLOY))

# ── Recent forward-looking years — same annotation ──
for yr in [2024, 2023]:
    print_picks_with_attrs(yr, pick_for_year(yr))

print('Column key:')
print('  spread — net_yield − mortgage_rate in percentage points (positive = cash-flows before appreciation)')
print('  LL     — landlord-friendliness (0-10, higher = friendlier state statutes/courts)')
print('  INS    — insurance environment (0-10, higher = cheaper/simpler; coastal FL = 2, CA = 2)')
print('  RRS    — recession resilience score (0-10, forward-looking; yield + bubble + diversification + migration + permit)')
"""

PER_PICK_HINDSIGHT_MD = """## 7. Per-pick hindsight comparison

For each algorithm pick in each observable year (2015–2022), this table shows:

- **hs_rk** — where this market ranked in the *hindsight* order (sorted by realized 3yr TR within the qualified pool)
- **realized_TR** — actual 3yr total return
- **hs_top1_TR** — the best return available in the qualified pool that year
- **gap_pp** — realized_TR minus hs_top1_TR (how much return this pick left on the table vs the oracle)

A pick with `hs_rk=1` means the algorithm found the actual hindsight winner. A pick with `hs_rk=15` in a
pool of 50 means the market was decent but not top decile. `gap_pp` quantifies the cost of not picking the winner.
"""

PER_PICK_HINDSIGHT_CELL = """# Per-pick hindsight comparison — for each algo pick each year, what was its hindsight rank?
all_rows = []
for yr in range(2015, 2023):
    algo = pick_for_year(yr)
    if algo is None or algo.empty: continue

    yr_uni = uni[uni['year'] == yr].dropna(subset=['cap_rate_proxy']).copy()
    pop_yr = pop_yoy_cache.get(yr, pd.DataFrame())
    if not pop_yr.empty:
        yr_uni = yr_uni.merge(pop_yr[['fips','pop_yoy_pct']], on='fips', how='left')
    else:
        yr_uni['pop_yoy_pct'] = np.nan
    g = EMERGING_VALUE_GATES
    q = yr_uni.copy()
    q = q[q['pop_yoy_pct'].isna()             | (q['pop_yoy_pct']             >= g['min_pop_yoy_pct'])]
    q = q[q['permits_intensity_ratio'].isna() | (q['permits_intensity_ratio'] <  g['max_permit_ratio'])]
    q = q[q['unemployment_rate'].isna()       | (q['unemployment_rate']       <= g['max_unemp_pct'])]
    q = q[q['wage_growth_yoy'].isna()         | (q['wage_growth_yoy']         >= g['min_wage_growth'])]
    q = q[q['max_supersector_share'].isna()   | (q['max_supersector_share']   <= g['max_sector_share'])]
    q = q[q['cap_spread_to_gateway_pp'].isna()| (q['cap_spread_to_gateway_pp']>= g['min_cap_spread_pp'])]
    q = q[q['employment_diversity_hhi'].isna()| (q['employment_diversity_hhi']<= g['max_hhi_strategy'])]
    if g['require_no_disq']:
        q = q[(q['any_disqualifier'] == False) | (q['any_disqualifier'].isna())]
    if len(q) > 0:
        cap_median = q['cap_rate_proxy'].median()
        q = q[q['cap_rate_proxy'] >= cap_median]
    q = q.dropna(subset=['total_return_3yr']).copy()
    if q.empty: continue

    # Assign hindsight rank within qualified pool
    q = q.sort_values('total_return_3yr', ascending=False).reset_index(drop=True)
    q['hs_rk'] = range(1, len(q)+1)
    hs_top1_tr = q.iloc[0]['total_return_3yr'] * 100
    hs_map = dict(zip(q['fips'], q['hs_rk']))

    print('=' * 130)
    print(f'YEAR {yr}   qualified_n={len(q)}   hindsight_top1_TR={hs_top1_tr:+.2f}%   '
          f'({q.iloc[0]["county_name"].replace(" County","")}, {q.iloc[0]["state_name"]})')
    print('=' * 130)
    print(f'  {"algo_rk":>7}  {"hs_rk":>6}  {"county":<34} {"cap":>6} {"spread":>10}  {"realized_TR":>12}  {"gap_vs_hs_top1":>16}')
    print('  ' + '-' * 110)

    for i, r in algo.reset_index(drop=True).iterrows():
        hs_rk = hs_map.get(r['fips'], None)
        hs_rk_str = f'{hs_rk}/{len(q)}' if hs_rk else 'n/a'
        tr = r.get('total_return_3yr')
        tr_str = f'{tr*100:+.2f}%' if pd.notna(tr) else 'n/a'
        gap_str = f'{(tr*100 - hs_top1_tr):+.2f}pp' if pd.notna(tr) else 'n/a'
        cap = r['cap_rate_proxy'] * 100
        net = cap * (1 - r['opex_ratio'])
        mtg = r['mortgage_rate'] * 100
        sp  = net - mtg
        name = f"{r['county_name'].replace(' County','')}, {r['state_name']}"
        print(f'  #{i+1:<6}  {hs_rk_str:>6}  {name:<34} {cap:>5.2f}% {sp:>+9.2f}pp  {tr_str:>12}  {gap_str:>16}')
        all_rows.append({
            'year': yr,
            'algo_rk': i+1,
            'fips': r['fips'],
            'county': name,
            'hs_rk': hs_rk if hs_rk else float('nan'),
            'qual_n': len(q),
            'realized_TR_pct': tr*100 if pd.notna(tr) else float('nan'),
            'hs_top1_TR_pct': hs_top1_tr,
            'gap_pp': (tr*100 - hs_top1_tr) if pd.notna(tr) else float('nan'),
        })
    print()

# ── Cross-year summary per algorithm rank slot ──
if all_rows:
    per_pick = pd.DataFrame(all_rows)
    print('=' * 130)
    print('CROSS-YEAR AVERAGES BY ALGO RANK SLOT (2015-2022 observable)')
    print('=' * 130)
    print(f'  {"algo_rk":<8} {"avg_hs_rk":>10} {"avg_realized_TR":>18} {"avg_gap_vs_hs_top1":>22}')
    print('  ' + '-' * 62)
    for rk in range(1, TOP_N+1):
        slot = per_pick[per_pick['algo_rk'] == rk].dropna(subset=['realized_TR_pct'])
        if slot.empty: continue
        print(f'  #{rk:<7} {slot["hs_rk"].mean():>10.1f} {slot["realized_TR_pct"].mean():>+17.2f}% {slot["gap_pp"].mean():>+21.2f}pp')

    print()
    print('Per-market frequency (which counties did the algo pick most often, and how did they average?):')
    print('  ' + '-' * 90)
    freq = per_pick.groupby('county').agg(n_times=('year','count'),
                                          avg_hs_rk=('hs_rk','mean'),
                                          avg_TR=('realized_TR_pct','mean'),
                                          avg_gap=('gap_pp','mean')).sort_values('n_times', ascending=False).head(15)
    print(freq.to_string(float_format=lambda x: f'{x:+.2f}' if abs(x) < 100 else f'{x:.1f}'))
"""

WITHIN_PICK_MD = """## 8. What predicts outperformance *within* the picks?

For each observable year, the algorithm returns ~10 picks. Some outperform the pack, some underperform.
This section asks: **is there any signal — among the ones the algorithm already sees — that would tell
us which of the 10 will win, if we had to bet on just one?**

Method:
1. For each year, take the algorithm's picks and their realized 3yr TR.
2. Rank each signal within the year's picks (1-10). Rank realized TR within the picks (1-10).
3. Compute Spearman rank correlation across all (year, pick) observations.
4. A signal with high positive correlation is a real *intra-cohort tiebreaker*.

**Interpretation:**
- Correlation ≥ +0.30 — meaningful tiebreaker; higher signal reliably predicts higher return
- ±0.15 to ±0.30 — weak signal
- < ±0.15 — noise, not predictive within the picked set

Note: this is different from *cross-cohort* signal strength. A signal can be great at picking
which markets to include (cross-year) but useless at ordering them within a given year's picks.
"""

WITHIN_PICK_CELL = """# Within-pick tiebreaker analysis — which signal ranks the winners inside the picks?
from scipy.stats import spearmanr

# Collect (year, fips, realized_TR, signal_values) for all picks 2015-2022
signals_to_test = [
    'cap_rate_proxy',
    'cap_spread_to_gateway_pp',
    'wage_growth_yoy',
    'emp_growth_yoy',
    'pop_yoy_pct',
    'business_apps_per_1000',
    'permits_per_new_job',
    'permits_intensity_ratio',
    'recession_resilience_score',
    'knowledge_emp_growth_vs_state_pp',
    'rent_growth_vs_wage_growth',
    'hpi_yoy',
    'zori_yoy',
    'trailing_5yr_hpi_ann',
    'unemployment_rate',
    'employment_diversity_hhi',
    'opportunity_score',
]

pick_rows = []
for yr in range(2015, 2023):
    algo = pick_for_year(yr)
    if algo is None or algo.empty: continue
    obs = algo.dropna(subset=['total_return_3yr']).copy()
    if len(obs) < 3: continue
    obs['tr_rank'] = obs['total_return_3yr'].rank(ascending=False)
    for sig in signals_to_test:
        if sig not in obs.columns: continue
        if obs[sig].notna().sum() < 3: continue
        obs[f'{sig}_rank'] = obs[sig].rank(ascending=False)
    obs['year'] = yr
    pick_rows.append(obs)

all_picks = pd.concat(pick_rows, ignore_index=True) if pick_rows else pd.DataFrame()

if all_picks.empty:
    print('No pick observations available.')
else:
    print(f'Analysis pool: {len(all_picks)} pick observations across {all_picks[\"year\"].nunique()} years\\n')
    print('=' * 100)
    print('Spearman rank correlation: signal_rank vs realized_TR_rank (within-year picks)')
    print('=' * 100)
    print(f'  {\"signal\":<40} {\"corr\":>7}  {\"p-value\":>9}  {\"n_obs\":>6}  {\"interpretation\":<30}')
    print('  ' + '-' * 96)

    results = []
    for sig in signals_to_test:
        rank_col = f'{sig}_rank'
        if rank_col not in all_picks.columns: continue
        valid = all_picks.dropna(subset=[rank_col, 'tr_rank'])
        if len(valid) < 20: continue
        # High signal rank (rank=1) should correspond to high TR rank (rank=1) if signal is a positive predictor
        corr, p = spearmanr(valid[rank_col], valid['tr_rank'])
        # Flip sign so positive = higher signal predicts higher TR
        corr = -corr
        if   corr >=  0.30: interp = 'STRONG positive predictor'
        elif corr >=  0.15: interp = 'weak positive'
        elif corr >  -0.15: interp = 'noise / no signal'
        elif corr >  -0.30: interp = 'weak NEGATIVE (inverted)'
        else:               interp = 'STRONG NEGATIVE (inverted)'
        results.append({'signal': sig, 'corr': corr, 'p': p, 'n': len(valid), 'interp': interp})

    results = sorted(results, key=lambda r: abs(r['corr']), reverse=True)
    for r in results:
        star = ' *' if r['p'] < 0.05 else ''
        print(f'  {r[\"signal\"]:<40} {r[\"corr\"]:>+7.3f}  {r[\"p\"]:>9.4f}  {r[\"n\"]:>6}  {r[\"interp\"]:<30}{star}')

    print()
    print('  * = statistically significant at p<0.05')
    print()
    print('The `opportunity_score` row is the algorithm\\'s own composite — if it were highly predictive,')
    print('algo rank #1 would systematically outperform algo rank #10, which we saw earlier it does NOT.')
    print('Signals with STRONG positive correlation are the real intra-cohort tiebreakers.')

    # ── Backtest: pick single winner per year using the strongest signal ─────
    print()
    print('=' * 100)
    print('BACKTEST: single-market selection using strongest within-pick signal')
    print('=' * 100)

    top_signal = None
    for r in results:
        if r['corr'] >= 0.30 and r['p'] < 0.10:
            top_signal = r['signal']
            break

    if top_signal is None:
        # Fall back to strongest positive signal even if not p<0.10
        pos_signals = [r for r in results if r['corr'] > 0]
        if pos_signals:
            top_signal = pos_signals[0]['signal']
            print(f'  No signal met corr>=0.30 & p<0.10. Falling back to strongest positive: {top_signal}')
        else:
            print('  No positive within-pick signal found.')

    if top_signal:
        print(f'  Testing: pick the algorithm\\'s pick with the highest `{top_signal}` each year.')
        print()
        print(f'  {\"year\":<6} {\"tiebreaker_pick\":<32} {\"realized_TR\":>12} {\"algo_top1_TR\":>13} {\"vs_algo_top1\":>13}')
        print('  ' + '-' * 78)
        wins_vs_algo_top1 = 0
        n_obs = 0
        tie_returns, algo_top1_returns = [], []
        for yr, grp in all_picks.groupby('year'):
            grp_obs = grp.dropna(subset=[top_signal, 'total_return_3yr'])
            if grp_obs.empty: continue
            tie_pick = grp_obs.loc[grp_obs[top_signal].idxmax()]
            algo_top1 = grp_obs.iloc[0] if grp_obs.iloc[0]['fips'] in set(pick_for_year(yr)['fips']) else grp_obs.iloc[0]
            # actually get the true algo #1 (first row of pick_for_year, which is sorted by opportunity_score)
            algo_picks_yr = pick_for_year(yr)
            if algo_picks_yr is not None and not algo_picks_yr.empty:
                algo_top1 = algo_picks_yr.iloc[0]
            tie_tr = tie_pick['total_return_3yr'] * 100
            algo_tr = algo_top1['total_return_3yr'] * 100 if pd.notna(algo_top1.get('total_return_3yr')) else float('nan')
            name = f\"{tie_pick['county_name'].replace(' County','')}, {tie_pick['state_name']}\"
            print(f'  {yr:<6} {name:<32} {tie_tr:>+11.2f}% {algo_tr:>+12.2f}% {(tie_tr - algo_tr):>+12.2f}pp')
            tie_returns.append(tie_tr); algo_top1_returns.append(algo_tr)
            if tie_tr > algo_tr: wins_vs_algo_top1 += 1
            n_obs += 1
        if n_obs > 0:
            print()
            print(f'  Avg tiebreaker single-pick TR: {sum(tie_returns)/n_obs:>+.2f}%')
            print(f'  Avg algo top-1 TR:             {sum(algo_top1_returns)/n_obs:>+.2f}%')
            print(f'  Tiebreaker wins vs algo top-1: {wins_vs_algo_top1}/{n_obs} years')
"""

TIEBREAKER_MD = """## 9. Composite mean-reversion tiebreaker (re-rank top-10)

Given the finding above — that hot momentum signals systematically predict *underperformance* within
the algorithm's picks — this section builds a composite tiebreaker and **re-ranks the algorithm's top-10
picks** each year. Same 10 markets, different ordering.

**Composite construction (deliberately simple to avoid overfitting):**

Six signals, all pointing in the mean-reversion direction:

1. `rent_growth_vs_wage_growth` (inverted)
2. `zori_yoy` (inverted)
3. `hpi_yoy` (inverted)
4. `business_apps_per_1000` (inverted; capped at 40 upstream)
5. `permits_intensity_ratio` (inverted)
6. `recession_resilience_score` (positive — captures bubble-check + yield + diversification + migration + permit)

**Weighting:** equal weight on each signal's within-year z-score. Equal weights are used deliberately —
using the observed correlation magnitudes as weights would overfit to this 8-year sample.

For each year:
1. Take the algorithm's top-10 picks (same 10 markets — don't change the selection).
2. Within those 10, z-score each of the 6 signals.
3. Invert the 5 momentum signals; keep RRS positive.
4. Sum → composite mean-reversion score.
5. **Re-rank** the 10 picks by composite score (higher = better tiebreaker rank).

Then compare, year by year:
- Original algo rank → new tiebreaker rank per market
- Mean realized TR of tiebreaker top-3 vs algo top-3
- Mean realized TR of tiebreaker top-5 vs algo top-5
- Full top-10 order side by side

**Honest caveat:** the 6 signals were chosen because they showed the strongest negative correlation
in-sample (Section 8). Even with equal weights, this is *feature-selection-in-sample*. Treat the
result as a hypothesis to validate on out-of-sample years going forward, not as a proven edge.
"""

TIEBREAKER_CELL = """# Composite mean-reversion tiebreaker — re-rank the algorithm's top-10 each year
MOMENTUM_SIGNALS_INVERTED = [
    'rent_growth_vs_wage_growth',
    'zori_yoy',
    'hpi_yoy',
    'business_apps_per_1000',
    'permits_intensity_ratio',
]
POSITIVE_SIGNALS = ['recession_resilience_score']

def rerank_by_tiebreaker(picks_df):
    '''Re-order the algo's picks by composite mean-reversion score (higher = better tiebreaker rank).'''
    p = picks_df.reset_index(drop=True).copy()
    p['algo_rank'] = range(1, len(p) + 1)
    p['tb_score'] = 0.0
    for sig in MOMENTUM_SIGNALS_INVERTED:
        if sig not in p.columns or p[sig].notna().sum() < 3: continue
        mu, sd = p[sig].mean(), p[sig].std()
        if sd == 0 or pd.isna(sd): continue
        z = (p[sig] - mu) / sd
        p['tb_score'] = p['tb_score'] + (-z.fillna(0))  # INVERT — hot momentum penalized
    for sig in POSITIVE_SIGNALS:
        if sig not in p.columns or p[sig].notna().sum() < 3: continue
        mu, sd = p[sig].mean(), p[sig].std()
        if sd == 0 or pd.isna(sd): continue
        z = (p[sig] - mu) / sd
        p['tb_score'] = p['tb_score'] + z.fillna(0)  # keep positive
    p = p.sort_values('tb_score', ascending=False).reset_index(drop=True)
    p['tb_rank'] = range(1, len(p) + 1)
    return p

# ── Per-year re-ranked top-10 ──────────────────────────────────────────────
summary_rows = []
for yr in range(2015, 2023):
    algo = pick_for_year(yr)
    if algo is None or algo.empty: continue
    reranked = rerank_by_tiebreaker(algo)

    def _nm(r): return f\"{r['county_name'].replace(' County','')}, {r['state_name']}\"

    print('=' * 130)
    print(f'YEAR {yr} — algorithm top-10 re-ranked by mean-reversion tiebreaker')
    print('=' * 130)
    print(f'  {\"tb_rk\":>6} {\"algo_rk\":>8}  {\"county\":<34} {\"cap\":>6} {\"RRS\":>5} {\"zori_yoy\":>10} {\"hpi_yoy\":>9} {\"realized_TR\":>13}')
    print('  ' + '-' * 116)
    for _, r in reranked.iterrows():
        cap = r['cap_rate_proxy'] * 100
        rrs = r.get('recession_resilience_score')
        zy  = r.get('zori_yoy')
        hy  = r.get('hpi_yoy')
        tr  = r.get('total_return_3yr')
        rrs_s = f'{rrs:>4.1f}' if pd.notna(rrs) else ' n/a'
        zy_s  = f'{zy*100:>+8.2f}%' if pd.notna(zy) else '   n/a  '
        hy_s  = f'{hy*100:>+7.2f}%' if pd.notna(hy) else '  n/a  '
        tr_s  = f'{tr*100:>+11.2f}%' if pd.notna(tr) else '     n/a  '
        print(f'  #{int(r[\"tb_rank\"]):<5} #{int(r[\"algo_rank\"]):<7}  {_nm(r):<34} {cap:>5.2f}% {rrs_s:>5} {zy_s:>10} {hy_s:>9} {tr_s:>13}')

    # Aggregate: mean TR by tiebreaker top-K vs algo top-K
    obs = reranked.dropna(subset=['total_return_3yr'])
    if not obs.empty:
        # Sort by algo rank to get algo top-K
        algo_sorted = obs.sort_values('algo_rank')
        for k in [3, 5, 10]:
            tb_k = obs.head(k)['total_return_3yr'].mean() * 100
            algo_k = algo_sorted.head(k)['total_return_3yr'].mean() * 100
            summary_rows.append({'year': yr, 'k': k, 'tb_topK_TR': tb_k, 'algo_topK_TR': algo_k})
        print()

# ── Aggregate table ────────────────────────────────────────────────────────
if summary_rows:
    agg = pd.DataFrame(summary_rows)
    print('=' * 130)
    print('AGGREGATE — mean realized 3yr TR by top-K (tiebreaker vs original algo order)')
    print('=' * 130)
    print(f'  {\"year\":<6}  ' + '  '.join(f'{\"tb_top\"+str(k):>10}  {\"algo_top\"+str(k):>10}  {\"delta\":>7}' for k in [3, 5, 10]))
    print('  ' + '-' * 130)
    for yr, grp in agg.groupby('year'):
        pieces = [f'  {yr:<6}']
        for k in [3, 5, 10]:
            row = grp[grp['k']==k]
            if row.empty: continue
            tb = row['tb_topK_TR'].iloc[0]
            al = row['algo_topK_TR'].iloc[0]
            pieces.append(f'{tb:>+9.2f}%  {al:>+9.2f}%  {(tb-al):>+6.2f}pp')
        print('  '.join(pieces))

    print()
    print('  Averages across observable cohorts:')
    for k in [3, 5, 10]:
        rows_k = agg[agg['k']==k]
        tb_avg = rows_k['tb_topK_TR'].mean()
        al_avg = rows_k['algo_topK_TR'].mean()
        wins = (rows_k['tb_topK_TR'] > rows_k['algo_topK_TR']).sum()
        print(f'    top-{k:<2}   tiebreaker: {tb_avg:>+.2f}%   algo: {al_avg:>+.2f}%   delta: {(tb_avg-al_avg):>+.2f}pp   (tb wins {wins}/{len(rows_k)})')
"""

BORDA_MD = """## 10. Borda rank-sum — weightless alternative

The weighted `opportunity_score` in Section 3 has 9 signals with weights ranging from +2.0 (cap_spread)
to −1.0 (permits_per_new_job). Every weight is a subjective bet. This section builds a **weightless**
alternative — Borda rank-sum — using the same 9 signals but treating them as equal.

**Method:**
1. Take the same qualified pool each year (same hard gates + yield floor as EMERGING-VALUE).
2. For each of the 9 signals, rank all qualified counties 1–N (best = 1).
   - For 8 signals, "higher is better" → rank descending.
   - For `permits_per_new_job`, "lower is better" (supply-wave penalty) → rank ascending.
3. Sum the 9 ranks per market → **borda_score** (lower = better).
4. Apply the same max-3-per-state cap and pick top-10.

Then compare Borda top-10 vs weighted top-10 side-by-side per year, with realized 3yr TR for each.

**What this tests:** whether the +2.0 vs +0.5 vs −1.0 weight structure earns its keep. If Borda
matches or beats the weighted version, the weights are overfit to your intuitions. If the weighted
version wins consistently, the cap-spread + cap-rate emphasis is doing real work.
"""

BORDA_CELL = """# Borda rank-sum — same 9 signals, equal weight (via ranks), same gates
BORDA_SIGNALS = {
    'cap_spread_to_gateway_pp':          'higher',
    'cap_rate_proxy':                    'higher',
    'wage_growth_yoy':                   'higher',
    'pop_yoy_pct':                       'higher',
    'business_apps_per_1000':            'higher',   # capped at 40 upstream
    'permits_per_new_job':               'lower',    # supply-wave penalty
    'recession_resilience_score':        'higher',
    'knowledge_emp_growth_vs_state_pp':  'higher',
    'rent_growth_vs_wage_growth':        'higher',
}

def pick_borda_for_year(year, gates=EMERGING_VALUE_GATES):
    '''Apply same gates as EMERGING-VALUE, then rank-sum instead of weighted score.'''
    c = uni[uni['year'] == year].dropna(subset=['cap_rate_proxy']).copy()
    if c.empty: return pd.DataFrame()

    pop_yr = pop_yoy_cache.get(year, pd.DataFrame())
    if not pop_yr.empty:
        c = c.merge(pop_yr[['fips','pop_yoy_pct']], on='fips', how='left')
    else:
        c['pop_yoy_pct'] = np.nan

    # Same hard gates as pick_for_year
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

    if c.empty: return pd.DataFrame()

    # Cap business_apps to prevent DE/WY artifacts (same as algo)
    if 'business_apps_per_1000' in c.columns:
        c['business_apps_per_1000'] = c['business_apps_per_1000'].clip(upper=40)

    # Compute Borda rank-sum
    c = c.copy()
    c['borda_score'] = 0.0
    signals_used = 0
    for sig, direction in BORDA_SIGNALS.items():
        if sig not in c.columns or c[sig].notna().sum() < 3: continue
        ascending = (direction == 'lower')
        rank = c[sig].rank(ascending=ascending, na_option='bottom')
        c['borda_score'] = c['borda_score'] + rank
        signals_used += 1

    c = c.sort_values('borda_score', ascending=True).reset_index(drop=True)

    # Same state cap + top-N as algo
    picked, sc = [], {}
    for _, r in c.iterrows():
        if sc.get(r['state_name'], 0) >= MAX_PER_STATE: continue
        picked.append(r); sc[r['state_name']] = sc.get(r['state_name'], 0) + 1
        if len(picked) >= TOP_N: break
    return pd.DataFrame(picked)

# ── Per-year: Borda top-10 vs weighted top-10 ──────────────────────────────
def _nm(row): return f\"{row['county_name'].replace(' County','')}, {row['state_name']}\"

comparison_rows = []
for yr in range(2015, 2023):
    algo = pick_for_year(yr)
    borda = pick_borda_for_year(yr)
    if algo is None or algo.empty or borda is None or borda.empty: continue

    algo_fips = set(algo['fips'])
    borda_fips = set(borda['fips'])
    overlap = algo_fips & borda_fips
    only_algo = algo_fips - borda_fips
    only_borda = borda_fips - algo_fips

    algo_tr  = algo.dropna(subset=['total_return_3yr'])['total_return_3yr'].mean() * 100
    borda_tr = borda.dropna(subset=['total_return_3yr'])['total_return_3yr'].mean() * 100

    print('=' * 130)
    print(f'YEAR {yr}   overlap={len(overlap)}/10   Borda mean TR: {borda_tr:+.2f}%   Algo mean TR: {algo_tr:+.2f}%   delta: {(borda_tr-algo_tr):+.2f}pp')
    print('=' * 130)

    print(f'  {\"borda_rk\":>8}  {\"county\":<32} {\"cap\":>6} {\"TR\":>9}  |  {\"algo_rk\":>7}  {\"county\":<32} {\"cap\":>6} {\"TR\":>9}')
    print('  ' + '-' * 128)
    for i in range(TOP_N):
        b = borda.iloc[i] if i < len(borda) else None
        a = algo.iloc[i]  if i < len(algo)  else None
        b_str = f\"{_nm(b):<32} {b['cap_rate_proxy']*100:>5.2f}% {(b['total_return_3yr']*100 if pd.notna(b.get('total_return_3yr')) else float('nan')):>+8.2f}%\" if b is not None else ' ' * 55
        a_str = f\"{_nm(a):<32} {a['cap_rate_proxy']*100:>5.2f}% {(a['total_return_3yr']*100 if pd.notna(a.get('total_return_3yr')) else float('nan')):>+8.2f}%\" if a is not None else ''
        # Mark overlap
        b_mark = ' *' if b is not None and b['fips'] in overlap else '  '
        a_mark = ' *' if a is not None and a['fips'] in overlap else '  '
        print(f'  #{i+1:<7}{b_mark}{b_str}  |  #{i+1:<6}{a_mark}{a_str}')

    print(f'\\n  * marks markets appearing in BOTH lists')
    comparison_rows.append({
        'year': yr,
        'overlap': len(overlap),
        'borda_mean_TR': borda_tr,
        'algo_mean_TR': algo_tr,
        'delta_pp': borda_tr - algo_tr,
    })

# ── Aggregate ──────────────────────────────────────────────────────────────
if comparison_rows:
    agg = pd.DataFrame(comparison_rows)
    print()
    print('=' * 130)
    print('AGGREGATE — Borda rank-sum vs weighted opportunity_score (2015-2022)')
    print('=' * 130)
    print(agg.to_string(index=False, float_format=lambda x: f'{x:+.2f}' if pd.notna(x) else 'n/a'))
    print()
    borda_wins = (agg['delta_pp'] > 0).sum()
    borda_ties = (agg['delta_pp'] == 0).sum()
    borda_losses = (agg['delta_pp'] < 0).sum()
    print(f'  Avg Borda mean TR:      {agg[\"borda_mean_TR\"].mean():>+7.2f}%')
    print(f'  Avg algo  mean TR:      {agg[\"algo_mean_TR\"].mean():>+7.2f}%')
    print(f'  Avg delta (Borda-algo): {agg[\"delta_pp\"].mean():>+7.2f}pp')
    print(f'  Borda wins:             {borda_wins}/{len(agg)}   ties: {borda_ties}   losses: {borda_losses}')
    print(f'  Avg overlap w/ algo:    {agg[\"overlap\"].mean():.1f}/{TOP_N} picks')
    print()
    if agg['delta_pp'].mean() > 0.5:
        print('  → Borda BEATS weighted. The +2.0 / +1.5 weights on cap signals may be overfit.')
    elif agg['delta_pp'].mean() < -0.5:
        print('  → Weighted BEATS Borda. The cap-signal weight emphasis is earning its keep.')
    else:
        print('  → Borda and weighted are ROUGHLY EQUAL. The weight structure is not adding meaningful signal.')

# ── Current year Borda picks (2025) ─────────────────────────────────────────
print()
print('=' * 130)
print('2025 — Borda rank-sum picks (current-year, forward-looking)')
print('=' * 130)
borda_2025 = pick_borda_for_year(2025)
algo_2025 = pick_for_year(2025)
if not borda_2025.empty:
    algo_2025_fips = set(algo_2025['fips']) if algo_2025 is not None else set()
    print(f'  {\"borda_rk\":>8}  {\"county\":<32} {\"cap\":>6}   {\"in_algo?\":>8}')
    print('  ' + '-' * 65)
    for i, r in borda_2025.reset_index(drop=True).iterrows():
        in_algo = ' *' if r['fips'] in algo_2025_fips else ''
        print(f'  #{i+1:<7}{in_algo}  {_nm(r):<32} {r[\"cap_rate_proxy\"]*100:>5.2f}%')
"""

SUMMARY_CELL = """# Aggregate: algorithm vs hindsight across observable years
agg = pd.DataFrame(summary_rows)
print('Aggregate performance (observable cohorts):\\n')
print(agg.to_string(index=False, float_format=lambda x: f'{x:+.2f}' if pd.notna(x) else 'n/a'))
if not agg.empty:
    print()
    print(f'Averages across {len(agg)} cohorts:')
    print(f'  Hindsight  mean TR (ceiling): {agg[\"hindsight_mean_TR\"].mean():>+7.2f}%')
    print(f'  Algorithm  mean TR:           {agg[\"algo_mean_TR\"].mean():>+7.2f}%')
    print(f'  Universe   mean TR:           {agg[\"universe_mean_TR\"].mean():>+7.2f}%')
    edge_wins = (agg['edge_pp'] > 0).sum()
    print(f'  Algorithm  edge vs universe:  {agg[\"edge_pp\"].mean():>+7.2f}pp   (wins {edge_wins}/{len(agg)} cohorts)')
    total_algo_alpha = (agg['algo_mean_TR'] - agg['universe_mean_TR']).sum()
    total_hs_alpha   = (agg['hindsight_mean_TR'] - agg['universe_mean_TR']).sum()
    if total_hs_alpha != 0:
        alpha_capture = total_algo_alpha / total_hs_alpha * 100
        print(f'  Alpha capture ratio:          {alpha_capture:>7.1f}%   (algo alpha / oracle alpha)')
    print(f'  Avg overlap w/ hindsight:     {agg[\"overlap\"].mean():>7.1f}/{TOP_N}')
    print(f'  Avg hit rate (beat median):   {agg[\"hit_rate_pct\"].mean():>7.0f}%')
"""

# ── Assemble ────────────────────────────────────────────────────────────────
config_with_overrides = CONFIG_CELL + EV['config_overrides'] + "\nSTRATEGY_NAME = 'EMERGING-VALUE'\n"

cells = [
    md(TITLE),
    md("## 1. Config"),
    code(config_with_overrides),
    md("## 2. Load universe + return metrics"),
    code(DATA_LOAD_CELL),
    md("## 3. Algorithm implementation (EMERGING-VALUE)"),
    code(EV['method_code']),
    md("## 4. Year-by-year: hindsight vs algorithm"),
    code(COMPARISON_CELL),
    md("## 5. Aggregate summary"),
    code(SUMMARY_CELL),
    md(SINGLE_DEAL_MD),
    code(SINGLE_DEAL_CELL),
    md(PER_PICK_HINDSIGHT_MD),
    code(PER_PICK_HINDSIGHT_CELL),
    md(WITHIN_PICK_MD),
    code(WITHIN_PICK_CELL),
    md(TIEBREAKER_MD),
    code(TIEBREAKER_CELL),
    md(BORDA_MD),
    code(BORDA_CELL),
]

nb = wrap(cells)
out = NB_DIR / 'strategy_hindsight_vs_algo.ipynb'
out.write_text(json.dumps(nb, indent=1))
print(f'wrote {out.name}   ({len(cells)} cells)')
