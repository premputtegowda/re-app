/**
 * Regression tests for the "Complete the schedule for all renovation and
 * lease-up units" warning that fires when a user:
 *   1. Picks "No" on Value-Add and clicks Done
 *   2. Toggles back to "Yes"
 *   3. Enters a non-zero lease-up unit count
 *   4. Clicks Done
 *
 * After step 4, the Stabilization warning must NOT fire if calcState already
 * contains a weighted distribution that sums to the entered units (which is
 * what RehabRentCalculator's auto-compute is supposed to push back via
 * onStateChange).
 *
 * The bug shape: when calcState is sparse (only `{isValueAdd: true}` after the
 * spread in DealAnalyzerForm.tsx:399-402) and the calculator hasn't yet pushed
 * its auto-computed schedule back, calcState.leaseUpScheduleByType is empty,
 * which makes luScheduleTotals=0 ≠ entered units → mismatch → warning fires.
 *
 * These tests document the contract on both sides:
 *   - what calcState shape produces a (correct) warning
 *   - what shape clears the warning
 *   - the math itself (totals derivation from calcState arrays)
 */

import { describe, it, expect } from 'vitest';
import type { CalcPersistedState } from '@/types';

// ── Logic extracted from DealAnalyzerForm.tsx:1316-1346 ──────────────────────

interface ScheduleCheckArgs {
  isValueAdd: boolean | null;
  preStabMethod: 'calculator' | 'manual' | null;
  unitsToRenovate: number[];
  leaseUpUnitsArr: number[];
  calcState: CalcPersistedState | undefined;
  calcApplied: boolean;
  stabDuration: number;
}

function computeCalcScheduleIncomplete(args: ScheduleCheckArgs): boolean {
  const { isValueAdd, preStabMethod, unitsToRenovate, leaseUpUnitsArr, calcState, calcApplied, stabDuration } = args;

  const renoScheduleTotals = unitsToRenovate.map((_, t) =>
    (calcState?.scheduleByType?.[t] ?? []).reduce((s, n) => s + n, 0)
  );
  const luScheduleTotals = leaseUpUnitsArr.map((_, t) =>
    (calcState?.leaseUpScheduleByType?.[t] ?? []).reduce((s, n) => s + n, 0)
  );
  const someReno = unitsToRenovate.some(u => u > 0);
  const someLU = leaseUpUnitsArr.some(u => u > 0);
  const scheduleHasMismatch =
    unitsToRenovate.some((u, t) => u > 0 && renoScheduleTotals[t] !== u) ||
    leaseUpUnitsArr.some((u, t) => u > 0 && luScheduleTotals[t] !== u);

  return isValueAdd === true
    && preStabMethod === 'calculator'
    && (someReno || someLU)
    && ((!calcApplied && stabDuration === 0) || scheduleHasMismatch);
}

// A "fresh-Yes" calcState — the shape produced by DealAnalyzerForm.tsx:399-402
// when a No-saved deal is toggled back to Yes (just spreads prev with the new
// flag). Crucially, scheduleByType / leaseUpScheduleByType are absent until
// the calculator's auto-compute fires onStateChange.
const sparseYesCalcState: CalcPersistedState = {
  isValueAdd: true,
  // Below are the calculator's defaults that are NOT yet in calcState after
  // the spread; we set them here only to satisfy the type. The point of the
  // tests is that schedule arrays are absent or empty.
  mode: 'renovate',
  totalDuration: 12,
  unitsToStabilize: [0],
  perUnitMonths: [1],
  scheduleByType: [[]],
  manualDuration: 0,
  manualPreStabRents: [0],
  localRents: [{ inPlace: 1_000, target: 1_500 }],
  leaseUpToStabilize: [0],
  leaseUpScheduleByType: [[]],
  distributionMethod: 'weighted',
  preStabMethod: 'calculator',
};

