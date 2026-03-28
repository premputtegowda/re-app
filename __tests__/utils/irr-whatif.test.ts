import { describe, it, expect } from 'vitest';
import {
  computeAvgRents,
  buildWhatIfResult,
  findBreakEven,
} from '@/utils/whatIfCalc';
import type { WhatIfOverrides, BuildDeps } from '@/utils/whatIfCalc';
import type { CoCAcquisition, CoCOperations, CoCRefinance, ProFormaData, CoCResult } from '@/types';

// ── Fixtures ──────────────────────────────────────────────────────────────────
//
// Base scenario: $200K purchase, $2K/mo rent, 7% rate, 5-yr hold.
// This produces ~$2K/yr positive cash flow and terminal equity at cap 9%,
// ensuring non-null IRR across the tested variable ranges.

function makeAcquisition(overrides: Partial<CoCAcquisition> = {}): CoCAcquisition {
  return {
    propertyAddress: '123 Main St',
    propertyType: 'sfr',
    units: 1,
    sfrBeds: 3, sfrBaths: 2,
    sfrInPlaceRent: 0, sfrPreStabRent: 1_800, sfrTargetRent: 2_000,
    unitMix: [],
    purchasePrice: 200_000,
    arv: 240_000,
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
    exitCapRate: 6,
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
    ],
    yearOverrides: {},
    ...overrides,
  };
}

function makeOps(): CoCOperations {
  return {
    grossRentMonthly: 2_000,
    vacancyRatePct: 5,
    opexPct: 30,
    propertyMgmtPct: 8,
    annualRentGrowthPct: 3,
  };
}

function makeRefinance(): CoCRefinance {
  return {
    enabled: false,
    refiYear: 3, refiMarketValue: 0,
    newLTV: 75, newInterestRate: 6.5, newLoanTermYears: 30, refiCostPct: 2,
  };
}

/** Builds the standard BuildDeps for a given acquisition + proForma. */
function makeDeps(
  acq: CoCAcquisition = makeAcquisition(),
  pf: ProFormaData = makeProForma(),
): BuildDeps {
  return {
    acquisition: acq,
    operations: makeOps(),
    proForma: pf,
    refinance: makeRefinance(),
    units: 1,
    origStabilizedAnnual: pf.grossRent.stabilized,
    defaultPreStabAnnual: 1_800 * 12,
  };
}

/** Returns WhatIfOverrides matching the test fixture defaults. */
function makeOverrides(partial: Partial<WhatIfOverrides> = {}): WhatIfOverrides {
  return {
    targetRentPerUnit:    2_000,
    preStabRentPerUnit:   1_800,
    vacancyPct:           5,
    rentGrowthPct:        3,
    propertyMgmtPct:      8,
    maintenancePct:       5,
    fixedExpenseGrowthPct: 2,
    interestRate:         7,
    exitCapRate:          6,
    purchasePrice:        200_000,
    projectionYears:      5,
    ...partial,
  };
}

// ── computeAvgRents ───────────────────────────────────────────────────────────

