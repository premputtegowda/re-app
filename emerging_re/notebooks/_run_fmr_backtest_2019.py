"""2019→2022 backtest using REAL HUD FMR rent data (per county) — no CPI proxy.

Approach:
  - Vintage 2019-12-31 composite scores from mart_backtest_scores (EMERGING-VALUE population range)
  - Forward 3yr HPI appreciation from mart (hpi_forward_return_36mo)
  - Real cash flow using per-county FMR growth 2019→2022 and initial cap_rate_proxy at 2019
  - Compare top-N picks vs universe mean

Also recalibrates CURRENT picks (Marion IN, Montgomery OH) with real FMR trajectory.
"""
from __future__ import annotations
import duckdb, numpy as np, pandas as pd

WAREHOUSE = '/Users/premputtegowda/reps/reps-tracker/emerging_re/data/warehouse/emerging_re.duckdb'
POP_MIN, POP_MAX = 300_000, 1_000_000
TOP_N = 30
MAX_PER_STATE = 3
LTV = 0.70

# State opex ratios (from prior work — reflects tax/insurance environment)
STATE_OPEX = {
    'Ohio':0.57,'Michigan':0.57,'Pennsylvania':0.57,'Illinois':0.57,'Wisconsin':0.57,
    'New York':0.57,'New Jersey':0.57,'Connecticut':0.57,'Missouri':0.52,'Massachusetts':0.52,
    'Maryland':0.52,'California':0.47,'Iowa':0.47,'Minnesota':0.47,'Florida':0.47,
    'Indiana':0.47,'Texas':0.44,'Virginia':0.44,'Colorado':0.44,'Washington':0.44,
    'Kansas':0.44,'Kentucky':0.44,'Georgia':0.42,'North Carolina':0.42,'South Carolina':0.42,
    'Tennessee':0.42,'Oklahoma':0.42,'Utah':0.42,'Idaho':0.42,'Arizona':0.40,
    'Nevada':0.40,'Alabama':0.40,'Mississippi':0.40,'Arkansas':0.40,
}

con = duckdb.connect(WAREHOUSE, read_only=True)

# ─── Universe: vintage 2019 scores + FMR pair (2019+2022) + cap + HPI fwd ────
uni = con.execute(f"""
    WITH fmr_19 AS (
        SELECT fips, fmr_2br AS fmr_2019 FROM main_staging.stg_hud_fmr
        WHERE EXTRACT(YEAR FROM period_end_date) = 2019
    ),
    fmr_22 AS (
        SELECT fips, fmr_2br AS fmr_2022 FROM main_staging.stg_hud_fmr
        WHERE EXTRACT(YEAR FROM period_end_date) = 2022
    ),
    fmr_24 AS (
        SELECT fips, fmr_2br AS fmr_2024 FROM main_staging.stg_hud_fmr
        WHERE EXTRACT(YEAR FROM period_end_date) = 2024
    ),
    feat_19 AS (
        SELECT fips, cap_rate_proxy AS cap_2019, pop_latest
        FROM main_marts.mart_county_features
        WHERE EXTRACT(YEAR FROM period_end_date) = 2019 AND EXTRACT(MONTH FROM period_end_date) = 12
    )
    SELECT bs.fips, bs.county_name, bs.state_name, bs.pop_latest,
           bs.composite_score, bs.composite_rank,
           bs.hpi_forward_return_36mo,
           bs.any_disqualifier,
           bs.z_cap_rate_proxy, bs.z_wage_growth_yoy_demeaned, bs.z_emp_growth_yoy_demeaned,
           bs.z_fmr_2br_cagr_3yr_vs_state_pp,
           f19.fmr_2019, f22.fmr_2022, f24.fmr_2024,
           ft.cap_2019
    FROM main_marts.mart_backtest_scores bs
    JOIN fmr_19 f19 USING (fips)
    JOIN fmr_22 f22 USING (fips)
    LEFT JOIN fmr_24 f24 USING (fips)
    JOIN feat_19 ft  USING (fips)
    WHERE EXTRACT(YEAR FROM bs.period_end_date) = 2019
      AND bs.pop_latest BETWEEN {POP_MIN} AND {POP_MAX}
      AND bs.composite_score IS NOT NULL
      AND bs.hpi_forward_return_36mo IS NOT NULL
      AND ft.cap_2019 IS NOT NULL
""").df()

