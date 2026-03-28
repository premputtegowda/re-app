import type { ProFormaData, ProFormaItem } from '@/types';

/**
 * Chained projection — a previous year's override cascades as the new base.
 * Year N's value = previous year's override (or stabilized) × (1 + growth%).
 */
export function makeChainedValue(yearOverrides: ProFormaData['yearOverrides']) {
  return function (
    overrideField: 'grossRent' | 'otherIncome',
    growthPctField: 'grossRentGrowthPct' | 'otherIncomeGrowthPct',
    stabilized: number,
    defaultGrowthPct: number,
    targetYear: number
  ): number {
    if (targetYear <= 1) return stabilized;
    let value = stabilized;
    let lastGrowthPct = defaultGrowthPct;
    for (let y = 2; y <= targetYear; y++) {
      const prev = yearOverrides?.[y - 1]?.[overrideField];
      if (prev !== undefined) value = prev;
      const rateOverride = yearOverrides?.[y]?.[growthPctField];
      if (rateOverride !== undefined) lastGrowthPct = rateOverride;
      value = value * (1 + lastGrowthPct / 100);
    }
    return value;
  };
}

export function makeChainedExpenseValue(yearOverrides: ProFormaData['yearOverrides']) {
  return function (expense: ProFormaItem, targetYear: number): number {
    if (targetYear <= 1) return expense.stabilizedValue;
    let value = expense.stabilizedValue;
    let lastGrowthPct = expense.growthPct;
    for (let y = 2; y <= targetYear; y++) {
      const prev = yearOverrides?.[y - 1]?.expenses?.[expense.id];
      if (prev !== undefined) value = prev;
      const rateOverride = yearOverrides?.[y]?.expenseGrowthPcts?.[expense.id];
      if (rateOverride !== undefined) lastGrowthPct = rateOverride;
      value = value * (1 + lastGrowthPct / 100);
    }
    return value;
  };
}

export type CascadeField = 'grossRent' | 'otherIncome' | 'vacancyPct' | 'creditLossPct';

/** Returns the downstream years that should show the cascade prompt. */
export function buildCascadeDownstream(
  field: CascadeField,
  fromYear: number,
  projectionYears: number,
  yearOverrides: ProFormaData['yearOverrides']
): number[] {
  const isFlat = field === 'vacancyPct' || field === 'creditLossPct';
  const downstream: number[] = [];
  for (let y = fromYear + 1; y <= projectionYears; y++) {
    if (isFlat) {
      downstream.push(y);
    } else {
      const ov = yearOverrides?.[y];
      if (!ov) continue;
      if (field === 'grossRent' && ov.grossRent !== undefined) downstream.push(y);
      else if (field !== 'grossRent' && ov[field] !== undefined) downstream.push(y);
    }
  }
  return downstream;
}

/** Applies cascade to yearOverrides and returns updated overrides. */
export function applyCascade(
  field: CascadeField,
  years: number[],
  value: number | undefined,
  yearOverrides: ProFormaData['yearOverrides']
): ProFormaData['yearOverrides'] {
  const ovs = { ...(yearOverrides ?? {}) };
  const isFlat = field === 'vacancyPct' || field === 'creditLossPct';

  if (isFlat) {
    years.forEach(y => { ovs[y] = { ...(ovs[y] ?? {}), [field]: value }; });
  } else {
    years.forEach(y => {
      if (!ovs[y]) return;
      const e = { ...ovs[y] };
      delete e[field];
      if (field === 'grossRent') delete e.grossRentSystem;
      if (Object.keys(e).length > 0) ovs[y] = e; else delete ovs[y];
    });
  }

  return ovs;
}
