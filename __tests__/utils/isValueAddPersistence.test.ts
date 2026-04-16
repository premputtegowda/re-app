/**
 * Tests for isValueAdd persistence and ProForma visibility.
 *
 * 1. isValueAdd is the USER's explicit choice (yes/no) — the system must
 *    never infer it from other data. It persists via calcState.isValueAdd.
 *
 * 2. The ProForma grid is hidden entirely when any of the three Operations
 *    sub-sections (rent, value-add, stabilization) has a warning.
 */

import { describe, it, expect } from 'vitest';
import type { CalcPersistedState } from '@/types';

// ── isValueAdd initialization ────────────────────────────────────────────────
// Replicates the useState initializer from DealAnalyzerForm.

interface InitialDeal {
  calcState?: Partial<CalcPersistedState> | null;
  acquisition: {
    propertyType: 'mfr' | 'sfr';
    unitMix: { preStabRent?: number; rentMonthly?: number; unitsToRenovate?: number; leaseUpUnits?: number }[];
    sfrPreStabRent?: number;
  };
  proForma: {
    yearOverrides?: Record<number, { grossRentSystem?: boolean }>;
  };
}

function initIsValueAdd(initialDeal: InitialDeal | null): boolean | null {
  if (initialDeal?.calcState?.isValueAdd !== undefined) return initialDeal.calcState.isValueAdd ?? null;
  if (!initialDeal) return null;
  const isMfr = initialDeal.acquisition.propertyType === 'mfr';
  const hasPreStab = isMfr
    ? initialDeal.acquisition.unitMix.some(e => (e.preStabRent || 0) > 0)
    : (initialDeal.acquisition.sfrPreStabRent || 0) > 0;
  const hasCalcOverrides = Object.values(initialDeal.proForma.yearOverrides ?? {}).some(ov => ov?.grossRentSystem);
  if (hasPreStab || hasCalcOverrides) return true;
  return null;
}

describe('isValueAdd initialization — user choice, not system inference', () => {
  it('uses calcState.isValueAdd when explicitly saved as true', () => {
    expect(initIsValueAdd({
      calcState: { isValueAdd: true },
      acquisition: { propertyType: 'mfr', unitMix: [] },
      proForma: {},
    })).toBe(true);
  });

  it('uses calcState.isValueAdd when explicitly saved as false', () => {
    expect(initIsValueAdd({
      calcState: { isValueAdd: false },
      acquisition: { propertyType: 'mfr', unitMix: [{ unitsToRenovate: 5 }] },
      proForma: {},
    })).toBe(false);
  });

  it('returns null for new deals (no initialDeal)', () => {
    expect(initIsValueAdd(null)).toBeNull();
  });

  it('returns null when calcState is null and no legacy indicators exist', () => {
    expect(initIsValueAdd({
      calcState: null,
      acquisition: { propertyType: 'mfr', unitMix: [{ rentMonthly: 1500 }] },
      proForma: {},
    })).toBeNull();
  });

  it('does NOT infer true from reno/lease-up units alone (that is a user decision)', () => {
    expect(initIsValueAdd({
      calcState: null,
      acquisition: { propertyType: 'mfr', unitMix: [{ unitsToRenovate: 5, leaseUpUnits: 3 }] },
      proForma: {},
    })).toBeNull();
  });

  it('legacy fallback: infers true from preStabRent (deals saved before isValueAdd was persisted)', () => {
    expect(initIsValueAdd({
      calcState: null,
      acquisition: { propertyType: 'mfr', unitMix: [{ preStabRent: 1200 }] },
      proForma: {},
    })).toBe(true);
  });

  it('legacy fallback: infers true from grossRentSystem overrides', () => {
    expect(initIsValueAdd({
      calcState: null,
      acquisition: { propertyType: 'mfr', unitMix: [] },
      proForma: { yearOverrides: { 1: { grossRentSystem: true } } },
    })).toBe(true);
  });
});

// ── isValueAdd persistence to calcState ──────────────────────────────────────

function applyIsValueAddToCalcState(
  prev: Partial<CalcPersistedState> | undefined,
  isValueAdd: boolean | null,
): Partial<CalcPersistedState> | undefined {
  if (isValueAdd === null) return prev; // not yet answered
  if (prev?.isValueAdd === isValueAdd) return prev; // no change
  return { ...(prev ?? {}), isValueAdd };
}

describe('isValueAdd persists to calcState immediately on toggle', () => {
  it('writes true to empty calcState', () => {
    const result = applyIsValueAddToCalcState(undefined, true);
    expect(result?.isValueAdd).toBe(true);
  });

  it('writes false to existing calcState (preserves other fields)', () => {
    const prev = { totalDuration: 12, isValueAdd: true } as Partial<CalcPersistedState>;
    const result = applyIsValueAddToCalcState(prev, false);
    expect(result?.isValueAdd).toBe(false);
    expect((result as Record<string, unknown>).totalDuration).toBe(12);
  });

  it('returns prev unchanged when value matches (no unnecessary state update)', () => {
    const prev = { isValueAdd: true } as Partial<CalcPersistedState>;
    const result = applyIsValueAddToCalcState(prev, true);
    expect(result).toBe(prev); // same reference
  });

  it('skips write when isValueAdd is null (unanswered)', () => {
    const prev = { totalDuration: 12 } as Partial<CalcPersistedState>;
    expect(applyIsValueAddToCalcState(prev, null)).toBe(prev);
  });
});

// ── ProForma visibility ──────────────────────────────────────────────────────

function showProForma(args: {
  rentIncomplete: boolean;
  valueAddIncomplete: boolean;
  stabIncomplete: boolean;
}): boolean {
  return !(args.rentIncomplete || args.valueAddIncomplete || args.stabIncomplete);
}

describe('ProForma visibility — hidden when any Operations sub-section has a warning', () => {
  it('shown when all three sections are complete', () => {
    expect(showProForma({ rentIncomplete: false, valueAddIncomplete: false, stabIncomplete: false })).toBe(true);
  });

  it('hidden when rent is incomplete', () => {
    expect(showProForma({ rentIncomplete: true, valueAddIncomplete: false, stabIncomplete: false })).toBe(false);
  });

  it('hidden when value-add is incomplete', () => {
    expect(showProForma({ rentIncomplete: false, valueAddIncomplete: true, stabIncomplete: false })).toBe(false);
  });

  it('hidden when stabilization is incomplete', () => {
    expect(showProForma({ rentIncomplete: false, valueAddIncomplete: false, stabIncomplete: true })).toBe(false);
  });

  it('hidden when multiple sections are incomplete', () => {
    expect(showProForma({ rentIncomplete: true, valueAddIncomplete: true, stabIncomplete: true })).toBe(false);
  });
});
