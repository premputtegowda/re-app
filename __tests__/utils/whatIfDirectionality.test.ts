/**
 * Tests that every What-If slider moves IRR in the CORRECT direction.
 *
 * Bug being guarded: the anniversary model's per-type target rents weren't
 * scaled with the What-If rent slider, causing LTL to invert and IRR to
 * move the wrong way when rent was lowered.
 *
 * For each variable, we build a baseline and a "worse" scenario, then
 * assert that the worse scenario produces a LOWER IRR (or higher for
 * variables where higher = worse, like vacancy or interest rate).
 */

import { describe, it, expect } from 'vitest';
import { buildWhatIfResult, computeAvgRents } from '@/utils/whatIfCalc';
import type { CoCAcquisition, CoCOperations, CoCRefinance, ProFormaData } from '@/types';

// ── Fixtures ────────────────────────────────────────────────────────────────

const acquisition: CoCAcquisition = {
  propertyAddress: '10 Oak Ave',
  propertyType: 'mfr',
  units: 10,
  sfrBeds: 0,
  sfrBaths: 0,
  sfrInPlaceRent: 0,
  sfrTargetRent: 0,
  sfrPreStabRent: 0,
  unitMix: [
    { id: 'a', beds: 3, baths: 1, count: 5, inPlaceRent: 1200, rentMonthly: 1500, preStabRent: 1320, leaseUpUnits: 3, unitsToRenovate: 2 },
    { id: 'b', beds: 2, baths: 1, count: 5, inPlaceRent: 800, rentMonthly: 1000, preStabRent: 880, leaseUpUnits: 3, unitsToRenovate: 2 },
  ],
  purchasePrice: 1_000_000,
  downPaymentPct: 25,
  closingCostsPct: 3,
  interestRate: 7,
  loanTermYears: 30,
  ioPeriodMonths: 0,
  points: 0,
  arv: 1_200_000,
  exitMethod: 'capRate' as const,
  exitCapRate: 8,
  exitClosingCostPct: 3,
  projectionYears: 5,
  hardCostItems: [],
  softCostItems: [],
  opportunityCostItems: [],
  additionalFeeItems: [],
};

const operations: CoCOperations = {
  grossRentMonthly: 12500,
  annualRentGrowthPct: 3,
  vacancyRatePct: 5,
  opexPct: 0,
  propertyMgmtPct: 8,
};

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
  yearOverrides: {
    1: { grossRent: 125_500, grossRentSystem: true },
  },
  leaseAnniversaryDistribution: [0, 2, 0, 0, 0, 2, 0, 2, 0, 2, 0, 2],
  leaseAnniversaryByType: [
    { targetRent: 1500, distribution: [0, 1, 0, 0, 0, 1, 0, 1, 0, 1, 0, 1] },
    { targetRent: 1000, distribution: [0, 1, 0, 0, 0, 1, 0, 1, 0, 1, 0, 1] },
  ],
};

const refinance: CoCRefinance = {
  enabled: true,
  refiYear: 3,
  newLTV: 75,
  newInterestRate: 6.5,
  newLoanTermYears: 30,
  refiMarketValue: 1_200_000,
  refiCostPct: 1,
};

const { units, avgTargetRent, avgPreStabRent } = computeAvgRents(acquisition);

const baseDeps = {
  acquisition,
  operations,
  proForma,
  refinance,
  units,
  origStabilizedAnnual: proForma.grossRent.stabilized,
  defaultPreStabAnnual: avgPreStabRent * units * 12,
  defaultFixedExpenseGrowthPct: 2,
};

const baseOverrides = {
  targetRentPerUnit: avgTargetRent,
  preStabRentPerUnit: avgPreStabRent,
  vacancyPct: proForma.vacancyPct.stabilized,
  rentGrowthPct: proForma.grossRent.growthPct,
  propertyMgmtPct: 8,
  maintenancePct: 5,
  fixedExpenseGrowthPct: 2,
  interestRate: acquisition.interestRate,
  exitCapRate: acquisition.exitCapRate,
  purchasePrice: acquisition.purchasePrice,
  projectionYears: acquisition.projectionYears,
  refiRate: refinance.newInterestRate,
  refiYear: refinance.refiYear,
};

