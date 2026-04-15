'use client';

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import React from 'react';
import { RotateCcw, CheckCircle2, Pencil, Info } from 'lucide-react';
import { formatCurrency, formatPct, formatMultiple } from '@/utils/dealAnalyzerCalc';
import { runSimulation, computeDefaultRanges, rangesToMCRangeDefaults, toSavedMCResults, hydrateMCResults, findMaxPriceAtConditions } from '@/utils/monteCarlo';
import type { MCRanges, MCResults, MCPercentileMetrics, SavedMCResults } from '@/utils/monteCarlo';
import type { CoCAcquisition, CoCOperations, CoCRefinance, ProFormaData } from '@/types';
import { useDealSettingsStore, BEAR_OPTIONS, BULL_OPTIONS } from '@/lib/dealSettingsStore';

// ── Types ─────────────────────────────────────────────────────────────────────

interface MonteCarloPanelProps {
  acquisition:  CoCAcquisition;
  operations:   CoCOperations;
  proForma:     ProFormaData;
  refinance:    CoCRefinance;
  avgTargetRentPerUnit: number;
  avgPreStabPerUnit:    number;
  units:        number;
  savedRanges?: MCRanges | null;
  onRangesChange?: (r: MCRanges) => void;
  savedResults?: SavedMCResults | null;
  onResultsChange?: (r: SavedMCResults) => void;
  onStaleChange?: (stale: boolean) => void;
  onRunningChange?: (running: boolean, progress: number) => void;
  runTriggerRef?: React.MutableRefObject<(() => void) | null>;
  openEditorRef?: React.MutableRefObject<(() => void) | null>;
}

const N_RUNS = 10000;

// ── Fingerprint ───────────────────────────────────────────────────────────────

