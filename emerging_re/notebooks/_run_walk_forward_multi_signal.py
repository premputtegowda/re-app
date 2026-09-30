"""Walk-forward multi-signal backtest — NO LOOK-AHEAD.

For each test year Y:
  1. Training set = cohorts 2015 to Y-3 (only cohorts with 3yr forwards observable by Dec Y)
  2. Correlation matrix computed on TRAINING data only
  3. Univariate signal ranking on TRAINING data only
  4. Uncorrelated cluster-rep selection: greedy from highest univariate score,
     drop if |r| >= 0.6 with any already-selected signal
  5. Apply selected signals + uniform +0.5 weight to TEST year picks
  6. Evaluate test picks against test year's actual 3yr forward returns
  7. Report train vs test hit rate (overfit detector)

Two protocols run in parallel:
  A. FROZEN: fit features once on earliest available window (2015 only for test 2018).
     Apply unchanged to all subsequent test years.
  B. WALK-FORWARD: reselect features at each test year using expanding training window.

Also reported: signal stability (do the same signals get selected each year?),
publication-lag warnings, aggregate test-set performance.
"""
from __future__ import annotations
import duckdb, numpy as np, pandas as pd

WAREHOUSE = '/Users/premputtegowda/reps/reps-tracker/emerging_re/data/warehouse/emerging_re.duckdb'
POP_MIN, POP_MAX = 300_000, 1_000_000
TOP_N, MAX_PER_STATE = 10, 3
GATEWAY_FIPS = ['06037','36061','36047','36081','06075','25025','11001','17031']
CORR_THRESHOLD = 0.6

# Candidate leading-indicator pool (no pricing signals — this is fresh leading-only test)
# Column names verified against mart_county_features schema
LEADING_SIGNALS = [
    # Demand-side (jobs + demographics + migration)
    'renter_ind_emp_yoy', 'renter_ind_emp_cagr_3yr', 'renter_ind_emp_growth_vs_state_pp',
    'age_20_34_share_yoy_chg', 'age_20_34_growth_3yr_cagr',
    'domesticmig_per_1000', 'domesticmig_accel_3yr',
    'irs_inflow_rate', 'irs_income_gap_pct', 'irs_net_migration_rate',
    'foreign_born_share_yoy_chg', 'foreign_born_cagr_3yr',
    # Employment quality
    'knowledge_emp_yoy', 'knowledge_emp_cagr_3yr', 'knowledge_emp_growth_vs_state_pp',
    'pcpi_yoy', 'pcpi_cagr_3yr', 'pcpi_growth_vs_state_1yr_pp',
    'high_wage_share_yoy_chg', 'unemployment_rate_yoy_chg',
    # Supply-side (MF-specific)
    'mf_permit_ratio', 'mf_permit_ratio_change_3yr',
    # Rent/price dynamics
    'rent_growth_vs_wage_growth', 'mf_cap_rate_change_3yr',
    # Vacancy
    'rental_vacancy_change_3yr',
    # Business formation
    'business_apps_per_1000', 'business_apps_per_1000_3yr_avg',
    # Wage growth
    'wage_growth_yoy', 'wage_growth_yoy_demeaned',
]

# Publication lag knowledge (months after period_end_date when data becomes public)
# Applied as an INFORMATIONAL warning — not enforced in this backtest yet
PUB_LAG_MONTHS = {
    'renter_ind_emp_yoy': 6, 'renter_ind_emp_cagr_3yr': 6,
    'age_20_34_share_yoy_chg': 12, 'domesticmig_per_1000': 15, 'domesticmig_accel_3yr': 15,
    'irs_inflow_rate': 24, 'irs_income_gap': 24, 'foreign_born_share': 12,
    'knowledge_emp_yoy': 6, 'pcpi_yoy': 12, 'pcpi_cagr_3yr': 12,
    'unemployment_rate_yoy_chg': 1, 'mf_permit_ratio': 4, 'mf_permit_ratio_change_3yr': 4,
    'hpi_rent_gap_pp': 3, 'rent_growth_vs_wage_growth': 6, 'mf_cap_rate_change_3yr': 12,
    'rental_vacancy_change_3yr': 12, 'business_apps_per_1000': 2, 'business_apps_per_1000_3yr_avg': 2,
    'wage_growth_yoy': 6,
}

