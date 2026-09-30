"""PIT-strict statistical regime detection + backtest.

For each cohort year Y, uses ONLY data available through Dec 31 Y to:
  1. Compute expanding-window z-scores of national HPI/ZORI/mortgage/yield-curve
  2. Combine into a composite regime stress score
  3. Map stress to a trailing-zori discount multiplier

Then for each strategy's picks per year, compares:
  - Naive projection: pick.zori_yoy as NOI growth assumption
  - Regime-adjusted:  pick.zori_yoy × regime_multiplier(Y)
  - Realized 3yr forward zori (annualized)

Reports which projection is closer to realized on average — the validation
test for whether regime detection actually improves forward predictions.
"""
from __future__ import annotations
import sys
from pathlib import Path
import duckdb
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from backtest.analog_search import (
    load_tertiary_panel, load_mf_context, build_acs_target,
    build_feature_matrix, zscore_within_cohort, walk_forward,
    TARGET_COL_TOTAL_RETURN,
)

POP_MIN, POP_MAX, HHI_MAX = 1_000_000, 10_000_000, 0.10
TOP_N, MAX_PER_STATE = 5, 2
ELITE_TOP_PCT = 0.25
HORIZON_YEARS = 3

pd.set_option('display.width', 250); pd.set_option('display.max_rows', 300)

# ── Load universe with all we need ───────────────────────────────────────────
WAREHOUSE = ROOT / 'data' / 'warehouse' / 'emerging_re.duckdb'
con = duckdb.connect(str(WAREHOUSE), read_only=True)

uni = con.execute(f"""
    SELECT fips, county_name, state_name, pop_latest,
           EXTRACT(YEAR FROM period_end_date)::INT AS year,
           cap_rate_proxy, zori_yoy, hpi_yoy,
           hpi_trailing_24mo, permits_intensity_ratio, unemployment_rate_yoy_chg,
           unemployment_rate, rental_vacancy_rate, renter_share,
           mf_cap_rate_change_3yr, any_disqualifier,
           zori_forward_return_36mo
    FROM main_marts.mart_county_features
    WHERE EXTRACT(MONTH FROM period_end_date) = 12
      AND pop_latest > {POP_MIN} AND pop_latest <= {POP_MAX}
      AND employment_diversity_hhi IS NOT NULL
      AND employment_diversity_hhi <= {HHI_MAX}
""").df()

# FRED macro (yearly snapshots)
fred = con.execute("""
    SELECT year, mortgage_rate, yield_curve, mortgage_yoy_chg
    FROM (
        SELECT EXTRACT(YEAR FROM observation_date)::INT AS year,
               MAX(CASE WHEN series_id='MORTGAGE30US' THEN value/100.0 END) AS mortgage_rate,
               MAX(CASE WHEN series_id='T10Y2Y' THEN value/100.0 END) AS yield_curve
        FROM main_staging.stg_fred_macro
        WHERE series_id IN ('MORTGAGE30US','T10Y2Y')
        GROUP BY year
    ) t
    LEFT JOIN LATERAL (
        SELECT NULL::DOUBLE AS mortgage_yoy_chg
    ) ON true
""").df()
# compute mortgage YoY change manually
fred = fred.sort_values('year')
fred['mortgage_yoy_chg'] = fred['mortgage_rate'].diff()
con.close()

uni['zori_fwd_ann'] = (1 + uni['zori_forward_return_36mo']) ** (1/3) - 1

# ── Compute national aggregate signals per year (PIT-observable) ──────────────
nat = uni.groupby('year').agg(
    national_hpi_yoy=('hpi_yoy', 'median'),
    national_zori_yoy=('zori_yoy', 'median'),
).reset_index()
nat = nat.merge(fred, on='year', how='left')

# ── Statistical regime detection — expanding-window z-scores ────────────────
# For each cohort year Y, compute z-score of each signal using ONLY data through Y.
# This is PIT-strict: no look-ahead.

def expanding_zscore(series, min_periods=4):
    """Compute expanding-window z-score using data through each point.
    Returns z-score at each date using mean/std of all data up to (but not including) that date.
    NaN for first min_periods observations."""
    out = pd.Series(index=series.index, dtype=float)
    for i in range(len(series)):
        window = series.iloc[:i]  # only PAST data
        window = window.dropna()
        if len(window) < min_periods:
            out.iloc[i] = np.nan
        else:
            mu, sigma = window.mean(), window.std()
            if sigma == 0:
                out.iloc[i] = 0.0
            else:
                out.iloc[i] = (series.iloc[i] - mu) / sigma
    return out

nat = nat.sort_values('year').reset_index(drop=True)
nat['z_hpi']      = expanding_zscore(nat['national_hpi_yoy'])
nat['z_zori']     = expanding_zscore(nat['national_zori_yoy'])
nat['z_mtg_chg']  = expanding_zscore(nat['mortgage_yoy_chg'])
# Yield curve inversion is a binary/level signal — use raw sign
nat['curve_inverted'] = (nat['yield_curve'] < 0).astype(int)

