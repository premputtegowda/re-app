import type { ProFormaData } from '@/types';
import { makeChainedValue, makeChainedExpenseValue } from './proFormaChaining';
import { computeEGI } from './dealAnalyzerCalc';

/**
 * Returns per-year EGI and opex calculation functions for a given ProFormaData.
 * Both ProFormaGrid (display) and dealAnalyzerCalc (projections) use this so
 * there is exactly one implementation of these computations.
 */
export function makeProFormaProjector(pf: ProFormaData) {
  const chainedValue = makeChainedValue(pf.yearOverrides);
  const chainedExpenseValue = makeChainedExpenseValue(pf.yearOverrides);

  function getGrossRentForYear(year: number): number {
    const ov = pf.yearOverrides?.[year];
    // Any explicit override (manual or system/calculator) → use for this year.
    // System overrides are pre-stab values that must be used for EGI/display.
    // The chain (for years WITHOUT overrides) skips system overrides so growth
    // compounds from stabilized, not from pre-stab values.
    if (ov?.grossRent !== undefined) return ov.grossRent;
    return chainedValue('grossRent', 'grossRentGrowthPct', pf.grossRent.stabilized, pf.grossRent.growthPct, year);
  }

  function getEGIForYear(year: number): number {
    const ov = pf.yearOverrides?.[year];
    const rent  = getGrossRentForYear(year);
    const other = ov?.otherIncome   !== undefined ? ov.otherIncome   : chainedValue('otherIncome',   'otherIncomeGrowthPct', pf.otherIncome.stabilized,   pf.otherIncome.growthPct,   year);
    const vac   = ov?.vacancyPct    !== undefined ? ov.vacancyPct    : chainedValue('vacancyPct',    null,                   pf.vacancyPct.stabilized,    0,                          year);
    const clv   = ov?.creditLossPct !== undefined ? ov.creditLossPct : chainedValue('creditLossPct', null,                   pf.creditLossPct.stabilized, 0,                          year);
    return computeEGI(rent, other, vac, clv);
  }

  function getOpExForYear(year: number, egi: number): number {
    return pf.expenses.reduce((sum, e) => {
      if (e.isPercentOfEGI) {
        // Cascade the last-set % override forward (same as ProFormaGrid's getEffectivePctForYear)
        let pct = e.stabilizedValue;
        for (let y = 1; y <= year; y++) {
          const expOv = pf.yearOverrides?.[y]?.expenses?.[e.id];
          if (expOv !== undefined) pct = expOv;
        }
        return sum + egi * (pct / 100);
      }
      const expOv = pf.yearOverrides?.[year]?.expenses?.[e.id];
      return sum + (expOv !== undefined ? expOv : chainedExpenseValue(e, year));
    }, 0);
  }

  function getEffectivePctForExpense(expenseId: string, stabilizedPct: number, year: number): number {
    let lastPct = stabilizedPct;
    for (let y = 1; y <= year; y++) {
      const expOv = pf.yearOverrides?.[y]?.expenses?.[expenseId];
      if (expOv !== undefined) lastPct = expOv;
    }
    return lastPct;
  }

  return { getGrossRentForYear, getEGIForYear, getOpExForYear, getEffectivePctForExpense };
}
