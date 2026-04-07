/**
 * ProForma Chaining — 6 Blue/Gray Cascade Scenarios
 *
 * Blue = manual override stored in yearOverrides (the stored value IS the displayed value)
 * Gray = formula-computed by makeChainedValue (previous year's value × (1 + growth))
 *
 * How display works (mirrors component logic):
 *   - If yearOverrides[year].otherIncome exists → show that (Blue)
 *   - Otherwise show makeChainedValue(year) → show that (Gray)
 *
 * makeChainedValue only uses yearOverrides[prevYear] to know the base for the NEXT year.
 * So yearOverrides[3]=20k means: Yr4 rebases from 20k. It does NOT change makeChainedValue(3).
 *
 * Scenario 1: Fresh Start      — entering a baseline; all years auto-compound (all Gray)
 * Scenario 2: Mid-Chain Block  — Yr3 turns Blue; Yr4+ chain from the Yr3 value
 * Scenario 3: Year 1 Block     — Yr1 override set; downstream chain uses Yr1 block, not new baseline
 * Scenario 4: Hit the Wall     — Yr1 changes propagate until they hit a Blue block at Yr3
 * Scenario 5: Undo Mid-Block   — clearing Yr3 override snaps it back to formula; Yr4+ follow
 * Scenario 6: Undo Yr1 Block   — clearing Yr1 override lets the master baseline flow through again
 */

import { describe, it, expect } from 'vitest';
import { makeChainedValue } from '@/utils/proFormaChaining';
import type { ProFormaData } from '@/types';

const FIELD = 'otherIncome' as const;
const RATE  = 'otherIncomeGrowthPct' as const;
const G = 2; // 2 % / yr

type Overrides = ProFormaData['yearOverrides'];

/** Formula value for year N — what makeChainedValue computes, ignoring any override at year N itself. */
function formula(overrides: Overrides, stabilized: number, year: number): number {
  return makeChainedValue(overrides)(FIELD, RATE, stabilized, G, year);
}

/**
 * Display value for year N — mirrors the component's YearCell logic:
 *   override if one is stored (and differs from formula), otherwise formula.
 */
function displayed(overrides: Overrides, stabilized: number, year: number): number {
  const f = formula(overrides, stabilized, year);
  const ov = year <= 1
    ? overrides?.[1]?.[FIELD]
    : overrides?.[year]?.[FIELD];
  return ov !== undefined && ov !== f ? ov : f;
}

// ── Scenario 1: Fresh Start ───────────────────────────────────────────────────

describe('Scenario 1: Fresh Start (Auto Cascade)', () => {
  it('Yr1 shows the stabilized baseline (Gray)', () => {
    expect(displayed({}, 10_000, 1)).toBe(10_000);
  });

  it('Yr2–5 form a perfect compounding chain from the baseline (all Gray)', () => {
    const s = 10_000;
    expect(displayed({}, s, 2)).toBeCloseTo(s * Math.pow(1.02, 1), 2);
    expect(displayed({}, s, 3)).toBeCloseTo(s * Math.pow(1.02, 2), 2);
    expect(displayed({}, s, 4)).toBeCloseTo(s * Math.pow(1.02, 3), 2);
    expect(displayed({}, s, 5)).toBeCloseTo(s * Math.pow(1.02, 4), 2);
  });
});

// ── Scenario 2: Mid-Chain Block ───────────────────────────────────────────────

describe('Scenario 2: Mid-Chain Block (Blue at Yr3 = 20 000)', () => {
  const overrides: Overrides = { 3: { otherIncome: 20_000 } };

  it('Yr1 and Yr2 are unaffected — they still compound from baseline (Gray)', () => {
    expect(displayed(overrides, 10_000, 1)).toBe(10_000);
    expect(displayed(overrides, 10_000, 2)).toBeCloseTo(10_000 * 1.02, 2);
  });

  it('Yr3 displays the Blue override value (20 000)', () => {
    expect(displayed(overrides, 10_000, 3)).toBe(20_000);
  });

  it('Yr4 and Yr5 start a new cascade from the Yr3 block — NOT from original baseline', () => {
    // makeChainedValue rebases from yearOverrides[3] when computing Yr4+
    expect(formula(overrides, 10_000, 4)).toBeCloseTo(20_000 * 1.02, 2);
    expect(formula(overrides, 10_000, 5)).toBeCloseTo(20_000 * Math.pow(1.02, 2), 2);
  });

  it('Yr3 formula-value differs from override — meaning the block is active (isOverridden=true)', () => {
    const yr3Formula = formula(overrides, 10_000, 3);
    const yr3Override = overrides![3]!.otherIncome!;
    expect(yr3Override).toBe(20_000);
    expect(yr3Formula).not.toBe(yr3Override); // override ≠ formula → cell turns Blue
  });
});

// ── Scenario 3: Year 1 Block ──────────────────────────────────────────────────

