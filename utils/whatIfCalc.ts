import { projectScenario } from '@/utils/dealAnalyzerCalc';
import { simulateFromSchedule } from '@/components/DealAnalyzer/RehabRentCalculator';
import type { CoCAcquisition, CoCOperations, CoCRefinance, CoCResult, ProFormaData, CoCScenario, CalcPersistedState } from '@/types';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface WhatIfOverrides {
  targetRentPerUnit: number;
  /** Per-type target rents (indexed by unit-mix order). When present, used instead of targetRentPerUnit. */
  targetRentsByType?: number[];
  preStabRentPerUnit: number;
  vacancyPct: number;
  /** Per-year vacancy overrides (keyed by year number). Unset years use vacancyPct. */
  vacancyByYear?: Record<number, number>;
  rentGrowthPct: number;
  /** Per-year growth overrides (keyed by year number, e.g. {3: 5} = Year 3 at 5%). Unset years use rentGrowthPct. */
  rentGrowthByYear?: Record<number, number>;
  propertyMgmtPct: number;
  maintenancePct: number;
  fixedExpenseGrowthPct: number;
  /** Property tax growth per year — split from other fixed expenses. */
  propertyTaxGrowthByYear?: Record<number, number>;
  /** Non-tax fixed expense growth per year. */
  fixedExpenseGrowthByYear?: Record<number, number>;
  /** Total OpEx as % of EGI — per-year overrides keyed by year number. */
  opexRatioByYear?: Record<number, number>;
  interestRate: number;
  exitCapRate: number;
  purchasePrice: number;
  projectionYears: number;
  refiRate?: number;
  refiYear?: number;
}

export interface BuildDeps {
  acquisition: CoCAcquisition;
  operations: CoCOperations;
  proForma: ProFormaData;
  refinance: CoCRefinance;
  units: number;
  origStabilizedAnnual: number;
  defaultPreStabAnnual: number;
  defaultFixedExpenseGrowthPct: number;
  calcState?: CalcPersistedState;
  baseResult?: CoCResult;
}

// ── Pure helpers ───────────────────────────────────────────────────────────────

export function computeAvgRents(acquisition: CoCAcquisition): { units: number; avgTargetRent: number; avgPreStabRent: number } {
  if (acquisition.propertyType === 'sfr') {
    return { units: 1, avgTargetRent: acquisition.sfrTargetRent || 0, avgPreStabRent: acquisition.sfrPreStabRent || 0 };
  }
  if (acquisition.unitMix && acquisition.unitMix.length > 0) {
    const totalUnits = acquisition.unitMix.reduce((s, u) => s + u.count, 0);
    if (totalUnits === 0) return { units: 0, avgTargetRent: 0, avgPreStabRent: 0 };
    return {
      units: totalUnits,
      avgTargetRent: acquisition.unitMix.reduce((s, u) => s + u.rentMonthly * u.count, 0) / totalUnits,
      avgPreStabRent: acquisition.unitMix.reduce((s, u) => s + u.preStabRent * u.count, 0) / totalUnits,
    };
  }
  return { units: acquisition.units || 1, avgTargetRent: 0, avgPreStabRent: 0 };
}

