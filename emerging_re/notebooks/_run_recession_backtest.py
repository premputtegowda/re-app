"""Recession-era backtest — 2007-2010 cohorts using reduced-feature LEADING strategy.

Data constraints:
- No cap_rate_proxy pre-2015 → VALUE strategy can't run
- No ZORI pre-2015 → no cash flow / total return calc
- Only HPI-based appreciation returns available for measurement

Reduced strategy uses employment/wage/demographic signals available pre-2015:
- Gates: HHI, wage_growth, unemployment
- Score: wage_growth, renter_ind_emp, emp_growth, unemp_change

Cohorts tested:
- 2007 (peak) — forward 3yr = 2007→2010 (worst crash)
- 2008 (crisis onset) — forward 3yr = 2008→2011 (deep contraction)
- 2009 (bottom) — forward 3yr = 2009→2012 (recovery beginning)
- 2010 (early recovery) — forward 3yr = 2010→2013 (recovery)
- Compare to 2015 (post-recovery benchmark)
"""
from __future__ import annotations
import duckdb, numpy as np, pandas as pd

WAREHOUSE = '/Users/premputtegowda/reps/reps-tracker/emerging_re/data/warehouse/emerging_re.duckdb'
POP_MIN, POP_MAX = 300_000, 1_000_000
TOP_N, MAX_PER_STATE = 10, 3

con = duckdb.connect(WAREHOUSE, read_only=True)
# Load 2005-2015 universe with pre-2015-available features
uni = con.execute(f'''
    SELECT fips, county_name, state_name, pop_latest,
           EXTRACT(YEAR FROM period_end_date)::INT AS year,
           hpi_yoy, hpi_forward_return_36mo,
           unemployment_rate, unemployment_rate_yoy_chg,
           wage_growth_yoy, emp_growth_yoy,
           renter_ind_emp_yoy, renter_ind_emp_cagr_3yr,
           employment_diversity_hhi, max_supersector_share,
           mf_permit_ratio, mf_permit_ratio_change_3yr,
           business_apps_per_1000, domesticmig_per_1000,
           any_disqualifier
    FROM main_marts.mart_county_features
    WHERE EXTRACT(MONTH FROM period_end_date) = 12
      AND EXTRACT(YEAR FROM period_end_date) BETWEEN 2005 AND 2015
      AND pop_latest > {POP_MIN} AND pop_latest <= {POP_MAX}
      AND employment_diversity_hhi IS NOT NULL
      AND employment_diversity_hhi <= 0.20
''').df()
con.close()

# Reduced LEADING weights — only signals available pre-2015
W_RECESSION = {
    'wage_growth_yoy':           0.8,
    'renter_ind_emp_yoy':        0.5,
    'emp_growth_yoy':            0.5,
    'unemployment_rate_yoy_chg': -0.5,   # negative = falling unemp = good
    'mf_permit_ratio_change_3yr': -0.3,   # inverted (excess supply is bad)
}

# Gates — no cap-rate median filter (not available pre-2015)
GATES = {
    'max_unemp_pct':      6.0,     # cap unemployment at 6% at PICK time
    'min_wage_growth':    0.02,    # 2%/yr wage growth minimum
    'max_sector_share':   0.25,    # sector diversification
    'max_hhi':            0.15,    # employment diversity
    'require_no_disq':    True,
}

