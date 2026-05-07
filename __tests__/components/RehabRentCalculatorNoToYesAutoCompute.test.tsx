/**
 * Regression test for the No → Yes Value-Add toggle flow.
 *
 * User-facing bug shape: a fresh deal where the user picks "No" on Value-Add
 * and clicks Done, then toggles back to "Yes" and enters a non-zero lease-up
 * unit count. The Stabilization warning "Complete the schedule for all
 * renovation and lease-up units" appears AND the Rent Calculator cells are
 * empty — even though weighted-distribution mode should populate them by
 * default.
 *
 * Root-cause contract: when RehabRentCalculator mounts with a sparse
 * `initialState` (the shape produced by spreading `{isValueAdd: false}` with
 * the new `isValueAdd: true` flag — i.e. no schedule arrays carried over),
 * its auto-compute effect MUST:
 *   1. Default to `distributionMethod: 'weighted'` (heuristic falls through).
 *   2. Sync `totalDuration` from the `externalDuration` prop.
 *   3. Sync `leaseUpToStabilize` from the `externalLeaseUpToStabilize` prop.
 *   4. Recompute `leaseUpScheduleByType` so totals equal the entered units.
 *   5. Push the populated state up via `onStateChange` so the parent's
 *      `calcState.leaseUpScheduleByType` ends up sum-matching — which is what
 *      clears the Stabilization warning (DealAnalyzerForm.tsx:1336-1346).
 */

import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { useEffect, useState } from 'react';
import {
  RehabRentCalculator,
  type CalcPersistedState,
  type UnitTypeInput,
} from '@/components/DealAnalyzer/RehabRentCalculator';

// MFR with a single unit type, matching the simplest repro path.
const unitTypes: UnitTypeInput[] = [
  { label: '1BR', count: 8, inPlaceRent: 1_000, targetRent: 1_500 },
];

/**
 * Test harness that mimics how DealAnalyzerForm wires the calculator after
 * a No → Yes toggle: parent owns calcState + the lease-up units array, passes
 * them as initialState/externalLeaseUpToStabilize, receives state updates
 * via onStateChange. The leaseUpUnits prop changes after mount to simulate
 * the user typing in the Value-Add input.
 */
function ParentHarness({
  initialState,
  initialLeaseUpUnits,
  laterLeaseUpUnits,
  onCalcStateChange,
}: {
  initialState: CalcPersistedState | undefined;
  initialLeaseUpUnits: number[];
  laterLeaseUpUnits: number[];
  onCalcStateChange: (s: CalcPersistedState) => void;
}) {
  const [leaseUpUnits, setLeaseUpUnits] = useState(initialLeaseUpUnits);
  const [calcState, setCalcState] = useState<CalcPersistedState | undefined>(initialState);

  // Simulate the user typing a new lease-up value after mount
  useEffect(() => {
    const id = setTimeout(() => setLeaseUpUnits(laterLeaseUpUnits), 0);
    return () => clearTimeout(id);
  }, [laterLeaseUpUnits]);

  return (
    <RehabRentCalculator
      unitTypes={unitTypes}
      projectionYears={5}
      appliedYears={{}}
      onApply={vi.fn()}
      onClear={vi.fn()}
      onApplyPreStab={vi.fn()}
      onOpenChange={vi.fn()}
      grossRentGrowthPct={3}
      externalDuration={12}
      externalOffline={1}
      externalUnitsToStabilize={[0]}
      externalLeaseUpToStabilize={leaseUpUnits}
      initialState={calcState}
      onStateChange={s => {
        setCalcState(s);
        onCalcStateChange(s);
      }}
    />
  );
}

const sumArr = (a: number[]) => a.reduce((s, n) => s + n, 0);

