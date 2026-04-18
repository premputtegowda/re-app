/**
 * Tests for Goal Seek rent scaling with multiple unit types.
 *
 * Bug: Goal Seek varied targetRentPerUnit (blended average) but
 * targetRentsByType (per-type rents) took priority in buildWhatIfResult.
 * So the solver moved a variable that had no effect → break-even was wrong.
 *
 * Fix: when Goal Seek varies targetRentPerUnit and targetRentsByType exists,
 * scale all per-type rents proportionally by (newBlended / oldBlended).
 */

import { describe, it, expect } from 'vitest';
import { buildWhatIfResult, computeAvgRents } from '@/utils/whatIfCalc';
import type { CoCAcquisition, CoCOperations, CoCRefinance, ProFormaData, CalcPersistedState } from '@/types';

// ── Fixtures ────────────────────────────────────────────────────────────────

const acquisition: CoCAcquisition = {
  propertyAddress: '10 Oak Ave', propertyType: 'mfr', units: 10,
  sfrBeds: 0, sfrBaths: 0, sfrInPlaceRent: 0, sfrTargetRent: 0, sfrPreStabRent: 0,
  unitMix: [
    { id: 'a', beds: 3, baths: 1, count: 5, inPlaceRent: 1200, rentMonthly: 1500, preStabRent: 0, leaseUpUnits: 3, unitsToRenovate: 0 },
    { id: 'b', beds: 2, baths: 1, count: 5, inPlaceRent: 800, rentMonthly: 1000, preStabRent: 0, leaseUpUnits: 3, unitsToRenovate: 0 },
  ],
  purchasePrice: 1_000_000, downPaymentPct: 25, closingCostsPct: 3,
  interestRate: 7, loanTermYears: 30, ioPeriodMonths: 0, points: 0,
  arv: 1_200_000, exitMethod: 'capRate' as const, exitCapRate: 8, exitClosingCostPct: 3,
  projectionYears: 5, hardCostItems: [], softCostItems: [], opportunityCostItems: [], additionalFeeItems: [],
};

const operations: CoCOperations = { grossRentMonthly: 12500, annualRentGrowthPct: 3, vacancyRatePct: 5, opexPct: 0, propertyMgmtPct: 8 };

const proForma: ProFormaData = {
  grossRent: { t12: 120_000, stab: null, stabilized: 150_000, growthPct: 3 },
  otherIncome: { t12: 0, stab: null, stabilized: 0, growthPct: 0 },
  vacancyPct: { t12: 5, stab: null, stabilized: 5 },
  creditLossPct: { t12: 0, stab: null, stabilized: 0 },
  expenses: [
    { id: 'tax', name: 'Property Taxes', isPercentOfEGI: false, t12Value: 8000, stabValue: null, stabilizedValue: 8000, growthPct: 2 },
    { id: 'mgmt', name: 'Property Management', isPercentOfEGI: true, t12Value: 8, stabValue: null, stabilizedValue: 8, growthPct: 0 },
  ],
  yearOverrides: {},
  leaseAnniversaryByType: [
    { targetRent: 1500, distribution: [5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
    { targetRent: 1000, distribution: [5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  ],
  leaseAnniversaryDistribution: [10, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
};

const refinance: CoCRefinance = { enabled: false, refiYear: 3, newLTV: 75, newInterestRate: 6.5, newLoanTermYears: 30, refiMarketValue: 0, refiCostPct: 1 };

const { units, avgTargetRent, avgPreStabRent } = computeAvgRents(acquisition);

const defaults = {
  targetRentPerUnit: avgTargetRent,
  targetRentsByType: [1500, 1000],
  preStabRentPerUnit: avgPreStabRent,
  vacancyPct: 5, rentGrowthPct: 3,
  propertyMgmtPct: 8, maintenancePct: 5, fixedExpenseGrowthPct: 2,
  interestRate: 7, exitCapRate: 8, purchasePrice: 1_000_000, projectionYears: 5,
};

const deps = {
  acquisition, operations, proForma, refinance, units,
  origStabilizedAnnual: proForma.grossRent.stabilized,
  defaultPreStabAnnual: 0, defaultFixedExpenseGrowthPct: 2,
};

// Replicate Goal Seek's build function
function goalSeekBuild(blendedRent: number) {
  const ov = { ...defaults, targetRentPerUnit: blendedRent };
  if (defaults.targetRentsByType?.length) {
    const ratio = defaults.targetRentPerUnit > 0 ? blendedRent / defaults.targetRentPerUnit : 1;
    ov.targetRentsByType = defaults.targetRentsByType.map(r => r * ratio);
  }
  return buildWhatIfResult(ov, deps);
}

// Old broken build (without proportional scaling)
function brokenBuild(blendedRent: number) {
  return buildWhatIfResult({ ...defaults, targetRentPerUnit: blendedRent }, deps);
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Goal Seek rent — multi-type proportional scaling', () => {
  it('at default rent → same IRR (identity)', () => {
    const base = goalSeekBuild(avgTargetRent);
    const atDefault = buildWhatIfResult(defaults, deps);
    expect(base.irr).toBeCloseTo(atDefault.irr ?? 0, 2);
  });

  it('lower rent → lower IRR (solver actually moves the variable)', () => {
    const base = goalSeekBuild(avgTargetRent);
    const lower = goalSeekBuild(avgTargetRent * 0.8);
    expect(lower.irr ?? 0).toBeLessThan(base.irr ?? 0);
  });

  it('higher rent → higher IRR', () => {
    const base = goalSeekBuild(avgTargetRent);
    const higher = goalSeekBuild(avgTargetRent * 1.2);
    expect(higher.irr ?? 0).toBeGreaterThan(base.irr ?? 0);
  });

  it('per-type rents scale proportionally (ratio preserved)', () => {
    const newBlended = avgTargetRent * 0.8;
    const ratio = newBlended / avgTargetRent;
    const ov = { ...defaults, targetRentPerUnit: newBlended };
    ov.targetRentsByType = defaults.targetRentsByType!.map(r => r * ratio);
    // Type A / Type B ratio should be same as original
    const origRatio = defaults.targetRentsByType![0] / defaults.targetRentsByType![1];
    const newRatio = ov.targetRentsByType[0] / ov.targetRentsByType[1];
    expect(newRatio).toBeCloseTo(origRatio, 4);
  });

  it('broken build (no scaling) produces SAME IRR regardless of rent change', () => {
    // This documents the bug: without scaling, targetRentsByType overrides
    // targetRentPerUnit, so the solver moves a variable that has no effect.
    const base = brokenBuild(avgTargetRent);
    const lower = brokenBuild(avgTargetRent * 0.5);
    // IRR should be the same (the bug) — rent change is ignored
    expect(Math.abs((lower.irr ?? 0) - (base.irr ?? 0))).toBeLessThan(0.1);
  });

  it('fixed build (with scaling) produces DIFFERENT IRR when rent changes', () => {
    const base = goalSeekBuild(avgTargetRent);
    const lower = goalSeekBuild(avgTargetRent * 0.5);
    // IRR should be meaningfully different (the fix works)
    expect(Math.abs((lower.irr ?? 0) - (base.irr ?? 0))).toBeGreaterThan(1);
  });
});
