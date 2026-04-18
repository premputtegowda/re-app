/**
 * Tests that every break-even variable actually moves IRR when the solver
 * varies it. Catches the bug where per-year/per-type overrides take priority
 * over the solver's base variable, making the solver ineffective.
 *
 * For each variable: compute IRR at default, compute IRR at a worse value,
 * verify they differ. If they're the same, the per-year override is blocking.
 */

import { describe, it, expect } from 'vitest';
import { buildWhatIfResult, computeAvgRents } from '@/utils/whatIfCalc';
import type { CoCAcquisition, CoCOperations, CoCRefinance, ProFormaData, CalcPersistedState, CoCResult } from '@/types';

const acquisition: CoCAcquisition = {
  propertyAddress: '10 Oak Ave', propertyType: 'mfr', units: 10,
  sfrBeds: 0, sfrBaths: 0, sfrInPlaceRent: 0, sfrTargetRent: 0, sfrPreStabRent: 0,
  unitMix: [
    { id: 'a', beds: 3, baths: 1, count: 5, inPlaceRent: 1200, rentMonthly: 1500, preStabRent: 0, leaseUpUnits: 0, unitsToRenovate: 0 },
    { id: 'b', beds: 2, baths: 1, count: 5, inPlaceRent: 800, rentMonthly: 1000, preStabRent: 0, leaseUpUnits: 0, unitsToRenovate: 0 },
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
    { id: 'ins', name: 'Insurance', isPercentOfEGI: false, t12Value: 4000, stabValue: null, stabilizedValue: 4000, growthPct: 2 },
    { id: 'maint', name: 'Maintenance & Repairs', isPercentOfEGI: true, t12Value: 5, stabValue: null, stabilizedValue: 5, growthPct: 0 },
    { id: 'mgmt', name: 'Property Management', isPercentOfEGI: true, t12Value: 8, stabValue: null, stabilizedValue: 8, growthPct: 0 },
  ],
  yearOverrides: {},
  leaseAnniversaryByType: [
    { targetRent: 1500, distribution: [5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
    { targetRent: 1000, distribution: [5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  ],
  leaseAnniversaryDistribution: [10, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
};

const refinance: CoCRefinance = { enabled: true, refiYear: 3, newLTV: 75, newInterestRate: 6.5, newLoanTermYears: 30, refiMarketValue: 1_200_000, refiCostPct: 1 };

const { units, avgTargetRent, avgPreStabRent } = computeAvgRents(acquisition);

// Defaults WITH per-year overrides (the scenario that exposes the bug)
const overrides = {
  targetRentPerUnit: avgTargetRent,
  targetRentsByType: [1500, 1000],
  preStabRentPerUnit: avgPreStabRent,
  vacancyPct: 5,
  vacancyByYear: { 1: 5, 2: 5, 3: 5, 4: 5, 5: 5 } as Record<number, number>,
  rentGrowthPct: 3,
  rentGrowthByYear: { 2: 3, 3: 3, 4: 3, 5: 3 } as Record<number, number>,
  propertyMgmtPct: 8,
  maintenancePct: 5,
  fixedExpenseGrowthPct: 2,
  fixedExpenseGrowthByYear: { 2: 2, 3: 2, 4: 2, 5: 2 } as Record<number, number>,
  propertyTaxGrowthByYear: { 2: 2, 3: 2, 4: 2, 5: 2 } as Record<number, number>,
  opexRatioByYear: undefined as Record<number, number> | undefined,
  interestRate: 7,
  exitCapRate: 8,
  purchasePrice: 1_000_000,
  projectionYears: 5,
  refiRate: 6.5,
  refiYear: 3,
};

const deps = {
  acquisition, operations, proForma, refinance, units,
  origStabilizedAnnual: proForma.grossRent.stabilized,
  defaultPreStabAnnual: 0, defaultFixedExpenseGrowthPct: 2,
};

/**
 * Replicate the break-even build function from WhatIfPanel — with the
 * per-year/per-type sync fix applied.
 */
function buildWithSync(partial: Partial<typeof overrides>): CoCResult {
  const ov = { ...overrides, ...partial };
  if ('targetRentPerUnit' in partial && overrides.targetRentsByType?.length) {
    const ratio = overrides.targetRentPerUnit > 0 ? (partial.targetRentPerUnit ?? overrides.targetRentPerUnit) / overrides.targetRentPerUnit : 1;
    ov.targetRentsByType = overrides.targetRentsByType.map(r => r * ratio);
  }
  if ('vacancyPct' in partial && overrides.vacancyByYear) {
    const updated: Record<number, number> = {};
    for (const yr of Object.keys(overrides.vacancyByYear)) updated[Number(yr)] = partial.vacancyPct ?? overrides.vacancyPct;
    ov.vacancyByYear = updated;
  }
  if ('rentGrowthPct' in partial && overrides.rentGrowthByYear) {
    const updated: Record<number, number> = {};
    for (const yr of Object.keys(overrides.rentGrowthByYear)) updated[Number(yr)] = partial.rentGrowthPct ?? overrides.rentGrowthPct;
    ov.rentGrowthByYear = updated;
  }
  if ('fixedExpenseGrowthPct' in partial) {
    const val = partial.fixedExpenseGrowthPct ?? overrides.fixedExpenseGrowthPct;
    if (overrides.fixedExpenseGrowthByYear) {
      const updated: Record<number, number> = {};
      for (const yr of Object.keys(overrides.fixedExpenseGrowthByYear)) updated[Number(yr)] = val;
      ov.fixedExpenseGrowthByYear = updated;
    }
    if (overrides.propertyTaxGrowthByYear) {
      const updated: Record<number, number> = {};
      for (const yr of Object.keys(overrides.propertyTaxGrowthByYear)) updated[Number(yr)] = val;
      ov.propertyTaxGrowthByYear = updated;
    }
  }
  return buildWhatIfResult(ov, deps);
}

function getIRR(partial: Partial<typeof overrides>): number {
  return buildWithSync(partial).irr ?? -999;
}

const baseIRR = getIRR({});

describe('Break-even variables — each one actually moves IRR when varied', () => {
  it('baseline IRR is reasonable', () => {
    expect(baseIRR).toBeGreaterThan(-50);
    expect(baseIRR).toBeLessThan(100);
  });

  it('targetRentPerUnit ↓ → IRR ↓', () => {
    expect(getIRR({ targetRentPerUnit: avgTargetRent * 0.7 })).toBeLessThan(baseIRR);
  });

  it('vacancyPct ↑ → IRR ↓', () => {
    expect(getIRR({ vacancyPct: 20 })).toBeLessThan(baseIRR);
  });

  it('rentGrowthPct ↓ → IRR ↓', () => {
    expect(getIRR({ rentGrowthPct: 0 })).toBeLessThan(baseIRR);
  });

  it('fixedExpenseGrowthPct ↑ → IRR ↓', () => {
    expect(getIRR({ fixedExpenseGrowthPct: 8 })).toBeLessThan(baseIRR);
  });

  it('interestRate ↑ → IRR ↓', () => {
    expect(getIRR({ interestRate: 12 })).toBeLessThan(baseIRR);
  });

  it('exitCapRate ↑ → IRR ↓', () => {
    expect(getIRR({ exitCapRate: 12 })).toBeLessThan(baseIRR);
  });

  it('purchasePrice ↑ → IRR ↓', () => {
    expect(getIRR({ purchasePrice: 1_500_000 })).toBeLessThan(baseIRR);
  });

  it('refiRate ↑ → IRR ↓', () => {
    expect(getIRR({ refiRate: 10 })).toBeLessThan(baseIRR);
  });

  it('propertyMgmtPct ↑ → IRR ↓', () => {
    expect(getIRR({ propertyMgmtPct: 12 })).toBeLessThan(baseIRR);
  });

  it('maintenancePct ↑ → IRR ↓', () => {
    expect(getIRR({ maintenancePct: 10 })).toBeLessThan(baseIRR);
  });
});

describe('Break-even WITHOUT sync (documents the bug)', () => {
  function buildNoSync(partial: Partial<typeof overrides>): CoCResult {
    return buildWhatIfResult({ ...overrides, ...partial }, deps);
  }

  it('vacancyPct change has NO effect without sync (bug)', () => {
    const base = buildNoSync({}).irr ?? 0;
    const worse = buildNoSync({ vacancyPct: 30 }).irr ?? 0;
    // Without sync, vacancyByYear overrides the slider → IRR barely changes
    expect(Math.abs(worse - base)).toBeLessThan(0.5);
  });

  it('fixedExpenseGrowthPct change has NO effect without sync (bug)', () => {
    const base = buildNoSync({}).irr ?? 0;
    const worse = buildNoSync({ fixedExpenseGrowthPct: 10 }).irr ?? 0;
    expect(Math.abs(worse - base)).toBeLessThan(0.5);
  });

  it('targetRentPerUnit change has NO effect without sync (bug)', () => {
    const base = buildNoSync({}).irr ?? 0;
    const worse = buildNoSync({ targetRentPerUnit: avgTargetRent * 0.5 }).irr ?? 0;
    // Without sync, targetRentsByType overrides targetRentPerUnit → same IRR
    expect(Math.abs(worse - base)).toBeLessThan(0.1);
  });
});
