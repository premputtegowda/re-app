import { describe, it, expect } from 'vitest';
import { computeMcRangesStatus } from '@/utils/mcRangesStatus';
import type { MCRanges } from '@/utils/monteCarlo';
import type { CoCAcquisition, CoCRefinance } from '@/types';

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

describe('computeMcRangesStatus — never reviewed', () => {
  it('returns hard when reviewedAt is null', () => {
    const s = computeMcRangesStatus({
      acquisition: makeAcquisition(),
      refinance: makeRefinance(),
      ranges: null,
      reviewedAt: null,
    });
    expect(s.status).toBe('hard');
    expect(s.reasons[0]).toMatch(/not reviewed/i);
  });
});

describe('computeMcRangesStatus — clean cases', () => {
  it('returns clean when nothing has drifted and all structural items match', () => {
    const s = computeMcRangesStatus({
      acquisition: makeAcquisition(),
      refinance: makeRefinance(),
      ranges: makeRanges(),
      reviewedAt: '2026-04-22T00:00:00Z',
    });
    expect(s.status).toBe('clean');
    expect(s.reasons).toEqual([]);
  });
});

describe('computeMcRangesStatus — soft triggers from structure', () => {
  it('flags soft (not hard) when rehab is set but renoOverrunPct max is zero', () => {
    // This is a user-correctable misconfiguration but doesn't break
    // anything downstream — MC just runs with 0% overrun. Nudge, don't block.
    const s = computeMcRangesStatus({
      acquisition: makeAcquisition({
        hardCostItems: [{ id: 'a', description: 'Kitchen', amount: 50_000 }],
      }),
      refinance: makeRefinance(),
      ranges: makeRanges({ renoOverrunPct: { min: 0, mode: 0, max: 0 } }),
      reviewedAt: '2026-04-22T00:00:00Z',
    });
    expect(s.status).toBe('soft');
    expect(s.reasons.some(r => /rehab/i.test(r))).toBe(true);
  });

  it('does NOT flag when refinance is enabled but ranges lack refiRate (step merges defaults)', () => {
    const { refiRate: _refiRate, ...rangesNoRefi } = makeRanges();
    const s = computeMcRangesStatus({
      acquisition: makeAcquisition(),
      refinance: makeRefinance({ enabled: true }),
      ranges: rangesNoRefi as MCRanges,
      reviewedAt: '2026-04-22T00:00:00Z',
    });
    expect(s.status).toBe('clean');
  });

  it('does NOT flag when exit method expects ARV but ranges lack arv', () => {
    const s = computeMcRangesStatus({
      acquisition: makeAcquisition({ exitMethod: 'value', arv: 9_000_000 }),
      refinance: makeRefinance(),
      ranges: makeRanges(),  // no arv key
      reviewedAt: '2026-04-22T00:00:00Z',
    });
    expect(s.status).toBe('clean');
  });
});

describe('computeMcRangesStatus — soft triggers', () => {
  it('flags soft when interest rate drifted > 15% from ranges anchor', () => {
    const s = computeMcRangesStatus({
      acquisition: makeAcquisition({ interestRate: 8.5 }), // anchor was 6.5 → +30%
      refinance: makeRefinance(),
      ranges: makeRanges(),
      reviewedAt: '2026-04-22T00:00:00Z',
    });
    expect(s.status).toBe('soft');
    expect(s.reasons.some(r => /interest/i.test(r))).toBe(true);
  });

  it('flags soft when cap rate drifted > 15% (and exit method is capRate)', () => {
    const s = computeMcRangesStatus({
      acquisition: makeAcquisition({ exitCapRate: 7.5 }), // anchor was 6 → +25%
      refinance: makeRefinance(),
      ranges: makeRanges(),
      reviewedAt: '2026-04-22T00:00:00Z',
    });
    expect(s.status).toBe('soft');
  });

  it('does NOT flag cap rate drift when exit method is value (cap rate not used)', () => {
    const s = computeMcRangesStatus({
      acquisition: makeAcquisition({ exitMethod: 'value', exitCapRate: 99, arv: 9_000_000 }),
      refinance: makeRefinance(),
      ranges: makeRanges({ arv: { min: 8_000_000, mode: 9_000_000, max: 10_000_000 } }),
      reviewedAt: '2026-04-22T00:00:00Z',
    });
    // No hard triggers, no interest drift, cap rate irrelevant → clean
    expect(s.status).toBe('clean');
  });
});

describe('computeMcRangesStatus — precedence', () => {
  it('never-reviewed beats soft drift', () => {
    // reviewedAt null is the only hard trigger now. Even with clean ranges
    // and no drift, never-reviewed should come through as hard.
    const s = computeMcRangesStatus({
      acquisition: makeAcquisition({ interestRate: 8.5 }),
      refinance: makeRefinance(),
      ranges: null,
      reviewedAt: null,
    });
    expect(s.status).toBe('hard');
  });
});
