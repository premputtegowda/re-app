import { describe, it, expect } from 'vitest';
import {
  makeChainedValue,
  makeChainedExpenseValue,
} from '@/utils/proFormaChaining';
import type { ProFormaItem } from '@/types';

// ── makeChainedValue ──────────────────────────────────────────────────────────

describe('makeChainedValue', () => {
  const chain = makeChainedValue({});

  it('returns stabilized for year 1', () => {
    expect(chain('grossRent', 'grossRentGrowthPct', 12000, 3, 1)).toBe(12000);
  });

  it('applies default growth from stabilized for year 2 with no overrides', () => {
    const result = chain('grossRent', 'grossRentGrowthPct', 12000, 3, 2);
    expect(result).toBeCloseTo(12000 * 1.03, 2);
  });

  it('compounds growth over multiple years', () => {
    const result = chain('grossRent', 'grossRentGrowthPct', 12000, 3, 5);
    expect(result).toBeCloseTo(12000 * Math.pow(1.03, 4), 2);
  });

  it('rebases from year N override when computing year N+1', () => {
    const overrides = { 2: { grossRent: 15000 } };
    const chainWithOverride = makeChainedValue(overrides);
    // year 3 = year2Override * (1 + growth)
    const result = chainWithOverride('grossRent', 'grossRentGrowthPct', 12000, 3, 3);
    expect(result).toBeCloseTo(15000 * 1.03, 2);
  });

  it('rebases from year 3 override when computing year 4', () => {
    const overrides = { 3: { grossRent: 20000 } };
    const chainWithOverride = makeChainedValue(overrides);
    const result = chainWithOverride('grossRent', 'grossRentGrowthPct', 12000, 3, 4);
    expect(result).toBeCloseTo(20000 * 1.03, 2);
  });

  it('uses year-specific growth rate override', () => {
    const overrides = { 3: { grossRentGrowthPct: 5 } };
    const chainWithOverride = makeChainedValue(overrides);
    // year 2: 12000 * 1.03, year 3: year2 * 1.05
    const year2 = 12000 * 1.03;
    const result = chainWithOverride('grossRent', 'grossRentGrowthPct', 12000, 3, 3);
    expect(result).toBeCloseTo(year2 * 1.05, 2);
  });

  it('rebases from intervening year override in a chain', () => {
    const overrides = { 2: { grossRent: 14000 }, 4: { grossRent: 20000 } };
    const chainWithOverride = makeChainedValue(overrides);
    // year 5: rebases from year 4 override = 20000 * 1.03
    const result = chainWithOverride('grossRent', 'grossRentGrowthPct', 12000, 3, 5);
    expect(result).toBeCloseTo(20000 * 1.03, 2);
  });

  it('works for otherIncome field', () => {
    const overrides = { 2: { otherIncome: 5000 } };
    const chainWithOverride = makeChainedValue(overrides);
    const result = chainWithOverride('otherIncome', 'otherIncomeGrowthPct', 3000, 2, 3);
    expect(result).toBeCloseTo(5000 * 1.02, 2);
  });

  // ── system override (grossRentSystem: true) ────────────────────────────────

  it('skips system override in year 1 — year 2 chains from stabilized', () => {
    // Year 1 is a calculator-set pre-stab value; chain must ignore it
    const overrides = { 1: { grossRent: 9000, grossRentSystem: true } };
    const chainWithOverride = makeChainedValue(overrides);
    // year 2 = stabilized * (1 + 3%) — NOT 9000 * 1.03
    const result = chainWithOverride('grossRent', 'grossRentGrowthPct', 12000, 3, 2);
    expect(result).toBeCloseTo(12000 * 1.03, 2);
  });

  it('skips system overrides in years 1 and 2 — year 3 chains from stabilized', () => {
    // Multi-year pre-stab: years 1 and 2 come from calculator
    const overrides = {
      1: { grossRent: 8000, grossRentSystem: true },
      2: { grossRent: 10000, grossRentSystem: true },
    };
    const chainWithOverride = makeChainedValue(overrides);
    // year 3 = stabilized * (1+3%)^2 — system overrides for yr 1 and yr 2 are ignored
    const result = chainWithOverride('grossRent', 'grossRentGrowthPct', 12000, 3, 3);
    expect(result).toBeCloseTo(12000 * Math.pow(1.03, 2), 2);
  });

  it('system override in year 1 but manual override in year 2 — year 3 rebases from year 2', () => {
    // Year 1 is system (skipped), year 2 is a user override (not skipped)
    const overrides = {
      1: { grossRent: 8000, grossRentSystem: true },
      2: { grossRent: 14000 },
    };
    const chainWithOverride = makeChainedValue(overrides);
    const result = chainWithOverride('grossRent', 'grossRentGrowthPct', 12000, 3, 3);
    expect(result).toBeCloseTo(14000 * 1.03, 2);
  });

  it('any Yr1 override (non-grossRent) rebases Yr2 — consistent with all other years', () => {
    // A Yr1 otherIncome edit anchors the chain; Yr2 chains from the Yr1 override value
    const plainOverride = { 1: { otherIncome: 500 } };
    const chainPlain = makeChainedValue(plainOverride);
    expect(chainPlain('otherIncome', 'otherIncomeGrowthPct', 1000, 2, 2)).toBeCloseTo(500 * 1.02, 2);
  });

  it('per-year growth rates accumulate correctly across system-skipped years', () => {
    // Year 1 system override skipped; year 3 has a 5% growth override
    const overrides = {
      1: { grossRent: 9000, grossRentSystem: true },
      3: { grossRentGrowthPct: 5 },
    };
    const chainWithOverride = makeChainedValue(overrides);
    // year 2 = 12000 * 1.03 (default), year 3 = year2 * 1.05
    const year2 = 12000 * 1.03;
    const result = chainWithOverride('grossRent', 'grossRentGrowthPct', 12000, 3, 3);
    expect(result).toBeCloseTo(year2 * 1.05, 2);
  });
});