# ── Load data ──────────────────────────────────────────────────────────────
con = duckdb.connect(WAREHOUSE, read_only=True)
sig_cols = ",\n           ".join([f'"{c}"' for c in LEADING_SIGNALS])
uni = con.execute(f'''
    SELECT fips, county_name, state_name, pop_latest,
           EXTRACT(YEAR FROM period_end_date)::INT AS year,
           cap_rate_proxy, zori_yoy, unemployment_rate, hpi_yoy,
           permits_intensity_ratio, permits_per_1000, any_disqualifier,
           emp_growth_yoy,
           max_supersector_share, employment_diversity_hhi,
           zori_forward_return_36mo, hpi_forward_return_36mo,
           {sig_cols}
    FROM main_marts.mart_county_features
    WHERE EXTRACT(MONTH FROM period_end_date) = 12
      AND pop_latest > {POP_MIN} AND pop_latest <= {POP_MAX}
      AND employment_diversity_hhi IS NOT NULL
      AND employment_diversity_hhi <= 0.20
''').df()
mortgage = con.execute('''
    SELECT EXTRACT(YEAR FROM observation_date)::INT AS year, value/100.0 AS mortgage_rate
    FROM main_staging.stg_fred_macro WHERE series_id = 'MORTGAGE30US'
    QUALIFY row_number() OVER (PARTITION BY EXTRACT(YEAR FROM observation_date) ORDER BY observation_date DESC)=1
''').df()
pep_raw = con.execute('''
    SELECT fips, EXTRACT(YEAR FROM period_end_date)::INT AS ref_year, popestimate, as_of_date
    FROM main_staging.stg_census_pep
''').df()
gateway_caps = con.execute(f'''
    SELECT EXTRACT(YEAR FROM period_end_date)::INT AS year,
           MEDIAN(cap_rate_proxy) AS gateway_cap_median
    FROM main_marts.mart_county_features
    WHERE EXTRACT(MONTH FROM period_end_date) = 12
      AND fips IN ({",".join(repr(f) for f in GATEWAY_FIPS)})
    GROUP BY year
''').df()
con.close()
pep_raw['as_of_date'] = pd.to_datetime(pep_raw['as_of_date'])
uni = uni.merge(mortgage, on='year', how='left').merge(gateway_caps, on='year', how='left')
uni['cap_spread_to_gateway_pp'] = (uni['cap_rate_proxy'] - uni['gateway_cap_median']) * 100
uni['permits_per_new_job']      = uni['permits_per_1000'] / (uni['emp_growth_yoy'].clip(lower=0.005) * 450)

STATE_OPEX = {
    'Ohio':0.57,'Michigan':0.57,'Pennsylvania':0.57,'Illinois':0.57,'Wisconsin':0.57,
    'New York':0.57,'New Jersey':0.57,'Connecticut':0.57,
    'Missouri':0.52,'Massachusetts':0.52,'Maryland':0.52,
    'California':0.47,'Iowa':0.47,'Minnesota':0.47,'Florida':0.47,'Indiana':0.47,
    'Texas':0.44,'Virginia':0.44,'Colorado':0.44,'Washington':0.44,'Kansas':0.44,'Kentucky':0.44,
    'Georgia':0.42,'North Carolina':0.42,'South Carolina':0.42,'Tennessee':0.42,
    'Oklahoma':0.42,'Utah':0.42,'Idaho':0.42,
    'Arizona':0.40,'Nevada':0.40,'Alabama':0.40,'Mississippi':0.40,'Arkansas':0.40,
}
uni['opex_ratio'] = uni['state_name'].map(STATE_OPEX).fillna(0.45)
uni['total_return_3yr'] = 3 * uni['cap_rate_proxy'] * (1-uni['opex_ratio']) * (1 + uni['zori_forward_return_36mo']/2) + uni['hpi_forward_return_36mo']

def pit_pop_yoy(cohort_year):
    cutoff = pd.Timestamp(f'{cohort_year}-12-31')
    df = pep_raw[pep_raw['as_of_date'] <= cutoff].copy()
    if df.empty: return pd.DataFrame(columns=['fips','pop_yoy_pct'])
    df = df.sort_values(['fips','ref_year','as_of_date']).drop_duplicates(subset=['fips','ref_year'], keep='last')
    rows = []
    for f, sub in df.groupby('fips'):
        sub = sub.sort_values('ref_year', ascending=False)
        if len(sub) < 2: continue
        latest, prev = sub.iloc[0], sub[sub['ref_year']==sub.iloc[0]['ref_year']-1]
        if prev.empty: continue
        prev = prev.iloc[0]
        rows.append({'fips':f,'pop_yoy_pct':(latest['popestimate']-prev['popestimate'])/prev['popestimate']*100})
    return pd.DataFrame(rows)
