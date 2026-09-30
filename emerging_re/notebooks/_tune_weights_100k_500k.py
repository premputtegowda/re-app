"""Tune EMERGING-VALUE weights in-sample on 2015-2022 at 100K-500K.

Method:
  1. For each year 2015-2022, take qualified pool (same gates as EMERGING-VALUE)
  2. Z-score each of 9 signals within year's qualified pool
  3. Pool observations across years, fit: realized_TR ~ sum(w_i * z_i) with no intercept
  4. Fitted coefficients = "empirically optimal" in-sample weights
  5. Apply tuned weights to all years 2015-2026, show top-10 picks + realized TR (2015-2022) or forward (2023-2026)
  6. Compare tuned-weight avg TR vs hand-picked-weight avg TR

This is a diagnostic — the weights WILL overfit to 2015-2022 (a specific market cycle).
Interpret as "what the data says worked in this window" not "the right weights going forward."
"""
from __future__ import annotations
import duckdb, numpy as np, pandas as pd
import sys
from pathlib import Path

# Import shared cells so we can execute them exactly like the notebook
NB_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(NB_DIR))

WAREHOUSE = '/Users/premputtegowda/reps/reps-tracker/emerging_re/data/warehouse/emerging_re.duckdb'
POP_MIN, POP_MAX = 100_000, 500_000
HHI_MAX = 0.20
TOP_N = 10
MAX_PER_STATE = 3
LTV = 0.70

pd.set_option('display.width', 250)

# ═══════════════════════════════════════════════════════════════════════════
# EXECUTE the data-load + RRS cells verbatim (namespace pollution is fine here)
# ═══════════════════════════════════════════════════════════════════════════
from _generate_strategy_notebooks import DATA_LOAD_CELL

ns = {'duckdb': duckdb, 'np': np, 'pd': pd,
      'WAREHOUSE': WAREHOUSE, 'POP_MIN': POP_MIN, 'POP_MAX': POP_MAX,
      'HHI_MAX': HHI_MAX, 'TOP_N': TOP_N, 'MAX_PER_STATE': MAX_PER_STATE, 'LTV': LTV}
exec(DATA_LOAD_CELL, ns)
uni = ns['uni']
pop_yoy_cache = ns['pop_yoy_cache']

# Gate constants (matches EMERGING-VALUE)
MAX_SECTOR_SHARE   = 0.25
MIN_CAP_SPREAD_PP  = 0.0
MAX_HHI_STRATEGY   = 0.15

GATES = {
    'min_pop_yoy_pct':      0.0,
    'max_permit_ratio':     1.5,
    'max_unemp_pct':        6.0,
    'min_wage_growth':      0.02,
    'max_sector_share':     MAX_SECTOR_SHARE,
    'min_cap_spread_pp':    MIN_CAP_SPREAD_PP,
    'max_hhi_strategy':     MAX_HHI_STRATEGY,
    'require_no_disq':      True,
}

SIGNALS = [
    'cap_spread_to_gateway_pp',
    'cap_rate_proxy',
    'wage_growth_yoy',
    'pop_yoy_pct',
    'business_apps_per_1000',
    'permits_per_new_job',
    'recession_resilience_score',
    'knowledge_emp_growth_vs_state_pp',
    'rent_growth_vs_wage_growth',
]

HAND_WEIGHTS = {
    'cap_spread_to_gateway_pp':          2.0,
    'cap_rate_proxy':                    1.5,
    'wage_growth_yoy':                   0.8,
    'pop_yoy_pct':                       0.5,
    'business_apps_per_1000':            0.5,
    'permits_per_new_job':              -1.0,
    'recession_resilience_score':        0.5,
    'knowledge_emp_growth_vs_state_pp':  0.5,
    'rent_growth_vs_wage_growth':        0.3,
}