describe('Scenario 3: Year 1 Override (Yr1 value stored — baseline changes to 15 000, chain still follows Yr1)', () => {
  // A stored Yr1 override anchors the chain — same rule as all other years.
  // Even after the master baseline (stabilized) changes, Yr2+ chain from the Yr1 stored value.
  const overrides: Overrides = { 1: { otherIncome: 10_000 } };
  const newBaseline = 15_000;

  it('Yr1 cell displays the Blue override (10k) — not the new baseline (15k)', () => {
    expect(displayed(overrides, newBaseline, 1)).toBe(10_000);
  });

  it('Yr2 chains from the blocked Yr1 value (10k), not the new baseline (15k)', () => {
    expect(formula(overrides, newBaseline, 2)).toBeCloseTo(10_000 * 1.02, 2);
  });

  it('Yr3 and Yr4 continue chaining from the Yr1 block', () => {
    expect(formula(overrides, newBaseline, 3)).toBeCloseTo(10_000 * Math.pow(1.02, 2), 2);
    expect(formula(overrides, newBaseline, 4)).toBeCloseTo(10_000 * Math.pow(1.02, 3), 2);
  });
});

// ── Scenario 4: Hit the Wall ──────────────────────────────────────────────────

describe('Scenario 4: Hit the Wall — Yr1 changes to 15 000 while Yr3 is blocked at 20 000', () => {
  const overrides: Overrides = { 3: { otherIncome: 20_000 } };
  const newBaseline = 15_000;

  it('Yr2 updates to reflect the new Yr1 value (Gray, computes from 15k)', () => {
    expect(formula(overrides, newBaseline, 2)).toBeCloseTo(15_000 * 1.02, 2);
  });

  it('Yr3 displays its Blue override — change is absorbed here', () => {
    expect(displayed(overrides, newBaseline, 3)).toBe(20_000);
  });

  it("Yr3's formula now diverges from its stored override (Yr1 change hit the wall)", () => {
    const yr3Formula = formula(overrides, newBaseline, 3);
    expect(yr3Formula).toBeCloseTo(15_000 * Math.pow(1.02, 2), 2); // formula updated
    expect(yr3Formula).not.toBe(20_000);                           // but override stays
  });

  it('Yr4 and Yr5 are unaffected — still cascade from the Yr3 block', () => {
    expect(formula(overrides, newBaseline, 4)).toBeCloseTo(20_000 * 1.02, 2);
    expect(formula(overrides, newBaseline, 5)).toBeCloseTo(20_000 * Math.pow(1.02, 2), 2);
  });
});

// ── Scenario 5: Undo Mid-Chain Block ─────────────────────────────────────────

describe('Scenario 5: Undo Mid-Chain Block — clear the Yr3 override', () => {
  // Before: { 3: { otherIncome: 20 000 } }   →   After: {}

  it('Yr3 snaps back to Yr2 × (1 + growth)', () => {
    const yr2 = 10_000 * 1.02;
    expect(displayed({}, 10_000, 3)).toBeCloseTo(yr2 * 1.02, 2);
  });

  it('Yr4 and Yr5 follow the restored chain', () => {
    const yr3 = 10_000 * Math.pow(1.02, 2);
    expect(displayed({}, 10_000, 4)).toBeCloseTo(yr3 * 1.02, 2);
    expect(displayed({}, 10_000, 5)).toBeCloseTo(yr3 * Math.pow(1.02, 2), 2);
  });

  it('the whole row is now a single unbroken chain from Yr1', () => {
    const s = 10_000;
    for (let y = 1; y <= 5; y++) {
      expect(displayed({}, s, y)).toBeCloseTo(s * Math.pow(1.02, y - 1), 2);
    }
  });
});

// ── Scenario 6: Undo Year 1 Block ────────────────────────────────────────────

describe('Scenario 6: Undo Year 1 Override — clear the Yr1 override', () => {
  // Before: { 1: { otherIncome: 8 000 } }, stabilized = 10 000
  // After:  {}

  it('Yr1 shows 8k (Blue), Yr2 chains from 8k — not baseline (10k)', () => {
    const overrides: Overrides = { 1: { otherIncome: 8_000 } };
    expect(displayed(overrides, 10_000, 1)).toBe(8_000);
    expect(formula(overrides, 10_000, 2)).toBeCloseTo(8_000 * 1.02, 2);
  });

  it('after unblocking: Yr1 shows baseline (10k), Yr2 chains from 10k', () => {
    expect(displayed({}, 10_000, 1)).toBe(10_000);
    expect(formula({}, 10_000, 2)).toBeCloseTo(10_000 * 1.02, 2);
  });

  it('the entire chain flows from the master baseline once Yr1 block is removed', () => {
    const s = 10_000;
    expect(displayed({}, s, 3)).toBeCloseTo(s * Math.pow(1.02, 2), 2);
    expect(displayed({}, s, 4)).toBeCloseTo(s * Math.pow(1.02, 3), 2);
    expect(displayed({}, s, 5)).toBeCloseTo(s * Math.pow(1.02, 4), 2);
  });
});
