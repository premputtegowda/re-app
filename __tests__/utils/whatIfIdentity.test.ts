/**
 * Identity tests: What-If at default values must produce the EXACT same
 * result as the base case. This guarantees both use the same calculation
 * engine (projectScenario → makeProFormaProjector).
 *
 * Also tests that per-year overrides (vacancy, growth, OpEx) flow through
 * the same yearOverrides → projector path as the ProForma grid.
 */

import { describe, it, expect } from 'vitest';
import { buildWhatIfResult, computeAvgRents } from '@/utils/whatIfCalc';
import { projectScenario } from '@/utils/dealAnalyzerCalc';
import { simulateFromSchedule } from '@/components/DealAnalyzer/RehabRentCalculator';
import type { CoCAcquisition, CoCOperations, CoCRefinance, ProFormaData, CoCScenario, CalcPersistedState } from '@/types';

// ── Fixtures ────────────────────────────────────────────────────────────────

const acquisition: CoCAcquisition = {
  propertyAddress: '10 Oak Ave',
  propertyType: 'mfr',
  units: 10,
  sfrBeds: 0, sfrBaths: 0, sfrInPlaceRent: 0, sfrTargetRent: 0, sfrPreStabRent: 0,
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
    1: { grossRent: 125_500, grossRentSystem: true, vacancyPct: 10 },
    3: { grossRentGrowthPct: 3 },
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

const calcState: CalcPersistedState = {
  mode: 'renovate',
  totalDuration: 12,
  unitsToStabilize: [2, 2],
  perUnitMonths: [2, 2],
  scheduleByType: [
    [0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0],
    [0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0],
  ],
  leaseUpToStabilize: [3, 3],
  leaseUpScheduleByType: [
    [0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0],
    [0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0],
  ],
  manualDuration: 0,
  manualPreStabRents: [0, 0],
  localRents: [
    { inPlace: 1200, target: 1500 },
    { inPlace: 800, target: 1000 },
  ],
  distributionMethod: 'weighted',
};

// ── Helpers ────────────────────────────────────────────────────────────────

const { units, avgTargetRent, avgPreStabRent } = computeAvgRents(acquisition);

function buildBaseResult() {
  const scenario: CoCScenario = {
    id: 'base', name: 'Base', scenarioType: 'base',
    acquisition, operations, proForma, refinance,
    createdAt: '', updatedAt: '',
  };
  return projectScenario(scenario);
}

function buildWhatIf(partial: Record<string, unknown> = {}) {
  const baseResult = buildBaseResult();
  // Defaults must match the EFFECTIVE chained values from the ProForma.
  // Year 1 vacancy override = 10% cascades to all years via the chain.
  const defaults = {
    targetRentPerUnit: avgTargetRent,
    targetRentsByType: [1500, 1000],
    preStabRentPerUnit: avgPreStabRent,
    vacancyPct: 10, // effective base = Year 1 override, chained to all years
    vacancyByYear: { 1: 10, 2: 10, 3: 10, 4: 10, 5: 10 } as Record<number, number>,
    rentGrowthPct: 3,
    rentGrowthByYear: { 3: 3 } as Record<number, number>,
    propertyMgmtPct: 8,
    maintenancePct: 5,
    fixedExpenseGrowthPct: 2,
    interestRate: 7,
    exitCapRate: 8,
    purchasePrice: 1_000_000,
    projectionYears: 5,
    refiRate: 6.5,
    refiYear: 3,
    ...partial,
  };
  return buildWhatIfResult(defaults, {
    acquisition, operations, proForma, refinance,
    units,
    origStabilizedAnnual: proForma.grossRent.stabilized,
    defaultPreStabAnnual: avgPreStabRent * units * 12,
    defaultFixedExpenseGrowthPct: 2,
    calcState,
    baseResult,
  });
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('What-If identity — defaults must match base case exactly', () => {
  const base = buildBaseResult();
  const whatif = buildWhatIf();

  it('IRR matches', () => {
    expect(whatif.irr).toBeCloseTo(base.irr ?? 0, 1);
  });

  it('average CoC return matches', () => {
    expect(whatif.avgCoCReturn).toBeCloseTo(base.avgCoCReturn, 1);
  });

  it('equity multiple matches', () => {
    expect(whatif.equityMultiple).toBeCloseTo(base.equityMultiple, 2);
  });

  it('total cash flow matches', () => {
    expect(whatif.totalCashFlow).toBeCloseTo(base.totalCashFlow, 0);
  });

  it('Year 1 NOI matches', () => {
    expect(whatif.yearlyProjections[0].noi).toBeCloseTo(base.yearlyProjections[0].noi, 0);
  });

  it('Year 2 NOI matches', () => {
    expect(whatif.yearlyProjections[1].noi).toBeCloseTo(base.yearlyProjections[1].noi, 0);
  });

  it('Year 5 NOI matches', () => {
    expect(whatif.yearlyProjections[4].noi).toBeCloseTo(base.yearlyProjections[4].noi, 0);
  });
});

describe('What-If identity — random scenarios all match base exactly', () => {
  // Run multiple scenarios with varied inputs to verify the simulator path
  // produces identical results for base and What-If at defaults.

  function makeScenario(targetA: number, targetB: number, countA: number, countB: number, growth: number, vacancy: number, rate: number, capRate: number, price: number) {
    const acq = { ...acquisition, purchasePrice: price, interestRate: rate, exitCapRate: capRate, unitMix: [
      { ...acquisition.unitMix[0], count: countA, rentMonthly: targetA, inPlaceRent: acquisition.unitMix[0].inPlaceRent },
      { ...acquisition.unitMix[1], count: countB, rentMonthly: targetB, inPlaceRent: acquisition.unitMix[1].inPlaceRent },
    ]};

    // Run the simulator FIRST — same as handleCalculate does in production.
    // Both base and What-If use this simulator output, guaranteeing identity.
    const simUnitTypes = acq.unitMix.map(e => ({
      label: `${e.beds}BR`, count: e.count,
      inPlaceRent: e.inPlaceRent || 0, targetRent: e.rentMonthly || 0,
    }));
    const simResult = simulateFromSchedule(
      simUnitTypes,
      calcState.scheduleByType ?? simUnitTypes.map(() => []),
      calcState.leaseUpScheduleByType ?? simUnitTypes.map(() => []),
      calcState.perUnitMonths ?? simUnitTypes.map(() => 0),
      5,
    );
    const stabYear = Math.ceil(simResult.stabilizationMonth / 12);
    const freshOverrides: ProFormaData['yearOverrides'] = { 1: { vacancyPct: vacancy } };
    for (let y = 1; y <= Math.min(stabYear, 5); y++) {
      freshOverrides[y] = { ...(freshOverrides[y] ?? {}), grossRent: simResult.yearlyRents[y - 1], grossRentSystem: true };
    }

    const pf: ProFormaData = {
      ...proForma,
      grossRent: { t12: 0, stab: null, stabilized: (targetA * countA + targetB * countB) * 12, growthPct: growth },
      vacancyPct: { t12: vacancy, stab: null, stabilized: vacancy },
      yearOverrides: freshOverrides,
      leaseAnniversaryByType: simResult.anniversaryByType,
      leaseAnniversaryDistribution: simResult.anniversaryDistribution,
    };
    const ref: CoCRefinance = { ...refinance, newInterestRate: rate - 0.5 };
    const { units: u, avgTargetRent: avg, avgPreStabRent: pre } = computeAvgRents(acq);
    const baseScenario: CoCScenario = { id: 'b', name: 'B', scenarioType: 'base', acquisition: acq, operations, proForma: pf, refinance: ref, createdAt: '', updatedAt: '' };
    const baseR = projectScenario(baseScenario);
    const whatIfR = buildWhatIfResult({
      targetRentPerUnit: avg,
      targetRentsByType: [targetA, targetB],
      preStabRentPerUnit: pre,
      vacancyPct: vacancy,
      vacancyByYear: { 1: vacancy },
      rentGrowthPct: growth,
      propertyMgmtPct: 8, maintenancePct: 5, fixedExpenseGrowthPct: 2,
      interestRate: rate, exitCapRate: capRate, purchasePrice: price, projectionYears: 5,
      refiRate: rate - 0.5, refiYear: 3,
    }, {
      acquisition: acq, operations, proForma: pf, refinance: ref,
      units: u, origStabilizedAnnual: pf.grossRent.stabilized,
      defaultPreStabAnnual: pre * u * 12, defaultFixedExpenseGrowthPct: 2,
      calcState, baseResult: baseR,
    });
    return { baseR, whatIfR };
  }

  const scenarios = [
    { name: 'cheap SFR-like',         a: 800,  b: 600,  cA: 3,  cB: 2,  g: 2, v: 8,  r: 6,   cap: 7,  p: 400_000 },
    { name: 'mid-range MFR',          a: 1500, b: 1000, cA: 10, cB: 5,  g: 3, v: 5,  r: 7,   cap: 8,  p: 1_500_000 },
    { name: 'luxury high-rise',       a: 3000, b: 2200, cA: 20, cB: 10, g: 4, v: 3,  r: 5.5, cap: 6,  p: 8_000_000 },
    { name: 'high vacancy distressed', a: 900,  b: 700,  cA: 8,  cB: 4,  g: 1, v: 15, r: 8,   cap: 10, p: 600_000 },
    { name: 'zero growth stable',     a: 1200, b: 1200, cA: 6,  cB: 6,  g: 0, v: 5,  r: 7,   cap: 9,  p: 1_000_000 },
  ];

  for (const s of scenarios) {
    it(`${s.name}: IRR matches`, () => {
      const { baseR, whatIfR } = makeScenario(s.a, s.b, s.cA, s.cB, s.g, s.v, s.r, s.cap, s.p);
      expect(whatIfR.irr).toBeCloseTo(baseR.irr ?? 0, 2);
    });

    it(`${s.name}: total cash flow matches`, () => {
      const { baseR, whatIfR } = makeScenario(s.a, s.b, s.cA, s.cB, s.g, s.v, s.r, s.cap, s.p);
      expect(whatIfR.totalCashFlow).toBeCloseTo(baseR.totalCashFlow, 0);
    });

    it(`${s.name}: equity multiple matches`, () => {
      const { baseR, whatIfR } = makeScenario(s.a, s.b, s.cA, s.cB, s.g, s.v, s.r, s.cap, s.p);
      expect(whatIfR.equityMultiple).toBeCloseTo(baseR.equityMultiple, 3);
    });
  }
});

describe('What-If per-year overrides use the same projector as the base', () => {
  it('per-year vacancy override changes NOI for that year', () => {
    const base = buildWhatIf();
    const withHighVacYr2 = buildWhatIf({ vacancyByYear: { 1: 10, 2: 20, 3: 10, 4: 10, 5: 10 } });
    // Year 2 NOI should decrease (higher vacancy: 20% vs base 10%)
    expect(withHighVacYr2.yearlyProjections[1].noi).toBeLessThan(base.yearlyProjections[1].noi);
    // Other years unchanged (same 10% as base)
    expect(withHighVacYr2.yearlyProjections[0].noi).toBeCloseTo(base.yearlyProjections[0].noi, 0);
    expect(withHighVacYr2.yearlyProjections[2].noi).toBeCloseTo(base.yearlyProjections[2].noi, 0);
  });

  it('per-year rent growth override changes Year 3 results (Year 2 unchanged)', () => {
    const base = buildWhatIf();
    const withHighGrowthYr3 = buildWhatIf({ rentGrowthByYear: { 3: 10 } });
    // Year 3 should differ from base (higher market rent → different EGI/NOI)
    expect(withHighGrowthYr3.yearlyProjections[2].noi).not.toBeCloseTo(base.yearlyProjections[2].noi, 0);
    // Year 2 unchanged (growth applies FROM Year 3)
    expect(withHighGrowthYr3.yearlyProjections[1].noi).toBeCloseTo(base.yearlyProjections[1].noi, 0);
  });

  it('per-type rent override produces different IRR than blended', () => {
    // Raise only Type A, keep Type B
    const typeAUp = buildWhatIf({ targetRentsByType: [1800, 1000] });
    const base = buildWhatIf();
    expect(typeAUp.irr).toBeGreaterThan(base.irr ?? 0);
  });

  it('OpEx ratio override scales expenses for that year', () => {
    const base = buildWhatIf();
    const baseResult = buildBaseResult();
    const yr2Ratio = baseResult.yearlyProjections[1].effectiveRent > 0
      ? (baseResult.yearlyProjections[1].opex / baseResult.yearlyProjections[1].effectiveRent) * 100
      : 0;
    // Double the OpEx ratio for Year 2
    const withHighOpex = buildWhatIf({ opexRatioByYear: { 2: yr2Ratio * 2 } });
    expect(withHighOpex.yearlyProjections[1].opex).toBeGreaterThan(base.yearlyProjections[1].opex);
    expect(withHighOpex.yearlyProjections[1].noi).toBeLessThan(base.yearlyProjections[1].noi);
  });
});
