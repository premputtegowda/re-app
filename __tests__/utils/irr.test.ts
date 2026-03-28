import { describe, it, expect } from 'vitest';
import { calculateIRR, calculateNPV, projectScenario } from '@/utils/dealAnalyzerCalc';
import type { CoCScenario } from '@/types';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Returns a minimal valid scenario with sane defaults. */
function makeScenario(overrides: Partial<CoCScenario['acquisition']> = {}): CoCScenario {
  return {
    id: 'test',
    name: 'Test',
    scenarioType: 'base',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    acquisition: {
      propertyAddress: '123 Main St',
      propertyType: 'sfr',
      units: 1,
      sfrBeds: 3,
      sfrBaths: 2,
      sfrInPlaceRent: 0,
      sfrPreStabRent: 0,
      sfrTargetRent: 0,
      unitMix: [],
      purchasePrice: 300_000,
      arv: 350_000,
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
      projectionYears: 5,
      exitCapRate: 0,
      exitClosingCostPct: 3,
      ...overrides,
    },
    operations: {
      grossRentMonthly: 2000,
      vacancyRatePct: 5,
      opexPct: 30,
      propertyMgmtPct: 8,
      annualRentGrowthPct: 3,
    },
    refinance: {
      enabled: false,
      refiYear: 3,
      refiMarketValue: 0,
      newLTV: 75,
      newInterestRate: 6.5,
      newLoanTermYears: 30,
      refiCostPct: 2,
    },
  };
}

// ── calculateNPV ──────────────────────────────────────────────────────────────

describe('calculateNPV', () => {
  it('at rate 0 returns sum of all cash flows', () => {
    expect(calculateNPV(0, [-100, 40, 40, 40])).toBeCloseTo(20, 6);
  });

  it('single immediate cash flow equals that amount (index 0 is not discounted)', () => {
    expect(calculateNPV(0.1, [-500])).toBeCloseTo(-500, 6);
  });

  it('is zero at the IRR rate', () => {
    // IRR of [-100, 110] = 10%
    expect(calculateNPV(0.1, [-100, 110])).toBeCloseTo(0, 6);
  });

  it('is positive when rate is below IRR', () => {
    expect(calculateNPV(0.05, [-100, 110])).toBeGreaterThan(0);
  });

  it('is negative when rate is above IRR', () => {
    expect(calculateNPV(0.15, [-100, 110])).toBeLessThan(0);
  });

  it('discounts future cash flows correctly at 10%', () => {
    // PV = -1000 + 500/1.1 + 500/1.1^2 ≈ -132.23
    const expected = -1000 + 500 / 1.1 + 500 / 1.21;
    expect(calculateNPV(0.1, [-1000, 500, 500])).toBeCloseTo(expected, 4);
  });
});

// ── calculateIRR ──────────────────────────────────────────────────────────────

describe('calculateIRR', () => {
  // ── Exact known values ──

  it('returns 10% for [-100, 110] (simple 1-year return)', () => {
    const result = calculateIRR([-100, 110]);
    expect(result).not.toBeNull();
    expect(result! * 100).toBeCloseTo(10, 4);
  });

  it('returns 10% for [-100, 0, 121] (2-year compounding)', () => {
    const result = calculateIRR([-100, 0, 121]);
    expect(result).not.toBeNull();
    expect(result! * 100).toBeCloseTo(10, 4);
  });

  it('returns 0% for [-100, 100] (break-even)', () => {
    const result = calculateIRR([-100, 100]);
    expect(result).not.toBeNull();
    expect(result! * 100).toBeCloseTo(0, 2);
  });

  it('returns 100% for [-100, 200] (doubling in one year)', () => {
    const result = calculateIRR([-100, 200]);
    expect(result).not.toBeNull();
    expect(result! * 100).toBeCloseTo(100, 2);
  });

  it('returns negative IRR for a loss scenario [-100, 80]', () => {
    const result = calculateIRR([-100, 80]);
    expect(result).not.toBeNull();
    expect(result!).toBeLessThan(0);
    expect(result! * 100).toBeCloseTo(-20, 2);
  });

  // ── Multi-year scenarios ──

  it('returns ~23.4% for 3 equal $50 paybacks on $100 investment', () => {
    // 50/(1+r) + 50/(1+r)^2 + 50/(1+r)^3 = 100 → r ≈ 23.375%
    const result = calculateIRR([-100, 50, 50, 50]);
    expect(result).not.toBeNull();
    expect(result! * 100).toBeCloseTo(23.375, 1);
  });

  it('satisfies NPV≈0 at the returned rate for a 5-year series', () => {
    const cashFlows = [-50_000, 3_000, 4_000, 5_000, 6_000, 60_000];
    const rate = calculateIRR(cashFlows);
    expect(rate).not.toBeNull();
    expect(calculateNPV(rate!, cashFlows)).toBeCloseTo(0, 2);
  });

  it('satisfies NPV≈0 for large real-estate-style cash flows', () => {
    const cashFlows = [-100_000, 5_000, 5_500, 6_000, 6_500, 130_000];
    const rate = calculateIRR(cashFlows);
    expect(rate).not.toBeNull();
    expect(calculateNPV(rate!, cashFlows)).toBeCloseTo(0, 1);
  });

  // ── Edge cases — null returns ──

  it('returns null when all cash flows are negative', () => {
    expect(calculateIRR([-100, -50, -30])).toBeNull();
  });

  it('returns null when all cash flows are positive', () => {
    expect(calculateIRR([100, 50, 30])).toBeNull();
  });

  it('returns null for empty cash flow array', () => {
    expect(calculateIRR([])).toBeNull();
  });

  it('returns null for a single cash flow (no sign change possible)', () => {
    expect(calculateIRR([-100])).toBeNull();
    expect(calculateIRR([100])).toBeNull();
  });

  it('returns null for all-zero cash flows', () => {
    expect(calculateIRR([0, 0, 0])).toBeNull();
  });

  // ── Multiple roots — bisection picks the smallest positive root ──

  it('picks the smallest positive root for non-conventional cash flows', () => {
    // [-100, 230, -132] has two roots: ~10% and ~20%. Bisection should return ~10%.
    const result = calculateIRR([-100, 230, -132]);
    expect(result).not.toBeNull();
    expect(result! * 100).toBeCloseTo(10, 1);
  });
});

