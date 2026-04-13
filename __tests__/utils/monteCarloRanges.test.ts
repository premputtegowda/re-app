/**
 * Tests for MC range defaults, re-anchoring, and clamping logic.
 *
 * Scenario 1: No user override — pessimistic/optimistic scale from default settings
 * Scenario 2: User overrides a value — re-anchoring preserves the point spread
 *             when the base changes
 *
 * Also tests:
 * - higherIsWorse vs !higherIsWorse clamping direction
 * - getBaseExpenseGrowthRate excludes zero-growth and % of EGI expenses
 * - snapToMode precision handling
 */

import { describe, it, expect } from 'vitest';
import {
  computeDefaultRanges,
  rangesToMCRangeDefaults,
  MC_RANGE_DEFAULTS,
} from '@/utils/monteCarlo';
import type { MCRanges, MCRange, MCRangeDefaults } from '@/utils/monteCarlo';
import type { CoCAcquisition, CoCRefinance, ProFormaData } from '@/types';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeAcquisition(overrides: Partial<CoCAcquisition> = {}): CoCAcquisition {
  return {
    propertyAddress: '123 Main St',
    propertyType: 'sfr',
    units: 1,
    sfrBeds: 3, sfrBaths: 2,
    sfrInPlaceRent: 0, sfrPreStabRent: 1_800, sfrTargetRent: 2_000,
    unitMix: [],
    purchasePrice: 250_000,
    arv: 300_000,
    downPaymentPct: 20,
    closingCostsPct: 2,
    points: 0,
    additionalFeeItems: [],
    hardCostItems: [],
    softCostItems: [],
    opportunityCostItems: [],
    renovationMonths: 0,
    interestRate: 7,
    loanTermYears: 30,
    ioPeriodMonths: 0,
    stabilizedMonth: 1,
    projectionYears: 10,
    exitCapRate: 6,
    exitMethod: 'capRate' as const,
    exitClosingCostPct: 3,
    ...overrides,
  };
}

function makeProForma(overrides: Partial<ProFormaData> = {}): ProFormaData {
  return {
    grossRent:     { t12: 24_000, stab: null, stabilized: 24_000, growthPct: 3 },
    otherIncome:   { t12: 0,      stab: null, stabilized: 0,      growthPct: 2 },
    vacancyPct:    { t12: 5,      stab: null, stabilized: 5 },
    creditLossPct: { t12: 0,      stab: null, stabilized: 0 },
    expenses: [
      { id: 'mgmt', name: 'Property Management', isPercentOfEGI: true,  t12Value: 8,     stabValue: null, stabilizedValue: 8,     growthPct: 0 },
      { id: 'repr', name: 'Maintenance',          isPercentOfEGI: true,  t12Value: 5,     stabValue: null, stabilizedValue: 5,     growthPct: 0 },
      { id: 'tax',  name: 'Property Taxes',       isPercentOfEGI: false, t12Value: 3_000, stabValue: null, stabilizedValue: 3_000, growthPct: 2 },
      { id: 'ins',  name: 'Insurance',             isPercentOfEGI: false, t12Value: 1_500, stabValue: null, stabilizedValue: 1_500, growthPct: 2 },
      { id: 'cap',  name: 'CapEx Reserves',        isPercentOfEGI: false, t12Value: 500,   stabValue: null, stabilizedValue: 500,   growthPct: 0 },
    ],
    yearOverrides: {},
    ...overrides,
  };
}

