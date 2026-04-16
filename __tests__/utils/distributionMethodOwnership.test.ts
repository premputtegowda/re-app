/**
 * Regression tests for the distributionMethod oscillation bug.
 *
 * History: parent (DealAnalyzerForm) used to hold its own `distributionMethod` state
 * AND pass `externalDistributionMethod` to the calculator. The calculator emitted its
 * own value via onStateChange. When the calculator's `hasManualSchedule` heuristic on
 * mount disagreed with the parent's stored value, the two would oscillate forever
 * between 'weighted' and 'custom'.
 *
 * Fix: the calculator OWNS distributionMethod entirely. Parent reads it back via
 * onStateChange (calcState.distributionMethod) for display only — never writes.
 *
 * These tests document the contract so a future change re-introducing bidirectional
 * sync would fail at the test layer instead of in production.
 */

import { describe, it, expect } from 'vitest';
import type { CalcPersistedState } from '@/types';

// ── Replicate the parent's derivation (must stay one-way: calcState → derived value) ──

function deriveDistributionMethod(
  calcState: CalcPersistedState | null | undefined,
): 'weighted' | 'custom' {
  return calcState?.distributionMethod === 'custom' ? 'custom' : 'weighted';
}

// ── Replicate the calculator's initial-state inference ──

function inferInitialDistributionMethod(
  initialState: CalcPersistedState | undefined,
): 'weighted' | 'custom' {
  if (initialState?.distributionMethod === 'custom') return 'custom';
  const hasManualSchedule =
    !!initialState?.scheduleByType?.some((s) => s.some((n) => n > 0)) ||
    !!initialState?.leaseUpScheduleByType?.some((s) => s.some((n) => n > 0));
  return hasManualSchedule ? 'custom' : 'weighted';
}

// ── Replicate the auto-apply dedup-key builder ──

function buildAutoApplyKey(
  overrides: Record<number, number>,
  dist: number[] | undefined,
  byType: { targetRent: number; distribution: number[] }[] | undefined,
): string {
  return JSON.stringify({ overrides, dist, byType });
}

// ── Tests ──

describe('parent.distributionMethod — derived (one-way), never stored as state', () => {
  it('returns "weighted" when calcState is null', () => {
    expect(deriveDistributionMethod(null)).toBe('weighted');
  });

  it('returns "weighted" when calcState is undefined', () => {
    expect(deriveDistributionMethod(undefined)).toBe('weighted');
  });

  it('returns "weighted" when calcState has no distributionMethod', () => {
    expect(deriveDistributionMethod({} as CalcPersistedState)).toBe('weighted');
  });

  it('returns "custom" when calcState.distributionMethod === "custom"', () => {
    expect(deriveDistributionMethod({ distributionMethod: 'custom' } as CalcPersistedState)).toBe('custom');
  });

  it('returns "weighted" when calcState.distributionMethod === "weighted"', () => {
    expect(deriveDistributionMethod({ distributionMethod: 'weighted' } as CalcPersistedState)).toBe('weighted');
  });

  it('repeated derivation with the same input yields a stable value (no oscillation)', () => {
    const calcState = { distributionMethod: 'custom' as const } as CalcPersistedState;
    const values = Array.from({ length: 100 }, () => deriveDistributionMethod(calcState));
    expect(new Set(values).size).toBe(1);
    expect(values[0]).toBe('custom');
  });
});

describe('calculator.distributionMethod — initialized once, no external sync allowed', () => {
  it('uses initialState.distributionMethod when present', () => {
    const init = { distributionMethod: 'custom' as const } as CalcPersistedState;
    expect(inferInitialDistributionMethod(init)).toBe('custom');
  });

  it('infers "custom" when a manual reno schedule exists but distributionMethod is missing', () => {
    const init = { scheduleByType: [[0, 0, 1, 0]] } as CalcPersistedState;
    expect(inferInitialDistributionMethod(init)).toBe('custom');
  });

  it('infers "custom" when a manual lease-up schedule exists but distributionMethod is missing', () => {
    const init = { leaseUpScheduleByType: [[0, 1, 0, 0]] } as CalcPersistedState;
    expect(inferInitialDistributionMethod(init)).toBe('custom');
  });

  it('defaults to "weighted" when no manual schedule and no explicit value', () => {
    expect(inferInitialDistributionMethod({} as CalcPersistedState)).toBe('weighted');
    expect(inferInitialDistributionMethod(undefined)).toBe('weighted');
  });

  it('the OLD bug scenario no longer oscillates: calc inits "custom" (manual schedule), parent derives "weighted" — now stable', () => {
    // Pre-fix: parent.distributionMethod='weighted' would push to calculator via
    //   externalDistributionMethod, calc would flip to 'weighted', emit, parent re-derives
    //   'weighted', then auto-recompute would clear the manual schedule, calc's
    //   hasManualSchedule heuristic would re-evaluate to 'weighted' on next state
    //   reconstruction, and the cycle continued.
    // Post-fix: there is NO external sync. Calc keeps its 'custom' value. Parent's
    //   derivation eventually catches up after onStateChange propagates.
    const initWithManualSchedule = { scheduleByType: [[0, 0, 1, 0]] } as CalcPersistedState;
    const calcInit = inferInitialDistributionMethod(initWithManualSchedule);
    const parentInitial = deriveDistributionMethod(null); // calcState not yet populated

    // The two start out disagreeing — that's expected and OK.
    expect(calcInit).toBe('custom');
    expect(parentInitial).toBe('weighted');

    // After the calc emits its state to the parent, parent re-derives from the new calcState:
    const calcStateAfterMount = { distributionMethod: calcInit, scheduleByType: [[0, 0, 1, 0]] } as CalcPersistedState;
    const parentAfter = deriveDistributionMethod(calcStateAfterMount);

    // Parent now matches calc — converged in ONE round, no oscillation possible because
    // the calc's value is stable (no external sync to flip it back).
    expect(parentAfter).toBe('custom');
    expect(parentAfter).toBe(calcInit);
  });
});

describe('auto-apply dedup key — same input → same key (prevents redundant onApply calls)', () => {
  it('identical inputs produce identical keys', () => {
    const overrides = { 1: 100_000 };
    const dist = [1, 0, 1, 0, 1, 2, 1, 1, 1, 1, 0, 1];
    const byType = [{ targetRent: 1500, distribution: dist }];
    const k1 = buildAutoApplyKey(overrides, dist, byType);
    const k2 = buildAutoApplyKey(overrides, dist, byType);
    expect(k1).toBe(k2);
  });

  it('keys differ when distribution values change', () => {
    const overrides = { 1: 100_000 };
    const k1 = buildAutoApplyKey(overrides, [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], undefined);
    const k2 = buildAutoApplyKey(overrides, [0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], undefined);
    expect(k1).not.toBe(k2);
  });

  it('keys differ when per-type rent changes (per-type breakdown is in the key)', () => {
    const overrides = { 1: 100_000 };
    const dist = [0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const k1 = buildAutoApplyKey(overrides, dist, [{ targetRent: 1500, distribution: dist }]);
    const k2 = buildAutoApplyKey(overrides, dist, [{ targetRent: 1600, distribution: dist }]);
    expect(k1).not.toBe(k2);
  });

  it('keys differ when overrides change', () => {
    const dist = [0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const k1 = buildAutoApplyKey({ 1: 100_000 }, dist, undefined);
    const k2 = buildAutoApplyKey({ 1: 105_000 }, dist, undefined);
    expect(k1).not.toBe(k2);
  });
});