export function buildWhatIfResult(ov: WhatIfOverrides, deps: BuildDeps): CoCResult {
  const { acquisition, operations, proForma, refinance, units, origStabilizedAnnual, calcState } = deps;
  const effectiveUnits = Math.max(1, units);
  const isMfr = acquisition.propertyType === 'mfr' && acquisition.unitMix.length > 0;

  // Per-type target rents: use explicit per-type values when available.
  // Single-type deals or single-slider mode: just use targetRentPerUnit for every type.
  const perTypeRents: number[] = ov.targetRentsByType && ov.targetRentsByType.length > 0
    ? ov.targetRentsByType
    : isMfr
    ? acquisition.unitMix.map(() => ov.targetRentPerUnit)
    : [ov.targetRentPerUnit];

  // Compute the actual new stabilized annual from per-type rents
  const newTargetAnnual = isMfr
    ? acquisition.unitMix.reduce((s, e, i) => s + (perTypeRents[i] ?? e.rentMonthly ?? 0) * e.count * 12, 0)
    : perTypeRents[0] * effectiveUnits * 12;

  const priceRatio = acquisition.purchasePrice > 0 ? ov.purchasePrice / acquisition.purchasePrice : 1;
  const fixedGrowthChanged = ov.fixedExpenseGrowthPct !== deps.defaultFixedExpenseGrowthPct;
  const rentGrowthChanged = ov.rentGrowthPct !== proForma.grossRent.growthPct;
  const vacancyChanged = ov.vacancyPct !== proForma.vacancyPct.stabilized;
  const expGrowthChanged = ov.fixedExpenseGrowthPct !== deps.defaultFixedExpenseGrowthPct;

  // ── Re-run the stabilization simulator with the What-If target rents ──
  // Uses per-type rents so each type gets its exact What-If value.
  // In-place rents stay unchanged — only target rent moves.
  // ── Always re-run the simulator with the What-If target rents ──
  // The simulator is deterministic: same inputs → same output. If the What-If
  // at defaults doesn't match the base case, the root cause is stale data in
  // the ProForma (anniversary or yearOverrides not matching current calcState).
  // We never skip the simulator — it IS the source of truth.
  const projYears = Math.max(Math.round(ov.projectionYears), 2);

  const unitTypes = isMfr
    ? acquisition.unitMix.map((e, i) => ({
        label: `${e.beds}BR/${e.baths}BA`,
        count: e.count,
        inPlaceRent: e.inPlaceRent || 0,
        targetRent: perTypeRents[i] ?? e.rentMonthly ?? 0,
      }))
    : [{
        label: 'SFR',
        count: 1,
        inPlaceRent: acquisition.sfrInPlaceRent || 0,
        targetRent: perTypeRents[0] ?? ov.targetRentPerUnit,
      }];

  const scheduleByType = calcState?.scheduleByType ?? unitTypes.map(() => []);
  const leaseUpScheduleByType = calcState?.leaseUpScheduleByType ?? unitTypes.map(() => []);
  const perUnitMonths = calcState?.perUnitMonths ?? unitTypes.map(() => 0);

  const simResult = simulateFromSchedule(unitTypes, scheduleByType, leaseUpScheduleByType, perUnitMonths, projYears);

  // Start with ALL existing yearOverrides from the ProForma, then overlay
  // the simulator's transition-year rents on top.
  const freshYearOverrides: ProFormaData['yearOverrides'] = {};
  for (const [yrStr, yrOv] of Object.entries(proForma.yearOverrides ?? {})) {
    if (yrOv) freshYearOverrides[Number(yrStr)] = { ...yrOv };
  }
  const stabYear = Math.ceil(simResult.stabilizationMonth / 12);
  const transitionYears = Array.from({ length: Math.min(stabYear, projYears) }, (_, i) => i + 1);
  transitionYears.forEach(y => {
    freshYearOverrides[y] = {
      ...(freshYearOverrides[y] ?? {}),
      grossRent: simResult.yearlyRents[y - 1],
      grossRentSystem: true,
    };
  });

  const freshAnniversaryByType = simResult.anniversaryByType;
  const freshAnniversaryDist = simResult.anniversaryDistribution;

  // Strip per-year overrides when what-if changes the corresponding variable
  for (const [yearStr] of Object.entries(freshYearOverrides)) {
    const y = Number(yearStr);
    const ov2 = freshYearOverrides[y];
    if (!ov2) continue;
    if (rentGrowthChanged) delete ov2.grossRentGrowthPct;
    if (vacancyChanged) delete ov2.vacancyPct;
    if (expGrowthChanged) delete ov2.expenseGrowthPcts;
  }

  const modifiedExpenses = proForma.expenses.map(e => {
    if (e.isPercentOfEGI && e.name.toLowerCase().includes('management'))
      return { ...e, stabilizedValue: ov.propertyMgmtPct };
    if (e.isPercentOfEGI && (e.name.toLowerCase().includes('maintenance') || e.name.toLowerCase().includes('repair')))
      return { ...e, stabilizedValue: ov.maintenancePct };
    const isTax = !e.isPercentOfEGI && e.name.toLowerCase().includes('tax');
    if (isTax)
      return { ...e, stabilizedValue: e.stabilizedValue * priceRatio, ...(fixedGrowthChanged ? { growthPct: ov.fixedExpenseGrowthPct } : {}) };
    if (!e.isPercentOfEGI)
      return fixedGrowthChanged ? { ...e, growthPct: ov.fixedExpenseGrowthPct } : e;
    return e;
  });

  // Inject per-year property tax growth overrides
  if (ov.propertyTaxGrowthByYear) {
    const taxExpense = modifiedExpenses.find(e => !e.isPercentOfEGI && e.name.toLowerCase().includes('tax'));
    if (taxExpense) {
      for (const [yrStr, rate] of Object.entries(ov.propertyTaxGrowthByYear)) {
        const y = Number(yrStr);
        const ye = freshYearOverrides[y] ?? {};
        freshYearOverrides[y] = { ...ye, expenseGrowthPcts: { ...(ye.expenseGrowthPcts ?? {}), [taxExpense.id]: rate } };
      }
    }
  }
  // Inject per-year non-tax fixed expense growth overrides
  if (ov.fixedExpenseGrowthByYear) {
    const nonTaxFixed = modifiedExpenses.filter(e => !e.isPercentOfEGI && !e.name.toLowerCase().includes('tax'));
    for (const exp of nonTaxFixed) {
      for (const [yrStr, rate] of Object.entries(ov.fixedExpenseGrowthByYear)) {
        const y = Number(yrStr);
        const ye = freshYearOverrides[y] ?? {};
        freshYearOverrides[y] = { ...ye, expenseGrowthPcts: { ...(ye.expenseGrowthPcts ?? {}), [exp.id]: rate } };
      }
    }
  }

  // Inject per-year rent growth overrides into yearOverrides
  if (ov.rentGrowthByYear) {
    for (const [yrStr, rate] of Object.entries(ov.rentGrowthByYear)) {
      const y = Number(yrStr);
      freshYearOverrides[y] = { ...(freshYearOverrides[y] ?? {}), grossRentGrowthPct: rate };
    }
  }
  // Inject per-year vacancy overrides into yearOverrides
  if (ov.vacancyByYear) {
    for (const [yrStr, pct] of Object.entries(ov.vacancyByYear)) {
      const y = Number(yrStr);
      freshYearOverrides[y] = { ...(freshYearOverrides[y] ?? {}), vacancyPct: pct };
    }
  }
  // Inject per-year OpEx ratio overrides — scale each expense's year override
  // proportionally so total OpEx/EGI hits the target percentage.
  if (ov.opexRatioByYear && deps.baseResult) {
    for (const [yrStr, targetPct] of Object.entries(ov.opexRatioByYear)) {
      const y = Number(yrStr);
      const proj = deps.baseResult.yearlyProjections?.[y - 1];
      if (!proj || proj.effectiveRent <= 0) continue;
      const baseRatio = proj.opex / proj.effectiveRent * 100;
      if (baseRatio <= 0) continue;
      const multiplier = targetPct / baseRatio;
      // Scale each expense for this year
      const expOvs: Record<string, number> = {};
      for (const exp of modifiedExpenses) {
        if (exp.isPercentOfEGI) {
          expOvs[exp.id] = exp.stabilizedValue * multiplier;
        } else {
          // For fixed expenses, scale the chained value for this year
          const baseVal = exp.stabilizedValue * Math.pow(1 + exp.growthPct / 100, y - 1);
          expOvs[exp.id] = baseVal * multiplier;
        }
      }
      freshYearOverrides[y] = { ...(freshYearOverrides[y] ?? {}), expenses: { ...(freshYearOverrides[y]?.expenses ?? {}), ...expOvs } };
    }
  }

  const scenario: CoCScenario = {
    id: 'whatif',
    name: 'What If',
    scenarioType: 'base',
    acquisition: {
      ...acquisition,
      purchasePrice: ov.purchasePrice,
      interestRate: ov.interestRate,
      exitCapRate: ov.exitCapRate,
      projectionYears: Math.round(ov.projectionYears),
    },
    operations,
    proForma: {
      ...proForma,
      grossRent: { t12: proForma.grossRent.t12, stab: newTargetAnnual, stabilized: newTargetAnnual, growthPct: ov.rentGrowthPct },
      vacancyPct: { t12: proForma.vacancyPct.t12, stab: null, stabilized: ov.vacancyPct },
      creditLossPct: proForma.creditLossPct ?? { t12: 0, stab: null, stabilized: 0 },
      expenses: modifiedExpenses,
      yearOverrides: freshYearOverrides,
      ...(freshAnniversaryByType ? { leaseAnniversaryByType: freshAnniversaryByType } : {}),
      ...(freshAnniversaryDist ? { leaseAnniversaryDistribution: freshAnniversaryDist } : {}),
    },
    refinance: refinance.enabled
      ? { ...refinance, newInterestRate: ov.refiRate ?? refinance.newInterestRate, refiYear: Math.round(ov.refiYear ?? refinance.refiYear ?? 3) }
      : refinance,
    createdAt: '',
    updatedAt: '',
  };

  return projectScenario(scenario);
}