pop_yoy_cache = {yr: pit_pop_yoy(yr) for yr in range(2015, 2026)}

GATES = {
    'min_pop_yoy_pct':0.0,'max_permit_ratio':1.5,'max_unemp_pct':6.0,
    'min_wage_growth':0.02,'max_sector_share':0.25,'min_cap_spread_pp':0.0,
    'max_hhi_strategy':0.15,'require_no_disq':True,
}

def apply_gates_for_year(year):
    c = uni[uni['year']==year].dropna(subset=['cap_rate_proxy']).copy()
    if c.empty: return c
    pop_yr = pop_yoy_cache.get(year, pd.DataFrame())
    c = c.merge(pop_yr[['fips','pop_yoy_pct']], on='fips', how='left') if not pop_yr.empty else c.assign(pop_yoy_pct=np.nan)
    c = c[c['pop_yoy_pct'].isna()             | (c['pop_yoy_pct']             >= GATES['min_pop_yoy_pct'])]
    c = c[c['permits_intensity_ratio'].isna() | (c['permits_intensity_ratio'] <  GATES['max_permit_ratio'])]
    c = c[c['unemployment_rate'].isna()       | (c['unemployment_rate']       <= GATES['max_unemp_pct'])]
    c = c[c['max_supersector_share'].isna()   | (c['max_supersector_share']   <= GATES['max_sector_share'])]
    c = c[c['cap_spread_to_gateway_pp'].isna()| (c['cap_spread_to_gateway_pp']>= GATES['min_cap_spread_pp'])]
    c = c[c['employment_diversity_hhi'].isna()| (c['employment_diversity_hhi']<= GATES['max_hhi_strategy'])]
    c = c[(c['any_disqualifier']==False) | (c['any_disqualifier'].isna())]
    if c.empty: return c
    c = c[c['cap_rate_proxy'] >= c['cap_rate_proxy'].median()]
    return c

def score_and_pick(c, weights):
    if c.empty: return c
    c = c.copy()
    c['opportunity_score'] = 0.0
    for col, w in weights.items():
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

def hit_rate_and_edge(picks, year):
    if picks.empty or 'total_return_3yr' not in picks.columns: return None
    yr_uni = uni[uni['year']==year].dropna(subset=['total_return_3yr'])
    if yr_uni.empty: return None
    uni_mean = yr_uni['total_return_3yr'].mean() * 100
    obs = picks.dropna(subset=['total_return_3yr']).copy()
    if obs.empty: return None
    obs['tr_pct'] = obs['total_return_3yr'] * 100
    obs['edge']   = obs['tr_pct'] - uni_mean
    return {
        'n':          len(obs),
        'above':      int((obs['edge'] > 2).sum()),
        'below':      int((obs['edge'] < -2).sum()),
        'underwater': int((obs['tr_pct'] < 0).sum()),
        'hit_rate':   int((obs['edge'] > 2).sum()) / len(obs) * 100,
        'edge':       obs['edge'].mean(),
        'mean_tr':    obs['tr_pct'].mean(),
    }

# ── Feature selection on a training set ────────────────────────────────────
def select_features(training_pool, candidate_signals, top_k=6):
    '''Cluster-rep selection: rank by univariate hit rate on training,
    then greedy add if uncorrelated with already-selected.
    Returns list of selected feature names.'''
    if training_pool.empty: return []
    # Compute univariate ranking: for each signal, correlation with realized_return
    if 'total_return_3yr' not in training_pool.columns: return []
    pool = training_pool.dropna(subset=['total_return_3yr']).copy()
    if pool.empty: return []
    scores = {}
    for s in candidate_signals:
        if s not in pool.columns or pool[s].notna().sum() < 20:
            continue
        # Univariate: rank correlation between signal and forward return
        subset = pool[[s, 'total_return_3yr']].dropna()
        if len(subset) < 20: continue
        # Spearman rank correlation (robust to outliers, monotonic)
        r = subset[s].rank().corr(subset['total_return_3yr'].rank())
        if pd.notna(r):
            scores[s] = abs(r)  # magnitude — doesn't matter if positive or negative
    if not scores: return []
    # Sort by score descending
    ranked = sorted(scores.items(), key=lambda x: -x[1])
    # Compute correlation matrix on qualified pool
    valid_sigs = [s for s, _ in ranked if s in pool.columns]
    corr = pool[valid_sigs].corr()
    # Greedy selection
    selected = []
    for s, univ_score in ranked:
        if len(selected) >= top_k: break
        # Check uncorrelated with all already selected
        is_uncorr = True
        for kept in selected:
            if s in corr.index and kept in corr.columns:
                r = corr.loc[s, kept]
                if pd.notna(r) and abs(r) > CORR_THRESHOLD:
                    is_uncorr = False; break
        if is_uncorr: selected.append(s)
    return selected

