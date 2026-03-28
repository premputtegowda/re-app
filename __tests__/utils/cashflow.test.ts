import { describe, it, expect } from 'vitest';
import {
  computeEGI,
  calculateMonthlyPayment,
  calculateIOPayment,
  calculateLoanBalance,
  projectScenario,
} from '@/utils/dealAnalyzerCalc';
import type { CoCScenario } from '@/types';

// ── Shared fixture ────────────────────────────────────────────────────────────

function makeScenario(
  acqOverrides: Partial<CoCScenario['acquisition']> = {},
  opsOverrides: Partial<CoCScenario['operations']> = {},
  refiOverrides: Partial<CoCScenario['refinance']> = {}
): CoCScenario {
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
      downPaymentPct: 20,        // $60,000
      closingCostsPct: 2,        // $6,000
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
      ...acqOverrides,
    },
    operations: {
      grossRentMonthly: 2_000,
      vacancyRatePct: 5,
      opexPct: 30,
      propertyMgmtPct: 8,
      annualRentGrowthPct: 3,
      ...opsOverrides,
    },
    refinance: {
      enabled: false,
      refiYear: 3,
      refiMarketValue: 0,
      newLTV: 75,
      newInterestRate: 6.5,
      newLoanTermYears: 30,
      refiCostPct: 2,
      ...refiOverrides,
    },
  };
}

// ── computeEGI ────────────────────────────────────────────────────────────────

describe('computeEGI', () => {
  it('applies vacancy and credit loss to gross rent only', () => {
    // grossRent=1200, otherIncome=100, vacancy=5%, creditLoss=2% → 1200*(1-0.07)+100
    expect(computeEGI(1200, 100, 5, 2)).toBeCloseTo(1200 * 0.93 + 100, 6);
  });

  it('passes other income through in full regardless of vacancy', () => {
    const withOther    = computeEGI(0, 500, 10, 5);
    const withoutOther = computeEGI(0, 0,   10, 5);
    expect(withOther - withoutOther).toBeCloseTo(500, 6);
  });

  it('returns gross rent unchanged when vacancy and credit loss are both zero', () => {
    expect(computeEGI(2000, 0, 0, 0)).toBeCloseTo(2000, 6);
  });

  it('returns only other income when vacancy is 100%', () => {
    expect(computeEGI(2000, 300, 100, 0)).toBeCloseTo(300, 6);
  });

  it('returns zero when all inputs are zero', () => {
    expect(computeEGI(0, 0, 0, 0)).toBe(0);
  });

  it('combines vacancy and credit loss additively against gross rent', () => {
    // 5% vacancy + 3% credit loss = 8% total loss on gross rent
    expect(computeEGI(1000, 0, 5, 3)).toBeCloseTo(1000 * 0.92, 6);
  });
});

// ── calculateMonthlyPayment ───────────────────────────────────────────────────

describe('calculateMonthlyPayment', () => {
  it('returns principal/months when rate is 0%', () => {
    // $120,000 over 120 months at 0% = $1,000/mo
    expect(calculateMonthlyPayment(120_000, 0, 120)).toBeCloseTo(1_000, 4);
  });

  it('returns correct payment for standard 30-year mortgage at 6%', () => {
    // $200,000 at 6% / 360 months ≈ $1,199.10
    expect(calculateMonthlyPayment(200_000, 6, 360)).toBeCloseTo(1_199.10, 0);
  });

  it('returns correct payment for 15-year mortgage at 7%', () => {
    // $200,000 at 7% / 180 months ≈ $1,797.66
    expect(calculateMonthlyPayment(200_000, 7, 180)).toBeCloseTo(1_797.66, 0);
  });

  it('higher interest rate produces higher monthly payment', () => {
    const low  = calculateMonthlyPayment(200_000, 4, 360);
    const high = calculateMonthlyPayment(200_000, 8, 360);
    expect(high).toBeGreaterThan(low);
  });

  it('shorter term produces higher monthly payment', () => {
    const long  = calculateMonthlyPayment(200_000, 7, 360);
    const short = calculateMonthlyPayment(200_000, 7, 180);
    expect(short).toBeGreaterThan(long);
  });

  it('total payments over term exceed principal (interest cost)', () => {
    const monthly = calculateMonthlyPayment(200_000, 7, 360);
    expect(monthly * 360).toBeGreaterThan(200_000);
  });
});

