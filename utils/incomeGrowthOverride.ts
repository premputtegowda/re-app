import type { ProFormaData } from '@/types';

/**
 * Apply a per-year growth-rate override to ProFormaData.
 *
 * push-to-future ON (default): cascades the new rate from `year` forward to
 * `projectionYears` by writing `value` into each year's override.
 *
 * IMPORTANT: this does NOT mutate `data.grossRent.growthPct` (or otherIncome).
 * The base growth rate represents the original assumption; only the per-year
 * overrides should change. Years before `year` continue to use the unchanged base.
 */
export function applyIncomeGrowthOverride(
  data: ProFormaData,
  year: number,
  field: 'grossRentGrowthPct' | 'otherIncomeGrowthPct',
  value: number,
  projectionYears: number,
): ProFormaData {
  const prev = data.yearOverrides ?? {};
  const updated: NonNullable<ProFormaData['yearOverrides']> = { ...prev };
  for (let y = year; y <= projectionYears; y++) {
    const cur = updated[y] ?? {};
    const tgp = { ...(cur.toggleOffGrowthPcts ?? {}) };
    delete tgp[field];
    updated[y] = { ...cur, [field]: value, toggleOffGrowthPcts: Object.keys(tgp).length ? tgp : undefined };
  }
  return { ...data, yearOverrides: updated };
}