def pick_for_year(year, weights, gates=GATES):
    c = uni[uni['year']==year].copy()
    if c.empty: return pd.DataFrame()
    # Gates
    c = c[c['unemployment_rate'].isna()       | (c['unemployment_rate']       <= gates['max_unemp_pct'])]
    c = c[c['wage_growth_yoy'].isna()         | (c['wage_growth_yoy']         >= gates['min_wage_growth'])]
    c = c[c['max_supersector_share'].isna()   | (c['max_supersector_share']   <= gates['max_sector_share'])]
    c = c[c['employment_diversity_hhi'].isna()| (c['employment_diversity_hhi']<= gates['max_hhi'])]
    if gates['require_no_disq']:
        c = c[(c['any_disqualifier']==False) | (c['any_disqualifier'].isna())]
    if c.empty: return pd.DataFrame()
    # Score
    c['score'] = 0.0
    for col, w in weights.items():
        if col in c.columns and c[col].notna().any():
            mu, sig = c[col].mean(), c[col].std()
            if sig > 0:
                z = (c[col] - mu) / sig
                c['score'] = c['score'] + w * z.fillna(0)
    c = c.sort_values('score', ascending=False)
    picked, sc = [], {}
    for _, r in c.iterrows():
        if sc.get(r['state_name'], 0) >= MAX_PER_STATE: continue
        picked.append(r); sc[r['state_name']] = sc.get(r['state_name'], 0) + 1
        if len(picked) >= TOP_N: break
    return pd.DataFrame(picked) if picked else pd.DataFrame()

# ── Print regime context per year ──────────────────────────────────────────
print('='*130)
print('RECESSION-ERA BACKTEST — reduced-feature LEADING strategy')
print('='*130)
print()
print('CONTEXT: what was happening nationally in each cohort year?')
print(f'{"cohort":<10}{"pick date":<12}{"forward period":<18}{"national HPI change (universe median)":<45}{"regime context"}')
print('-'*130)
for yr in [2007, 2008, 2009, 2010, 2011, 2012, 2013, 2015]:
    yr_data = uni[uni['year']==yr]
    if yr_data.empty: continue
    fwd_median = yr_data['hpi_forward_return_36mo'].median() * 100 if yr_data['hpi_forward_return_36mo'].notna().any() else np.nan
    contexts = {
        2007: 'CYCLE TOP — housing bubble peak, curve inverted',
        2008: 'CRISIS ONSET — Lehman Sept, financial contagion',
        2009: 'CYCLE BOTTOM — max stress, unemployment 10%',
        2010: 'CONTRACTION → recovery — HPI still falling',
        2011: 'Euro crisis, sustained recovery slow',
        2012: 'Housing PRICE BOTTOM (Case-Shiller Feb 2012)',
        2013: 'Recovery consolidating',
        2015: 'MID CYCLE — expansion',
    }
    fwd_str = f'{fwd_median:+.2f}% (annualized {(((1+fwd_median/100)**(1/3))-1)*100:+.2f}%/yr)' if pd.notna(fwd_median) else 'n/a'
    print(f'{yr:<10}Dec {yr:<8}{f"{yr+1}-{yr+3} HPI":<18}{fwd_str:<45}{contexts.get(yr, "")}')

# ── Run backtest for each recession cohort year ────────────────────────────
def evaluate_picks(picks, year):
    if picks.empty: return None
    yr_uni = uni[uni['year']==year].dropna(subset=['hpi_forward_return_36mo'])
    if yr_uni.empty: return None
    uni_mean = yr_uni['hpi_forward_return_36mo'].mean() * 100
    uni_median = yr_uni['hpi_forward_return_36mo'].median() * 100
    obs = picks.dropna(subset=['hpi_forward_return_36mo']).copy()
    if obs.empty: return None
    obs['hpi_pct'] = obs['hpi_forward_return_36mo'] * 100
    obs['edge']    = obs['hpi_pct'] - uni_mean
    return {
        'year':        year,
        'n':           len(obs),
        'above':       int((obs['edge'] > 2).sum()),
        'below':       int((obs['edge'] < -2).sum()),
        'underwater':  int((obs['hpi_pct'] < 0).sum()),
        'hit_rate':    int((obs['edge'] > 2).sum()) / len(obs) * 100,
        'edge':        obs['edge'].mean(),
        'mean_hpi':    obs['hpi_pct'].mean(),
        'uni_mean':    uni_mean,
        'uni_median':  uni_median,
        'best':        obs['hpi_pct'].max(),
        'worst':       obs['hpi_pct'].min(),
        'best_market': f"{obs.loc[obs['hpi_pct'].idxmax(),'county_name']}, {obs.loc[obs['hpi_pct'].idxmax(),'state_name']}",
        'worst_market':f"{obs.loc[obs['hpi_pct'].idxmin(),'county_name']}, {obs.loc[obs['hpi_pct'].idxmin(),'state_name']}",
    }