# ── Composite stress score ──────────────────────────────────────────────────
# High stress = trailing signals ARE mean-reverting soon.
# - High z_hpi (national HPI unusually hot) → mean reversion risk → +stress
# - High z_zori (rents unusually hot) → +stress
# - High z_mtg_chg (rate shock) → rents likely to cool → +stress
# - Curve inverted → recession lead → +stress
# ZORI z-score gets partial weight when available (short history)

def composite_stress(row):
    signals = []
    if pd.notna(row['z_hpi']):     signals.append(('hpi',      row['z_hpi'],     1.0))
    if pd.notna(row['z_zori']):    signals.append(('zori',     row['z_zori'],    1.0))
    if pd.notna(row['z_mtg_chg']): signals.append(('mtg_chg',  row['z_mtg_chg'], 0.7))
    curve_penalty = 0.5 if row['curve_inverted'] == 1 else 0.0
    if not signals: return np.nan
    total_w = sum(w for _, _, w in signals)
    weighted = sum(z * w for _, z, w in signals) / total_w
    return weighted + curve_penalty

nat['stress_score'] = nat.apply(composite_stress, axis=1)

# ── Map stress score to multiplier ──────────────────────────────────────────
# High positive stress = anomaly regime = discount trailing heavily
# Near zero = normal = trust trailing
# Negative stress = cycle bottom / accommodative = trust or slight boost
def stress_to_multiplier(s):
    if pd.isna(s): return 1.0   # no signal → don't adjust
    if s >  1.5: return 0.40    # deep discount — extreme anomaly
    if s >  0.5: return 0.70    # moderate discount
    if s > -0.5: return 1.00    # normal
    if s > -1.5: return 1.10    # slight boost — cycle bottom
    return 1.20                 # strong boost — deep cold

nat['multiplier'] = nat['stress_score'].apply(stress_to_multiplier)

print('=' * 130)
print(' PIT-strict national regime signals per cohort year (expanding-window z-scores)')
print('=' * 130)
print(nat[['year','national_hpi_yoy','national_zori_yoy','mortgage_rate','mortgage_yoy_chg','yield_curve',
          'z_hpi','z_zori','z_mtg_chg','curve_inverted','stress_score','multiplier']].to_string(
    index=False, float_format=lambda x: f'{x:+.3f}' if isinstance(x, float) else str(x)))

# ── Strategy implementations (same as before) ────────────────────────────────
def hc_v1_picks(year):
    c = uni[uni['year']==year].dropna(subset=['cap_rate_proxy']).sort_values('cap_rate_proxy', ascending=False)
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

print('\n\nRunning ELITE walk-forward for comparison...')
panel = load_tertiary_panel(pop_min=POP_MIN, pop_max=POP_MAX, hhi_max=HHI_MAX)
panel = panel.merge(build_acs_target(horizon_years=HORIZON_YEARS), on=['fips','period_end_date'], how='left')
panel = panel.merge(load_mf_context(), on='fips', how='left')
panel_fe, feat = build_feature_matrix(panel)
panel_z = zscore_within_cohort(panel_fe, feat)
elite_results = walk_forward(
    panel_z, panel_fe, feat,
    target_col=TARGET_COL_TOTAL_RETURN,
    top_n=TOP_N, max_per_state=MAX_PER_STATE, elite_top_pct=ELITE_TOP_PCT,
    strict_pit_targets=True,
)
def elite_picks(year):
    for r in elite_results:
        if r.test_year == year:
            base = r.top5.head(TOP_N)[['fips','county_name','state_name']].copy()
            return base.merge(uni[uni['year']==year][['fips','zori_yoy','zori_forward_return_36mo','zori_fwd_ann']],
                              on='fips', how='left')
    return pd.DataFrame()

STRATEGIES = [
    ('HC_v1', hc_v1_picks),
    ('HC_v4', hc_v4_picks),
    ('ELITE', elite_picks),
]

# ── Backtest: naive vs regime-adjusted projection ────────────────────────────
print('\n\n' + '=' * 140)
print(' NAIVE vs REGIME-ADJUSTED forward zori projection — validation on realized data')
print('=' * 140)

rows = []
for strat_name, pick_fn in STRATEGIES:
    for yr in range(2016, 2023):  # observable cohorts (need both trailing zori and 3yr forward)
        picks = pick_fn(yr)
        if picks.empty: continue
        multiplier = nat[nat['year']==yr]['multiplier'].iloc[0] if yr in nat['year'].values else 1.0
        for i, (_, r) in enumerate(picks.iterrows()):
            trailing = r.get('zori_yoy', np.nan)
            realized = r.get('zori_fwd_ann', np.nan)
            if pd.isna(trailing) or pd.isna(realized): continue
            naive_proj    = trailing
            adjusted_proj = trailing * multiplier
            rows.append({
                'strategy': strat_name,
                'year': yr,
                'multiplier': multiplier,
                'market': f"{r['county_name'].replace(' County','')}, {r['state_name'][:2]}",
                'trailing_zori':  trailing * 100,
                'naive_proj':     naive_proj * 100,
                'adj_proj':       adjusted_proj * 100,
                'realized_fwd':   realized * 100,
                'naive_error':    (naive_proj - realized) * 100,
                'adj_error':      (adjusted_proj - realized) * 100,
            })