// ── calculateIOPayment ────────────────────────────────────────────────────────

describe('calculateIOPayment', () => {
  it('returns principal × monthly rate', () => {
    // $240,000 at 7% → $240,000 × (0.07/12) = $1,400/mo
    expect(calculateIOPayment(240_000, 7)).toBeCloseTo(1_400, 4);
  });

  it('returns zero for 0% rate', () => {
    expect(calculateIOPayment(200_000, 0)).toBe(0);
  });

  it('is always less than amortising payment for same principal and rate', () => {
    const io   = calculateIOPayment(200_000, 7);
    const amort = calculateMonthlyPayment(200_000, 7, 360);
    expect(io).toBeLessThan(amort);
  });
});

// ── calculateLoanBalance ──────────────────────────────────────────────────────

describe('calculateLoanBalance', () => {
  it('equals principal after 0 payments', () => {
    expect(calculateLoanBalance(200_000, 7, 360, 0)).toBeCloseTo(200_000, 0);
  });

  it('reaches approximately 0 after full term payments', () => {
    expect(calculateLoanBalance(200_000, 7, 360, 360)).toBeCloseTo(0, 0);
  });

  it('decreases monotonically as payments are made', () => {
    const b12  = calculateLoanBalance(200_000, 7, 360, 12);
    const b120 = calculateLoanBalance(200_000, 7, 360, 120);
    const b240 = calculateLoanBalance(200_000, 7, 360, 240);
    expect(b12).toBeGreaterThan(b120);
    expect(b120).toBeGreaterThan(b240);
  });

  it('at 0% rate reduces linearly by principal/months per payment', () => {
    // $120,000 over 120 months at 0% — after 60 payments balance = $60,000
    expect(calculateLoanBalance(120_000, 0, 120, 60)).toBeCloseTo(60_000, 4);
  });

  it('returns approximately 0 at exactly the end of term', () => {
    // The formula reaches ~0 at the full term; projectScenario clamps it to 0
    expect(Math.abs(calculateLoanBalance(200_000, 7, 360, 360))).toBeLessThan(1);
  });
});

// ── projectScenario — cost basis & totalInvested ──────────────────────────────

describe('projectScenario — cost basis', () => {
  it('calculates downPayment as purchasePrice × downPaymentPct%', () => {
    const result = projectScenario(makeScenario());
    expect(result.downPayment).toBeCloseTo(300_000 * 0.20, 0); // $60,000
  });

  it('calculates closingCosts as purchasePrice × closingCostsPct%', () => {
    const result = projectScenario(makeScenario());
    expect(result.closingCosts).toBeCloseTo(300_000 * 0.02, 0); // $6,000
  });

  it('includes points cost in totalInvested', () => {
    const without = projectScenario(makeScenario({ points: 0 }));
    const with2pt = projectScenario(makeScenario({ points: 2 }));
    const loanAmount = 300_000 * 0.80; // $240,000
    expect(with2pt.pointsCost).toBeCloseTo(loanAmount * 0.02, 0);
    expect(with2pt.totalInvested).toBeGreaterThan(without.totalInvested);
  });

  it('includes hard costs in totalInvested', () => {
    const without = projectScenario(makeScenario());
    const with2   = projectScenario(makeScenario({ hardCostItems: [
      { id: '1', description: 'Labor', amount: 10_000 },
      { id: '2', description: 'Materials', amount: 5_000 },
    ]}));
    expect(with2.hardCosts).toBe(15_000);
    expect(with2.totalInvested).toBe(without.totalInvested + 15_000);
  });

  it('includes soft costs in totalInvested', () => {
    const without = projectScenario(makeScenario());
    const with1   = projectScenario(makeScenario({ softCostItems: [
      { id: '1', description: 'Legal', amount: 3_000 },
    ]}));
    expect(with1.softCosts).toBe(3_000);
    expect(with1.totalInvested).toBe(without.totalInvested + 3_000);
  });

  it('includes opportunity costs in totalInvested', () => {
    const without = projectScenario(makeScenario());
    const withOpp = projectScenario(makeScenario({ opportunityCostItems: [
      { id: '1', description: 'Lost rent', amount: 8_000 },
    ]}));
    expect(withOpp.lostOpportunityCost).toBe(8_000);
    expect(withOpp.totalInvested).toBe(without.totalInvested + 8_000);
  });

  it('totalInvested = downPayment + closingCosts + points + fees + hard + soft + opportunity', () => {
    const result = projectScenario(makeScenario({
      downPaymentPct: 25,
      closingCostsPct: 2,
      points: 1,
      hardCostItems:  [{ id: '1', description: 'Build', amount: 20_000 }],
      softCostItems:  [{ id: '2', description: 'Design', amount: 5_000 }],
      opportunityCostItems: [{ id: '3', description: 'Lost rent', amount: 3_000 }],
    }));
    const expected =
      result.downPayment + result.closingCosts + result.pointsCost +
      result.additionalFees + result.hardCosts + result.softCosts +
      result.lostOpportunityCost;
    expect(result.totalInvested).toBeCloseTo(expected, 0);
  });
});

