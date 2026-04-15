/**
 * Tests for gross rent chaining with pre-stab and growth rate overrides.
 *
 * - chainedValue skips system overrides, compounds from stabilized
 * - Year 2 = stabilized × (1 + yr2Growth) when Year 1 is pre-stab
 * - Per-year growth rate overrides are picked up correctly
 * - Stale Year 2 pins are cleaned on load
 * - Revert preserves Year 1 pre-stab, clears Year 2+
 * - Base growthPct syncs from Year 2 override
 */

import { describe, it, expect } from 'vitest';
import { makeChainedValue } from '@/utils/proFormaChaining';
import type { ProFormaData } from '@/types';

// ── Replicate incomeRowHasOverride logic ──

function incomeRowHasOverride(
  field: 'grossRent' | 'otherIncome' | 'vacancyPct' | 'creditLossPct',
  yearOverrides: ProFormaData['yearOverrides'],
  projectionYears: number
): boolean {
  for (let y = 1; y <= projectionYears; y++) {
    const ov = yearOverrides?.[y];
    if (ov?.[field] === undefined) continue;
    if (field === 'grossRent' && ov.grossRentSystem === true) continue;
    return true;
  }
  return false;
}

// ── chainedValue tests ──────────────────────────────────────────────────────

describe('chainedValue — gross rent with pre-stab', () => {
  const stabilized = 504_000; // $1,400 × 30 units × 12
  const defaultGrowth = 2;

  it('Year 1 returns stabilized directly', () => {
    const chain = makeChainedValue({});
    expect(chain('grossRent', 'grossRentGrowthPct', stabilized, defaultGrowth, 1)).toBe(504_000);
  });

  it('Year 2 = stabilized × 1.02 when Year 1 is system override (pre-stab)', () => {
    const chain = makeChainedValue({
      1: { grossRent: 475_200, grossRentSystem: true },
    });
    const yr2 = chain('grossRent', 'grossRentGrowthPct', stabilized, defaultGrowth, 2);
    expect(yr2).toBeCloseTo(514_080, 0); // 504000 × 1.02
  });

  it('Year 3 = stabilized × 1.02² when Year 1 is pre-stab', () => {
    const chain = makeChainedValue({
      1: { grossRent: 475_200, grossRentSystem: true },
    });
    const yr3 = chain('grossRent', 'grossRentGrowthPct', stabilized, defaultGrowth, 3);
    expect(yr3).toBeCloseTo(524_361.6, 0); // 504000 × 1.02²
  });

  it('Year 2 uses Year 2 growth override, not default', () => {
    const chain = makeChainedValue({
      1: { grossRent: 475_200, grossRentSystem: true },
      2: { grossRentGrowthPct: 3 },
    });
    const yr2 = chain('grossRent', 'grossRentGrowthPct', stabilized, 2, 2);
    expect(yr2).toBeCloseTo(519_120, 0); // 504000 × 1.03
  });

  it('Year 3 uses Year 3 growth override independently', () => {
    const chain = makeChainedValue({
      1: { grossRent: 475_200, grossRentSystem: true },
      2: { grossRentGrowthPct: 2 },
      3: { grossRentGrowthPct: 4 },
    });
    const yr3 = chain('grossRent', 'grossRentGrowthPct', stabilized, 2, 3);
    // Year 2: 504000 × 1.02 = 514080
    // Year 3: 514080 × 1.04 = 534643.2
    expect(yr3).toBeCloseTo(534_643.2, 0);
  });

  it('growth rate carries forward from last override', () => {
    const chain = makeChainedValue({
      1: { grossRent: 475_200, grossRentSystem: true },
      2: { grossRentGrowthPct: 3 },
      // No Year 3 override — should carry Year 2 rate (3%)
    });
    const yr3 = chain('grossRent', 'grossRentGrowthPct', stabilized, 2, 3);
    // Year 2: 504000 × 1.03 = 519120
    // Year 3: 519120 × 1.03 = 534693.6
    expect(yr3).toBeCloseTo(534_693.6, 0);
  });

  it('manual Year 1 override anchors the chain (not skipped)', () => {
    const chain = makeChainedValue({
      1: { grossRent: 480_000 }, // manual, no grossRentSystem
    });
    const yr2 = chain('grossRent', 'grossRentGrowthPct', stabilized, defaultGrowth, 2);
    // Manual override anchors: 480000 × 1.02 = 489600
    expect(yr2).toBeCloseTo(489_600, 0);
  });

  it('no overrides at all: Year 2 = stabilized × (1 + default)', () => {
    const chain = makeChainedValue({});
    const yr2 = chain('grossRent', 'grossRentGrowthPct', stabilized, defaultGrowth, 2);
    expect(yr2).toBeCloseTo(514_080, 0);
  });

  it('default growth 3% with no overrides gives correct Year 2', () => {
    const chain = makeChainedValue({
      1: { grossRent: 475_200, grossRentSystem: true },
    });
    // defaultGrowth = 3, no yr2 override → uses 3%
    const yr2 = chain('grossRent', 'grossRentGrowthPct', stabilized, 3, 2);
    expect(yr2).toBeCloseTo(519_120, 0); // 504000 × 1.03
  });
});