def apply_gates(year):
    c = uni[uni['year'] == year].dropna(subset=['cap_rate_proxy']).copy()
    if c.empty: return pd.DataFrame()
    pop_yr = pop_yoy_cache.get(year, pd.DataFrame())
    if not pop_yr.empty:
        c = c.merge(pop_yr[['fips','pop_yoy_pct']], on='fips', how='left')
    else:
        c['pop_yoy_pct'] = np.nan
    g = GATES
    c = c[c['pop_yoy_pct'].isna()             | (c['pop_yoy_pct']             >= g['min_pop_yoy_pct'])]
    c = c[c['permits_intensity_ratio'].isna() | (c['permits_intensity_ratio'] <  g['max_permit_ratio'])]
    c = c[c['unemployment_rate'].isna()       | (c['unemployment_rate']       <= g['max_unemp_pct'])]
    c = c[c['wage_growth_yoy'].isna()         | (c['wage_growth_yoy']         >= g['min_wage_growth'])]
    c = c[c['max_supersector_share'].isna()   | (c['max_supersector_share']   <= g['max_sector_share'])]
    c = c[c['cap_spread_to_gateway_pp'].isna()| (c['cap_spread_to_gateway_pp']>= g['min_cap_spread_pp'])]
    c = c[c['employment_diversity_hhi'].isna()| (c['employment_diversity_hhi']<= g['max_hhi_strategy'])]
    if g['require_no_disq']:
        c = c[(c['any_disqualifier'] == False) | (c['any_disqualifier'].isna())]
    if len(c) > 0:
        cap_median = c['cap_rate_proxy'].median()
        c = c[c['cap_rate_proxy'] >= cap_median]
    if c.empty: return c
    c = c.copy()
    if 'business_apps_per_1000' in c.columns:
        c['business_apps_per_1000'] = c['business_apps_per_1000'].clip(upper=40)
    return c

# ═══════════════════════════════════════════════════════════════════════════
# BUILD training set (within-year z-scored signals + realized TR)
# ═══════════════════════════════════════════════════════════════════════════
train_rows = []
for yr in range(2015, 2023):
    q = apply_gates(yr).dropna(subset=['total_return_3yr']).copy()
    if q.empty: continue
    for sig in SIGNALS:
        if sig in q.columns and q[sig].notna().sum() >= 3:
            mu, sd = q[sig].mean(), q[sig].std()
            q[f'z_{sig}'] = ((q[sig] - mu) / sd).fillna(0) if sd > 0 else 0
        else:
            q[f'z_{sig}'] = 0
    q['year'] = yr
    train_rows.append(q)

train = pd.concat(train_rows, ignore_index=True)
X = train[[f'z_{s}' for s in SIGNALS]].values
y = train['total_return_3yr'].values
print(f'Training set: {len(train)} qualified county-year observations across {train.year.nunique()} years')

# ═══════════════════════════════════════════════════════════════════════════
# FIT — linear regression, no intercept (weights map z-scores → return)
# ═══════════════════════════════════════════════════════════════════════════
from sklearn.linear_model import LinearRegression, Ridge

for label, model in [('OLS', LinearRegression(fit_intercept=False)),
                     ('Ridge(alpha=1)', Ridge(alpha=1.0, fit_intercept=False))]:
    model.fit(X, y)
    tuned = dict(zip(SIGNALS, model.coef_))
    r2 = model.score(X, y)
    print(f'\n=== {label} fit (in-sample R²={r2:.4f}) ===')
    print(f'  {"signal":<40} {"hand":>7} {"tuned":>9}')
    print('  ' + '-' * 60)
    # Scale tuned weights so the largest absolute is 2.0 (comparable to hand-picked scale)
    max_abs = max(abs(v) for v in tuned.values())
    tuned_scaled = {k: v / max_abs * 2.0 for k, v in tuned.items()}
    for s in SIGNALS:
        print(f'  {s:<40} {HAND_WEIGHTS[s]:>+7.2f} {tuned_scaled[s]:>+9.2f}')
    if label == 'Ridge(alpha=1)':
        RIDGE_WEIGHTS = tuned_scaled

# ═══════════════════════════════════════════════════════════════════════════
# APPLY: pick top-10 each year using hand weights vs ridge-tuned weights
# ═══════════════════════════════════════════════════════════════════════════
def pick_with_weights(year, weights):
    c = apply_gates(year)
    if c.empty: return pd.DataFrame()
    c = c.copy()
    c['score'] = 0.0
    for sig, w in weights.items():
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

