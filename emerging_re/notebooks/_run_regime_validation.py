"""Regime detector validation — comprehensive per-year DataFrame with:
  - Detected regime label per year
  - Implication (bearish / neutral / bullish for MF new buys)
  - Realized 1yr and 3yr forward HPI (national)
  - Ground truth event (from historical macro record)
  - Verdict: did the label's implicit prediction play out?
  - Aggregate accuracy stats

Everything in pandas DataFrames — no print blocks.
"""
from __future__ import annotations
from pathlib import Path
import duckdb, pandas as pd, numpy as np

ROOT = Path(__file__).resolve().parent.parent
pd.set_option('display.width', 250); pd.set_option('display.max_rows', 100); pd.set_option('display.max_columns', 30)
pd.set_option('display.max_colwidth', 60)

# ── Data ────────────────────────────────────────────────────────────────────
con = duckdb.connect(str(ROOT / 'data/warehouse/emerging_re.duckdb'), read_only=True)

hpi_nat = con.execute("""
    WITH hpi_dec AS (
        SELECT fips, EXTRACT(YEAR FROM period_end_date)::INT AS year, hpi
        FROM main_staging.stg_fhfa_hpi
        QUALIFY row_number() OVER (PARTITION BY fips, EXTRACT(YEAR FROM period_end_date) ORDER BY as_of_date DESC)=1
    ),
    hpi_yoy AS (
        SELECT curr.fips, curr.year, curr.hpi/prev.hpi - 1 AS hpi_yoy
        FROM hpi_dec curr JOIN hpi_dec prev ON prev.fips=curr.fips AND prev.year=curr.year-1 WHERE prev.hpi>0
    )
    SELECT year, MEDIAN(hpi_yoy) AS hpi_yoy FROM hpi_yoy GROUP BY year ORDER BY year
""").df()

fred = con.execute("""
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
""").df()
con.close()

# ── Regime detector (same as in the notebooks) ──────────────────────────────
m = hpi_nat.merge(fred, on='year', how='inner').sort_values('year').reset_index(drop=True)
m['cpi_yoy']         = m['cpi_lvl'].pct_change() * 100
m['unemp_yoy_chg']   = m['unemp'].diff()
m['real_fed_funds']  = m['fed_funds'] - m['cpi_yoy']
m['curve_inverted']  = (m['yield_curve'] < 0).astype(int)

def z(series, min_periods=10):
    out = pd.Series(index=series.index, dtype=float)
    for i in range(len(series)):
        w = series.iloc[:i].dropna()
        if len(w) < min_periods: out.iloc[i] = np.nan
        else:
            mu, sig = w.mean(), w.std()
            out.iloc[i] = (series.iloc[i] - mu) / sig if sig > 0 else 0.0
    return out

m['z_hpi']       = z(m['hpi_yoy'])
m['z_unemp_chg'] = z(m['unemp_yoy_chg'])
m['z_cpi']       = z(m['cpi_yoy'])
m['z_real_ff']   = z(m['real_fed_funds'])

def vote(row):
    h, c = 0, 0
    if pd.notna(row['z_hpi']):
        if row['z_hpi'] > 1.5: h += 1
        elif row['z_hpi'] < -1.5: c += 1
    if pd.notna(row['z_unemp_chg']):
        if row['z_unemp_chg'] > 1.5: c += 1
        elif row['z_unemp_chg'] < -1.5: h += 1
    if pd.notna(row['z_cpi']):
        if row['z_cpi'] > 1.5: h += 1
        elif row['z_cpi'] < -1.5: c += 1
    if pd.notna(row['z_real_ff']):
        if row['z_real_ff'] > 1.5: h += 1
        elif row['z_real_ff'] < -1.5: c += 1
    if row['curve_inverted'] == 1: h += 1
    return pd.Series({'hot_votes': h, 'cold_votes': c})

m = pd.concat([m, m.apply(vote, axis=1)], axis=1)

