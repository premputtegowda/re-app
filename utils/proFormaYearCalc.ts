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
  const dist = pf.leaseAnniversaryDistribution;
  const totalUnits = dist ? dist.reduce((s, n) => s + n, 0) : 0;

  /**
   * Market rent for a year — what all units WOULD earn if every lease
   * were at the current market rate for the full year. No LTL applied.
   * For years with explicit overrides (pre-stab), returns the chain value
   * (ideal rent as if stabilized) — NOT the override.
   */
  function getMarketRentForYear(year: number): number {
    return chainedValue('grossRent', 'grossRentGrowthPct', pf.grossRent.stabilized, pf.grossRent.growthPct, year);
  }

  /**
   * Actual collected gross rent for a year — accounts for loss to lease.
   *
   * Year 1 (and any year with a grossRent override): uses the override directly.
   * These are pre-stab values from the simulator that already capture partial rents.
   *
   * Year 2+ (no override): uses the anniversary model.
   * Each unit renews on its anniversary month. Before the anniversary, the unit
   * earns last year's rate. After, it earns the new market rate.
   *
   * If no anniversary distribution exists, falls back to market rent (no LTL).
   */
  function getGrossRentForYear(year: number): number {
    const ov = pf.yearOverrides?.[year];
    // Any explicit override (manual or system/calculator) → use as-is
    if (ov?.grossRent !== undefined) return ov.grossRent;

    const marketRent = chainedValue('grossRent', 'grossRentGrowthPct', pf.grossRent.stabilized, pf.grossRent.growthPct, year);

    // No distribution or Year 1 → no LTL
    if (!dist || totalUnits === 0 || year <= 1) return marketRent;

    // Anniversary model: compute actual collected rent
    const perUnitTarget = pf.grossRent.stabilized / totalUnits / 12;
    const growthRate = pf.grossRent.growthPct / 100;
    const marketRate = perUnitTarget * Math.pow(1 + growthRate, year - 1);
    const prevRate = perUnitTarget * Math.pow(1 + growthRate, year - 2);

    let actualRent = 0;
    for (let m = 0; m < 12; m++) {
      const units = dist[m] ?? 0;
      if (units === 0) continue;
      if (m === 0) {
        // Month 1 anniversary = full year at new rate
        actualRent += units * marketRate * 12;
      } else {
        const oldMonths = m;          // months 1..m at old rate
        const newMonths = 12 - m;     // months m+1..12 at new rate
        actualRent += units * (prevRate * oldMonths + marketRate * newMonths);
      }
    }

    return actualRent;
  }

  /**
   * Loss to lease for a year = market rent - actual collected rent.
   * Returns 0 for pre-stab years (override-driven) and when no distribution exists.
   */
  function getLossToLeaseForYear(year: number): number {
    const ov = pf.yearOverrides?.[year];
    if (ov?.grossRent !== undefined) return 0; // pre-stab: LTL already baked into override
    if (!dist || totalUnits === 0 || year <= 1) return 0;
    return getMarketRentForYear(year) - getGrossRentForYear(year);
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

  return { getMarketRentForYear, getGrossRentForYear, getLossToLeaseForYear, getEGIForYear, getOpExForYear, getEffectivePctForExpense };
}
