/**
 * Tests for property tax scaling in buildWhatIfResult.
 *
 * When purchase price changes, any fixed expense whose name contains "tax"
 * should scale proportionally (newPrice / originalPrice). All other fixed
 * expenses must remain unchanged. This preserves the tax/price ratio for
 * every projection year since the same growthPct is applied to the scaled base.
 */

import { describe, it, expect } from 'vitest';
import { buildWhatIfResult } from '@/utils/whatIfCalc';
import type { WhatIfOverrides, BuildDeps } from '@/utils/whatIfCalc';
import type { CoCAcquisition, CoCOperations, CoCRefinance, ProFormaData } from '@/types';

// ── Fixtures ──────────────────────────────────────────────────────────────────

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
    exitMethod: 'capRate' as const,
    exitClosingCostPct: 3,
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

/** ProForma with only a property tax expense (no % EGI expenses) for isolation. */
function makeTaxOnlyProForma(taxAmount = 3_000, growthPct = 0): ProFormaData {
  return {
    grossRent:     { t12: 24_000, stab: null, stabilized: 24_000, growthPct: 3 },
    otherIncome:   { t12: 0,      stab: null, stabilized: 0,      growthPct: 2 },
    vacancyPct:    { t12: 5,      stab: null, stabilized: 5 },
    creditLossPct: { t12: 0,      stab: null, stabilized: 0 },
    expenses: [
      { id: 'tax', name: 'Property Taxes', isPercentOfEGI: false, t12Value: taxAmount, stabValue: null, stabilizedValue: taxAmount, growthPct },
    ],
    yearOverrides: {},
  };
}

/** ProForma with both a tax expense and a non-tax fixed expense. */
function makeMixedProForma(): ProFormaData {
  return {
    grossRent:     { t12: 24_000, stab: null, stabilized: 24_000, growthPct: 3 },
    otherIncome:   { t12: 0,      stab: null, stabilized: 0,      growthPct: 2 },
    vacancyPct:    { t12: 5,      stab: null, stabilized: 5 },
    creditLossPct: { t12: 0,      stab: null, stabilized: 0 },
    expenses: [
      { id: 'tax', name: 'Property Taxes', isPercentOfEGI: false, t12Value: 3_000, stabValue: null, stabilizedValue: 3_000, growthPct: 0 },
      { id: 'ins', name: 'Insurance',      isPercentOfEGI: false, t12Value: 1_200, stabValue: null, stabilizedValue: 1_200, growthPct: 0 },
    ],
    yearOverrides: {},
  };
}

