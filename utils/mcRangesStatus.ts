/**
 * Dirty-flag logic for the Market Uncertainty wizard step.
 *
 * A deal's uncertainty ranges can become stale when upstream deal inputs
 * change after the user last reviewed them. We classify two severities:
 *
 *   - **hard** — structurally invalid or materially different. Something
 *     relevant is missing or the user would surely want to retune
 *     (e.g. rehab was added after review, refinance turned on, exit method
 *     flipped).
 *   - **soft** — auto-anchoring already adjusts the ranges, but a base
 *     value drifted enough that a human should glance at it.
 *
 * When both fire, `hard` wins.
 */

import type { CoCAcquisition, CoCRefinance, ProFormaData } from '@/types';
import type { MCRanges } from '@/utils/monteCarlo';
import { computeDefaultRanges } from '@/utils/monteCarlo';

export type McRangesStatus = 'clean' | 'soft' | 'hard';

export interface McRangesStatusResult {
  status: McRangesStatus;
  reasons: string[];
}

/**
 * Relative-change threshold for flagging a base value drift as soft-dirty.
 * 15% chosen to avoid nagging on normal tinkering while still catching a
 * "target rent went from $2,000 to $2,400" magnitude shift.
 */
const SOFT_BASE_DRIFT = 0.15;

export interface McRangesStatusArgs {
  acquisition: CoCAcquisition;
  refinance: CoCRefinance;
  ranges: MCRanges | null;
  /** ISO string of last review, or null if never reviewed. */
  reviewedAt: string | null;
}

export function computeMcRangesStatus(args: McRangesStatusArgs): McRangesStatusResult {
  const { acquisition, refinance, ranges, reviewedAt } = args;

  // Never reviewed — always hard-dirty (user must touch the step at least
  // once so we have a baseline).
  if (!reviewedAt) {
    return { status: 'hard', reasons: ['You have not reviewed ranges yet.'] };
  }

  const hard: string[] = [];
  const soft: string[] = [];

  // ── Structural triggers ────────────────────────────────────────────────
  // We used to flag "missing optional key" (arv, refiRate) as hard, but the
  // MC engine backfills with defaults when a key is absent, and the Market
  // Uncertainty step now always persists merged-with-defaults ranges. So
  // missing keys aren't user-facing breakage — skip those checks.
  //
  // The one remaining hard trigger is a user-correctable misconfiguration:
  // rehab costs exist but the renoOverrunPct range is zero (user actively
  // zeroed it out, or saved before rehab was added). Flag so they retune.
  const hasRehab =
    (acquisition.hardCostItems?.length ?? 0) > 0 ||
    (acquisition.softCostItems?.length ?? 0) > 0 ||
    (acquisition.renovationMonths ?? 0) > 0;

  if (hasRehab && ranges && ranges.renoOverrunPct && ranges.renoOverrunPct.max === 0) {
    soft.push('Rehab costs are set, but the renovation-overrun range is at zero.');
  }

  // ── Soft: base-value drift ─────────────────────────────────────────────
  if (ranges) {
    const drift = (current: number, base: number): number => {
      if (base === 0) return current === 0 ? 0 : 1;
      return Math.abs(current - base) / Math.abs(base);
    };

    if (drift(acquisition.interestRate, ranges.interestRate.mode) > SOFT_BASE_DRIFT) {
      soft.push('Interest rate has shifted notably from the value your ranges are anchored on.');
    }
    if (acquisition.exitMethod === 'capRate' &&
        drift(acquisition.exitCapRate, ranges.exitCapRate.mode) > SOFT_BASE_DRIFT) {
      soft.push('Exit cap rate has shifted notably from the value your ranges are anchored on.');
    }
  }

  if (hard.length > 0) return { status: 'hard', reasons: hard };
  if (soft.length > 0) return { status: 'soft', reasons: soft };
  return { status: 'clean', reasons: [] };
}

// ── Re-anchor detection ──────────────────────────────────────────────────────

const VARIABLE_LABELS: Partial<Record<keyof MCRanges, string>> = {
  targetRentPerUnit: 'Rent / unit',
  vacancyPct: 'Vacancy',
  rentGrowthPct: 'Rent growth',
  exitCapRate: 'Exit cap rate',
  renoOverrunPct: 'Reno overrun',
  interestRate: 'Interest rate',
  refiRate: 'Refi rate',
  expenseGrowthPct: 'Expense growth',
  arv: 'Exit value (ARV)',
};

export interface RebasedFieldsArgs {
  acquisition: CoCAcquisition;
  proForma: ProFormaData;
  refinance: CoCRefinance;
  /** Saved ranges (may be null for never-reviewed deals). */
  ranges: MCRanges | null;
}

/**
 * Return user-friendly labels of every MC range whose saved mode no longer
 * matches the mode that `computeDefaultRanges` would produce from the
 * current deal inputs — i.e., variables whose base values drifted since
 * the user last reviewed ranges.
 *
 * Empty array means saved ranges are still anchored correctly; no drift
 * signal needed.
 */
export function getRebasedFieldLabels(args: RebasedFieldsArgs): string[] {
  const { acquisition, proForma, refinance, ranges } = args;
  if (!ranges) return [];

  const units = acquisition.propertyType === 'mfr' && acquisition.unitMix.length > 0
    ? acquisition.unitMix.reduce((s, u) => s + u.count, 0)
    : (acquisition.units || 1);
  const avgRent = acquisition.propertyType === 'sfr'
    ? (acquisition.sfrTargetRent || 0)
    : (acquisition.unitMix.length > 0
        ? acquisition.unitMix.reduce((s, u) => s + u.rentMonthly * u.count, 0) / Math.max(1, units)
        : 0);

  const defaults = computeDefaultRanges(acquisition, proForma, avgRent, units, refinance);

  const out: string[] = [];
  for (const key of Object.keys(defaults) as (keyof MCRanges)[]) {
    const def = defaults[key];
    const saved = ranges[key];
    if (!def || !saved) continue;
    if (saved.mode !== def.mode) out.push(VARIABLE_LABELS[key] ?? String(key));
  }
  return out;
}
