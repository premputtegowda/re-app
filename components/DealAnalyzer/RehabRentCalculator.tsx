'use client';

import { useState, useMemo, useEffect } from 'react';
import { Zap, X, Wand2 } from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface UnitTypeInput {
  label: string;
  count: number;
  inPlaceRent: number;
  targetRent: number;
  preStabRent?: number;
}

export interface SimulationResult {
  yearlyRents: number[];
  stabilizationMonth: number;
}

// ── Simulation ─────────────────────────────────────────────────────────────────

/**
 * Simulate annual gross rent given a per-type monthly renovation schedule.
 *
 * scheduleByType[t][m] = units of type t starting renovation in month m+1 (0-indexed).
 * perUnitMonthsByType[t] = months each unit of type t is offline before earning targetRent.
 * Units not in any type's schedule are treated as already-stable (earn targetRent throughout).
 */
export function simulateFromSchedule(
  unitTypes: UnitTypeInput[],
  scheduleByType: number[][],
  perUnitMonthsByType: number[],
  totalYears: number
): SimulationResult {
  const totalMonths = totalYears * 12;

  // Pre-compute completion month → count per type
  const completionsByType = unitTypes.map((_, t) => {
    const completions = new Map<number, number>();
    const sched = scheduleByType[t] ?? [];
    for (let i = 0; i < sched.length; i++) {
      const doneMonth = (i + 1) + (perUnitMonthsByType[t] ?? 0);
      completions.set(doneMonth, (completions.get(doneMonth) ?? 0) + sched[i]);
    }
    return completions;
  });

  // Initial stable count per type = count not scheduled for renovation
  const stableByType = unitTypes.map((ut, t) => {
    const scheduled = (scheduleByType[t] ?? []).reduce((s, n) => s + n, 0);
    return Math.max(0, ut.count - scheduled);
  });

  const monthly: number[] = [];

  for (let m = 1; m <= totalMonths; m++) {
    let monthRent = 0;
    for (let t = 0; t < unitTypes.length; t++) {
      const ut = unitTypes[t];
      const sched = scheduleByType[t] ?? [];
      const scheduledTotal = sched.reduce((s, n) => s + n, 0);
      const staticUnits = Math.max(0, ut.count - scheduledTotal);

      stableByType[t] += completionsByType[t].get(m) ?? 0;

      const startedSoFar = sched.slice(0, m).reduce((s, n) => s + n, 0);
      const doneSoFar = stableByType[t] - staticUnits;
      const inRenovation = Math.max(0, startedSoFar - doneSoFar);
      const inPlaceUnits = Math.max(0, ut.count - stableByType[t] - inRenovation);

      monthRent += inPlaceUnits * ut.inPlaceRent + stableByType[t] * ut.targetRent;
    }
    monthly.push(monthRent);
  }

  const yearlyRents = Array.from({ length: totalYears }, (_, y) =>
    monthly.slice(y * 12, (y + 1) * 12).reduce((a, b) => a + b, 0)
  );

  let maxStabMonth = 0;
  for (let t = 0; t < unitTypes.length; t++) {
    const sched = scheduleByType[t] ?? [];
    if (sched.some(n => n > 0)) {
      maxStabMonth = Math.max(maxStabMonth, sched.length + (perUnitMonthsByType[t] ?? 0));
    }
  }

  return { yearlyRents, stabilizationMonth: maxStabMonth };
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmt$(n: number) {
  return n === 0 ? '—' : `$${Math.round(n).toLocaleString()}`;
}

function groupByYear(totalMonths: number): number[][] {
  const years: number[][] = [];
  for (let m = 1; m <= totalMonths; m++) {
    const yi = Math.floor((m - 1) / 12);
    if (!years[yi]) years[yi] = [];
    years[yi].push(m);
  }
  return years;
}

/** Evenly distribute n units across dur months (front-loaded). */
function evenDistribute(n: number, dur: number): number[] {
  if (n === 0 || dur === 0) return Array(dur).fill(0);
  const base = Math.floor(n / dur);
  const extra = n - base * dur;
  return Array.from({ length: dur }, (_, i) => (i < extra ? base + 1 : base));
}

// ── Component ──────────────────────────────────────────────────────────────────

interface RehabRentCalculatorProps {
  unitTypes: UnitTypeInput[];
  projectionYears: number;
  appliedYears: Record<number, number>;
  onApply: (overrides: Record<number, number>) => void;
  onClear: () => void;
  onApplyPreStab?: (values: number[]) => void;
  onOpenChange?: (v: boolean) => void;
  grossRentGrowthPct?: number;
}

export function RehabRentCalculator({
  unitTypes,
  projectionYears,
  appliedYears,
  onApply,
  onClear,
  onApplyPreStab,
  onOpenChange,
  grossRentGrowthPct = 0,
}: RehabRentCalculatorProps) {
  const setOpen = (v: boolean) => { onOpenChange?.(v); };

  const isApplied  = Object.keys(appliedYears).length > 0;
  const hasRentData = unitTypes.some(t => t.inPlaceRent > 0 && t.targetRent > 0);

  // ── Shared state ──
  const [totalDuration, setTotalDuration]   = useState(0);
  const [rehabType, setRehabType]           = useState<'stabilization' | 'renovation'>('renovation');

  // ── Per-type state ──
  const [unitsToStabilize, setUnitsToStabilize]   = useState<number[]>(() => unitTypes.map(() => 0));
  const [perUnitMonths, setPerUnitMonths]         = useState<number[]>(() => unitTypes.map(() => 0));
  const [scheduleByType, setScheduleByType]       = useState<number[][]>(() => unitTypes.map(() => []));

  // Reset when number of unit types changes
  useEffect(() => {
    setUnitsToStabilize(unitTypes.map(() => 0));
    setPerUnitMonths(unitTypes.map(() => 0));
    setScheduleByType(unitTypes.map(() => []));
    setTotalDuration(0);
  }, [unitTypes.length]);

  // Resize per-type schedules when totalDuration changes
  useEffect(() => {
    setScheduleByType(prev =>
      unitTypes.map((_, t) =>
        Array.from({ length: totalDuration }, (_, i) => prev[t]?.[i] ?? 0)
      )
    );
  }, [totalDuration, unitTypes.length]);

  const offlineMonths = (t: number) => rehabType === 'stabilization' ? 0 : (perUnitMonths[t] ?? 0);

  const scheduleTotals = useMemo(
    () => unitTypes.map((_, t) => (scheduleByType[t] ?? []).reduce((s, n) => s + n, 0)),
    [scheduleByType, unitTypes.length]
  );

  const someTypeScheduled = unitsToStabilize.some(u => u > 0);

  const scheduleValid = useMemo(() =>
    totalDuration > 0 &&
    someTypeScheduled &&
    unitTypes.every((_, t) =>
      unitsToStabilize[t] === 0 || scheduleTotals[t] === unitsToStabilize[t]
    ),
    [totalDuration, someTypeScheduled, unitTypes, unitsToStabilize, scheduleTotals]
  );

  // ── Per-type updaters ──
  const setTypeUnits = (t: number, val: number) =>
    setUnitsToStabilize(prev => { const n = [...prev]; n[t] = Math.min(unitTypes[t].count, Math.max(0, val)); return n; });

  const setTypeMonths = (t: number, val: number) =>
    setPerUnitMonths(prev => { const n = [...prev]; n[t] = Math.min(24, Math.max(0, val)); return n; });

  const updateCell = (t: number, monthIdx: number, val: number) =>
    setScheduleByType(prev => {
      const next = prev.map(s => [...s]);
      next[t][monthIdx] = Math.max(0, val);
      return next;
    });

  const autoFillAll = () => {
    setScheduleByType(prev =>
      unitTypes.map((_, t) => {
        const n = unitsToStabilize[t];
        if (n === 0 || totalDuration === 0) return prev[t] ?? Array(totalDuration).fill(0);
        return evenDistribute(n, totalDuration);
      })
    );
  };

  // ── Simulation ──
  const result = useMemo<SimulationResult | null>(() => {
    if (!hasRentData || !scheduleValid) return null;
    return simulateFromSchedule(
      unitTypes,
      scheduleByType,
      unitTypes.map((_, t) => offlineMonths(t)),
      Math.max(projectionYears, 2)
    );
  }, [unitTypes, scheduleByType, rehabType, perUnitMonths, projectionYears, hasRentData, scheduleValid]);

  const transitionYears = useMemo(() => {
    if (!result) return [];
    const stabYear = Math.ceil(result.stabilizationMonth / 12);
    return Array.from({ length: Math.min(stabYear, projectionYears) }, (_, i) => i + 1);
  }, [result, projectionYears]);

  const totalTargetAnnual = useMemo(
    () => unitTypes.reduce((s, t) => s + t.count * t.targetRent, 0) * 12,
    [unitTypes]
  );

  const blendedMonthlyByType = useMemo(() => {
    if (!result || transitionYears.length === 0) return unitTypes.map(() => 0);
    const totalAvg = transitionYears.reduce((s, y) => s + (result.yearlyRents[y - 1] ?? 0), 0)
      / transitionYears.length;
    const totalCount = unitTypes.reduce((s, t) => s + t.count, 0);
    return unitTypes.map(ut => totalCount > 0 ? totalAvg * ut.count / totalCount / 12 : 0);
  }, [result, transitionYears, unitTypes]);

  const yearGroups = useMemo(() => groupByYear(totalDuration), [totalDuration]);

  // ── Empty state ──
  if (!hasRentData) return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/30 px-3.5 py-3 flex items-center gap-2">
      <Zap size={14} className="text-slate-300 dark:text-slate-600 shrink-0" />
      <span className="text-sm text-slate-400 dark:text-slate-500">Enter in-place and target rents above to use the calculator</span>
    </div>
  );

  const colTemplate = `3.5rem repeat(${unitTypes.length}, 1fr) 3rem`;

  return (
    <div className={`rounded-xl border transition-colors mb-4 ${
      isApplied
        ? 'border-blue-200 dark:border-blue-800/60 bg-blue-50/40 dark:bg-blue-900/10'
        : 'border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/30'
    }`}>

      {/* ── Header ── */}
      <div className="flex items-center justify-between px-3.5 py-3">
        <div className="flex items-center gap-2">
          <Zap size={14} className={isApplied ? 'text-blue-500' : 'text-slate-400'} />
          <span className={`text-sm font-medium ${isApplied ? 'text-blue-700 dark:text-blue-300' : 'text-slate-600 dark:text-slate-400'}`}>
            Stabilization Schedule
          </span>
          {isApplied && (
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400">
              Applied
            </span>
          )}
        </div>
        <button type="button" onClick={() => setOpen(false)}
          className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
          aria-label="Cancel calculator">
          <X size={14} />
          <span className="hidden sm:inline">Cancel</span>
        </button>
      </div>

      <div className="px-3.5 pb-4 space-y-4 border-t border-slate-200 dark:border-slate-700 pt-4">

        {/* ── Shared: duration + type ── */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-slate-500 dark:text-slate-400 block mb-1">
              Total duration (months)
            </label>
            <input
              type="number"
              className="input text-sm"
              min={0}
              max={projectionYears * 12}
              placeholder="0"
              value={totalDuration === 0 ? '' : totalDuration}
              onChange={e => setTotalDuration(Math.min(projectionYears * 12, Number(e.target.value) || 0))}
              aria-label="Total duration"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500 dark:text-slate-400 block mb-1">
              Type
            </label>
            <div className="flex gap-1.5">
              {(['stabilization', 'renovation'] as const).map(t => (
                <button key={t} type="button" onClick={() => setRehabType(t)}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                    rehabType === t
                      ? 'bg-primary-600 text-white border-primary-600'
                      : 'border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400'
                  }`}>
                  {t === 'stabilization' ? 'Stab.' : 'Reno.'}
                </button>
              ))}
            </div>
          </div>
        </div>

        {rehabType === 'stabilization' && (
          <p className="text-[11px] text-slate-400 dark:text-slate-500 -mt-2">
            Unit flips to target rent immediately — no vacancy.
          </p>
        )}

        {/* ── Per-type config table ── */}
        <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-[200px]">
            <thead>
              <tr>
                <th className="text-left font-medium text-slate-400 dark:text-slate-500 pb-1.5 pr-2 w-20" />
                {unitTypes.map((ut, t) => (
                  <th key={t} className="text-center font-semibold text-slate-600 dark:text-slate-300 pb-1.5 px-1">
                    {ut.label}
                    <span className="block font-normal text-[10px] text-slate-400 dark:text-slate-500">{ut.count} units</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {/* Units to stabilize */}
              <tr>
                <td className="text-slate-400 dark:text-slate-500 pr-2 py-1 leading-tight">Stabilize</td>
                {unitTypes.map((ut, t) => (
                  <td key={t} className="px-1 py-1">
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        className="input text-xs py-1 text-center min-w-0"
                        min={0}
                        max={ut.count}
                        placeholder="0"
                        value={unitsToStabilize[t] === 0 ? '' : unitsToStabilize[t]}
                        onChange={e => setTypeUnits(t, Number(e.target.value) || 0)}
                        aria-label={`Units to stabilize ${ut.label}`}
                      />
                      <span className="text-slate-400 shrink-0">/{ut.count}</span>
                    </div>
                  </td>
                ))}
              </tr>

              {/* Mo/unit — only for renovation */}
              {rehabType === 'renovation' && (
                <tr>
                  <td className="text-slate-400 dark:text-slate-500 pr-2 py-1 leading-tight">Mo/unit</td>
                  {unitTypes.map((_, t) => (
                    <td key={t} className="px-1 py-1">
                      <input
                        type="number"
                        className="input text-xs py-1 text-center"
                        min={0}
                        max={24}
                        placeholder="0"
                        value={perUnitMonths[t] === 0 ? '' : perUnitMonths[t]}
                        onChange={e => setTypeMonths(t, Number(e.target.value) || 0)}
                        aria-label={`Months per unit ${unitTypes[t].label}`}
                      />
                    </td>
                  ))}
                </tr>
              )}

              {/* Scheduled progress */}
              <tr>
                <td className="text-slate-400 dark:text-slate-500 pr-2 py-1 leading-tight">Scheduled</td>
                {unitTypes.map((_, t) => (
                  <td key={t} className="px-1 py-1 text-center">
                    <span className={`font-semibold ${
                      unitsToStabilize[t] === 0 ? 'text-slate-400'
                        : scheduleTotals[t] === unitsToStabilize[t] ? 'text-emerald-600 dark:text-emerald-400'
                        : scheduleTotals[t] > unitsToStabilize[t] ? 'text-red-500'
                        : 'text-amber-500'
                    }`}>{scheduleTotals[t]}</span>
                    <span className="text-slate-400">/{unitsToStabilize[t] || '—'}</span>
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>

        {/* ── Monthly schedule grid ── */}
        {totalDuration > 0 && someTypeScheduled && (
          <div className="space-y-3">
            {yearGroups.map((months, yi) => {
              const yearTotals = unitTypes.map((_, t) =>
                months.reduce((s, m) => s + (scheduleByType[t]?.[m - 1] ?? 0), 0)
              );
              return (
                <div key={yi} className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">

                  {/* Year header */}
                  <div className="px-3 py-1.5 bg-slate-100 dark:bg-slate-700/50 flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Year {yi + 1}</span>
                    <div className="flex gap-3">
                      {unitTypes.map((ut, t) => yearTotals[t] > 0 && (
                        <span key={t} className="text-[11px] text-slate-400">{ut.label}: {yearTotals[t]}</span>
                      ))}
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    {/* Column headers */}
                    <div className="grid gap-1 px-3 py-1.5 border-b border-slate-100 dark:border-slate-700/60 bg-slate-50/50 dark:bg-slate-800/20"
                      style={{ gridTemplateColumns: colTemplate }}>
                      <span />
                      {unitTypes.map((ut, t) => (
                        <span key={t} className="text-[11px] font-medium text-slate-500 dark:text-slate-400 text-center">{ut.label}</span>
                      ))}
                      <span />
                    </div>

                    {/* Month rows */}
                    <div className="divide-y divide-slate-100 dark:divide-slate-700/60">
                      {months.map(m => {
                        const idx = m - 1;
                        const isFirst = m === 1;
                        return (
                          <div key={m} className="grid gap-1 items-center px-3 py-1.5"
                            style={{ gridTemplateColumns: colTemplate }}>
                            <span className="text-xs text-slate-400 dark:text-slate-500">Mo {m}</span>
                            {unitTypes.map((_, t) => {
                              const val = scheduleByType[t]?.[idx] ?? 0;
                              return (
                                <input key={t}
                                  type="number"
                                  className="input text-xs py-1 text-center"
                                  min={0}
                                  placeholder="0"
                                  value={val === 0 ? '' : val}
                                  onChange={e => updateCell(t, idx, Number(e.target.value) || 0)}
                                  aria-label={`Mo ${m} ${unitTypes[t].label}`}
                                />
                              );
                            })}
                            {isFirst ? (
                              <button
                                type="button"
                                onClick={autoFillAll}
                                className="flex items-center justify-center gap-0.5 text-[11px] text-primary-600 dark:text-primary-400 hover:text-primary-700 font-medium touch-manipulation"
                                title="Auto-fill all columns evenly"
                                aria-label="Auto-fill schedule"
                              >
                                <Wand2 size={11} />
                                <span className="hidden sm:inline">Fill</span>
                              </button>
                            ) : <span />}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ── Projection summary ── */}
        {result && transitionYears.length > 0 && (
          <div className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-100 dark:bg-slate-700/50">
                  <th className="px-3 py-2 text-left font-medium text-slate-500 dark:text-slate-400">Year</th>
                  <th className="px-3 py-2 text-right font-medium text-amber-600 dark:text-amber-400">Gross Rent</th>
                  <th className="px-3 py-2 text-right font-medium text-emerald-600 dark:text-emerald-400">Target/yr</th>
                </tr>
              </thead>
              <tbody>
                {transitionYears.map(y => (
                  <tr key={y} className="border-t border-slate-100 dark:border-slate-700/50">
                    <td className="px-3 py-2 font-medium text-slate-700 dark:text-slate-300">Yr {y}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold text-amber-600 dark:text-amber-400">
                      {fmt$(result.yearlyRents[y - 1])}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-400 dark:text-slate-500">
                      {fmt$(totalTargetAnnual)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {result && (
          <p className="text-[11px] text-slate-400 dark:text-slate-500">
            Fully stabilized by month {result.stabilizationMonth}
            {result.stabilizationMonth <= projectionYears * 12
              ? ` (Yr ${Math.ceil(result.stabilizationMonth / 12)})`
              : ' — beyond projection window'}
          </p>
        )}

        {/* ── Actions ── */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={!scheduleValid || !result}
            onClick={() => {
              if (!result) return;
              const overrides: Record<number, number> = {};
              transitionYears.forEach(y => { overrides[y] = result.yearlyRents[y - 1]; });
              const stabYear = Math.ceil(result.stabilizationMonth / 12);
              const firstFullYear = stabYear + 1;
              if (firstFullYear <= projectionYears) {
                overrides[firstFullYear] = totalTargetAnnual * Math.pow(1 + grossRentGrowthPct / 100, stabYear);
              }
              onApply(overrides);
              if (onApplyPreStab) onApplyPreStab(blendedMonthlyByType);
              setOpen(false);
            }}
            className="flex-1 py-2 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-40 text-white text-sm font-medium transition-colors"
          >
            Apply to Pro Forma
          </button>
          <button
            type="button"
            onClick={() => { onClear(); setOpen(false); }}
            className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-sm text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700/40 transition-colors"
          >
            Clear
          </button>
        </div>

        {!scheduleValid && someTypeScheduled && totalDuration > 0 &&
          unitTypes.some((_, t) => unitsToStabilize[t] > 0 && scheduleTotals[t] !== unitsToStabilize[t]) && (
          <p className="text-[11px] text-amber-500">
            Schedule totals must match stabilize targets before applying.
          </p>
        )}

      </div>
    </div>
  );
}
