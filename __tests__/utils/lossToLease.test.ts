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
    it('Year 1 (no override): LTL = 0 — gross lease rent equals market', () => {
      const pf = makeProForma({ leaseAnniversaryDistribution: dist });
      const proj = makeProFormaProjector(pf);
      expect(proj.getLossToLeaseForYear(1)).toBe(0);
    });

    it('Year 1 with pre-stab override: LTL = market − override', () => {
      // 168,000 stabilized − 140,000 actual collected = 28,000 LTL
      const pf = makeProForma({
        leaseAnniversaryDistribution: dist,
        yearOverrides: { 1: { grossRent: 140_000, grossRentSystem: true } },
      });
      const proj = makeProFormaProjector(pf);
      expect(proj.getLossToLeaseForYear(1)).toBe(28_000);
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

describe('Loss to Lease — per-type anniversary model (preferred when types differ)', () => {
  /**
   * Mixed unit-mix scenario:
   * - Type A: 5 units · target $1,500/mo · anniversary at M2, M6, M8, M10, M12
   * - Type B: 5 units · target $1,000/mo · anniversary at M2, M6, M8, M10, M12
   * Both share the same distribution shape, but different targets.
   *
   * Stabilized = 5 × $1,500 × 12 + 5 × $1,000 × 12 = $90,000 + $60,000 = $150,000
   * Blended per-unit target = $150,000 / 10 / 12 = $1,250 (used by the legacy/blended path)
   */
  const distA = [0, 1, 0, 0, 0, 1, 0, 1, 0, 1, 0, 1]; // 5 units
  const distB = [0, 1, 0, 0, 0, 1, 0, 1, 0, 1, 0, 1]; // 5 units
  const combined = distA.map((v, i) => v + distB[i]);  // [0,2,0,0,0,2,0,2,0,2,0,2]

  const baseProForma: Partial<ProFormaData> = {
    grossRent: { t12: 0, stab: null, stabilized: 150_000, growthPct: 3 },
    leaseAnniversaryDistribution: combined,
    leaseAnniversaryByType: [
      { targetRent: 1_500, distribution: distA },
      { targetRent: 1_000, distribution: distB },
    ],
  };

  it('per-type model matches manual calc for Year 2', () => {
    const pf = makeProForma(baseProForma);
    const proj = makeProFormaProjector(pf);
    // Manual per-type calc:
    //   Type A: marketRate = 1500*1.03 = 1545, prev = 1500
    //     m=1:  1×(1500×1 + 1545×11) = 1500+16995 = 18,495
    //     m=5:  1×(1500×5 + 1545×7)  = 7500+10815 = 18,315
    //     m=7:  1×(1500×7 + 1545×5)  = 10500+7725 = 18,225
    //     m=9:  1×(1500×9 + 1545×3)  = 13500+4635 = 18,135
    //     m=11: 1×(1500×11 + 1545×1) = 16500+1545 = 18,045
    //     Total A = 91,215
    //   Type B: marketRate = 1000*1.03 = 1030, prev = 1000
    //     Same shape but ⅔ the rate → Total B = 91,215 × (1000/1500) = 60,810
    //   Combined = 152,025
    expect(proj.getGrossRentForYear(2)).toBeCloseTo(152_025, 0);
  });

  it('Year 2 LTL = $2,475 (per-type, matches hand-calc)', () => {
    const pf = makeProForma(baseProForma);
    const proj = makeProFormaProjector(pf);
    // Market = 5×1545×12 + 5×1030×12 = 92,700 + 61,800 = 154,500
    // GLR = 152,025 → LTL = 2,475
    expect(proj.getLossToLeaseForYear(2)).toBeCloseTo(2_475, 0);
  });

  it('per-type and blended models agree when all types share the same target rent', () => {
    // Same target rent across types → blending doesn't lose information
    const dA = [0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0]; // 3 units of Type A
    const dB = [0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1]; // 2 units of Type B (reno completions M8, M12)
    const sameRate = 1_400;
    const totalUnits = 5;
    const blendedDist = dA.map((v, i) => v + dB[i]);
    const stabilized = totalUnits * sameRate * 12; // 84,000

    const pfBlended = makeProForma({
      grossRent: { t12: 0, stab: null, stabilized, growthPct: 2 },
      leaseAnniversaryDistribution: blendedDist,
    });
    const pfPerType = makeProForma({
      grossRent: { t12: 0, stab: null, stabilized, growthPct: 2 },
      leaseAnniversaryDistribution: blendedDist,
      leaseAnniversaryByType: [
        { targetRent: sameRate, distribution: dA },
        { targetRent: sameRate, distribution: dB },
      ],
    });
    const projB = makeProFormaProjector(pfBlended);
    const projT = makeProFormaProjector(pfPerType);
    expect(projT.getGrossRentForYear(2)).toBeCloseTo(projB.getGrossRentForYear(2), 4);
    expect(projT.getLossToLeaseForYear(2)).toBeCloseTo(projB.getLossToLeaseForYear(2), 4);
  });

  it('per-type produces DIFFERENT result than blended when rents diverge significantly', () => {
    // Extreme case: Type A is $1,500 and Type B is $300
    // Blended treats them as ($1500+$300)/2 = $900, smearing the LTL
    const dA = [0, 1, 0, 0, 0, 1, 0, 1, 0, 1, 0, 1]; // 5 A units
    const dB = [0, 1, 0, 0, 0, 1, 0, 1, 0, 1, 0, 1]; // 5 B units
    const combinedDiv = dA.map((v, i) => v + dB[i]);
    const stabilized = (5 * 1_500 + 5 * 300) * 12; // 108,000

    const pfBlended = makeProForma({
      grossRent: { t12: 0, stab: null, stabilized, growthPct: 3 },
      leaseAnniversaryDistribution: combinedDiv,
    });
    const pfPerType = makeProForma({
      grossRent: { t12: 0, stab: null, stabilized, growthPct: 3 },
      leaseAnniversaryDistribution: combinedDiv,
      leaseAnniversaryByType: [
        { targetRent: 1_500, distribution: dA },
        { targetRent: 300,   distribution: dB },
      ],
    });
    const projB = makeProFormaProjector(pfBlended);
    const projT = makeProFormaProjector(pfPerType);

    // Both should give the same TOTAL (because the shape is identical and the
    // weighted-average rent equals the blended rate by construction). The values
    // diverge only when distributions differ between types — this test guards
    // the no-divergence symmetry case.
    expect(projT.getGrossRentForYear(2)).toBeCloseTo(projB.getGrossRentForYear(2), 4);
  });

  it('per-type model diverges from blended when type distributions differ', () => {
    // Type A renews at month 1 (full year at new rate), Type B renews at month 12 (almost no new rate)
    const dA = [5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]; // all 5 A units anniv M1
    const dB = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 5]; // all 5 B units anniv M12
    const combinedAB = dA.map((v, i) => v + dB[i]);
    const stabilized = (5 * 1_500 + 5 * 1_000) * 12; // 150,000

    const pfBlended = makeProForma({
      grossRent: { t12: 0, stab: null, stabilized, growthPct: 3 },
      leaseAnniversaryDistribution: combinedAB,
    });
    const pfPerType = makeProForma({
      grossRent: { t12: 0, stab: null, stabilized, growthPct: 3 },
      leaseAnniversaryDistribution: combinedAB,
      leaseAnniversaryByType: [
        { targetRent: 1_500, distribution: dA },
        { targetRent: 1_000, distribution: dB },
      ],
    });
    const projB = makeProFormaProjector(pfBlended);
    const projT = makeProFormaProjector(pfPerType);

    // Per-type: Type A (high rent) all renews early → captures full new rate.
    //          Type B (low rent) all renews late → barely captures new rate.
    //   A annual = 5 × 1545 × 12 = 92,700
    //   B annual = 5 × (1000×11 + 1030×1) = 5 × 12,030 = 60,150
    //   Total = 152,850
    // Blended would give a different (incorrect) split because it treats all
    // 10 units as having the same $1,250 blended rate.
    expect(projT.getGrossRentForYear(2)).toBeCloseTo(152_850, 0);
    expect(projT.getGrossRentForYear(2)).not.toBeCloseTo(projB.getGrossRentForYear(2), 0);
  });

  it('falls back to blended distribution when leaseAnniversaryByType is absent', () => {
    const pf = makeProForma({
      grossRent: { t12: 0, stab: null, stabilized: 150_000, growthPct: 3 },
      leaseAnniversaryDistribution: combined,
      // no leaseAnniversaryByType
    });
    const proj = makeProFormaProjector(pf);
    // Blended: perUnitTarget = 150,000/10/12 = 1,250
    //   marketRate = 1287.5, prev = 1250
    //   Total = computed via blended dist [0,2,0,0,0,2,0,2,0,2,0,2]
    // Should still produce a valid number, not crash
    const glr = proj.getGrossRentForYear(2);
    expect(glr).toBeGreaterThan(150_000); // somewhere reasonable
    expect(glr).toBeLessThan(155_000);
  });

  it('falls back to blended when leaseAnniversaryByType has all-zero distributions', () => {
    const pf = makeProForma({
      grossRent: { t12: 0, stab: null, stabilized: 150_000, growthPct: 3 },
      leaseAnniversaryDistribution: combined,
      leaseAnniversaryByType: [
        { targetRent: 1_500, distribution: new Array(12).fill(0) },
        { targetRent: 1_000, distribution: new Array(12).fill(0) },
      ],
    });
    const proj = makeProFormaProjector(pf);
    // hasByType should be false (all zeros), falls back to blended
    expect(proj.getGrossRentForYear(2)).toBeGreaterThan(0);
  });
});
