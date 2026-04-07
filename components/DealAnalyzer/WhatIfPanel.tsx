'use client';

import { useState, useMemo } from 'react';
import { RotateCcw, CheckCircle2 } from 'lucide-react';
import { Card } from '@/components/UI/Card';
import { formatCurrency, formatPct, formatMultiple } from '@/utils/dealAnalyzerCalc';
import {
  computeAvgRents,
  buildWhatIfResult,
  findBreakEven,
} from '@/utils/whatIfCalc';
import type { WhatIfOverrides, BuildDeps } from '@/utils/whatIfCalc';
import type { CoCAcquisition, CoCOperations, CoCRefinance, CoCResult, ProFormaData } from '@/types';

interface WhatIfPanelProps {
  acquisition: CoCAcquisition;
  operations: CoCOperations;
  proForma: ProFormaData;
  refinance: CoCRefinance;
  baseResult: CoCResult;
  embedded?: boolean;
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
  cocBreakEvenFormatted: string | null;
  cocCushion: string | null;
  cocCushionPct: number | null;
  cocNA?: boolean; // true when metric is not applicable for CoC
  irrBreakEvenFormatted: string | null;
  irrCushion: string | null;
  irrCushionPct: number | null;
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

function BreakEvenTable({ rows, mode }: { rows: BreakEvenRow[]; mode: 'coc' | 'irr' }) {
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
          {rows.map(row => {
            const na = mode === 'coc' && !!row.cocNA;
            const beFormatted = mode === 'coc' ? row.cocBreakEvenFormatted : row.irrBreakEvenFormatted;
            const cushion = mode === 'coc' ? row.cocCushion : row.irrCushion;
            const cushionPct = mode === 'coc' ? row.cocCushionPct : row.irrCushionPct;
            return (
              <tr key={row.label} className="hover:bg-slate-50/60 dark:hover:bg-slate-700/20 transition-colors">
                <td className="px-3 py-2.5 text-xs font-medium text-slate-700 dark:text-slate-300">{row.label}</td>
                <td className="px-3 py-2.5 text-xs text-right tabular-nums text-slate-600 dark:text-slate-400">{row.assumption}</td>
                {na ? (
                  <>
                    <td className="px-3 py-2.5 text-xs text-right">
                      <span className="text-[10px] text-slate-300 dark:text-slate-600 italic">n/a for CoC</span>
                    </td>
                    <td />
                  </>
                ) : (
                  <>
                    <td className="px-3 py-2.5 text-xs text-right tabular-nums font-medium text-slate-800 dark:text-slate-200">
                      {beFormatted ?? <span className="text-slate-300 dark:text-slate-600">—</span>}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      {cushion ? (
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full tabular-nums ${cushionBadge(cushionPct)}`}>
                          {row.worseDir === 'up' ? '+' : ''}{cushion}
                        </span>
                      ) : (
                        <span className="text-[10px] text-slate-300 dark:text-slate-600">no room</span>
                      )}
                    </td>
                  </>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Goal Seek banner ──────────────────────────────────────────────────────────

type GoalMetric = 'irr' | 'coc';

function GoalSeekBanner({ metric, target, onMetricChange, onTargetChange, result }: {
  metric: GoalMetric;
  target: number;
  onMetricChange: (m: GoalMetric) => void;
  onTargetChange: (v: number) => void;
  result: CoCResult;
}) {
  const current = metric === 'irr' ? (result.irr ?? 0) : result.avgCoCReturn;
  const met = current >= target;
  const pct = target > 0 ? Math.min(100, Math.max(0, (current / target) * 100)) : 100;
  const gap = target - current;

  return (
    <div className={`rounded-xl p-4 border transition-colors ${
      met
        ? 'bg-secondary-50 dark:bg-secondary-900/20 border-secondary-200 dark:border-secondary-800/40'
        : 'bg-slate-50 dark:bg-slate-700/40 border-slate-200 dark:border-slate-700'
    }`}>
      {/* Target selector row */}
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">Target</span>
          <div className="flex items-center bg-white dark:bg-slate-700 rounded-lg border border-slate-200 dark:border-slate-600 p-0.5">
            {(['irr', 'coc'] as const).map(m => (
              <button key={m} type="button" onClick={() => onMetricChange(m)}
                className={`px-2.5 py-0.5 text-xs font-semibold rounded-md transition-all ${
                  metric === m
                    ? 'bg-primary-600 text-white shadow-sm'
                    : 'text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200'
                }`}>
                {m === 'irr' ? 'IRR' : 'CoC'}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <input type="number" value={target} onChange={e => onTargetChange(Number(e.target.value))}
              className="input w-14 text-xs text-right tabular-nums py-1 px-2" step={0.5} min={-20} max={50} />
            <span className="text-xs text-slate-500">%</span>
          </div>
        </div>
        <div className="text-right shrink-0">
          <p className="text-[10px] text-slate-400 uppercase tracking-wide">Current</p>
          <p className={`text-sm font-bold tabular-nums ${met ? 'text-secondary-600 dark:text-secondary-400' : 'text-slate-800 dark:text-slate-200'}`}>
            {current.toFixed(1)}%
          </p>
        </div>
      </div>

      {/* Progress bar */}
      <div className="relative h-2.5 rounded-full bg-slate-200 dark:bg-slate-600 overflow-hidden mb-2">
        <div
          className={`h-full rounded-full transition-all duration-300 ${
            met ? 'bg-secondary-500' : pct >= 80 ? 'bg-amber-400' : 'bg-primary-500'
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* Status row */}
      <div className="flex items-center justify-between">
        {met ? (
          <div className="flex items-center gap-1.5 text-secondary-600 dark:text-secondary-400">
            <CheckCircle2 size={13} />
            <span className="text-xs font-semibold">Target met!</span>
          </div>
        ) : (
          <span className="text-[11px] text-slate-400">Adjust sliders below to close the gap</span>
        )}
        {!met && (
          <span className="text-xs font-semibold text-slate-500 tabular-nums">
            Gap: <span className="text-red-500 dark:text-red-400">{gap.toFixed(1)}%</span>
          </span>
        )}
        {met && (
          <span className="text-[11px] text-slate-400 tabular-nums">
            +{(current - target).toFixed(1)}% above target
          </span>
        )}
      </div>
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
  const [panelMode, setPanelMode] = useState<'explore' | 'goalseek'>('explore');
  const [goalMetric, setGoalMetric] = useState<GoalMetric>('irr');
  const [goalTarget, setGoalTarget] = useState(12);
  const [breakEvenMode, setBreakEvenMode] = useState<'coc' | 'irr'>('coc');
  const [targetCoCReturn, setTargetCoCReturn] = useState(0);
  const [targetIRR, setTargetIRR] = useState(0);

  // ── Anchor values from unit mix ──
  const { units, avgTargetRent, avgPreStabRent } = useMemo(() => computeAvgRents(acquisition), [acquisition]);
  const effectiveUnits = Math.max(1, units);
  const fallbackPerUnit = (proForma.grossRent.stabilized || proForma.grossRent.t12 || 12000) / (effectiveUnits * 12);
  const baseTargetRent = avgTargetRent > 0 ? avgTargetRent : fallbackPerUnit;
  const basePreStabRent = avgPreStabRent > 0 ? avgPreStabRent : baseTargetRent;

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

    const fmt = (be: number | null, format: (v: number) => string) => be !== null ? format(be) : null;
    const fmtRent = (be: number | null) => be !== null ? `$${Math.round(be).toLocaleString()}/mo` : null;

    // CoC break-evens
    const vacBE    = findBreakEven(v => build({ vacancyPct: v }),       overrides.vacancyPct,    95,                       cocMetric, target,    'up');
    const rentBE   = findBreakEven(v => build({ targetRentPerUnit: v }), 1,                       overrides.targetRentPerUnit, cocMetric, target, 'down');
    const rateBE   = findBreakEven(v => build({ interestRate: v }),      overrides.interestRate,  30,                       cocMetric, target,    'up');
    const priceBE  = findBreakEven(v => build({ purchasePrice: v }),     overrides.purchasePrice, overrides.purchasePrice * 3, cocMetric, target, 'up');
    const capBECoC = findBreakEven(v => build({ exitCapRate: v }),       overrides.exitCapRate,   30,                       cocMetric, target,    'up');

    // IRR break-evens
    const vacBEIRR   = findBreakEven(v => build({ vacancyPct: v }),       overrides.vacancyPct,    95,                       irrMetric, targetIRR, 'up');
    const rentBEIRR  = findBreakEven(v => build({ targetRentPerUnit: v }), 1,                       overrides.targetRentPerUnit, irrMetric, targetIRR, 'down');
    const rateBEIRR  = findBreakEven(v => build({ interestRate: v }),      overrides.interestRate,  30,                       irrMetric, targetIRR, 'up');
    const priceBEIRR = findBreakEven(v => build({ purchasePrice: v }),     overrides.purchasePrice, overrides.purchasePrice * 3, irrMetric, targetIRR, 'up');
    const capBEIRR   = findBreakEven(v => build({ exitCapRate: v }),       overrides.exitCapRate,   30,                       irrMetric, targetIRR, 'up');

    const cocCushionOf  = (be: number | null, base: number, dir: 'up' | 'down') =>
      be !== null ? (dir === 'up' ? be - base : base - be) : null;
    const irrCushionOf  = cocCushionOf;

    const vacCC  = cocCushionOf(vacBE,   overrides.vacancyPct,       'up');
    const rentCC = cocCushionOf(rentBE,  overrides.targetRentPerUnit, 'down');
    const rateCC = cocCushionOf(rateBE,  overrides.interestRate,      'up');
    const priceCC= cocCushionOf(priceBE, overrides.purchasePrice,     'up');
    const capCC  = cocCushionOf(capBECoC,overrides.exitCapRate,       'up');

    const vacCI  = irrCushionOf(vacBEIRR,   overrides.vacancyPct,       'up');
    const rentCI = irrCushionOf(rentBEIRR,  overrides.targetRentPerUnit, 'down');
    const rateCI = irrCushionOf(rateBEIRR,  overrides.interestRate,      'up');
    const priceCI= irrCushionOf(priceBEIRR, overrides.purchasePrice,     'up');
    const capCI  = irrCushionOf(capBEIRR,   overrides.exitCapRate,       'up');

    return [
      {
        label: 'Vacancy Rate', assumption: formatPct(overrides.vacancyPct), worseDir: 'up' as const,
        cocBreakEvenFormatted: fmt(vacBE, formatPct),
        cocCushion: vacCC !== null ? formatPct(vacCC) : null, cocCushionPct: vacCC !== null ? (vacCC / overrides.vacancyPct) * 100 : null,
        irrBreakEvenFormatted: fmt(vacBEIRR, formatPct),
        irrCushion: vacCI !== null ? formatPct(vacCI) : null, irrCushionPct: vacCI !== null ? (vacCI / overrides.vacancyPct) * 100 : null,
      },
      {
        label: 'Target Rent / unit', assumption: `$${Math.round(overrides.targetRentPerUnit).toLocaleString()}/mo`, worseDir: 'down' as const,
        cocBreakEvenFormatted: fmtRent(rentBE),
        cocCushion: rentCC !== null ? `$${Math.round(rentCC).toLocaleString()}` : null, cocCushionPct: rentCC !== null ? (rentCC / overrides.targetRentPerUnit) * 100 : null,
        irrBreakEvenFormatted: fmtRent(rentBEIRR),
        irrCushion: rentCI !== null ? `$${Math.round(rentCI).toLocaleString()}` : null, irrCushionPct: rentCI !== null ? (rentCI / overrides.targetRentPerUnit) * 100 : null,
      },
      {
        label: 'Interest Rate', assumption: formatPct(overrides.interestRate), worseDir: 'up' as const,
        cocBreakEvenFormatted: fmt(rateBE, formatPct),
        cocCushion: rateCC !== null ? formatPct(rateCC) : null, cocCushionPct: rateCC !== null ? (rateCC / overrides.interestRate) * 100 : null,
        irrBreakEvenFormatted: fmt(rateBEIRR, formatPct),
        irrCushion: rateCI !== null ? formatPct(rateCI) : null, irrCushionPct: rateCI !== null ? (rateCI / overrides.interestRate) * 100 : null,
      },
      {
        label: 'Purchase Price', assumption: formatCurrency(overrides.purchasePrice), worseDir: 'up' as const,
        cocBreakEvenFormatted: fmt(priceBE, formatCurrency),
        cocCushion: priceCC !== null ? formatCurrency(priceCC) : null, cocCushionPct: priceCC !== null ? (priceCC / overrides.purchasePrice) * 100 : null,
        irrBreakEvenFormatted: fmt(priceBEIRR, formatCurrency),
        irrCushion: priceCI !== null ? formatCurrency(priceCI) : null, irrCushionPct: priceCI !== null ? (priceCI / overrides.purchasePrice) * 100 : null,
      },
      {
        label: 'Exit Cap Rate', assumption: formatPct(overrides.exitCapRate), worseDir: 'up' as const,
        cocNA: true,
        cocBreakEvenFormatted: fmt(capBECoC, formatPct),
        cocCushion: capCC !== null ? formatPct(capCC) : null, cocCushionPct: capCC !== null ? (capCC / overrides.exitCapRate) * 100 : null,
        irrBreakEvenFormatted: fmt(capBEIRR, formatPct),
        irrCushion: capCI !== null ? formatPct(capCI) : null, irrCushionPct: capCI !== null ? (capCI / overrides.exitCapRate) * 100 : null,
      },
    ];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overrides, targetCoCReturn, targetIRR, acquisition, operations, proForma, refinance]);

  // ── Slider ranges ──
  const targetMin = Math.max(1, Math.round(basePreStabRent * 0.7));
  const targetMax = Math.round(baseTargetRent * 1.6);
  const preStabMax = Math.round(baseTargetRent * 1.1);
  const priceMin = Math.round(acquisition.purchasePrice * 0.5 / 5000) * 5000;
  const priceMax = Math.round(acquisition.purchasePrice * 2 / 5000) * 5000;
  const annOf = (perUnit: number) => `× ${effectiveUnits} unit${effectiveUnits !== 1 ? 's' : ''} = ${formatCurrency(perUnit * effectiveUnits * 12)}/yr`;

  const innerContent = (
    <div className="space-y-6">
      {/* Mode toggle */}
      <div className="flex items-center gap-2">
        {(['explore', 'goalseek'] as const).map(mode => (
          <button key={mode} type="button" onClick={() => setPanelMode(mode)}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${
              panelMode === mode
                ? 'bg-primary-600 text-white border-primary-600'
                : 'border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:border-primary-400'
            }`}>
            {mode === 'explore' ? 'Explore' : '⚡ Goal Seek'}
          </button>
        ))}
      </div>

      {/* Goal Seek banner */}
      {panelMode === 'goalseek' && (
        <GoalSeekBanner
          metric={goalMetric}
          target={goalTarget}
          onMetricChange={setGoalMetric}
          onTargetChange={setGoalTarget}
          result={whatIfResult}
        />
      )}

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

      {/* Break-even table — Explore mode only */}
      {panelMode === 'explore' && <div className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">Break-even Analysis</p>
            <p className="text-xs text-slate-400 mt-0.5">How much can each variable move before the deal fails your target?</p>
          </div>
          <div className="flex flex-col items-end gap-2 shrink-0">
            {/* Metric toggle */}
            <div className="flex items-center bg-slate-100 dark:bg-slate-700/60 rounded-lg p-0.5">
              {(['coc', 'irr'] as const).map(m => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setBreakEvenMode(m)}
                  className={`px-3 py-1 text-xs font-semibold rounded-md transition-all ${
                    breakEvenMode === m
                      ? 'bg-white dark:bg-slate-600 text-slate-800 dark:text-slate-100 shadow-sm'
                      : 'text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300'
                  }`}
                >
                  {m === 'coc' ? 'CoC' : 'IRR'}
                </button>
              ))}
            </div>
            {/* Target input — updates the active metric */}
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-slate-500">Target</span>
              <input
                type="number"
                value={breakEvenMode === 'coc' ? targetCoCReturn : targetIRR}
                onChange={e => breakEvenMode === 'coc'
                  ? setTargetCoCReturn(Number(e.target.value))
                  : setTargetIRR(Number(e.target.value))
                }
                className="input w-16 text-xs text-right tabular-nums py-1 px-2"
                step={0.5}
                min={-20}
                max={50}
              />
              <span className="text-xs text-slate-500">%</span>
            </div>
          </div>
        </div>
        <BreakEvenTable rows={breakEvenRows} mode={breakEvenMode} />
      </div>}
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
