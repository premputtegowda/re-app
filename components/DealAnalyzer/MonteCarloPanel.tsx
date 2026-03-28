'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import React from 'react';
import { Play, ChevronDown, ChevronUp, RotateCcw } from 'lucide-react';
import { formatCurrency, formatPct, formatMultiple } from '@/utils/dealAnalyzerCalc';
import { runSimulation, computeDefaultRanges, toSavedMCResults, hydrateMCResults } from '@/utils/monteCarlo';
import type { MCRanges, MCResults, MCRunResult, SavedMCResults } from '@/utils/monteCarlo';
import type { CoCAcquisition, CoCOperations, CoCRefinance, ProFormaData } from '@/types';

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

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtIrr(v: number): string {
  return v <= -900 ? '—' : formatPct(v);
}

function impactLabel(r: number): { label: string; color: string; width: number } {
  if (r >= 0.5) return { label: 'High',   color: 'bg-red-400 dark:bg-red-500',         width: 100 };
  if (r >= 0.3) return { label: 'High',   color: 'bg-amber-400 dark:bg-amber-500',      width: Math.round(r / 0.5 * 100) };
  if (r >= 0.15) return { label: 'Medium', color: 'bg-amber-300 dark:bg-amber-400',     width: Math.round(r / 0.5 * 100) };
  return             { label: 'Low',    color: 'bg-slate-300 dark:bg-slate-500',         width: Math.round(r / 0.5 * 100) };
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

function ProbabilityRow({ pct, label }: { pct: number; label: React.ReactNode }) {
  const barColor = pct >= 70 ? 'bg-secondary-500' : pct >= 50 ? 'bg-amber-400' : 'bg-red-400';
  const textColor = pct >= 70 ? 'text-secondary-600 dark:text-secondary-400' : pct >= 50 ? 'text-amber-600 dark:text-amber-400' : 'text-red-500 dark:text-red-400';
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between">
        <span className="text-xs text-slate-500 dark:text-slate-400">{label}</span>
        <span className={`text-sm font-bold tabular-nums ${textColor}`}>{pct}%</span>
      </div>
      <div className="h-2 w-full rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
        <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
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

function VerdictCard({ results, targetCoC, onTargetCoCChange, targetIRR, onTargetIRRChange }: {
  results: MCResults;
  targetCoC: number; onTargetCoCChange: (v: number) => void;
  targetIRR: number; onTargetIRRChange: (v: number) => void;
}) {
  const EPS = 0.005; // tolerance for floating-point near-equality
  const probCoC = Math.round(results.sorted.filter(r => r.avgCoCReturn >= targetCoC - EPS).length / results.n * 100);
  const probIRR = Math.round(results.sorted.filter(r => r.irr > -900 && r.irr >= targetIRR - EPS).length / results.n * 100);
  const probLoss = results.sorted.filter(r => r.avgCoCReturn < 0).length / results.n;

  const overallPct = Math.round((probCoC + probIRR) / 2);
  const verdictText = overallPct >= 70 ? 'Strong deal' : overallPct >= 50 ? 'Moderate deal' : 'Risky deal';
  const verdictColor = overallPct >= 70
    ? 'bg-secondary-50 dark:bg-secondary-900/20 text-secondary-600 dark:text-secondary-400'
    : overallPct >= 50
    ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400'
    : 'bg-red-50 dark:bg-red-900/20 text-red-500 dark:text-red-400';

  return (
    <div className="rounded-2xl border border-slate-200 dark:border-slate-700 p-5 space-y-4">
      {/* Verdict badge */}
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">Probability of hitting targets</p>
        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${verdictColor}`}>{verdictText}</span>
      </div>

      {/* CoC probability */}
      <ProbabilityRow
        pct={probCoC}
        label={<span className="inline-flex items-center gap-1">
          Avg CoC ≥ <TargetInput value={targetCoC} onChange={onTargetCoCChange} step={0.5} /> %
        </span>}
      />

      {/* IRR probability */}
      <ProbabilityRow
        pct={probIRR}
        label={<span className="inline-flex items-center gap-1">
          IRR ≥ <TargetInput value={targetIRR} onChange={onTargetIRRChange} step={0.5} /> %
        </span>}
      />

      {/* Key stats — IRR row then CoC row */}
      <div className="pt-1 border-t border-slate-100 dark:border-slate-700 space-y-3">
        {[
          {
            heading: 'IRR',
            stats: [
              { label: 'Median',        value: fmtIrr(results.p50.irr) },
              { label: 'Worst (P10)',   value: fmtIrr(results.p10.irr) },
              { label: 'Loss prob.',    value: formatPct(probLoss * 100) },
            ],
          },
          {
            heading: 'Cash-on-Cash',
            stats: [
              { label: 'Median',        value: formatPct(results.p50.avgCoCReturn) },
              { label: 'Worst (P10)',   value: formatPct(results.p10.avgCoCReturn) },
              { label: 'Loss prob.',    value: formatPct(probLoss * 100) },
            ],
          },
        ].map(({ heading, stats }) => (
          <div key={heading}>
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-1.5">{heading}</p>
            <div className="grid grid-cols-3 gap-3">
              {stats.map(({ label, value }) => (
                <div key={label}>
                  <p className="text-[10px] text-slate-400 dark:text-slate-500">{label}</p>
                  <p className="text-sm font-semibold text-slate-800 dark:text-slate-200 tabular-nums">{value}</p>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ScenarioColumns({ results }: { results: MCResults }) {
  const scenarios: Array<{ label: string; sub: string; data: MCRunResult; headerColor: string; badgeColor: string }> = [
    {
      label: 'Bear Case', sub: 'P20 — worse than 80% of runs',
      data: results.p20,
      headerColor: 'text-red-500 dark:text-red-400',
      badgeColor: 'bg-red-50 dark:bg-red-900/20 text-red-500 dark:text-red-400',
    },
    {
      label: 'Base Case', sub: 'P50 — median outcome',
      data: results.p50,
      headerColor: 'text-primary-600 dark:text-primary-400',
      badgeColor: 'bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400',
    },
    {
      label: 'Bull Case', sub: 'P80 — better than 80% of runs',
      data: results.p80,
      headerColor: 'text-secondary-600 dark:text-secondary-400',
      badgeColor: 'bg-secondary-50 dark:bg-secondary-900/20 text-secondary-600 dark:text-secondary-400',
    },
  ];

  return (
    <div>
      <p className="text-sm font-semibold text-slate-800 dark:text-slate-200 mb-3">Scenario Spectrum</p>
      <div className="grid grid-cols-3 gap-3">
        {scenarios.map(({ label, sub, data, headerColor, badgeColor }) => (
          <div key={label} className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
            {/* Header */}
            <div className="px-3 py-2.5 border-b border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
              <p className={`text-xs font-bold ${headerColor}`}>{label}</p>
              <p className="text-[10px] text-slate-400 mt-0.5 leading-tight">{sub}</p>
            </div>
            {/* Returns */}
            <div className="px-3 py-3 space-y-2">
              <div>
                <p className="text-[10px] text-slate-400 uppercase tracking-wide">Returns</p>
                <div className="mt-1 space-y-1">
                  {[
                    { label: 'IRR',           value: fmtIrr(data.irr) },
                    { label: 'Avg CoC',       value: formatPct(data.avgCoCReturn) },
                    { label: 'Equity ×',      value: formatMultiple(data.equityMultiple) },
                  ].map(({ label, value }) => (
                    <div key={label} className="flex justify-between items-baseline">
                      <span className="text-[10px] text-slate-500">{label}</span>
                      <span className={`text-sm font-semibold tabular-nums ${headerColor}`}>{value}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="pt-2 border-t border-slate-100 dark:border-slate-700">
                <p className="text-[10px] text-slate-400 uppercase tracking-wide mb-1">Sampled inputs</p>
                <div className="space-y-1">
                  {[
                    { label: 'Rent / unit',  value: `$${Math.round(data.sampled.targetRentPerUnit).toLocaleString()}/mo` },
                    { label: 'Vacancy',      value: formatPct(data.sampled.vacancyPct) },
                    { label: 'Exit cap',     value: formatPct(data.sampled.exitCapRate) },
                    { label: 'Reno overrun', value: `+${Math.round(data.sampled.renoOverrunPct)}%` },
                  ].map(({ label, value }) => (
                    <div key={label} className="flex justify-between items-baseline">
                      <span className="text-[10px] text-slate-400">{label}</span>
                      <span className="text-[11px] font-medium text-slate-600 dark:text-slate-400 tabular-nums">{value}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SensitivitySection({ results }: { results: MCResults }) {
  return (
    <div>
      <p className="text-sm font-semibold text-slate-800 dark:text-slate-200 mb-3">What drives the risk?</p>
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
                impLabel === 'High' ? 'text-red-500 dark:text-red-400' :
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

function RangeEditor({ ranges, defaults, onChange, onReset }: {
  ranges:   MCRanges;
  defaults: MCRanges;
  onChange: (r: MCRanges) => void;
  onReset:  () => void;
}) {
  // Local string state for each (key, side) so typing isn't blocked mid-edit
  const [draft, setDraft] = useState<Partial<Record<string, string>>>({});
  // higherIsWorse: pessimistic = max (bad high), optimistic = min (good low)
  const fields: Array<{ key: keyof MCRanges; label: string; step: number; decimals: number; higherIsWorse: boolean }> = [
    { key: 'targetRentPerUnit', label: 'Rent / unit ($/mo)',    step: 25,    decimals: 0, higherIsWorse: false },
    { key: 'vacancyPct',        label: 'Vacancy Rate (%)',      step: 0.5,   decimals: 1, higherIsWorse: true  },
    { key: 'rentGrowthPct',     label: 'Rent Growth / yr (%)',  step: 0.25,  decimals: 2, higherIsWorse: false },
    { key: 'exitCapRate',       label: 'Exit Cap Rate (%)',     step: 0.25,  decimals: 2, higherIsWorse: true  },
    { key: 'renoOverrunPct',    label: 'Reno Overrun Max (%)',  step: 5,     decimals: 0, higherIsWorse: true  },
    { key: 'interestRate',      label: 'Interest Rate (%)',     step: 0.125, decimals: 3, higherIsWorse: true  },
  ];

  const changed = (Object.keys(ranges) as (keyof MCRanges)[]).some(
    k => ranges[k].min !== defaults[k].min || ranges[k].max !== defaults[k].max
  );

  return (
    <div className="space-y-4 pt-4 border-t border-slate-100 dark:border-slate-700">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Simulation assumptions</p>
        {changed && (
          <button type="button" onClick={onReset}
            className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors">
            <RotateCcw size={10} /> Reset to defaults
          </button>
        )}
      </div>

      {/* Column headers */}
      <div className="grid grid-cols-[1fr_80px_80px_80px] gap-x-3 items-center">
        <span />
        <span className="text-[10px] font-semibold text-red-400 text-center uppercase tracking-wide">Pessimistic</span>
        <span className="text-[10px] font-semibold text-primary-400 text-center uppercase tracking-wide">Base</span>
        <span className="text-[10px] font-semibold text-secondary-500 text-center uppercase tracking-wide">Optimistic</span>
      </div>

      <div className="space-y-2">
        {fields.map(({ key, label, step, decimals, higherIsWorse }) => {
          const r = ranges[key];
          const d = defaults[key];
          const fmt = (v: number) => parseFloat(v.toFixed(decimals)).toString();
          // For higherIsWorse: pessimistic = max, optimistic = min
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
              // pessimistic must be on the "worse" side of base (≥ base for higherIsWorse, ≤ base otherwise)
              const clamped = higherIsWorse ? Math.max(v, d.mode) : Math.min(v, d.mode);
              onChange({ ...ranges, [key]: { ...r, [pessField]: clamped } });
            }
          };
          const commitOptim = () => {
            const v = parseFloat(draft[optimKey] ?? '');
            setDraft(d2 => { const n = { ...d2 }; delete n[optimKey]; return n; });
            if (!isNaN(v)) {
              // optimistic must be on the "better" side of base (≤ base for higherIsWorse, ≥ base otherwise)
              const clamped = higherIsWorse ? Math.min(v, d.mode) : Math.max(v, d.mode);
              onChange({ ...ranges, [key]: { ...r, [optimField]: clamped } });
            }
          };

          return (
            <div key={key} className="grid grid-cols-[1fr_80px_80px_80px] gap-x-3 items-center">
              <span className="text-xs text-slate-600 dark:text-slate-400">{label}</span>

              {/* Pessimistic */}
              <input
                type="number"
                value={pessDisplay}
                step={step}
                onChange={e => setDraft(d2 => ({ ...d2, [pessKey]: e.target.value }))}
                onBlur={commitPess}
                onKeyDown={e => { if (e.key === 'Enter') { e.currentTarget.blur(); } }}
                className="w-full text-center text-xs font-semibold tabular-nums rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 px-1 py-1.5 focus:outline-none focus:ring-1 focus:ring-red-400"
              />

              {/* Base (mode) — read only */}
              <div className="w-full text-center text-xs font-semibold tabular-nums rounded-lg bg-slate-100 dark:bg-slate-700 text-primary-600 dark:text-primary-400 px-1 py-1.5 select-none">
                {fmt(d.mode)}
              </div>

              {/* Optimistic */}
              <input
                type="number"
                value={optimDisplay}
                step={step}
                onChange={e => setDraft(d2 => ({ ...d2, [optimKey]: e.target.value }))}
                onBlur={commitOptim}
                onKeyDown={e => { if (e.key === 'Enter') { e.currentTarget.blur(); } }}
                className="w-full text-center text-xs font-semibold tabular-nums rounded-lg border border-secondary-200 dark:border-secondary-800 bg-secondary-50 dark:bg-secondary-900/20 text-secondary-600 dark:text-secondary-400 px-1 py-1.5 focus:outline-none focus:ring-1 focus:ring-secondary-400"
              />
            </div>
          );
        })}
      </div>

      <p className="text-[10px] text-slate-400 dark:text-slate-500">
        Pessimistic: worse than base · Optimistic: better than base · Re-run after changing.
      </p>
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
    () => computeDefaultRanges(acquisition, proForma, avgTargetRentPerUnit, units),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const initialRanges = savedRanges ?? defaults;
  const [ranges, setRanges] = useState<MCRanges>(initialRanges);

  // Sync initial ranges to parent so they're always persisted on save,
  // even if the user never edits them.
  useEffect(() => {
    onRangesChange?.(initialRanges);
    // Only on mount — intentionally omitting deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRangesChange = useCallback((r: MCRanges) => {
    setRanges(r);
    onRangesChange?.(r);
  }, [onRangesChange]);
  const [results, setResults] = useState<MCResults | null>(
    savedResults ? hydrateMCResults(savedResults) : null
  );
  const [running, setRunning]       = useState(false);
  const [progress, setProgress]     = useState(0);
  const [targetCoC, setTargetCoC]   = useState(8);
  const [targetIRR, setTargetIRR]   = useState(12);
  const [showEditor, setShowEditor] = useState(false);

  const run = useCallback(async () => {
    setRunning(true);
    setProgress(0);
    setResults(null);
    try {
      const r = await runSimulation({
        n: N_RUNS,
        ranges,
        acquisition,
        operations,
        proForma,
        refinance,
        units,
        avgPreStabPerUnit,
        onProgress: setProgress,
      });
      setResults(r);
      onResultsChange?.(toSavedMCResults(r));
    } finally {
      setRunning(false);
    }
  }, [ranges, acquisition, operations, proForma, refinance, units, avgPreStabPerUnit]);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">Monte Carlo Simulation</p>
          <p className="text-xs text-slate-400 mt-0.5">
            {N_RUNS.toLocaleString()} random scenarios across rent, vacancy, costs, rates & exit
          </p>
        </div>
        <button
          type="button"
          onClick={run}
          disabled={running}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-semibold transition-colors shrink-0"
        >
          <Play size={14} />
          {running ? 'Running…' : results ? 'Re-run' : 'Run Simulation'}
        </button>
      </div>

      {/* Progress */}
      {running && <ProgressBar pct={progress} />}

      {/* Results */}
      {results && !running && (
        <div className="space-y-5">
          <VerdictCard
            results={results}
            targetCoC={targetCoC} onTargetCoCChange={setTargetCoC}
            targetIRR={targetIRR} onTargetIRRChange={setTargetIRR}
          />
          <ScenarioColumns results={results} />
          <SensitivitySection results={results} />
        </div>
      )}

      {/* Assumption editor toggle */}
      <button
        type="button"
        onClick={() => setShowEditor(v => !v)}
        className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors"
      >
        {showEditor ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        {showEditor ? 'Hide' : 'Customize'} assumptions
      </button>

      {showEditor && (
        <RangeEditor
          ranges={ranges}
          defaults={defaults}
          onChange={handleRangesChange}
          onReset={() => handleRangesChange(defaults)}
        />
      )}
    </div>
  );
}
