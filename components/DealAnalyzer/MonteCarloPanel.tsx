'use client';

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import React from 'react';
import { RefreshCw, ChevronDown, ChevronUp, RotateCcw, CheckCircle2 } from 'lucide-react';
import { formatCurrency, formatPct, formatMultiple } from '@/utils/dealAnalyzerCalc';
import { runSimulation, computeDefaultRanges, toSavedMCResults, hydrateMCResults, computeDeterministicPrices } from '@/utils/monteCarlo';
import type { MCRanges, MCResults, SavedMCResults } from '@/utils/monteCarlo';
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
}

const N_RUNS = 10000;

// ── Fingerprint ───────────────────────────────────────────────────────────────

function computeFingerprint(
  acquisition: CoCAcquisition,
  proForma: ProFormaData,
  ranges: MCRanges,
  targetIRR: number,
  targetCoC: number,
): string {
  return JSON.stringify({
    price:        acquisition.purchasePrice,
    interestRate: acquisition.interestRate,
    exitCapRate:  acquisition.exitCapRate,
    hardCosts:    (acquisition.hardCostItems ?? []).reduce((s, i) => s + i.amount, 0),
    rent:         proForma.grossRent.stabilized,
    vacancy:      proForma.vacancyPct.stabilized,
    ranges:       Object.entries(ranges).map(([k, v]) => `${k}:${v.min}-${v.mode}-${v.max}`).join(','),
    targetIRR,
    targetCoC,
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
  return (
    <div className="space-y-2">
      <div className="flex justify-between text-xs text-slate-500">
        <span>Running {N_RUNS.toLocaleString()} scenarios…</span>
        <span>{Math.round(pct)}%</span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
        <div className="h-full rounded-full bg-primary-500 transition-all duration-150" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function TargetInput({ value, onChange, step = 0.5 }: { value: number; onChange: (v: number) => void; step?: number }) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      type="number"
      value={draft ?? value}
      step={step}
      min={0}
      onChange={e => setDraft(e.target.value)}
      onBlur={() => { const v = parseFloat(draft ?? ''); setDraft(null); if (!isNaN(v) && v >= 0) onChange(v); }}
      onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
      className="w-10 text-center text-sm font-semibold text-primary-600 dark:text-primary-400 bg-primary-50 dark:bg-primary-900/30 rounded px-1 border-none outline-none focus:ring-1 focus:ring-primary-400"
    />
  );
}

// ── Price Guidance Card ───────────────────────────────────────────────────────

function PriceGuidanceCard({ recommendedMaxPrice, conservativeMaxPrice, targetIRR, currentPrice }: {
  recommendedMaxPrice: number | null;
  conservativeMaxPrice: number | null;
  targetIRR: number;
  currentPrice: number;
}) {
  const rows: Array<{ label: string; sub: string; price: number | null }> = [
    { label: 'Ideal Entry',      sub: "Holds up even if things don't go as planned", price: conservativeMaxPrice },
    { label: 'Recommended Max',  sub: 'Works under typical market conditions',        price: recommendedMaxPrice },
  ];

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
      <div className="px-4 py-3 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-100 dark:border-slate-700">
        <p className="text-xs font-bold text-slate-700 dark:text-slate-300">
          What should you pay to hit {targetIRR}% IRR?
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
            <div key={label} className="px-4 py-3.5 flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">{label}</p>
                <p className="text-[11px] text-slate-400 mt-0.5">{sub}</p>
              </div>
              <div className="text-right shrink-0">
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
  const probCoC = Math.round(results.sorted.filter(r => r.avgCoCReturn >= targetCoC - EPS).length / results.n * 100);
  const probIRR = Math.round(results.sorted.filter(r => r.irr > -900 && r.irr >= targetIRR - EPS).length / results.n * 100);
  const probLoss = Math.round(results.sorted.filter(r => r.avgCoCReturn < 0).length / results.n * 100);

  const irrBarColor = probIRR >= 70 ? 'bg-secondary-500' : probIRR >= 50 ? 'bg-amber-400' : 'bg-red-400';
  const cocBarColor = probCoC >= 70 ? 'bg-secondary-500' : probCoC >= 50 ? 'bg-amber-400' : 'bg-red-400';
  const irrTextColor = probIRR >= 70 ? 'text-secondary-600 dark:text-secondary-400' : probIRR >= 50 ? 'text-amber-600 dark:text-amber-400' : 'text-red-500';
  const cocTextColor = probCoC >= 70 ? 'text-secondary-600 dark:text-secondary-400' : probCoC >= 50 ? 'text-amber-600 dark:text-amber-400' : 'text-red-500';

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-4">
      <p className="text-xs font-bold text-slate-700 dark:text-slate-300">How likely is this deal to work?</p>

      {/* IRR probability */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-slate-500 dark:text-slate-400 inline-flex items-center gap-1">
            <TargetInput value={targetIRR} onChange={onTargetIRRChange} step={0.5} />% IRR target
          </span>
          <span className={`text-sm font-bold tabular-nums ${irrTextColor}`}>{probIRR}% chance</span>
        </div>
        <div className="h-2 w-full rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
          <div className={`h-full rounded-full transition-all ${irrBarColor}`} style={{ width: `${probIRR}%` }} />
        </div>
      </div>

      {/* CoC probability */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-slate-500 dark:text-slate-400 inline-flex items-center gap-1">
            <TargetInput value={targetCoC} onChange={onTargetCoCChange} step={0.5} />% cash-on-cash target
          </span>
          <span className={`text-sm font-bold tabular-nums ${cocTextColor}`}>{probCoC}% chance</span>
        </div>
        <div className="h-2 w-full rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
          <div className={`h-full rounded-full transition-all ${cocBarColor}`} style={{ width: `${probCoC}%` }} />
        </div>
      </div>

      {/* Loss probability callout */}
      {probLoss > 5 && (
        <div className="rounded-lg bg-red-50 dark:bg-red-900/20 px-3 py-2">
          <p className="text-[11px] text-red-600 dark:text-red-400">
            <span className="font-semibold">{probLoss}% chance of negative cash flow</span> across all simulated scenarios
          </p>
        </div>
      )}
    </div>
  );
}

// ── Scenario Outcomes ─────────────────────────────────────────────────────────

function ScenarioOutcomes({ results }: { results: MCResults }) {
  const { bearPercentile, bullPercentile } = useDealSettingsStore();
  const bearData = results[bearPercentile] ?? results.p20 ?? results.p50;
  const bullData = results[bullPercentile] ?? results.p80 ?? results.p50;

  const scenarios = [
    { label: 'If things go wrong', color: 'text-red-500 dark:text-red-400',              bg: 'bg-red-50 dark:bg-red-900/20',              data: bearData },
    { label: 'Most likely',        color: 'text-primary-600 dark:text-primary-400',       bg: 'bg-primary-50 dark:bg-primary-900/20',       data: results.p50 },
    { label: 'If things go well',  color: 'text-secondary-600 dark:text-secondary-400',   bg: 'bg-secondary-50 dark:bg-secondary-900/20',   data: bullData },
  ];

  return (
    <div>
      <p className="text-xs font-bold text-slate-700 dark:text-slate-300 mb-3">Scenario Outcomes</p>
      <div className="grid grid-cols-3 gap-2">
        {scenarios.map(({ label, color, bg, data }) => (
          <div key={label} className={`rounded-xl p-3 ${bg} space-y-2`}>
            <p className={`text-[11px] font-bold leading-tight ${color}`}>{label}</p>
            <div className="space-y-1.5">
              {[
                { label: 'IRR',    value: fmtIrr(data.irr) },
                { label: 'CoC',    value: formatPct(data.avgCoCReturn) },
                { label: 'Equity', value: formatMultiple(data.equityMultiple) },
              ].map(({ label: l, value }) => (
                <div key={l} className="flex justify-between items-baseline">
                  <span className="text-[10px] text-slate-500 dark:text-slate-400">{l}</span>
                  <span className={`text-sm font-bold tabular-nums ${color}`}>{value}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
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
            <div key={key} className="flex items-center gap-3">
              <span className="text-xs text-slate-600 dark:text-slate-400 w-36 shrink-0">{label}</span>
              <div className="flex-1 h-2 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
                <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${width}%` }} />
              </div>
              <span className={`text-[10px] font-semibold w-10 text-right ${
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

function RangeEditor({ ranges, defaults, onChange, onReset, showRefiRate }: {
  ranges:       MCRanges;
  defaults:     MCRanges;
  onChange:     (r: MCRanges) => void;
  onReset:      () => void;
  showRefiRate: boolean;
}) {
  const [draft, setDraft] = useState<Partial<Record<string, string>>>({});
  const fields: Array<{ key: keyof MCRanges; label: string; step: number; decimals: number; higherIsWorse: boolean }> = [
    { key: 'targetRentPerUnit', label: 'Rent / unit ($/mo)',   step: 25,    decimals: 0, higherIsWorse: false },
    { key: 'vacancyPct',        label: 'Vacancy Rate (%)',     step: 0.5,   decimals: 1, higherIsWorse: true  },
    { key: 'rentGrowthPct',     label: 'Rent Growth / yr (%)', step: 0.25,  decimals: 2, higherIsWorse: false },
    { key: 'exitCapRate',       label: 'Exit Cap Rate (%)',    step: 0.25,  decimals: 2, higherIsWorse: true  },
    { key: 'renoOverrunPct',    label: 'Reno Overrun Max (%)', step: 5,     decimals: 0, higherIsWorse: true  },
    { key: 'interestRate',      label: 'Interest Rate (%)',    step: 0.125, decimals: 3, higherIsWorse: true  },
    ...(showRefiRate ? [{ key: 'refiRate' as keyof MCRanges, label: 'Refi Rate (%)', step: 0.125, decimals: 3, higherIsWorse: true }] : []),
  ];

  const changed = (Object.keys(ranges) as (keyof MCRanges)[]).some(
    k => ranges[k].min !== defaults[k].min || ranges[k].max !== defaults[k].max
  );

  return (
    <div className="space-y-4 pt-4 border-t border-slate-100 dark:border-slate-700">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Adjust assumptions</p>
        {changed && (
          <button type="button" onClick={onReset}
            className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors">
            <RotateCcw size={10} /> Reset
          </button>
        )}
      </div>

      <div className="grid grid-cols-[1fr_80px_80px_80px] gap-x-3 items-center">
        <span />
        <span className="text-[10px] font-semibold text-red-400 text-center uppercase tracking-wide">Pessimistic</span>
        <span className="text-[10px] font-semibold text-primary-400 text-center uppercase tracking-wide">Base</span>
        <span className="text-[10px] font-semibold text-secondary-500 text-center uppercase tracking-wide">Optimistic</span>
      </div>

      <div className="space-y-2">
        {fields.map(({ key, label, step, decimals, higherIsWorse }) => {
          const d = defaults[key];
          if (!d) return null;
          const r = ranges[key] ?? d;
          const fmt = (v: number) => parseFloat(v.toFixed(decimals)).toString();
          const pessField = higherIsWorse ? 'max' : 'min';
          const optimField = higherIsWorse ? 'min' : 'max';
          const pessKey = `${key}_pess`;
          const optimKey = `${key}_optim`;
          const pessDisplay = draft[pessKey] ?? fmt(r[pessField]);
          const optimDisplay = draft[optimKey] ?? fmt(r[optimField]);

          const commitPess = () => {
            const v = parseFloat(draft[pessKey] ?? '');
            setDraft(d2 => { const n = { ...d2 }; delete n[pessKey]; return n; });
            if (!isNaN(v)) {
              const clamped = higherIsWorse ? Math.max(v, d.mode) : Math.min(v, d.mode);
              onChange({ ...ranges, [key]: { ...r, [pessField]: clamped } });
            }
          };
          const commitOptim = () => {
            const v = parseFloat(draft[optimKey] ?? '');
            setDraft(d2 => { const n = { ...d2 }; delete n[optimKey]; return n; });
            if (!isNaN(v)) {
              const clamped = higherIsWorse ? Math.min(v, d.mode) : Math.max(v, d.mode);
              onChange({ ...ranges, [key]: { ...r, [optimField]: clamped } });
            }
          };

          return (
            <div key={key} className="grid grid-cols-[1fr_80px_80px_80px] gap-x-3 items-center">
              <span className="text-xs text-slate-600 dark:text-slate-400">{label}</span>
              <input type="number" value={pessDisplay} step={step}
                onChange={e => setDraft(d2 => ({ ...d2, [pessKey]: e.target.value }))}
                onBlur={commitPess} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                className="w-full text-center text-xs font-semibold tabular-nums rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 px-1 py-1.5 focus:outline-none focus:ring-1 focus:ring-red-400"
              />
              <div className="w-full text-center text-xs font-semibold tabular-nums rounded-lg bg-slate-100 dark:bg-slate-700 text-primary-600 dark:text-primary-400 px-1 py-1.5 select-none">
                {fmt(d.mode)}
              </div>
              <input type="number" value={optimDisplay} step={step}
                onChange={e => setDraft(d2 => ({ ...d2, [optimKey]: e.target.value }))}
                onBlur={commitOptim} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                className="w-full text-center text-xs font-semibold tabular-nums rounded-lg border border-secondary-200 dark:border-secondary-800 bg-secondary-50 dark:bg-secondary-900/20 text-secondary-600 dark:text-secondary-400 px-1 py-1.5 focus:outline-none focus:ring-1 focus:ring-secondary-400"
              />
            </div>
          );
        })}
      </div>
      <p className="text-[10px] text-slate-400 dark:text-slate-500">Re-run after changing assumptions.</p>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export function MonteCarloPanel({
  acquisition, operations, proForma, refinance,
  avgTargetRentPerUnit, avgPreStabPerUnit, units,
  savedRanges, onRangesChange,
  savedResults, onResultsChange,
}: MonteCarloPanelProps) {
  const defaults = useMemo(
    () => computeDefaultRanges(acquisition, proForma, avgTargetRentPerUnit, units, refinance),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const initialRanges = savedRanges ?? defaults;
  const [ranges, setRanges] = useState<MCRanges>(initialRanges);

  useEffect(() => {
    onRangesChange?.(initialRanges);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRangesChange = useCallback((r: MCRanges) => {
    setRanges(r);
    onRangesChange?.(r);
  }, [onRangesChange]);

  const [results, setResults]     = useState<MCResults | null>(savedResults ? hydrateMCResults(savedResults) : null);
  const [running, setRunning]     = useState(false);
  const [progress, setProgress]   = useState(0);
  const [isStale, setIsStale]     = useState(false);
  const [showEditor, setShowEditor] = useState(false);

  // Restore targets from last saved run
  const [targetIRR, setTargetIRR] = useState(() => savedResults?.targetIRR ?? 12);
  const [targetCoC, setTargetCoC] = useState(() => savedResults?.targetCoC ?? 8);

  // Track mounted state so we don't update state after unmount
  const isMountedRef = useRef(true);
  useEffect(() => { return () => { isMountedRef.current = false; }; }, []);

  // Fingerprint of current inputs
  const fingerprint = useMemo(
    () => computeFingerprint(acquisition, proForma, ranges, targetIRR, targetCoC),
    [acquisition, proForma, ranges, targetIRR, targetCoC],
  );

  // Track fingerprint at last run — initialize from saved results
  const lastRunFingerprintRef = useRef<string | null>(savedResults?.inputFingerprint ?? null);

  // Detect staleness whenever fingerprint changes (but not on first mount before any run)
  useEffect(() => {
    if (lastRunFingerprintRef.current !== null && fingerprint !== lastRunFingerprintRef.current) {
      setIsStale(true);
    }
  }, [fingerprint]);

  const { recommendedMaxPrice, conservativeMaxPrice } = useMemo(() => {
    if (!results) return { recommendedMaxPrice: null, conservativeMaxPrice: null };
    return computeDeterministicPrices(
      ranges, targetIRR, acquisition, operations, proForma, refinance, units, avgPreStabPerUnit,
    );
  }, [ranges, targetIRR, acquisition, operations, proForma, refinance, units, avgPreStabPerUnit]);

  const run = useCallback(async () => {
    setRunning(true);
    setProgress(0);
    if (isMountedRef.current) setResults(null);
    try {
      const r = await runSimulation({
        n: N_RUNS, ranges, acquisition, operations, proForma, refinance,
        units, avgPreStabPerUnit, onProgress: pct => { if (isMountedRef.current) setProgress(pct); },
      });
      const fp = computeFingerprint(acquisition, proForma, ranges, targetIRR, targetCoC);
      const { recommendedMaxPrice, conservativeMaxPrice } = computeDeterministicPrices(
        ranges, targetIRR, acquisition, operations, proForma, refinance, units, avgPreStabPerUnit,
      );
      const saved = toSavedMCResults(r, recommendedMaxPrice, conservativeMaxPrice, targetIRR, targetCoC, fp);
      onResultsChange?.(saved);
      lastRunFingerprintRef.current = fp;
      if (isMountedRef.current) {
        setResults(r);
        setIsStale(false);
      }
    } finally {
      if (isMountedRef.current) setRunning(false);
    }
  }, [ranges, targetIRR, targetCoC, acquisition, operations, proForma, refinance, units, avgPreStabPerUnit, onResultsChange]);

  // Keep latest run fn in a ref so the unmount cleanup always calls the current version
  const runRef = useRef(run);
  useEffect(() => { runRef.current = run; }, [run]);
  const isStaleRef = useRef(isStale);
  useEffect(() => { isStaleRef.current = isStale; }, [isStale]);

  // Auto-run on first visit if no saved results
  useEffect(() => {
    if (!savedResults) {
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
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">Deal Stress Test</p>
          <p className="text-xs text-slate-400 mt-0.5">
            Runs {N_RUNS.toLocaleString()} scenarios across rent, vacancy, costs, rates & exit
          </p>
        </div>

        {/* Refresh button — only shown when stale */}
        {isStale && !running && (
          <div className="flex flex-col items-end gap-1">
            <button
              type="button"
              onClick={run}
              className="relative flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold transition-colors shrink-0"
            >
              {/* Pulse ring */}
              <span className="absolute inset-0 rounded-xl animate-ping bg-amber-400 opacity-30 pointer-events-none" />
              <RefreshCw size={14} />
              Refresh
            </button>
            <p className="text-[10px] text-amber-600 dark:text-amber-400">Inputs changed — refresh to update</p>
          </div>
        )}
      </div>

      {/* Progress */}
      {running && <ProgressBar pct={progress} />}

      {/* Results */}
      {results && !running && (
        <div className="space-y-5">
          <PriceGuidanceCard
            recommendedMaxPrice={recommendedMaxPrice}
            conservativeMaxPrice={conservativeMaxPrice}
            targetIRR={targetIRR}
            currentPrice={acquisition.purchasePrice}
          />
          <ProbabilityCard
            results={results}
            targetCoC={targetCoC} onTargetCoCChange={setTargetCoC}
            targetIRR={targetIRR} onTargetIRRChange={setTargetIRR}
          />
          <ScenarioOutcomes results={results} />
          <RiskDrivers results={results} />
        </div>
      )}

      {/* Assumption editor toggle */}
      <button
        type="button"
        onClick={() => setShowEditor(v => !v)}
        className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors"
      >
        {showEditor ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        {showEditor ? 'Hide' : 'Adjust'} assumptions
      </button>

      {showEditor && (
        <RangeEditor
          ranges={ranges}
          defaults={defaults}
          onChange={handleRangesChange}
          onReset={() => handleRangesChange(defaults)}
          showRefiRate={refinance.enabled}
        />
      )}
    </div>
  );
}
