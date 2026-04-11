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
  cocBeyond?: boolean; // true = deal too strong to break within search range
  cocNA?: boolean;     // true when metric is not applicable for CoC
  irrBreakEvenFormatted: string | null;
  irrCushion: string | null;
  irrCushionPct: number | null;
  irrBeyond?: boolean;
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
            const beyond = mode === 'coc' ? !!row.cocBeyond : !!row.irrBeyond;
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
                ) : beyond ? (
                  <>
                    <td className="px-3 py-2.5 text-xs text-right">
                      <span className="text-[10px] text-slate-400 dark:text-slate-500 italic">beyond range</span>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-secondary-50 dark:bg-secondary-900/20 text-secondary-600 dark:text-secondary-400">
                        very strong
                      </span>
                    </td>
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
                        <span className="text-[10px] text-red-500 dark:text-red-400 font-semibold">no room</span>
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

// ── Goal Seek Panel ────────────────────────────────────────────────────────────

type GoalMetric = 'irr' | 'coc';
type GoalSeekVar =
  | 'targetRentPerUnit' | 'rentGrowthPct' | 'vacancyPct'
  | 'propertyMgmtPct' | 'maintenancePct' | 'fixedExpenseGrowthPct'
  | 'interestRate' | 'exitCapRate' | 'purchasePrice' | 'projectionYears'
  | 'refiRate' | 'refiYear';

interface GoalSeekVarDef {
  key: GoalSeekVar;
  pill: string;       // short label for pill button
  label: string;      // full label for result card
  worseDir: 'up' | 'down';
  searchMin: number;
  searchMax: number;
  format: (v: number) => string;
  formatGap?: (v: number) => string;
  /** 'at_least' = need higher value; 'at_most' = need lower value */
  direction: 'at_least' | 'at_most';
  /** scan every integer value instead of binary search — for non-monotonic variables like hold period */
  scan?: true;
}

function GoalSeekPanel({ metric, target, onMetricChange, onTargetChange, defaults, deps, baseResult, refinanceEnabled }: {
  metric: GoalMetric;
  target: number;
  onMetricChange: (m: GoalMetric) => void;
  onTargetChange: (v: number) => void;
  defaults: WhatIfOverrides;
  deps: BuildDeps;
  baseResult: CoCResult;
  refinanceEnabled: boolean;
}) {
  const [selectedVar, setSelectedVar] = useState<GoalSeekVar>('targetRentPerUnit');

  const priceMin = Math.max(10000, Math.round(defaults.purchasePrice * 0.3 / 5000) * 5000);
  const priceMax = Math.round(defaults.purchasePrice * 2.5 / 5000) * 5000;
  const maxRefiYear = Math.round(defaults.projectionYears);

  const varDefs: GoalSeekVarDef[] = [
    {
      key: 'targetRentPerUnit', pill: 'Rent / unit', label: 'Target rent / unit',
      worseDir: 'down', direction: 'at_least',
      searchMin: 50, searchMax: Math.max(defaults.targetRentPerUnit * 2.5, 5000),
      format: v => `$${Math.round(v).toLocaleString()}/mo`,
    },
    {
      key: 'rentGrowthPct', pill: 'Rent Growth', label: 'Rent growth / yr',
      worseDir: 'down', direction: 'at_least',
      searchMin: -5, searchMax: 15,
      format: formatPct,
    },
    {
      key: 'vacancyPct', pill: 'Vacancy', label: 'Vacancy rate',
      worseDir: 'up', direction: 'at_most',
      searchMin: 0, searchMax: 50,
      format: formatPct,
    },
    {
      key: 'propertyMgmtPct', pill: 'Prop. Mgmt', label: 'Property management %',
      worseDir: 'up', direction: 'at_most',
      searchMin: 0, searchMax: 15,
      format: formatPct,
    },
    {
      key: 'maintenancePct', pill: 'Maintenance', label: 'Maintenance & repairs %',
      worseDir: 'up', direction: 'at_most',
      searchMin: 0, searchMax: 20,
      format: formatPct,
    },
    {
      key: 'fixedExpenseGrowthPct', pill: 'Fixed Expense Growth', label: 'Fixed expense growth / yr',
      worseDir: 'up', direction: 'at_most',
      searchMin: -2, searchMax: 10,
      format: formatPct,
    },
    {
      key: 'interestRate', pill: 'Interest Rate', label: 'Interest rate',
      worseDir: 'up', direction: 'at_most',
      searchMin: 2, searchMax: 20,
      format: formatPct,
    },
    {
      key: 'exitCapRate', pill: 'Exit Cap Rate', label: 'Exit cap rate',
      worseDir: 'up', direction: 'at_most',
      searchMin: 3, searchMax: 20,
      format: formatPct,
    },
    {
      key: 'purchasePrice', pill: 'Purchase Price', label: 'Purchase price',
      worseDir: 'up', direction: 'at_most',
      searchMin: priceMin, searchMax: priceMax,
      format: formatCurrency,
    },
    {
      key: 'projectionYears', pill: 'Hold Period', label: 'Hold period',
      worseDir: 'down', direction: 'at_least',
      searchMin: 1, searchMax: 20,
      format: v => `${Math.round(v)} yr${Math.round(v) !== 1 ? 's' : ''}`,
      scan: true,
    },
    ...(refinanceEnabled ? [
      {
        key: 'refiRate' as GoalSeekVar, pill: 'Refi Rate', label: 'Refi interest rate',
        worseDir: 'up' as const, direction: 'at_most' as const,
        searchMin: 2, searchMax: 20,
        format: formatPct,
      },
      {
        key: 'refiYear' as GoalSeekVar, pill: 'Refi Year', label: 'Refinance year',
        worseDir: 'up' as const, direction: 'at_most' as const,
        searchMin: 1, searchMax: maxRefiYear,
        format: (v: number) => `Year ${Math.round(v)}`,
        formatGap: (v: number) => `${Math.round(v)} yr${Math.round(v) !== 1 ? 's' : ''}`,
      },
    ] : []),
  ];

  const varDef = varDefs.find(v => v.key === selectedVar) ?? varDefs[0];
  const metricFn = (r: CoCResult) => metric === 'irr' ? (r.irr ?? -999) : r.avgCoCReturn;

  const currentValue = metricFn(baseResult);
  const currentDefaultValue = defaults[varDef.key] as number;
  const build = (v: number) => buildWhatIfResult({ ...defaults, [varDef.key]: v }, deps);
  const fmtGap = varDef.formatGap ?? varDef.format;
  const progressPct = target > 0 ? Math.min(100, Math.max(0, (currentValue / target) * 100)) : 100;

  // ── Scan mode (hold period): check every integer year, IRR is non-monotonic ──
  const scanYears: { year: number; value: number }[] = [];
  if (varDef.scan) {
    for (let y = varDef.searchMin; y <= varDef.searchMax; y++) {
      scanYears.push({ year: y, value: metricFn(build(y)) });
    }
  }
  const qualifyingYears = scanYears.filter(s => s.value >= target).map(s => s.year);
  const bestScanYear = scanYears.reduce((best, s) => s.value > best.value ? s : best, scanYears[0] ?? { year: 0, value: -999 });

  // ── Standard binary-search mode ──
  const alreadyMet = currentValue >= target;
  const solved = !varDef.scan && !alreadyMet
    ? findBreakEven(build, varDef.searchMin, varDef.searchMax, metricFn, target, varDef.worseDir)
    : null;
  const bestCaseMetric = !varDef.scan
    ? (varDef.direction === 'at_least' ? metricFn(build(varDef.searchMax)) : metricFn(build(varDef.searchMin)))
    : bestScanYear.value;

  type ResultState = 'already_met' | 'solved' | 'not_achievable';
  const state: ResultState = varDef.scan
    ? (qualifyingYears.length > 0 ? 'solved' : 'not_achievable')
    : alreadyMet ? 'already_met' : typeof solved === 'number' ? 'solved' : 'not_achievable';

  const solvedValue = typeof solved === 'number' ? solved : null;
  const gap = solvedValue !== null ? Math.abs(solvedValue - currentDefaultValue) : null;

  // Full result at the solved value — used to show cash flow / equity multiple in result card
  const solvedResult = solvedValue !== null ? build(solvedValue) : null;
  // For scan mode: result at the earliest qualifying year
  const scanSolvedResult = varDef.scan && qualifyingYears.length > 0 ? build(qualifyingYears[0]) : null;

  return (
    <div className="space-y-4">
      {/* Target + metric selector */}
      <div className="flex items-center gap-2 flex-wrap bg-slate-50 dark:bg-slate-700/40 rounded-xl px-4 py-3">
        <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">Achieve</span>
        <input
          type="number"
          value={target}
          onChange={e => onTargetChange(Number(e.target.value))}
          className="input w-16 text-xs text-right tabular-nums py-1 px-2"
          step={0.5} min={-20} max={50}
        />
        <span className="text-xs text-slate-500 dark:text-slate-400">%</span>
        <div className="flex items-center bg-white dark:bg-slate-600 rounded-lg border border-slate-200 dark:border-slate-500 p-0.5">
          {(['irr', 'coc'] as const).map(m => (
            <button key={m} type="button" onClick={() => onMetricChange(m)}
              className={`px-2.5 py-0.5 text-xs font-semibold rounded-md transition-all ${
                metric === m
                  ? 'bg-primary-600 text-white shadow-sm'
                  : 'text-slate-400 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
              }`}>
              {m === 'irr' ? 'IRR' : 'CoC'}
            </button>
          ))}
        </div>
      </div>

      {/* Variable pills */}
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-2">
          Solve for
        </p>
        <div className="flex flex-wrap gap-2">
          {varDefs.map(v => (
            <button
              key={v.key}
              type="button"
              onClick={() => setSelectedVar(v.key)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${
                selectedVar === v.key
                  ? 'bg-primary-600 text-white border-primary-600 shadow-sm'
                  : 'bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-400 hover:border-primary-400 dark:hover:border-primary-500'
              }`}
            >
              {v.pill}
            </button>
          ))}
        </div>
      </div>

      {/* Result card — scan mode (hold period) */}
      {varDef.scan && state === 'solved' && qualifyingYears.length > 0 && (
        <div className="rounded-xl p-4 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm space-y-3">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-1">Earliest Exit</p>
              <p className="text-2xl font-bold tabular-nums text-slate-900 dark:text-white">
                {varDef.format(qualifyingYears[0])}
              </p>
            </div>
            {qualifyingYears[qualifyingYears.length - 1] !== qualifyingYears[0] && (
              <div className="text-right shrink-0">
                <p className="text-[10px] text-slate-400 dark:text-slate-500">Latest qualifying</p>
                <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                  {varDef.format(qualifyingYears[qualifyingYears.length - 1])}
                </p>
              </div>
            )}
          </div>
          {/* Year-by-year bars */}
          <div className="space-y-1">
            {scanYears.map(s => {
              const barPct = target > 0 ? Math.min(100, Math.max(0, (s.value / target) * 100)) : 100;
              const meets = s.value >= target;
              const isCurrent = s.year === Math.round(currentDefaultValue);
              return (
                <div key={s.year} className="flex items-center gap-2">
                  <span className={`text-[10px] tabular-nums w-8 shrink-0 text-right ${isCurrent ? 'font-bold text-primary-600 dark:text-primary-400' : 'text-slate-400'}`}>
                    {s.year}yr
                  </span>
                  <div className="flex-1 h-2 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${meets ? 'bg-secondary-500' : 'bg-slate-300 dark:bg-slate-600'}`}
                      style={{ width: `${barPct}%` }}
                    />
                  </div>
                  <span className={`text-[10px] tabular-nums w-10 shrink-0 ${meets ? 'text-secondary-600 dark:text-secondary-400 font-medium' : 'text-slate-400'}`}>
                    {s.value > -100 ? `${s.value.toFixed(1)}%` : '—'}
                  </span>
                </div>
              );
            })}
          </div>
          <p className="text-[10px] text-slate-400">Green bars meet the {target}% target · Bold year = current hold period</p>

          {/* Metrics at earliest qualifying year */}
          {scanSolvedResult && (
            <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-100 dark:border-slate-700">
              <div className="text-center">
                <p className="text-[10px] text-slate-400 dark:text-slate-500">Total Cash Flow</p>
                <p className="text-xs font-semibold text-slate-800 dark:text-slate-200 tabular-nums">{formatCurrency(scanSolvedResult.totalCashFlow)}</p>
              </div>
              <div className="text-center">
                <p className="text-[10px] text-slate-400 dark:text-slate-500">Equity Multiple</p>
                <p className="text-xs font-semibold text-slate-800 dark:text-slate-200 tabular-nums">{formatMultiple(scanSolvedResult.equityMultiple)}</p>
              </div>
              <div className="text-center">
                <p className="text-[10px] text-slate-400 dark:text-slate-500">{metric === 'irr' ? 'Avg CoC' : 'IRR'}</p>
                <p className="text-xs font-semibold text-slate-800 dark:text-slate-200 tabular-nums">
                  {metric === 'irr'
                    ? formatPct(scanSolvedResult.avgCoCReturn)
                    : (scanSolvedResult.irr !== null ? formatPct(scanSolvedResult.irr) : '—')}
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {varDef.scan && state === 'not_achievable' && (
        <div className="rounded-xl p-4 bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800/30 space-y-2">
          <p className="text-sm font-semibold text-red-600 dark:text-red-400">Not achievable at any hold period</p>
          <p className="text-xs text-red-500 dark:text-red-400">
            Best case is <strong>{bestScanYear.value.toFixed(1)}%</strong> {metric.toUpperCase()} at year {bestScanYear.year} —{' '}
            {(target - bestScanYear.value).toFixed(1)}% short of target.
          </p>
          <p className="text-[11px] text-red-400 dark:text-red-500">Try a different variable or lower the target.</p>
        </div>
      )}

      {/* Result card — standard (binary search) */}
      {!varDef.scan && state === 'already_met' && (
        <div className="rounded-xl p-4 bg-secondary-50 dark:bg-secondary-900/20 border border-secondary-200 dark:border-secondary-800/40">
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle2 size={16} className="text-secondary-600 dark:text-secondary-400 shrink-0" />
            <span className="text-sm font-semibold text-secondary-700 dark:text-secondary-300">Already achieved</span>
          </div>
          <p className="text-xs text-secondary-600 dark:text-secondary-400 mb-3">
            With {varDef.label} at <strong>{varDef.format(currentDefaultValue)}</strong>, this deal already delivers{' '}
            <strong>{currentValue.toFixed(1)}%</strong> {metric.toUpperCase()} — {(currentValue - target).toFixed(1)}% above target.
          </p>
          <div className="h-2 rounded-full bg-secondary-200 dark:bg-secondary-800/40 overflow-hidden">
            <div className="h-full rounded-full bg-secondary-500" style={{ width: `${Math.min(100, progressPct)}%` }} />
          </div>
        </div>
      )}

      {!varDef.scan && state === 'solved' && solvedValue !== null && (
        <div className="rounded-xl p-4 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm space-y-3">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-1">
                {varDef.direction === 'at_least' ? 'Minimum Required' : 'Maximum Allowed'}
              </p>
              <p className="text-2xl font-bold tabular-nums text-slate-900 dark:text-white">
                {varDef.format(solvedValue)}
              </p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-[10px] text-slate-400 dark:text-slate-500">Currently</p>
              <p className="text-sm font-semibold text-slate-600 dark:text-slate-400">{varDef.format(currentDefaultValue)}</p>
            </div>
          </div>

          {gap !== null && gap > 0.01 && (
            <p className="text-xs font-medium text-amber-600 dark:text-amber-400">
              {varDef.direction === 'at_least' ? '↑ Needs to increase by' : '↓ Needs to decrease by'}{' '}
              {fmtGap(gap)} to hit {target}% {metric.toUpperCase()}
            </p>
          )}

          <div className="h-2 rounded-full bg-slate-200 dark:bg-slate-600 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-300 ${progressPct >= 80 ? 'bg-amber-400' : 'bg-primary-500'}`}
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <div className="flex justify-between text-[10px] text-slate-400">
            <span>{currentValue.toFixed(1)}% current</span>
            <span>{target}% target</span>
          </div>

          {/* Metrics at the solved value */}
          {solvedResult && (
            <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-100 dark:border-slate-700">
              <div className="text-center">
                <p className="text-[10px] text-slate-400 dark:text-slate-500">Total Cash Flow</p>
                <p className="text-xs font-semibold text-slate-800 dark:text-slate-200 tabular-nums">{formatCurrency(solvedResult.totalCashFlow)}</p>
              </div>
              <div className="text-center">
                <p className="text-[10px] text-slate-400 dark:text-slate-500">Equity Multiple</p>
                <p className="text-xs font-semibold text-slate-800 dark:text-slate-200 tabular-nums">{formatMultiple(solvedResult.equityMultiple)}</p>
              </div>
              <div className="text-center">
                <p className="text-[10px] text-slate-400 dark:text-slate-500">{metric === 'irr' ? 'Avg CoC' : 'IRR'}</p>
                <p className="text-xs font-semibold text-slate-800 dark:text-slate-200 tabular-nums">
                  {metric === 'irr'
                    ? formatPct(solvedResult.avgCoCReturn)
                    : (solvedResult.irr !== null ? formatPct(solvedResult.irr) : '—')}
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {!varDef.scan && state === 'not_achievable' && (
        <div className="rounded-xl p-4 bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800/30">
          <p className="text-sm font-semibold text-red-600 dark:text-red-400 mb-1">Not achievable</p>
          <p className="text-xs text-red-500 dark:text-red-400">
            Even at the {varDef.direction === 'at_least' ? 'highest' : 'lowest'} modeled {varDef.label},{' '}
            this deal reaches only <strong>{bestCaseMetric.toFixed(1)}%</strong> {metric.toUpperCase()} —{' '}
            {(target - bestCaseMetric).toFixed(1)}% short.
          </p>
          <p className="text-[11px] text-red-400 dark:text-red-500 mt-1">Try a different variable or lower the target.</p>
        </div>
      )}
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
  const [goalTargetIRR, setGoalTargetIRR] = useState(15);
  const [goalTargetCoC, setGoalTargetCoC] = useState(8);
  const [breakEvenMode, setBreakEvenMode] = useState<'coc' | 'irr'>('coc');
  const [targetCoCReturn, setTargetCoCReturn] = useState(0);
  const [targetIRR, setTargetIRR] = useState(0);

  // ── Anchor values from unit mix ──
  const { units, avgTargetRent, avgPreStabRent } = useMemo(() => computeAvgRents(acquisition), [acquisition]);
  const effectiveUnits = Math.max(1, units);
  // Derive per-unit rent from proForma.grossRent.stabilized so the What-If default
  // exactly matches the base result (unit-mix values can diverge from the ProForma).
  const proFormaPerUnit = (proForma.grossRent.stabilized || proForma.grossRent.t12 || 12000) / (effectiveUnits * 12);
  const baseTargetRent = proFormaPerUnit;
  const basePreStabRent = avgPreStabRent > 0 ? Math.min(avgPreStabRent, baseTargetRent) : baseTargetRent;

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
    refiRate: refinance.enabled ? (refinance.newInterestRate || acquisition.interestRate) : acquisition.interestRate,
    refiYear: refinance.enabled ? (refinance.refiYear || 3) : 3,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []); // intentionally fixed at mount — what-if is a snapshot tool

  // Explore mode has its own slider state; Goal Seek uses base defaults directly.
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
    defaultFixedExpenseGrowthPct: Math.round(avgFixedGrowthPct * 4) / 4,
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

    // Helpers that handle the 'beyond' sentinel from findBreakEven
    const numBE = (be: number | null | 'beyond'): number | null => be === 'beyond' ? null : be;
    const isBeyond = (be: number | null | 'beyond'): boolean => be === 'beyond';
    const fmt = (be: number | null, format: (v: number) => string) => be !== null ? format(be) : null;
    const fmtRent = (be: number | null) => be !== null ? `$${Math.round(be).toLocaleString()}/mo` : null;

    // CoC break-evens
    const vacBER    = findBreakEven(v => build({ vacancyPct: v }),        overrides.vacancyPct,       95,                          cocMetric, target,    'up');
    const rentBER   = findBreakEven(v => build({ targetRentPerUnit: v }), 1,                          overrides.targetRentPerUnit,  cocMetric, target,    'down');
    const rateBER   = findBreakEven(v => build({ interestRate: v }),      overrides.interestRate,     30,                          cocMetric, target,    'up');
    const capBERCoC = findBreakEven(v => build({ exitCapRate: v }),       overrides.exitCapRate,      30,                          cocMetric, target,    'up');
    const refiBERCoC = refinance.enabled
      ? findBreakEven(v => build({ refiRate: v }), overrides.refiRate!, 30, cocMetric, target, 'up')
      : null;

    // IRR break-evens
    const vacBERIRR   = findBreakEven(v => build({ vacancyPct: v }),        overrides.vacancyPct,       95,                         irrMetric, targetIRR, 'up');
    const rentBERIRR  = findBreakEven(v => build({ targetRentPerUnit: v }), 1,                          overrides.targetRentPerUnit, irrMetric, targetIRR, 'down');
    const rateBERIRR  = findBreakEven(v => build({ interestRate: v }),      overrides.interestRate,     30,                         irrMetric, targetIRR, 'up');
    const capBERIRR   = findBreakEven(v => build({ exitCapRate: v }),       overrides.exitCapRate,      30,                         irrMetric, targetIRR, 'up');
    const refiBERIRR  = refinance.enabled
      ? findBreakEven(v => build({ refiRate: v }), overrides.refiRate!, 30, irrMetric, targetIRR, 'up')
      : null;

    // Strip 'beyond' to get numeric values (null when beyond)
    const vacBE = numBE(vacBER); const rentBE = numBE(rentBER); const rateBE = numBE(rateBER); const capBECoC = numBE(capBERCoC);
    const vacBEIRR = numBE(vacBERIRR); const rentBEIRR = numBE(rentBERIRR); const rateBEIRR = numBE(rateBERIRR); const capBEIRR = numBE(capBERIRR);
    const refiBECoC = refiBERCoC !== null ? numBE(refiBERCoC) : null;
    const refiBEIRR = refiBERIRR !== null ? numBE(refiBERIRR) : null;

    const cocCushionOf = (be: number | null, base: number, dir: 'up' | 'down') =>
      be !== null ? (dir === 'up' ? be - base : base - be) : null;

    const vacCC  = cocCushionOf(vacBE,   overrides.vacancyPct,       'up');
    const rentCC = cocCushionOf(rentBE,  overrides.targetRentPerUnit, 'down');
    const rateCC = cocCushionOf(rateBE,  overrides.interestRate,      'up');
    const capCC  = cocCushionOf(capBECoC,overrides.exitCapRate,       'up');
    const refiCC = cocCushionOf(refiBECoC, overrides.refiRate ?? 0,   'up');

    const vacCI  = cocCushionOf(vacBEIRR,   overrides.vacancyPct,       'up');
    const rentCI = cocCushionOf(rentBEIRR,  overrides.targetRentPerUnit, 'down');
    const rateCI = cocCushionOf(rateBEIRR,  overrides.interestRate,      'up');
    const capCI  = cocCushionOf(capBEIRR,   overrides.exitCapRate,       'up');
    const refiCI = cocCushionOf(refiBEIRR,  overrides.refiRate ?? 0,     'up');

    const rows: BreakEvenRow[] = [
      {
        label: 'Vacancy Rate', assumption: formatPct(overrides.vacancyPct), worseDir: 'up' as const,
        cocBreakEvenFormatted: fmt(vacBE, formatPct), cocBeyond: isBeyond(vacBER),
        cocCushion: vacCC !== null ? formatPct(vacCC) : null, cocCushionPct: vacCC !== null ? (vacCC / overrides.vacancyPct) * 100 : null,
        irrBreakEvenFormatted: fmt(vacBEIRR, formatPct), irrBeyond: isBeyond(vacBERIRR),
        irrCushion: vacCI !== null ? formatPct(vacCI) : null, irrCushionPct: vacCI !== null ? (vacCI / overrides.vacancyPct) * 100 : null,
      },
      {
        label: 'Target Rent / unit', assumption: `$${Math.round(overrides.targetRentPerUnit).toLocaleString()}/mo`, worseDir: 'down' as const,
        cocBreakEvenFormatted: fmtRent(rentBE), cocBeyond: isBeyond(rentBER),
        cocCushion: rentCC !== null ? `$${Math.round(rentCC).toLocaleString()}` : null, cocCushionPct: rentCC !== null ? (rentCC / overrides.targetRentPerUnit) * 100 : null,
        irrBreakEvenFormatted: fmtRent(rentBEIRR), irrBeyond: isBeyond(rentBERIRR),
        irrCushion: rentCI !== null ? `$${Math.round(rentCI).toLocaleString()}` : null, irrCushionPct: rentCI !== null ? (rentCI / overrides.targetRentPerUnit) * 100 : null,
      },
      {
        label: 'Interest Rate', assumption: formatPct(overrides.interestRate), worseDir: 'up' as const,
        cocBreakEvenFormatted: fmt(rateBE, formatPct), cocBeyond: isBeyond(rateBER),
        cocCushion: rateCC !== null ? formatPct(rateCC) : null, cocCushionPct: rateCC !== null ? (rateCC / overrides.interestRate) * 100 : null,
        irrBreakEvenFormatted: fmt(rateBEIRR, formatPct), irrBeyond: isBeyond(rateBERIRR),
        irrCushion: rateCI !== null ? formatPct(rateCI) : null, irrCushionPct: rateCI !== null ? (rateCI / overrides.interestRate) * 100 : null,
      },
      {
        label: 'Exit Cap Rate', assumption: formatPct(overrides.exitCapRate), worseDir: 'up' as const,
        cocNA: true,
        cocBreakEvenFormatted: fmt(capBECoC, formatPct), cocBeyond: isBeyond(capBERCoC),
        cocCushion: capCC !== null ? formatPct(capCC) : null, cocCushionPct: capCC !== null ? (capCC / overrides.exitCapRate) * 100 : null,
        irrBreakEvenFormatted: fmt(capBEIRR, formatPct), irrBeyond: isBeyond(capBERIRR),
        irrCushion: capCI !== null ? formatPct(capCI) : null, irrCushionPct: capCI !== null ? (capCI / overrides.exitCapRate) * 100 : null,
      },
    ];

    if (refinance.enabled) {
      rows.push({
        label: 'Refi Rate', assumption: formatPct(overrides.refiRate ?? 0), worseDir: 'up' as const,
        cocBreakEvenFormatted: refiBECoC !== null ? fmt(refiBECoC, formatPct) : null,
        cocBeyond: refiBERCoC !== null ? isBeyond(refiBERCoC) : false,
        cocCushion: refiCC !== null ? formatPct(refiCC) : null,
        cocCushionPct: refiCC !== null && overrides.refiRate ? (refiCC / overrides.refiRate) * 100 : null,
        irrBreakEvenFormatted: refiBEIRR !== null ? fmt(refiBEIRR, formatPct) : null,
        irrBeyond: refiBERIRR !== null ? isBeyond(refiBERIRR) : false,
        irrCushion: refiCI !== null ? formatPct(refiCI) : null,
        irrCushionPct: refiCI !== null && overrides.refiRate ? (refiCI / overrides.refiRate) * 100 : null,
      });
    }

    return rows;
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
    <div className="flex flex-col gap-0">
      {/* ── Mode toggle ── */}
      <div className="flex items-center gap-2 pb-4">
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

      {/* ── Goal Seek mode: solver only, no sliders ── */}
      {panelMode === 'goalseek' && (
        <GoalSeekPanel
          metric={goalMetric}
          target={goalMetric === 'irr' ? goalTargetIRR : goalTargetCoC}
          onMetricChange={setGoalMetric}
          onTargetChange={v => goalMetric === 'irr' ? setGoalTargetIRR(v) : setGoalTargetCoC(v)}
          defaults={defaults}
          deps={deps}
          baseResult={baseResult}
          refinanceEnabled={refinance.enabled}
        />
      )}

      {/* ── Explore mode: KPI deltas + sliders + break-even ── */}
      {panelMode === 'explore' && <>
        {/* KPI deltas */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pb-4 border-b border-slate-100 dark:border-slate-700">
          <KPIDelta label="IRR" value={whatIfResult.irr !== null ? formatPct(whatIfResult.irr) : '—'}
            delta={(whatIfResult.irr ?? 0) - (baseResult.irr ?? 0)}
            deltaFormatted={formatPct(Math.abs((whatIfResult.irr ?? 0) - (baseResult.irr ?? 0)))} />
          <KPIDelta label="Avg CoC Return" value={formatPct(whatIfResult.avgCoCReturn)}
            delta={whatIfResult.avgCoCReturn - baseResult.avgCoCReturn}
            deltaFormatted={formatPct(Math.abs(whatIfResult.avgCoCReturn - baseResult.avgCoCReturn))} />
          <KPIDelta label="Equity Multiple" value={formatMultiple(whatIfResult.equityMultiple)}
            delta={whatIfResult.equityMultiple - baseResult.equityMultiple}
            deltaFormatted={`${Math.abs(whatIfResult.equityMultiple - baseResult.equityMultiple).toFixed(2)}x`} />
          <KPIDelta label="Total Cash Flow" value={formatCurrency(whatIfResult.totalCashFlow)}
            delta={whatIfResult.totalCashFlow - baseResult.totalCashFlow}
            deltaFormatted={formatCurrency(Math.abs(whatIfResult.totalCashFlow - baseResult.totalCashFlow))} />
        </div>

        {/* Sliders — scrollable */}
        <div className="overflow-y-auto max-h-[60vh] pt-5 space-y-6 px-1 -mx-1">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-5">
            <SectionLabel label="Income" />
            <Slider label="Target Rent / unit" sublabel="Stabilized rent once fully leased up"
              value={overrides.targetRentPerUnit} min={targetMin} max={targetMax} step={25}
              displayValue={`$${Math.round(overrides.targetRentPerUnit).toLocaleString()}/mo`}
              annotation={annOf(overrides.targetRentPerUnit)}
              onChange={set('targetRentPerUnit')} isChanged={isChanged('targetRentPerUnit')} />
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
            {refinance.enabled && <>
              <SectionLabel label="Refinance" />
              <Slider label="Refi Interest Rate" sublabel="Rate on the new loan after refinance"
                value={overrides.refiRate ?? 0} min={2} max={15} step={0.125}
                displayValue={formatPct(overrides.refiRate ?? 0)}
                onChange={set('refiRate')} isChanged={isChanged('refiRate')} />
              <Slider label="Refi Year" sublabel="Year in which refinance occurs"
                value={overrides.refiYear ?? 1} min={1} max={Math.round(overrides.projectionYears)} step={1}
                displayValue={`Year ${Math.round(overrides.refiYear ?? 1)}`}
                onChange={set('refiYear')} isChanged={isChanged('refiYear')} />
            </>}
          </div>
        </div>

        <button type="button" onClick={reset} disabled={!anyChanged}
          className={`flex items-center gap-1.5 text-xs transition-colors mt-4 ${
            anyChanged
              ? 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 cursor-pointer'
              : 'text-slate-300 dark:text-slate-600 cursor-not-allowed'
          }`}>
          <RotateCcw size={12} />
          Reset to original inputs
        </button>

        {/* Break-even table — always outside scroll */}
        <div className="space-y-3 mt-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">Break-even Analysis</p>
              <p className="text-xs text-slate-400 mt-0.5">How much can each variable move before the deal fails your target?</p>
            </div>
            <div className="flex flex-col items-end gap-2 shrink-0">
              <div className="flex items-center bg-slate-100 dark:bg-slate-700/60 rounded-lg p-0.5">
                {(['coc', 'irr'] as const).map(m => (
                  <button key={m} type="button" onClick={() => setBreakEvenMode(m)}
                    className={`px-3 py-1 text-xs font-semibold rounded-md transition-all ${
                      breakEvenMode === m
                        ? 'bg-white dark:bg-slate-600 text-slate-800 dark:text-slate-100 shadow-sm'
                        : 'text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300'
                    }`}>
                    {m === 'coc' ? 'CoC' : 'IRR'}
                  </button>
                ))}
              </div>
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
                  step={0.5} min={-20} max={50}
                />
                <span className="text-xs text-slate-500">%</span>
              </div>
            </div>
          </div>
          <BreakEvenTable rows={breakEvenRows} mode={breakEvenMode} />
        </div>
      </>}
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