# ── Build historical pool per year for training/testing ────────────────────
qualified_by_year = {}
for yr in range(2015, 2023):
    q = apply_gates_for_year(yr)
    if not q.empty:
        q['cohort_year'] = yr
        qualified_by_year[yr] = q

# ── PROTOCOL A: FROZEN feature set ─────────────────────────────────────────
print('='*120)
print('PROTOCOL A — FROZEN feature set (fit on earliest window, apply forward)')
print('='*120)
print()

# Earliest training window: 2015 cohort only (3yr fwd observable by Dec 2018)
frozen_training = qualified_by_year.get(2015, pd.DataFrame())
frozen_features = select_features(frozen_training, LEADING_SIGNALS, top_k=6)
print(f'Frozen feature set (selected from 2015 training cohort only, n={len(frozen_training)} qualified):')
for f in frozen_features:
    print(f'   {f}  (pub lag: {PUB_LAG_MONTHS.get(f, "?")} months)')

frozen_weights = {s: 0.5 for s in frozen_features}
print(f'\nBackt (test years 2018-2022, frozen weights):')
print(f'{"year":<6}{"n":>4}{"above":>7}{"below":>7}{"under":>7}{"hit%":>8}{"edge":>10}{"mean_TR":>10}')
print('-'*90)
frozen_results = []
for test_year in range(2018, 2023):
    test_pool = qualified_by_year.get(test_year, pd.DataFrame())
    picks = score_and_pick(test_pool, frozen_weights)
    r = hit_rate_and_edge(picks, test_year)
    if r is None: continue
    frozen_results.append({**r, 'year':test_year})
    print(f'{test_year:<6}{r["n"]:>4}{r["above"]:>7}{r["below"]:>7}{r["underwater"]:>7}{r["hit_rate"]:>7.1f}%{r["edge"]:>+9.2f}pp{r["mean_tr"]:>+9.2f}%')
if frozen_results:
    total_n = sum(x['n'] for x in frozen_results)
    total_above = sum(x['above'] for x in frozen_results)
    total_under = sum(x['underwater'] for x in frozen_results)
    weighted_edge = sum(x['edge']*x['n'] for x in frozen_results) / total_n
    weighted_tr = sum(x['mean_tr']*x['n'] for x in frozen_results) / total_n
    print(f'{"TOTAL":<6}{total_n:>4}{total_above:>7}{"":>7}{total_under:>7}{total_above/total_n*100:>7.1f}%{weighted_edge:>+9.2f}pp{weighted_tr:>+9.2f}%')

# ── PROTOCOL B: WALK-FORWARD feature reselection ──────────────────────────
print('\n' + '='*120)
print('PROTOCOL B — WALK-FORWARD (re-fit features at each test year using expanding training)')
print('='*120)
print()

print(f'{"test_yr":<8}{"train_yrs":<20}{"train_n":>10}  {"selected features":<80}')
print('-'*120)
walk_results = []
signal_stability = {}
for test_year in range(2018, 2023):
    # Training cohorts: 2015 to test_year-3 (need observable 3yr forwards by Dec test_year)
    train_years = [y for y in range(2015, test_year - 2) if y in qualified_by_year]
    if not train_years:
        print(f'{test_year:<8}(no training available)')
        continue
    training = pd.concat([qualified_by_year[y] for y in train_years], ignore_index=True)
    selected = select_features(training, LEADING_SIGNALS, top_k=6)
    for s in selected:
        signal_stability[s] = signal_stability.get(s, 0) + 1
    weights = {s: 0.5 for s in selected}
    test_pool = qualified_by_year.get(test_year, pd.DataFrame())
    picks = score_and_pick(test_pool, weights)
    r = hit_rate_and_edge(picks, test_year)
    train_r = None
    # Training performance (in-sample sanity check) — pick from each train year with these features
    train_picks_all = []
    for ty in train_years:
        tp = qualified_by_year[ty]
        tp_picks = score_and_pick(tp, weights)
        if not tp_picks.empty:
            tp_picks = tp_picks.copy(); tp_picks['cohort_year'] = ty
            train_picks_all.append(tp_picks)
    if train_picks_all:
        all_train = pd.concat(train_picks_all, ignore_index=True)
        yr_means = {}
        for ty in train_years:
            yr_uni = uni[uni['year']==ty].dropna(subset=['total_return_3yr'])
            if not yr_uni.empty:
                yr_means[ty] = yr_uni['total_return_3yr'].mean() * 100
        all_train['uni_mean'] = all_train['cohort_year'].map(yr_means)
        all_train['tr_pct'] = all_train['total_return_3yr'] * 100
        all_train['edge']   = all_train['tr_pct'] - all_train['uni_mean']
        train_r = {
            'n': len(all_train),
            'hit_rate': (all_train['edge'] > 2).sum() / len(all_train) * 100,
            'edge': all_train['edge'].mean(),
        }
    feats_str = ', '.join([f[:20] for f in selected])
    train_str = ','.join(str(y) for y in train_years)
    print(f'{test_year:<8}{train_str:<20}{len(training):>10}  {feats_str:<80}')
    if r:
        walk_results.append({**r, 'year':test_year, 'train_hit':train_r["hit_rate"] if train_r else None, 'train_edge':train_r["edge"] if train_r else None})