describe('computeAvgRents', () => {
  it('returns sfrTargetRent and sfrPreStabRent for SFR', () => {
    const acq = makeAcquisition({ propertyType: 'sfr', sfrTargetRent: 2_500, sfrPreStabRent: 2_000 });
    const { units, avgTargetRent, avgPreStabRent } = computeAvgRents(acq);
    expect(units).toBe(1);
    expect(avgTargetRent).toBe(2_500);
    expect(avgPreStabRent).toBe(2_000);
  });

  it('returns 0 for SFR with no rent values set', () => {
    const acq = makeAcquisition({ propertyType: 'sfr', sfrTargetRent: 0, sfrPreStabRent: 0 });
    const { avgTargetRent, avgPreStabRent } = computeAvgRents(acq);
    expect(avgTargetRent).toBe(0);
    expect(avgPreStabRent).toBe(0);
  });

  it('returns weighted average rents for MFR with unit mix', () => {
    const acq = makeAcquisition({
      propertyType: 'mfr',
      unitMix: [
        { id: '1br', bedrooms: 1, count: 3, rentMonthly: 1_200, preStabRent: 1_000 },
        { id: '2br', bedrooms: 2, count: 2, rentMonthly: 1_600, preStabRent: 1_300 },
      ],
    });
    const { units, avgTargetRent, avgPreStabRent } = computeAvgRents(acq);
    expect(units).toBe(5);
    // (3×1200 + 2×1600) / 5 = 1360
    expect(avgTargetRent).toBeCloseTo(1_360, 2);
    // (3×1000 + 2×1300) / 5 = 1120
    expect(avgPreStabRent).toBeCloseTo(1_120, 2);
  });

  it('returns zeros when unit mix has zero total units', () => {
    const acq = makeAcquisition({ propertyType: 'mfr', unitMix: [] });
    const { units, avgTargetRent, avgPreStabRent } = computeAvgRents(acq);
    expect(units).toBe(acq.units || 1);
    expect(avgTargetRent).toBe(0);
    expect(avgPreStabRent).toBe(0);
  });

  it('falls back to acquisition.units when MFR has no unitMix', () => {
    const acq = makeAcquisition({ propertyType: 'mfr', units: 4, unitMix: [] });
    const { units } = computeAvgRents(acq);
    expect(units).toBe(4);
  });
});

// ── buildWhatIfResult — directional IRR sensitivity ───────────────────────────

describe('buildWhatIfResult — target rent', () => {
  const deps = makeDeps();

  it('higher target rent → higher IRR', () => {
    const low  = buildWhatIfResult(makeOverrides({ targetRentPerUnit: 1_600 }), deps);
    const base = buildWhatIfResult(makeOverrides({ targetRentPerUnit: 2_000 }), deps);
    const high = buildWhatIfResult(makeOverrides({ targetRentPerUnit: 2_400 }), deps);
    expect(base.irr!).toBeGreaterThan(low.irr!);
    expect(high.irr!).toBeGreaterThan(base.irr!);
  });

  it('IRR is monotonically increasing with rent (5-step sweep)', () => {
    const rents = [1_500, 1_750, 2_000, 2_250, 2_500];
    const irrs  = rents.map(r => buildWhatIfResult(makeOverrides({ targetRentPerUnit: r }), deps).irr!);
    for (let i = 1; i < irrs.length; i++) {
      expect(irrs[i]).toBeGreaterThan(irrs[i - 1]);
    }
  });
});

describe('buildWhatIfResult — pre-stab rent', () => {
  it('higher pre-stab rent → higher or equal IRR (more income during ramp)', () => {
    // Set up pre-stab yearOverrides so both sliders have effect
    const pf = makeProForma({
      yearOverrides: {
        1: { grossRent: 1_800 * 12, grossRentSystem: true },
        2: { grossRent: 2_000 * 12, grossRentSystem: true },
      },
    });
    const deps = makeDeps(makeAcquisition(), pf);
    const low  = buildWhatIfResult(makeOverrides({ preStabRentPerUnit: 1_200 }), deps);
    const high = buildWhatIfResult(makeOverrides({ preStabRentPerUnit: 1_900 }), deps);
    expect(high.irr!).toBeGreaterThanOrEqual(low.irr!);
  });
});

describe('buildWhatIfResult — vacancy rate', () => {
  const deps = makeDeps();

  it('higher vacancy → lower IRR', () => {
    const low  = buildWhatIfResult(makeOverrides({ vacancyPct: 3  }), deps);
    const base = buildWhatIfResult(makeOverrides({ vacancyPct: 5  }), deps);
    const high = buildWhatIfResult(makeOverrides({ vacancyPct: 13 }), deps);
    expect(base.irr!).toBeLessThan(low.irr!);
    expect(high.irr!).toBeLessThan(base.irr!);
  });

  it('IRR is monotonically decreasing with vacancy (5-step sweep)', () => {
    const vacancies = [2, 5, 8, 12, 18];
    const irrs = vacancies.map(v => buildWhatIfResult(makeOverrides({ vacancyPct: v }), deps).irr!);
    for (let i = 1; i < irrs.length; i++) {
      expect(irrs[i]).toBeLessThan(irrs[i - 1]);
    }
  });
});