function computeFingerprint(
  acquisition: CoCAcquisition,
  proForma: ProFormaData,
  ranges: MCRanges,
  refinance: CoCRefinance,
): string {
  return JSON.stringify({
    price:        acquisition.purchasePrice,
    interestRate: acquisition.interestRate,
    exitMethod:   acquisition.exitMethod ?? 'value',
    exitCapRate:  acquisition.exitCapRate,
    arv:          acquisition.arv,
    hardCosts:    (acquisition.hardCostItems ?? []).reduce((s, i) => s + i.amount, 0),
    rent:         proForma.grossRent.stabilized,
    vacancy:      proForma.vacancyPct.stabilized,
    ranges:       Object.entries(ranges).map(([k, v]) => `${k}:${v.min}-${v.mode}-${v.max}`).join(','),
    refiEnabled:  refinance.enabled,
    refiYear:     refinance.enabled ? refinance.refiYear : 0,
    refiLTV:      refinance.enabled ? refinance.newLTV : 0,
    refiRate:     refinance.enabled ? refinance.newInterestRate : 0,
    refiTerm:     refinance.enabled ? refinance.newLoanTermYears : 0,
    refiCost:     refinance.enabled ? (refinance.refiCostPct ?? 0) : 0,
    refiMV:       refinance.enabled ? refinance.refiMarketValue : 0,
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtIrr(v: number): string {
  return v <= -900 ? '—' : formatPct(v);
}

function impactLabel(r: number): { label: string; color: string; width: number } {
  if (r >= 0.5)  return { label: 'High',   color: 'bg-red-400 dark:bg-red-500',    width: 100 };
  if (r >= 0.3)  return { label: 'High',   color: 'bg-amber-400 dark:bg-amber-500', width: Math.round(r / 0.5 * 100) };
  if (r >= 0.15) return { label: 'Medium', color: 'bg-amber-300 dark:bg-amber-400', width: Math.round(r / 0.5 * 100) };
  return           { label: 'Low',    color: 'bg-slate-300 dark:bg-slate-500',      width: Math.round(r / 0.5 * 100) };
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ProgressBar({ pct }: { pct: number }) {
  const phase = pct < 40
    ? { heading: 'Sampling market conditions…', sub: 'Rent, vacancy, rates & exit across 10,000 paths' }
    : pct < 80
    ? { heading: 'Running scenarios…', sub: 'Projecting cash flows and returns' }
    : { heading: 'Wrapping up…', sub: 'Computing price guidance and risk drivers' };

  return (
    <div className="space-y-3 py-2">
      <div className="flex items-start gap-3">
        <svg className="w-4 h-4 text-primary-500 shrink-0 mt-0.5 animate-spin" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
        </svg>
        <div>
          <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">{phase.heading}</p>
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">{phase.sub}</p>
        </div>
        <span className="ml-auto text-xs font-medium text-slate-400 tabular-nums shrink-0">{Math.round(pct)}%</span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
        <div className="h-full rounded-full bg-primary-500 transition-all duration-300" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function InlineEditTarget({ value, onChange, suffix }: { value: number; onChange: (v: number) => void; suffix: string }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const startEdit = () => {
    setDraft(String(value));
    setEditing(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const commit = () => {
    const v = parseFloat(draft);
    if (!isNaN(v) && v >= 0) onChange(v);
    setEditing(false);
  };

  const cancel = () => setEditing(false);

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="number"
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') cancel(); }}
        className="w-12 text-center text-sm font-bold tabular-nums text-primary-600 dark:text-primary-400 bg-transparent border-b border-primary-400 outline-none"
        autoFocus
      />
    );
  }

  return (
    <button type="button" onClick={startEdit} className="inline-flex items-center gap-0.5 group cursor-text">
      <span className="text-sm font-bold tabular-nums text-primary-600 dark:text-primary-400 border-b border-dashed border-primary-300 dark:border-primary-600 group-hover:border-primary-500">
        {value}{suffix}
      </span>
    </button>
  );
}

// ── Price Guidance Card ───────────────────────────────────────────────────────

function PriceGuidanceCard({ recommendedMaxPrice, conservativeMaxPrice, targetIRR, onTargetIRRChange, currentPrice }: {
  recommendedMaxPrice: number | null;
  conservativeMaxPrice: number | null;
  targetIRR: number;
  onTargetIRRChange: (v: number) => void;
  currentPrice: number;
}) {
  const rows: Array<{ label: string; sub: string; price: number | null }> = [
    { label: 'Ideal Entry',      sub: "Holds up even if things don't go as planned", price: conservativeMaxPrice },
    { label: 'Recommended Max',  sub: 'Works under typical market conditions',        price: recommendedMaxPrice },
  ];

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
      <div className="px-4 py-3 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-100 dark:border-slate-700">
        <p className="text-xs font-bold text-slate-700 dark:text-slate-300 inline-flex items-center gap-1 flex-wrap">
          What should you pay to hit <InlineEditTarget value={targetIRR} onChange={onTargetIRRChange} suffix="%" /> IRR?
        </p>
        <p className="text-[10px] text-slate-400 mt-0.5">
          Your price: {currentPrice > 0 ? formatCurrency(currentPrice) : '—'}
        </p>
      </div>
      <div className="divide-y divide-slate-100 dark:divide-slate-700">
        {rows.map(({ label, sub, price }) => {
          const works = price !== null && price >= currentPrice;
          const infeasible = price === null;
          const gap = price !== null && currentPrice > price ? currentPrice - price : null;
          return (
            <div key={label} className="px-4 py-3.5 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-700 dark:text-slate-300 leading-tight">{label}</p>
                <p className="text-[11px] text-slate-400 mt-0.5 leading-snug">{sub}</p>
              </div>
              <div className="text-right shrink-0 max-w-[45%]">
                {infeasible ? (
                  <p className="text-xs font-semibold text-red-500 dark:text-red-400">Not achievable</p>
                ) : works ? (
                  <div className="flex items-center gap-1 justify-end">
                    <CheckCircle2 size={12} className="text-secondary-500" />
                    <p className="text-xs font-semibold text-secondary-600 dark:text-secondary-400">Your price works</p>
                  </div>
                ) : (
                  <>
                    <p className="text-base font-bold tabular-nums text-slate-900 dark:text-slate-100">
                      {formatCurrency(price!)}
                    </p>
                    {gap !== null && (
                      <p className="text-[11px] font-medium text-amber-600 dark:text-amber-400 tabular-nums">
                        ↓ {formatCurrency(gap)} to negotiate
                      </p>
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Probability Card ──────────────────────────────────────────────────────────

function ProbabilityCard({ results, targetCoC, onTargetCoCChange, targetIRR, onTargetIRRChange }: {
  results: MCResults;
  targetCoC: number; onTargetCoCChange: (v: number) => void;
  targetIRR: number; onTargetIRRChange: (v: number) => void;
}) {
  const EPS = 0.005;
  const probIRR  = Math.round(results.sorted.filter(r => r.irr > -900 && r.irr >= targetIRR - EPS).length / results.n * 100);
  const probCoC  = Math.round(results.sorted.filter(r => r.avgCoCReturn >= targetCoC - EPS).length / results.n * 100);
  const probBoth = Math.round(results.sorted.filter(r => r.irr > -900 && r.irr >= targetIRR - EPS && r.avgCoCReturn >= targetCoC - EPS).length / results.n * 100);

  const bar = (p: number) => p >= 70 ? 'bg-secondary-500' : p >= 50 ? 'bg-amber-400' : 'bg-red-400';
  const txt = (p: number) => p >= 70 ? 'text-secondary-600 dark:text-secondary-400' : p >= 50 ? 'text-amber-600 dark:text-amber-400' : 'text-red-500';
  const bothBar = probBoth >= 70 ? 'bg-primary-500' : probBoth >= 50 ? 'bg-amber-400' : 'bg-red-400';
  const bothTxt = probBoth >= 70 ? 'text-primary-600 dark:text-primary-400' : probBoth >= 50 ? 'text-amber-600 dark:text-amber-400' : 'text-red-500';

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-4">
      <p className="text-xs font-bold text-slate-700 dark:text-slate-300">How likely is this deal to work?</p>

      {/* IRR probability */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <span className="text-xs text-slate-500 dark:text-slate-400 inline-flex items-center gap-1 min-w-0">
            <InlineEditTarget value={targetIRR} onChange={onTargetIRRChange} suffix="%" />
            <span className="truncate">IRR target</span>
          </span>
          <span className={`text-sm font-bold tabular-nums shrink-0 ${txt(probIRR)}`}>{probIRR}%</span>
        </div>
        <div className="h-2 w-full rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
          <div className={`h-full rounded-full transition-all ${bar(probIRR)}`} style={{ width: `${probIRR}%` }} />
        </div>
      </div>

      {/* CoC probability */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <span className="text-xs text-slate-500 dark:text-slate-400 inline-flex items-center gap-1 min-w-0">
            <InlineEditTarget value={targetCoC} onChange={onTargetCoCChange} suffix="%" />
            <span className="truncate">cash-on-cash target</span>
          </span>
          <span className={`text-sm font-bold tabular-nums shrink-0 ${txt(probCoC)}`}>{probCoC}%</span>
        </div>
        <div className="h-2 w-full rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
          <div className={`h-full rounded-full transition-all ${bar(probCoC)}`} style={{ width: `${probCoC}%` }} />
        </div>
      </div>

      {/* Both targets */}
      <div className="space-y-1.5 pt-1 border-t border-slate-100 dark:border-slate-700">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Both targets met</span>
          <span className={`text-sm font-bold tabular-nums shrink-0 ${bothTxt}`}>{probBoth}%</span>
        </div>
        <div className="h-2.5 w-full rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
          <div className={`h-full rounded-full transition-all ${bothBar}`} style={{ width: `${probBoth}%` }} />
        </div>
      </div>
    </div>
  );
}

// ── Scenario Outcomes ─────────────────────────────────────────────────────────

function ScenarioOutcomes({ results }: { results: MCResults }) {
  const { bearPercentile, bullPercentile } = useDealSettingsStore();

  const bearKey = `independent${bearPercentile.charAt(0).toUpperCase()}${bearPercentile.slice(1)}` as keyof MCResults;
  const bullKey = `independent${bullPercentile.charAt(0).toUpperCase()}${bullPercentile.slice(1)}` as keyof MCResults;
  const bear = (results[bearKey] ?? results.independentP20 ?? results.independentP50) as MCPercentileMetrics;
  const base = results.independentP50;
  const bull = (results[bullKey] ?? results.independentP80 ?? results.independentP50) as MCPercentileMetrics;

  const scenarios = [
    { label: 'If things go bad',   color: 'text-red-500 dark:text-red-400',            bg: 'bg-red-50 dark:bg-red-900/20',            data: bear },
    { label: 'Typical market',    color: 'text-primary-600 dark:text-primary-400',     bg: 'bg-primary-50 dark:bg-primary-900/20',     data: base },
    { label: 'If things go well', color: 'text-secondary-600 dark:text-secondary-400', bg: 'bg-secondary-50 dark:bg-secondary-900/20', data: bull },
  ];

  const metrics = (data: MCPercentileMetrics) => [
    { label: 'IRR',    value: fmtIrr(data.irr) },
    { label: 'CoC',    value: formatPct(data.avgCoCReturn) },
    { label: 'Equity', value: formatMultiple(data.equityMultiple) },
  ];

  // Joint probability: % of runs that hit ALL three median targets simultaneously
  const EPS = 0.005;
  const probJoint = Math.round(results.sorted.filter(r =>
    r.irr > -900 &&
    r.irr >= base.irr - EPS &&
    r.avgCoCReturn >= base.avgCoCReturn - EPS &&
    r.equityMultiple >= base.equityMultiple - EPS
  ).length / results.n * 100);

  // Risk warnings
  const probNegCF  = Math.round(results.sorted.filter(r => r.avgCoCReturn < 0).length / results.n * 100);
  const probNegIRR = Math.round(results.sorted.filter(r => r.irr > -900 && r.irr < 0).length / results.n * 100);
  const hasEMData = results.sorted.some(r => r.equityMultiple > 0);
  const probTotalLoss = hasEMData ? Math.round(results.sorted.filter(r => r.equityMultiple <= 0).length / results.n * 100) : -1;
  const hasRisk = probNegCF > 5 || probNegIRR > 5 || (probTotalLoss > 0 && probTotalLoss !== -1);

  return (
    <div>
      <p className="text-xs font-bold text-slate-700 dark:text-slate-300 mb-3">Scenario Outcomes</p>

      {/* Mobile: stacked cards, metrics in a row; sm+: 3-column grid */}
      <div className="space-y-2 sm:space-y-0 sm:grid sm:grid-cols-3 sm:gap-2">
        {scenarios.map(({ label, color, bg, data }) => (
          <div key={label} className={`rounded-xl p-3 ${bg}`}>
            <p className={`text-xs font-bold mb-2 ${color}`}>{label}</p>
            {/* On mobile: metrics flow horizontally; on sm+: stacked */}
            <div className="flex justify-between sm:flex-col sm:space-y-1.5">
              {metrics(data).map(({ label: l, value }) => (
                <div key={l} className="flex flex-col sm:flex-row sm:justify-between sm:items-baseline min-w-0">
                  <span className="text-[10px] text-slate-500 dark:text-slate-400">{l}</span>
                  <span className={`text-sm font-bold tabular-nums ${color}`}>{value}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Joint probability */}
      <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-2.5">
        <span className="font-semibold">{probJoint}%</span> chance of hitting all three median targets simultaneously
      </p>

      {/* Risk summary — always visible */}
      <div className="flex items-center gap-3 mt-2.5 text-[10px] text-slate-400 dark:text-slate-500 tabular-nums">
        <span>Neg. CF <span className={probNegCF > 5 ? 'font-semibold text-amber-600 dark:text-amber-400' : ''}>{probNegCF}%</span></span>
        <span>·</span>
        <span>Neg. IRR <span className={probNegIRR > 5 ? 'font-semibold text-amber-600 dark:text-amber-400' : ''}>{probNegIRR}%</span></span>
        {probTotalLoss !== -1 && (
          <>
            <span>·</span>
            <span>Capital loss <span className={probTotalLoss > 0 ? 'font-semibold text-red-500 dark:text-red-400' : ''}>{probTotalLoss}%</span></span>
          </>
        )}
      </div>

      {/* Expanded warning — only when thresholds exceeded */}
      {hasRisk && (
        <div className="flex items-start gap-2 mt-1.5 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/40 px-3 py-2">
          <Info size={14} className="text-amber-500 dark:text-amber-400 shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            {probNegCF > 5 && (
              <p className="text-[11px] text-amber-700 dark:text-amber-300">
                <span className="font-semibold">{probNegCF}%</span> chance of negative cash flow
              </p>
            )}
            {probNegIRR > 5 && (
              <p className="text-[11px] text-amber-700 dark:text-amber-300">
                <span className="font-semibold">{probNegIRR}%</span> chance of negative total return
              </p>
            )}
            {probTotalLoss > 0 && probTotalLoss !== -1 && (
              <p className="text-[11px] text-amber-800 dark:text-amber-200 font-semibold">
                {probTotalLoss}% chance of total capital loss
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Risk Drivers ──────────────────────────────────────────────────────────────

function RiskDrivers({ results }: { results: MCResults }) {
  return (
    <div>
      <p className="text-xs font-bold text-slate-700 dark:text-slate-300 mb-3">What drives the risk?</p>
      <div className="space-y-2.5">
        {results.sensitivity.map(({ key, label, correlation }) => {
          const { label: impLabel, color, width } = impactLabel(correlation);
          return (
            <div key={key} className="flex items-center gap-2">
              <span className="text-xs text-slate-600 dark:text-slate-400 w-28 shrink-0 truncate">{label}</span>
              <div className="flex-1 min-w-0 h-2 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
                <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${width}%` }} />
              </div>
              <span className={`text-[10px] font-semibold w-9 text-right shrink-0 ${
                impLabel === 'High'   ? 'text-red-500 dark:text-red-400' :
                impLabel === 'Medium' ? 'text-amber-500 dark:text-amber-400' :
                'text-slate-400'
              }`}>{impLabel}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Assumption Editor ─────────────────────────────────────────────────────────

function RangeEditor({ ranges, defaults, onChange, onReset, onSaveAsDefaults, showRefiRate, showArvRange }: {
  ranges:             MCRanges;
  defaults:           MCRanges;
  onChange:           (r: MCRanges) => void;
  onReset:            () => void;
  onSaveAsDefaults:   () => void;
  showRefiRate:       boolean;
  showArvRange:       boolean;
}) {
  const [draft, setDraft] = useState<Partial<Record<string, string>>>({});
  const fields: Array<{ key: keyof MCRanges; label: string; step: number; decimals: number; higherIsWorse: boolean; scale?: number }> = [
    { key: 'targetRentPerUnit', label: 'Rent / unit ($/mo)',   step: 25,    decimals: 0, higherIsWorse: false },
    { key: 'vacancyPct',        label: 'Vacancy Rate (%)',           step: 0.5,   decimals: 1, higherIsWorse: true  },
    { key: 'rentGrowthPct',     label: 'Rent Growth (%)',            step: 0.25,  decimals: 2, higherIsWorse: false },
    { key: 'exitCapRate',       label: 'Exit Cap Rate (%)',          step: 0.25,  decimals: 2, higherIsWorse: true  },
    { key: 'renoOverrunPct',    label: 'Reno Overrun Max (%)',       step: 5,     decimals: 0, higherIsWorse: true  },
    { key: 'expenseGrowthPct',  label: 'Expense Growth (%)',         step: 0.25,  decimals: 2, higherIsWorse: true  },
    { key: 'interestRate',      label: 'Interest Rate (%)',         step: 0.125, decimals: 3, higherIsWorse: true  },
    ...(showRefiRate  ? [{ key: 'refiRate' as keyof MCRanges, label: 'Refi Rate (%)',       step: 0.125, decimals: 3, higherIsWorse: true,  scale: 1    }] : []),
    ...(showArvRange  ? [{ key: 'arv'      as keyof MCRanges, label: 'Exit Value ARV ($K)', step: 50,    decimals: 0, higherIsWorse: false, scale: 1000 }] : []),
  ];

  const changed = (Object.keys(ranges) as (keyof MCRanges)[]).some(
    k => defaults[k] && (ranges[k]!.min !== defaults[k]!.min || ranges[k]!.max !== defaults[k]!.max)
  );

  return (
    <div className="space-y-4 pt-4 border-t border-slate-100 dark:border-slate-700">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Adjust assumptions</p>
        <div className="flex items-center gap-3">
          <button type="button" onClick={onSaveAsDefaults}
            className="text-[11px] text-primary-500 hover:text-primary-700 dark:hover:text-primary-300 transition-colors font-medium">
            Save as my defaults
          </button>
          {changed && (
            <button type="button" onClick={onReset}
              className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors">
              <RotateCcw size={10} /> Reset
            </button>
          )}
        </div>
      </div>

      {/* Column header row */}
      <div className="grid grid-cols-3 gap-2">
        <span className="text-[10px] font-semibold text-red-400 text-center uppercase tracking-wide">Pessimistic</span>
        <span className="text-[10px] font-semibold text-primary-400 text-center uppercase tracking-wide">Base</span>
        <span className="text-[10px] font-semibold text-secondary-500 text-center uppercase tracking-wide">Optimistic</span>
      </div>

      <div className="space-y-3">
        {fields.map(({ key, label, step, decimals, higherIsWorse, scale = 1 }) => {
          const d = defaults[key];
          if (!d) return null;
          const r = ranges[key] ?? d;
          const fmt = (v: number) => parseFloat((v / scale).toFixed(decimals)).toString();
          const pessField = higherIsWorse ? 'max' : 'min';
          const optimField = higherIsWorse ? 'min' : 'max';
          const pessKey = `${key}_pess`;
          const optimKey = `${key}_optim`;
          const pessDisplay = draft[pessKey] ?? fmt(r[pessField]);
          const optimDisplay = draft[optimKey] ?? fmt(r[optimField]);

          // If the committed value rounds to the same displayed string as the mode,
          // snap to the exact mode — prevents a tiny non-zero range when the user
          // types the displayed (rounded) mode value into the pessimistic/optimistic field.
          const snapToMode = (v: number) => fmt(v) === fmt(d.mode) ? d.mode : v;
          const commitPess = () => {
            const v = parseFloat(draft[pessKey] ?? '') * scale;
            setDraft(d2 => { const n = { ...d2 }; delete n[pessKey]; return n; });
            if (!isNaN(v)) {
              const clamped = snapToMode(higherIsWorse ? Math.max(v, d.mode) : Math.min(v, d.mode));
              onChange({ ...ranges, [key]: { ...r, mode: d.mode, [pessField]: clamped } });
            }
          };
          const commitOptim = () => {
            const v = parseFloat(draft[optimKey] ?? '') * scale;
            setDraft(d2 => { const n = { ...d2 }; delete n[optimKey]; return n; });
            if (!isNaN(v)) {
              const clamped = snapToMode(higherIsWorse ? Math.min(v, d.mode) : Math.max(v, d.mode));
              onChange({ ...ranges, [key]: { ...r, mode: d.mode, [optimField]: clamped } });
            }
          };

          return (
            <div key={key} className="space-y-1.5">
              {/* Label — always full width */}
              <p className="text-xs font-medium text-slate-600 dark:text-slate-400">{label}</p>
              {/* Three inputs in equal columns */}
              <div className="grid grid-cols-3 gap-2">
                <input type="number" value={pessDisplay} step={step}
                  onChange={e => setDraft(d2 => ({ ...d2, [pessKey]: e.target.value }))}
                  onBlur={commitPess} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                  className="w-full min-w-0 text-center text-xs font-semibold tabular-nums rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 px-1 py-1.5 focus:outline-none focus:ring-1 focus:ring-red-400"
                />
                <div className="w-full text-center text-xs font-semibold tabular-nums rounded-lg bg-slate-100 dark:bg-slate-700 text-primary-600 dark:text-primary-400 px-1 py-1.5 select-none">
                  {fmt(d.mode)}{scale > 1 ? 'K' : ''}
                </div>
                <input type="number" value={optimDisplay} step={step}
                  onChange={e => setDraft(d2 => ({ ...d2, [optimKey]: e.target.value }))}
                  onBlur={commitOptim} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                  className="w-full min-w-0 text-center text-xs font-semibold tabular-nums rounded-lg border border-secondary-200 dark:border-secondary-800 bg-secondary-50 dark:bg-secondary-900/20 text-secondary-600 dark:text-secondary-400 px-1 py-1.5 focus:outline-none focus:ring-1 focus:ring-secondary-400"
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export function MonteCarloPanel({
  acquisition, operations, proForma, refinance,
  avgTargetRentPerUnit, avgPreStabPerUnit, units,
  savedRanges, onRangesChange,
  savedResults, onResultsChange,
  onStaleChange, onRunningChange, runTriggerRef, openEditorRef,
}: MonteCarloPanelProps) {
  const { mcRangeDefaults, setMCRangeDefaults } = useDealSettingsStore();
  const defaults = useMemo(
    () => computeDefaultRanges(acquisition, proForma, avgTargetRentPerUnit, units, refinance, mcRangeDefaults),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [acquisition, proForma, avgTargetRentPerUnit, units, refinance, mcRangeDefaults],
  );

  // On mount, re-anchor saved ranges if base values have shifted since last save
  const initialRanges = (() => {
    if (!savedRanges) return defaults;
    const reanchored = { ...savedRanges };
    let changed = false;
    for (const key of Object.keys(defaults) as (keyof MCRanges)[]) {
      const saved = savedRanges[key];
      const def = defaults[key];
      if (!saved || !def) continue;
      if (saved.mode === def.mode) continue;
      const minSpread = saved.min - saved.mode;
      const maxSpread = saved.max - saved.mode;
      reanchored[key] = { min: def.mode + minSpread, mode: def.mode, max: def.mode + maxSpread };
      changed = true;
    }
    return changed ? reanchored : savedRanges;
  })();
  const [ranges, setRanges] = useState<MCRanges>(initialRanges);
  const rangesRef = useRef<MCRanges>(initialRanges);
  const [draftRangesState, setDraftRangesState] = useState<MCRanges>(initialRanges);

  // Notify parent of re-anchored ranges after mount (not during render)
  const didMountReanchor = useRef(initialRanges !== savedRanges);
  useEffect(() => {
    if (didMountReanchor.current) {
      didMountReanchor.current = false;
      onRangesChange?.(initialRanges);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Track whether the user has explicitly customized ranges in the editor.
  // Until they do, base values auto-sync when ProForma inputs change.
  const userCustomizedRef = useRef(savedRanges !== null);
  const prevDefaultsRef = useRef<MCRanges>(defaults);

  // When defaults recompute (ProForma changed), re-anchor ranges.
  // If user hasn't customized → use new defaults directly.
  // If user has customized → preserve the point spread from old mode.
  useEffect(() => {
    const prev = prevDefaultsRef.current;
    prevDefaultsRef.current = defaults;

    if (!userCustomizedRef.current) {
      setRanges(defaults);
      setDraftRangesState(defaults);
      onRangesChange?.(defaults);
    } else {
      // Re-anchor: for each key, shift min/max by the same amount the mode moved
      const reanchored = { ...ranges };
      let changed = false;
      for (const key of Object.keys(defaults) as (keyof MCRanges)[]) {
        const oldD = prev[key];
        const newD = defaults[key];
        const r = ranges[key];
        if (!oldD || !newD || !r) continue;
        if (oldD.mode === newD.mode) continue; // base didn't change
        const minSpread = r.min - oldD.mode;
        const maxSpread = r.max - oldD.mode;
        reanchored[key] = {
          min: newD.mode + minSpread,
          mode: newD.mode,
          max: newD.mode + maxSpread,
        };
        changed = true;
      }
      if (changed) {
        setRanges(reanchored);
        setDraftRangesState(reanchored);
        rangesRef.current = reanchored;
        onRangesChange?.(reanchored);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaults]);

  useEffect(() => { rangesRef.current = ranges; }, [ranges]);

  const handleRangesChange = useCallback((r: MCRanges) => {
    userCustomizedRef.current = true;
    rangesRef.current = r;
    setRanges(r);
    onRangesChange?.(r);
  }, [onRangesChange]);

  const [results, setResults]       = useState<MCResults | null>(savedResults ? hydrateMCResults(savedResults) : null);
  const [freshResults, setFreshResults] = useState(false); // briefly true after new results arrive → triggers fade-in
  const [running, setRunning]       = useState(false);
  const [progress, setProgress]     = useState(0);
  const [isStale, setIsStale]     = useState(false);
  const [showEditor, setShowEditor] = useState(false);
  const [draftRanges, setDraftRanges] = [draftRangesState, setDraftRangesState];
  const editorRef = useRef<HTMLDivElement>(null);

  // Restore targets from last saved run
  const [targetIRR, setTargetIRR] = useState(() => savedResults?.targetIRR ?? 12);
  const [targetCoC, setTargetCoC] = useState(() => savedResults?.targetCoC ?? 8);

  // Track mounted state so we don't update state after unmount
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true; // reset on remount (handles React Strict Mode double-invoke)
    return () => { isMountedRef.current = false; };
  }, []);

  // Prevent concurrent runs (React Strict Mode double-invokes effects; this ensures only one simulation runs at a time)
  const simRunningRef = useRef(false);

  // Fingerprint of current inputs
  const fingerprint = useMemo(
    () => computeFingerprint(acquisition, proForma, ranges, refinance),
    [acquisition, proForma, ranges, refinance],
  );

  // Track fingerprint at last run — initialize from saved results
  const lastRunFingerprintRef = useRef<string | null>(savedResults?.inputFingerprint ?? null);

  // Detect staleness when inputs change — simulation is triggered by handleCalculate, not here
  useEffect(() => {
    if (lastRunFingerprintRef.current === null || fingerprint === lastRunFingerprintRef.current) return;
    setIsStale(true);
  }, [fingerprint]);

  // Lift stale state to parent
  useEffect(() => { onStaleChange?.(isStale); }, [isStale, onStaleChange]);

  // Lift running/progress state to parent
  useEffect(() => { onRunningChange?.(running, progress); }, [running, progress, onRunningChange]);

  const { bearPercentile } = useDealSettingsStore();

  const { recommendedMaxPrice, conservativeMaxPrice } = useMemo(() => {
    if (!results) return { recommendedMaxPrice: null, conservativeMaxPrice: null };
    const bearData = results[bearPercentile] ?? results.p20 ?? results.p50;
    const args = [acquisition, operations, proForma, refinance, units, avgPreStabPerUnit] as const;
    return {
      recommendedMaxPrice:  findMaxPriceAtConditions(results.p50.sampled,  targetIRR, ...args),
      conservativeMaxPrice: findMaxPriceAtConditions(bearData.sampled,      targetIRR, ...args),
    };
  }, [results, bearPercentile, targetIRR, acquisition, operations, proForma, refinance, units, avgPreStabPerUnit]);

  const run = useCallback(async (effectiveRanges?: MCRanges) => {
    if (simRunningRef.current) return;
    simRunningRef.current = true;
    setRunning(true);
    setProgress(0);
    const activeRanges = effectiveRanges ?? rangesRef.current;
    try {
      const r = await runSimulation({
        n: N_RUNS, ranges: activeRanges, acquisition, operations, proForma, refinance,
        units, avgPreStabPerUnit, onProgress: pct => { if (isMountedRef.current) setProgress(pct); },
      });
      const fp = computeFingerprint(acquisition, proForma, activeRanges, refinance);
      const bearRun = r[bearPercentile] ?? r.p20 ?? r.p50;
      const args = [acquisition, operations, proForma, refinance, units, avgPreStabPerUnit] as const;
      const recMax  = findMaxPriceAtConditions(r.p50.sampled,    targetIRR, ...args);
      const conMax  = findMaxPriceAtConditions(bearRun.sampled,  targetIRR, ...args);
      const saved = toSavedMCResults(r, recMax, conMax, targetIRR, targetCoC, fp);
      onResultsChange?.(saved);
      lastRunFingerprintRef.current = fp;
      if (isMountedRef.current) {
        setResults(r);
        setFreshResults(true);
        setTimeout(() => setFreshResults(false), 500);
        setIsStale(false);
      }
    } finally {
      simRunningRef.current = false;
      if (isMountedRef.current) setRunning(false);
    }
  }, [targetIRR, targetCoC, acquisition, operations, proForma, refinance, units, avgPreStabPerUnit, onResultsChange]);

  // Keep latest run fn in a ref so the unmount cleanup always calls the current version
  const runRef = useRef(run);
  useEffect(() => {
    runRef.current = run;
    if (runTriggerRef) runTriggerRef.current = run;
  }, [run, runTriggerRef]);

  useEffect(() => {
    if (openEditorRef) openEditorRef.current = () => {
      setDraftRanges(ranges);
      setShowEditor(true);
      setTimeout(() => editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
    };
  }, [openEditorRef, ranges]);
  const isStaleRef = useRef(isStale);
  useEffect(() => { isStaleRef.current = isStale; }, [isStale]);

  // Auto-run on first visit if no saved results, stale, or fingerprint was never stored
  useEffect(() => {
    if (!savedResults || !savedResults.inputFingerprint || isStale) {
      runRef.current();
    }
    // Auto-run on unmount if stale (keeps dashboard card fresh)
    return () => {
      if (isStaleRef.current) runRef.current();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">Deal Stress Test</p>
        <p className="text-xs text-slate-400 mt-0.5">
          Simulates thousands of market conditions to pressure-test your deal.
          Not a prediction — results are statistical inferences based on the market uncertainty ranges you define.
        </p>
      </div>

      {/* First-run: full progress bar (no previous results to show) */}
      {running && !results && (
        <div className="animate-fade-in">
          <ProgressBar pct={progress} />
        </div>
      )}

      {/* Re-run: slim progress line so results stay fully visible */}
      {running && results && (
        <div className="space-y-1.5 animate-fade-in">
          <div className="h-1 w-full rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
            <div className="h-full rounded-full bg-primary-500 transition-all duration-300" style={{ width: `${progress}%` }} />
          </div>
          <p className="text-[10px] text-slate-400 dark:text-slate-500 tabular-nums">
            {progress < 40 ? 'Sampling market conditions…'
              : progress < 80 ? 'Running scenarios…'
              : 'Wrapping up…'} {Math.round(progress)}%
          </p>
        </div>
      )}

      {/* Results — stay mounted, fade in when fresh data arrives */}
      {results && (
        <div className={`space-y-5 ${freshResults ? 'animate-fade-in' : ''}`}>
          <ProbabilityCard
            results={results}
            targetCoC={targetCoC} onTargetCoCChange={setTargetCoC}
            targetIRR={targetIRR} onTargetIRRChange={setTargetIRR}
          />
          <PriceGuidanceCard
            recommendedMaxPrice={recommendedMaxPrice}
            conservativeMaxPrice={conservativeMaxPrice}
            targetIRR={targetIRR}
            onTargetIRRChange={setTargetIRR}
            currentPrice={acquisition.purchasePrice}
          />
          <ScenarioOutcomes results={results} />
          <RiskDrivers results={results} />
        </div>
      )}

      {/* Market Uncertainty Ranges */}
      <div ref={editorRef}>
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">Market Uncertainty Ranges</p>

          {showEditor ? (
            /* Done / Cancel always visible at top when editor is open */
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => {
                  const changed = JSON.stringify(draftRanges) !== JSON.stringify(ranges);
                  handleRangesChange(draftRanges);
                  setShowEditor(false);
                  if (changed) runRef.current(draftRanges);
                }}
                className="px-3 py-1 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-xs font-semibold transition-colors"
              >
                Done
              </button>
              <button
                type="button"
                onClick={() => { setDraftRanges(ranges); setShowEditor(false); }}
                className="px-3 py-1 rounded-lg border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-400 hover:border-slate-400 text-xs font-medium transition-colors"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => { setDraftRanges(ranges); setShowEditor(true); }}
              className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
              aria-label="Edit market uncertainty ranges"
            >
              <Pencil size={12} />
            </button>
          )}
        </div>

        {showEditor && (
          <div className="mt-2">
            <RangeEditor
              ranges={draftRanges}
              defaults={defaults}
              onChange={setDraftRanges}
              onReset={() => { handleRangesChange(defaults); setDraftRanges(defaults); userCustomizedRef.current = false; }}
              onSaveAsDefaults={() => setMCRangeDefaults(rangesToMCRangeDefaults(draftRanges))}
              showRefiRate={refinance.enabled}
              showArvRange={false}
            />
          </div>
        )}
      </div>
    </div>
  );
}
