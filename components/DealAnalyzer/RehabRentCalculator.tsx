'use client';

import { useState, useMemo } from 'react';
import { Zap, X } from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface UnitTypeInput {
  label: string;       // e.g. "1BR/1BA × 4"
  count: number;
  inPlaceRent: number; // $/unit/month — income before renovation
  targetRent: number;  // $/unit/month — income after renovation (stabilized)
}

// ── Simulation ─────────────────────────────────────────────────────────────────

/**
 * Simulate a single unit type with fractional pace (token-bucket).
 * Returns array of monthly gross rent collections for `totalYears × 12` months.
 */
function simulateUnitType(
  count: number,
  ipRent: number,
  psRent: number,
  pacePerMonth: number, // may be fractional
  durationMonths: number,
  totalMonths: number
): number[] {
  let inPlace = count;
  let preStab = 0;
  let bucket = 0; // fractional pace accumulator
  const schedule = new Map<number, number>();
  const monthly: number[] = [];

  for (let m = 1; m <= totalMonths; m++) {
    // Token-bucket: accumulate fractional units, start whole ones
    bucket += pacePerMonth;
    const toStart = Math.min(Math.floor(bucket), inPlace);
    bucket -= toStart;

    if (toStart > 0) {
      inPlace -= toStart;
      const done = m + durationMonths;
      schedule.set(done, (schedule.get(done) ?? 0) + toStart);
    }

    // Complete renovations due this month
    const completing = schedule.get(m) ?? 0;
    if (completing > 0) {
      preStab += completing;
      schedule.delete(m);
    }

    monthly.push(inPlace * ipRent + preStab * psRent);
  }

  return monthly;
}

export interface SimulationResult {
  yearlyRents: number[];           // total across all unit types, per year
  perTypeYearlyRents: number[][];  // [typeIndex][year]
  stabilizationMonth: number;      // month when all units are renovated
}

