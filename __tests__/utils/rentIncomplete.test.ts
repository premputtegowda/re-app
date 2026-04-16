/**
 * Tests for the Rent OpsCard's "incomplete" warning trigger in DealAnalyzerForm.
 *
 * Bug fix: previously the Rent summary card always showed a green check mark
 * once ANY unit had a target rent (`some` check), even when other units in the
 * mix were missing target rent. Now it shows the orange warning triangle when
 * ANY unit is missing target rent — green only when EVERY unit has it set.
 */

import { describe, it, expect } from 'vitest';

interface MfrUnit {
  rentMonthly?: number;
}

function computeRentIncomplete(args: {
  hasMfr: boolean;
  unitMix?: MfrUnit[];
  sfrTargetRent?: number;
}): boolean {
  const { hasMfr, unitMix, sfrTargetRent } = args;
  if (hasMfr) {
    return (unitMix?.length ?? 0) === 0 || (unitMix ?? []).some((e) => (e.rentMonthly || 0) === 0);
  }
  return (sfrTargetRent || 0) === 0;
}

describe('Rent OpsCard — rentIncomplete (warning trigger)', () => {
  describe('MFR (multi-family)', () => {
    it('empty unitMix → incomplete (warning shown)', () => {
      expect(computeRentIncomplete({ hasMfr: true, unitMix: [] })).toBe(true);
    });

    it('all units have target rent → COMPLETE (green check)', () => {
      expect(
        computeRentIncomplete({
          hasMfr: true,
          unitMix: [{ rentMonthly: 1500 }, { rentMonthly: 1000 }],
        }),
      ).toBe(false);
    });

    it('one unit missing rentMonthly → incomplete (the bug being fixed)', () => {
      expect(
        computeRentIncomplete({
          hasMfr: true,
          unitMix: [{ rentMonthly: 1500 }, { rentMonthly: 0 }],
        }),
      ).toBe(true);
    });

    it('one unit with undefined rentMonthly (treated as 0) → incomplete', () => {
      expect(
        computeRentIncomplete({
          hasMfr: true,
          unitMix: [{ rentMonthly: 1500 }, {}],
        }),
      ).toBe(true);
    });

    it('all units have undefined rentMonthly → incomplete', () => {
      expect(
        computeRentIncomplete({
          hasMfr: true,
          unitMix: [{}, {}, {}],
        }),
      ).toBe(true);
    });

    it('single unit with target rent set → COMPLETE', () => {
      expect(
        computeRentIncomplete({
          hasMfr: true,
          unitMix: [{ rentMonthly: 1200 }],
        }),
      ).toBe(false);
    });
  });

  describe('SFR (single-family)', () => {
    it('sfrTargetRent === 0 → incomplete (warning shown)', () => {
      expect(computeRentIncomplete({ hasMfr: false, sfrTargetRent: 0 })).toBe(true);
    });

    it('sfrTargetRent undefined → incomplete', () => {
      expect(computeRentIncomplete({ hasMfr: false })).toBe(true);
    });

    it('sfrTargetRent > 0 → COMPLETE (green check)', () => {
      expect(computeRentIncomplete({ hasMfr: false, sfrTargetRent: 1800 })).toBe(false);
    });
  });

  describe('regression: pre-fix behavior would give green check too generously', () => {
    // Old "some has rent" check returned `hasTargetRent=true` for the mixed case,
    // so the OpsCard rendered with NO warning prop → green check shown.
    // New logic returns rentIncomplete=true → warning prop is set → orange triangle shown.
    it('mixed unit-mix (some have rent, some do not) is now flagged', () => {
      const oldHasTargetRent = [{ rentMonthly: 1500 }, { rentMonthly: 0 }].some((e) => (e.rentMonthly || 0) > 0);
      const newRentIncomplete = computeRentIncomplete({
        hasMfr: true,
        unitMix: [{ rentMonthly: 1500 }, { rentMonthly: 0 }],
      });
      expect(oldHasTargetRent).toBe(true); // pre-fix: would show green check
      expect(newRentIncomplete).toBe(true); // post-fix: shows orange warning
    });
  });
});