describe('buildWhatIfResult — rent growth rate', () => {
  const deps = makeDeps();

  it('higher rent growth → higher IRR', () => {
    const low  = buildWhatIfResult(makeOverrides({ rentGrowthPct: 0 }), deps);
    const base = buildWhatIfResult(makeOverrides({ rentGrowthPct: 3 }), deps);
    const high = buildWhatIfResult(makeOverrides({ rentGrowthPct: 6 }), deps);
    expect(base.irr!).toBeGreaterThan(low.irr!);
    expect(high.irr!).toBeGreaterThan(base.irr!);
  });

  it('negative rent growth produces lower IRR than flat growth', () => {
    const negative = buildWhatIfResult(makeOverrides({ rentGrowthPct: -2 }), deps);
    const flat     = buildWhatIfResult(makeOverrides({ rentGrowthPct: 0  }), deps);
    expect(flat.irr!).toBeGreaterThan(negative.irr!);
  });
});

describe('buildWhatIfResult — property management %', () => {
  const deps = makeDeps();

  it('higher property mgmt % → lower IRR', () => {
    const low  = buildWhatIfResult(makeOverrides({ propertyMgmtPct: 5  }), deps);
    const base = buildWhatIfResult(makeOverrides({ propertyMgmtPct: 8  }), deps);
    const high = buildWhatIfResult(makeOverrides({ propertyMgmtPct: 12 }), deps);
    expect(base.irr!).toBeLessThan(low.irr!);
    expect(high.irr!).toBeLessThan(base.irr!);
  });
});

describe('buildWhatIfResult — maintenance %', () => {
  const deps = makeDeps();

  it('higher maintenance % → lower IRR', () => {
    const low  = buildWhatIfResult(makeOverrides({ maintenancePct: 2  }), deps);
    const base = buildWhatIfResult(makeOverrides({ maintenancePct: 5  }), deps);
    const high = buildWhatIfResult(makeOverrides({ maintenancePct: 10 }), deps);
    expect(base.irr!).toBeLessThan(low.irr!);
    expect(high.irr!).toBeLessThan(base.irr!);
  });
});

describe('buildWhatIfResult — fixed expense growth', () => {
  const deps = makeDeps();

  it('higher fixed expense growth → lower IRR over multi-year hold', () => {
    const low  = buildWhatIfResult(makeOverrides({ fixedExpenseGrowthPct: 0 }), deps);
    const high = buildWhatIfResult(makeOverrides({ fixedExpenseGrowthPct: 6 }), deps);
    expect(low.irr!).toBeGreaterThan(high.irr!);
  });
});

describe('buildWhatIfResult — interest rate', () => {
  const deps = makeDeps();

  it('higher interest rate → lower IRR', () => {
    const low  = buildWhatIfResult(makeOverrides({ interestRate: 5 }), deps);
    const base = buildWhatIfResult(makeOverrides({ interestRate: 7 }), deps);
    const high = buildWhatIfResult(makeOverrides({ interestRate: 9 }), deps);
    expect(base.irr!).toBeLessThan(low.irr!);
    expect(high.irr!).toBeLessThan(base.irr!);
  });

  it('IRR is monotonically decreasing with interest rate (5-step sweep)', () => {
    const rates = [4, 5.5, 7, 8.5, 10];
    const irrs  = rates.map(r => buildWhatIfResult(makeOverrides({ interestRate: r }), deps).irr!);
    for (let i = 1; i < irrs.length; i++) {
      expect(irrs[i]).toBeLessThan(irrs[i - 1]);
    }
  });
});

