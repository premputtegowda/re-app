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
  // When per-type anniversary data is present, prefer it — it's more accurate when
  // unit types have different rents (the blended `dist` collapses them together).
  const byType = pf.leaseAnniversaryByType;
  const hasByType = !!byType && byType.some(t => t.distribution.some(n => n > 0));

  /**
   * Market rent for a year — pure compounding formula off the stabilized base.
   * Year N = stabilized × Π (1 + growthPct_y/100) for y=2..N.
   * Honors per-year growth-rate overrides (yearOverrides[y].grossRentGrowthPct) but
   * IGNORES per-year grossRent overrides — the calculator's pre-stab Year-1 value
   * is the actual collected rent, not market rent. This is the GPR.
   */
  function getMarketRentForYear(year: number): number {
    if (year <= 1) return pf.grossRent.stabilized;
    let value = pf.grossRent.stabilized;
    let lastGrowthPct = pf.grossRent.growthPct;
    for (let y = 2; y <= year; y++) {
      const rateOverride = pf.yearOverrides?.[y]?.grossRentGrowthPct;
      if (rateOverride !== undefined) lastGrowthPct = rateOverride;
      value = value * (1 + lastGrowthPct / 100);
    }
    return value;
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

    // Year 1 → no LTL applied here (Year 1's actual rent comes from the simulator override)
    if (year <= 1) return marketRent;

    const growthRate = pf.grossRent.growthPct / 100;

    // Preferred path: per-type anniversary model (accurate when types have different rents)
    if (hasByType && byType) {
      let actualRent = 0;
      for (const type of byType) {
        const marketRate = type.targetRent * Math.pow(1 + growthRate, year - 1);
        const prevRate   = type.targetRent * Math.pow(1 + growthRate, year - 2);
        for (let m = 0; m < 12; m++) {
          const units = type.distribution[m] ?? 0;
          if (units === 0) continue;
          if (m === 0) {
            actualRent += units * marketRate * 12;
          } else {
            actualRent += units * (prevRate * m + marketRate * (12 - m));
          }
        }
      }
      return actualRent;
    }

    // Fallback: blended distribution (legacy / single-type deals)
    if (!dist || totalUnits === 0) return marketRent;
    const perUnitTarget = pf.grossRent.stabilized / totalUnits / 12;
    const marketRate = perUnitTarget * Math.pow(1 + growthRate, year - 1);
    const prevRate = perUnitTarget * Math.pow(1 + growthRate, year - 2);

    let actualRent = 0;
    for (let m = 0; m < 12; m++) {
      const units = dist[m] ?? 0;
      if (units === 0) continue;
      if (m === 0) {
        actualRent += units * marketRate * 12;
      } else {
        actualRent += units * (prevRate * m + marketRate * (12 - m));
      }
    }
    return actualRent;
  }

  /**
   * Loss to lease for a year = market rent − actual collected rent.
   * Applies to every year — Year 1 (where pre-stab values produce the largest LTL
   * from offline reno units, in-place rents, lease-up) and Year N (anniversary lag).
   */
  function getLossToLeaseForYear(year: number): number {
    return getMarketRentForYear(year) - getGrossRentForYear(year);
  }

  function getEGIForYear(year: number): number {
    const ov = pf.yearOverrides?.[year];
    const grossLeaseRent = getGrossRentForYear(year);
    const marketRent     = getMarketRentForYear(year);
    const other = ov?.otherIncome   !== undefined ? ov.otherIncome   : chainedValue('otherIncome',   'otherIncomeGrowthPct', pf.otherIncome.stabilized,   pf.otherIncome.growthPct,   year);
    const vac   = ov?.vacancyPct    !== undefined ? ov.vacancyPct    : chainedValue('vacancyPct',    null,                   pf.vacancyPct.stabilized,    0,                          year);
    const clv   = ov?.creditLossPct !== undefined ? ov.creditLossPct : chainedValue('creditLossPct', null,                   pf.creditLossPct.stabilized, 0,                          year);
    // Vacancy and credit loss are % of GPR (Market Rent), not gross lease rent.
    // This avoids double-counting: LTL already discounts market → lease, then vacancy
    // is a separate haircut on the full market base.
    const vacancy    = marketRent * (vac / 100);
    const creditLoss = marketRent * (clv / 100);
    return grossLeaseRent - vacancy - creditLoss + other;
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