function makeDeps(pf: ProFormaData, purchasePrice = 200_000): BuildDeps {
  const acq = makeAcquisition({ purchasePrice });
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

function makeOverrides(partial: Partial<WhatIfOverrides> = {}): WhatIfOverrides {
  return {
    targetRentPerUnit:     2_000,
    preStabRentPerUnit:    1_800,
    vacancyPct:            5,
    rentGrowthPct:         3,
    propertyMgmtPct:       8,
    maintenancePct:        5,
    fixedExpenseGrowthPct: 0,
    interestRate:          7,
    exitCapRate:           6,
    purchasePrice:         200_000,
    projectionYears:       5,
    ...partial,
  };
}

// ── Property tax scaling tests ─────────────────────────────────────────────────

describe('buildWhatIfResult — property tax scales with purchase price', () => {
  it('increasing purchase price reduces total cash flow (higher taxes)', () => {
    const deps = makeDeps(makeTaxOnlyProForma(3_000));
    const base = buildWhatIfResult(makeOverrides({ purchasePrice: 200_000 }), deps);
    const high = buildWhatIfResult(makeOverrides({ purchasePrice: 300_000 }), deps);
    expect(high.totalCashFlow).toBeLessThan(base.totalCashFlow);
  });

  it('decreasing purchase price increases total cash flow (lower taxes)', () => {
    const deps = makeDeps(makeTaxOnlyProForma(3_000));
    const base = buildWhatIfResult(makeOverrides({ purchasePrice: 200_000 }), deps);
    const low  = buildWhatIfResult(makeOverrides({ purchasePrice: 100_000 }), deps);
    expect(low.totalCashFlow).toBeGreaterThan(base.totalCashFlow);
  });

  it('doubling price doubles the tax cost impact (linear scaling)', () => {
    // With growthPct=0, tax is flat each year so total impact is taxDelta × years
    const pf = makeTaxOnlyProForma(3_000, 0);
    const deps = makeDeps(pf);

    const base   = buildWhatIfResult(makeOverrides({ purchasePrice: 200_000 }), deps);
    const double = buildWhatIfResult(makeOverrides({ purchasePrice: 400_000 }), deps);
    const half   = buildWhatIfResult(makeOverrides({ purchasePrice: 100_000 }), deps);

    // double: adds $3,000/yr extra tax × 5 yrs = -$15,000 vs base
    // half:   saves $1,500/yr × 5 yrs = +$7,500 vs base
    const lossFromDouble = base.totalCashFlow - double.totalCashFlow;
    const gainFromHalf   = half.totalCashFlow - base.totalCashFlow;

    // ratio should be ~2:1 (doubling adds 2× the tax delta that halving saves)
    expect(lossFromDouble / gainFromHalf).toBeCloseTo(2, 1);
  });

  it('non-tax fixed expense (Insurance) is NOT scaled when price changes', () => {
    // Use a cash deal (100% down) to eliminate mortgage payment variance so
    // the only cash flow difference is the tax expense scaling.
    const pf = makeMixedProForma(); // tax=$3,000 + insurance=$1,200 (flat, no growth)
    const acq = makeAcquisition({ purchasePrice: 200_000, downPaymentPct: 100 });
    const deps: BuildDeps = {
      acquisition: acq, operations: makeOps(), proForma: pf, refinance: makeRefinance(),
      units: 1, origStabilizedAnnual: pf.grossRent.stabilized, defaultPreStabAnnual: 1_800 * 12,
    };

    const base   = buildWhatIfResult(makeOverrides({ purchasePrice: 200_000 }), deps);
    const double = buildWhatIfResult(makeOverrides({ purchasePrice: 400_000 }), deps);

    // Only Property Taxes ($3,000) scales — Insurance ($1,200) stays fixed.
    // Extra annual cost = $3,000 (not $4,200). Over 5 yrs = $15,000 drop.
    const cashFlowDrop = base.totalCashFlow - double.totalCashFlow;
    expect(cashFlowDrop).toBeGreaterThan(0);
    // If Insurance also scaled: extra cost = $4,200/yr × 5 = $21,000. Should be ~$15,000.
    expect(cashFlowDrop).toBeLessThan(20_000);
    expect(cashFlowDrop).toBeGreaterThan(10_000);
  });

  it('expense named "Property Tax" (singular) also scales', () => {
    const pf: ProFormaData = {
      grossRent:     { t12: 24_000, stab: null, stabilized: 24_000, growthPct: 3 },
      otherIncome:   { t12: 0,      stab: null, stabilized: 0,      growthPct: 2 },
      vacancyPct:    { t12: 5,      stab: null, stabilized: 5 },
      creditLossPct: { t12: 0,      stab: null, stabilized: 0 },
      expenses: [
        { id: 'tx', name: 'Property Tax', isPercentOfEGI: false, t12Value: 4_000, stabValue: null, stabilizedValue: 4_000, growthPct: 0 },
      ],
      yearOverrides: {},
    };
    const deps = makeDeps(pf);
    const base = buildWhatIfResult(makeOverrides({ purchasePrice: 200_000 }), deps);
    const high = buildWhatIfResult(makeOverrides({ purchasePrice: 300_000 }), deps);
    expect(high.totalCashFlow).toBeLessThan(base.totalCashFlow);
  });

  it('no price change → no tax change (ratio = 1 is identity)', () => {
    const deps = makeDeps(makeTaxOnlyProForma(3_000));
    const r1 = buildWhatIfResult(makeOverrides({ purchasePrice: 200_000 }), deps);
    const r2 = buildWhatIfResult(makeOverrides({ purchasePrice: 200_000 }), deps);
    expect(r1.totalCashFlow).toBeCloseTo(r2.totalCashFlow, 2);
  });

  it('tax scaling is independent of rent changes', () => {
    // Changing rent should not affect how tax scales with price
    const deps = makeDeps(makeTaxOnlyProForma(3_000, 0));

    const baseRentBasePrice = buildWhatIfResult(makeOverrides({ purchasePrice: 200_000, targetRentPerUnit: 2_000 }), deps);
    const baseRentHighPrice = buildWhatIfResult(makeOverrides({ purchasePrice: 300_000, targetRentPerUnit: 2_000 }), deps);
    const highRentBasePrice = buildWhatIfResult(makeOverrides({ purchasePrice: 200_000, targetRentPerUnit: 2_500 }), deps);
    const highRentHighPrice = buildWhatIfResult(makeOverrides({ purchasePrice: 300_000, targetRentPerUnit: 2_500 }), deps);

    // Tax impact of price increase should be same regardless of rent level
    const taxImpactAtBaseRent = baseRentBasePrice.totalCashFlow - baseRentHighPrice.totalCashFlow;
    const taxImpactAtHighRent = highRentBasePrice.totalCashFlow - highRentHighPrice.totalCashFlow;

    expect(taxImpactAtBaseRent).toBeCloseTo(taxImpactAtHighRent, 0);
  });
});
