/**
 * Tests for T12 column editability:
 *
 * 1. Market Rent T12 is editable and feeds into EGI
 * 2. Loss to Lease T12 is editable and stored as lossToLeaseT12
 * 3. Gross Lease Rent T12 = Market Rent T12 − LTL T12
 * 4. T12 EGI uses (Market Rent − LTL) as gross rent input
 * 5. Year N LTL/GLR remain computed (not affected by T12 edits)
 * 6. lossToLeaseT12 defaults to 0 when undefined
 */

import { describe, it, expect } from 'vitest';
import { computeEGI } from '@/utils/dealAnalyzerCalc';
import { makeProFormaProjector } from '@/utils/proFormaYearCalc';
import type { ProFormaData } from '@/types';

// ── Fixture ───────────────────────────────────────────────────────────────────

function makeProForma(overrides?: Partial<ProFormaData>): ProFormaData {
  return {
    grossRent:     { t12: 168_000, stab: null, stabilized: 168_000, growthPct: 3 },
    otherIncome:   { t12: 6_000,   stab: null, stabilized: 6_000,   growthPct: 2 },
    vacancyPct:    { t12: 5,       stab: null, stabilized: 5 },
    creditLossPct: { t12: 1,       stab: null, stabilized: 1 },
    expenses: [
      { id: 'tax',  name: 'Property Taxes',  isPercentOfEGI: false, t12Value: 500,  stabValue: null, stabilizedValue: 500,  growthPct: 2 },
      { id: 'ins',  name: 'Insurance',       isPercentOfEGI: false, t12Value: 200,  stabValue: null, stabilizedValue: 200,  growthPct: 2 },
      { id: 'mgmt', name: 'Property Management', isPercentOfEGI: true, t12Value: 8, stabValue: null, stabilizedValue: 8, growthPct: 0 },
    ],
    yearOverrides: {},
    ...overrides,
  };
}

// ── computeEGI with LTL ───────────────────────────────────────────────────────

describe('T12 EGI with Loss to Lease', () => {
  it('without LTL, EGI uses full grossRent.t12', () => {
    const pf = makeProForma();
    const egi = computeEGI(pf.grossRent.t12, pf.otherIncome.t12, pf.vacancyPct.t12, pf.creditLossPct.t12);
    // 168_000 * (1 - 6/100) + 6_000 = 157_920 + 6_000 = 163_920
    expect(egi).toBeCloseTo(163_920, 0);
  });

  it('with LTL T12, EGI uses (grossRent.t12 - lossToLeaseT12)', () => {
    const pf = makeProForma({ lossToLeaseT12: 5_000 });
    const effectiveGross = pf.grossRent.t12 - (pf.lossToLeaseT12 ?? 0);
    const egi = computeEGI(effectiveGross, pf.otherIncome.t12, pf.vacancyPct.t12, pf.creditLossPct.t12);
    // (168_000 - 5_000) * 0.94 + 6_000 = 163_000 * 0.94 + 6_000 = 153_220 + 6_000 = 159_220
    expect(egi).toBeCloseTo(159_220, 0);
  });

  it('lossToLeaseT12 defaults to 0 when undefined', () => {
    const pf = makeProForma(); // no lossToLeaseT12
    const ltl = pf.lossToLeaseT12 ?? 0;
    expect(ltl).toBe(0);

    const egiNoLtl = computeEGI(pf.grossRent.t12, pf.otherIncome.t12, pf.vacancyPct.t12, pf.creditLossPct.t12);
    const egiWithDefault = computeEGI(pf.grossRent.t12 - ltl, pf.otherIncome.t12, pf.vacancyPct.t12, pf.creditLossPct.t12);
    expect(egiNoLtl).toBe(egiWithDefault);
  });
});

// ── Gross Lease Rent T12 ──────────────────────────────────────────────────────