// ── projectScenario — yearly cash flow ───────────────────────────────────────

describe('projectScenario — yearly cash flow', () => {
  it('cashFlow = NOI - debtService for a simple non-IO deal', () => {
    const result = projectScenario(makeScenario());
    result.yearlyProjections.forEach(p => {
      expect(p.cashFlow).toBeCloseTo(p.noi - p.debtService, 0);
    });
  });

  it('NOI = effectiveRent - opex for every year', () => {
    const result = projectScenario(makeScenario());
    result.yearlyProjections.forEach(p => {
      expect(p.noi).toBeCloseTo(p.effectiveRent - p.opex, 0);
    });
  });

  it('cumulativeCashFlow accumulates correctly year over year', () => {
    const result = projectScenario(makeScenario());
    let running = 0;
    result.yearlyProjections.forEach(p => {
      running += p.cashFlow;
      expect(p.cumulativeCashFlow).toBeCloseTo(running, 0);
    });
  });

  it('coCReturn = cashFlow / totalInvested × 100', () => {
    const result = projectScenario(makeScenario());
    result.yearlyProjections.forEach(p => {
      const expected = (p.cashFlow / result.totalInvested) * 100;
      expect(p.coCReturn).toBeCloseTo(expected, 6);
    });
  });

  it('higher vacancy rate reduces cash flow', () => {
    const low  = projectScenario(makeScenario({}, { vacancyRatePct: 3  }));
    const high = projectScenario(makeScenario({}, { vacancyRatePct: 15 }));
    expect(low.yearlyProjections[0].cashFlow).toBeGreaterThan(
      high.yearlyProjections[0].cashFlow
    );
  });

  it('higher rent increases cash flow', () => {
    const low  = projectScenario(makeScenario({}, { grossRentMonthly: 1_500 }));
    const high = projectScenario(makeScenario({}, { grossRentMonthly: 2_500 }));
    expect(high.yearlyProjections[0].cashFlow).toBeGreaterThan(
      low.yearlyProjections[0].cashFlow
    );
  });

  it('lower interest rate increases cash flow', () => {
    const high = projectScenario(makeScenario({ interestRate: 8 }));
    const low  = projectScenario(makeScenario({ interestRate: 5 }));
    expect(low.yearlyProjections[0].cashFlow).toBeGreaterThan(
      high.yearlyProjections[0].cashFlow
    );
  });

  it('projects the correct number of years', () => {
    const result = projectScenario(makeScenario({ projectionYears: 7 }));
    expect(result.yearlyProjections).toHaveLength(7);
  });

  it('year numbers match 1..projectionYears', () => {
    const result = projectScenario(makeScenario({ projectionYears: 5 }));
    result.yearlyProjections.forEach((p, i) => {
      expect(p.year).toBe(i + 1);
    });
  });
});

// ── projectScenario — IO period ───────────────────────────────────────────────

