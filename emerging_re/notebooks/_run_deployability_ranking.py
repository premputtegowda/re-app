"""Deployability Score — separate ranking for single-market concentration.

The existing `opportunity_score` optimizes for expected return edge (return per pick,
portfolio construction). But when you concentrate capital in ONE market, execution
reality matters more than a marginal edge advantage.

Deployability Score answers: "given that this market passes the strategy screen,
how executable is it for a private buyer deploying real capital over 5 years?"

Five factors, each on 0-10 scale, equally weighted:

  1. INVENTORY DEPTH      — bldgs_5to19 (log-normalized). Deal flow proxy.
  2. TRACK RECORD         — historical hit rate × n_appearances (proven performance)
  3. BUSINESS APPS TIER   — MEDIAN=10, STRONG=8, COILED=7, VALUE_TRAP=3
  4. DIVERSIFICATION      — 1 - (HHI/0.15) - (top_sector_share/0.30)
  5. YIELD FLOOR          — cap_rate above 5% (defensive yield bonus)

Final Deployability = mean(5 factors). Range 0-10. Higher = more executable.
"""
from __future__ import annotations
import duckdb, numpy as np, pandas as pd, math

con = duckdb.connect('/Users/premputtegowda/reps/reps-tracker/emerging_re/data/warehouse/emerging_re.duckdb', read_only=True)

PICKS_2025 = [
    ('12083','Marion, FL'),      ('39113','Montgomery, OH'),
    ('18097','Marion, IN'),      ('12101','Pasco, FL'),
    ('48303','Lubbock, TX'),     ('48355','Nueces, TX'),
    ('04021','Pinal, AZ'),       ('48141','El Paso, TX'),
    ('12033','Escambia, FL'),    ('13089','DeKalb, GA'),
]

# Historical VALUE-strategy appearances + hit rate (from prior picks-history data)
# Format: fips -> (n_appearances, n_above_avg, n_below_avg)
# Values from our earlier picks_history_analysis (2015-2022 observable cohorts)
HISTORY = {
    '12083': (4, 4, 0),   # Marion FL: 4 appearances, all ABOVE
    '39113': (5, 4, 0),   # Montgomery OH: 5 appearances, 4 ABOVE + 1 AVG (never below)
    '18097': (4, 2, 0),   # Marion IN: 4 appearances, 2 ABOVE + 2 AVG (never below)
    '12101': (1, 1, 0),   # Pasco FL: 1 appearance, ABOVE
    '48303': (2, 0, 1),   # Lubbock TX: 2 appearances, 1 BELOW + 1 AVG
    '48355': (5, 3, 2),   # Nueces TX: 5 appearances, 3 ABOVE + 2 BELOW
    '04021': (1, 1, 0),   # Pinal AZ: 1 appearance, ABOVE
    '48141': (5, 4, 0),   # El Paso TX: 5 appearances, 4 ABOVE + 1 AVG (never below)
    '12033': (3, 2, 1),   # Escambia FL: 3 appearances, 2 ABOVE + 1 BELOW
    '13089': (1, 1, 0),   # DeKalb GA: 1 appearance, ABOVE
}

# ── Pull operational data ──────────────────────────────────────────────────
fips_list = [f for f,_ in PICKS_2025]
r = con.execute(f'''
    SELECT fips, county_name, state_name, pop_latest,
           cap_rate_proxy, business_apps_per_1000,
           employment_diversity_hhi, max_supersector_share
    FROM main_marts.mart_county_features
    WHERE fips IN ({",".join(repr(f) for f in fips_list)})
      AND EXTRACT(YEAR FROM period_end_date) = 2024
      AND EXTRACT(MONTH FROM period_end_date) = 12
''').df()

# MF building counts (latest ACS)
mf = con.execute(f'''
    SELECT fips,
           units_in_5_to_9_bldgs   / 7    AS b_5to9,
           units_in_10_to_19_bldgs / 14.5 AS b_10to19,
           units_in_20_to_49_bldgs / 34.5 AS b_20to49
    FROM main_staging.stg_census_acs_1yr
    WHERE fips IN ({",".join(repr(f) for f in fips_list)})
    QUALIFY row_number() OVER (PARTITION BY fips ORDER BY as_of_date DESC) = 1
''').df()
mf['bldgs_5to19'] = (mf['b_5to9'] + mf['b_10to19']).round().astype(int)
mf['bldgs_20to49'] = mf['b_20to49'].round().astype(int)

# Business apps 3yr change (for tier)
apps_prev = con.execute(f'''
    SELECT fips, business_apps_per_1000 AS apps_2021
    FROM main_marts.mart_county_features
    WHERE fips IN ({",".join(repr(f) for f in fips_list)})
      AND EXTRACT(YEAR FROM period_end_date) = 2021
      AND EXTRACT(MONTH FROM period_end_date) = 12
''').df()
con.close()

data = r.merge(mf[['fips','bldgs_5to19','bldgs_20to49']], on='fips', how='left')
data = data.merge(apps_prev, on='fips', how='left')
data['apps_3yr_chg'] = data['business_apps_per_1000'] - data['apps_2021']

# ── Score each factor (0-10 scale) ─────────────────────────────────────────

def score_inventory(bldgs):
    '''Log-scaled inventory. 100 buildings → 4, 1000 → 6, 5000 → 8, 10000 → 9, 20000 → 10.'''
    if pd.isna(bldgs) or bldgs <= 0: return 0
    return min(10, max(0, math.log10(bldgs) * 2.5))