// Calculator has finished auto-compute and pushed the weighted distribution
// back via onStateChange. luScheduleTotals[0] = sum = 5.
const populatedYesCalcState: CalcPersistedState = {
  ...sparseYesCalcState,
  leaseUpToStabilize: [5],
  leaseUpScheduleByType: [[1, 0, 0, 0, 1, 1, 1, 0, 1, 0, 0, 0]], // weightedDistribute(5, 12), sum=5
};

describe('No → Yes value-add toggle — schedule mismatch warning', () => {
  it('fires when user enters lease-up units but calcState has no schedule yet (the bug shape)', () => {
    // This is the transient state between the user typing the lease-up count
    // and the calculator's auto-compute pushing the weighted distribution back.
    // It correctly identifies the mismatch — the warning is the contract.
    const incomplete = computeCalcScheduleIncomplete({
      isValueAdd: true,
      preStabMethod: 'calculator',
      unitsToRenovate: [0],
      leaseUpUnitsArr: [5],
      calcState: { ...sparseYesCalcState, leaseUpScheduleByType: [[]] },
      calcApplied: false,
      stabDuration: 12,
    });
    expect(incomplete).toBe(true);
  });

  it('clears once the calculator pushes a weighted distribution that sums to the entered lease-up units', () => {
    // After auto-compute settles, the warning must clear. This is the
    // user-facing regression: prod was reported to keep showing the warning
    // even after auto-compute should have populated calcState.
    const incomplete = computeCalcScheduleIncomplete({
      isValueAdd: true,
      preStabMethod: 'calculator',
      unitsToRenovate: [0],
      leaseUpUnitsArr: [5],
      calcState: populatedYesCalcState,
      calcApplied: false,
      stabDuration: 12,
    });
    expect(incomplete).toBe(false);
  });

  it('does not fire when value-add is No (the warning is gated on Yes)', () => {
    const incomplete = computeCalcScheduleIncomplete({
      isValueAdd: false,
      preStabMethod: 'calculator',
      unitsToRenovate: [0],
      leaseUpUnitsArr: [0],
      calcState: { ...sparseYesCalcState, isValueAdd: false },
      calcApplied: false,
      stabDuration: 12,
    });
    expect(incomplete).toBe(false);
  });

  it('does not fire when isValueAdd is null (unanswered)', () => {
    const incomplete = computeCalcScheduleIncomplete({
      isValueAdd: null,
      preStabMethod: 'calculator',
      unitsToRenovate: [0],
      leaseUpUnitsArr: [0],
      calcState: undefined,
      calcApplied: false,
      stabDuration: 12,
    });
    expect(incomplete).toBe(false);
  });

  it('does not fire when there are no reno or lease-up units (Yes selected but no work)', () => {
    const incomplete = computeCalcScheduleIncomplete({
      isValueAdd: true,
      preStabMethod: 'calculator',
      unitsToRenovate: [0],
      leaseUpUnitsArr: [0],
      calcState: sparseYesCalcState,
      calcApplied: false,
      stabDuration: 12,
    });
    expect(incomplete).toBe(false);
  });

  it('does not fire when preStabMethod is "manual" (calculator path is bypassed)', () => {
    const incomplete = computeCalcScheduleIncomplete({
      isValueAdd: true,
      preStabMethod: 'manual',
      unitsToRenovate: [0],
      leaseUpUnitsArr: [5],
      calcState: { ...sparseYesCalcState, leaseUpScheduleByType: [[]] },
      calcApplied: false,
      stabDuration: 12,
    });
    expect(incomplete).toBe(false);
  });

  it('fires for renovation-units mismatch independently of lease-up state', () => {
    const incomplete = computeCalcScheduleIncomplete({
      isValueAdd: true,
      preStabMethod: 'calculator',
      unitsToRenovate: [3],
      leaseUpUnitsArr: [0],
      calcState: { ...sparseYesCalcState, scheduleByType: [[1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]] }, // sum=1, want=3
      calcApplied: false,
      stabDuration: 12,
    });
    expect(incomplete).toBe(true);
  });

  it('fires when stabDuration=0 even if the schedule sums match (no period to stabilize over)', () => {
    // The (!calcApplied && stabDuration === 0) leg of the OR — independent of
    // schedule mismatch. Documented here because the No→Yes flow can leave
    // stabDuration at 0 if the prior No save never stamped a duration.
    const incomplete = computeCalcScheduleIncomplete({
      isValueAdd: true,
      preStabMethod: 'calculator',
      unitsToRenovate: [0],
      leaseUpUnitsArr: [5],
      calcState: populatedYesCalcState,
      calcApplied: false,
      stabDuration: 0,
    });
    expect(incomplete).toBe(true);
  });

  it('does not fire when stabDuration=0 but the calculator has already applied (transient post-apply state)', () => {
    const incomplete = computeCalcScheduleIncomplete({
      isValueAdd: true,
      preStabMethod: 'calculator',
      unitsToRenovate: [0],
      leaseUpUnitsArr: [5],
      calcState: populatedYesCalcState,
      calcApplied: true,
      stabDuration: 0,
    });
    expect(incomplete).toBe(false);
  });

  it('multi-type MFR: mismatch on any one unit type fires the warning', () => {
    // 1BR matches; 2BR does not.
    const incomplete = computeCalcScheduleIncomplete({
      isValueAdd: true,
      preStabMethod: 'calculator',
      unitsToRenovate: [0, 0],
      leaseUpUnitsArr: [3, 4],
      calcState: {
        ...sparseYesCalcState,
        leaseUpToStabilize: [3, 4],
        leaseUpScheduleByType: [
          [1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0], // sum=3, matches
          [1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], // sum=2, want=4 → mismatch
        ],
      },
      calcApplied: false,
      stabDuration: 12,
    });
    expect(incomplete).toBe(true);
  });

  it('multi-type MFR: clears once every type sums to its target', () => {
    const incomplete = computeCalcScheduleIncomplete({
      isValueAdd: true,
      preStabMethod: 'calculator',
      unitsToRenovate: [0, 0],
      leaseUpUnitsArr: [3, 4],
      calcState: {
        ...sparseYesCalcState,
        leaseUpToStabilize: [3, 4],
        leaseUpScheduleByType: [
          [1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0], // sum=3
          [1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0], // sum=4
        ],
      },
      calcApplied: false,
      stabDuration: 12,
    });
    expect(incomplete).toBe(false);
  });
});