def classify(row):
    if row['hot_votes'] >= 3: return 'CYCLE TOP'
    if row['hot_votes'] >= 2: return 'LATE CYCLE'
    if row['cold_votes'] >= 3: return 'CYCLE BOTTOM'
    if row['cold_votes'] >= 2: return 'CONTRACTION'
    return 'MID CYCLE'
m['regime'] = m.apply(classify, axis=1)

# ── Implication: what does the label imply for the next 1-3 years? ─────────
IMPLICATION_MAP = {
    'CYCLE TOP':    'BEARISH — expect stress, HPI slowdown or drop',
    'LATE CYCLE':   'CAUTIOUS — elevated risk, HPI likely to soften',
    'MID CYCLE':    'NEUTRAL — expect trend HPI growth (~4-5%/yr)',
    'CONTRACTION':  'BULLISH — cycle turning, HPI likely to recover',
    'CYCLE BOTTOM': 'STRONG BULLISH — deep opportunity, HPI likely to rebound',
}
m['implication'] = m['regime'].map(IMPLICATION_MAP)

# ── Realized forward HPI (the "did it play out?" metric) ────────────────────
# Forward 1yr HPI = next year's hpi_yoy
# Forward 3yr annualized HPI = cumulative HPI growth over next 3 years, annualized

m['hpi_fwd_1yr_pct'] = m['hpi_yoy'].shift(-1) * 100   # next year's HPI YoY
# For 3yr annualized: compound next 3 years' HPI YoYs
def fwd_3yr_ann(idx):
    if idx + 3 >= len(m): return np.nan
    years = m['hpi_yoy'].iloc[idx+1:idx+4].values
    if any(pd.isna(years)): return np.nan
    cum = np.prod([1 + y for y in years])
    return (cum ** (1/3) - 1) * 100

m['hpi_fwd_3yr_ann_pct'] = [fwd_3yr_ann(i) for i in range(len(m))]

# ── Ground truth (known historical events) ──────────────────────────────────
GROUND_TRUTH = {
    1990: 'S&L crisis / recession',
    1991: 'recession continuing',
    1992: 'jobless recovery',
    1993: 'recovery',
    1994: 'Fed tightening cycle',
    1995: 'soft landing',
    1996: 'expansion',
    1997: 'expansion',
    1998: 'LTCM / Asian crisis',
    1999: 'dot-com run-up',
    2000: 'dot-com peak',
    2001: 'dot-com bust + 9/11',
    2002: 'jobless recovery',
    2003: 'recovery, rates cut hard',
    2004: 'expansion, housing rising',
    2005: 'SFR bubble peaking',
    2006: 'housing top',
    2007: 'crisis brewing',
    2008: 'GFC CRASH',
    2009: 'depths of crash',
    2010: 'stimulus recovery',
    2011: 'bottom + Euro crisis',
    2012: 'early recovery',
    2013: 'housing recovery',
    2014: 'recovery continuing',
    2015: 'expansion',
    2016: 'expansion',
    2017: 'expansion, Trump tax cuts',
    2018: 'Fed hiking cycle',
    2019: 'curve inversion, late cycle',
    2020: 'COVID shock + stimulus',
    2021: 'rent + HPI bubble',
    2022: 'rate shock (topping)',
    2023: 'tightening peak',
    2024: 'tightening plateau',
    2025: 'rate normalization',
}
m['known_event'] = m['year'].map(GROUND_TRUTH)

# ── Verdict: did the label's implication play out? ──────────────────────────
# LONG_TERM_HPI_AVG = ~4.5%/yr (national avg 1976-2020)
# CYCLE TOP / LATE CYCLE → forward should be BELOW avg
# MID CYCLE → forward should be ~AT avg (±2pp band)
# CONTRACTION / CYCLE BOTTOM → forward should be ABOVE avg
BENCHMARK_HPI = 4.5