df = pd.DataFrame(rows)

# Per-year per-strategy detail
for strat_name, _ in STRATEGIES:
    sub = df[df['strategy']==strat_name].copy()
    if sub.empty: continue
    print(f'\n╔══ {strat_name} ═══════════════════════════════════════════════════════════════════════════════════')
    display_cols = ['year','multiplier','market','trailing_zori','naive_proj','adj_proj','realized_fwd','naive_error','adj_error']
    print(sub[display_cols].to_string(index=False, float_format=lambda x: f'{x:+.2f}' if isinstance(x, float) else str(x)))

    # Aggregate error stats
    naive_mae   = sub['naive_error'].abs().mean()
    adj_mae     = sub['adj_error'].abs().mean()
    naive_bias  = sub['naive_error'].mean()
    adj_bias    = sub['adj_error'].mean()
    improved    = (sub['adj_error'].abs() < sub['naive_error'].abs()).sum()
    print(f'  Aggregate error stats ({len(sub)} picks):')
    print(f'    Naive     MAE: {naive_mae:.2f}pp   mean bias (proj-actual): {naive_bias:+.2f}pp')
    print(f'    Regime-adj MAE: {adj_mae:.2f}pp   mean bias (proj-actual): {adj_bias:+.2f}pp')
    print(f'    Regime-adj wins: {improved}/{len(sub)} picks   ({improved/len(sub)*100:.0f}%)')
    print(f'    MAE improvement: {naive_mae - adj_mae:+.2f}pp   ({(naive_mae - adj_mae)/naive_mae*100:+.1f}%)')

# Cross-strategy summary
print('\n\n' + '=' * 100)
print(' CROSS-STRATEGY SUMMARY (aggregated over all years)')
print('=' * 100)
summary = []
for strat_name, _ in STRATEGIES:
    sub = df[df['strategy']==strat_name]
    if sub.empty: continue
    summary.append({
        'strategy': strat_name,
        'n_picks': len(sub),
        'naive_MAE_pp':  sub['naive_error'].abs().mean(),
        'adj_MAE_pp':    sub['adj_error'].abs().mean(),
        'MAE_improve_pp': sub['naive_error'].abs().mean() - sub['adj_error'].abs().mean(),
        'adj_better_pct': (sub['adj_error'].abs() < sub['naive_error'].abs()).sum() / len(sub) * 100,
    })
print(pd.DataFrame(summary).to_string(index=False, float_format=lambda x: f'{x:.2f}' if isinstance(x, float) else str(x)))

# ─── ANTI-OVERFIT: per-year performance check ─────────────────────────────────
# Does regime adjustment help EVERY year, or just fits one or two big anomaly years?
# If gains are concentrated in 2021-2022 alone, the "improvement" is spurious.
print('\n\n' + '=' * 130)
print(' PER-YEAR ANTI-OVERFIT CHECK — did regime adjustment help in this specific year?')
print(' (Aggregated across all strategies for each cohort year)')
print('=' * 130)
year_rows = []
for yr in sorted(df['year'].unique()):
    sub = df[df['year']==yr]
    if sub.empty: continue
    m = nat[nat['year']==yr]['multiplier'].iloc[0] if yr in nat['year'].values else 1.0
    naive_mae = sub['naive_error'].abs().mean()
    adj_mae   = sub['adj_error'].abs().mean()
    improve_pp = naive_mae - adj_mae
    verdict = 'HELPED' if improve_pp > 0.5 else ('HURT' if improve_pp < -0.5 else 'NEUTRAL')
    year_rows.append({
        'year': yr,
        'multiplier': m,
        'n_picks': len(sub),
        'trailing_zori_avg': sub['trailing_zori'].mean(),
        'realized_fwd_avg':  sub['realized_fwd'].mean(),
        'naive_MAE_pp':  naive_mae,
        'adj_MAE_pp':    adj_mae,
        'MAE_delta_pp':  improve_pp,
        'verdict':       verdict,
    })
year_df = pd.DataFrame(year_rows)
print(year_df.to_string(index=False, float_format=lambda x: f'{x:+.2f}' if isinstance(x, float) else str(x)))

# Consistency check
n_helped  = (year_df['verdict']=='HELPED').sum()
n_hurt    = (year_df['verdict']=='HURT').sum()
n_neutral = (year_df['verdict']=='NEUTRAL').sum()
print()
print(f'Consistency: HELPED in {n_helped}/{len(year_df)} years, HURT in {n_hurt}/{len(year_df)}, NEUTRAL in {n_neutral}/{len(year_df)}')
print()
if n_helped >= len(year_df) - 1:
    print('  → Regime adjustment appears ROBUST — helps almost every year.')
elif n_helped > n_hurt + n_neutral:
    print('  → Regime adjustment appears MOSTLY HELPFUL but not universal.')
elif abs(n_helped - n_hurt) <= 1:
    print('  → Regime adjustment is INCONCLUSIVE — helps some years, hurts others.')
else:
    print('  → Regime adjustment is NOT reliable — likely overfitting to a few anomaly years.')