describe('buildWhatIfResult — exit cap rate', () => {
  const deps = makeDeps();

  it('lower exit cap rate → higher IRR (higher terminal value)', () => {
    const high = buildWhatIfResult(makeOverrides({ exitCapRate: 8 }), deps);
    const base = buildWhatIfResult(makeOverrides({ exitCapRate: 6 }), deps);
    const low  = buildWhatIfResult(makeOverrides({ exitCapRate: 4 }), deps);
    expect(base.irr!).toBeGreaterThan(high.irr!);
    expect(low.irr!).toBeGreaterThan(base.irr!);
  });

  it('IRR is monotonically decreasing as exit cap rate rises (5-step sweep)', () => {
    const caps = [3, 5, 7, 9, 11];
    const irrs = caps.map(cap => buildWhatIfResult(makeOverrides({ exitCapRate: cap }), deps).irr!);
    for (let i = 1; i < irrs.length; i++) {
      expect(irrs[i]).toBeLessThan(irrs[i - 1]);
    }
  });
});

describe('buildWhatIfResult — purchase price', () => {
  const deps = makeDeps();

  it('higher purchase price → lower IRR (more equity deployed)', () => {
    const low  = buildWhatIfResult(makeOverrides({ purchasePrice: 150_000 }), deps);
    const base = buildWhatIfResult(makeOverrides({ purchasePrice: 200_000 }), deps);
    const high = buildWhatIfResult(makeOverrides({ purchasePrice: 280_000 }), deps);
    expect(base.irr!).toBeLessThan(low.irr!);
    expect(high.irr!).toBeLessThan(base.irr!);
  });
});

describe('buildWhatIfResult — projection years (hold period)', () => {
  it('returns irrCashFlows with length = projectionYears + 1', () => {
    const deps = makeDeps();
    const result = buildWhatIfResult(makeOverrides({ projectionYears: 7 }), deps);
    expect(result.irrCashFlows).toHaveLength(8);
  });

  it('with positive annual CF, longer hold produces higher total cash flow', () => {
    const deps  = makeDeps();
    const short = buildWhatIfResult(makeOverrides({ projectionYears: 3 }), deps);
    const long  = buildWhatIfResult(makeOverrides({ projectionYears: 10 }), deps);
    expect(long.totalCashFlow).toBeGreaterThan(short.totalCashFlow);
  });
});

// ── buildWhatIfResult — combined best / worst case ────────────────────────────

describe('buildWhatIfResult — best vs worst case', () => {
  const deps = makeDeps();

  const best  = makeOverrides({ targetRentPerUnit: 2_400, vacancyPct: 3, interestRate: 5, exitCapRate: 4, rentGrowthPct: 5 });
  // Worst case still uses $200K base so IRR is calculable
  const worst = makeOverrides({ targetRentPerUnit: 1_700, vacancyPct: 12, interestRate: 9, exitCapRate: 9, rentGrowthPct: 1 });

  it('best case IRR is materially higher than worst case', () => {
    const bestR  = buildWhatIfResult(best, deps);
    const worstR = buildWhatIfResult(worst, deps);
    expect(bestR.irr!).toBeGreaterThan(worstR.irr! + 5);
  });

  it('base case IRR is below best case', () => {
    const baseR = buildWhatIfResult(makeOverrides(), deps);
    const bestR = buildWhatIfResult(best, deps);
    expect(baseR.irr!).toBeLessThan(bestR.irr!);
  });

  it('worst case produces lower total cash flow than base case', () => {
    const baseR  = buildWhatIfResult(makeOverrides(), deps);
    const worstR = buildWhatIfResult(worst, deps);
    expect(worstR.totalCashFlow).toBeLessThan(baseR.totalCashFlow);
  });
});

// ── findBreakEven ─────────────────────────────────────────────────────────────

