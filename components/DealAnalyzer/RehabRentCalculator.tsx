'use client';

import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { Zap, X, Check } from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────────────────

import type { CalcPersistedState, CalcLocalRent as LocalRent } from '@/types';
export type { CalcPersistedState };
export type { CalcLocalRent as LocalRent } from '@/types';

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
  /** 12-month histogram: units reaching target rent per month (for loss-to-lease model) */
  anniversaryDistribution: number[];
  /**
   * Per-unit-type anniversary distribution. Each entry pairs the type's target
   * rent with its own 12-month renewal histogram. Enables accurate per-type
   * Year 2+ LTL when unit types have different rents.
   */
  anniversaryByType: { targetRent: number; distribution: number[] }[];
}

// ── Simulation ─────────────────────────────────────────────────────────────────

export function simulateFromSchedule(
  unitTypes: UnitTypeInput[],
  scheduleByType: number[][],
  leaseUpScheduleByType: number[][],
  perUnitMonthsByType: number[],
  totalYears: number
): SimulationResult {
  const totalMonths = totalYears * 12;

  const completionsByType: Map<number, number>[] = unitTypes.map(() => new Map());
  const partialRentByType: Map<number, number>[] = unitTypes.map(() => new Map());

  const leaseUpFlipsByType: Map<number, number>[] = unitTypes.map(() => new Map());

  for (let t = 0; t < unitTypes.length; t++) {
    const leaseUpSched = leaseUpScheduleByType[t] ?? [];
    for (let i = 0; i < leaseUpSched.length; i++) {
      const count = leaseUpSched[i];
      if (count === 0) continue;
      const flipMonth = i + 1; // lease-up units flip to target AT this month
      leaseUpFlipsByType[t].set(flipMonth, (leaseUpFlipsByType[t].get(flipMonth) ?? 0) + count);
    }
  }

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
    const scheduledReno = (scheduleByType[t] ?? []).reduce((s, n) => s + n, 0);
    const scheduledLeaseUp = (leaseUpScheduleByType[t] ?? []).reduce((s, n) => s + n, 0);
    return Math.max(0, ut.count - scheduledReno - scheduledLeaseUp);
  });

  // Track reno completions separately so inRenovation is independent of lease-up flips
  const renoCompletedByType = unitTypes.map(() => 0);

  const monthly: number[] = [];
  const monthlyByType: number[][] = unitTypes.map(() => []);

  for (let m = 1; m <= totalMonths; m++) {
    let monthRent = 0;
    for (let t = 0; t < unitTypes.length; t++) {
      const ut = unitTypes[t];
      const sched = scheduleByType[t] ?? [];

      renoCompletedByType[t] += completionsByType[t].get(m) ?? 0;
      stableByType[t] += completionsByType[t].get(m) ?? 0;
      stableByType[t] += leaseUpFlipsByType[t].get(m) ?? 0;

      const startedSoFar = sched.slice(0, m).reduce((s, n) => s + n, 0);
      const inRenovation = Math.max(0, startedSoFar - renoCompletedByType[t]);
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

  // Stabilization month = the latest month any unit becomes stable (reno complete or lease-up flip).
  // For reno, that's lastStartMonth + offline. For lease-up, it's the lastFlipMonth.
  // Using `sched.length` (= totalDuration) was a bug — it inflated stabMonth by the unused tail
  // of the schedule, pushing transitionYears to include years where everything is already stable.
  let maxStabMonth = 0;
  for (let t = 0; t < unitTypes.length; t++) {
    const sched = scheduleByType[t] ?? [];
    let lastRenoStart = -1;
    for (let i = sched.length - 1; i >= 0; i--) {
      if ((sched[i] ?? 0) > 0) { lastRenoStart = i + 1; break; } // 1-indexed start month
    }
    if (lastRenoStart > 0) {
      maxStabMonth = Math.max(maxStabMonth, Math.ceil(lastRenoStart + (perUnitMonthsByType[t] ?? 0)));
    }

    const leaseUpSched = leaseUpScheduleByType[t] ?? [];
    let lastLeaseUpFlip = -1;
    for (let i = leaseUpSched.length - 1; i >= 0; i--) {
      if ((leaseUpSched[i] ?? 0) > 0) { lastLeaseUpFlip = i + 1; break; }
    }
    if (lastLeaseUpFlip > 0) {
      maxStabMonth = Math.max(maxStabMonth, lastLeaseUpFlip);
    }
  }

  // Build anniversary distributions: 12-month histograms of when units first reach target rent.
  // - Combined histogram (anniversaryDist) for backward compatibility / blended views.
  // - Per-type histograms (anniversaryByType) so the projector can compute Year 2+ LTL
  //   without blending different unit types' rents.
  const anniversaryDist = new Array(12).fill(0);
  const anniversaryByType: { targetRent: number; distribution: number[] }[] = unitTypes.map(ut => ({
    targetRent: ut.targetRent,
    distribution: new Array(12).fill(0),
  }));

  for (let t = 0; t < unitTypes.length; t++) {
    const ut = unitTypes[t];
    const scheduledReno = (scheduleByType[t] ?? []).reduce((s, n) => s + n, 0);
    const scheduledLeaseUp = (leaseUpScheduleByType[t] ?? []).reduce((s, n) => s + n, 0);
    const initialStable = Math.max(0, ut.count - scheduledReno - scheduledLeaseUp);

    // Stable units (already at target) → month 1
    anniversaryDist[0] += initialStable;
    anniversaryByType[t].distribution[0] += initialStable;

    // Reno completions → completion month
    completionsByType[t].forEach((count, month) => {
      const idx = Math.min(11, Math.max(0, month - 1));
      anniversaryDist[idx] += count;
      anniversaryByType[t].distribution[idx] += count;
    });

    // Lease-up flips → flip month
    leaseUpFlipsByType[t].forEach((count, month) => {
      const idx = Math.min(11, Math.max(0, month - 1));
      anniversaryDist[idx] += count;
      anniversaryByType[t].distribution[idx] += count;
    });
  }

  return { yearlyRents, stabilizationMonth: maxStabMonth, monthlyByType, anniversaryDistribution: anniversaryDist, anniversaryByType };
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

/** Evenly distribute n units across dur months (used within each phase). */
function evenDistribute(n: number, dur: number): number[] {
  if (n === 0 || dur === 0) return Array(Math.max(dur, 0)).fill(0);
  const result = Array(dur).fill(0);
  let placed = 0;
  for (let i = 0; i < dur; i++) {
    const target = Math.round(n * (i + 1) / dur);
    result[i] = target - placed;
    placed = target;
  }
  return result;
}

/**
 * Weighted Distribution — S-curve model:
 *   First 33%  of months → 20% of units  (slow start)
 *   Middle 33% of months → 50% of units  (peak production)
 *   Final 33%  of months → 30% of units  (finishing stretch)
 *
 * Uses cumulative rounding so p1+p2+p3 always equals n exactly,
 * regardless of unit count. Zero-duration phases roll units forward.
 */
function weightedDistribute(n: number, dur: number): number[] {
  if (n === 0 || dur === 0) return Array(Math.max(dur, 0)).fill(0);

  const p1End = Math.floor(dur / 3);
  const p2End = Math.floor(dur * 2 / 3);
  const p1Dur = p1End;
  const p2Dur = p2End - p1End;
  const p3Dur = dur - p2End;

  // Cumulative rounding: compute units at each phase boundary so totals always sum to n
  const cumAfter1 = Math.round(n * 0.20);
  const cumAfter2 = Math.round(n * 0.70);
  let p1Units = cumAfter1;
  let p2Units = Math.max(0, cumAfter2 - cumAfter1);
  let p3Units = Math.max(0, n - cumAfter2);

  // Roll units forward when a phase has no months
  if (p1Dur === 0) { p2Units += p1Units; p1Units = 0; }
  if (p2Dur === 0) { p3Units += p2Units; p2Units = 0; }
  // Final safety: guarantee sum = n
  p3Units = n - p1Units - p2Units;

  const result = Array(dur).fill(0);
  if (p1Dur > 0) { const s = evenDistribute(p1Units, p1Dur); for (let i = 0; i < p1Dur; i++) result[i] = s[i]; }
  if (p2Dur > 0) { const s = evenDistribute(p2Units, p2Dur); for (let i = 0; i < p2Dur; i++) result[p1End + i] = s[i]; }
  if (p3Dur > 0) { const s = evenDistribute(p3Units, p3Dur); for (let i = 0; i < p3Dur; i++) result[p2End + i] = s[i]; }

  return result;
}

function computeScheduleByMethod(units: number[], dur: number): number[][] {
  return units.map(n => (n === 0 || dur === 0) ? Array(Math.max(dur, 0)).fill(0) : weightedDistribute(n, dur));
}

// ── Component ──────────────────────────────────────────────────────────────────

interface RehabRentCalculatorProps {
  unitTypes: UnitTypeInput[];
  projectionYears: number;
  appliedYears: Record<number, number>;
  onApply: (
    overrides: Record<number, number>,
    anniversaryDistribution?: number[],
    anniversaryByType?: { targetRent: number; distribution: number[] }[],
  ) => void;
  onClear: () => void;
  onApplyPreStab?: (values: number[]) => void;
  onApplyRents?: (rents: LocalRent[]) => void;
  onOpenChange?: (v: boolean) => void;
  grossRentGrowthPct?: number;
  initialState?: CalcPersistedState;
  onStateChange?: (state: CalcPersistedState) => void;
  externalDuration?: number;
  externalOffline?: number;
  externalUnitsToStabilize?: number[];
  externalLeaseUpToStabilize?: number[];
  externalDistributionMethod?: 'weighted' | 'custom';
  hideHeader?: boolean;
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
  externalDuration,
  externalOffline,
  externalUnitsToStabilize,
  externalLeaseUpToStabilize,
  externalDistributionMethod,
  hideHeader,
}: RehabRentCalculatorProps) {
  const setOpen = (v: boolean) => { onOpenChange?.(v); };

  const isApplied = Object.keys(appliedYears).length > 0;

  // ── Mode ── (always renovate; manual mode handled by parent)
  const [mode] = useState<'renovate' | 'stabilize' | 'manual'>('renovate');

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
  const [leaseUpToStabilize, setLeaseUpToStabilize] = useState<number[]>(() => initialState?.leaseUpToStabilize ?? unitTypes.map(() => 0));
  const [leaseUpScheduleByType, setLeaseUpScheduleByType] = useState<number[][]>(() => initialState?.leaseUpScheduleByType ?? unitTypes.map(() => []));
  type DistributionMethod = 'weighted' | 'custom';
  const [distributionMethod, setDistributionMethod] = useState<DistributionMethod>(() => {
    if (initialState?.distributionMethod === 'custom') return 'custom';
    // Backward compat: if a saved manual schedule exists, default to custom
    const hasManualSchedule =
      initialState?.scheduleByType?.some(s => s.some(n => n > 0)) ||
      initialState?.leaseUpScheduleByType?.some(s => s.some(n => n > 0));
    return hasManualSchedule ? 'custom' : 'weighted';
  });

  // ── Manual mode state ──
  const [manualDuration, setManualDuration]         = useState(() => initialState?.manualDuration ?? 0);
  const [manualPreStabRents, setManualPreStabRents] = useState<number[]>(() => initialState?.manualPreStabRents ?? unitTypes.map(() => 0));

  useEffect(() => {
    onStateChange?.({ mode, totalDuration, unitsToStabilize, perUnitMonths, scheduleByType, manualDuration, manualPreStabRents, localRents, leaseUpToStabilize, leaseUpScheduleByType, distributionMethod });
  }, [mode, totalDuration, unitsToStabilize, perUnitMonths, scheduleByType, manualDuration, manualPreStabRents, localRents, leaseUpToStabilize, leaseUpScheduleByType, distributionMethod]); // eslint-disable-line react-hooks/exhaustive-deps

  // Skip setAutoFilled(true) on the very first render so a saved manual schedule is preserved
  const hasMountedRef = useRef(false);
  useEffect(() => { hasMountedRef.current = true; }, []);

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
    setLeaseUpToStabilize(unitTypes.map(() => 0));
    setLeaseUpScheduleByType(unitTypes.map(() => []));
    setLocalRents(unitTypes.map(ut => ({ inPlace: ut.inPlaceRent, target: ut.targetRent })));
    // Keep distributionMethod on unit type change
  }, [unitTypes.length]);

  useEffect(() => {
    if (externalDuration === undefined || externalDuration === totalDuration) return;
    setTotalDuration(externalDuration);
  }, [externalDuration]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (externalOffline === undefined) return;
    if (perUnitMonths.every(p => p === externalOffline)) return; // no change
    setPerUnitMonths(unitTypes.map(() => externalOffline));
  }, [externalOffline, unitTypes.length]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!externalUnitsToStabilize) return;
    const next = externalUnitsToStabilize.map((n, t) => Math.min(n, unitTypes[t]?.count ?? n));
    if (JSON.stringify(next) === JSON.stringify(unitsToStabilize)) return; // no change
    setUnitsToStabilize(next);
  }, [externalUnitsToStabilize]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!externalLeaseUpToStabilize) return;
    const next = externalLeaseUpToStabilize.map((n, t) => Math.min(n, unitTypes[t]?.count ?? n));
    if (JSON.stringify(next) === JSON.stringify(leaseUpToStabilize)) return; // no change
    setLeaseUpToStabilize(next);
  }, [externalLeaseUpToStabilize]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (externalDistributionMethod === undefined) return;
    if (externalDistributionMethod === distributionMethod) return; // no change
    if (externalDistributionMethod === 'custom') {
      // Clear weighted auto-fill when switching to custom
      setScheduleByType(unitTypes.map(() => Array(totalDuration).fill(0)));
      setLeaseUpScheduleByType(unitTypes.map(() => Array(totalDuration).fill(0)));
    }
    setDistributionMethod(externalDistributionMethod);
  }, [externalDistributionMethod]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync rent changes from the form back into localRents (bidirectional sync).
  // Echo-back guard: when the calculator pushes rents → form → unitTypes, the values
  // already match localRents so the functional update returns prev unchanged.
  useEffect(() => {
    setLocalRents(prev => {
      const updated = prev.map((r, t) => {
        const ut = unitTypes[t];
        if (!ut) return r;
        if (r.inPlace === ut.inPlaceRent && r.target === ut.targetRent) return r;
        return { inPlace: ut.inPlaceRent, target: ut.targetRent };
      });
      return updated.every((r, t) => r === prev[t]) ? prev : updated;
    });
  }, [unitTypes]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setScheduleByType(prev =>
      unitTypes.map((_, t) =>
        Array.from({ length: totalDuration }, (_, i) => prev[t]?.[i] ?? 0)
      )
    );
  }, [totalDuration, unitTypes.length]);

  useEffect(() => {
    setLeaseUpScheduleByType(prev =>
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

  const leaseUpScheduleTotals = useMemo(
    () => unitTypes.map((_, t) => (leaseUpScheduleByType[t] ?? []).reduce((s, n) => s + n, 0)),
    [leaseUpScheduleByType, unitTypes.length]
  );

  const someTypeScheduled = unitsToStabilize.some(u => u > 0);

  const someLeaseUpScheduled = leaseUpToStabilize.some(u => u > 0);

  const scheduleValid = useMemo(() =>
    totalDuration > 0 &&
    (someTypeScheduled || someLeaseUpScheduled) &&
    unitTypes.every((_, t) =>
      (unitsToStabilize[t] === 0 || scheduleTotals[t] === unitsToStabilize[t]) &&
      (leaseUpToStabilize[t] === 0 || leaseUpScheduleTotals[t] === leaseUpToStabilize[t])
    ),
    [totalDuration, someTypeScheduled, someLeaseUpScheduled, unitTypes, unitsToStabilize, scheduleTotals, leaseUpToStabilize, leaseUpScheduleTotals]
  );

  const setTypeUnits = (t: number, val: number) =>
    setUnitsToStabilize(prev => { const n = [...prev]; n[t] = Math.min(unitTypes[t].count, Math.max(0, val)); return n; });

  const setTypeMonths = (t: number, val: number) =>
    setPerUnitMonths(prev => { const n = [...prev]; n[t] = Math.min(24, Math.max(0, val)); return n; });

  const setLeaseUpUnits = (t: number, val: number) =>
    setLeaseUpToStabilize(prev => { const n = [...prev]; n[t] = Math.min(unitTypes[t].count, Math.max(0, val)); return n; });

  const updateCell = (t: number, monthIdx: number, val: number) => {
    setScheduleByType(prev => {
      const next = prev.map(s => [...s]);
      const otherSum = (next[t] ?? []).reduce((s, n, i) => i === monthIdx ? s : s + n, 0);
      const cap = unitsToStabilize[t] > 0 ? Math.max(0, unitsToStabilize[t] - otherSum) : val;
      next[t][monthIdx] = Math.min(Math.max(0, val), cap);
      return next;
    });
  };

  const updateLeaseUpCell = (t: number, monthIdx: number, val: number) => {
    setLeaseUpScheduleByType(prev => {
      const next = prev.map(s => [...s]);
      const otherSum = (next[t] ?? []).reduce((s, n, i) => i === monthIdx ? s : s + n, 0);
      const cap = leaseUpToStabilize[t] > 0 ? Math.max(0, leaseUpToStabilize[t] - otherSum) : val;
      next[t][monthIdx] = Math.min(Math.max(0, val), cap);
      return next;
    });
  };

  // Auto-recompute schedule whenever units or duration change (weighted mode only)
  useEffect(() => {
    if (distributionMethod === 'custom') return;
    setScheduleByType(computeScheduleByMethod(unitsToStabilize, totalDuration));
    setLeaseUpScheduleByType(computeScheduleByMethod(leaseUpToStabilize, totalDuration));
  }, [distributionMethod, unitsToStabilize, leaseUpToStabilize, totalDuration]); // eslint-disable-line react-hooks/exhaustive-deps


  const result = useMemo<SimulationResult | null>(() => {
    if (!hasRentData || !scheduleValid) return null;
    // Zero out stale reno schedule entries for types with no renovation units
    const cleanScheduleByType = scheduleByType.map((sched, t) =>
      unitsToStabilize[t] === 0 ? [] : sched
    );
    return simulateFromSchedule(
      effectiveUnitTypes,
      cleanScheduleByType,
      leaseUpScheduleByType,
      unitTypes.map((_, t) => offlineMonths(t)),
      Math.max(projectionYears, 2)
    );
  }, [effectiveUnitTypes, scheduleByType, leaseUpScheduleByType, unitsToStabilize, mode, perUnitMonths, projectionYears, hasRentData, scheduleValid]);

  const transitionYears = useMemo(() => {
    if (!result) return [];
    const stabYear = Math.ceil(result.stabilizationMonth / 12);
    return Array.from({ length: Math.min(stabYear, projectionYears) }, (_, i) => i + 1);
  }, [result, projectionYears]);

  const allYears = useMemo(
    () => Array.from({ length: projectionYears }, (_, i) => i + 1),
    [projectionYears]
  );

  const totalTargetAnnual = useMemo(
    () => effectiveUnitTypes.reduce((s, t) => s + t.count * t.targetRent, 0) * 12,
    [effectiveUnitTypes]
  );

  // Actual collected rent for any year, applying the anniversary model for Year 2+.
  // Year 1 comes from the monthly simulation (gradual lease-up rollover).
  // Year 2+ uses the anniversary distribution: each unit renews on its month,
  // earning prev rate before and new market rate after.
  const computeYearRent = useCallback((year: number): number => {
    if (!result) return 0;
    if (year === 1) return result.yearlyRents[0] ?? 0;
    const dist = result.anniversaryDistribution;
    const totalUnits = dist.reduce((s, n) => s + n, 0);
    if (totalUnits === 0 || totalTargetAnnual === 0) return 0;
    const perUnitTarget = totalTargetAnnual / totalUnits / 12;
    const growthRate = grossRentGrowthPct / 100;
    const marketRate = perUnitTarget * Math.pow(1 + growthRate, year - 1);
    const prevRate = perUnitTarget * Math.pow(1 + growthRate, year - 2);
    let actualRent = 0;
    for (let m = 0; m < 12; m++) {
      const units = dist[m] ?? 0;
      if (units === 0) continue;
      if (m === 0) {
        actualRent += units * marketRate * 12;
      } else {
        const oldMonths = m;
        const newMonths = 12 - m;
        actualRent += units * (prevRate * oldMonths + marketRate * newMonths);
      }
    }
    return actualRent;
  }, [result, totalTargetAnnual, grossRentGrowthPct]);

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

  // Auto-apply: whenever the simulation result changes, push to ProForma (or clear if invalid).
  // Callbacks are held in a ref so inline parent arrow functions don't retrigger the effect.
  const callbacksRef = useRef({ onApply, onClear, onApplyRents, onApplyPreStab });
  useEffect(() => {
    callbacksRef.current = { onApply, onClear, onApplyRents, onApplyPreStab };
  });
  const lastAppliedKeyRef = useRef('');
  useEffect(() => {
    if (!scheduleValid || !result) {
      if (lastAppliedKeyRef.current !== '') {
        lastAppliedKeyRef.current = '';
        callbacksRef.current.onClear();
      }
      return;
    }
    const overrides: Record<number, number> = {};
    transitionYears.forEach(y => { overrides[y] = result.yearlyRents[y - 1]; });
    // Note: we do NOT pin a "firstFullYear" override anymore. Post-stabilization rent
    // is governed by the anniversary model (LTL) via the projector — pinning it to
    // full market rate would force LTL to 0 for that year.
    const key = JSON.stringify({ overrides, dist: result.anniversaryDistribution, byType: result.anniversaryByType });
    if (key === lastAppliedKeyRef.current) return;
    lastAppliedKeyRef.current = key;
    callbacksRef.current.onApply(overrides, result.anniversaryDistribution, result.anniversaryByType);
    callbacksRef.current.onApplyRents?.(localRents);
    callbacksRef.current.onApplyPreStab?.(blendedMonthlyByType);
  }, [scheduleValid, result, transitionYears, localRents, blendedMonthlyByType]);

  const clearCalc = () => {
    setTotalDuration(0);
    setUnitsToStabilize(unitTypes.map(() => 0));
    setPerUnitMonths(unitTypes.map(() => 0));
    setScheduleByType(unitTypes.map(() => []));
    setLeaseUpToStabilize(unitTypes.map(() => 0));
    setLeaseUpScheduleByType(unitTypes.map(() => []));
    // distributionMethod is intentionally preserved on clear
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
      {!hideHeader && <div className="flex items-center justify-between px-3.5 py-3">
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
      </div>}


      {/* ── Months offline (shared, renovate mode only) ── */}
      {mode === 'renovate' && externalOffline === undefined && (
        <div className="px-3.5 py-3 border-t border-slate-200 dark:border-slate-700 flex items-center gap-3">
          <label className="text-xs font-medium text-slate-500 dark:text-slate-400 shrink-0">
            Months offline per unit
          </label>
          <input
            type="number" min={0} max={24} step={0.25} placeholder="e.g. 1.5"
            className="input text-sm w-28"
            value={perUnitMonths[0] === 0 ? '' : perUnitMonths[0]}
            onChange={e => {
              const v = Math.min(24, Math.max(0, Number(e.target.value) || 0));
              setPerUnitMonths(unitTypes.map(() => v));
            }}
            aria-label="Months offline per unit"
          />
        </div>
      )}

      {/* ── Renovate / Stabilize modes ── */}
      {(mode === 'renovate' || mode === 'stabilize') && (
        <div className="px-3.5 pb-4 space-y-5 border-t border-slate-200 dark:border-slate-700 pt-4">

          {/* ── Schedule ── */}
          {(someTypeScheduled || someLeaseUpScheduled) && totalDuration > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                  Schedule
                </p>
                {distributionMethod === 'custom' && unitTypes.length === 1 &&
                  (scheduleByType[0]?.some(v => v > 0) || leaseUpScheduleByType[0]?.some(v => v > 0)) && (
                  <button
                    type="button"
                    onClick={() => {
                      setScheduleByType(prev => prev.map((s, i) => i === 0 ? Array(totalDuration).fill(0) : s));
                      setLeaseUpScheduleByType(prev => prev.map((s, i) => i === 0 ? Array(totalDuration).fill(0) : s));
                    }}
                    className="text-[11px] text-slate-400 hover:text-red-500 dark:hover:text-red-400 transition-colors touch-manipulation"
                  >
                    Clear
                  </button>
                )}
              </div>
              {/* ── Distribution method toggle ── */}
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center rounded-lg border border-slate-200 dark:border-slate-700 p-0.5 bg-slate-100 dark:bg-slate-800/60">
                  {(['weighted', 'custom'] as const).map(m => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => {
                        if (m === 'custom') {
                          setScheduleByType(unitTypes.map(() => Array(totalDuration).fill(0)));
                          setLeaseUpScheduleByType(unitTypes.map(() => Array(totalDuration).fill(0)));
                        }
                        setDistributionMethod(m);
                      }}
                      className={`text-[11px] px-2 py-1 rounded-md font-medium transition-colors touch-manipulation ${
                        distributionMethod === m
                          ? 'bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 shadow-sm'
                          : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                      }`}
                    >
                      {m === 'weighted' ? 'Weighted Distribution' : 'Custom'}
                    </button>
                  ))}
                </div>
                {distributionMethod === 'custom' && (
                  <button
                    type="button"
                    onClick={() => setDistributionMethod('weighted')}
                    className="text-[11px] text-primary-600 dark:text-primary-400 hover:underline touch-manipulation"
                  >
                    Switch to weighted
                  </button>
                )}
              </div>
              {/* Method description */}
              <p className="text-[11px] text-slate-400 dark:text-slate-500">
                {distributionMethod === 'weighted'
                  ? 'First 33% of time → 20% of units (slow start) · Middle 33% → 50% (peak) · Final 33% → 30% (finishing stretch)'
                  : 'Enter exact units per month below — full control over the renovation pace'}
              </p>

              {/* Per-type status + actions — only for multi-type deals */}
              {unitTypes.length > 1 && (
                <div className="rounded-lg border border-slate-200 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-700/60 overflow-hidden">
                  {unitTypes.map((ut, t) => {
                    const renoTarget = unitsToStabilize[t];
                    const luTarget   = leaseUpToStabilize[t];
                    if (renoTarget === 0 && luTarget === 0) return null;
                    const renoOk = renoTarget === 0 || scheduleTotals[t] === renoTarget;
                    const luOk   = luTarget   === 0 || leaseUpScheduleTotals[t] === luTarget;
                    const allOk  = renoOk && luOk;
                    return (
                      <div key={t} className="px-3 py-2 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${allOk ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                          <span className="text-xs font-medium text-slate-600 dark:text-slate-300">{ut.label}</span>
                          <span className="text-[11px] text-slate-400 dark:text-slate-500">
                            {renoTarget > 0 && <span className={renoOk ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-500'}>R {scheduleTotals[t]}/{renoTarget}</span>}
                            {renoTarget > 0 && luTarget > 0 && ' · '}
                            {luTarget > 0 && <span className={luOk ? 'text-blue-600 dark:text-blue-400' : 'text-amber-500'}>L {leaseUpScheduleTotals[t]}/{luTarget}</span>}
                          </span>
                        </div>
                        {distributionMethod === 'custom' && (
                          <div className="flex items-center gap-2 shrink-0">
                            <button type="button"
                              onClick={() => {
                                setScheduleByType(prev => prev.map((s, i) => i === t ? Array(totalDuration).fill(0) : s));
                                setLeaseUpScheduleByType(prev => prev.map((s, i) => i === t ? Array(totalDuration).fill(0) : s));
                              }}
                              className="text-[11px] font-medium text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 touch-manipulation">
                              Clear
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {yearGroups.map((months, yi) => {
                const yearTotals = unitTypes.map((_, t) =>
                  months.reduce((s, m) => s + (scheduleByType[t]?.[m - 1] ?? 0), 0)
                );
                return (
                  <div key={yi} className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
                    <div className="px-3 py-1.5 bg-slate-100 dark:bg-slate-700/50 flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Year {yi + 1}</span>
                      <div className="flex gap-3">
                        {unitTypes.map((ut, t) => {
                          const renoScheduled = scheduleTotals[t];
                          const renoTarget = unitsToStabilize[t];
                          const leaseUpScheduled = leaseUpScheduleTotals[t];
                          const leaseUpTarget = leaseUpToStabilize[t];
                          if (renoTarget === 0 && leaseUpTarget === 0) return null;
                          return (
                            <span key={t} className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                              {ut.label}:
                              {renoTarget > 0 && (
                                <span className={` ml-1 ${renoScheduled > renoTarget ? 'text-red-500' : renoScheduled === renoTarget ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-500'}`}>
                                  R {renoScheduled}/{renoTarget}
                                </span>
                              )}
                              {leaseUpTarget > 0 && (
                                <span className={` ml-1 ${leaseUpScheduled > leaseUpTarget ? 'text-red-500' : leaseUpScheduled === leaseUpTarget ? 'text-blue-600 dark:text-blue-400' : 'text-amber-500'}`}>
                                  L {leaseUpScheduled}/{leaseUpTarget}
                                </span>
                              )}
                            </span>
                          );
                        })}
                      </div>
                    </div>

                    {unitTypes.length > 1 && (
                      <div className="grid gap-2 px-3 py-2 border-b border-slate-100 dark:border-slate-700/60 bg-slate-50/50 dark:bg-slate-800/20"
                        style={{ gridTemplateColumns: `5rem repeat(${unitTypes.length}, 1fr)` }}>
                        <span />
                        {unitTypes.map((ut, t) => {
                          const hasData = distributionMethod === 'custom' &&
                            ((scheduleByType[t]?.some(v => v > 0)) || (leaseUpScheduleByType[t]?.some(v => v > 0)));
                          return (
                            <div key={t} className="flex flex-col items-center gap-0.5">
                              <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 text-center tracking-wide uppercase">
                                {ut.label}
                              </span>
                              {hasData && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setScheduleByType(prev => prev.map((s, i) => i === t ? Array(totalDuration).fill(0) : s));
                                    setLeaseUpScheduleByType(prev => prev.map((s, i) => i === t ? Array(totalDuration).fill(0) : s));
                                  }}
                                  className="text-[10px] text-slate-400 hover:text-red-500 dark:hover:text-red-400 transition-colors touch-manipulation"
                                >
                                  Clear
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    <div className="divide-y divide-slate-100 dark:divide-slate-700/60">
                      {months.map(m => {
                        const idx = m - 1;
                        return (
                          <div key={m} className="px-3 py-2 space-y-1.5">
                              {/* Renovation row */}
                              {someTypeScheduled && (
                                <div className="grid gap-2 items-center"
                                  style={{ gridTemplateColumns: `4rem 3.5rem repeat(${unitTypes.length}, 1fr)` }}>
                                  <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 tabular-nums">Mo {m}</span>
                                  <span className="text-[10px] text-slate-400 dark:text-slate-500 font-medium">Reno</span>
                                  {unitTypes.map((ut, t) => {
                                    const val = scheduleByType[t]?.[idx] ?? 0;
                                    const isReadOnly = distributionMethod !== 'custom';
                                    return (
                                      <input key={t}
                                        type="number"
                                        readOnly={isReadOnly}
                                        className={`input text-base px-1 py-1 text-center w-full ${isReadOnly ? 'bg-slate-50 dark:bg-slate-800/20 text-slate-400 dark:text-slate-500 cursor-default' : ''}`}
                                        min={0}
                                        placeholder="0"
                                        value={val === 0 ? '' : val}
                                        onChange={e => !isReadOnly && updateCell(t, idx, Number(e.target.value) || 0)}
                                        aria-label={`Mo ${m} Reno ${ut.label}`}
                                      />
                                    );
                                  })}
                                </div>
                              )}
                              {/* Lease-up row */}
                              {someLeaseUpScheduled && (
                                <div className="grid gap-2 items-center"
                                  style={{ gridTemplateColumns: `4rem 3.5rem repeat(${unitTypes.length}, 1fr)` }}>
                                  <span className="text-xs tabular-nums text-transparent select-none">{someTypeScheduled ? '' : `Mo ${m}`}</span>
                                  {!someTypeScheduled && <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 tabular-nums" style={{gridColumn: '1'}}>Mo {m}</span>}
                                  <span className="text-[10px] text-blue-500 dark:text-blue-400 font-medium">L/U</span>
                                  {unitTypes.map((ut, t) => {
                                    const val = leaseUpScheduleByType[t]?.[idx] ?? 0;
                                    const isReadOnly = distributionMethod !== 'custom';
                                    return (
                                      <input key={t}
                                        type="number"
                                        readOnly={isReadOnly}
                                        className={`input text-base px-1 py-1 text-center w-full border-blue-200 dark:border-blue-800/40 ${isReadOnly ? 'bg-slate-50 dark:bg-slate-800/20 text-slate-400 dark:text-slate-500 cursor-default' : ''}`}
                                        min={0}
                                        placeholder="0"
                                        value={val === 0 ? '' : val}
                                        onChange={e => !isReadOnly && updateLeaseUpCell(t, idx, Number(e.target.value) || 0)}
                                        aria-label={`Mo ${m} LeaseUp ${ut.label}`}
                                      />
                                    );
                                  })}
                                </div>
                              )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}

              {totalDuration > 0 && !scheduleValid && (someTypeScheduled || someLeaseUpScheduled) && (() => {
                const staleTypes: { t: number; label: string; detail: string }[] = [];
                unitTypes.forEach((ut, t) => {
                  const renoMismatch = unitsToStabilize[t] > 0 && scheduleTotals[t] !== unitsToStabilize[t];
                  const luMismatch   = leaseUpToStabilize[t] > 0 && leaseUpScheduleTotals[t] !== leaseUpToStabilize[t];
                  if (!renoMismatch && !luMismatch) return;
                  const parts: string[] = [];
                  if (renoMismatch) parts.push(`${scheduleTotals[t]}/${unitsToStabilize[t]} reno`);
                  if (luMismatch)   parts.push(`${leaseUpScheduleTotals[t]}/${leaseUpToStabilize[t]} lease-up`);
                  staleTypes.push({ t, label: ut.label, detail: distributionMethod === 'custom' ? `${parts.join(', ')} — manual schedule needs update` : parts.join(', ') });
                });
                if (staleTypes.length === 0) return null;
                return (
                  <div className="rounded-lg bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800/40 px-3 py-2 space-y-1.5">
                    <p className="text-[11px] font-semibold text-amber-600 dark:text-amber-400">Schedule doesn&apos;t match your plan:</p>
                    {staleTypes.map(({ label, detail }) => (
                      <p key={label} className="text-[11px] text-amber-600 dark:text-amber-400">• {label}: {detail}</p>
                    ))}
                  </div>
                );
              })()}
            </div>
          )}

          {/* ── Results: 3-step LTL walkthrough per year ── */}
          {result && allYears.length > 0 && (
            <div className="space-y-3">
              {/* Step explainers */}
              <div className="space-y-1.5">
                <div className="flex items-start gap-2">
                  <span className="shrink-0 mt-0.5 inline-flex items-center justify-center w-4 h-4 rounded-full bg-slate-200 dark:bg-slate-700 text-[10px] font-bold text-slate-600 dark:text-slate-300">1</span>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    <span className="font-semibold text-slate-700 dark:text-slate-200">Market Rent</span> = units × target rent × 12, grown at {grossRentGrowthPct}%/yr
                  </p>
                </div>
                <div className="flex items-start gap-2">
                  <span className="shrink-0 mt-0.5 inline-flex items-center justify-center w-4 h-4 rounded-full bg-slate-200 dark:bg-slate-700 text-[10px] font-bold text-slate-600 dark:text-slate-300">2</span>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    <span className="font-semibold text-slate-700 dark:text-slate-200">Gross Lease Rent</span> = actual collected from the lease-up schedule (Year 1) and anniversary lag (Year 2+)
                  </p>
                </div>
                <div className="flex items-start gap-2">
                  <span className="shrink-0 mt-0.5 inline-flex items-center justify-center w-4 h-4 rounded-full bg-amber-100 dark:bg-amber-900/40 text-[10px] font-bold text-amber-600 dark:text-amber-400">3</span>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    <span className="font-semibold text-amber-600 dark:text-amber-400">Loss to Lease</span> = Market − Gross Lease
                  </p>
                </div>
              </div>

              {/* Per-year breakdown table */}
              <div className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-slate-800/40 border-b border-slate-200 dark:border-slate-700">
                      <th className="px-3 py-2 text-left font-semibold text-slate-500 dark:text-slate-400">Year</th>
                      <th className="px-3 py-2 text-right font-semibold text-slate-500 dark:text-slate-400">Market</th>
                      <th className="px-3 py-2 text-right font-semibold text-slate-500 dark:text-slate-400">Gross Lease</th>
                      <th className="px-3 py-2 text-right font-semibold text-amber-600 dark:text-amber-400">LTL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allYears.map(y => {
                      const market = totalTargetAnnual * Math.pow(1 + grossRentGrowthPct / 100, y - 1);
                      const actual = computeYearRent(y);
                      const ltl = market - actual; // always Market − Gross Lease, per year
                      return (
                        <tr key={y} className="border-t border-slate-100 dark:border-slate-700/60 first:border-t-0">
                          <td className="px-3 py-2 font-semibold text-slate-600 dark:text-slate-300">Yr {y}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-slate-600 dark:text-slate-300">{fmt$(market)}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-slate-700 dark:text-slate-200">{fmt$(actual)}</td>
                          <td className="px-3 py-2 text-right tabular-nums font-semibold text-amber-600 dark:text-amber-400">
                            {ltl > 0.5 ? fmt$(ltl) : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <p className="text-[11px] text-slate-400 dark:text-slate-500">
                Fully stabilized by month {result.stabilizationMonth}
                {result.stabilizationMonth <= projectionYears * 12
                  ? ` (Year ${Math.ceil(result.stabilizationMonth / 12)})`
                  : ' — beyond projection window'}
                .
              </p>
            </div>
          )}

          {/* Auto-applied indicator */}
          {scheduleValid && result && (
            <div className="flex items-center gap-1.5 px-1 py-1">
              <Check size={13} className="text-emerald-500 shrink-0" />
              <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">Pro Forma updated</span>
            </div>
          )}

        </div>
      )}
    </div>
  );
}