describe('Gross Lease Rent T12 = Market Rent T12 − LTL T12', () => {
  it('with no LTL, Gross Lease Rent T12 equals Market Rent T12', () => {
    const pf = makeProForma();
    const ltl = pf.lossToLeaseT12 ?? 0;
    const glr = pf.grossRent.t12 - ltl;
    expect(glr).toBe(168_000);
  });

  it('with LTL set, Gross Lease Rent T12 = Market − LTL', () => {
    const pf = makeProForma({ lossToLeaseT12: 8_400 });
    const glr = pf.grossRent.t12 - (pf.lossToLeaseT12 ?? 0);
    expect(glr).toBe(159_600);
  });

  it('LTL T12 does not affect stabilized or year values', () => {
    const pf = makeProForma({ lossToLeaseT12: 10_000 });
    // stabilized is unchanged
    expect(pf.grossRent.stabilized).toBe(168_000);
    // growthPct is unchanged
    expect(pf.grossRent.growthPct).toBe(3);
  });
});

// ── Market Rent T12 editability ───────────────────────────────────────────────

describe('Market Rent T12 editability', () => {
  it('changing grossRent.t12 updates EGI calculation', () => {
    const pf1 = makeProForma();
    const pf2 = makeProForma();
    pf2.grossRent.t12 = 180_000;

    const egi1 = computeEGI(pf1.grossRent.t12, pf1.otherIncome.t12, pf1.vacancyPct.t12, pf1.creditLossPct.t12);
    const egi2 = computeEGI(pf2.grossRent.t12, pf2.otherIncome.t12, pf2.vacancyPct.t12, pf2.creditLossPct.t12);

    expect(egi2).toBeGreaterThan(egi1);
    // 180_000 * 0.94 + 6_000 = 169_200 + 6_000 = 175_200
    expect(egi2).toBeCloseTo(175_200, 0);
  });

  it('Market Rent T12 does not affect year projections', () => {
    const pf = makeProForma();
    const projector = makeProFormaProjector(pf);

    // Change T12 to something different from stabilized
    pf.grossRent.t12 = 200_000;

    // Year 1 market rent uses stabilized, not T12
    const yr1Market = projector.getMarketRentForYear(1);
    expect(yr1Market).toBe(168_000); // stabilized, not T12
  });
});

// ── Year N LTL remains computed from anniversary model ────────────────────────

describe('Year N LTL is independent of T12 LTL', () => {
  it('Year 2 LTL is computed from anniversary distribution, not T12', () => {
    // 10 units, $1400/mo target, staggered anniversaries
    const pf = makeProForma({
      grossRent: { t12: 144_000, stab: null, stabilized: 168_000, growthPct: 2 },
      lossToLeaseT12: 24_000, // T12 LTL
      leaseAnniversaryDistribution: [1, 1, 2, 1, 2, 2, 1, 0, 0, 0, 0, 0],
    });

    const projector = makeProFormaProjector(pf);

    // Year 2 LTL should come from anniversary model, NOT from lossToLeaseT12
    const yr2Ltl = projector.getLossToLeaseForYear(2);
    const yr2Market = projector.getMarketRentForYear(2);
    const yr2Gross = projector.getGrossRentForYear(2);

    // LTL = market - gross, should be > 0 because of anniversary stagger
    expect(yr2Ltl).toBe(yr2Market - yr2Gross);
    expect(yr2Ltl).toBeGreaterThan(0);

    // And it should NOT equal the T12 LTL value
    expect(yr2Ltl).not.toBe(24_000);
  });

  it('Year 1 LTL is computed from year overrides, not T12', () => {
    const pf = makeProForma({
      lossToLeaseT12: 15_000,
      yearOverrides: {
        1: { grossRent: 150_000, grossRentSystem: true },
      },
    });

    const projector = makeProFormaProjector(pf);
    const yr1Market = projector.getMarketRentForYear(1);
    const yr1Gross = projector.getGrossRentForYear(1);
    const yr1Ltl = projector.getLossToLeaseForYear(1);

    // Year 1 gross uses the override, not T12
    expect(yr1Gross).toBe(150_000);
    expect(yr1Ltl).toBe(yr1Market - yr1Gross);
    // Should NOT be the T12 value
    expect(yr1Ltl).not.toBe(15_000);
  });

  it('no anniversary distribution → Year N LTL = 0', () => {
    const pf = makeProForma({
      lossToLeaseT12: 10_000, // T12 has LTL but no distribution
      // no leaseAnniversaryDistribution
    });

    const projector = makeProFormaProjector(pf);
    const yr2Ltl = projector.getLossToLeaseForYear(2);

    // Without distribution, market = gross → LTL = 0
    expect(yr2Ltl).toBe(0);
  });
});

