"""Tier 2 — Add 3 new FRED macro signals to the regime detector, test accuracy.

New signals (all free from FRED):
  1. JTSJOL         — Job Openings Total (leading employment, 2000+)
  2. DRCLACBS       — Delinquency Rate on CRE Loans, All Commercial Banks (distress, 1991+)
  3. BAA10Y         — Moody's BAA corporate bond yield vs 10Y Treasury (credit spread)

Compare regime detector accuracy: baseline (5 signals) vs expanded (8 signals).
Test whether the additions materially improve regime prediction of 3yr forward HPI.
"""
from __future__ import annotations
import duckdb, numpy as np, pandas as pd
from io import StringIO
import urllib.request

WAREHOUSE = '/Users/premputtegowda/reps/reps-tracker/emerging_re/data/warehouse/emerging_re.duckdb'

# ── Load existing FRED signals + national HPI ─────────────────────────────
con = duckdb.connect(WAREHOUSE, read_only=True)
fred = con.execute('''
    SELECT year,
        MAX(CASE WHEN series_id='UNRATE' THEN value END) AS unemp,
        MAX(CASE WHEN series_id='CPIAUCSL' THEN value END) AS cpi_lvl,
        MAX(CASE WHEN series_id='FEDFUNDS' THEN value END) AS fed_funds,
        MAX(CASE WHEN series_id='T10Y2Y' THEN value END) AS yield_curve
    FROM (
        SELECT series_id, EXTRACT(YEAR FROM observation_date)::INT AS year, value,
               row_number() OVER (PARTITION BY series_id, EXTRACT(YEAR FROM observation_date) ORDER BY observation_date DESC) AS rn
        FROM main_staging.stg_fred_macro WHERE series_id IN ('UNRATE','CPIAUCSL','FEDFUNDS','T10Y2Y')
    ) WHERE rn=1 GROUP BY year ORDER BY year
''').df()
hpi = con.execute('''
    WITH hpi_dec AS (
        SELECT fips, EXTRACT(YEAR FROM period_end_date)::INT AS year, hpi
        FROM main_staging.stg_fhfa_hpi
        QUALIFY row_number() OVER (PARTITION BY fips, EXTRACT(YEAR FROM period_end_date) ORDER BY as_of_date DESC)=1
    ),
    hpi_yoy AS (
        SELECT c.year, c.hpi/p.hpi - 1 AS yoy
        FROM hpi_dec c JOIN hpi_dec p ON p.fips=c.fips AND p.year=c.year-1
        WHERE p.hpi>0
    )
    SELECT year, MEDIAN(yoy) as hpi_yoy FROM hpi_yoy GROUP BY year ORDER BY year
''').df()
con.close()