function makeRefinance(): CoCRefinance {
  return {
    enabled: false,
    refiYear: 3, refiMarketValue: 0,
    newLTV: 75, newInterestRate: 6.5, newLoanTermYears: 30, refiCostPct: 2,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Simulate re-anchoring: given old ranges, old defaults, and new defaults, compute re-anchored ranges */
function reanchorRanges(ranges: MCRanges, oldDefaults: MCRanges, newDefaults: MCRanges): MCRanges {
  const result = { ...ranges };
  for (const key of Object.keys(newDefaults) as (keyof MCRanges)[]) {
    const oldD = oldDefaults[key];
    const newD = newDefaults[key];
    const r = ranges[key];
    if (!oldD || !newD || !r) continue;
    if (oldD.mode === newD.mode) continue;
    const minSpread = r.min - oldD.mode;
    const maxSpread = r.max - oldD.mode;
    result[key] = {
      min: newD.mode + minSpread,
      mode: newD.mode,
      max: newD.mode + maxSpread,
    };
  }
  return result;
}

/** Simulate commitPess clamping */
function clampPessimistic(value: number, mode: number, higherIsWorse: boolean): number {
  return higherIsWorse ? Math.max(value, mode) : Math.min(value, mode);
}

/** Simulate commitOptim clamping */
function clampOptimistic(value: number, mode: number, higherIsWorse: boolean): number {
  return higherIsWorse ? Math.min(value, mode) : Math.max(value, mode);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('computeDefaultRanges — Scenario 1: no user override', () => {
  const acq = makeAcquisition();
  const pf = makeProForma();
  const ranges = computeDefaultRanges(acq, pf, 2_000, 1, makeRefinance());

  it('rent: uses avgTargetRentPerUnit as base', () => {
    expect(ranges.targetRentPerUnit.mode).toBe(2_000); // avgTargetRentPerUnit, not stabilized/units/12
    expect(ranges.targetRentPerUnit.min).toBeCloseTo(2_000 * 0.85, 2); // −15%
    expect(ranges.targetRentPerUnit.max).toBeCloseTo(2_000 * 1.05, 2); // +5%
  });

  it('vacancy: uses Year 1 value (stabilized when no override)', () => {
    expect(ranges.vacancyPct.mode).toBe(5);
    expect(ranges.vacancyPct.max).toBe(5 + 8);  // pessimistic (higherIsWorse)
    expect(ranges.vacancyPct.min).toBe(5 - 2);   // optimistic
  });

  it('vacancy: uses Year 1 override when set', () => {
    const pfWithOverride = makeProForma({
      yearOverrides: { 1: { vacancyPct: 8 } },
    });
    const r = computeDefaultRanges(acq, pfWithOverride, 2_000, 1, makeRefinance());
    expect(r.vacancyPct.mode).toBe(8);
    expect(r.vacancyPct.max).toBe(8 + 8);
    expect(r.vacancyPct.min).toBe(8 - 2);
  });

  it('rent growth: uses Year 2 growth rate (default when no override)', () => {
    expect(ranges.rentGrowthPct.mode).toBe(3); // grossRent.growthPct
    expect(ranges.rentGrowthPct.min).toBe(3 - 2);  // pessimistic
    expect(ranges.rentGrowthPct.max).toBe(3 + 1);  // optimistic
  });

  it('rent growth: uses Year 2 override when set', () => {
    const pfWithOverride = makeProForma({
      yearOverrides: { 2: { grossRentGrowthPct: 4.5 } },
    });
    const r = computeDefaultRanges(acq, pfWithOverride, 2_000, 1, makeRefinance());
    expect(r.rentGrowthPct.mode).toBe(4.5);
    expect(r.rentGrowthPct.min).toBe(4.5 - 2);
    expect(r.rentGrowthPct.max).toBe(4.5 + 1);
  });

  it('exit cap rate: pessimistic is base + 2pts, optimistic is base − 0.5pts', () => {
    expect(ranges.exitCapRate.mode).toBe(6);
    expect(ranges.exitCapRate.max).toBe(6 + 2);    // pessimistic (higherIsWorse)
    expect(ranges.exitCapRate.min).toBe(6 - 0.5);  // optimistic
  });

  it('reno overrun: pessimistic is 30%, optimistic is 0', () => {
    expect(ranges.renoOverrunPct.mode).toBe(0);
    expect(ranges.renoOverrunPct.min).toBe(0);
    expect(ranges.renoOverrunPct.max).toBe(30);
  });

  it('interest rate: pessimistic is base + 0pts, optimistic is base − 0pts (defaults)', () => {
    expect(ranges.interestRate.mode).toBe(7);
    expect(ranges.interestRate.max).toBe(7 + 0);
    expect(ranges.interestRate.min).toBe(7 - 0);
  });

  it('expense growth: uses average of Year 2 growing fixed-dollar expenses', () => {
    // Tax growthPct=2, Insurance growthPct=2, CapEx growthPct=0 (excluded), Mgmt/Maint are %EGI (excluded)
    // Average = (2 + 2) / 2 = 2
    expect(ranges.expenseGrowthPct!.mode).toBe(2);
    expect(ranges.expenseGrowthPct!.max).toBe(2 + 2);  // pessimistic +2pts
    expect(ranges.expenseGrowthPct!.min).toBe(2 - 1);  // optimistic −1pt
  });

  it('expense growth: uses Year 2 override when set', () => {
    const pfWithOverride = makeProForma({
      yearOverrides: { 2: { expenseGrowthPcts: { tax: 3, ins: 4 } } },
    });
    const r = computeDefaultRanges(acq, pfWithOverride, 2_000, 1, makeRefinance());
    // Tax=3 (overridden), Insurance=4 (overridden), CapEx=0 (excluded)
    expect(r.expenseGrowthPct!.mode).toBe(3.5); // avg of (3, 4)
  });
});

describe('computeDefaultRanges — custom MCRangeDefaults', () => {
  it('applies user-saved defaults instead of MC_RANGE_DEFAULTS', () => {
    const customDefaults: MCRangeDefaults = {
      ...MC_RANGE_DEFAULTS,
      exitCapRatePessimisticPts: 3,
      exitCapRateOptimisticPts: 1,
    };
    const acq = makeAcquisition({ exitCapRate: 6 });
    const pf = makeProForma();
    const ranges = computeDefaultRanges(acq, pf, 2_000, 1, makeRefinance(), customDefaults);
    expect(ranges.exitCapRate.max).toBe(6 + 3);   // pessimistic
    expect(ranges.exitCapRate.min).toBe(6 - 1);   // optimistic
  });
});

describe('Scenario 2: re-anchoring preserves point spread when base changes', () => {
  const acq1 = makeAcquisition({ exitCapRate: 6 });
  const acq2 = makeAcquisition({ exitCapRate: 8 });
  const pf = makeProForma();
  const refi = makeRefinance();

  const defaults1 = computeDefaultRanges(acq1, pf, 2_000, 1, refi);
  const defaults2 = computeDefaultRanges(acq2, pf, 2_000, 1, refi);

  it('exit cap rate: spreads preserved when base moves from 6 to 8', () => {
    // Start with defaults: mode=6, min=5.5 (optim), max=8 (pessim)
    const oldRanges = { ...defaults1 };

    // User overrides pessimistic to 9 and optimistic to 4
    oldRanges.exitCapRate = { min: 4, mode: 6, max: 9 };
    // spreads: min=4-6=-2, max=9-6=+3

    const reanchored = reanchorRanges(oldRanges, defaults1, defaults2);
    // New mode=8, so: min=8+(-2)=6, max=8+3=11
    expect(reanchored.exitCapRate.mode).toBe(8);
    expect(reanchored.exitCapRate.min).toBe(6);
    expect(reanchored.exitCapRate.max).toBe(11);
  });

  it('vacancy: spreads preserved when base moves from 5 to 10', () => {
    const pf1 = makeProForma({ vacancyPct: { t12: 5, stab: null, stabilized: 5 } });
    const pf2 = makeProForma({ vacancyPct: { t12: 10, stab: null, stabilized: 10 } });

    const d1 = computeDefaultRanges(acq1, pf1, 2_000, 1, refi);
    const d2 = computeDefaultRanges(acq1, pf2, 2_000, 1, refi);

    // User overrides: pessimistic=15, optimistic=2
    const customRanges = { ...d1, vacancyPct: { min: 2, mode: 5, max: 15 } };
    // spreads: min=2-5=-3, max=15-5=+10

    const reanchored = reanchorRanges(customRanges, d1, d2);
    expect(reanchored.vacancyPct.mode).toBe(10);
    expect(reanchored.vacancyPct.min).toBe(10 - 3);  // 7
    expect(reanchored.vacancyPct.max).toBe(10 + 10); // 20
  });

  it('rent: spreads preserved when stabilized rent changes', () => {
    const pf1 = makeProForma({ grossRent: { t12: 24_000, stab: null, stabilized: 24_000, growthPct: 3 } });
    const pf2 = makeProForma({ grossRent: { t12: 30_000, stab: null, stabilized: 30_000, growthPct: 3 } });

    const d1 = computeDefaultRanges(acq1, pf1, 2_000, 1, refi);
    const d2 = computeDefaultRanges(acq1, pf2, 2_500, 1, refi);

    const baseRent1 = 24_000 / 12; // 2000
    const baseRent2 = 30_000 / 12; // 2500

    // User overrides: pessimistic=1800, optimistic=2200
    const customRanges = { ...d1, targetRentPerUnit: { min: 1800, mode: baseRent1, max: 2200 } };
    // spreads: min=1800-2000=-200, max=2200-2000=+200

    const reanchored = reanchorRanges(customRanges, d1, d2);
    expect(reanchored.targetRentPerUnit.mode).toBe(baseRent2);
    expect(reanchored.targetRentPerUnit.min).toBe(baseRent2 - 200);  // 2300
    expect(reanchored.targetRentPerUnit.max).toBe(baseRent2 + 200);  // 2700
  });

  it('unchanged base: range is not modified', () => {
    const customRanges = { ...defaults1, exitCapRate: { min: 4, mode: 6, max: 9 } };
    // defaults1 and defaults1 have same mode — no re-anchoring
    const reanchored = reanchorRanges(customRanges, defaults1, defaults1);
    expect(reanchored.exitCapRate).toEqual({ min: 4, mode: 6, max: 9 });
  });
});

describe('clamping — pessimistic and optimistic directions', () => {
  describe('higherIsWorse variables (exit cap, vacancy, expense growth, interest rate)', () => {
    const mode = 6;

    it('pessimistic clamps to at least mode (above mode)', () => {
      expect(clampPessimistic(8, mode, true)).toBe(8);   // above mode → kept
      expect(clampPessimistic(5, mode, true)).toBe(mode); // below mode → clamped up
      expect(clampPessimistic(6, mode, true)).toBe(mode); // equal → kept
    });

    it('optimistic clamps to at most mode (below mode)', () => {
      expect(clampOptimistic(4, mode, true)).toBe(4);     // below mode → kept
      expect(clampOptimistic(8, mode, true)).toBe(mode);  // above mode → clamped down
      expect(clampOptimistic(6, mode, true)).toBe(mode);  // equal → kept
    });
  });

  describe('!higherIsWorse variables (rent, rent growth)', () => {
    const mode = 2000;

    it('pessimistic clamps to at most mode (below mode)', () => {
      expect(clampPessimistic(1800, mode, false)).toBe(1800); // below mode → kept
      expect(clampPessimistic(2200, mode, false)).toBe(mode); // above mode → clamped down
      expect(clampPessimistic(2000, mode, false)).toBe(mode); // equal → kept
    });

    it('optimistic clamps to at least mode (above mode)', () => {
      expect(clampOptimistic(2200, mode, false)).toBe(2200); // above mode → kept
      expect(clampOptimistic(1800, mode, false)).toBe(mode); // below mode → clamped up
      expect(clampOptimistic(2000, mode, false)).toBe(mode); // equal → kept
    });
  });
});

describe('getBaseExpenseGrowthRate via computeDefaultRanges', () => {
  it('excludes CapEx (growthPct=0) and %EGI expenses', () => {
    const pf = makeProForma(); // Tax=2%, Insurance=2%, CapEx=0%, Mgmt=%EGI, Maint=%EGI
    const ranges = computeDefaultRanges(makeAcquisition(), pf, 2_000, 1, makeRefinance());
    expect(ranges.expenseGrowthPct!.mode).toBe(2); // avg of (2, 2) = 2
  });

  it('handles mixed growth rates', () => {
    const pf = makeProForma({
      expenses: [
        { id: 'tax', name: 'Property Taxes', isPercentOfEGI: false, t12Value: 3_000, stabValue: null, stabilizedValue: 3_000, growthPct: 2 },
        { id: 'ins', name: 'Insurance',       isPercentOfEGI: false, t12Value: 1_500, stabValue: null, stabilizedValue: 1_500, growthPct: 3 },
        { id: 'util', name: 'Utilities',       isPercentOfEGI: false, t12Value: 800,   stabValue: null, stabilizedValue: 800,   growthPct: 4 },
      ],
    });
    const ranges = computeDefaultRanges(makeAcquisition(), pf, 2_000, 1, makeRefinance());
    expect(ranges.expenseGrowthPct!.mode).toBe(3); // avg of (2, 3, 4) = 3
  });

  it('returns 0% when no growing fixed-dollar expenses exist (no uncertainty to model)', () => {
    const pf = makeProForma({
      expenses: [
        { id: 'mgmt', name: 'Property Management', isPercentOfEGI: true, t12Value: 8, stabValue: null, stabilizedValue: 8, growthPct: 0 },
      ],
    });
    const ranges = computeDefaultRanges(makeAcquisition(), pf, 2_000, 1, makeRefinance());
    expect(ranges.expenseGrowthPct!.mode).toBe(0);
  });

  it('rounds to 2 decimal places', () => {
    const pf = makeProForma({
      expenses: [
        { id: 'a', name: 'A', isPercentOfEGI: false, t12Value: 100, stabValue: null, stabilizedValue: 100, growthPct: 2 },
        { id: 'b', name: 'B', isPercentOfEGI: false, t12Value: 100, stabValue: null, stabilizedValue: 100, growthPct: 3 },
        { id: 'c', name: 'C', isPercentOfEGI: false, t12Value: 100, stabValue: null, stabilizedValue: 100, growthPct: 2 },
      ],
    });
    const ranges = computeDefaultRanges(makeAcquisition(), pf, 2_000, 1, makeRefinance());
    // avg = 7/3 = 2.333... → rounded to 2.33
    expect(ranges.expenseGrowthPct!.mode).toBe(2.33);
  });
});

describe('rangesToMCRangeDefaults — round-trip consistency', () => {
  it('reconstructed defaults match original when ranges come from computeDefaultRanges', () => {
    const acq = makeAcquisition();
    const pf = makeProForma();
    const ranges = computeDefaultRanges(acq, pf, 2_000, 1, makeRefinance());
    const reconstructed = rangesToMCRangeDefaults(ranges);

    expect(reconstructed.exitCapRatePessimisticPts).toBeCloseTo(MC_RANGE_DEFAULTS.exitCapRatePessimisticPts, 1);
    expect(reconstructed.exitCapRateOptimisticPts).toBeCloseTo(MC_RANGE_DEFAULTS.exitCapRateOptimisticPts, 1);
    expect(reconstructed.vacancyPessimisticPts).toBeCloseTo(MC_RANGE_DEFAULTS.vacancyPessimisticPts, 1);
    expect(reconstructed.vacancyOptimisticPts).toBeCloseTo(MC_RANGE_DEFAULTS.vacancyOptimisticPts, 1);
    expect(reconstructed.rentGrowthPessimisticPts).toBeCloseTo(MC_RANGE_DEFAULTS.rentGrowthPessimisticPts, 1);
    expect(reconstructed.rentGrowthOptimisticPts).toBeCloseTo(MC_RANGE_DEFAULTS.rentGrowthOptimisticPts, 1);
  });

  it('preserves user-overridden spreads', () => {
    const customRanges: MCRanges = {
      targetRentPerUnit: { min: 1700, mode: 2000, max: 2300 },
      vacancyPct:        { min: 3, mode: 5, max: 15 },
      rentGrowthPct:     { min: 1, mode: 3, max: 5 },
      exitCapRate:       { min: 4, mode: 6, max: 9 },
      renoOverrunPct:    { min: 0, mode: 0, max: 40 },
      interestRate:      { min: 6, mode: 7, max: 9 },
      refiRate:          { min: 5.5, mode: 6.5, max: 8.5 },
      expenseGrowthPct:  { min: 1, mode: 2, max: 4 },
    };

    const reconstructed = rangesToMCRangeDefaults(customRanges);

    // Exit cap: pessimistic = max - mode = 9 - 6 = 3, optimistic = mode - min = 6 - 4 = 2
    expect(reconstructed.exitCapRatePessimisticPts).toBe(3);
    expect(reconstructed.exitCapRateOptimisticPts).toBe(2);

    // Vacancy: pessimistic = max - mode = 15 - 5 = 10, optimistic = mode - min = 5 - 3 = 2
    expect(reconstructed.vacancyPessimisticPts).toBe(10);
    expect(reconstructed.vacancyOptimisticPts).toBe(2);

    // Rent growth: pessimistic = mode - min = 3 - 1 = 2, optimistic = max - mode = 5 - 3 = 2
    expect(reconstructed.rentGrowthPessimisticPts).toBe(2);
    expect(reconstructed.rentGrowthOptimisticPts).toBe(2);
  });
});
