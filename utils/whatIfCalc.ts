import { projectScenario } from '@/utils/dealAnalyzerCalc';
import { simulateFromSchedule } from '@/components/DealAnalyzer/RehabRentCalculator';
import type { CoCAcquisition, CoCOperations, CoCRefinance, CoCResult, ProFormaData, CoCScenario, CalcPersistedState } from '@/types';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface WhatIfOverrides {
  targetRentPerUnit: number;
  preStabRentPerUnit: number;
  vacancyPct: number;
  rentGrowthPct: number;
  propertyMgmtPct: number;
  maintenancePct: number;
  fixedExpenseGrowthPct: number;
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
  const newTargetAnnual = ov.targetRentPerUnit * effectiveUnits * 12;
  const rentRatio = origStabilizedAnnual > 0 ? newTargetAnnual / origStabilizedAnnual : 1;

  const priceRatio = acquisition.purchasePrice > 0 ? ov.purchasePrice / acquisition.purchasePrice : 1;
  const fixedGrowthChanged = ov.fixedExpenseGrowthPct !== deps.defaultFixedExpenseGrowthPct;
  const rentGrowthChanged = ov.rentGrowthPct !== proForma.grossRent.growthPct;
  const vacancyChanged = ov.vacancyPct !== proForma.vacancyPct.stabilized;
  const expGrowthChanged = ov.fixedExpenseGrowthPct !== deps.defaultFixedExpenseGrowthPct;

  // ── Re-run the stabilization simulator with the What-If target rent ──
  // This gives exact Year 1 rent (not proportionally scaled) because
  // in-place rents stay unchanged — only target rent moves.
  let freshYearOverrides: ProFormaData['yearOverrides'] = {};
  let freshAnniversaryByType: ProFormaData['leaseAnniversaryByType'] | undefined;
  let freshAnniversaryDist: number[] | undefined;

  const hasSchedule = calcState?.scheduleByType?.some(s => s.some(n => n > 0)) ||
    calcState?.leaseUpScheduleByType?.some(s => s.some(n => n > 0));

  if (hasSchedule && calcState) {
    // Build unit types with the What-If target rent (in-place stays the same)
    const isMfr = acquisition.propertyType === 'mfr' && acquisition.unitMix.length > 0;
    const unitTypes = isMfr
      ? acquisition.unitMix.map(e => ({
          label: `${e.beds}BR/${e.baths}BA`,
          count: e.count,
          inPlaceRent: e.inPlaceRent || 0,
          targetRent: (e.rentMonthly || 0) * rentRatio,
        }))
      : [{
          label: 'SFR',
          count: 1,
          inPlaceRent: acquisition.sfrInPlaceRent || 0,
          targetRent: ov.targetRentPerUnit,
        }];

    const scheduleByType = calcState.scheduleByType ?? unitTypes.map(() => []);
    const leaseUpScheduleByType = calcState.leaseUpScheduleByType ?? unitTypes.map(() => []);
    const perUnitMonths = calcState.perUnitMonths ?? unitTypes.map(() => 0);
    const projYears = Math.max(Math.round(ov.projectionYears), 2);

    const simResult = simulateFromSchedule(unitTypes, scheduleByType, leaseUpScheduleByType, perUnitMonths, projYears);

    // Build year overrides from fresh simulation (same logic as the calculator's auto-apply)
    const stabYear = Math.ceil(simResult.stabilizationMonth / 12);
    const transitionYears = Array.from({ length: Math.min(stabYear, projYears) }, (_, i) => i + 1);
    transitionYears.forEach(y => {
      freshYearOverrides[y] = {
        ...(proForma.yearOverrides?.[y] ?? {}),
        grossRent: simResult.yearlyRents[y - 1],
        grossRentSystem: true,
      };
    });

    freshAnniversaryByType = simResult.anniversaryByType;
    freshAnniversaryDist = simResult.anniversaryDistribution;
  } else {
    // No schedule data — fall back to proportional scaling of existing overrides
    for (const [yearStr, yearOv] of Object.entries(proForma.yearOverrides ?? {})) {
      if (!yearOv) continue;
      const y = Number(yearStr);
      const cleaned = { ...yearOv };
      if (rentGrowthChanged) delete cleaned.grossRentGrowthPct;
      if (vacancyChanged) delete cleaned.vacancyPct;
      if (expGrowthChanged) delete cleaned.expenseGrowthPcts;
      if (cleaned.grossRent !== undefined && cleaned.grossRentSystem) {
        freshYearOverrides[y] = { ...cleaned, grossRent: cleaned.grossRent * rentRatio };
      } else {
        freshYearOverrides[y] = cleaned;
      }
    }
    freshAnniversaryByType = proForma.leaseAnniversaryByType?.map(t => ({
      ...t,
      targetRent: t.targetRent * rentRatio,
    }));
  }

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
    if (!e.isPercentOfEGI && e.name.toLowerCase().includes('tax'))
      return { ...e, stabilizedValue: e.stabilizedValue * priceRatio, ...(fixedGrowthChanged ? { growthPct: ov.fixedExpenseGrowthPct } : {}) };
    if (!e.isPercentOfEGI)
      return fixedGrowthChanged ? { ...e, growthPct: ov.fixedExpenseGrowthPct } : e;
    return e;
  });

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
      grossRent: { t12: newTargetAnnual, stab: newTargetAnnual, stabilized: newTargetAnnual, growthPct: ov.rentGrowthPct },
      vacancyPct: { t12: ov.vacancyPct, stab: null, stabilized: ov.vacancyPct },
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
