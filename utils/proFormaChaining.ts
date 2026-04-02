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
      const prevOv = yearOverrides?.[y - 1];
      const prev = prevOv?.[overrideField];
      // Skip pre-stab (system) overrides — gross rent formula always chains from stabilized, not calculator values
      const isSystem = overrideField === 'grossRent' && prevOv?.grossRentSystem === true;
      // For non-grossRent Yr1, only rebase the chain when yr1Blocked=true (ban icon clicked).
      // A plain Yr1 edit is display-only — Yr2+ continue chaining from stabilized.
      const isUnblockedYr1Override = (y - 1) === 1 && overrideField !== 'grossRent' && !prevOv?.yr1Blocked;
      if (prev !== undefined && !isSystem && !isUnblockedYr1Override) value = prev;
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
