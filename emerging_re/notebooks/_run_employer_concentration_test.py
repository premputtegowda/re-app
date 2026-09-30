"""Employer concentration proxy from QCEW establishment counts.

Approach (uses already-in-warehouse QCEW data — no ingestion needed):
  1. For each (county, year, supersector): compute avg_emp_per_estab = emp / estabs
  2. For each (year, supersector): compute national avg_emp_per_estab
  3. Ratio = county / national (per sector)
  4. County-level signal: max ratio across sectors = 'dominant facility' proxy

Interpretation:
  - Ratio ~1.0 in all sectors: employers are avg-sized, spread across many firms
  - Ratio >2.0 in one sector: county has unusually large facilities in that sector
                              → likely a dominant employer

Includes ALL ownerships (own_code 0 = 'Total covered') to catch military bases,
state universities, federal facilities that would be missed by private-only.

Test cases (known company towns to validate signal):
  - Dauphin PA (Hershey) → expect high in Manufacturing
  - Washtenaw MI (Ann Arbor) → expect high in Ed/Health
  - Killeen TX area — Fort Hood → expect high in Public Admin
  - Marion IN → expect moderate (diversified urban core)
"""
from __future__ import annotations
import duckdb, pandas as pd

WAREHOUSE = '/Users/premputtegowda/reps/reps-tracker/emerging_re/data/warehouse/emerging_re.duckdb'
pd.set_option('display.width', 200)

con = duckdb.connect(WAREHOUSE, read_only=True)

# Pull county-supersector avg size and national avg size in one query
q = """
WITH dedup AS (
    SELECT fips, period_end_date, industry_code,
           annual_avg_emplvl, annual_avg_estabs
    FROM main_staging.stg_bls_qcew
    WHERE agglvl_code = 74 AND own_code = 5 AND industry_code != '10'
    QUALIFY row_number() OVER (PARTITION BY fips, period_end_date, industry_code ORDER BY as_of_date DESC) = 1
),
county_sector AS (
    SELECT
      fips,
      EXTRACT(YEAR FROM period_end_date)::INT AS year,
      industry_code AS sector,
      SUM(annual_avg_emplvl)::DOUBLE AS emp,
      SUM(annual_avg_estabs)::DOUBLE AS estabs
    FROM dedup
    GROUP BY fips, EXTRACT(YEAR FROM period_end_date), industry_code
),
national_sector AS (
    SELECT year, sector,
           SUM(emp) AS natl_emp,
           SUM(estabs) AS natl_estabs,
           SUM(emp) / NULLIF(SUM(estabs), 0) AS natl_avg_size
    FROM county_sector
    GROUP BY year, sector
),
ratios AS (
    SELECT
      cs.fips, cs.year, cs.sector,
      cs.emp,
      cs.estabs,
      cs.emp / NULLIF(cs.estabs, 0) AS county_avg_size,
      ns.natl_avg_size,
      (cs.emp / NULLIF(cs.estabs, 0)) / NULLIF(ns.natl_avg_size, 0) AS size_ratio_vs_national
    FROM county_sector cs
    JOIN national_sector ns USING (year, sector)
    WHERE cs.estabs >= 5   -- filter: skip sectors with tiny establishment count (noisy)
),
ranked AS (
    SELECT fips, year, sector, emp, size_ratio_vs_national,
           row_number() OVER (PARTITION BY fips, year ORDER BY size_ratio_vs_national DESC NULLS LAST) AS rn
    FROM ratios
),
per_county AS (
    SELECT fips, year, SUM(emp) AS total_private_emp
    FROM ratios GROUP BY fips, year
)
SELECT
  r.fips, r.year,
  r.size_ratio_vs_national AS max_size_ratio,
  r.sector AS top_ratio_sector,
  pc.total_private_emp
FROM ranked r
JOIN per_county pc USING (fips, year)
WHERE r.rn = 1
"""

df = con.execute(q).df()
print(f'Computed {len(df):,} (county, year) rows.')

# ── Test on known company towns ─────────────────────────────────────────────
# Sanity check
KNOWN_CASES = {
    '42043': 'Dauphin PA (Hershey)',
    '26161': 'Washtenaw MI (Ann Arbor)',
    '18097': 'Marion IN (control, diversified urban)',
    '13245': 'Richmond GA (Fort Gordon/Augusta)',
    '13215': 'Muscogee GA (Fort Benning/Columbus)',
    '48027': 'Bell TX (Fort Cavazos/Killeen)',
    '18039': 'Elkhart IN (RV industry — sector-concentrated but employer-diverse)',
    '39113': 'Montgomery OH (Dayton — control)',
    '51550': 'Chesapeake VA — coastal',
    '51650': 'Hampton city VA (Langley AFB)',
    '48303': 'Lubbock TX',
    '39095': 'Lucas OH (Toledo)',
}

print()
print('=' * 100)
print('SANITY CHECK — known company towns should show high max_size_ratio')
print('=' * 100)
print(f'{"fips":<7}{"county":<45}{"year":>5}{"max_ratio":>12}{"top_sector":>15}{"total_emp":>12}')
for fips, name in KNOWN_CASES.items():
    r = df[(df['fips'] == fips) & (df['year'] == 2022)]
    if r.empty: continue
    r = r.iloc[0]
    print(f'{fips:<7}{name:<45}{2022:>5}{r["max_size_ratio"]:>12.2f}{r["top_ratio_sector"]:>15}{r["total_private_emp"]:>12,.0f}')

# ── Distribution ─────────────────────────────────────────────────────────
print()
print('=' * 100)
print('Distribution of max_size_ratio across all counties (2022)')
print('=' * 100)
sub = df[df['year'] == 2022]['max_size_ratio'].dropna()
print(f'n={len(sub):,}   min={sub.min():.2f}  25%={sub.quantile(0.25):.2f}  50%={sub.quantile(0.50):.2f}  '
      f'75%={sub.quantile(0.75):.2f}  90%={sub.quantile(0.90):.2f}  95%={sub.quantile(0.95):.2f}  max={sub.max():.2f}')

# ── Top-20 most concentrated counties in 2022 ─────────────────────────────
print()
print('Top-20 counties by max_size_ratio in 2022:')
con2 = duckdb.connect(WAREHOUSE, read_only=True)
fips_names = con2.execute("""
    SELECT fips, county_name, state_name
    FROM main_marts.mart_county_features
    WHERE EXTRACT(YEAR FROM period_end_date) = 2022 AND EXTRACT(MONTH FROM period_end_date) = 12
""").df()
con2.close()
top = df[df['year'] == 2022].merge(fips_names, on='fips').sort_values('max_size_ratio', ascending=False).head(20)
for _, r in top.iterrows():
    print(f'  {r["fips"]:<7}{r["county_name"]:<30}, {r["state_name"]:<20}  ratio={r["max_size_ratio"]:>5.2f}  sector={r["top_ratio_sector"]:>6}  emp={r["total_private_emp"]:>10,.0f}')

con.close()
