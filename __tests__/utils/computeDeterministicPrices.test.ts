/**
 * Tests for computeDeterministicPrices — the analytical alternative to
 * sampled-run price solving. Core invariant: recommendedMaxPrice ≥
 * conservativeMaxPrice (Ideal Entry) for any valid MCRanges. The switch to
 * this helper in MonteCarloPanel relies on that monotonicity.
 */

import { describe, it, expect } from 'vitest';
import { computeDeterministicPrices } from '@/utils/monteCarlo';
import type { MCRanges } from '@/utils/monteCarlo';
import type { CoCAcquisition, CoCOperations, ProFormaData, CoCRefinance } from '@/types';

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makeAcquisition(overrides: Partial<CoCAcquisition> = {}): CoCAcquisition {
  return {
    propertyAddress: '1234 Oak St',
    propertyType: 'mfr',
    units: 48,
    sfrBeds: 0, sfrBaths: 0,
    sfrInPlaceRent: 0, sfrPreStabRent: 0, sfrTargetRent: 0,
    unitMix: [],
    purchasePrice: 8_000_000,
    arv: 9_000_000,
    downPaymentPct: 30,
    closingCostsPct: 2,
    points: 0,
    additionalFeeItems: [],
    hardCostItems: [],
    softCostItems: [],
    opportunityCostItems: [],
    renovationMonths: 0,
    interestRate: 6.5,
    loanTermYears: 30,
    ioPeriodMonths: 0,
    stabilizedMonth: 1,
    projectionYears: 10,
    exitCapRate: 6,
    exitMethod: 'capRate',
    exitClosingCostPct: 3,
    ...overrides,
  };
}

function makeOperations(overrides: Partial<CoCOperations> = {}): CoCOperations {
  return {
    grossRentMonthly: 96_000,
    vacancyRatePct: 5,
    opexPct: 30,
    propertyMgmtPct: 8,
    annualRentGrowthPct: 3,
    ...overrides,
  };
}

function makeProForma(overrides: Partial<ProFormaData> = {}): ProFormaData {
  return {
    grossRent:     { t12: 1_152_000, stab: null, stabilized: 1_152_000, growthPct: 3 },
    otherIncome:   { t12: 0, stab: null, stabilized: 0, growthPct: 2 },
    vacancyPct:    { t12: 5, stab: null, stabilized: 5 },
    creditLossPct: { t12: 0, stab: null, stabilized: 0 },
    expenses: [
      { id: 'tax', name: 'Property Taxes', isPercentOfEGI: false, t12Value: 48_000, stabValue: null, stabilizedValue: 48_000, growthPct: 2 },
    ],
    yearOverrides: {},
    ...overrides,
  };
}

function makeRefinance(overrides: Partial<CoCRefinance> = {}): CoCRefinance {
  return {
    enabled: false,
    refiYear: 3, refiMarketValue: 0, newLTV: 75, newInterestRate: 6.5, newLoanTermYears: 30, refiCostPct: 2,
    ...overrides,
  };
}

function makeRanges(overrides: Partial<MCRanges> = {}): MCRanges {
  return {
    targetRentPerUnit: { min: 1_800, mode: 2_000, max: 2_150 },
    vacancyPct:        { min: 3,     mode: 5,     max: 10 },
    rentGrowthPct:     { min: 1.5,   mode: 3,     max: 4.5 },
    exitCapRate:       { min: 5,     mode: 6,     max: 7.5 },
    renoOverrunPct:    { min: 0,     mode: 0,     max: 15 },
    interestRate:      { min: 6,     mode: 6.5,   max: 7.5 },
    refiRate:          { min: 5.5,   mode: 6,     max: 7 },
    expenseGrowthPct:  { min: 1,     mode: 2,     max: 4 },
    ...overrides,
  };
}

// ── Monotonicity invariant ───────────────────────────────────────────────────

