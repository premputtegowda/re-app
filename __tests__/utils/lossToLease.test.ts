/**
 * Tests for Loss to Lease anniversary model.
 *
 * The anniversary distribution is a 12-month histogram of units renewing per month.
 * Year 2+: before anniversary month = last year's rate, after = new market rate.
 * Year 1: uses overrides directly (no LTL applied).
 * No distribution: LTL = 0 (all units at market).
 */

import { describe, it, expect } from 'vitest';
import { makeProFormaProjector } from '@/utils/proFormaYearCalc';
import type { ProFormaData } from '@/types';

function makeProForma(overrides: Partial<ProFormaData> = {}): ProFormaData {
  return {
    grossRent:     { t12: 0, stab: null, stabilized: 168_000, growthPct: 2 }, // 10 units × $1400 × 12
    otherIncome:   { t12: 0, stab: null, stabilized: 0, growthPct: 0 },
    vacancyPct:    { t12: 0, stab: null, stabilized: 5 },
    creditLossPct: { t12: 0, stab: null, stabilized: 0 },
    expenses: [],
    yearOverrides: {},
    ...overrides,
  };
}

describe('Loss to Lease — anniversary model', () => {
  // Distribution: [1, 1, 2, 1, 2, 2, 1, 0, 0, 0, 0, 0] = 10 units
  const dist = [1, 1, 2, 1, 2, 2, 1, 0, 0, 0, 0, 0];

  describe('getMarketRentForYear', () => {
    it('Year 1: returns stabilized', () => {
      const pf = makeProForma({ leaseAnniversaryDistribution: dist });
      const proj = makeProFormaProjector(pf);
      expect(proj.getMarketRentForYear(1)).toBe(168_000);
    });

    it('Year 2: returns stabilized × 1.02', () => {
      const pf = makeProForma({ leaseAnniversaryDistribution: dist });
      const proj = makeProFormaProjector(pf);
      expect(proj.getMarketRentForYear(2)).toBeCloseTo(168_000 * 1.02, 0);
    });
  });

  describe('getGrossRentForYear — with distribution', () => {
    it('Year 1: returns stabilized (no LTL for Year 1)', () => {
      const pf = makeProForma({ leaseAnniversaryDistribution: dist });
      const proj = makeProFormaProjector(pf);
      expect(proj.getGrossRentForYear(1)).toBe(168_000);
    });

    it('Year 1 with override: returns override (pre-stab)', () => {
      const pf = makeProForma({
        leaseAnniversaryDistribution: dist,
        yearOverrides: { 1: { grossRent: 140_000, grossRentSystem: true } },
      });
      const proj = makeProFormaProjector(pf);
      expect(proj.getGrossRentForYear(1)).toBe(140_000);
    });

    it('Year 2: actual rent < market rent (LTL > 0)', () => {
      const pf = makeProForma({ leaseAnniversaryDistribution: dist });
      const proj = makeProFormaProjector(pf);
      const market = proj.getMarketRentForYear(2);
      const actual = proj.getGrossRentForYear(2);
      expect(actual).toBeLessThan(market);
    });

    it('Year 2: matches manual calculation', () => {
      // 10 units, $1400/mo target, 2% growth
      // marketRate = $1428, prevRate = $1400
      // dist: [1, 1, 2, 1, 2, 2, 1, 0, 0, 0, 0, 0]
      // Expected:
      //   m=0: 1 × 1428 × 12 = 17136
      //   m=1: 1 × (1400×1 + 1428×11) = 17108
      //   m=2: 2 × (1400×2 + 1428×10) = 34160
      //   m=3: 1 × (1400×3 + 1428×9)  = 17052
      //   m=4: 2 × (1400×4 + 1428×8)  = 34048
      //   m=5: 2 × (1400×5 + 1428×7)  = 33992
      //   m=6: 1 × (1400×6 + 1428×6)  = 16968
      //   Total = 170464
      const pf = makeProForma({ leaseAnniversaryDistribution: dist });
      const proj = makeProFormaProjector(pf);
      expect(proj.getGrossRentForYear(2)).toBeCloseTo(170_464, 0);
    });
  });

  describe('getLossToLeaseForYear', () => {
    it('Year 1: LTL = 0 (no LTL applied)', () => {
      const pf = makeProForma({ leaseAnniversaryDistribution: dist });
      const proj = makeProFormaProjector(pf);
      expect(proj.getLossToLeaseForYear(1)).toBe(0);
    });

    it('Year 1 with override: LTL = 0 (pre-stab)', () => {
      const pf = makeProForma({
        leaseAnniversaryDistribution: dist,
        yearOverrides: { 1: { grossRent: 140_000, grossRentSystem: true } },
      });
      const proj = makeProFormaProjector(pf);
      expect(proj.getLossToLeaseForYear(1)).toBe(0);
    });

    it('Year 2: LTL = market - actual', () => {
      const pf = makeProForma({ leaseAnniversaryDistribution: dist });
      const proj = makeProFormaProjector(pf);
      const market = proj.getMarketRentForYear(2);
      const ltl = proj.getLossToLeaseForYear(2);
      const actual = proj.getGrossRentForYear(2);
      expect(ltl).toBeCloseTo(market - actual, 0);
    });

    it('Year 2: LTL matches expected $896', () => {
      // Market = 10 × 1428 × 12 = 171360
      // Actual = 170464
      // LTL = 896
      const pf = makeProForma({ leaseAnniversaryDistribution: dist });
      const proj = makeProFormaProjector(pf);
      expect(proj.getLossToLeaseForYear(2)).toBeCloseTo(896, 0);
    });
  });

  describe('no distribution — backward compatibility', () => {
    it('getGrossRentForYear = getMarketRentForYear (no LTL)', () => {
      const pf = makeProForma(); // no distribution
      const proj = makeProFormaProjector(pf);
      expect(proj.getGrossRentForYear(2)).toBe(proj.getMarketRentForYear(2));
    });

    it('getLossToLeaseForYear = 0', () => {
      const pf = makeProForma();
      const proj = makeProFormaProjector(pf);
      expect(proj.getLossToLeaseForYear(2)).toBe(0);
    });
  });

  describe('all units in month 1 — no LTL', () => {
    it('LTL = 0 when all units renew month 1', () => {
      const pf = makeProForma({
        leaseAnniversaryDistribution: [10, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      });
      const proj = makeProFormaProjector(pf);
      expect(proj.getLossToLeaseForYear(2)).toBe(0);
      expect(proj.getGrossRentForYear(2)).toBe(proj.getMarketRentForYear(2));
    });
  });

  describe('LTL pattern repeats', () => {
    it('Year 3 LTL is proportionally similar to Year 2', () => {
      const pf = makeProForma({ leaseAnniversaryDistribution: dist });
      const proj = makeProFormaProjector(pf);
      const ltl2Pct = proj.getLossToLeaseForYear(2) / proj.getMarketRentForYear(2);
      const ltl3Pct = proj.getLossToLeaseForYear(3) / proj.getMarketRentForYear(3);
      // Should be approximately the same percentage
      expect(Math.abs(ltl2Pct - ltl3Pct)).toBeLessThan(0.001);
    });
  });
});