// ── Auto-fix on load ────────────────────────────────────────────────────────

describe('auto-fix on load', () => {
  function autoFixGrowthPct(pf: { grossRent: { growthPct: number }; yearOverrides?: ProFormaData['yearOverrides'] }): number {
    const yr2Override = pf.yearOverrides?.[2]?.grossRentGrowthPct;
    return yr2Override !== undefined ? yr2Override : pf.grossRent.growthPct;
  }

  it('syncs base growthPct from Year 2 override', () => {
    expect(autoFixGrowthPct({
      grossRent: { growthPct: 3 },
      yearOverrides: { 2: { grossRentGrowthPct: 2 } },
    })).toBe(2);
  });

  it('keeps base growthPct when no Year 2 override exists', () => {
    expect(autoFixGrowthPct({
      grossRent: { growthPct: 3 },
      yearOverrides: {},
    })).toBe(3);
  });

  function shouldClearYr2Pin(yr2: { grossRent?: number; grossRentSystem?: boolean } | undefined, targetAnnual: number): boolean {
    if (!yr2?.grossRentSystem) return false;
    const yr2Rent = yr2.grossRent;
    const isStabilizing = typeof yr2Rent === 'number' && targetAnnual > 0 && yr2Rent < targetAnnual;
    return !isStabilizing;
  }

  it('clears stale Year 2 pin when grossRent >= target', () => {
    expect(shouldClearYr2Pin(
      { grossRent: 519_120, grossRentSystem: true },
      504_000
    )).toBe(true);
  });

  it('clears Year 2 pin when grossRent equals target', () => {
    expect(shouldClearYr2Pin(
      { grossRent: 504_000, grossRentSystem: true },
      504_000
    )).toBe(true); // not stabilizing, just pinned
  });

  it('keeps Year 2 pin when grossRent is below target (still stabilizing)', () => {
    expect(shouldClearYr2Pin(
      { grossRent: 480_000, grossRentSystem: true },
      504_000
    )).toBe(false);
  });

  it('does not clear non-system Year 2 override', () => {
    expect(shouldClearYr2Pin(
      { grossRent: 520_000 },
      504_000
    )).toBe(false);
  });
});

// ── Revert logic ────────────────────────────────────────────────────────────