function getIRR(overrides: typeof baseOverrides): number {
  const result = buildWhatIfResult(overrides, baseDeps);
  return result.irr ?? 0;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('What-If directionality — every variable moves IRR correctly', () => {
  const baseIRR = getIRR(baseOverrides);

  it('baseline IRR is a reasonable positive number', () => {
    expect(baseIRR).toBeGreaterThan(0);
    expect(baseIRR).toBeLessThan(100);
  });

  // ── Variables where LOWER = worse (IRR should decrease) ──

  it('target rent ↓ → IRR ↓ (the bug this fix addresses)', () => {
    const worse = getIRR({ ...baseOverrides, targetRentPerUnit: avgTargetRent * 0.8 });
    expect(worse).toBeLessThan(baseIRR);
  });

  it('pre-stab rent slider does not affect IRR (simulator computes Year 1 from in-place + target)', () => {
    // With the simulator-based What-If, pre-stab is not an input — the simulator
    // derives Year 1 from in-place and target rents directly. So changing pre-stab
    // has no effect on projections.
    const same = getIRR({ ...baseOverrides, preStabRentPerUnit: avgPreStabRent * 0.7 });
    expect(Math.abs(same - baseIRR)).toBeLessThan(0.01);
  });

  it('rent growth ↓ → IRR ↓', () => {
    const worse = getIRR({ ...baseOverrides, rentGrowthPct: 0 });
    expect(worse).toBeLessThan(baseIRR);
  });

  // ── Variables where HIGHER = worse (IRR should decrease) ──

  it('vacancy ↑ → IRR ↓', () => {
    const worse = getIRR({ ...baseOverrides, vacancyPct: 15 });
    expect(worse).toBeLessThan(baseIRR);
  });

  it('interest rate ↑ → IRR ↓', () => {
    const worse = getIRR({ ...baseOverrides, interestRate: 10 });
    expect(worse).toBeLessThan(baseIRR);
  });

  it('purchase price ↑ → IRR ↓', () => {
    const worse = getIRR({ ...baseOverrides, purchasePrice: 1_300_000 });
    expect(worse).toBeLessThan(baseIRR);
  });

  it('property management ↑ → IRR ↓', () => {
    const worse = getIRR({ ...baseOverrides, propertyMgmtPct: 12 });
    expect(worse).toBeLessThan(baseIRR);
  });

  it('maintenance ↑ → IRR ↓', () => {
    const worse = getIRR({ ...baseOverrides, maintenancePct: 10 });
    expect(worse).toBeLessThan(baseIRR);
  });

  it('fixed expense growth ↑ → IRR ↓', () => {
    const worse = getIRR({ ...baseOverrides, fixedExpenseGrowthPct: 6 });
    expect(worse).toBeLessThan(baseIRR);
  });

  it('exit cap rate ↑ → IRR ↓ (lower terminal value)', () => {
    const worse = getIRR({ ...baseOverrides, exitCapRate: 12 });
    expect(worse).toBeLessThan(baseIRR);
  });

  it('refi rate ↑ → IRR ↓', () => {
    const worse = getIRR({ ...baseOverrides, refiRate: 9 });
    expect(worse).toBeLessThan(baseIRR);
  });

  // ── Variables where BETTER = higher IRR ──

  it('target rent ↑ → IRR ↑', () => {
    const better = getIRR({ ...baseOverrides, targetRentPerUnit: avgTargetRent * 1.2 });
    expect(better).toBeGreaterThan(baseIRR);
  });

  it('purchase price ↓ → IRR ↑', () => {
    const better = getIRR({ ...baseOverrides, purchasePrice: 800_000 });
    expect(better).toBeGreaterThan(baseIRR);
  });

  it('vacancy ↓ → IRR ↑', () => {
    const better = getIRR({ ...baseOverrides, vacancyPct: 2 });
    expect(better).toBeGreaterThan(baseIRR);
  });

  it('interest rate ↓ → IRR ↑', () => {
    const better = getIRR({ ...baseOverrides, interestRate: 5 });
    expect(better).toBeGreaterThan(baseIRR);
  });
});
