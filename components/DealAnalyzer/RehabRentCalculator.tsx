'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import { Zap, X, Wand2, ChevronDown, ChevronUp } from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface LocalRent {
  inPlace: number;
  target: number;
}

export interface CalcPersistedState {
  mode: 'renovate' | 'stabilize' | 'manual';
  totalDuration: number;
  unitsToStabilize: number[];
  perUnitMonths: number[];
  scheduleByType: number[][];
  manualDuration: number;
  manualPreStabRents: number[];
  localRents: LocalRent[];
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
  monthlyByType: number[][];
}

// ── Simulation ─────────────────────────────────────────────────────────────────

export function simulateFromSchedule(
  unitTypes: UnitTypeInput[],
  scheduleByType: number[][],
  perUnitMonthsByType: number[],
  totalYears: number
): SimulationResult {
  const totalMonths = totalYears * 12;

  const completionsByType: Map<number, number>[] = unitTypes.map(() => new Map());
  const partialRentByType: Map<number, number>[] = unitTypes.map(() => new Map());

  for (let t = 0; t < unitTypes.length; t++) {
    const sched       = scheduleByType[t] ?? [];
    const offline     = perUnitMonthsByType[t] ?? 0;
    const offlineFull = Math.floor(offline);
    const offlineFrac = offline - offlineFull;

    for (let i = 0; i < sched.length; i++) {
      const count = sched[i];
      if (count === 0) continue;
      const startMonth = i + 1;
      if (offlineFrac === 0) {
        const doneMonth = startMonth + offlineFull;
        completionsByType[t].set(doneMonth, (completionsByType[t].get(doneMonth) ?? 0) + count);
      } else {
        const partialMonth = startMonth + offlineFull;
        const doneMonth    = partialMonth + 1;
        completionsByType[t].set(doneMonth, (completionsByType[t].get(doneMonth) ?? 0) + count);
        const partialRent  = (1 - offlineFrac) * (unitTypes[t]?.targetRent ?? 0) * count;
        partialRentByType[t].set(partialMonth, (partialRentByType[t].get(partialMonth) ?? 0) + partialRent);
      }
    }
  }

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
  onApplyRents?: (rents: LocalRent[]) => void;
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
  onApplyRents,
  onOpenChange,
  grossRentGrowthPct = 0,
  initialState,
  onStateChange,
}: RehabRentCalculatorProps) {
  const setOpen = (v: boolean) => { onOpenChange?.(v); };

  const isApplied = Object.keys(appliedYears).length > 0;

  // ── Mode ──
  const [mode, setMode] = useState<'renovate' | 'stabilize' | 'manual'>(() => {
    const s = initialState?.mode;
    if (!s || (s as string) === 'calculator') return 'renovate';
    return s;
  });

  // ── Local rents (in-place + target per type) — entered inside the calculator ──
  const [localRents, setLocalRents] = useState<LocalRent[]>(() => {
    if (initialState?.localRents?.length === unitTypes.length) return initialState.localRents;
    return unitTypes.map(ut => ({ inPlace: ut.inPlaceRent, target: ut.targetRent }));
  });

  const setLocalRent = (t: number, field: keyof LocalRent, val: number) =>
    setLocalRents(prev => prev.map((r, i) => i === t ? { ...r, [field]: val } : r));

  // Effective unit types used for simulation — merges local rent inputs
  const effectiveUnitTypes = useMemo(
    () => unitTypes.map((ut, t) => ({
      ...ut,
      inPlaceRent: localRents[t]?.inPlace ?? ut.inPlaceRent,
      targetRent:  localRents[t]?.target  ?? ut.targetRent,
    })),
    [unitTypes, localRents]
  );

  const hasRentData = effectiveUnitTypes.some(t => t.targetRent > 0);

  // ── Calculator state ──
  const [totalDuration, setTotalDuration]       = useState(() => initialState?.totalDuration ?? 0);
  const [unitsToStabilize, setUnitsToStabilize] = useState<number[]>(() => initialState?.unitsToStabilize ?? unitTypes.map(() => 0));
  const [perUnitMonths, setPerUnitMonths]       = useState<number[]>(() => initialState?.perUnitMonths ?? unitTypes.map(() => 0));
  const [scheduleByType, setScheduleByType]     = useState<number[][]>(() => initialState?.scheduleByType ?? unitTypes.map(() => []));
  const [openYear, setOpenYear]                 = useState<number | null>(null);

  // ── Manual mode state ──
  const [manualDuration, setManualDuration]         = useState(() => initialState?.manualDuration ?? 0);
  const [manualPreStabRents, setManualPreStabRents] = useState<number[]>(() => initialState?.manualPreStabRents ?? unitTypes.map(() => 0));

  useEffect(() => {
    onStateChange?.({ mode, totalDuration, unitsToStabilize, perUnitMonths, scheduleByType, manualDuration, manualPreStabRents, localRents });
  }, [mode, totalDuration, unitsToStabilize, perUnitMonths, scheduleByType, manualDuration, manualPreStabRents, localRents]); // eslint-disable-line react-hooks/exhaustive-deps

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
    setLocalRents(unitTypes.map(ut => ({ inPlace: ut.inPlaceRent, target: ut.targetRent })));
  }, [unitTypes.length]);

  useEffect(() => {
    setScheduleByType(prev =>
      unitTypes.map((_, t) =>
        Array.from({ length: totalDuration }, (_, i) => prev[t]?.[i] ?? 0)
      )
    );
  }, [totalDuration, unitTypes.length]);

  const offlineMonths = (t: number) => mode === 'stabilize' ? 0 : (perUnitMonths[t] ?? 0);

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
    setScheduleByType(
      unitTypes.map((_, t) => {
        const n = unitsToStabilize[t];
        if (n === 0 || totalDuration === 0) return Array(totalDuration).fill(0);
        return evenDistribute(n, totalDuration);
      })
    );
  };

  const result = useMemo<SimulationResult | null>(() => {
    if (!hasRentData || !scheduleValid) return null;
    return simulateFromSchedule(
      effectiveUnitTypes,
      scheduleByType,
      unitTypes.map((_, t) => offlineMonths(t)),
      Math.max(projectionYears, 2)
    );
  }, [effectiveUnitTypes, scheduleByType, mode, perUnitMonths, projectionYears, hasRentData, scheduleValid]);

  const transitionYears = useMemo(() => {
    if (!result) return [];
    const stabYear = Math.ceil(result.stabilizationMonth / 12);
    return Array.from({ length: Math.min(stabYear, projectionYears) }, (_, i) => i + 1);
  }, [result, projectionYears]);

  const totalTargetAnnual = useMemo(
    () => effectiveUnitTypes.reduce((s, t) => s + t.count * t.targetRent, 0) * 12,
    [effectiveUnitTypes]
  );

  const blendedMonthlyByType = useMemo(() => {
    if (!result || transitionYears.length === 0) return unitTypes.map(() => 0);
    return effectiveUnitTypes.map((ut, t) => {
      const transitionMonths = Math.min(result.stabilizationMonth, transitionYears.length * 12);
      if (transitionMonths === 0 || ut.count === 0) return 0;
      const totalRent = result.monthlyByType[t]?.slice(0, transitionMonths).reduce((s, r) => s + r, 0) ?? 0;
      return totalRent / transitionMonths / ut.count;
    });
  }, [result, transitionYears, effectiveUnitTypes]);

  const yearGroups = useMemo(() => groupByYear(totalDuration), [totalDuration]);

  const clearCalc = () => {
    setTotalDuration(0);
    setUnitsToStabilize(unitTypes.map(() => 0));
    setPerUnitMonths(unitTypes.map(() => 0));
    setScheduleByType(unitTypes.map(() => []));
    setOpenYear(null);
  };

  if (unitTypes.length === 0) return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/30 px-3.5 py-3 flex items-center gap-2">
      <Zap size={14} className="text-slate-300 dark:text-slate-600 shrink-0" />
      <span className="text-sm text-slate-400 dark:text-slate-500">Add unit types to use the calculator</span>
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
            Rent Calculator
          </span>
          {isApplied && (
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400">
              Applied
            </span>
          )}
        </div>
        <button type="button" onClick={() => setOpen(false)}
          className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
          aria-label="Close calculator">
          <X size={14} />
          <span className="hidden sm:inline">Close</span>
        </button>
      </div>

      {/* ── Mode switcher ── */}
      <div className="px-3.5 pb-3">
        <div className="flex rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden text-xs font-medium">
          {(['renovate', 'stabilize', 'manual'] as const).map((m, i) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`flex-1 py-2 transition-colors ${i > 0 ? 'border-l border-slate-200 dark:border-slate-700' : ''} ${
                mode === m
                  ? 'bg-primary-600 text-white'
                  : 'text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700/40'
              }`}
            >
              {m === 'renovate' ? 'Renovate' : m === 'stabilize' ? 'Stabilize' : 'Enter My Numbers'}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[11px] text-slate-400 dark:text-slate-500">
          {mode === 'renovate' && 'Units go offline during renovation, then earn target rent.'}
          {mode === 'stabilize' && 'Units flip to target rent immediately — no vacancy.'}
          {mode === 'manual' && 'Enter your own pre-stab rent and duration directly.'}
        </p>
      </div>

      {/* ── Rents per unit type ── */}
      <div className="border-t border-slate-200 dark:border-slate-700">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-slate-50 dark:bg-slate-700/40">
              <th className="px-3 py-2 text-left font-medium text-slate-500 dark:text-slate-400">Unit Type</th>
              <th className="px-3 py-2 text-right font-medium text-slate-500 dark:text-slate-400">In-Place</th>
              <th className="px-3 py-2 text-right font-medium text-slate-500 dark:text-slate-400">Target</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
            {unitTypes.map((ut, t) => (
              <tr key={t}>
                <td className="px-3 py-2 font-medium text-slate-600 dark:text-slate-300 whitespace-nowrap">
                  {ut.label}
                  <span className="ml-1 font-normal text-slate-400">×{ut.count}</span>
                </td>
                <td className="px-2 py-1.5">
                  <div className="relative">
                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400">$</span>
                    <input
                      type="number" min={0} placeholder="0"
                      className="input text-xs pl-5 pr-1 text-right w-full"
                      value={localRents[t]?.inPlace === 0 ? '' : (localRents[t]?.inPlace ?? '')}
                      onChange={e => setLocalRent(t, 'inPlace', Number(e.target.value) || 0)}
                      aria-label={`In-place rent ${ut.label}`}
                    />
                  </div>
                </td>
                <td className="px-2 py-1.5">
                  <div className="relative">
                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400">$</span>
                    <input
                      type="number" min={0} placeholder="0"
                      className="input text-xs pl-5 pr-1 text-right w-full"
                      value={localRents[t]?.target === 0 ? '' : (localRents[t]?.target ?? '')}
                      onChange={e => setLocalRent(t, 'target', Number(e.target.value) || 0)}
                      aria-label={`Target rent ${ut.label}`}
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Manual entry mode ── */}
      {mode === 'manual' && (
        <div className="px-3.5 pb-4 space-y-4 border-t border-slate-200 dark:border-slate-700 pt-4">
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

          <div className="space-y-2">
            <label className="text-xs font-medium text-slate-500 dark:text-slate-400 block">
              Effective pre-stab rent ($/mo per unit)
            </label>
            {effectiveUnitTypes.map((ut, t) => (
              <div key={t} className="flex items-center gap-3">
                <span className="text-xs font-medium text-slate-600 dark:text-slate-300 w-20 shrink-0">{ut.label}</span>
                <div className="flex-1 relative">
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400">$</span>
                  <input
                    type="number"
                    className="input text-sm pl-6"
                    min={0}
                    placeholder={ut.targetRent > 0 ? `target ${ut.targetRent}` : '0'}
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

          {manualDuration > 0 && manualPreStabRents.some(r => r > 0) && (
            <div className="rounded-lg bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 px-3 py-2.5 space-y-1">
              <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Pre-stab rent / year</p>
              {Array.from({ length: Math.ceil(manualDuration / 12) }, (_, yi) => {
                const y = yi + 1;
                const stabMonths = Math.min(12, manualDuration - yi * 12);
                const targetMonths = 12 - stabMonths;
                const preStabMonthly = effectiveUnitTypes.reduce((s, ut, t) => s + (manualPreStabRents[t] ?? 0) * ut.count, 0);
                const targetMonthly  = effectiveUnitTypes.reduce((s, ut) => s + ut.targetRent * ut.count, 0);
                const yearTotal = preStabMonthly * stabMonths + targetMonthly * targetMonths;
                return (
                  <div key={y} className="flex justify-between text-xs">
                    <span className="text-slate-500 dark:text-slate-400">Year {y}</span>
                    <span className="text-amber-600 dark:text-amber-400 tabular-nums font-medium">{fmt$(yearTotal)}/yr</span>
                  </div>
                );
              })}
            </div>
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={manualDuration === 0 || manualPreStabRents.every(r => r === 0)}
              onClick={() => {
                const transYears = Math.ceil(manualDuration / 12);
                const preStabMonthly = effectiveUnitTypes.reduce((s, ut, t) => s + (manualPreStabRents[t] ?? 0) * ut.count, 0);
                const targetMonthly  = effectiveUnitTypes.reduce((s, ut) => s + ut.targetRent * ut.count, 0);
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
                onApplyRents?.(localRents);
                if (onApplyPreStab) onApplyPreStab(manualPreStabRents);
                setOpen(false);
              }}
              className="flex-1 py-2 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-40 text-white text-sm font-medium transition-colors"
            >
              Apply to Pro Forma
            </button>
            <button
              type="button"
              onClick={() => { setManualDuration(0); setManualPreStabRents(unitTypes.map(() => 0)); }}
              className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-sm text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700/40 transition-colors"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {/* ── Renovate / Stabilize modes ── */}
      {(mode === 'renovate' || mode === 'stabilize') && (
        <div className="px-3.5 pb-4 space-y-5 border-t border-slate-200 dark:border-slate-700 pt-4">

          {/* ── Step 1: Units per type ── */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">
              Step 1 — Units to {mode === 'renovate' ? 'renovate' : 'stabilize'}
            </p>
            {unitTypes.map((ut, t) => (
              <div key={t} className="rounded-lg border border-slate-200 dark:border-slate-700 p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                    {ut.label} <span className="font-normal text-slate-400">({ut.count} total)</span>
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
                <div className={`grid gap-3 ${mode === 'renovate' ? 'grid-cols-2' : 'grid-cols-1'}`}>
                  <div>
                    <label className="text-[11px] text-slate-400 dark:text-slate-500 block mb-1">
                      Units (of {ut.count})
                    </label>
                    <input
                      type="number"
                      className="input text-sm w-full"
                      min={0}
                      max={ut.count}
                      placeholder="0"
                      value={unitsToStabilize[t] === 0 ? '' : unitsToStabilize[t]}
                      onChange={e => setTypeUnits(t, Number(e.target.value) || 0)}
                      aria-label={`Units to ${mode} ${ut.label}`}
                    />
                  </div>
                  {mode === 'renovate' && (
                    <div>
                      <label className="text-[11px] text-slate-400 dark:text-slate-500 block mb-1">
                        Months offline / unit
                      </label>
                      <input
                        type="number"
                        className="input text-sm w-full"
                        min={0}
                        max={24}
                        step={0.25}
                        placeholder="e.g. 1.5"
                        value={perUnitMonths[t] === 0 ? '' : perUnitMonths[t]}
                        onChange={e => setTypeMonths(t, Number(e.target.value) || 0)}
                        aria-label={`Months offline per unit ${ut.label}`}
                      />
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* ── Step 2: Total duration ── */}
          {someTypeScheduled && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                Step 2 — Total {mode === 'renovate' ? 'renovation' : 'stabilization'} duration (months)
              </p>
              <input
                type="number"
                className="input text-sm"
                min={1}
                max={projectionYears * 12}
                placeholder="e.g. 12"
                value={totalDuration === 0 ? '' : totalDuration}
                onChange={e => setTotalDuration(Math.min(projectionYears * 12, Number(e.target.value) || 0))}
                aria-label="Total duration months"
              />
            </div>
          )}

          {/* ── Step 3: Schedule ── */}
          {someTypeScheduled && totalDuration > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                  Step 3 — Schedule
                </p>
                <button
                  type="button"
                  onClick={autoFillAll}
                  className="flex items-center gap-1 text-xs text-primary-600 dark:text-primary-400 hover:text-primary-700 font-medium touch-manipulation"
                  title="Distribute units evenly across months"
                  aria-label="Auto-fill schedule"
                >
                  <Wand2 size={12} />
                  Auto-fill
                </button>
              </div>
              <p className="text-[11px] text-slate-400 dark:text-slate-500">
                Enter how many units start each month, or use Auto-fill to distribute evenly.
              </p>

              {yearGroups.map((months, yi) => {
                const yearTotals = unitTypes.map((_, t) =>
                  months.reduce((s, m) => s + (scheduleByType[t]?.[m - 1] ?? 0), 0)
                );
                return (
                  <div key={yi} className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
                    <div className="px-3 py-1.5 bg-slate-100 dark:bg-slate-700/50 flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Year {yi + 1}</span>
                      <div className="flex gap-3">
                        {unitTypes.map((ut, t) => yearTotals[t] > 0 && (
                          <span key={t} className="text-[11px] text-slate-400">{ut.label}: {yearTotals[t]}</span>
                        ))}
                      </div>
                    </div>

                    {unitTypes.length > 1 && (
                      <div className="grid gap-2 px-3 py-2 border-b border-slate-100 dark:border-slate-700/60 bg-slate-50/50 dark:bg-slate-800/20"
                        style={{ gridTemplateColumns: `5rem repeat(${unitTypes.length}, 1fr)` }}>
                        <span />
                        {unitTypes.map((ut, t) => (
                          <span key={t} className="text-xs font-semibold text-slate-500 dark:text-slate-400 text-center tracking-wide uppercase">
                            {ut.label}
                          </span>
                        ))}
                      </div>
                    )}

                    <div className="divide-y divide-slate-100 dark:divide-slate-700/60">
                      {months.map(m => {
                        const idx = m - 1;
                        return (
                          <div key={m} className="px-3 py-2">
                            <div className="grid gap-2 items-center"
                              style={{ gridTemplateColumns: `5rem repeat(${unitTypes.length}, 1fr)` }}>
                              <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 tabular-nums">Mo {m}</span>
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

              {!scheduleValid && someTypeScheduled && totalDuration > 0 &&
                unitTypes.some((_, t) => unitsToStabilize[t] > 0 && scheduleTotals[t] !== unitsToStabilize[t]) && (
                <p className="text-[11px] text-amber-500">
                  Schedule totals must match unit targets before applying.
                </p>
              )}
            </div>
          )}

          {/* ── Results: pre-stab rent per year ── */}
          {result && transitionYears.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                Pre-stab rent / year
              </p>
              <div className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
                {transitionYears.map(y => {
                  const yearTotal = result.yearlyRents[y - 1];
                  const isOpen = openYear === y;
                  const monthStart = (y - 1) * 12;
                  const monthsInYear = Array.from({ length: 12 }, (_, i) => monthStart + i);
                  const yearTypeAnnuals = unitTypes.map((_, t) =>
                    monthsInYear.reduce((s, mi) => s + (result.monthlyByType[t]?.[mi] ?? 0), 0)
                  );
                  const typeTargetAnnuals = effectiveUnitTypes.map(ut => ut.count * ut.targetRent * 12);

                  return (
                    <div key={y} className="border-t border-slate-100 dark:border-slate-700/60 first:border-t-0">
                      <button
                        type="button"
                        onClick={() => setOpenYear(isOpen ? null : y)}
                        className="w-full px-3 py-2.5 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors"
                      >
                        <span className="text-sm font-semibold text-slate-600 dark:text-slate-300">Year {y}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-amber-600 dark:text-amber-400 tabular-nums">{fmt$(yearTotal)}/yr</span>
                          {isOpen ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
                        </div>
                      </button>

                      {isOpen && (
                        <div className="overflow-x-auto border-t border-slate-100 dark:border-slate-700/60">
                          <table className="w-full text-xs min-w-[280px]">
                            <thead>
                              <tr className="bg-slate-50/50 dark:bg-slate-800/20">
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
                              <tr className="border-t-2 border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-800/40">
                                <td className="px-3 py-2 text-xs font-semibold text-slate-500 dark:text-slate-400">Annual</td>
                                {yearTypeAnnuals.map((ann, t) => (
                                  <td key={t} className="px-2 py-2 text-right tabular-nums font-semibold text-slate-700 dark:text-slate-200">{fmt$(ann)}</td>
                                ))}
                                <td className="px-3 py-2 text-right tabular-nums font-bold text-amber-600 dark:text-amber-400">{fmt$(yearTotal)}</td>
                              </tr>
                              <tr className="border-t border-slate-100 dark:border-slate-700/60">
                                <td className="px-3 py-1.5 text-[11px] text-slate-400 dark:text-slate-500">Target</td>
                                {typeTargetAnnuals.map((tgt, t) => (
                                  <td key={t} className="px-2 py-1.5 text-right tabular-nums text-emerald-600 dark:text-emerald-400">{fmt$(tgt)}</td>
                                ))}
                                <td className="px-3 py-1.5 text-right tabular-nums text-emerald-600 dark:text-emerald-400 font-medium">{fmt$(totalTargetAnnual)}</td>
                              </tr>
                            </tfoot>
                          </table>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <p className="text-[11px] text-slate-400 dark:text-slate-500">
                Fully stabilized by month {result.stabilizationMonth}
                {result.stabilizationMonth <= projectionYears * 12
                  ? ` (Year ${Math.ceil(result.stabilizationMonth / 12)})`
                  : ' — beyond projection window'}
              </p>
            </div>
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
                onApplyRents?.(localRents);
                if (onApplyPreStab) onApplyPreStab(blendedMonthlyByType);
                setOpen(false);
              }}
              className="flex-1 py-2 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-40 text-white text-sm font-medium transition-colors"
            >
              Apply to Pro Forma
            </button>
            <button
              type="button"
              onClick={clearCalc}
              className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-sm text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700/40 transition-colors"
            >
              Clear
            </button>
          </div>

        </div>
      )}
    </div>
  );
}
