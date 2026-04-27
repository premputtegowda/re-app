/**
 * Regression tests for the distributionMethod initialization heuristic in
 * RehabRentCalculator.
 *
 * Bug: when restoring a snapshotted calcState with distributionMethod='weighted'
 * but a non-zero leaseUpScheduleByType (carried over from prior calculator
 * activity), the legacy `hasManualSchedule` heuristic in the useState
 * initializer would silently flip the calculator back to 'custom' mode. This
 * broke per-sub-section Cancel restoration in the wizard's Operations step.
 *
 * Fix: trust an explicit `initialState.distributionMethod` value when present;
 * only fall back to the heuristic for legacy deals saved before the field
 * existed.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RehabRentCalculator, type UnitTypeInput } from '@/components/DealAnalyzer/RehabRentCalculator';
import type { CalcPersistedState } from '@/types';

const unitTypes: UnitTypeInput[] = [
  { label: '1BR', count: 4, inPlaceRent: 1_000, targetRent: 1_500 },
];

function renderCalc(initialState: CalcPersistedState | undefined) {
  return render(
    <RehabRentCalculator
      unitTypes={unitTypes}
      projectionYears={5}
      appliedYears={{}}
      onApply={vi.fn()}
      onClear={vi.fn()}
      onApplyPreStab={vi.fn()}
      onOpenChange={vi.fn()}
      grossRentGrowthPct={3}
      initialState={initialState}
    />,
  );
}

/** The "Switch to weighted" link only renders when distributionMethod is
 *  'custom' (RehabRentCalculator.tsx:712). It's the most direct DOM signal
 *  for which mode the calculator initialized in. */
function isInCustomMode() {
  return !!screen.queryByText(/Switch to weighted/i);
}

describe('RehabRentCalculator — distributionMethod initialization', () => {
  it('honors initialState.distributionMethod="weighted" even when leaseUpScheduleByType has non-zero entries', () => {
    // Repro of the bug: snapshot from a weighted-mode session, but a stale
    // leaseUpScheduleByType from prior calculator activity. Pre-fix the
    // hasManualSchedule heuristic would override to 'custom'; post-fix we
    // trust the explicit 'weighted' value.
    renderCalc({
      mode: 'renovate',
      totalDuration: 12,
      unitsToStabilize: [4],
      perUnitMonths: [2],
      scheduleByType: [[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
      manualDuration: 0,
      manualPreStabRents: [0],
      localRents: [{ inPlace: 1_000, target: 1_500 }],
      leaseUpToStabilize: [3],
      leaseUpScheduleByType: [[1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
      distributionMethod: 'weighted',
    });

    expect(isInCustomMode()).toBe(false);
  });

  it('honors initialState.distributionMethod="custom" explicitly', () => {
    renderCalc({
      mode: 'renovate',
      totalDuration: 12,
      unitsToStabilize: [4],
      perUnitMonths: [2],
      scheduleByType: [[1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0]],
      manualDuration: 0,
      manualPreStabRents: [0],
      localRents: [{ inPlace: 1_000, target: 1_500 }],
      leaseUpToStabilize: [0],
      leaseUpScheduleByType: [[]],
      distributionMethod: 'custom',
    });

    expect(isInCustomMode()).toBe(true);
  });

  it('falls back to hasManualSchedule heuristic when distributionMethod is undefined (legacy)', () => {
    // Legacy deals saved before the distributionMethod field existed: infer
    // 'custom' from any non-zero schedule data.
    renderCalc({
      mode: 'renovate',
      totalDuration: 12,
      unitsToStabilize: [4],
      perUnitMonths: [2],
      scheduleByType: [[2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
      manualDuration: 0,
      manualPreStabRents: [0],
      localRents: [{ inPlace: 1_000, target: 1_500 }],
      leaseUpToStabilize: [0],
      leaseUpScheduleByType: [[]],
      // distributionMethod intentionally omitted to simulate legacy
    } as unknown as CalcPersistedState);

    expect(isInCustomMode()).toBe(true);
  });

  it('falls back to weighted when distributionMethod undefined AND no schedule data (fresh deal)', () => {
    renderCalc({
      mode: 'renovate',
      totalDuration: 0,
      unitsToStabilize: [0],
      perUnitMonths: [0],
      scheduleByType: [[]],
      manualDuration: 0,
      manualPreStabRents: [0],
      localRents: [{ inPlace: 1_000, target: 1_500 }],
      leaseUpToStabilize: [0],
      leaseUpScheduleByType: [[]],
    } as unknown as CalcPersistedState);

    expect(isInCustomMode()).toBe(false);
  });

  it('honors initialState.distributionMethod="weighted" with empty initialState fields', () => {
    // Minimal weighted snapshot — verify trust is unconditional w.r.t. other
    // fields being zero/empty.
    renderCalc({
      mode: 'renovate',
      totalDuration: 0,
      unitsToStabilize: [0],
      perUnitMonths: [0],
      scheduleByType: [[]],
      manualDuration: 0,
      manualPreStabRents: [0],
      localRents: [{ inPlace: 1_000, target: 1_500 }],
      leaseUpToStabilize: [0],
      leaseUpScheduleByType: [[]],
      distributionMethod: 'weighted',
    });

    expect(isInCustomMode()).toBe(false);
  });
});