describe('projectScenario — interest-only period', () => {
  it('debt service during IO years equals monthly IO payment × 12', () => {
    const scenario = makeScenario({ ioPeriodMonths: 24 }); // 2-year IO
    const result   = projectScenario(scenario);
    const loan     = 300_000 * 0.80;
    const ioAnnual = calculateIOPayment(loan, 7) * 12;

    expect(result.yearlyProjections[0].debtService).toBeCloseTo(ioAnnual, 0);
    expect(result.yearlyProjections[1].debtService).toBeCloseTo(ioAnnual, 0);
  });

  it('loan balance does not decrease during IO period', () => {
    const result = projectScenario(makeScenario({ ioPeriodMonths: 24 }));
    const loan   = 300_000 * 0.80;
    expect(result.yearlyProjections[0].loanBalance).toBeCloseTo(loan, 0);
    expect(result.yearlyProjections[1].loanBalance).toBeCloseTo(loan, 0);
  });

  it('debt service increases after IO period ends (amortising > IO)', () => {
    const result = projectScenario(makeScenario({ ioPeriodMonths: 12 }));
    const ioDs   = result.yearlyProjections[0].debtService;   // year 1: IO
    const amortDs = result.yearlyProjections[1].debtService;  // year 2: amortising
    expect(amortDs).toBeGreaterThan(ioDs);
  });

  it('cash flow is higher during IO years than amortising years', () => {
    const result = projectScenario(makeScenario({ ioPeriodMonths: 12 }));
    expect(result.yearlyProjections[0].cashFlow).toBeGreaterThan(
      result.yearlyProjections[1].cashFlow
    );
  });
});

// ── projectScenario — refinance ───────────────────────────────────────────────

describe('projectScenario — refinance', () => {
  function makeRefiScenario() {
    return makeScenario(
      { purchasePrice: 300_000, arv: 400_000, interestRate: 7 },
      {},
      { enabled: true, refiYear: 3, refiMarketValue: 400_000, newLTV: 75, newInterestRate: 6.5, newLoanTermYears: 30, refiCostPct: 2 }
    );
  }

  it('cashOutProceeds is positive in the refi year', () => {
    const result = projectScenario(makeRefiScenario());
    const refiYear = result.yearlyProjections.find(p => p.year === 3)!;
    expect(refiYear.cashOutProceeds).toBeGreaterThan(0);
  });

  it('cashFlow in refi year includes cashOutProceeds', () => {
    const result   = projectScenario(makeRefiScenario());
    const refiYear = result.yearlyProjections.find(p => p.year === 3)!;
    expect(refiYear.cashFlow).toBeCloseTo(
      refiYear.noi - refiYear.debtService + refiYear.cashOutProceeds, 0
    );
  });

  it('non-refi years have zero cashOutProceeds', () => {
    const result = projectScenario(makeRefiScenario());
    result.yearlyProjections
      .filter(p => p.year !== 3)
      .forEach(p => expect(p.cashOutProceeds).toBe(0));
  });

  it('disabled refinance produces zero cashOutProceeds in all years', () => {
    const result = projectScenario(makeScenario({}, {}, { enabled: false }));
    result.yearlyProjections.forEach(p => expect(p.cashOutProceeds).toBe(0));
  });
});

// ── projectScenario — CoC return ─────────────────────────────────────────────

describe('projectScenario — CoC return', () => {
  it('avgCoCReturn equals mean of yearly coCReturn values', () => {
    const result = projectScenario(makeScenario());
    const mean = result.yearlyProjections.reduce((s, p) => s + p.coCReturn, 0)
      / result.yearlyProjections.length;
    expect(result.avgCoCReturn).toBeCloseTo(mean, 6);
  });

  it('peakCoCReturn equals the maximum yearly coCReturn', () => {
    const result = projectScenario(makeScenario());
    const max = Math.max(...result.yearlyProjections.map(p => p.coCReturn));
    expect(result.peakCoCReturn).toBeCloseTo(max, 6);
  });

  it('coCReturn magnitude shrinks when totalInvested grows with same cash flow', () => {
    // Adding opportunity cost raises totalInvested without changing NOI or debt service.
    // CoC = CF / invested × 100. Same CF, larger denominator → smaller absolute CoC.
    const base     = projectScenario(makeScenario());
    const inflated = projectScenario(makeScenario({
      opportunityCostItems: [{ id: '1', description: 'Extra cost', amount: 50_000 }],
    }));
    expect(Math.abs(inflated.yearlyProjections[0].coCReturn)).toBeLessThan(
      Math.abs(base.yearlyProjections[0].coCReturn)
    );
  });

  it('totalCashFlow equals sum of all yearly cashFlows', () => {
    const result = projectScenario(makeScenario());
    const sum = result.yearlyProjections.reduce((s, p) => s + p.cashFlow, 0);
    expect(result.totalCashFlow).toBeCloseTo(sum, 0);
  });
});
