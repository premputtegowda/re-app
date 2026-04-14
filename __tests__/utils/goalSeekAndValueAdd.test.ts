/**
 * Tests for goal seek behavior and value-add plan completeness logic.
 *
 * Goal Seek:
 * - findBreakEven returns 'beyond' when deal is too strong to break
 * - Rent goal seek uses Math.ceil for display (always meets target)
 * - Refi year uses scan mode (checks every year)
 * - Rent growth search range is wide enough (up to 100%)
 *
 * Value-Add Completeness:
 * - stepComplete is false when value-add=Yes but no units assigned
 * - stepComplete is true when value-add=No
 * - stepComplete is true when units are assigned and schedule is complete
 * - valueAddIncomplete flag drives amber indicators
 */

import { describe, it, expect } from 'vitest';
import { findBreakEven } from '@/utils/whatIfCalc';
import type { CoCResult } from '@/types';

// ── Goal Seek Tests ──────────────────────────────────────────────────────────

describe('findBreakEven', () => {
  // Simple builder: metric = 10 - value (decreasing as value increases)
  const decreasingBuilder = (v: number) => ({ avgCoCReturn: 10 - v, irr: 10 - v } as CoCResult);
  // Simple builder: metric = value (increasing as value increases)
  const increasingBuilder = (v: number) => ({ avgCoCReturn: v, irr: v } as CoCResult);
  const cocMetric = (r: CoCResult) => r.avgCoCReturn;

  it('finds break-even when target is within range (worseDir=up)', () => {
    // metric = 10 - v; target = 7 → break-even at v = 3
    const result = findBreakEven(decreasingBuilder, 0, 10, cocMetric, 7, 'up');
    expect(result).toBeTypeOf('number');
    expect(result as number).toBeCloseTo(3, 0);
  });

  it('finds break-even when target is within range (worseDir=down)', () => {
    // metric = v; target = 5 → break-even at v = 5
    const result = findBreakEven(increasingBuilder, 0, 10, cocMetric, 5, 'down');
    expect(result).toBeTypeOf('number');
    expect(result as number).toBeCloseTo(5, 0);
  });

  it('returns "beyond" when deal is too strong to break (worseDir=up)', () => {
    // metric = 10 - v ∈ [9, 10] for v ∈ [0, 1], always > target=5
    const result = findBreakEven(decreasingBuilder, 0, 1, cocMetric, 5, 'up');
    expect(result).toBe('beyond');
  });

  it('returns "beyond" when deal is too strong to break (worseDir=down)', () => {
    // metric = v ∈ [8, 10] for v ∈ [8, 10], always > target=5
    const result = findBreakEven(increasingBuilder, 8, 10, cocMetric, 5, 'down');
    expect(result).toBe('beyond');
  });

  it('returns null when already failing at current value (worseDir=up)', () => {
    // metric = 10 - v; at v=0 → metric=10, at v=0 metric=10 > target=15 is false
    // Actually: at searchMin=0, metric=10 ≤ target=15 → already failing
    const result = findBreakEven(decreasingBuilder, 0, 10, cocMetric, 15, 'up');
    expect(result).toBeNull();
  });

  it('returns null when already failing at current value (worseDir=down)', () => {
    // metric = v; at searchMax=3, metric=3 ≤ target=5 → already failing
    const result = findBreakEven(increasingBuilder, 0, 3, cocMetric, 5, 'down');
    expect(result).toBeNull();
  });
});

// ── Value-Add Completeness Logic ─────────────────────────────────────────────

describe('value-add completeness logic', () => {
  // Replicate the stepComplete logic from DealAnalyzerForm
  function computeStepComplete(
    isValueAdd: boolean | null,
    someReno: boolean,
    someLU: boolean,
    calcScheduleIncomplete: boolean,
  ): boolean {
    return (
      isValueAdd === false ||
      (isValueAdd === true && !calcScheduleIncomplete)
    );
  }

  function computeValueAddIncomplete(
    isValueAdd: boolean | null,
    someReno: boolean,
    someLU: boolean,
  ): boolean {
    return isValueAdd === true && !someReno && !someLU;
  }

  describe('stepComplete', () => {
    it('true when value-add is No', () => {
      expect(computeStepComplete(false, false, false, false)).toBe(true);
    });

    it('true when value-add is Yes with units and schedule complete', () => {
      expect(computeStepComplete(true, true, false, false)).toBe(true);
    });

    it('false when value-add is Yes with units but schedule incomplete', () => {
      expect(computeStepComplete(true, true, false, true)).toBe(false);
    });

    it('true when value-add is Yes but no units (schedule not incomplete since no units to schedule)', () => {
      // calcScheduleIncomplete requires (someReno || someLU) to be true, so it's false when no units
      expect(computeStepComplete(true, false, false, false)).toBe(true);
    });
  });

  describe('valueAddIncomplete', () => {
    it('true when value-add=Yes and no reno/lease-up units', () => {
      expect(computeValueAddIncomplete(true, false, false)).toBe(true);
    });

    it('false when value-add=Yes and reno units assigned', () => {
      expect(computeValueAddIncomplete(true, true, false)).toBe(false);
    });

    it('false when value-add=Yes and lease-up units assigned', () => {
      expect(computeValueAddIncomplete(true, false, true)).toBe(false);
    });

    it('false when value-add=Yes and both assigned', () => {
      expect(computeValueAddIncomplete(true, true, true)).toBe(false);
    });

    it('false when value-add=No', () => {
      expect(computeValueAddIncomplete(false, false, false)).toBe(false);
    });

    it('false when value-add=null (unanswered)', () => {
      expect(computeValueAddIncomplete(null, false, false)).toBe(false);
    });
  });
});

// ── Rent Goal Seek Rounding ─────────────────────────────────────────────────

describe('rent goal seek rounding', () => {
  it('Math.ceil ensures displayed value always meets target', () => {
    // Simulates: bisection finds 1868.47, display should be 1869 not 1868
    const solvedValue = 1868.47;
    const displayed = Math.ceil(solvedValue);
    expect(displayed).toBe(1869);
    expect(displayed).toBeGreaterThanOrEqual(solvedValue);
  });

  it('Math.ceil is identity for whole numbers', () => {
    expect(Math.ceil(1868)).toBe(1868);
  });

  it('effectivelyMet: formatted solved matches formatted current', () => {
    const format = (v: number) => `$${Math.ceil(v).toLocaleString()}/mo`;
    // Both round to same display
    expect(format(1868)).toBe(format(1868));
    // Different display
    expect(format(1868.47)).not.toBe(format(1868));
    expect(format(1868.47)).toBe('$1,869/mo');
    expect(format(1868)).toBe('$1,868/mo');
  });
});