export function simulateRehabRent(
  unitTypes: UnitTypeInput[],
  totalPacePerMonth: number,
  durationMonths: number,
  totalYears: number
): SimulationResult {
  const totalUnits = unitTypes.reduce((s, t) => s + t.count, 0);
  if (totalUnits === 0 || totalPacePerMonth <= 0) {
    return { yearlyRents: Array(totalYears).fill(0), perTypeYearlyRents: [], stabilizationMonth: 0 };
  }

  const totalMonths = totalYears * 12;

  // Run per-type simulation with proportional pace
  const perTypeMonthly = unitTypes.map(t => {
    const typePace = totalPacePerMonth * (t.count / totalUnits);
    return simulateUnitType(t.count, t.inPlaceRent, t.targetRent, typePace, durationMonths, totalMonths);
  });

  // Sum monthly income across types
  const totalMonthly = Array.from({ length: totalMonths }, (_, m) =>
    perTypeMonthly.reduce((s, tm) => s + tm[m], 0)
  );

  // Annual totals
  const yearlyRents = Array.from({ length: totalYears }, (_, y) =>
    totalMonthly.slice(y * 12, (y + 1) * 12).reduce((a, b) => a + b, 0)
  );

  const perTypeYearlyRents = perTypeMonthly.map(tm =>
    Array.from({ length: totalYears }, (_, y) =>
      tm.slice(y * 12, (y + 1) * 12).reduce((a, b) => a + b, 0)
    )
  );

  // Stabilization = last unit finishes: ceil(totalUnits / pace) start months + duration
  const stabilizationMonth = Math.ceil(totalUnits / totalPacePerMonth) + durationMonths;

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
  /** Called with blended monthly rent per unit, indexed by unit type */
  onApplyPreStab?: (values: number[]) => void;
  onOpenChange?: (v: boolean) => void;
  /** Used to growth-adjust the stabilized anchor override */
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
  const [pace, setPace] = useState(1);
  const [duration, setDuration] = useState(1);

  const totalUnits = unitTypes.reduce((s, t) => s + t.count, 0);
  const isApplied = Object.keys(appliedYears).length > 0;
  const hasRentData = unitTypes.some(t => t.inPlaceRent > 0 && t.targetRent > 0);

  const result = useMemo<SimulationResult | null>(() => {
    if (!hasRentData || totalUnits === 0) return null;
    return simulateRehabRent(unitTypes, pace, duration, Math.max(projectionYears, 2));
  }, [unitTypes, pace, duration, projectionYears, hasRentData, totalUnits]);

  const transitionYears = useMemo(() => {
    if (!result) return [];
    const stabYear = Math.ceil(result.stabilizationMonth / 12);
    return Array.from({ length: Math.min(stabYear, projectionYears) }, (_, i) => i + 1);
  }, [result, projectionYears]);

  const showTypesBreakdown = unitTypes.length > 1 && result !== null;

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
      {/* Header with Cancel */}
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

      <div className="px-3.5 pb-4 space-y-4 border-t border-slate-200 dark:border-slate-700 pt-3">

          {/* Inputs */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-slate-500 dark:text-slate-400 block mb-1">
                Rehab pace (units/month)
              </label>
              <input
                type="number"
                className="input text-sm"
                min={1}
                max={totalUnits}
                value={pace}
                onChange={e => setPace(Math.max(1, Math.min(totalUnits, Number(e.target.value))))}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-500 dark:text-slate-400 block mb-1">
                Rehab duration (months/unit)
              </label>
              <input
                type="number"
                className="input text-sm"
                min={1}
                max={12}
                value={duration}
                onChange={e => setDuration(Math.max(1, Math.min(12, Number(e.target.value))))}
              />
            </div>
          </div>

          {/* Unit mix summary */}
          {unitTypes.length > 1 && (
            <div className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-100 dark:bg-slate-700/50">
                    <th className="px-3 py-1.5 text-left font-medium text-slate-500 dark:text-slate-400">Unit type</th>
                    <th className="px-3 py-1.5 text-right font-medium text-slate-500 dark:text-slate-400">In-place</th>
                    <th className="px-3 py-1.5 text-right font-medium text-slate-500 dark:text-slate-400">Target</th>
                    <th className="px-3 py-1.5 text-right font-medium text-slate-500 dark:text-slate-400">Pace</th>
                  </tr>
                </thead>
                <tbody>
                  {unitTypes.map((t, i) => {
                    const typePace = pace * (t.count / totalUnits);
                    return (
                      <tr key={i} className="border-t border-slate-100 dark:border-slate-700/50">
                        <td className="px-3 py-1.5 text-slate-700 dark:text-slate-300 font-medium">{t.label}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-slate-500 dark:text-slate-400">{fmt$(t.inPlaceRent)}/mo</td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-slate-500 dark:text-slate-400">{fmt$(t.targetRent)}/mo</td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-slate-500 dark:text-slate-400">
                          {typePace < 1 ? `1 per ${Math.round(1 / typePace)} mo` : `${typePace.toFixed(1)}/mo`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Stabilization note */}
          {result && (
            <p className="text-xs text-slate-400 dark:text-slate-500">
              All {totalUnits} units stabilized by month {result.stabilizationMonth}
              {result.stabilizationMonth <= projectionYears * 12
                ? ` (Yr ${Math.ceil(result.stabilizationMonth / 12)})`
                : ' — beyond projection window'}
            </p>
          )}

          {/* Results table — transition years only */}
          {result && transitionYears.length > 0 && (() => {
            const inPlacePerUnit = totalUnits > 0
              ? unitTypes.reduce((s, t) => s + t.count * t.inPlaceRent, 0) / totalUnits : 0;
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
                      <th className="px-3 py-2 text-right font-medium text-slate-500 dark:text-slate-400">In-Place/mo</th>
                      <th className="px-3 py-2 text-right font-medium text-amber-600 dark:text-amber-400">Pre-Stab/mo</th>
                      <th className="px-3 py-2 text-right font-medium text-emerald-600 dark:text-emerald-400">Target/mo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transitionYears.map((year, yi) => (
                      <tr key={year} className="border-t border-slate-100 dark:border-slate-700/50">
                        <td className="px-3 py-2 font-medium text-slate-700 dark:text-slate-300">Yr {year}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-500 dark:text-slate-400">{fmt$(inPlacePerUnit)}/mo</td>
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
              disabled={!result || blendedMonthlyPerType.length === 0}
              onClick={() => {
                if (!result || !onApplyPreStab) return;
                onApplyPreStab(blendedMonthlyPerType);
                setOpen(false);
              }}
              className="flex-1 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 disabled:opacity-40 text-white text-sm font-medium transition-colors"
            >
              Apply to Pre-Stab
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
            Each unit type is renovated proportionally. Growth rate applies from Yr{' '}
            {(transitionYears[transitionYears.length - 1] ?? 1) + 1} onwards.
          </p>
        </div>
    </div>
  );
}
