import type { ProFormaData, ProFormaItem } from '@/types';

/**
 * Chained projection — a previous year's override cascades as the new base.
 * Year N's value = previous year's override (or stabilized) × (1 + growth%).
 */
export function makeChainedValue(yearOverrides: ProFormaData['yearOverrides']) {
  return function (
    overrideField: 'grossRent' | 'otherIncome' | 'vacancyPct' | 'creditLossPct',
    growthPctField: 'grossRentGrowthPct' | 'otherIncomeGrowthPct' | null,
    stabilized: number,
    defaultGrowthPct: number,
    targetYear: number
  ): number {
    if (targetYear <= 1) return stabilized;
    let value = stabilized;
    let lastGrowthPct = defaultGrowthPct;
    for (let y = 2; y <= targetYear; y++) {
      const prevOv = yearOverrides?.[y - 1];
      const prev = prevOv?.[overrideField];
      // Skip pre-stab (system) overrides — calculator-driven values don't anchor the chain
      const isSystem = overrideField === 'grossRent' && prevOv?.grossRentSystem === true;
      // Any manually-entered value (any year) anchors the chain — consistent rule, no Year 1 exception
      if (prev !== undefined && !isSystem) value = prev;
      if (growthPctField !== null) {
        const rateOverride = yearOverrides?.[y]?.[growthPctField];
        if (rateOverride !== undefined) lastGrowthPct = rateOverride;
      }
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