describe('No → Yes value-add toggle — calcState shape after spread', () => {
  // The form does `setCalcState(prev => ({ ...prev, isValueAdd: true }))` when
  // the user toggles to Yes. These tests pin the contract that this spread
  // does NOT introduce stale schedule data and is safe to pass to the
  // calculator as initialState.
  it('spreading {isValueAdd:false} into {isValueAdd:true} preserves no schedule arrays', () => {
    const prev = { isValueAdd: false } as Partial<CalcPersistedState>;
    const next = { ...prev, isValueAdd: true };
    expect(next.scheduleByType).toBeUndefined();
    expect(next.leaseUpScheduleByType).toBeUndefined();
  });

  it('spreading prev calcState carrying totalDuration:12 keeps it for the calculator to inherit', () => {
    // This is what makes the calculator NOT default totalDuration to 0 on
    // remount — the form-level stabDuration also defaults to 12 separately,
    // so even a No-saved deal whose calcState lacks totalDuration recovers
    // via the externalDuration prop sync.
    const prev: Partial<CalcPersistedState> = { isValueAdd: false, totalDuration: 12, perUnitMonths: [1], preStabMethod: 'calculator' };
    const next = { ...prev, isValueAdd: true };
    expect(next.totalDuration).toBe(12);
    expect(next.preStabMethod).toBe('calculator');
  });
});