print(f'Universe: {len(uni)} counties (vintage 2019, pop {POP_MIN:,}-{POP_MAX:,})')

# ─── Real forward returns (FMR growth 2019→2022) ──────────────────────────────
uni['rent_growth_3yr_real'] = uni['fmr_2022'] / uni['fmr_2019'] - 1
uni['rent_growth_5yr_real'] = uni['fmr_2024'] / uni['fmr_2019'] - 1
uni['opex_ratio'] = uni['state_name'].map(STATE_OPEX).fillna(0.45)

# Cash flow with real rent growth: initial cap × (1 - opex) × 3 × avg rent growth factor
uni['cash_flow_3yr'] = 3 * uni['cap_2019'] * (1 - uni['opex_ratio']) * (1 + uni['rent_growth_3yr_real']/2)
uni['appreciation_3yr'] = uni['hpi_forward_return_36mo']
uni['total_return_3yr'] = uni['cash_flow_3yr'] + uni['appreciation_3yr']

# ─── Pick top-N by composite_score with state cap ────────────────────────────
uni_ranked = uni.sort_values('composite_score', ascending=False).copy()
# exclude disqualified
uni_ranked = uni_ranked[(uni_ranked['any_disqualifier'] == False) | uni_ranked['any_disqualifier'].isna()]
picks, sc = [], {}
for _, r in uni_ranked.iterrows():
    if sc.get(r['state_name'], 0) >= MAX_PER_STATE: continue
    picks.append(r); sc[r['state_name']] = sc.get(r['state_name'], 0) + 1
    if len(picks) >= TOP_N: break
picks = pd.DataFrame(picks)

# ─── Results ─────────────────────────────────────────────────────────────────
uni_mean_tr    = uni['total_return_3yr'].mean() * 100
uni_mean_hpi   = uni['appreciation_3yr'].mean() * 100
uni_mean_cf    = uni['cash_flow_3yr'].mean() * 100
uni_mean_rent  = uni['rent_growth_3yr_real'].mean() * 100

pick_tr    = picks['total_return_3yr'].mean() * 100
pick_hpi   = picks['appreciation_3yr'].mean() * 100
pick_cf    = picks['cash_flow_3yr'].mean() * 100
pick_rent  = picks['rent_growth_3yr_real'].mean() * 100

pct_beat = (picks['total_return_3yr'] > uni['total_return_3yr'].median()).mean() * 100
pct_underwater = (picks['total_return_3yr'] < 0).mean() * 100

print()
print('=' * 100)
print('EMERGING-VALUE 2019 → 2022 backtest — REAL FMR cash flow (per county)')
print('=' * 100)
print()
print(f'{"metric":<35}{"UNIVERSE":>15}{"TOP-30":>15}{"delta":>15}')
print('-' * 80)
print(f'{"3yr total return (cash + HPI)":<35}{uni_mean_tr:>14.1f}%{pick_tr:>14.1f}%{pick_tr - uni_mean_tr:>14.1f}%')
print(f'{"  HPI appreciation":<35}{uni_mean_hpi:>14.1f}%{pick_hpi:>14.1f}%{pick_hpi - uni_mean_hpi:>14.1f}%')
print(f'{"  Cash flow (real FMR)":<35}{uni_mean_cf:>14.1f}%{pick_cf:>14.1f}%{pick_cf - uni_mean_cf:>14.1f}%')
print(f'{"  Real rent growth 2019→2022":<35}{uni_mean_rent:>14.1f}%{pick_rent:>14.1f}%{pick_rent - uni_mean_rent:>14.1f}%')
print()
print(f'  % picks beating universe median: {pct_beat:.0f}%')
print(f'  % picks underwater (TR < 0):     {pct_underwater:.0f}%')

