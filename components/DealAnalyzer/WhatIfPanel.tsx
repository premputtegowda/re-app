'use client';

import { useState, useMemo } from 'react';
import { RotateCcw } from 'lucide-react';
import { Card } from '@/components/UI/Card';
import { projectScenario, formatCurrency, formatPct, formatMultiple } from '@/utils/dealAnalyzerCalc';
import type { CoCAcquisition, CoCOperations, CoCRefinance, CoCResult, ProFormaData, CoCScenario } from '@/types';

// ── Types ──────────────────────────────────────────────────────────────────────

interface WhatIfOverrides {
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
}

interface BuildDeps {
  acquisition: CoCAcquisition;
  operations: CoCOperations;
  proForma: ProFormaData;
  refinance: CoCRefinance;
  units: number;
  origStabilizedAnnual: number;
  defaultPreStabAnnual: number;
}

interface WhatIfPanelProps {
  acquisition: CoCAcquisition;
  operations: CoCOperations;
  proForma: ProFormaData;
  refinance: CoCRefinance;
  baseResult: CoCResult;
  embedded?: boolean;
}

// ── Pure helpers ───────────────────────────────────────────────────────────────

function computeAvgRents(acquisition: CoCAcquisition): { units: number; avgTargetRent: number; avgPreStabRent: number } {
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

function buildWhatIfResult(ov: WhatIfOverrides, deps: BuildDeps): CoCResult {
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

  const modifiedExpenses = proForma.expenses.map(e => {
    if (e.isPercentOfEGI && e.name.toLowerCase().includes('management'))
      return { ...e, stabilizedValue: ov.propertyMgmtPct };
    if (e.isPercentOfEGI && (e.name.toLowerCase().includes('maintenance') || e.name.toLowerCase().includes('repair')))
      return { ...e, stabilizedValue: ov.maintenancePct };
    if (!e.isPercentOfEGI)
      return { ...e, growthPct: ov.fixedExpenseGrowthPct };
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
    refinance,
    createdAt: '',
    updatedAt: '',
  };

  return projectScenario(scenario);
}

/**
 * Binary-search the break-even value for a single variable.
 * worseDir: 'up' = higher value hurts metric; 'down' = lower value hurts metric.
 */
function findBreakEven(
  buildFn: (v: number) => CoCResult,
  searchMin: number,
  searchMax: number,
  metric: (r: CoCResult) => number,
  targetValue: number,
  worseDir: 'up' | 'down',
): number | null {
  const atMin = metric(buildFn(searchMin));
  const atMax = metric(buildFn(searchMax));

  if (worseDir === 'up') {
    if (atMin <= targetValue) return null; // already below target at minimum — no cushion
    if (atMax > targetValue) return null;  // never reaches target in range
  } else {
    if (atMax <= targetValue) return null;
    if (atMin > targetValue) return null;
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

// ── Slider ─────────────────────────────────────────────────────────────────────

function Slider({ label, sublabel, value, min, max, step, displayValue, annotation, onChange, isChanged }: {
  label: string; sublabel?: string; value: number; min: number; max: number; step: number;
  displayValue: string; annotation?: string; onChange: (v: number) => void; isChanged: boolean;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  const clamped = Math.min(Math.max(pct, 0), 100);
  return (
    <div className="space-y-1.5">
      <div className="flex items-start justify-between gap-2">
        <div>
          <span className={`text-xs font-medium ${isChanged ? 'text-primary-600 dark:text-primary-400' : 'text-slate-600 dark:text-slate-400'}`}>
            {label}
            {isChanged && <span className="ml-1 text-[10px] bg-primary-100 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400 px-1 rounded">edited</span>}
          </span>
          {sublabel && <p className="text-[10px] text-slate-400 mt-0.5">{sublabel}</p>}
        </div>
        <div className="text-right shrink-0">
          <span className={`text-sm font-semibold tabular-nums ${isChanged ? 'text-primary-700 dark:text-primary-300' : 'text-slate-800 dark:text-slate-200'}`}>{displayValue}</span>
          {annotation && <p className="text-[10px] text-slate-400 tabular-nums mt-0.5">{annotation}</p>}
        </div>
      </div>
      <div className="relative h-5 flex items-center">
        <div className="w-full h-1.5 rounded-full bg-slate-200 dark:bg-slate-600">
          <div className={`h-full rounded-full transition-all ${isChanged ? 'bg-primary-500' : 'bg-slate-400 dark:bg-slate-500'}`} style={{ width: `${clamped}%` }} />
        </div>
        <input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.target.value))}
          className="absolute inset-0 w-full opacity-0 cursor-pointer h-full" />
        <div className={`absolute w-4 h-4 rounded-full border-2 shadow-sm pointer-events-none transition-colors ${isChanged ? 'bg-white border-primary-500' : 'bg-white dark:bg-slate-300 border-slate-400 dark:border-slate-500'}`}
          style={{ left: `calc(${clamped}% - 8px)` }} />
      </div>
      <div className="flex justify-between text-[10px] text-slate-400">
        <span>{min}{max <= 100 && min >= 0 && !displayValue.includes('$') && !displayValue.includes('yr') ? '%' : ''}</span>
        <span>{max}{max <= 100 && min >= 0 && !displayValue.includes('$') && !displayValue.includes('yr') ? '%' : ''}</span>
      </div>
    </div>
  );
}

// ── KPI delta ──────────────────────────────────────────────────────────────────

function KPIDelta({ label, value, delta, deltaFormatted, inverse }: {
  label: string; value: string; delta: number; deltaFormatted: string; inverse?: boolean;
}) {
  const positive = inverse ? delta < 0 : delta > 0;
  const color = Math.abs(delta) < 0.001 ? 'text-slate-500' : positive ? 'text-secondary-600 dark:text-secondary-400' : 'text-red-500 dark:text-red-400';
  const arrow = Math.abs(delta) < 0.001 ? '' : positive ? '▲' : '▼';
  return (
    <div className="bg-slate-50 dark:bg-slate-700/40 rounded-xl p-3">
      <p className="text-xs text-slate-500 mb-1">{label}</p>
      <p className="text-lg font-bold text-slate-900 dark:text-white tabular-nums">{value}</p>
      {Math.abs(delta) > 0.001 && <p className={`text-xs font-medium tabular-nums mt-0.5 ${color}`}>{arrow} {deltaFormatted}</p>}
    </div>
  );
}

// ── Break-even table ───────────────────────────────────────────────────────────

interface BreakEvenRow {
  label: string;
  assumption: string;
  breakEven: number | null;
  breakEvenFormatted: string | null;
  cushion: string | null;
  cushionPct: number | null; // relative cushion for color coding
  worseDir: 'up' | 'down';
}

function cushionColor(pct: number | null): string {
  if (pct === null) return 'text-slate-400';
  if (pct >= 25) return 'text-secondary-600 dark:text-secondary-400';
  if (pct >= 10) return 'text-amber-500 dark:text-amber-400';
  return 'text-red-500 dark:text-red-400';
}

function cushionBadge(pct: number | null): string {
  if (pct === null) return 'bg-slate-100 dark:bg-slate-700 text-slate-400';
  if (pct >= 25) return 'bg-secondary-50 dark:bg-secondary-900/20 text-secondary-600 dark:text-secondary-400';
  if (pct >= 10) return 'bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400';
  return 'bg-red-50 dark:bg-red-900/20 text-red-500 dark:text-red-400';
}

function BreakEvenTable({ rows }: { rows: BreakEvenRow[] }) {
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-700">
            <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500 dark:text-slate-400">Variable</th>
            <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500 dark:text-slate-400">Assumption</th>
            <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500 dark:text-slate-400">Break-even</th>
            <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500 dark:text-slate-400">Cushion</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
          {rows.map(row => (
            <tr key={row.label} className="hover:bg-slate-50/60 dark:hover:bg-slate-700/20 transition-colors">
              <td className="px-3 py-2.5 text-xs font-medium text-slate-700 dark:text-slate-300">{row.label}</td>
              <td className="px-3 py-2.5 text-xs text-right tabular-nums text-slate-600 dark:text-slate-400">{row.assumption}</td>
              <td className="px-3 py-2.5 text-xs text-right tabular-nums font-medium text-slate-800 dark:text-slate-200">
                {row.breakEvenFormatted ?? <span className="text-slate-300 dark:text-slate-600">—</span>}
              </td>
              <td className="px-3 py-2.5 text-right">
                {row.cushion ? (
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full tabular-nums ${cushionBadge(row.cushionPct)}`}>
                    {row.worseDir === 'up' ? '+' : ''}{row.cushion}
                  </span>
                ) : (
                  <span className="text-[10px] text-slate-300 dark:text-slate-600">no room</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Section label ──────────────────────────────────────────────────────────────

function SectionLabel({ label }: { label: string }) {
  return (
    <div className="col-span-full flex items-center gap-2 pt-1">
      <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500">{label}</span>
      <div className="flex-1 h-px bg-slate-200 dark:bg-slate-700" />
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export function WhatIfPanel({ acquisition, operations, proForma, refinance, baseResult, embedded }: WhatIfPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [targetCoCReturn, setTargetCoCReturn] = useState(0);

  // ── Anchor values from unit mix ──
  const { units, avgTargetRent, avgPreStabRent } = useMemo(() => computeAvgRents(acquisition), [acquisition]);
  const effectiveUnits = Math.max(1, units);
  const fallbackPerUnit = (proForma.grossRent.stabilized || proForma.grossRent.t12 || 12000) / (effectiveUnits * 12);
  const baseTargetRent = avgTargetRent > 0 ? avgTargetRent : fallbackPerUnit;
  const basePreStabRent = avgPreStabRent > 0 ? avgPreStabRent : baseTargetRent * 0.8;

  const origStabilizedAnnual = proForma.grossRent.stabilized;
  const hasStabilizingYears = Object.values(proForma.yearOverrides ?? {}).some(
    ov => ov?.grossRent !== undefined && ov.grossRent < origStabilizedAnnual
  );

  // ── Find expense rates from proForma ──
  const propMgmtExpense = proForma.expenses.find(e => e.isPercentOfEGI && e.name.toLowerCase().includes('management'));
  const maintenanceExpense = proForma.expenses.find(e => e.isPercentOfEGI && (e.name.toLowerCase().includes('maintenance') || e.name.toLowerCase().includes('repair')));
  const fixedExpenses = proForma.expenses.filter(e => !e.isPercentOfEGI);
  const avgFixedGrowthPct = fixedExpenses.length > 0
    ? fixedExpenses.reduce((s, e) => s + e.growthPct, 0) / fixedExpenses.length
    : 2;

  // ── Defaults ──
  const defaults: WhatIfOverrides = useMemo(() => ({
    targetRentPerUnit: baseTargetRent,
    preStabRentPerUnit: basePreStabRent,
    vacancyPct: proForma.vacancyPct.stabilized || proForma.vacancyPct.t12 || 5,
    rentGrowthPct: proForma.grossRent.growthPct,
    propertyMgmtPct: propMgmtExpense?.stabilizedValue ?? 8,
    maintenancePct: maintenanceExpense?.stabilizedValue ?? 5,
    fixedExpenseGrowthPct: Math.round(avgFixedGrowthPct * 4) / 4,
    interestRate: acquisition.interestRate,
    exitCapRate: acquisition.exitCapRate || 6,
    purchasePrice: acquisition.purchasePrice,
    projectionYears: acquisition.projectionYears || 10,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []); // intentionally fixed at mount — what-if is a snapshot tool

  const [overrides, setOverrides] = useState<WhatIfOverrides>(defaults);
  const set = (key: keyof WhatIfOverrides) => (v: number) => setOverrides(prev => ({ ...prev, [key]: v }));
  const isChanged = (key: keyof WhatIfOverrides) => overrides[key] !== defaults[key];
  const anyChanged = (Object.keys(defaults) as (keyof WhatIfOverrides)[]).some(isChanged);
  const reset = () => setOverrides(defaults);

  // ── Build deps object (stable reference for break-even) ──
  const deps: BuildDeps = {
    acquisition, operations, proForma, refinance,
    units,
    origStabilizedAnnual,
    defaultPreStabAnnual: defaults.preStabRentPerUnit * effectiveUnits * 12,
  };

  // ── Main what-if result ──
  const whatIfResult = useMemo(() => buildWhatIfResult(overrides, deps),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [overrides, acquisition, operations, proForma, refinance]);

  // ── Break-even computations ──
  const breakEvenRows = useMemo((): BreakEvenRow[] => {
    const build = (partial: Partial<WhatIfOverrides>) => buildWhatIfResult({ ...overrides, ...partial }, deps);
    const cocMetric = (r: CoCResult) => r.avgCoCReturn;
    const irrMetric = (r: CoCResult) => r.irr ?? -999;
    const target = targetCoCReturn;

    const vacBreakEven = findBreakEven(v => build({ vacancyPct: v }), overrides.vacancyPct, 95, cocMetric, target, 'up');
    const rentBreakEven = findBreakEven(v => build({ targetRentPerUnit: v }), 1, overrides.targetRentPerUnit, cocMetric, target, 'down');
    const rateBreakEven = findBreakEven(v => build({ interestRate: v }), overrides.interestRate, 30, cocMetric, target, 'up');
    const priceBreakEven = findBreakEven(v => build({ purchasePrice: v }), overrides.purchasePrice, overrides.purchasePrice * 3, cocMetric, target, 'up');
    const capBreakEven = findBreakEven(v => build({ exitCapRate: v }), overrides.exitCapRate, 30, irrMetric, 0, 'up');

    const vacCushion = vacBreakEven !== null ? vacBreakEven - overrides.vacancyPct : null;
    const rentCushion = rentBreakEven !== null ? overrides.targetRentPerUnit - rentBreakEven : null;
    const rateCushion = rateBreakEven !== null ? rateBreakEven - overrides.interestRate : null;
    const priceCushion = priceBreakEven !== null ? priceBreakEven - overrides.purchasePrice : null;
    const capCushion = capBreakEven !== null ? capBreakEven - overrides.exitCapRate : null;

    return [
      {
        label: 'Vacancy Rate',
        assumption: formatPct(overrides.vacancyPct),
        breakEven: vacBreakEven,
        breakEvenFormatted: vacBreakEven !== null ? formatPct(vacBreakEven) : null,
        cushion: vacCushion !== null ? formatPct(vacCushion) : null,
        cushionPct: vacCushion !== null ? (vacCushion / overrides.vacancyPct) * 100 : null,
        worseDir: 'up',
      },
      {
        label: 'Target Rent / unit',
        assumption: `$${Math.round(overrides.targetRentPerUnit).toLocaleString()}/mo`,
        breakEven: rentBreakEven,
        breakEvenFormatted: rentBreakEven !== null ? `$${Math.round(rentBreakEven).toLocaleString()}/mo` : null,
        cushion: rentCushion !== null ? `$${Math.round(rentCushion).toLocaleString()}` : null,
        cushionPct: rentCushion !== null ? (rentCushion / overrides.targetRentPerUnit) * 100 : null,
        worseDir: 'down',
      },
      {
        label: 'Interest Rate',
        assumption: formatPct(overrides.interestRate),
        breakEven: rateBreakEven,
        breakEvenFormatted: rateBreakEven !== null ? formatPct(rateBreakEven) : null,
        cushion: rateCushion !== null ? formatPct(rateCushion) : null,
        cushionPct: rateCushion !== null ? (rateCushion / overrides.interestRate) * 100 : null,
        worseDir: 'up',
      },
      {
        label: 'Purchase Price',
        assumption: formatCurrency(overrides.purchasePrice),
        breakEven: priceBreakEven,
        breakEvenFormatted: priceBreakEven !== null ? formatCurrency(priceBreakEven) : null,
        cushion: priceCushion !== null ? formatCurrency(priceCushion) : null,
        cushionPct: priceCushion !== null ? (priceCushion / overrides.purchasePrice) * 100 : null,
        worseDir: 'up',
      },
      {
        label: 'Exit Cap Rate (IRR)',
        assumption: formatPct(overrides.exitCapRate),
        breakEven: capBreakEven,
        breakEvenFormatted: capBreakEven !== null ? formatPct(capBreakEven) : null,
        cushion: capCushion !== null ? formatPct(capCushion) : null,
        cushionPct: capCushion !== null ? (capCushion / overrides.exitCapRate) * 100 : null,
        worseDir: 'up',
      },
    ];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overrides, targetCoCReturn, acquisition, operations, proForma, refinance]);

  // ── Slider ranges ──
  const targetMin = Math.max(1, Math.round(basePreStabRent * 0.7));
  const targetMax = Math.round(baseTargetRent * 1.6);
  const preStabMax = Math.round(baseTargetRent * 1.1);
  const priceMin = Math.round(acquisition.purchasePrice * 0.5 / 5000) * 5000;
  const priceMax = Math.round(acquisition.purchasePrice * 2 / 5000) * 5000;
  const annOf = (perUnit: number) => `× ${effectiveUnits} unit${effectiveUnits !== 1 ? 's' : ''} = ${formatCurrency(perUnit * effectiveUnits * 12)}/yr`;

  const innerContent = (
    <div className="space-y-6">
      {/* KPI deltas */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KPIDelta label="Avg CoC Return" value={formatPct(whatIfResult.avgCoCReturn)}
          delta={whatIfResult.avgCoCReturn - baseResult.avgCoCReturn}
          deltaFormatted={formatPct(Math.abs(whatIfResult.avgCoCReturn - baseResult.avgCoCReturn))} />
        <KPIDelta label="IRR" value={whatIfResult.irr !== null ? formatPct(whatIfResult.irr) : '—'}
          delta={(whatIfResult.irr ?? 0) - (baseResult.irr ?? 0)}
          deltaFormatted={formatPct(Math.abs((whatIfResult.irr ?? 0) - (baseResult.irr ?? 0)))} />
        <KPIDelta label="Equity Multiple" value={formatMultiple(whatIfResult.equityMultiple)}
          delta={whatIfResult.equityMultiple - baseResult.equityMultiple}
          deltaFormatted={`${Math.abs(whatIfResult.equityMultiple - baseResult.equityMultiple).toFixed(2)}x`} />
        <KPIDelta label="Total Cash Flow" value={formatCurrency(whatIfResult.totalCashFlow)}
          delta={whatIfResult.totalCashFlow - baseResult.totalCashFlow}
          deltaFormatted={formatCurrency(Math.abs(whatIfResult.totalCashFlow - baseResult.totalCashFlow))} />
      </div>

      {/* Sliders */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-5">
        <SectionLabel label="Income" />
        <Slider label="Target Rent / unit" sublabel="Stabilized rent once fully leased up"
          value={overrides.targetRentPerUnit} min={targetMin} max={targetMax} step={25}
          displayValue={`$${Math.round(overrides.targetRentPerUnit).toLocaleString()}/mo`}
          annotation={annOf(overrides.targetRentPerUnit)}
          onChange={set('targetRentPerUnit')} isChanged={isChanged('targetRentPerUnit')} />
        <Slider label="Pre-stab Rent / unit"
          sublabel={hasStabilizingYears ? 'Rent during renovation / lease-up' : 'Year 1 rent before stabilization'}
          value={overrides.preStabRentPerUnit} min={0} max={preStabMax} step={25}
          displayValue={`$${Math.round(overrides.preStabRentPerUnit).toLocaleString()}/mo`}
          annotation={annOf(overrides.preStabRentPerUnit)}
          onChange={set('preStabRentPerUnit')} isChanged={isChanged('preStabRentPerUnit')} />
        <Slider label="Rent Growth / yr" value={overrides.rentGrowthPct} min={-5} max={15} step={0.25}
          displayValue={formatPct(overrides.rentGrowthPct)}
          onChange={set('rentGrowthPct')} isChanged={isChanged('rentGrowthPct')} />
        <Slider label="Vacancy Rate" value={overrides.vacancyPct} min={0} max={25} step={0.5}
          displayValue={formatPct(overrides.vacancyPct)}
          onChange={set('vacancyPct')} isChanged={isChanged('vacancyPct')} />

        <SectionLabel label="Expenses" />
        <Slider label="Property Mgmt %" sublabel="% of EGI — auto-scales with rent"
          value={overrides.propertyMgmtPct} min={0} max={15} step={0.5}
          displayValue={formatPct(overrides.propertyMgmtPct)}
          onChange={set('propertyMgmtPct')} isChanged={isChanged('propertyMgmtPct')} />
        <Slider label="Maintenance & Repairs %" sublabel="% of EGI — auto-scales with rent"
          value={overrides.maintenancePct} min={0} max={20} step={0.5}
          displayValue={formatPct(overrides.maintenancePct)}
          onChange={set('maintenancePct')} isChanged={isChanged('maintenancePct')} />
        <Slider label="Fixed Expense Growth / yr" sublabel="Taxes, insurance, utilities, CapEx"
          value={overrides.fixedExpenseGrowthPct} min={-2} max={10} step={0.25}
          displayValue={formatPct(overrides.fixedExpenseGrowthPct)}
          onChange={set('fixedExpenseGrowthPct')} isChanged={isChanged('fixedExpenseGrowthPct')} />

        <SectionLabel label="Financing & Exit" />
        <Slider label="Interest Rate" value={overrides.interestRate} min={2} max={15} step={0.125}
          displayValue={formatPct(overrides.interestRate)}
          onChange={set('interestRate')} isChanged={isChanged('interestRate')} />
        <Slider label="Exit Cap Rate" value={overrides.exitCapRate} min={3} max={12} step={0.25}
          displayValue={formatPct(overrides.exitCapRate)}
          onChange={set('exitCapRate')} isChanged={isChanged('exitCapRate')} />
        <Slider label="Purchase Price" value={overrides.purchasePrice} min={priceMin} max={priceMax} step={5000}
          displayValue={formatCurrency(overrides.purchasePrice)}
          onChange={set('purchasePrice')} isChanged={isChanged('purchasePrice')} />
        <Slider label="Hold Period" sublabel="Years before exit"
          value={overrides.projectionYears} min={1} max={20} step={1}
          displayValue={`${Math.round(overrides.projectionYears)} yr${overrides.projectionYears !== 1 ? 's' : ''}`}
          onChange={set('projectionYears')} isChanged={isChanged('projectionYears')} />
      </div>

      {anyChanged && (
        <button type="button" onClick={reset}
          className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 transition-colors">
          <RotateCcw size={12} />
          Reset to original inputs
        </button>
      )}

      {/* Break-even table */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">Break-even Analysis</p>
            <p className="text-xs text-slate-400 mt-0.5">How much can each variable move before the deal fails your target?</p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-xs text-slate-500">Target CoC</span>
            <input
              type="number"
              value={targetCoCReturn}
              onChange={e => setTargetCoCReturn(Number(e.target.value))}
              className="w-14 text-xs text-right tabular-nums font-medium text-slate-800 dark:text-slate-200 bg-slate-100 dark:bg-slate-700 border-none rounded-lg px-2 py-1 outline-none focus:ring-2 focus:ring-primary-400"
              step={0.5}
              min={-20}
              max={50}
            />
            <span className="text-xs text-slate-500">%</span>
          </div>
        </div>
        <BreakEvenTable rows={breakEvenRows} />
      </div>
    </div>
  );

  if (embedded) return innerContent;

  return (
    <Card padding="none">
      <button type="button" onClick={() => setIsOpen(v => !v)}
        className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors rounded-xl">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">What If Analysis</span>
          {anyChanged && (
            <span className="text-[10px] font-medium bg-primary-100 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400 px-1.5 py-0.5 rounded-full">active</span>
          )}
        </div>
        <span className="text-xs text-slate-400">{isOpen ? '▲ collapse' : '▼ expand'}</span>
      </button>
      {isOpen && (
        <div className="px-5 pb-5 border-t border-slate-100 dark:border-slate-700 pt-4">
          {innerContent}
        </div>
      )}
    </Card>
  );
}
