"""Walk-forward validation of tuned weights at 100K-500K.

For each held-out year Y in [2018..2022]:
  1. Fit Ridge on years 2015..Y-1 (past data only, no look-ahead)
  2. Score Y's qualified pool with those weights
  3. Measure Y's realized 3yr TR of top-10
  4. Compare to hand-weight top-10 same year

Aggregate: honest out-of-sample estimate. If tuned loses, hand weights are baseline.
Also plots weight trajectory across held-out years — do the tuner's picks stabilize
or wildly swing year-to-year?
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
pd.set_option('display.width', 250)

from _generate_strategy_notebooks import DATA_LOAD_CELL

ns = {'duckdb': duckdb, 'np': np, 'pd': pd,
      'WAREHOUSE': WAREHOUSE, 'POP_MIN': POP_MIN, 'POP_MAX': POP_MAX,
      'HHI_MAX': HHI_MAX, 'TOP_N': TOP_N, 'MAX_PER_STATE': MAX_PER_STATE, 'LTV': LTV}
exec(DATA_LOAD_CELL, ns)
uni = ns['uni']
pop_yoy_cache = ns['pop_yoy_cache']

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


def build_training(train_years):
    rows = []
    for yr in train_years:
        q = apply_gates(yr).dropna(subset=['total_return_3yr']).copy()
        if q.empty: continue
        for sig in SIGNALS:
            if sig in q.columns and q[sig].notna().sum() >= 3:
                mu, sd = q[sig].mean(), q[sig].std()
                q[f'z_{sig}'] = ((q[sig] - mu) / sd).fillna(0) if sd > 0 else 0
            else:
                q[f'z_{sig}'] = 0
        q['year'] = yr
        rows.append(q)
    if not rows: return None, None
    train = pd.concat(rows, ignore_index=True)
    X = train[[f'z_{s}' for s in SIGNALS]].values
    y = train['total_return_3yr'].values
    return X, y


def fit_ridge(X, y, alpha=1.0):
    from sklearn.linear_model import Ridge
    m = Ridge(alpha=alpha, fit_intercept=False)
    m.fit(X, y)
    raw = dict(zip(SIGNALS, m.coef_))
    max_abs = max(abs(v) for v in raw.values()) if raw else 1.0
    return {k: v / max_abs * 2.0 for k, v in raw.items()} if max_abs > 0 else raw


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


# ═══════════════════════════════════════════════════════════════════════════
# WALK-FORWARD: for each held-out year, fit on prior years only
# ═══════════════════════════════════════════════════════════════════════════
HELD_OUT_YEARS = list(range(2018, 2023))  # need ≥3 training years, need observable 3yr fwd

print('=' * 130)
print('WALK-FORWARD VALIDATION — 100K-500K   (fit weights on past only, evaluate on held-out year)')
print('=' * 130)

weight_trajectory = []
wf_rows = []

for Y in HELD_OUT_YEARS:
    train_years = list(range(2015, Y))  # 2015..Y-1
    X, y = build_training(train_years)
    if X is None or len(X) < 30:
        print(f'  Y={Y}: insufficient training data ({len(X) if X is not None else 0} obs) — skip')
        continue

    tuned = fit_ridge(X, y)
    weight_trajectory.append({'held_out': Y, **tuned, 'n_train': len(X)})

    hand_picks  = pick_with_weights(Y, HAND_WEIGHTS)
    tuned_picks = pick_with_weights(Y, tuned)
    if hand_picks.empty or tuned_picks.empty:
        continue

    hand_tr  = hand_picks.dropna(subset=['total_return_3yr'])['total_return_3yr'].mean() * 100
    tuned_tr = tuned_picks.dropna(subset=['total_return_3yr'])['total_return_3yr'].mean() * 100
    overlap = len(set(hand_picks['fips']) & set(tuned_picks['fips']))

    def _nm(r): return f"{r['county_name'].replace(' County','')}, {r['state_name']}"
    hand_top = _nm(hand_picks.iloc[0])
    tuned_top = _nm(tuned_picks.iloc[0])

    print(f'\n  Held-out Y={Y}   train_years=[{train_years[0]}..{train_years[-1]}] ({len(train_years)}yrs, {len(X)} obs)')
    print(f'    hand_top1  = {hand_top:<30}  hand_TR  = {hand_tr:+.2f}%')
    print(f'    tuned_top1 = {tuned_top:<30}  tuned_TR = {tuned_tr:+.2f}%')
    print(f'    delta = {tuned_tr - hand_tr:+.2f}pp   overlap = {overlap}/{TOP_N}')

    wf_rows.append({
        'held_out': Y,
        'n_train': len(X),
        'hand_top1': hand_top, 'hand_TR': hand_tr,
        'tuned_top1': tuned_top, 'tuned_TR': tuned_tr,
        'delta': tuned_tr - hand_tr,
        'overlap': overlap,
    })

# ═══════════════════════════════════════════════════════════════════════════
# WEIGHT STABILITY across walk-forward folds
# ═══════════════════════════════════════════════════════════════════════════
print()
print('=' * 130)
print('WEIGHT TRAJECTORY — how much do tuned weights swing year-to-year?')
print('=' * 130)
wt = pd.DataFrame(weight_trajectory)
if not wt.empty:
    disp = wt[['held_out','n_train'] + SIGNALS].copy()
    print(disp.to_string(index=False, float_format=lambda x: f'{x:+.2f}' if abs(x) < 100 else f'{x:.0f}'))
    print()
    print('Weight stability (std across walk-forward folds — high = unstable):')
    for s in SIGNALS:
        mn = wt[s].mean()
        sd = wt[s].std()
        sign_flip = ((wt[s] > 0).any() and (wt[s] < 0).any())
        flag = ' ← SIGN FLIPS' if sign_flip else ''
        print(f'  {s:<40} mean={mn:>+6.2f}   std={sd:>5.2f}{flag}')

# ═══════════════════════════════════════════════════════════════════════════
# AGGREGATE: honest out-of-sample estimate
# ═══════════════════════════════════════════════════════════════════════════
if wf_rows:
    df = pd.DataFrame(wf_rows)
    print()
    print('=' * 130)
    print('AGGREGATE — walk-forward out-of-sample results')
    print('=' * 130)
    print(df[['held_out','hand_TR','tuned_TR','delta','overlap']].to_string(index=False, float_format=lambda x: f'{x:+.2f}' if abs(x) < 100 else f'{x:.0f}'))
    print()
    wins = (df['delta'] > 0).sum()
    print(f'  Avg hand-weight  TR:  {df["hand_TR"].mean():>+7.2f}%')
    print(f'  Avg tuned-weight TR:  {df["tuned_TR"].mean():>+7.2f}%')
    print(f'  Avg delta:            {df["delta"].mean():>+7.2f}pp')
    print(f'  Tuned wins:           {wins}/{len(df)} held-out years')
    print(f'  Avg overlap w/ hand:  {df["overlap"].mean():.1f}/{TOP_N}')
    print()
    if df['delta'].mean() > 0.5 and wins > len(df) * 0.6:
        print('  VERDICT: tuned weights show honest out-of-sample edge. Consider adopting.')
    elif df['delta'].mean() < -0.5 or wins < len(df) * 0.4:
        print('  VERDICT: hand weights BEAT tuned out-of-sample. Tuning was overfit.')
    else:
        print('  VERDICT: no meaningful out-of-sample edge. Hand weights are the honest baseline.')
