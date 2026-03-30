'use client';

import { useState, useMemo, useEffect } from 'react';
import { Zap, X } from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface UnitTypeInput {
  label: string;
  count: number;
  inPlaceRent: number;  // $/unit/month — income before renovation
  targetRent: number;   // $/unit/month — income after renovation (stabilized)
  preStabRent?: number; // $/unit/month — current pre-stab value (optional)
}

// ── Simulation ─────────────────────────────────────────────────────────────────

/**
 * Simulate a single unit type with fractional pace (token-bucket).
 * Returns array of monthly gross rent collections for totalYears × 12 months.
 * duration=0 → unit flips to targetRent immediately (stabilization, no vacancy).
 * duration>0 → unit earns $0 for N months (renovation), then targetRent.
 */
function simulateUnitType(
  count: number,
  ipRent: number,
  targetRent: number,
  pacePerMonth: number,
  durationMonths: number,
  totalMonths: number
): number[] {
  let inPlace = count;
  let stabilized = 0;
  let bucket = 0;
  const schedule = new Map<number, number>();
  const monthly: number[] = [];

  for (let m = 1; m <= totalMonths; m++) {
    bucket += pacePerMonth;
    const toStart = Math.min(Math.floor(bucket), inPlace);
    bucket -= toStart;

    if (toStart > 0) {
      inPlace -= toStart;
      const done = m + durationMonths;
      schedule.set(done, (schedule.get(done) ?? 0) + toStart);
    }

    const completing = schedule.get(m) ?? 0;
    if (completing > 0) {
      stabilized += completing;
      schedule.delete(m);
    }

    monthly.push(inPlace * ipRent + stabilized * targetRent);
  }

  return monthly;
}

export interface SimulationResult {
  yearlyRents: number[];           // total across all unit types, per year
  perTypeYearlyRents: number[][];  // [typeIndex][year]
  stabilizationMonth: number;      // month when last stabilizing unit completes
}

/**
 * unitsToStabilize: how many units need work (≤ totalUnits).
 * Remaining units (totalUnits - unitsToStabilize) earn targetRent throughout.
 * Stabilizing units are distributed proportionally across unit types.
 */