def score_track_record(n_appear, n_above, n_below):
    '''Track record = (appearances × above-avg rate) with penalty for below-avg picks.'''
    if n_appear == 0: return 5.0  # neutral (no data)
    hit_rate = n_above / n_appear
    penalty  = n_below / n_appear
    # Base = appearances (up to 5) + hit rate bonus - below-avg penalty
    return min(10, max(0, min(n_appear, 5) + 5 * hit_rate - 3 * penalty))

def score_apps_tier(apps, chg):
    '''Business apps tier score. MEDIAN=10 (best hit rate historically), then STRONG, COILED, VALUE_TRAP.'''
    if pd.isna(apps): return 5.0
    if apps < 10:  return 3.0                                    # VALUE_TRAP_RISK
    if 10 <= apps < 12: return 7.0                               # MEDIAN low
    if 12 <= apps < 15: return 10.0                              # MEDIAN (historically best hit rate)
    if 15 <= apps < 18: return 9.0                               # STRONG lower
    if apps >= 18 and pd.notna(chg) and chg > 1: return 8.0      # COILED_SPRING (some price already in)
    return 8.5                                                   # STRONG (18+, flat/decel)

def score_diversification(hhi, top_sector_share):
    '''Lower HHI + lower top-sector share = better diversification.'''
    hhi_score = max(0, 10 - hhi / 0.15 * 10)               # HHI=0 → 10; HHI=0.15 → 0
    sec_score = max(0, 10 - top_sector_share / 0.30 * 10)  # 0% → 10; 30% → 0
    return (hhi_score + sec_score) / 2

def score_yield(cap_rate):
    '''Yield floor bonus. 5% → 0, 6% → 5, 7% → 10.'''
    return min(10, max(0, (cap_rate - 0.05) * 500))

# ── Compute all scores ─────────────────────────────────────────────────────
rows = []
for _, x in data.iterrows():
    n_app, n_ab, n_bel = HISTORY.get(x['fips'], (0, 0, 0))
    inv    = score_inventory(x['bldgs_5to19'])
    track  = score_track_record(n_app, n_ab, n_bel)
    apps_s = score_apps_tier(x['business_apps_per_1000'], x['apps_3yr_chg'])
    diver  = score_diversification(x['employment_diversity_hhi'], x['max_supersector_share'])
    yield_ = score_yield(x['cap_rate_proxy'])
    deploy = round((inv + track + apps_s + diver + yield_) / 5, 2)
    name = dict(PICKS_2025).get(x['fips'], x['county_name'])
    rows.append({
        'pick':             name,
        'pop':              int(x['pop_latest']),
        'bldgs_5to19':      int(x['bldgs_5to19']) if pd.notna(x['bldgs_5to19']) else 0,
        'cap':              round(x['cap_rate_proxy']*100, 2),
        'apps':             round(x['business_apps_per_1000'], 1),
        'apps_3yr':         round(x['apps_3yr_chg'], 1) if pd.notna(x['apps_3yr_chg']) else None,
        'HHI':              round(x['employment_diversity_hhi'], 3),
        'history':          f'{n_ab}A/{n_app - n_ab - n_bel}=/{n_bel}B',
        'inventory':        round(inv, 1),
        'track_record':     round(track, 1),
        'apps_tier':        round(apps_s, 1),
        'diversification':  round(diver, 1),
        'yield':            round(yield_, 1),
        'DEPLOYABILITY':    deploy,
    })

df = pd.DataFrame(rows).sort_values('DEPLOYABILITY', ascending=False).reset_index(drop=True)
df.index = df.index + 1

# ── Print ranking ──────────────────────────────────────────────────────────
print('=' * 130)
print('DEPLOYABILITY SCORE — separate ranking for single-market concentrated deployment')
print('=' * 130)
print('Formula: mean of 5 factors (each 0-10):')
print('  INVENTORY (log-normalized bldgs 5-19) + TRACK_RECORD (past hit rate × appearances)')
print('  + APPS_TIER (MEDIAN historically best) + DIVERSIFICATION (low HHI + spread sectors)')
print('  + YIELD (cap rate above 5% bonus)')
print()

# Compact view
compact = df[['pick','bldgs_5to19','cap','apps','history','DEPLOYABILITY']].copy()
compact.columns = ['pick','bldgs_5to19','cap%','apps','A/=/B','DEPLOY']
print('RANKING (compact):')
print(compact.to_string())
print()

# Full breakdown
print('COMPONENT BREAKDOWN:')
print(df[['pick','inventory','track_record','apps_tier','diversification','yield','DEPLOYABILITY']].to_string())
print()

# Highlight the three "type" markets
print('THE THREE ARCHETYPE MARKETS (from your question):')
print()
target_names = ['Marion, FL', 'Marion, IN', 'Montgomery, OH']
for name in target_names:
    row = df[df['pick'] == name]
    if row.empty: continue
    r = row.iloc[0]
    rank_pos = df.index[df['pick'] == name].tolist()[0]
    print(f'  #{rank_pos}  {name:<18} DEPLOY={r["DEPLOYABILITY"]}   '
          f'inv={r["inventory"]}, track={r["track_record"]}, apps={r["apps_tier"]}, '
          f'div={r["diversification"]}, yield={r["yield"]}')
print()

# Interpretation
print('=' * 130)
print('INTERPRETATION')
print('=' * 130)
print()
print('DEPLOYABILITY tier meanings:')
print('  8.0+  PRIME    — deploy full capital, no reservations. Large inventory + proven track + all signals aligned.')
print('  6.5-8 SOLID    — deploy with normal due diligence. Some component may lag but not disqualifying.')
print('  5.0-6.5 MIXED  — flags in 1-2 components. Deploy half size or investigate before committing.')
print('  <5.0  WEAK     — multiple factors weak. Consider skip or heavy investigation.')