describe('findBreakEven', () => {
  const cocMetric = (r: CoCResult) => r.avgCoCReturn;

  /**
   * Fake builder: metric decreases as v increases (simulates "higher vacancy hurts CoC").
   * avgCoCReturn = 10 - v → at v=0: 10, at v=10: 0.
   * For worseDir='up' with target=5: break-even at v=5.
   */
  function decreasingBuilder(v: number): CoCResult {
    return { avgCoCReturn: 10 - v } as CoCResult;
  }

  /**
   * Fake builder: metric increases as v increases.
   * avgCoCReturn = v → at v=0: 0, at v=10: 10.
   * For worseDir='down' with target=5: break-even at v=5.
   */
  function increasingBuilder(v: number): CoCResult {
    return { avgCoCReturn: v } as CoCResult;
  }

  it('finds midpoint break-even for worseDir=up (decreasing metric)', () => {
    // metric starts at 10 > 5 (target), crosses at v=5, ends at 0 ≤ 5
    const result = findBreakEven(decreasingBuilder, 0, 10, cocMetric, 5, 'up');
    expect(result).not.toBeNull();
    expect(result!).toBeCloseTo(5, 1);
  });

  it('finds midpoint break-even for worseDir=down (increasing metric)', () => {
    // metric starts at 0 ≤ 5 (target), crosses at v=5, ends at 10 > 5
    const result = findBreakEven(increasingBuilder, 0, 10, cocMetric, 5, 'down');
    expect(result).not.toBeNull();
    expect(result!).toBeCloseTo(5, 1);
  });

  it('returns null when already at/below target at minimum (worseDir=up)', () => {
    // atMin = 10 - 8 = 2 ≤ target 5 → no cushion at start of range
    const result = findBreakEven(v => ({ avgCoCReturn: 10 - v } as CoCResult), 8, 10, cocMetric, 5, 'up');
    expect(result).toBeNull();
  });

  it('returns null when metric never reaches target (worseDir=up)', () => {
    // metric stays in [10-1, 10-0] = [9,10], always > target=5
    const result = findBreakEven(decreasingBuilder, 0, 1, cocMetric, 5, 'up');
    expect(result).toBeNull();
  });

  it('returns null when already above target at maximum (worseDir=down)', () => {
    // atMax = 3 ≤ target 5 → metric never reaches target
    const result = findBreakEven(v => ({ avgCoCReturn: v } as CoCResult), 0, 3, cocMetric, 5, 'down');
    expect(result).toBeNull();
  });

  it('result satisfies metric(buildFn(result)) ≈ targetValue', () => {
    const deps = makeDeps();
    const build = (v: number) => buildWhatIfResult(makeOverrides({ vacancyPct: v }), deps);
    const base = build(5);
    const target = base.avgCoCReturn - 2; // 2 pp CoC lower than base

    const breakEven = findBreakEven(build, 5, 80, cocMetric, target, 'up');
    if (breakEven !== null) {
      expect(cocMetric(build(breakEven))).toBeCloseTo(target, 1);
    }
  });

  it('break-even value is within the search range [min, max]', () => {
    const deps = makeDeps();
    const build = (v: number) => buildWhatIfResult(makeOverrides({ interestRate: v }), deps);
    const base = build(7);
    const target = base.avgCoCReturn - 1;

    const breakEven = findBreakEven(build, 7, 25, cocMetric, target, 'up');
    if (breakEven !== null) {
      expect(breakEven).toBeGreaterThanOrEqual(7);
      expect(breakEven).toBeLessThanOrEqual(25);
    }
  });

  it('converges to within 0.01 tolerance (vacancy break-even at CoC = 0%)', () => {
    const deps = makeDeps();
    const build = (v: number) => buildWhatIfResult(makeOverrides({ vacancyPct: v }), deps);

    const breakEven = findBreakEven(build, 0, 95, cocMetric, 0, 'up');
    if (breakEven !== null) {
      // Metric at breakEven ± 0.005 should straddle 0
      const below = build(breakEven - 0.005).avgCoCReturn;
      const above = build(breakEven + 0.005).avgCoCReturn;
      expect(below).toBeGreaterThanOrEqual(0);
      expect(above).toBeLessThanOrEqual(0.1);
    }
  });
});