describe('RehabRentCalculator — auto-compute after No → Yes toggle', () => {
  it('mounts with a sparse "fresh-Yes" initialState and computes a weighted lease-up schedule once externalLeaseUpToStabilize arrives', async () => {
    const onCalcStateChange = vi.fn();

    // The shape that `setCalcState(prev => ({...prev, isValueAdd: true}))`
    // produces from a No-saved calcState — sparse: no schedules, but with
    // form-level fields that do survive the spread.
    const sparseInitialState: CalcPersistedState = {
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
      isValueAdd: true,
      preStabMethod: 'calculator',
      // distributionMethod intentionally omitted — the heuristic should
      // pick 'weighted' since no non-zero schedule data is present.
    };

    render(
      <ParentHarness
        initialState={sparseInitialState}
        initialLeaseUpUnits={[0]}
        laterLeaseUpUnits={[5]}
        onCalcStateChange={onCalcStateChange}
      />,
    );

    // Wait for effects to settle: the useEffect timer flips lease-up units to
    // [5], which triggers the external sync, which triggers auto-compute,
    // which triggers another onStateChange.
    await vi.waitFor(() => {
      const lastCall = onCalcStateChange.mock.calls.at(-1)?.[0] as CalcPersistedState | undefined;
      expect(lastCall?.leaseUpToStabilize).toEqual([5]);
      expect(lastCall?.leaseUpScheduleByType).toBeDefined();
      expect(sumArr(lastCall!.leaseUpScheduleByType[0])).toBe(5);
    });
  });

  it('keeps distributionMethod="weighted" through the auto-compute (no silent flip to custom)', async () => {
    const onCalcStateChange = vi.fn();

    render(
      <ParentHarness
        initialState={{
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
          isValueAdd: true,
          preStabMethod: 'calculator',
        }}
        initialLeaseUpUnits={[0]}
        laterLeaseUpUnits={[3]}
        onCalcStateChange={onCalcStateChange}
      />,
    );

    await vi.waitFor(() => {
      const lastCall = onCalcStateChange.mock.calls.at(-1)?.[0] as CalcPersistedState | undefined;
      expect(lastCall?.distributionMethod).toBe('weighted');
      expect(sumArr(lastCall!.leaseUpScheduleByType[0])).toBe(3);
    });
  });

  it('auto-compute schedule is non-trivial — distributes units across multiple months, not concentrated in one', async () => {
    // Documents the user expectation: "Rent calculator should show weighted
    // distribution data populated" — meaning units are spread across the
    // duration, not 0s with a single bucket.
    const onCalcStateChange = vi.fn();

    render(
      <ParentHarness
        initialState={{
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
          isValueAdd: true,
          preStabMethod: 'calculator',
        }}
        initialLeaseUpUnits={[0]}
        laterLeaseUpUnits={[6]}
        onCalcStateChange={onCalcStateChange}
      />,
    );

    await vi.waitFor(() => {
      const lastCall = onCalcStateChange.mock.calls.at(-1)?.[0] as CalcPersistedState | undefined;
      const schedule = lastCall?.leaseUpScheduleByType[0] ?? [];
      expect(sumArr(schedule)).toBe(6);
      // Weighted distribution should put units in at least 2 different months
      const monthsWithUnits = schedule.filter(n => n > 0).length;
      expect(monthsWithUnits).toBeGreaterThan(1);
    });
  });

  it('multi-type MFR: each type with non-zero lease-up gets a sum-matching schedule', async () => {
    const onCalcStateChange = vi.fn();
    const multiTypes: UnitTypeInput[] = [
      { label: '1BR', count: 4, inPlaceRent: 1_000, targetRent: 1_400 },
      { label: '2BR', count: 6, inPlaceRent: 1_300, targetRent: 1_800 },
    ];

    function MultiHarness() {
      const [leaseUp, setLeaseUp] = useState([0, 0]);
      const [cs, setCS] = useState<CalcPersistedState | undefined>({
        mode: 'renovate',
        totalDuration: 12,
        unitsToStabilize: [0, 0],
        perUnitMonths: [1, 1],
        scheduleByType: [[], []],
        manualDuration: 0,
        manualPreStabRents: [0, 0],
        localRents: multiTypes.map(u => ({ inPlace: u.inPlaceRent, target: u.targetRent })),
        leaseUpToStabilize: [0, 0],
        leaseUpScheduleByType: [[], []],
        isValueAdd: true,
        preStabMethod: 'calculator',
      });
      useEffect(() => {
        const id = setTimeout(() => setLeaseUp([2, 5]), 0);
        return () => clearTimeout(id);
      }, []);
      return (
        <RehabRentCalculator
          unitTypes={multiTypes}
          projectionYears={5}
          appliedYears={{}}
          onApply={vi.fn()}
          onClear={vi.fn()}
          onApplyPreStab={vi.fn()}
          onOpenChange={vi.fn()}
          grossRentGrowthPct={3}
          externalDuration={12}
          externalOffline={1}
          externalUnitsToStabilize={[0, 0]}
          externalLeaseUpToStabilize={leaseUp}
          initialState={cs}
          onStateChange={s => { setCS(s); onCalcStateChange(s); }}
        />
      );
    }

    render(<MultiHarness />);

    await vi.waitFor(() => {
      const lastCall = onCalcStateChange.mock.calls.at(-1)?.[0] as CalcPersistedState | undefined;
      expect(lastCall?.leaseUpToStabilize).toEqual([2, 5]);
      expect(sumArr(lastCall!.leaseUpScheduleByType[0])).toBe(2);
      expect(sumArr(lastCall!.leaseUpScheduleByType[1])).toBe(5);
    });
  });

  it('lease-up units beyond unit count are clamped (max = unit count)', async () => {
    const onCalcStateChange = vi.fn();

    // Ask for 20 lease-up but unit count is 8 → clamps to 8.
    render(
      <ParentHarness
        initialState={{
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
          isValueAdd: true,
          preStabMethod: 'calculator',
        }}
        initialLeaseUpUnits={[0]}
        laterLeaseUpUnits={[20]}
        onCalcStateChange={onCalcStateChange}
      />,
    );

    await vi.waitFor(() => {
      const lastCall = onCalcStateChange.mock.calls.at(-1)?.[0] as CalcPersistedState | undefined;
      expect(lastCall?.leaseUpToStabilize).toEqual([8]); // clamped to unitTypes[0].count
      expect(sumArr(lastCall!.leaseUpScheduleByType[0])).toBe(8);
    });
  });
});