# ─── Top-15 detail ───────────────────────────────────────────────────────────
print()
print('Top-15 picks by score:')
print(f'{"rank":<5}{"county":<40}{"cap19":>7}{"rent_g":>8}{"HPI":>8}{"CF":>7}{"TR":>7}')
print('-' * 82)
for i, r in picks.head(15).reset_index(drop=True).iterrows():
    print(f'{i+1:<5}{(r["county_name"]+", "+r["state_name"]):<40}'
          f'{r["cap_2019"]*100:>6.1f}%{r["rent_growth_3yr_real"]*100:>7.1f}%'
          f'{r["appreciation_3yr"]*100:>7.1f}%'
          f'{r["cash_flow_3yr"]*100:>6.1f}%{r["total_return_3yr"]*100:>6.1f}%')

# ─── Bonus: 5yr view for picks (2019→2024) ───────────────────────────────────
picks_5y = picks.dropna(subset=['rent_growth_5yr_real'])
if len(picks_5y) > 0:
    print()
    print(f'5yr view (2019→2024): mean real rent growth for picks = {picks_5y["rent_growth_5yr_real"].mean()*100:.1f}%'
          f'  (universe mean = {uni.dropna(subset=["rent_growth_5yr_real"])["rent_growth_5yr_real"].mean()*100:.1f}%)')

# ─── Recalibrate CURRENT picks (Marion IN, Montgomery OH) with real FMR ─────
print()
print('=' * 100)
print('CURRENT PICKS — real FMR trajectory (from HUD FMR, not CPI proxy)')
print('=' * 100)

cur = con.execute("""
    SELECT
      f.fips,
      MAX(CASE WHEN EXTRACT(YEAR FROM f.period_end_date) = 2019 THEN f.fmr_2br END) AS fmr_2019,
      MAX(CASE WHEN EXTRACT(YEAR FROM f.period_end_date) = 2022 THEN f.fmr_2br END) AS fmr_2022,
      MAX(CASE WHEN EXTRACT(YEAR FROM f.period_end_date) = 2024 THEN f.fmr_2br END) AS fmr_2024,
      MAX(CASE WHEN EXTRACT(YEAR FROM f.period_end_date) = 2026 THEN f.fmr_2br END) AS fmr_2026,
      MAX(fc.cap_rate_proxy)                                                        AS cap_latest,
      MAX(fc.state_name)                                                            AS state_name,
      MAX(fc.county_name)                                                           AS county_name
    FROM main_staging.stg_hud_fmr f
    LEFT JOIN main_marts.mart_county_features fc
      ON fc.fips = f.fips
      AND EXTRACT(YEAR FROM fc.period_end_date) = 2024
      AND EXTRACT(MONTH FROM fc.period_end_date) = 12
    WHERE f.fips IN ('18097','39113')
    GROUP BY f.fips
""").df()

print()
for _, r in cur.iterrows():
    name = f"{r['county_name']}, {r['state_name']}"
    cagr_5y = (r['fmr_2024']/r['fmr_2019'])**(1/5) - 1
    cagr_7y = (r['fmr_2026']/r['fmr_2019'])**(1/7) - 1
    print(f'{name:<30}')
    print(f'  FMR 2019: ${r["fmr_2019"]:>6.0f}   2022: ${r["fmr_2022"]:>6.0f}   '
          f'2024: ${r["fmr_2024"]:>6.0f}   2026: ${r["fmr_2026"]:>6.0f}')
    print(f'  Real 5yr CAGR (2019→2024): {cagr_5y*100:.1f}%   7yr CAGR (2019→2026): {cagr_7y*100:.1f}%')
    if pd.notna(r['cap_latest']):
        opex = STATE_OPEX.get(r['state_name'], 0.45)
        yoc_after_opex = r['cap_latest'] * (1 - opex)
        print(f'  Latest cap_rate_proxy: {r["cap_latest"]*100:.2f}%   opex_ratio: {opex:.0%}   → real YoC: {yoc_after_opex*100:.2f}%')
    print()

con.close()