describe('computeDeterministicPrices — monotonicity invariant', () => {
  it('base case: recommendedMaxPrice >= conservativeMaxPrice', () => {
    const prices = computeDeterministicPrices(
      makeRanges(), 12,
      makeAcquisition(), makeOperations(), makeProForma(), makeRefinance(),
      48, 1_800,
    );
    expect(prices.recommendedMaxPrice).not.toBeNull();
    expect(prices.conservativeMaxPrice).not.toBeNull();
    if (prices.recommendedMaxPrice !== null && prices.conservativeMaxPrice !== null) {
      expect(prices.recommendedMaxPrice).toBeGreaterThanOrEqual(prices.conservativeMaxPrice);
    }
  });

  // Sweep several range shapes: wide, narrow, skewed toward bad, skewed toward good.
  const rangeVariants: Array<[string, Partial<MCRanges>]> = [
    ['narrow spread', {
      vacancyPct:    { min: 4.5, mode: 5,   max: 5.5 },
      rentGrowthPct: { min: 2.5, mode: 3,   max: 3.5 },
      exitCapRate:   { min: 5.8, mode: 6,   max: 6.2 },
    }],
    ['wide spread', {
      vacancyPct:    { min: 2,  mode: 5,  max: 20 },
      rentGrowthPct: { min: -1, mode: 3,  max: 8 },
      exitCapRate:   { min: 4,  mode: 6,  max: 10 },
    }],
    ['skewed pessimistic (mode near max on bad vars)', {
      vacancyPct:  { min: 5, mode: 14, max: 15 },
      exitCapRate: { min: 6, mode: 7.3, max: 7.5 },
    }],
    ['skewed optimistic (mode near min on bad vars)', {
      vacancyPct:  { min: 3, mode: 3.2, max: 12 },
      exitCapRate: { min: 5, mode: 5.1, max: 8 },
    }],
    ['all modes near rent max (optimistic on upside lever)', {
      targetRentPerUnit: { min: 1_800, mode: 2_140, max: 2_150 },
      rentGrowthPct:     { min: 1,     mode: 4.4,   max: 4.5 },
    }],
  ];

  for (const [label, rangeOverride] of rangeVariants) {
    it(`holds for range variant: ${label}`, () => {
      const prices = computeDeterministicPrices(
        makeRanges(rangeOverride), 12,
        makeAcquisition(), makeOperations(), makeProForma(), makeRefinance(),
        48, 1_800,
      );
      if (prices.recommendedMaxPrice !== null && prices.conservativeMaxPrice !== null) {
        expect(prices.recommendedMaxPrice).toBeGreaterThanOrEqual(prices.conservativeMaxPrice);
      }
    });
  }

  it('holds for an ARV-exit scenario (range includes arv)', () => {
    const rangesWithArv: MCRanges = {
      ...makeRanges(),
      arv: { min: 8_500_000, mode: 9_000_000, max: 9_500_000 },
    };
    const prices = computeDeterministicPrices(
      rangesWithArv, 12,
      makeAcquisition({ exitMethod: 'value' }), makeOperations(), makeProForma(), makeRefinance(),
      48, 1_800,
    );
    if (prices.recommendedMaxPrice !== null && prices.conservativeMaxPrice !== null) {
      expect(prices.recommendedMaxPrice).toBeGreaterThanOrEqual(prices.conservativeMaxPrice);
    }
  });

  it('holds with refinance enabled', () => {
    const prices = computeDeterministicPrices(
      makeRanges(), 12,
      makeAcquisition(), makeOperations(), makeProForma(),
      makeRefinance({ enabled: true, refiYear: 3, refiMarketValue: 9_500_000 }),
      48, 1_800,
    );
    if (prices.recommendedMaxPrice !== null && prices.conservativeMaxPrice !== null) {
      expect(prices.recommendedMaxPrice).toBeGreaterThanOrEqual(prices.conservativeMaxPrice);
    }
  });

  it('returns both prices as numbers (not null) for a feasible deal', () => {
    const prices = computeDeterministicPrices(
      makeRanges(), 12,
      makeAcquisition(), makeOperations(), makeProForma(), makeRefinance(),
      48, 1_800,
    );
    expect(typeof prices.recommendedMaxPrice).toBe('number');
    expect(typeof prices.conservativeMaxPrice).toBe('number');
  });
});

// ── Target IRR responsiveness ────────────────────────────────────────────────

describe('computeDeterministicPrices — target IRR responsiveness', () => {
  // findMaxPriceAtConditions caps at acquisition.purchasePrice when the current
  // price already hits target, so we stretch the test with a purchase price
  // that is intentionally above the 18%-IRR-feasible level.
  it('higher target IRR → lower max prices (when current price is not already feasible)', () => {
    const stretched = makeAcquisition({ purchasePrice: 15_000_000 });
    const low = computeDeterministicPrices(
      makeRanges(), 8, stretched, makeOperations(), makeProForma(), makeRefinance(), 48, 1_800,
    );
    const high = computeDeterministicPrices(
      makeRanges(), 18, stretched, makeOperations(), makeProForma(), makeRefinance(), 48, 1_800,
    );
    if (low.recommendedMaxPrice !== null && high.recommendedMaxPrice !== null) {
      expect(high.recommendedMaxPrice).toBeLessThanOrEqual(low.recommendedMaxPrice);
    }
  });
});

// ── Degenerate ranges ────────────────────────────────────────────────────────

describe('computeDeterministicPrices — degenerate ranges', () => {
  it('when every range is a point (min=mode=max), recommended equals conservative', () => {
    const point: MCRanges = {
      targetRentPerUnit: { min: 2_000, mode: 2_000, max: 2_000 },
      vacancyPct:        { min: 5,     mode: 5,     max: 5 },
      rentGrowthPct:     { min: 3,     mode: 3,     max: 3 },
      exitCapRate:       { min: 6,     mode: 6,     max: 6 },
      renoOverrunPct:    { min: 0,     mode: 0,     max: 0 },
      interestRate:      { min: 6.5,   mode: 6.5,   max: 6.5 },
      refiRate:          { min: 6,     mode: 6,     max: 6 },
      expenseGrowthPct:  { min: 2,     mode: 2,     max: 2 },
    };
    const prices = computeDeterministicPrices(
      point, 12,
      makeAcquisition(), makeOperations(), makeProForma(), makeRefinance(),
      48, 1_800,
    );
    expect(prices.recommendedMaxPrice).toBe(prices.conservativeMaxPrice);
  });
});