// ── projectScenario IRR ───────────────────────────────────────────────────────

describe('projectScenario — IRR', () => {
  it('returns a non-null IRR for a profitable deal', () => {
    const scenario = makeScenario();
    const result = projectScenario(scenario);
    expect(result.irr).not.toBeNull();
    expect(result.irr!).toBeGreaterThan(0);
  });

  it('satisfies NPV≈0 at the returned IRR rate', () => {
    const scenario = makeScenario();
    const result = projectScenario(scenario);
    expect(result.irr).not.toBeNull();
    const rate = result.irr! / 100;
    expect(calculateNPV(rate, result.irrCashFlows)).toBeCloseTo(0, 0);
  });

  it('irrCashFlows[0] is negative (the initial investment)', () => {
    const result = projectScenario(makeScenario());
    expect(result.irrCashFlows[0]).toBeLessThan(0);
  });

  it('irrCashFlows length equals projectionYears + 1', () => {
    const scenario = makeScenario({ projectionYears: 7 });
    const result = projectScenario(scenario);
    expect(result.irrCashFlows).toHaveLength(8); // 1 initial + 7 years
  });

  it('terminal equity is added to the last year cash flow', () => {
    const result = projectScenario(makeScenario());
    const lastYear = result.yearlyProjections[result.yearlyProjections.length - 1];
    const lastIrrCf = result.irrCashFlows[result.irrCashFlows.length - 1];
    expect(lastIrrCf).toBeCloseTo(lastYear.cashFlow + result.terminalEquity, 0);
  });

  it('higher ARV produces higher IRR (all else equal)', () => {
    const low  = projectScenario(makeScenario({ arv: 300_000 }));
    const high = projectScenario(makeScenario({ arv: 500_000 }));
    expect(high.irr!).toBeGreaterThan(low.irr!);
  });

  it('lower purchase price produces higher IRR (less equity deployed)', () => {
    const expensive = projectScenario(makeScenario({ purchasePrice: 400_000 }));
    const cheap     = projectScenario(makeScenario({ purchasePrice: 200_000 }));
    expect(cheap.irr!).toBeGreaterThan(expensive.irr!);
  });

  it('shorter hold produces higher IRR when annual cash flows are negative', () => {
    // This scenario has negative annual cash flows (debt service > NOI).
    // Exiting sooner means fewer loss years before capturing terminal equity.
    const short = projectScenario(makeScenario({ projectionYears: 3 }));
    const long  = projectScenario(makeScenario({ projectionYears: 10 }));
    expect(short.irr!).toBeGreaterThan(long.irr!);
  });

  it('uses exit cap rate to compute terminal value when set', () => {
    const withCap    = projectScenario(makeScenario({ exitCapRate: 6, arv: 350_000 }));
    const withoutCap = projectScenario(makeScenario({ exitCapRate: 0, arv: 350_000 }));
    // Terminal value via cap rate = NOI / cap rate — different from ARV
    expect(withCap.terminalPropertyValue).not.toEqual(withoutCap.terminalPropertyValue);
  });

  it('exit closing costs reduce terminal equity', () => {
    const lowCosts  = projectScenario(makeScenario({ exitClosingCostPct: 1 }));
    const highCosts = projectScenario(makeScenario({ exitClosingCostPct: 6 }));
    expect(lowCosts.terminalEquity).toBeGreaterThan(highCosts.terminalEquity);
    expect(lowCosts.irr!).toBeGreaterThan(highCosts.irr!);
  });

  it('returns IRR as a percentage (not a decimal)', () => {
    const result = projectScenario(makeScenario());
    // IRR should be expressed as ~5–30 for typical deals, not 0.05–0.30
    expect(result.irr!).toBeGreaterThan(1);
    expect(result.irr!).toBeLessThan(200);
  });
});