# ── Download NEW FRED series (direct CSV, no API key) ─────────────────────
def fetch_fred(series_id):
    url = f'https://fred.stlouisfed.org/graph/fredgraph.csv?id={series_id}'
    try:
        req = urllib.request.Request(url, headers={'User-Agent':'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = resp.read().decode('utf-8')
        df = pd.read_csv(StringIO(data))
        df.columns = ['date', 'value']
        df['date'] = pd.to_datetime(df['date'])
        df['value'] = pd.to_numeric(df['value'], errors='coerce')
        df = df.dropna(subset=['value'])
        return df
    except Exception as e:
        print(f'  ERROR fetching {series_id}: {e}')
        return pd.DataFrame(columns=['date','value'])

print('Downloading Tier 2 FRED series...')
new_series = {}
for sid in ['JTSJOL', 'DRCLACBS', 'BAA10Y']:
    df = fetch_fred(sid)
    if df.empty: continue
    df['year'] = df['date'].dt.year
    # Take last observation of each year
    annual = df.sort_values('date').groupby('year').tail(1).set_index('year')['value'].to_dict()
    new_series[sid] = annual
    print(f'  {sid}: {len(annual)} annual observations ({min(annual.keys())}-{max(annual.keys())})')

# ── Merge into regime dataframe ────────────────────────────────────────────
regime = fred.merge(hpi, on='year', how='inner').sort_values('year').reset_index(drop=True)
regime['cpi_yoy']         = regime['cpi_lvl'].pct_change() * 100
regime['unemp_yoy_chg']   = regime['unemp'].diff()
regime['real_fed_funds']  = regime['fed_funds'] - regime['cpi_yoy']
regime['curve_inverted']  = (regime['yield_curve'] < 0).astype(int)

for sid in new_series:
    regime[f'{sid.lower()}'] = regime['year'].map(new_series[sid])
# For JTSJOL and DRCLACBS: convert to YoY change
if 'jtsjol' in regime.columns:
    regime['job_openings_yoy_chg'] = regime['jtsjol'].pct_change() * 100
if 'drclacbs' in regime.columns:
    regime['cre_delinq_yoy_chg'] = regime['drclacbs'].diff()

# ── Expanding z-scores (PIT-strict) ───────────────────────────────────────
def _expand_z(series, min_periods=10):
    out = pd.Series(index=series.index, dtype=float)
    for i in range(len(series)):
        w = series.iloc[:i].dropna()
        if len(w) < min_periods: out.iloc[i] = np.nan
        else:
            mu, sig = w.mean(), w.std()
            out.iloc[i] = (series.iloc[i] - mu) / sig if sig > 0 else 0.0
    return out

for col in ['hpi_yoy','unemp_yoy_chg','cpi_yoy','real_fed_funds','job_openings_yoy_chg','cre_delinq_yoy_chg','baa10y']:
    if col in regime.columns:
        regime[f'z_{col}'] = _expand_z(regime[col])

# ── Voting: baseline (5 signals) vs expanded (8 signals) ──────────────────
def vote_baseline(row):
    h, c = 0, 0
    for col, direction in [('z_hpi_yoy','h'),('z_unemp_yoy_chg','c'),('z_cpi_yoy','h'),('z_real_fed_funds','h')]:
        if pd.notna(row[col]):
            if row[col] > 1.5: h += 1 if direction=='h' else 0; c += 1 if direction=='c' else 0
            elif row[col] < -1.5: h += 1 if direction=='c' else 0; c += 1 if direction=='h' else 0
    if row['curve_inverted']==1: h += 1
    return h, c

def vote_expanded(row):
    h, c = vote_baseline(row)
    # NEW: job openings falling = COLD (jobs weakening), rising = HOT (labor tight)
    if 'z_job_openings_yoy_chg' in row.index and pd.notna(row['z_job_openings_yoy_chg']):
        if row['z_job_openings_yoy_chg'] > 1.5: h += 1
        elif row['z_job_openings_yoy_chg'] < -1.5: c += 1
    # NEW: CRE delinquency RISING = COLD (distress), falling = HOT (credit good)
    if 'z_cre_delinq_yoy_chg' in row.index and pd.notna(row['z_cre_delinq_yoy_chg']):
        if row['z_cre_delinq_yoy_chg'] > 1.5: c += 1
        elif row['z_cre_delinq_yoy_chg'] < -1.5: h += 1
    # NEW: BAA credit spread WIDENING (high) = COLD (credit stress), tightening (low) = HOT
    if 'z_baa10y' in row.index and pd.notna(row['z_baa10y']):
        if row['z_baa10y'] > 1.5: c += 1
        elif row['z_baa10y'] < -1.5: h += 1
    return h, c

def classify(h, c):
    if h >= 3: return 'CYCLE TOP'
    if h >= 2: return 'LATE CYCLE'
    if c >= 3: return 'CYCLE BOTTOM'
    if c >= 2: return 'CONTRACTION'
    return 'MID CYCLE'

regime['h_base'], regime['c_base'] = zip(*regime.apply(vote_baseline, axis=1))
regime['h_exp'], regime['c_exp'] = zip(*regime.apply(vote_expanded, axis=1))
regime['label_base'] = regime.apply(lambda r: classify(r['h_base'], r['c_base']), axis=1)
regime['label_exp']  = regime.apply(lambda r: classify(r['h_exp'], r['c_exp']), axis=1)

# ── Forward 3yr HPI for validation ────────────────────────────────────────
def fwd_3yr(idx):
    if idx + 3 >= len(regime): return np.nan
    yrs = regime['hpi_yoy'].iloc[idx+1:idx+4].values
    if any(pd.isna(yrs)): return np.nan
    return (np.prod([1 + y for y in yrs]) ** (1/3) - 1) * 100
regime['fwd_3yr_hpi'] = [fwd_3yr(i) for i in range(len(regime))]

BENCHMARK = 4.5  # long-term national avg
def verdict(row, label_col):
    fwd = row['fwd_3yr_hpi']
    if pd.isna(fwd): return None
    r = row[label_col]
    if r in ('CYCLE TOP','LATE CYCLE'):
        if fwd < BENCHMARK - 1: return 'CORRECT'
        elif fwd > BENCHMARK + 1: return 'WRONG'
        else: return 'PARTIAL'
    elif r == 'MID CYCLE':
        if abs(fwd - BENCHMARK) <= 2: return 'CORRECT'
        else: return 'PARTIAL'
    elif r in ('CONTRACTION','CYCLE BOTTOM'):
        if fwd > BENCHMARK + 1: return 'CORRECT'
        elif fwd < BENCHMARK - 1: return 'WRONG'
        else: return 'PARTIAL'
    return None
regime['v_base'] = regime.apply(lambda r: verdict(r, 'label_base'), axis=1)
regime['v_exp']  = regime.apply(lambda r: verdict(r, 'label_exp'), axis=1)

# ── Report ────────────────────────────────────────────────────────────────
print()
print('='*130)
print('REGIME DETECTOR — baseline (5 signals) vs expanded (+3 new)')
print('='*130)
print()

# Show years where labels differ
diff = regime[(regime['label_base'] != regime['label_exp']) & regime['year'].between(1995, 2025)]
if not diff.empty:
    print(f'{len(diff)} years where expanded detector disagreed with baseline:')
    print(f'{"year":<6}{"baseline":<15}{"expanded":<15}{"h_b/c_b":<10}{"h_e/c_e":<10}{"fwd_3yr":>10}{"v_base":<12}{"v_exp":<12}')
    print('-'*95)
    for _, r in diff.iterrows():
        fwd = f'{r["fwd_3yr_hpi"]:+.2f}%' if pd.notna(r['fwd_3yr_hpi']) else 'n/a'
        print(f'{int(r["year"]):<6}{r["label_base"]:<15}{r["label_exp"]:<15}{int(r["h_base"])}/{int(r["c_base"]):<8}{int(r["h_exp"])}/{int(r["c_exp"]):<8}{fwd:>10}{str(r["v_base"]):<12}{str(r["v_exp"]):<12}')

# Aggregate accuracy
print()
print('AGGREGATE ACCURACY (years with observable 3yr forward):')
scored = regime[regime['v_base'].notna() & regime['year'].between(1995, 2022)]
for col, label in [('v_base', 'Baseline (5 signals)'), ('v_exp', 'Expanded (8 signals)')]:
    correct = (scored[col]=='CORRECT').sum()
    partial = (scored[col]=='PARTIAL').sum()
    wrong = (scored[col]=='WRONG').sum()
    total = len(scored)
    print(f'  {label:<28}  CORRECT: {correct}/{total} ({correct/total*100:.0f}%)   PARTIAL: {partial}   WRONG: {wrong}')

# Current 2025 reading
print()
print('='*130)
print('2025 CURRENT REGIME READING')
print('='*130)
cur = regime[regime['year']==2025]
if not cur.empty:
    r = cur.iloc[0]
    print(f'\n  Baseline detector:  {r["label_base"]}  ({int(r["h_base"])}H / {int(r["c_base"])}C votes)')
    print(f'  Expanded detector:  {r["label_exp"]}  ({int(r["h_exp"])}H / {int(r["c_exp"])}C votes)')
    print()
    print('  Current signal readings (z-scores):')
    for col in ['z_hpi_yoy','z_unemp_yoy_chg','z_cpi_yoy','z_real_fed_funds','z_job_openings_yoy_chg','z_cre_delinq_yoy_chg','z_baa10y']:
        if col in r.index and pd.notna(r[col]):
            print(f'    {col:<30}  {r[col]:+.2f}')
    print()
    print('  Curve inverted:  ', 'YES' if r['curve_inverted']==1 else 'no')
    # Raw values of new signals
    for sid in ['jtsjol','drclacbs','baa10y']:
        if sid in r.index and pd.notna(r[sid]):
            print(f'  {sid.upper():<15}  {r[sid]:.2f}')

# Recent history
print()
print('='*130)
print('RECENT HISTORY (2018-2025) — both detectors + verdicts')
print('='*130)
recent = regime[regime['year'].between(2018, 2025)][['year','label_base','h_base','c_base','label_exp','h_exp','c_exp','fwd_3yr_hpi','v_base','v_exp']]
print(recent.to_string(index=False))