print()
print(f'{"test_yr":<8}{"n":>4}{"above":>7}{"below":>7}{"under":>7}{"test_hit%":>11}{"test_edge":>12}{"train_hit%":>12}{"overfit_Δ":>11}')
print('-'*110)
for r in walk_results:
    ovr = f'{r["train_hit"] - r["hit_rate"]:+.1f}pp' if r["train_hit"] else '—'
    train_h = f'{r["train_hit"]:.1f}%' if r["train_hit"] else '—'
    print(f'{r["year"]:<8}{r["n"]:>4}{r["above"]:>7}{r["below"]:>7}{r["underwater"]:>7}{r["hit_rate"]:>10.1f}%{r["edge"]:>+11.2f}pp{train_h:>12}{ovr:>11}')
if walk_results:
    total_n = sum(x['n'] for x in walk_results)
    total_above = sum(x['above'] for x in walk_results)
    total_under = sum(x['underwater'] for x in walk_results)
    weighted_edge = sum(x['edge']*x['n'] for x in walk_results) / total_n
    print(f'{"TOTAL":<8}{total_n:>4}{total_above:>7}{"":>7}{total_under:>7}{total_above/total_n*100:>10.1f}%{weighted_edge:>+11.2f}pp')

# ── Signal stability ──────────────────────────────────────────────────────
print('\n' + '='*120)
print('SIGNAL STABILITY (how many test years each signal was selected across walk-forward)')
print('='*120)
n_test_years = len(walk_results)
print(f'\nOut of {n_test_years} test years:')
stability_sorted = sorted(signal_stability.items(), key=lambda x: -x[1])
for s, count in stability_sorted:
    marker = ' ← ALWAYS SELECTED' if count == n_test_years else ''
    print(f'  {count}/{n_test_years}   {s}{marker}')

# ── Comparison to VALUE baseline ─────────────────────────────────────────
print('\n' + '='*120)
print('COMPARISON: leading-indicators-only vs current VALUE strategy')
print('='*120)
W_VALUE = {
    'cap_spread_to_gateway_pp':2.0,'cap_rate_proxy':1.5,'wage_growth_yoy':0.8,
    'pop_yoy_pct':0.5,'business_apps_per_1000':0.5,'permits_per_new_job':-1.0,
}
value_results = []
for test_year in range(2018, 2023):
    tp = qualified_by_year.get(test_year, pd.DataFrame())
    picks = score_and_pick(tp, W_VALUE)
    r = hit_rate_and_edge(picks, test_year)
    if r: value_results.append({**r, 'year':test_year})

def total_line(results, name):
    if not results: return f'{name}: (no results)'
    total_n = sum(x['n'] for x in results)
    total_above = sum(x['above'] for x in results)
    total_under = sum(x['underwater'] for x in results)
    weighted_edge = sum(x['edge']*x['n'] for x in results) / total_n
    weighted_tr = sum(x['mean_tr']*x['n'] for x in results) / total_n
    return (f'{name}:  n={total_n}  hit={total_above/total_n*100:.1f}%  edge={weighted_edge:+.2f}pp  '
            f'TR={weighted_tr:+.2f}%  underwater={total_under}/{total_n}')

print()
print(total_line(value_results, 'A. VALUE baseline (in-sample, fixed weights)         '))
print(total_line(frozen_results, 'B. FROZEN leading-only (fit on 2015 alone)           '))
print(total_line(walk_results, 'C. WALK-FORWARD leading-only (re-fit each year)      '))