def verdict(row):
    fwd = row['hpi_fwd_3yr_ann_pct']
    if pd.isna(fwd): return 'n/a (fwd data not observable)'
    r = row['regime']
    if r in ('CYCLE TOP', 'LATE CYCLE'):
        if fwd < BENCHMARK_HPI - 1: return 'CORRECT — bearish label, forward stress'
        elif fwd > BENCHMARK_HPI + 1: return 'WRONG — bearish label, forward boom'
        else: return 'PARTIAL — bearish label, forward near trend'
    elif r == 'MID CYCLE':
        if abs(fwd - BENCHMARK_HPI) <= 2: return 'CORRECT — neutral label, forward near trend'
        elif fwd > BENCHMARK_HPI + 2: return 'PARTIAL — neutral label, forward stronger'
        else: return 'PARTIAL — neutral label, forward weaker'
    elif r in ('CONTRACTION', 'CYCLE BOTTOM'):
        if fwd > BENCHMARK_HPI + 1: return 'CORRECT — bullish label, forward recovery'
        elif fwd < BENCHMARK_HPI - 1: return 'WRONG — bullish label, forward stress continues'
        else: return 'PARTIAL — bullish label, forward near trend'
    return 'n/a'

m['verdict'] = m.apply(verdict, axis=1)

# ── Main validation DataFrame ───────────────────────────────────────────────
validation_df = m[['year','regime','implication','hot_votes','cold_votes',
                   'hpi_yoy','hpi_fwd_1yr_pct','hpi_fwd_3yr_ann_pct',
                   'known_event','verdict']].copy()
validation_df['hpi_yoy'] = validation_df['hpi_yoy'] * 100  # to pct

# Filter to years where regime detector actually fires (has enough history)
validation_df = validation_df[validation_df['year'] >= 2000].reset_index(drop=True)

print('=' * 200)
print(' MAIN VALIDATION DATAFRAME — regime label per year with forward HPI performance')
print('=' * 200)
print(validation_df.to_string(index=False, float_format=lambda x: f'{x:+.2f}' if isinstance(x, float) else str(x)))

# ── Accuracy summary DataFrame ──────────────────────────────────────────────
scored = validation_df[validation_df['verdict'].str.contains('CORRECT|WRONG|PARTIAL', na=False)].copy()
scored['is_correct'] = scored['verdict'].str.contains('CORRECT')
scored['is_wrong'] = scored['verdict'].str.contains('WRONG')
scored['is_partial'] = scored['verdict'].str.contains('PARTIAL')

# By regime state
by_regime = scored.groupby('regime').agg(
    n_years=('year', 'count'),
    n_correct=('is_correct', 'sum'),
    n_wrong=('is_wrong', 'sum'),
    n_partial=('is_partial', 'sum'),
).reset_index()
by_regime['accuracy_pct'] = (by_regime['n_correct'] / by_regime['n_years'] * 100).round(1)

print('\n\n' + '=' * 100)
print(' ACCURACY BY REGIME STATE')
print('=' * 100)
print(by_regime.to_string(index=False))

# Overall
n_total = len(scored)
n_correct = scored['is_correct'].sum()
n_wrong = scored['is_wrong'].sum()
n_partial = scored['is_partial'].sum()

overall = pd.DataFrame([{
    'metric': 'total_years_scored', 'value': n_total},
    {'metric': 'n_correct',      'value': int(n_correct)},
    {'metric': 'n_wrong',        'value': int(n_wrong)},
    {'metric': 'n_partial',      'value': int(n_partial)},
    {'metric': 'accuracy_strict_pct',  'value': round(n_correct/n_total*100, 1)},
    {'metric': 'accuracy_including_partial_pct', 'value': round((n_correct+n_partial)/n_total*100, 1)},
])
print('\n\n' + '=' * 100)
print(' OVERALL ACCURACY')
print('=' * 100)
print(overall.to_string(index=False))

# ── Just the current-year snapshot for reference ────────────────────────────
current = validation_df[validation_df['year'] == 2025].copy()
if not current.empty:
    print('\n\n' + '=' * 100)
    print(' CURRENT YEAR SNAPSHOT (2025)')
    print('=' * 100)
    print(current.to_string(index=False))