describe('makeChainedValue — flat-chain fields (vacancyPct / creditLossPct)', () => {
  it('vacancyPct: no overrides — all years equal stabilized (flat chain, 0% growth)', () => {
    const chain = makeChainedValue({});
    expect(chain('vacancyPct', null, 5, 0, 2)).toBeCloseTo(5, 4);
    expect(chain('vacancyPct', null, 5, 0, 5)).toBeCloseTo(5, 4);
  });

  it('vacancyPct: override in Yr2 rebases Yr3+', () => {
    const overrides = { 2: { vacancyPct: 10 } };
    const chainWithOverride = makeChainedValue(overrides);
    expect(chainWithOverride('vacancyPct', null, 5, 0, 3)).toBeCloseTo(10, 4);
    expect(chainWithOverride('vacancyPct', null, 5, 0, 4)).toBeCloseTo(10, 4);
  });

  it('vacancyPct: Yr1 override rebases Yr2+', () => {
    const overrides = { 1: { vacancyPct: 20 } };
    const chainWithOverride = makeChainedValue(overrides);
    expect(chainWithOverride('vacancyPct', null, 5, 0, 2)).toBeCloseTo(20, 4);
    expect(chainWithOverride('vacancyPct', null, 5, 0, 3)).toBeCloseTo(20, 4);
  });

  it('vacancyPct: mid-chain override; downstream years carry the overridden value', () => {
    const overrides = { 3: { vacancyPct: 8 } };
    const chainWithOverride = makeChainedValue(overrides);
    expect(chainWithOverride('vacancyPct', null, 5, 0, 2)).toBeCloseTo(5, 4);  // before override
    expect(chainWithOverride('vacancyPct', null, 5, 0, 4)).toBeCloseTo(8, 4);  // after override
  });

  it('creditLossPct: override in Yr3 rebases Yr4+', () => {
    const overrides = { 3: { creditLossPct: 2 } };
    const chainWithOverride = makeChainedValue(overrides);
    expect(chainWithOverride('creditLossPct', null, 0, 0, 2)).toBeCloseTo(0, 4);
    expect(chainWithOverride('creditLossPct', null, 0, 0, 4)).toBeCloseTo(2, 4);
  });
});

// ── makeChainedExpenseValue ───────────────────────────────────────────────────

describe('makeChainedExpenseValue', () => {
  const expense: ProFormaItem = {
    id: 'exp-1',
    name: 'Repairs',
    isPercentOfEGI: false,
    t12Value: 1000,
    stabValue: null,
    stabilizedValue: 1200,
    growthPct: 2,
  };

  it('returns stabilizedValue for year 1', () => {
    const chain = makeChainedExpenseValue({});
    expect(chain(expense, 1)).toBe(1200);
  });

  it('applies growth from stabilized for year 2', () => {
    const chain = makeChainedExpenseValue({});
    expect(chain(expense, 2)).toBeCloseTo(1200 * 1.02, 2);
  });

  it('rebases from year 2 override', () => {
    const overrides = { 2: { expenses: { 'exp-1': 1500 } } };
    const chain = makeChainedExpenseValue(overrides);
    expect(chain(expense, 3)).toBeCloseTo(1500 * 1.02, 2);
  });

  it('uses per-year growth rate override', () => {
    const overrides = { 3: { expenseGrowthPcts: { 'exp-1': 5 } } };
    const chain = makeChainedExpenseValue(overrides);
    const year2 = 1200 * 1.02;
    expect(chain(expense, 3)).toBeCloseTo(year2 * 1.05, 2);
  });
});