print('\n' + '='*130)
print('PER-YEAR RESULTS (HPI-only 3yr appreciation, no cash flow)')
print('='*130)
print(f'\n{"year":<6}{"n":>4}{"above":>7}{"below":>7}{"under":>7}{"hit%":>8}{"edge":>10}{"mean HPI":>11}{"uni mean":>11}{"best":>10}{"worst":>10}')
print('-'*130)
all_stats = []
for yr in [2007, 2008, 2009, 2010, 2011, 2012, 2013, 2015]:
    picks = pick_for_year(yr, W_RECESSION)
    if picks.empty:
        print(f'{yr:<6}(no picks — gates likely eliminated all)')
        continue
    r = evaluate_picks(picks, yr)
    if r is None: continue
    all_stats.append(r)
    print(f'{yr:<6}{r["n"]:>4}{r["above"]:>7}{r["below"]:>7}{r["underwater"]:>7}{r["hit_rate"]:>7.1f}%{r["edge"]:>+9.2f}pp{r["mean_hpi"]:>+10.2f}%{r["uni_mean"]:>+10.2f}%{r["best"]:>+9.2f}%{r["worst"]:>+9.2f}%')

# ── Detailed picks for recession years ─────────────────────────────────────
for yr in [2007, 2008, 2009]:
    picks = pick_for_year(yr, W_RECESSION)
    if picks.empty: continue
    print(f'\n── {yr} PICKS DETAIL ──')
    obs = picks.dropna(subset=['hpi_forward_return_36mo']).copy()
    obs['hpi_pct'] = obs['hpi_forward_return_36mo'] * 100
    yr_uni = uni[uni['year']==yr].dropna(subset=['hpi_forward_return_36mo'])
    uni_mean = yr_uni['hpi_forward_return_36mo'].mean() * 100
    obs['edge'] = obs['hpi_pct'] - uni_mean
    for i, r in obs.reset_index(drop=True).iterrows():
        name = f"{r['county_name'].replace(' County','')}, {r['state_name']}"
        verdict = 'ABOVE AVG' if r['edge']>2 else 'BELOW AVG' if r['edge']<-2 else 'AVG'
        underwater = ' 💧' if r['hpi_pct'] < 0 else ''
        print(f'  #{i+1:<2} {name:<32}  3yr HPI: {r["hpi_pct"]:>+7.2f}%  edge: {r["edge"]:>+6.2f}pp  {verdict}{underwater}')

# ── Aggregate stats across recession vs recovery ───────────────────────────
def bucket_agg(stats, label):
    if not stats: return
    n = sum(x['n'] for x in stats)
    above = sum(x['above'] for x in stats)
    under = sum(x['underwater'] for x in stats)
    edge = sum(x['edge']*x['n'] for x in stats) / n
    mean_hpi = sum(x['mean_hpi']*x['n'] for x in stats) / n
    uni_mean = sum(x['uni_mean']*x['n'] for x in stats) / n
    print(f'  {label:<40}  n={n:<4}  above={above}/{n} ({above/n*100:.0f}%)  under={under}/{n} ({under/n*100:.0f}%)  edge={edge:+.2f}pp  mean_HPI={mean_hpi:+.2f}%  uni_mean={uni_mean:+.2f}%')

recession_stats = [s for s in all_stats if s['year'] in [2007, 2008, 2009, 2010]]
recovery_stats = [s for s in all_stats if s['year'] in [2011, 2012, 2013]]
recent_stats = [s for s in all_stats if s['year'] == 2015]

print('\n' + '='*130)
print('AGGREGATE — recession vs recovery')
print('='*130)
print()
bucket_agg(recession_stats, 'RECESSION cohorts (2007-2010)')
bucket_agg(recovery_stats,  'EARLY RECOVERY cohorts (2011-2013)')
bucket_agg(recent_stats,    'BENCHMARK 2015 cohort')