export function simulateRehabRent(
  unitTypes: UnitTypeInput[],
  totalPacePerMonth: number,
  durationMonths: number,
  totalYears: number,
  unitsToStabilize?: number
): SimulationResult {
  const totalUnits = unitTypes.reduce((s, t) => s + t.count, 0);
  const stabUnits = Math.min(Math.max(1, unitsToStabilize ?? totalUnits), totalUnits);

  if (totalUnits === 0 || totalPacePerMonth <= 0) {
    return { yearlyRents: Array(totalYears).fill(0), perTypeYearlyRents: [], stabilizationMonth: 0 };
  }

  const totalMonths = totalYears * 12;

  // Distribute stabUnits proportionally across types (floor + remainder to last)
  let remaining = stabUnits;
  const stabilizeCounts = unitTypes.map((t, i) => {
    if (i === unitTypes.length - 1) return remaining;
    const c = Math.floor(t.count * stabUnits / totalUnits);
    remaining -= c;
    return c;
  });

  const perTypeMonthly = unitTypes.map((t, i) => {
    const stabCount = stabilizeCounts[i];
    const targetCount = t.count - stabCount; // already at target rent
    const typePace = stabCount > 0 ? totalPacePerMonth * (stabCount / stabUnits) : 0;

    const stabMonthly = stabCount > 0
      ? simulateUnitType(stabCount, t.inPlaceRent, t.targetRent, typePace, durationMonths, totalMonths)
      : Array(totalMonths).fill(0);

    // Already-stabilized units earn target rent throughout
    return stabMonthly.map(m => m + targetCount * t.targetRent);
  });

  const totalMonthly = Array.from({ length: totalMonths }, (_, m) =>
    perTypeMonthly.reduce((s, tm) => s + tm[m], 0)
  );

  const yearlyRents = Array.from({ length: totalYears }, (_, y) =>
    totalMonthly.slice(y * 12, (y + 1) * 12).reduce((a, b) => a + b, 0)
  );

  const perTypeYearlyRents = perTypeMonthly.map(tm =>
    Array.from({ length: totalYears }, (_, y) =>
      tm.slice(y * 12, (y + 1) * 12).reduce((a, b) => a + b, 0)
    )
  );

  const stabilizationMonth = Math.ceil(stabUnits / totalPacePerMonth) + durationMonths;

  return { yearlyRents, perTypeYearlyRents, stabilizationMonth };
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmt$(n: number) {
  return n === 0 ? '—' : `$${Math.round(n).toLocaleString()}`;
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

  const totalUnits = unitTypes.reduce((s, t) => s + t.count, 0);
  const isApplied = Object.keys(appliedYears).length > 0;
  const hasRentData = unitTypes.some(t => t.inPlaceRent > 0 && t.targetRent > 0);

  const [unitsToStabilize, setUnitsToStabilize] = useState(totalUnits);
  const [pace, setPace] = useState(1);
  const [rehabType, setRehabType] = useState<'stabilization' | 'renovation'>('renovation');
  const [duration, setDuration] = useState(1);

  // Reset unitsToStabilize when unit mix changes
  useEffect(() => { setUnitsToStabilize(totalUnits); }, [totalUnits]);

  const actualDuration = rehabType === 'stabilization' ? 0 : duration;

  // Distribute stabUnits proportionally (mirrors simulateRehabRent)
  const stabilizeCounts = useMemo(() => {
    let remaining = unitsToStabilize;
    return unitTypes.map((t, i) => {
      if (i === unitTypes.length - 1) return remaining;
      const c = Math.floor(t.count * unitsToStabilize / totalUnits);
      remaining -= c;
      return c;
    });
  }, [unitTypes, unitsToStabilize, totalUnits]);

  const result = useMemo<SimulationResult | null>(() => {
    if (!hasRentData || totalUnits === 0) return null;
    return simulateRehabRent(unitTypes, pace, actualDuration, Math.max(projectionYears, 2), unitsToStabilize);
  }, [unitTypes, pace, actualDuration, projectionYears, hasRentData, totalUnits, unitsToStabilize]);

  const transitionYears = useMemo(() => {
    if (!result) return [];
    const stabYear = Math.ceil(result.stabilizationMonth / 12);
    return Array.from({ length: Math.min(stabYear, projectionYears) }, (_, i) => i + 1);
  }, [result, projectionYears]);

  // Blended monthly per unit per type — average across transition years
  const blendedMonthlyPerType = useMemo<number[]>(() => {
    if (!result || transitionYears.length === 0) return [];
    return unitTypes.map((t, i) => {
      const typeRents = result.perTypeYearlyRents[i] ?? [];
      const total = transitionYears.reduce((sum, y) => sum + (typeRents[y - 1] ?? 0), 0);
      return t.count > 0 ? total / transitionYears.length / t.count / 12 : 0;
    });
  }, [result, transitionYears, unitTypes]);

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
      {/* Header */}
      <div className="flex items-center justify-between px-3.5 py-3">
        <div className="flex items-center gap-2">
          <Zap size={14} className={isApplied ? 'text-blue-500' : 'text-slate-400'} />
          <span className={`text-sm font-medium ${isApplied ? 'text-blue-700 dark:text-blue-300' : 'text-slate-600 dark:text-slate-400'}`}>
            Value-Add Rent Calculator
          </span>
          {isApplied && (
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400">
              Applied
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
          aria-label="Cancel calculator"
        >
          <X size={14} />
          <span className="hidden sm:inline">Cancel</span>
        </button>
      </div>

      <div className="px-3.5 pb-4 space-y-5 border-t border-slate-200 dark:border-slate-700 pt-4">

        {/* Unit mix reference */}
        {unitTypes.length > 1 && (
          <div className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-100 dark:bg-slate-700/50">
                    <th className="px-2 py-1.5 text-left font-medium text-slate-500 dark:text-slate-400 whitespace-nowrap">Unit type</th>
                    <th className="px-2 py-1.5 text-right font-medium text-slate-500 dark:text-slate-400 whitespace-nowrap">In-place</th>
                    <th className="px-2 py-1.5 text-right font-medium text-emerald-600 dark:text-emerald-400 whitespace-nowrap">Target</th>
                    <th className="px-2 py-1.5 text-right font-medium text-amber-600 dark:text-amber-400 whitespace-nowrap">Pre-Stab</th>
                    <th className="px-2 py-1.5 text-right font-medium text-slate-500 dark:text-slate-400 whitespace-nowrap">Pace</th>
                  </tr>
                </thead>
                <tbody>
                  {unitTypes.map((t, i) => {
                    const stabCount = stabilizeCounts[i] ?? 0;
                    const typePace = stabCount > 0 ? pace * (stabCount / unitsToStabilize) : 0;
                    return (
                      <tr key={i} className="border-t border-slate-100 dark:border-slate-700/50">
                        <td className="px-2 py-1.5 text-slate-700 dark:text-slate-300 font-medium whitespace-nowrap">{t.label}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-slate-500 dark:text-slate-400 whitespace-nowrap">{fmt$(t.inPlaceRent)}/mo</td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-emerald-600 dark:text-emerald-400 whitespace-nowrap">{fmt$(t.targetRent)}/mo</td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-amber-600 dark:text-amber-400 whitespace-nowrap">
                          {t.preStabRent ? `${fmt$(t.preStabRent)}/mo` : '—'}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-slate-500 dark:text-slate-400 whitespace-nowrap">
                          {stabCount === 0 ? '—' : typePace < 1 ? `1 per ${Math.round(1 / typePace)} mo` : `${typePace.toFixed(1)}/mo`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Step 1 */}
        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">
            ① How many units need to be stabilized?
          </p>
          <div className="flex items-center gap-2">
            <input
              type="number"
              className="input text-sm w-20"
              min={1}
              max={totalUnits}
              value={unitsToStabilize}
              onChange={e => setUnitsToStabilize(Math.max(1, Math.min(totalUnits, Number(e.target.value))))}
            />
            <span className="text-sm text-slate-400 dark:text-slate-500">of {totalUnits} total</span>
            {unitsToStabilize < totalUnits && (
              <span className="text-xs text-emerald-600 dark:text-emerald-400">
                {totalUnits - unitsToStabilize} already at target
              </span>
            )}
          </div>
        </div>

        {/* Step 2 */}
        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">
            ② At what pace?
          </p>
          <div className="flex items-center gap-2">
            <input
              type="number"
              className="input text-sm w-20"
              min={1}
              max={unitsToStabilize}
              value={pace}
              onChange={e => setPace(Math.max(1, Math.min(unitsToStabilize, Number(e.target.value))))}
            />
            <span className="text-sm text-slate-400 dark:text-slate-500">units / month</span>
          </div>
        </div>

        {/* Step 3 */}
        <div className="space-y-2">
          <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">
            ③ Stabilization or renovation?
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setRehabType('stabilization')}
              className={`flex-1 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                rehabType === 'stabilization'
                  ? 'bg-primary-600 text-white border-primary-600'
                  : 'border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:border-slate-300'
              }`}
            >
              Stabilization
            </button>
            <button
              type="button"
              onClick={() => setRehabType('renovation')}
              className={`flex-1 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                rehabType === 'renovation'
                  ? 'bg-primary-600 text-white border-primary-600'
                  : 'border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:border-slate-300'
              }`}
            >
              Renovation
            </button>
          </div>
          {rehabType === 'stabilization' && (
            <p className="text-[11px] text-slate-400 dark:text-slate-500">
              Unit flips to target rent immediately — no vacancy period.
            </p>
          )}
          {rehabType === 'renovation' && (
            <div className="flex items-center gap-2">
              <input
                type="number"
                className="input text-sm w-20"
                min={1}
                max={24}
                value={duration}
                onChange={e => setDuration(Math.max(1, Math.min(24, Number(e.target.value))))}
              />
              <span className="text-sm text-slate-400 dark:text-slate-500">months per unit</span>
            </div>
          )}
        </div>

        {/* Stabilization note */}
        {result && (
          <p className="text-xs text-slate-400 dark:text-slate-500">
            {unitsToStabilize === totalUnits ? 'All' : `${unitsToStabilize} of ${totalUnits}`} units stabilized by month {result.stabilizationMonth}
            {result.stabilizationMonth <= projectionYears * 12
              ? ` (Yr ${Math.ceil(result.stabilizationMonth / 12)})`
              : ' — beyond projection window'}
            {unitsToStabilize < totalUnits && ` · ${totalUnits - unitsToStabilize} units at target rent throughout`}
          </p>
        )}

        {/* Results table — transition years */}
        {result && transitionYears.length > 0 && (() => {
          const targetPerUnit = totalUnits > 0
            ? unitTypes.reduce((s, t) => s + t.count * t.targetRent, 0) / totalUnits : 0;
          const blendedByYear = transitionYears.map(y =>
            totalUnits > 0 ? result.yearlyRents[y - 1] / 12 / totalUnits : 0
          );

          return (
            <div className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-100 dark:bg-slate-700/50">
                    <th className="px-3 py-2 text-left font-medium text-slate-500 dark:text-slate-400">Year</th>
                    <th className="px-3 py-2 text-right font-medium text-amber-600 dark:text-amber-400">Blended/mo</th>
                    <th className="px-3 py-2 text-right font-medium text-emerald-600 dark:text-emerald-400">Target/mo</th>
                  </tr>
                </thead>
                <tbody>
                  {transitionYears.map((year, yi) => (
                    <tr key={year} className="border-t border-slate-100 dark:border-slate-700/50">
                      <td className="px-3 py-2 font-medium text-slate-700 dark:text-slate-300">Yr {year}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-semibold text-amber-600 dark:text-amber-400">{fmt$(blendedByYear[yi])}/mo</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-500 dark:text-slate-400">{fmt$(targetPerUnit)}/mo</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })()}

        {/* Actions */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={!result}
            onClick={() => {
              if (!result) return;
              const overrides: Record<number, number> = {};
              transitionYears.forEach(y => { overrides[y] = result.yearlyRents[y - 1]; });
              const stabYear = Math.ceil(result.stabilizationMonth / 12);
              const firstStabilizedYear = stabYear + 1;
              if (firstStabilizedYear <= projectionYears && transitionYears.length > 0) {
                const totalTargetAnnual = unitTypes.reduce((s, t) => s + t.count * t.targetRent, 0) * 12;
                overrides[firstStabilizedYear] = totalTargetAnnual * Math.pow(1 + grossRentGrowthPct / 100, stabYear);
              }
              onApply(overrides);
              if (onApplyPreStab && blendedMonthlyPerType.length > 0) {
                onApplyPreStab(blendedMonthlyPerType);
              }
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

        <p className="text-[10px] text-slate-400 dark:text-slate-500 leading-relaxed">
          Stabilizing units distributed proportionally across unit types. Growth rate applies from Yr{' '}
          {(transitionYears[transitionYears.length - 1] ?? 1) + 1} onwards.
        </p>
      </div>
    </div>
  );
}
