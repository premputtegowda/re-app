'use client';

import { useState, useMemo } from 'react';
import { ChevronDown, ChevronRight, Zap } from 'lucide-react';

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
}

export function RehabRentCalculator({
  unitTypes,
  projectionYears,
  appliedYears,
  onApply,
  onClear,
}: RehabRentCalculatorProps) {
  const [open, setOpen] = useState(false);
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

  if (!hasRentData) return null;

  return (
    <div className={`rounded-xl border transition-colors mb-4 ${
      isApplied
        ? 'border-blue-200 dark:border-blue-800/60 bg-blue-50/40 dark:bg-blue-900/10'
        : 'border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/30'
    }`}>
      {/* Header */}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-3.5 py-3 text-left"
      >
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
        {open ? <ChevronDown size={14} className="text-slate-400" /> : <ChevronRight size={14} className="text-slate-400" />}
      </button>

      {open && (
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

          {/* Results table */}
          {result && (
            <div className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-100 dark:bg-slate-700/50">
                    <th className="px-3 py-2 text-left font-medium text-slate-500 dark:text-slate-400">Year</th>
                    {showTypesBreakdown && unitTypes.map((t, i) => (
                      <th key={i} className="px-2 py-2 text-right font-medium text-slate-400 dark:text-slate-500 hidden sm:table-cell">
                        {t.label}
                      </th>
                    ))}
                    <th className="px-3 py-2 text-right font-medium text-slate-500 dark:text-slate-400">Total/yr</th>
                    <th className="px-3 py-2 text-right font-medium text-slate-500 dark:text-slate-400">Avg/unit</th>
                    <th className="px-3 py-2 text-right font-medium text-slate-500 dark:text-slate-400">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {result.yearlyRents.map((rent, i) => {
                    const year = i + 1;
                    if (year > projectionYears) return null;
                    const avgPerUnit = totalUnits > 0 ? rent / 12 / totalUnits : 0;
                    const isTransition = transitionYears.includes(year);
                    return (
                      <tr key={year} className="border-t border-slate-100 dark:border-slate-700/50">
                        <td className="px-3 py-2 font-medium text-slate-700 dark:text-slate-300">Yr {year}</td>
                        {showTypesBreakdown && result.perTypeYearlyRents.map((tr, ti) => (
                          <td key={ti} className="px-2 py-2 text-right tabular-nums text-slate-400 dark:text-slate-500 hidden sm:table-cell">
                            {fmt$(tr[i])}
                          </td>
                        ))}
                        <td className="px-3 py-2 text-right font-semibold tabular-nums text-slate-800 dark:text-slate-200">{fmt$(rent)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-500 dark:text-slate-400">{fmt$(avgPerUnit)}/mo</td>
                        <td className="px-3 py-2 text-right">
                          {isTransition
                            ? <span className="text-amber-600 dark:text-amber-400">Blended</span>
                            : <span className="text-emerald-600 dark:text-emerald-400">Stabilized</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                if (!result) return;
                const overrides: Record<number, number> = {};
                transitionYears.forEach(y => { overrides[y] = result.yearlyRents[y - 1]; });
                onApply(overrides);
              }}
              disabled={!result}
              className="flex-1 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-sm font-medium transition-colors"
            >
              Apply to Pro Forma
            </button>
            {isApplied && (
              <button
                type="button"
                onClick={onClear}
                className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-sm text-slate-500 dark:text-slate-400 hover:text-red-500 hover:border-red-300 transition-colors"
              >
                Clear
              </button>
            )}
          </div>

          <p className="text-[10px] text-slate-400 dark:text-slate-500 leading-relaxed">
            Each unit type is renovated proportionally. Growth rate applies from Yr{' '}
            {(transitionYears[transitionYears.length - 1] ?? 1) + 1} onwards.
          </p>
        </div>
      )}
    </div>
  );
}