describe('revert gross rent row', () => {
  function revertGrossRent(yearOverrides: ProFormaData['yearOverrides']): ProFormaData['yearOverrides'] {
    const prev = yearOverrides ?? {};
    const updated: NonNullable<ProFormaData['yearOverrides']> = {};
    for (const [yStr, ye] of Object.entries(prev)) {
      const y = Number(yStr);
      if (!ye) continue;
      const newYe = { ...ye };
      const isYr1System = y === 1 && newYe.grossRentSystem === true;
      if (!isYr1System) {
        delete (newYe as Record<string, unknown>).grossRent;
        delete (newYe as Record<string, unknown>).grossRentSystem;
      }
      if (y > 1) {
        delete (newYe as Record<string, unknown>).grossRent;
        delete (newYe as Record<string, unknown>).grossRentSystem;
      }
      if (Object.keys(newYe).length > 0) updated[y] = newYe;
    }
    return updated;
  }

  it('preserves Year 1 system (pre-stab) override', () => {
    const result = revertGrossRent({
      1: { grossRent: 475_200, grossRentSystem: true },
      2: { grossRent: 519_120, grossRentSystem: true, grossRentGrowthPct: 2 },
      3: { grossRentGrowthPct: 2 },
    });
    expect(result[1]?.grossRent).toBe(475_200);
    expect(result[1]?.grossRentSystem).toBe(true);
  });

  it('clears Year 2 grossRent pin but keeps growth override', () => {
    const result = revertGrossRent({
      1: { grossRent: 475_200, grossRentSystem: true },
      2: { grossRent: 519_120, grossRentSystem: true, grossRentGrowthPct: 2 },
    });
    expect(result[2]?.grossRent).toBeUndefined();
    expect(result[2]?.grossRentSystem).toBeUndefined();
    expect(result[2]?.grossRentGrowthPct).toBe(2);
  });

  it('clears Year 3+ grossRent overrides', () => {
    const result = revertGrossRent({
      1: { grossRent: 475_200, grossRentSystem: true },
      3: { grossRent: 530_000 },
    });
    expect(result[3]).toBeUndefined();
  });

  it('removes Year 1 manual override (not system)', () => {
    const result = revertGrossRent({
      1: { grossRent: 480_000 },
      2: { grossRentGrowthPct: 2 },
    });
    expect(result[1]).toBeUndefined();
    expect(result[2]?.grossRentGrowthPct).toBe(2);
  });

  it('empty overrides returns empty', () => {
    const result = revertGrossRent({});
    expect(Object.keys(result)).toHaveLength(0);
  });
});

// ── Revert button visibility ────────────────────────────────────────────────

describe('incomeRowHasOverride — revert button visibility', () => {
  it('hidden when only system (calculator) grossRent overrides exist', () => {
    expect(incomeRowHasOverride('grossRent', {
      1: { grossRent: 475_200, grossRentSystem: true },
      2: { grossRent: 504_000, grossRentSystem: true },
    }, 5)).toBe(false);
  });

  it('shown when manual grossRent override exists', () => {
    expect(incomeRowHasOverride('grossRent', {
      1: { grossRent: 475_200, grossRentSystem: true },
      3: { grossRent: 530_000 }, // manual — no grossRentSystem
    }, 5)).toBe(true);
  });

  it('shown when grossRentSystem is false (explicitly manual)', () => {
    expect(incomeRowHasOverride('grossRent', {
      2: { grossRent: 510_000, grossRentSystem: false },
    }, 5)).toBe(true);
  });

  it('hidden when no overrides at all', () => {
    expect(incomeRowHasOverride('grossRent', {}, 5)).toBe(false);
  });

  it('hidden when overrides exist but not for grossRent', () => {
    expect(incomeRowHasOverride('grossRent', {
      1: { vacancyPct: 10 },
      2: { grossRentGrowthPct: 3 },
    }, 5)).toBe(false);
  });

  it('shown for vacancyPct regardless of grossRentSystem', () => {
    // grossRentSystem flag only affects grossRent, not other fields
    expect(incomeRowHasOverride('vacancyPct', {
      1: { vacancyPct: 10, grossRentSystem: true },
    }, 5)).toBe(true);
  });

  it('shown for otherIncome with any override', () => {
    expect(incomeRowHasOverride('otherIncome', {
      2: { otherIncome: 1200 },
    }, 5)).toBe(true);
  });
});