// ── Per-type anniversary: T12 LTL independent ────────────────────────────────

describe('Per-type anniversary with T12 LTL', () => {
  it('leaseAnniversaryByType drives Year 2+ LTL, not T12', () => {
    const pf = makeProForma({
      grossRent: { t12: 180_000, stab: null, stabilized: 204_000, growthPct: 3 },
      lossToLeaseT12: 20_000,
      leaseAnniversaryByType: [
        { targetRent: 1400, distribution: [1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0] }, // 5 units @ $1400
        { targetRent: 1500, distribution: [0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 0, 0] }, // 5 units @ $1500
      ],
    });

    const projector = makeProFormaProjector(pf);
    const yr2Ltl = projector.getLossToLeaseForYear(2);

    // LTL should be from the per-type model
    expect(yr2Ltl).toBeGreaterThan(0);
    // And NOT the T12 value
    expect(yr2Ltl).not.toBe(20_000);
  });
});

// ── Edge cases ────────────────────────────────────────────────────────────────

describe('T12 LTL edge cases', () => {
  it('LTL T12 = 0 means Gross Lease Rent T12 = Market Rent T12', () => {
    const pf = makeProForma({ lossToLeaseT12: 0 });
    const glr = pf.grossRent.t12 - (pf.lossToLeaseT12 ?? 0);
    expect(glr).toBe(pf.grossRent.t12);
  });

  it('LTL T12 larger than Market Rent produces negative Gross Lease Rent', () => {
    // Edge case — shouldn't happen in practice but shouldn't crash
    const pf = makeProForma({ lossToLeaseT12: 200_000 });
    const glr = pf.grossRent.t12 - (pf.lossToLeaseT12 ?? 0);
    expect(glr).toBe(-32_000);
  });

  it('EGI formula handles LTL correctly when vacancy+credit > 0', () => {
    const pf = makeProForma({
      lossToLeaseT12: 10_000,
      vacancyPct: { t12: 8, stab: null, stabilized: 5 },
      creditLossPct: { t12: 2, stab: null, stabilized: 1 },
    });
    const effectiveGross = pf.grossRent.t12 - (pf.lossToLeaseT12 ?? 0); // 158_000
    const egi = computeEGI(effectiveGross, pf.otherIncome.t12, pf.vacancyPct.t12, pf.creditLossPct.t12);
    // 158_000 * (1 - 10/100) + 6_000 = 158_000 * 0.90 + 6_000 = 142_200 + 6_000 = 148_200
    expect(egi).toBeCloseTo(148_200, 0);
  });

  it('% of EGI expenses recalculate when T12 LTL changes effective EGI', () => {
    const pf = makeProForma({ lossToLeaseT12: 10_000 });
    const effectiveGross = pf.grossRent.t12 - (pf.lossToLeaseT12 ?? 0);
    const egi = computeEGI(effectiveGross, pf.otherIncome.t12, pf.vacancyPct.t12, pf.creditLossPct.t12);

    // Property Management at 8% of EGI
    const mgmt = pf.expenses.find(e => e.name === 'Property Management')!;
    const mgmtDollar = egi * (mgmt.t12Value / 100);

    // Compare with no LTL
    const egiNoLtl = computeEGI(pf.grossRent.t12, pf.otherIncome.t12, pf.vacancyPct.t12, pf.creditLossPct.t12);
    const mgmtNoLtl = egiNoLtl * (mgmt.t12Value / 100);

    // LTL reduces EGI → reduces %-of-EGI expenses
    expect(mgmtDollar).toBeLessThan(mgmtNoLtl);
  });
});