/**
 * Binary-search the break-even value for a single variable.
 * worseDir: 'up' = higher value hurts metric; 'down' = lower value hurts metric.
 *
 * Returns:
 *   number   — the break-even value found within [searchMin, searchMax]
 *   null     — already below target at current value (deal is already failing)
 *   'beyond' — deal is so strong it never hits target within the search range
 */
export function findBreakEven(
  buildFn: (v: number) => CoCResult,
  searchMin: number,
  searchMax: number,
  metric: (r: CoCResult) => number,
  targetValue: number,
  worseDir: 'up' | 'down',
): number | null | 'beyond' {
  const atMin = metric(buildFn(searchMin));
  const atMax = metric(buildFn(searchMax));

  if (worseDir === 'up') {
    if (atMin <= targetValue) return null;    // already failing at current value
    if (atMax > targetValue) return 'beyond'; // still beating target even at worst case
  } else {
    if (atMax <= targetValue) return null;
    if (atMin > targetValue) return 'beyond';
  }

  let lo = searchMin, hi = searchMax;
  for (let i = 0; i < 48; i++) {
    const mid = (lo + hi) / 2;
    const m = metric(buildFn(mid));
    if (worseDir === 'up') { if (m > targetValue) lo = mid; else hi = mid; }
    else                   { if (m > targetValue) hi = mid; else lo = mid; }
    if (hi - lo < 0.01) break;
  }
  return (lo + hi) / 2;
}
