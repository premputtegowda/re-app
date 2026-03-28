import { describe, it, expect } from 'vitest';
import {
  makeChainedValue,
  makeChainedExpenseValue,
  buildCascadeDownstream,
  applyCascade,
} from '@/utils/proFormaChaining';
import type { ProFormaData, ProFormaItem } from '@/types';

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

// ── buildCascadeDownstream ────────────────────────────────────────────────────

describe('buildCascadeDownstream', () => {
  describe('vacancyPct (flat field)', () => {
    it('returns all downstream years regardless of overrides', () => {
      const result = buildCascadeDownstream('vacancyPct', 2, 5, {});
      expect(result).toEqual([3, 4, 5]);
    });

    it('includes all years from year 1 stabilized edit', () => {
      const result = buildCascadeDownstream('vacancyPct', 1, 5, {});
      expect(result).toEqual([2, 3, 4, 5]);
    });

    it('returns empty when editing the last year', () => {
      const result = buildCascadeDownstream('vacancyPct', 5, 5, {});
      expect(result).toEqual([]);
    });
  });

  describe('creditLossPct (flat field)', () => {
    it('returns all downstream years', () => {
      const result = buildCascadeDownstream('creditLossPct', 1, 3, {});
      expect(result).toEqual([2, 3]);
    });
  });

  describe('grossRent (chained field)', () => {
    it('returns empty when no downstream overrides', () => {
      const result = buildCascadeDownstream('grossRent', 1, 5, {});
      expect(result).toEqual([]);
    });

    it('returns years that have a grossRent override', () => {
      const overrides: ProFormaData['yearOverrides'] = {
        3: { grossRent: 15000 },
        5: { grossRent: 17000 },
      };
      const result = buildCascadeDownstream('grossRent', 1, 5, overrides);
      expect(result).toEqual([3, 5]);
    });

    it('only returns years downstream of the edited year', () => {
      const overrides: ProFormaData['yearOverrides'] = {
        2: { grossRent: 14000 },
        4: { grossRent: 16000 },
      };
      // Editing year 3 — year 2 override is upstream, only year 4 is downstream
      const result = buildCascadeDownstream('grossRent', 3, 5, overrides);
      expect(result).toEqual([4]);
    });

    it('ignores years with no relevant override', () => {
      const overrides: ProFormaData['yearOverrides'] = {
        3: { vacancyPct: 8 }, // different field, should not count
      };
      const result = buildCascadeDownstream('grossRent', 1, 5, overrides);
      expect(result).toEqual([]);
    });
  });

  describe('otherIncome (chained field)', () => {
    it('returns years with otherIncome overrides downstream', () => {
      const overrides: ProFormaData['yearOverrides'] = {
        3: { otherIncome: 500 },
      };
      const result = buildCascadeDownstream('otherIncome', 1, 5, overrides);
      expect(result).toEqual([3]);
    });
  });
});

// ── applyCascade ──────────────────────────────────────────────────────────────

describe('applyCascade', () => {
  describe('flat fields (vacancyPct, creditLossPct)', () => {
    it('sets the same vacancyPct value in all specified downstream years', () => {
      const result = applyCascade('vacancyPct', [2, 3, 4, 5], 8, {});
      expect(result[2]?.vacancyPct).toBe(8);
      expect(result[3]?.vacancyPct).toBe(8);
      expect(result[4]?.vacancyPct).toBe(8);
      expect(result[5]?.vacancyPct).toBe(8);
    });

    it('sets the same creditLossPct value in all downstream years', () => {
      const result = applyCascade('creditLossPct', [3, 4, 5], 2, {});
      expect(result[3]?.creditLossPct).toBe(2);
      expect(result[4]?.creditLossPct).toBe(2);
      expect(result[5]?.creditLossPct).toBe(2);
    });

    it('preserves existing overrides in the same year entry', () => {
      const existing: ProFormaData['yearOverrides'] = {
        3: { grossRent: 15000, vacancyPct: 5 },
      };
      const result = applyCascade('vacancyPct', [3], 8, existing);
      expect(result[3]?.vacancyPct).toBe(8);
      expect(result[3]?.grossRent).toBe(15000); // not disturbed
    });

    it('does not modify years not in the cascade list', () => {
      const result = applyCascade('vacancyPct', [3, 4], 8, {});
      expect(result[2]).toBeUndefined();
      expect(result[5]).toBeUndefined();
    });
  });

  describe('chained fields (grossRent, otherIncome)', () => {
    it('removes grossRent override from downstream years', () => {
      const existing: ProFormaData['yearOverrides'] = {
        3: { grossRent: 15000 },
        4: { grossRent: 16000 },
      };
      const result = applyCascade('grossRent', [3, 4], undefined, existing);
      expect(result[3]?.grossRent).toBeUndefined();
      expect(result[4]?.grossRent).toBeUndefined();
    });

    it('also removes grossRentSystem flag when clearing grossRent', () => {
      const existing: ProFormaData['yearOverrides'] = {
        2: { grossRent: 12000, grossRentSystem: true },
      };
      const result = applyCascade('grossRent', [2], undefined, existing);
      expect(result[2]?.grossRent).toBeUndefined();
      expect(result[2]?.grossRentSystem).toBeUndefined();
    });

    it('removes the year entry entirely when no other overrides remain', () => {
      const existing: ProFormaData['yearOverrides'] = {
        3: { grossRent: 15000 },
      };
      const result = applyCascade('grossRent', [3], undefined, existing);
      expect(result[3]).toBeUndefined();
    });

    it('keeps year entry when other overrides still exist after clearing', () => {
      const existing: ProFormaData['yearOverrides'] = {
        3: { grossRent: 15000, vacancyPct: 8 },
      };
      const result = applyCascade('grossRent', [3], undefined, existing);
      expect(result[3]?.grossRent).toBeUndefined();
      expect(result[3]?.vacancyPct).toBe(8);
    });

    it('skips years with no existing override entry', () => {
      const existing: ProFormaData['yearOverrides'] = {
        4: { grossRent: 16000 },
      };
      // Year 3 has no entry — should be skipped gracefully
      const result = applyCascade('grossRent', [3, 4], undefined, existing);
      expect(result[3]).toBeUndefined();
      expect(result[4]?.grossRent).toBeUndefined();
    });

    it('removes otherIncome override from downstream years', () => {
      const existing: ProFormaData['yearOverrides'] = {
        3: { otherIncome: 500 },
      };
      const result = applyCascade('otherIncome', [3], undefined, existing);
      expect(result[3]?.otherIncome).toBeUndefined();
    });

    it('does not mutate the original yearOverrides object', () => {
      const existing: ProFormaData['yearOverrides'] = {
        3: { grossRent: 15000 },
      };
      applyCascade('grossRent', [3], undefined, existing);
      expect(existing[3]?.grossRent).toBe(15000); // original unchanged
    });
  });
});
