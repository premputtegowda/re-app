import { projectScenario } from '@/utils/dealAnalyzerCalc';
import type { CoCAcquisition, CoCOperations, CoCRefinance, CoCResult, ProFormaData, CoCScenario } from '@/types';

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
  const { acquisition, operations, proForma, refinance, units, origStabilizedAnnual, defaultPreStabAnnual } = deps;
  const effectiveUnits = Math.max(1, units);
  const newTargetAnnual = ov.targetRentPerUnit * effectiveUnits * 12;
  const newPreStabAnnual = ov.preStabRentPerUnit * effectiveUnits * 12;

  // Build scaled year overrides:
  //  - Pre-stab years (rent < origStabilized): scale proportionally to new pre-stab
  //  - System anchor years (rent >= origStabilized, grossRentSystem=true): scale proportionally to new target
  //  - Manual overrides: leave unchanged
  const scaledYearOverrides: ProFormaData['yearOverrides'] = {};
  let hasExistingStabilizingYear = false;

  for (const [yearStr, yearOv] of Object.entries(proForma.yearOverrides ?? {})) {
    if (!yearOv) continue;
    const y = Number(yearStr);
    if (yearOv.grossRent !== undefined && yearOv.grossRent < origStabilizedAnnual) {
      // Pre-stab year — scale relative to new pre-stab
      const ratio = defaultPreStabAnnual > 0 ? yearOv.grossRent / defaultPreStabAnnual : 1;
      scaledYearOverrides[y] = { ...yearOv, grossRent: newPreStabAnnual * ratio };
      hasExistingStabilizingYear = true;
    } else if (yearOv.grossRentSystem && yearOv.grossRent !== undefined && origStabilizedAnnual > 0) {
      // System anchor year (first stabilized year set by calculator) — scale relative to new target
      const ratio = yearOv.grossRent / origStabilizedAnnual;
      scaledYearOverrides[y] = { ...yearOv, grossRent: newTargetAnnual * ratio };
    } else {
      scaledYearOverrides[y] = yearOv;
    }
  }

  // No rent schedule: inject pre-stab year 1 + target anchor year 2 so both sliders have effect
  if (!hasExistingStabilizingYear && ov.preStabRentPerUnit < ov.targetRentPerUnit) {
    scaledYearOverrides[1] = { ...(proForma.yearOverrides?.[1] ?? {}), grossRent: newPreStabAnnual, grossRentSystem: true };
    scaledYearOverrides[2] = { ...(proForma.yearOverrides?.[2] ?? {}), grossRent: newTargetAnnual, grossRentSystem: true };
  }

  const priceRatio = acquisition.purchasePrice > 0 ? ov.purchasePrice / acquisition.purchasePrice : 1;

  // Only apply the averaged fixedExpenseGrowthPct when the user has moved the slider
  // away from its default. At default, preserve each expense's individual growth rate
  // so the What-If baseline exactly matches the base scenario result.
  const fixedGrowthChanged = ov.fixedExpenseGrowthPct !== deps.defaultFixedExpenseGrowthPct;

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
      yearOverrides: scaledYearOverrides,
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