print()
print('=' * 130)
print('YEAR-BY-YEAR: Hand weights vs Ridge-tuned weights (top-10 mean realized TR)')
print('=' * 130)
print(f'  {"year":<6}  {"hand_TR":>10}  {"tuned_TR":>10}  {"delta":>8}  {"hand_top1":<30}  {"tuned_top1":<30}')
print('  ' + '-' * 118)

comparison = []
for yr in range(2015, 2026):
    hand = pick_with_weights(yr, HAND_WEIGHTS)
    tuned = pick_with_weights(yr, RIDGE_WEIGHTS)
    if hand.empty or tuned.empty: continue

    obs = yr <= 2022
    if obs:
        h_tr = hand.dropna(subset=['total_return_3yr'])['total_return_3yr'].mean() * 100
        t_tr = tuned.dropna(subset=['total_return_3yr'])['total_return_3yr'].mean() * 100
    else:
        h_tr = t_tr = float('nan')

    def _nm(r): return f"{r['county_name'].replace(' County','')}, {r['state_name']}"
    h_top = _nm(hand.iloc[0])
    t_top = _nm(tuned.iloc[0])
    delta = t_tr - h_tr if obs else float('nan')

    tr_h_s = f'{h_tr:>+.2f}%' if obs else '     n/a'
    tr_t_s = f'{t_tr:>+.2f}%' if obs else '     n/a'
    d_s    = f'{delta:>+.2f}pp' if obs else '     n/a'
    print(f'  {yr:<6}  {tr_h_s:>10}  {tr_t_s:>10}  {d_s:>8}  {h_top:<30}  {t_top:<30}')
    comparison.append({'year': yr, 'hand_TR': h_tr, 'tuned_TR': t_tr, 'delta': delta})

# ═══════════════════════════════════════════════════════════════════════════
# SUMMARY
# ═══════════════════════════════════════════════════════════════════════════
df = pd.DataFrame(comparison).dropna(subset=['hand_TR','tuned_TR'])
if not df.empty:
    print()
    print('=' * 130)
    print(f'IN-SAMPLE AGGREGATE (observable years 2015-2022)')
    print('=' * 130)
    print(f'  Hand-weighted avg TR:  {df["hand_TR"].mean():>+.2f}%')
    print(f'  Ridge-tuned avg TR:    {df["tuned_TR"].mean():>+.2f}%')
    print(f'  Delta (tuned - hand):  {df["delta"].mean():>+.2f}pp')
    wins = (df['delta'] > 0).sum()
    print(f'  Tuned wins vs hand:    {wins}/{len(df)}')

# ═══════════════════════════════════════════════════════════════════════════
# 2025 + 2026 picks under both weight schemes (forward — no realized TR)
# ═══════════════════════════════════════════════════════════════════════════
for yr in [2025, 2026]:
    hand = pick_with_weights(yr, HAND_WEIGHTS)
    tuned = pick_with_weights(yr, RIDGE_WEIGHTS)
    if hand.empty or tuned.empty: continue
    def _nm(r): return f"{r['county_name'].replace(' County','')}, {r['state_name']}"
    print()
    print('=' * 130)
    print(f'{yr} FORWARD PICKS — Hand-weighted vs Ridge-tuned (top-10)')
    print('=' * 130)
    print(f'  {"rk":<3}  {"HAND":<38}  {"cap":>6}  |  {"TUNED":<38}  {"cap":>6}')
    print('  ' + '-' * 108)
    for i in range(TOP_N):
        h = hand.iloc[i] if i < len(hand) else None
        t = tuned.iloc[i] if i < len(tuned) else None
        h_str = f'{_nm(h):<38}  {h["cap_rate_proxy"]*100:>5.2f}%' if h is not None else ' '*46
        t_str = f'{_nm(t):<38}  {t["cap_rate_proxy"]*100:>5.2f}%' if t is not None else ''
        print(f'  #{i+1:<2}  {h_str}  |  {t_str}')
