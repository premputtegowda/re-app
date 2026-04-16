/**
 * Tests for the per-year growth-rate override behavior on the income side.
 *
 * Bug being fixed: the original `setYearGrowthPct` in ProFormaGrid also overwrote
 * `data.grossRent.growthPct` (the base rate). That side-effect leaked the new rate
 * back to years BEFORE the override year — e.g., setting Year 3 to 5% silently
 * changed Year 2 from 3% to 5% as well.
 *
 * Correct behavior: only year-specific overrides change. Base stays put.
 * Years < override year continue to use the base. Years >= override year cascade
 * the new rate.
 */

import { describe, it, expect } from 'vitest';
import { applyIncomeGrowthOverride } from '@/utils/incomeGrowthOverride';
import { makeProFormaProjector } from '@/utils/proFormaYearCalc';
import type { ProFormaData } from '@/types';

function makePF(overrides: Partial<ProFormaData> = {}): ProFormaData {
  return {
    grossRent:     { t12: 0, stab: null, stabilized: 168_000, growthPct: 3 },
    otherIncome:   { t12: 0, stab: null, stabilized: 0, growthPct: 0 },
    vacancyPct:    { t12: 0, stab: null, stabilized: 0 },
    creditLossPct: { t12: 0, stab: null, stabilized: 0 },
    expenses: [],
    yearOverrides: {},
    ...overrides,
  };
}

describe('applyIncomeGrowthOverride — does not pollute base rate', () => {
  it('does NOT mutate data.grossRent.growthPct (the base)', () => {
    const pf = makePF();
    const after = applyIncomeGrowthOverride(pf, 3, 'grossRentGrowthPct', 5, 5);
    expect(after.grossRent.growthPct).toBe(3); // base unchanged
  });

  it('does NOT mutate data.otherIncome.growthPct (the base)', () => {
    const pf = makePF({ otherIncome: { t12: 0, stab: null, stabilized: 12_000, growthPct: 2 } });
    const after = applyIncomeGrowthOverride(pf, 3, 'otherIncomeGrowthPct', 5, 5);
    expect(after.otherIncome.growthPct).toBe(2); // base unchanged
  });

  it('writes the override to year, year+1, ..., projectionYears', () => {
    const pf = makePF();
    const after = applyIncomeGrowthOverride(pf, 3, 'grossRentGrowthPct', 5, 5);
    expect(after.yearOverrides?.[2]?.grossRentGrowthPct).toBeUndefined();
    expect(after.yearOverrides?.[3]?.grossRentGrowthPct).toBe(5);
    expect(after.yearOverrides?.[4]?.grossRentGrowthPct).toBe(5);
    expect(after.yearOverrides?.[5]?.grossRentGrowthPct).toBe(5);
  });
});

describe('applyIncomeGrowthOverride — Market Rent computation reflects intent', () => {
  // Stabilized = 168,000 (10 units × $1,400 × 12), base growth 3%
  // Set Year 3 growth to 5% (push-to-future) — Year 2 should stay at 3%

  it('Year 2 keeps the original 3% base after a Year 3 override', () => {
    const pf = makePF();
    const after = applyIncomeGrowthOverride(pf, 3, 'grossRentGrowthPct', 5, 5);
    const proj = makeProFormaProjector(after);
    // Year 2 = 168,000 × 1.03 = 173,040 (base growth, not the new 5%)
    expect(proj.getMarketRentForYear(2)).toBeCloseTo(168_000 * 1.03, 0);
  });

  it('Year 3 uses the new 5% rate', () => {
    const pf = makePF();
    const after = applyIncomeGrowthOverride(pf, 3, 'grossRentGrowthPct', 5, 5);
    const proj = makeProFormaProjector(after);
    // Year 3 = 168,000 × 1.03 × 1.05 = 181,692
    expect(proj.getMarketRentForYear(3)).toBeCloseTo(168_000 * 1.03 * 1.05, 0);
  });

  it('Year 4 carries the 5% rate forward', () => {
    const pf = makePF();
    const after = applyIncomeGrowthOverride(pf, 3, 'grossRentGrowthPct', 5, 5);
    const proj = makeProFormaProjector(after);
    // Year 4 = Year 3 × 1.05
    expect(proj.getMarketRentForYear(4)).toBeCloseTo(168_000 * 1.03 * 1.05 * 1.05, 0);
  });
});

describe('applyIncomeGrowthOverride — preserves other override fields', () => {
  it('does not wipe an existing grossRent override on the same year', () => {
    const pf = makePF({
      yearOverrides: { 3: { grossRent: 200_000, grossRentSystem: false } },
    });
    const after = applyIncomeGrowthOverride(pf, 3, 'grossRentGrowthPct', 5, 5);
    expect(after.yearOverrides?.[3]?.grossRent).toBe(200_000);
    expect(after.yearOverrides?.[3]?.grossRentSystem).toBe(false);
    expect(after.yearOverrides?.[3]?.grossRentGrowthPct).toBe(5);
  });

  it('clears toggleOffGrowthPcts flag for the field on cascaded years', () => {
    const pf = makePF({
      yearOverrides: { 3: { grossRentGrowthPct: 4, toggleOffGrowthPcts: { grossRentGrowthPct: true } } },
    });
    const after = applyIncomeGrowthOverride(pf, 3, 'grossRentGrowthPct', 5, 5);
    expect(after.yearOverrides?.[3]?.toggleOffGrowthPcts?.grossRentGrowthPct).toBeUndefined();
  });
});
