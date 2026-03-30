'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import { Zap, X, Wand2 } from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface CalcPersistedState {
  mode: 'calculator' | 'manual';
  totalDuration: number;
  rehabType: 'stabilization' | 'renovation';
  unitsToStabilize: number[];
  perUnitMonths: number[];
  scheduleByType: number[][];
  manualDuration: number;
  manualPreStabRents: number[];
}

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
  monthlyByType: number[][];   // [typeIdx][monthIdx 0-based] = that type's rent contribution
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

  // Pre-compute completion data per type.
  // For fractional offline months (e.g. 0.5): units finish mid-month, so the partial month
  // earns (1 - frac) * targetRent * count. Track separately from full completions.
  const completionsByType: Map<number, number>[]       = unitTypes.map(() => new Map());
  const partialRentByType: Map<number, number>[]       = unitTypes.map(() => new Map());

  for (let t = 0; t < unitTypes.length; t++) {
    const sched       = scheduleByType[t] ?? [];
    const offline     = perUnitMonthsByType[t] ?? 0;
    const offlineFull = Math.floor(offline);
    const offlineFrac = offline - offlineFull;

    for (let i = 0; i < sched.length; i++) {
      const count      = sched[i];
      if (count === 0) continue;
      const startMonth = i + 1;

      if (offlineFrac === 0) {
        // Whole months — original behaviour
        const doneMonth = startMonth + offlineFull;
        completionsByType[t].set(doneMonth, (completionsByType[t].get(doneMonth) ?? 0) + count);
      } else {
        // Fractional offline: partial month earns (1 - frac) * targetRent * count
        const partialMonth = startMonth + offlineFull;
        const doneMonth    = partialMonth + 1;
        completionsByType[t].set(doneMonth, (completionsByType[t].get(doneMonth) ?? 0) + count);
        const partialRent  = (1 - offlineFrac) * (unitTypes[t]?.targetRent ?? 0) * count;
        partialRentByType[t].set(partialMonth, (partialRentByType[t].get(partialMonth) ?? 0) + partialRent);
      }
    }
  }

  // Initial stable count per type = count not scheduled for renovation
  const stableByType = unitTypes.map((ut, t) => {
    const scheduled = (scheduleByType[t] ?? []).reduce((s, n) => s + n, 0);
    return Math.max(0, ut.count - scheduled);
  });

  const monthly: number[] = [];
  const monthlyByType: number[][] = unitTypes.map(() => []);

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

      const typeRent = inPlaceUnits * ut.inPlaceRent
        + stableByType[t] * ut.targetRent
        + (partialRentByType[t].get(m) ?? 0);
      monthlyByType[t].push(typeRent);
      monthRent += typeRent;
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
      maxStabMonth = Math.max(maxStabMonth, Math.ceil(sched.length + (perUnitMonthsByType[t] ?? 0)));
    }
  }

  return { yearlyRents, stabilizationMonth: maxStabMonth, monthlyByType };
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
  initialState?: CalcPersistedState;
  onStateChange?: (state: CalcPersistedState) => void;
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
  initialState,
  onStateChange,
}: RehabRentCalculatorProps) {
  const setOpen = (v: boolean) => { onOpenChange?.(v); };

  const isApplied  = Object.keys(appliedYears).length > 0;
  const hasRentData = unitTypes.some(t => t.inPlaceRent > 0 && t.targetRent > 0);

  // ── Mode ──
  const [mode, setMode] = useState<'calculator' | 'manual'>(() => initialState?.mode ?? 'calculator');

  // ── Calculator state ──
  const [totalDuration, setTotalDuration]   = useState(() => initialState?.totalDuration ?? 0);
  const [rehabType, setRehabType]           = useState<'stabilization' | 'renovation'>(() => initialState?.rehabType ?? 'renovation');

  // ── Per-type calculator state ──
  const [unitsToStabilize, setUnitsToStabilize]   = useState<number[]>(() => initialState?.unitsToStabilize ?? unitTypes.map(() => 0));
  const [perUnitMonths, setPerUnitMonths]         = useState<number[]>(() => initialState?.perUnitMonths ?? unitTypes.map(() => 0));
  const [scheduleByType, setScheduleByType]       = useState<number[][]>(() => initialState?.scheduleByType ?? unitTypes.map(() => []));
  const [openYear, setOpenYear]                   = useState<number | null>(null);

  // ── Manual mode state ──
  const [manualDuration, setManualDuration]         = useState(() => initialState?.manualDuration ?? 0);
  const [manualPreStabRents, setManualPreStabRents] = useState<number[]>(() => initialState?.manualPreStabRents ?? unitTypes.map(() => 0));

  // Notify parent of state changes so it can persist across open/close
  useEffect(() => {
    onStateChange?.({ mode, totalDuration, rehabType, unitsToStabilize, perUnitMonths, scheduleByType, manualDuration, manualPreStabRents });
  }, [mode, totalDuration, rehabType, unitsToStabilize, perUnitMonths, scheduleByType, manualDuration, manualPreStabRents]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset only when number of unit types genuinely changes (skip on initial mount)
  const prevUnitTypesLengthRef = useRef(unitTypes.length);
  useEffect(() => {
    if (prevUnitTypesLengthRef.current === unitTypes.length) return;
    prevUnitTypesLengthRef.current = unitTypes.length;
    setUnitsToStabilize(unitTypes.map(() => 0));
    setPerUnitMonths(unitTypes.map(() => 0));
    setScheduleByType(unitTypes.map(() => []));
    setTotalDuration(0);
    setManualPreStabRents(unitTypes.map(() => 0));
    setManualDuration(0);
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
      const otherSum = (next[t] ?? []).reduce((s, n, i) => i === monthIdx ? s : s + n, 0);
      const cap = unitsToStabilize[t] > 0 ? Math.max(0, unitsToStabilize[t] - otherSum) : val;
      next[t][monthIdx] = Math.min(Math.max(0, val), cap);
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
    return unitTypes.map((ut, t) => {
      const transitionMonths = Math.min(result.stabilizationMonth, transitionYears.length * 12);
      if (transitionMonths === 0 || ut.count === 0) return 0;
      const totalRent = result.monthlyByType[t]
        ?.slice(0, transitionMonths)
        .reduce((s, r) => s + r, 0) ?? 0;
      return totalRent / transitionMonths / ut.count;
    });
  }, [result, transitionYears, unitTypes]);

  const yearGroups = useMemo(() => groupByYear(totalDuration), [totalDuration]);

  // ── Empty state ──
  if (!hasRentData) return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/30 px-3.5 py-3 flex items-center gap-2">
      <Zap size={14} className="text-slate-300 dark:text-slate-600 shrink-0" />
      <span className="text-sm text-slate-400 dark:text-slate-500">Enter in-place and target rents above to use the calculator</span>
    </div>
  );


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

      {/* ── Mode switcher ── */}
      <div className="px-3.5 pb-3">
        <div className="flex rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden text-xs font-medium">
          <button
            type="button"
            onClick={() => setMode('calculator')}
            className={`flex-1 py-2 transition-colors ${
              mode === 'calculator'
                ? 'bg-primary-600 text-white'
                : 'text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700/40'
            }`}
          >
            Calculator
          </button>
          <button
            type="button"
            onClick={() => setMode('manual')}
            className={`flex-1 py-2 border-l border-slate-200 dark:border-slate-700 transition-colors ${
              mode === 'manual'
                ? 'bg-primary-600 text-white'
                : 'text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700/40'
            }`}
          >
            Enter My Numbers
          </button>
        </div>
      </div>

      {/* ── Manual entry mode ── */}
      {mode === 'manual' && (
        <div className="px-3.5 pb-4 space-y-4 border-t border-slate-200 dark:border-slate-700 pt-4">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Enter the stabilization period length and your expected effective rent per unit type during renovation. These will be applied directly to the pro forma.
          </p>

          {/* Duration */}
          <div>
            <label className="text-xs font-medium text-slate-500 dark:text-slate-400 block mb-1">
              Stabilization duration (months)
            </label>
            <input
              type="number"
              className="input text-sm"
              min={1}
              max={projectionYears * 12}
              placeholder="e.g. 12"
              value={manualDuration === 0 ? '' : manualDuration}
              onChange={e => setManualDuration(Math.min(projectionYears * 12, Math.max(0, Number(e.target.value) || 0)))}
              aria-label="Manual stabilization duration"
            />
          </div>

          {/* Per-type pre-stab rents */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-slate-500 dark:text-slate-400 block">
              Effective pre-stab rent ($/mo per unit)
            </label>
            {unitTypes.map((ut, t) => (
              <div key={t} className="flex items-center gap-3">
                <span className="text-xs font-medium text-slate-600 dark:text-slate-300 w-20 shrink-0">{ut.label}</span>
                <div className="flex-1 relative">
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400">$</span>
                  <input
                    type="number"
                    className="input text-sm pl-6"
                    min={0}
                    placeholder={`target ${ut.targetRent}`}
                    value={manualPreStabRents[t] === 0 ? '' : manualPreStabRents[t]}
                    onChange={e => {
                      const v = Number(e.target.value) || 0;
                      setManualPreStabRents(prev => prev.map((r, i) => i === t ? v : r));
                    }}
                    aria-label={`Pre-stab rent ${ut.label}`}
                  />
                </div>
                <span className="text-[11px] text-slate-400 dark:text-slate-500 shrink-0">
                  target ${ut.targetRent}
                </span>
              </div>
            ))}
          </div>

          {/* Summary */}
          {manualDuration > 0 && manualPreStabRents.some(r => r > 0) && (
            <div className="rounded-lg bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 px-3 py-2.5 space-y-1">
              <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Summary</p>
              {unitTypes.map((ut, t) => (
                <div key={t} className="flex justify-between text-xs">
                  <span className="text-slate-500 dark:text-slate-400">{ut.label}</span>
                  <span className="text-slate-700 dark:text-slate-200 tabular-nums">
                    ${(manualPreStabRents[t] ?? 0).toLocaleString()}/mo × {ut.count} units
                    {' = '}${((manualPreStabRents[t] ?? 0) * ut.count).toLocaleString()}/mo
                  </span>
                </div>
              ))}
              <div className="border-t border-slate-200 dark:border-slate-700 pt-1 flex justify-between text-xs font-semibold">
                <span className="text-slate-600 dark:text-slate-300">Total/mo during stab</span>
                <span className="text-amber-600 dark:text-amber-400 tabular-nums">
                  ${unitTypes.reduce((s, ut, t) => s + (manualPreStabRents[t] ?? 0) * ut.count, 0).toLocaleString()}/mo
                </span>
              </div>
              <p className="text-[11px] text-slate-400 dark:text-slate-500">
                Applied for {manualDuration} month{manualDuration !== 1 ? 's' : ''} ({Math.ceil(manualDuration / 12)} year{Math.ceil(manualDuration / 12) !== 1 ? 's' : ''})
              </p>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={manualDuration === 0 || manualPreStabRents.every(r => r === 0)}
              onClick={() => {
                const transYears = Math.ceil(manualDuration / 12);
                const preStabMonthly = unitTypes.reduce((s, ut, t) => s + (manualPreStabRents[t] ?? 0) * ut.count, 0);
                const targetMonthly  = unitTypes.reduce((s, ut) => s + ut.targetRent * ut.count, 0);
                const overrides: Record<number, number> = {};
                for (let y = 1; y <= Math.min(transYears, projectionYears); y++) {
                  const stabMonthsThisYear = Math.min(12, manualDuration - (y - 1) * 12);
                  const targetMonthsThisYear = 12 - stabMonthsThisYear;
                  overrides[y] = preStabMonthly * stabMonthsThisYear + targetMonthly * targetMonthsThisYear;
                }
                const firstFull = transYears + 1;
                if (firstFull <= projectionYears) {
                  overrides[firstFull] = totalTargetAnnual * Math.pow(1 + grossRentGrowthPct / 100, transYears);
                }
                onApply(overrides);
                if (onApplyPreStab) onApplyPreStab(manualPreStabRents);
                setOpen(false);
              }}
              className="flex-1 py-2 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-40 text-white text-sm font-medium transition-colors"
            >
              Apply to Pro Forma
            </button>
            <button
              type="button"
              onClick={() => {
                setManualDuration(0);
                setManualPreStabRents(unitTypes.map(() => 0));
              }}
              className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-sm text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700/40 transition-colors"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {/* ── Calculator mode ── */}
      {mode === 'calculator' && (
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

        {/* ── Per-type config: cards ── */}
        <div className="space-y-2">
          {unitTypes.map((ut, t) => (
            <div key={t} className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                  {ut.label} <span className="font-normal text-slate-400">({ut.count} units)</span>
                </span>
                <span className={`text-xs font-semibold ${
                  unitsToStabilize[t] === 0 ? 'text-slate-400'
                    : scheduleTotals[t] === unitsToStabilize[t] ? 'text-emerald-600 dark:text-emerald-400'
                    : scheduleTotals[t] > unitsToStabilize[t] ? 'text-red-500'
                    : 'text-amber-500'
                }`}>
                  {scheduleTotals[t]}/{unitsToStabilize[t] || '—'} scheduled
                </span>
              </div>
              <div className={`grid gap-3 ${rehabType === 'renovation' ? 'grid-cols-2' : 'grid-cols-1'}`}>
                <div>
                  <label className="text-[11px] text-slate-400 dark:text-slate-500 block mb-1">
                    Stabilize (of {ut.count})
                  </label>
                  <input
                    type="number"
                    className="input text-sm w-full"
                    min={0}
                    max={ut.count}
                    placeholder="0"
                    value={unitsToStabilize[t] === 0 ? '' : unitsToStabilize[t]}
                    onChange={e => setTypeUnits(t, Number(e.target.value) || 0)}
                    aria-label={`Units to stabilize ${ut.label}`}
                  />
                </div>
                {rehabType === 'renovation' && (
                  <div>
                    <label className="text-[11px] text-slate-400 dark:text-slate-500 block mb-1">
                      Mo/unit offline
                    </label>
                    <input
                      type="number"
                      className="input text-sm w-full"
                      min={0}
                      max={24}
                      step={0.25}
                      placeholder="0"
                      value={perUnitMonths[t] === 0 ? '' : perUnitMonths[t]}
                      onChange={e => setTypeMonths(t, Number(e.target.value) || 0)}
                      aria-label={`Months per unit ${ut.label}`}
                    />
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>


        {/* ── Monthly schedule grid ── */}
        {totalDuration > 0 && (
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

                  {/* Type column headers — shown once at top */}
                  <div className="grid gap-2 px-3 py-2 border-b border-slate-100 dark:border-slate-700/60 bg-slate-50/50 dark:bg-slate-800/20"
                    style={{ gridTemplateColumns: `repeat(${unitTypes.length}, 1fr)` }}>
                    {unitTypes.map((ut, t) => (
                      <span key={t} className="text-xs font-semibold text-slate-500 dark:text-slate-400 text-center tracking-wide uppercase">
                        {ut.label}
                      </span>
                    ))}
                  </div>

                  {/* Month rows: label+fill then inputs */}
                  <div className="divide-y divide-slate-100 dark:divide-slate-700/60">
                    {months.map(m => {
                      const idx = m - 1;
                      const isFirst = m === 1;
                      return (
                        <div key={m} className="px-3 py-2 space-y-1.5">
                          {/* Month label + fill button */}
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 tabular-nums uppercase tracking-wide">
                              Mo {m}
                            </span>
                            {isFirst && (
                              <button
                                type="button"
                                onClick={autoFillAll}
                                className="flex items-center gap-1 text-xs text-primary-600 dark:text-primary-400 hover:text-primary-700 font-medium touch-manipulation"
                                title="Auto-fill all columns evenly"
                                aria-label="Auto-fill schedule"
                              >
                                <Wand2 size={12} />
                                Fill
                              </button>
                            )}
                          </div>
                          {/* Inputs aligned under type headers */}
                          <div className="grid gap-2"
                            style={{ gridTemplateColumns: `repeat(${unitTypes.length}, 1fr)` }}>
                            {unitTypes.map((ut, t) => {
                              const val = scheduleByType[t]?.[idx] ?? 0;
                              return (
                                <input key={t}
                                  type="number"
                                  className="input text-base px-1 py-1 text-center w-full"
                                  min={0}
                                  placeholder="0"
                                  value={val === 0 ? '' : val}
                                  onChange={e => updateCell(t, idx, Number(e.target.value) || 0)}
                                  aria-label={`Mo ${m} ${ut.label}`}
                                />
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ── Projection: per-year monthly breakdown ── */}
        {result && transitionYears.length > 0 && (
          <div className="space-y-1.5">
            {transitionYears.map(y => {
              const monthStart = (y - 1) * 12; // 0-based index into monthlyByType
              const monthsInYear = Array.from({ length: 12 }, (_, i) => monthStart + i);
              const yearTypeAnnuals = unitTypes.map((_, t) =>
                monthsInYear.reduce((s, mi) => s + (result.monthlyByType[t]?.[mi] ?? 0), 0)
              );
              const yearTotal = yearTypeAnnuals.reduce((a, b) => a + b, 0);
              const typeTargetAnnuals = unitTypes.map(ut => ut.count * ut.targetRent * 12);
              const isOpen = openYear === y;

              return (
                <div key={y} className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
                  {/* Year header — clickable accordion toggle */}
                  <button
                    type="button"
                    onClick={() => setOpenYear(isOpen ? null : y)}
                    className="w-full px-3 py-2 bg-slate-100 dark:bg-slate-700/50 flex items-center justify-between hover:bg-slate-200/60 dark:hover:bg-slate-700/80 transition-colors"
                  >
                    <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Year {y} — Rent Schedule</span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-amber-600 dark:text-amber-400 tabular-nums">{fmt$(yearTotal)}</span>
                      <svg
                        className={`w-3.5 h-3.5 text-slate-400 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
                        fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                  </button>

                  {isOpen && <div className="overflow-x-auto">
                    <table className="w-full text-xs min-w-[280px]">
                      <thead>
                        <tr className="border-b border-slate-100 dark:border-slate-700/60 bg-slate-50/50 dark:bg-slate-800/20">
                          <th className="px-3 py-1.5 text-left font-medium text-slate-400 dark:text-slate-500 w-10">Mo</th>
                          {unitTypes.map((ut, t) => (
                            <th key={t} className="px-2 py-1.5 text-right font-semibold text-slate-600 dark:text-slate-300">{ut.label}</th>
                          ))}
                          <th className="px-3 py-1.5 text-right font-medium text-amber-600 dark:text-amber-400">Total/mo</th>
                        </tr>
                      </thead>
                      <tbody>
                        {monthsInYear.map((mi, i) => {
                          const moNum = monthStart + i + 1;
                          const typeRents = unitTypes.map((_, t) => result.monthlyByType[t]?.[mi] ?? 0);
                          const rowTotal = typeRents.reduce((a, b) => a + b, 0);
                          return (
                            <tr key={mi} className="border-t border-slate-50 dark:border-slate-700/40 hover:bg-slate-50/50 dark:hover:bg-slate-800/20">
                              <td className="px-3 py-1 text-slate-400 dark:text-slate-500 tabular-nums">Mo {moNum}</td>
                              {typeRents.map((rent, t) => (
                                <td key={t} className={`px-2 py-1 text-right tabular-nums ${rent === 0 ? 'text-red-400 dark:text-red-500' : 'text-slate-600 dark:text-slate-300'}`}>
                                  {rent === 0 ? '—' : fmt$(rent)}
                                </td>
                              ))}
                              <td className="px-3 py-1 text-right tabular-nums font-medium text-amber-600 dark:text-amber-400">
                                {rowTotal === 0 ? '—' : fmt$(rowTotal)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot>
                        {/* Annual total row */}
                        <tr className="border-t-2 border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-800/40">
                          <td className="px-3 py-2 text-xs font-semibold text-slate-500 dark:text-slate-400">Annual</td>
                          {yearTypeAnnuals.map((ann, t) => (
                            <td key={t} className="px-2 py-2 text-right tabular-nums font-semibold text-slate-700 dark:text-slate-200">{fmt$(ann)}</td>
                          ))}
                          <td className="px-3 py-2 text-right tabular-nums font-bold text-amber-600 dark:text-amber-400">{fmt$(yearTotal)}</td>
                        </tr>
                        {/* Target row */}
                        <tr className="border-t border-slate-100 dark:border-slate-700/60">
                          <td className="px-3 py-1.5 text-[11px] text-slate-400 dark:text-slate-500">Target</td>
                          {typeTargetAnnuals.map((tgt, t) => (
                            <td key={t} className="px-2 py-1.5 text-right tabular-nums text-emerald-600 dark:text-emerald-400">{fmt$(tgt)}</td>
                          ))}
                          <td className="px-3 py-1.5 text-right tabular-nums text-emerald-600 dark:text-emerald-400 font-medium">{fmt$(totalTargetAnnual)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>}
                </div>
              );
            })}
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
            onClick={() => {
              setTotalDuration(0);
              setRehabType('renovation');
              setUnitsToStabilize(unitTypes.map(() => 0));
              setPerUnitMonths(unitTypes.map(() => 0));
              setScheduleByType(unitTypes.map(() => []));
              setOpenYear(null);
            }}
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
      )}
    </div>
  );
}
