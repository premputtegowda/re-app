/**
 * Tests for the Operations sub-section warning-vs-check decision logic.
 *
 * Two summary cards / headers can show a warning instead of the green check:
 *   1. Rent       — when ANY unit is missing target rent (covered in rentIncomplete.test.ts)
 *   2. Value-Add  — when isValueAdd === true AND no reno/lease-up units have been entered
 *
 * Both states render an orange AlertTriangle in the OpsCard's left badge instead
 * of the green Check icon (and the same applies to the OpsSectionHeader while the
 * section is being edited).
 */

import { describe, it, expect } from 'vitest';

interface MfrUnit {
  unitsToRenovate?: number;
  leaseUpUnits?: number;
}

function computeValueAddIncomplete(args: {
  isValueAdd: boolean | null;
  hasMfr: boolean;
  unitMix?: MfrUnit[];
}): boolean {
  const { isValueAdd, hasMfr, unitMix } = args;
  if (isValueAdd !== true) return false; // only "Yes" gets a warning when it's hollow
  if (hasMfr) {
    const reno = (unitMix ?? []).map((e) => e.unitsToRenovate ?? 0);
    const lu = (unitMix ?? []).map((e) => e.leaseUpUnits ?? 0);
    const someReno = reno.some((u) => u > 0);
    const someLU = lu.some((u) => u > 0);
    return !(someReno || someLU);
  }
  // SFR — no per-unit reno/lease-up fields; the value-add plan is binary
  // and rent-driven, so we only mark incomplete when there's no unit at all.
  return false;
}

describe('Value-Add OpsCard — valueAddIncomplete (warning trigger)', () => {
  it('isValueAdd === false (No) → not incomplete (no warning)', () => {
    expect(
      computeValueAddIncomplete({
        isValueAdd: false,
        hasMfr: true,
        unitMix: [{}],
      }),
    ).toBe(false);
  });

  it('isValueAdd === null (unanswered) → not incomplete', () => {
    expect(
      computeValueAddIncomplete({
        isValueAdd: null,
        hasMfr: true,
        unitMix: [{ unitsToRenovate: 5 }],
      }),
    ).toBe(false);
  });

  it('isValueAdd === true with NO reno or lease-up units → INCOMPLETE (warning)', () => {
    expect(
      computeValueAddIncomplete({
        isValueAdd: true,
        hasMfr: true,
        unitMix: [{ unitsToRenovate: 0, leaseUpUnits: 0 }, { unitsToRenovate: 0 }],
      }),
    ).toBe(true);
  });

  it('isValueAdd === true with empty unitMix → INCOMPLETE', () => {
    expect(
      computeValueAddIncomplete({ isValueAdd: true, hasMfr: true, unitMix: [] }),
    ).toBe(true);
  });

  it('isValueAdd === true + at least one renovation unit → COMPLETE (green check)', () => {
    expect(
      computeValueAddIncomplete({
        isValueAdd: true,
        hasMfr: true,
        unitMix: [{ unitsToRenovate: 2 }, {}],
      }),
    ).toBe(false);
  });

  it('isValueAdd === true + at least one lease-up unit → COMPLETE', () => {
    expect(
      computeValueAddIncomplete({
        isValueAdd: true,
        hasMfr: true,
        unitMix: [{ leaseUpUnits: 3 }],
      }),
    ).toBe(false);
  });

  it('isValueAdd === true + reno on one type, lease-up on another → COMPLETE', () => {
    expect(
      computeValueAddIncomplete({
        isValueAdd: true,
        hasMfr: true,
        unitMix: [{ unitsToRenovate: 2 }, { leaseUpUnits: 3 }],
      }),
    ).toBe(false);
  });

  it('isValueAdd === true + only undefined fields → INCOMPLETE (treated as 0)', () => {
    expect(
      computeValueAddIncomplete({
        isValueAdd: true,
        hasMfr: true,
        unitMix: [{}, {}, {}],
      }),
    ).toBe(true);
  });

  it('total reno+leaseUp = 1 → COMPLETE (one unit is enough)', () => {
    expect(
      computeValueAddIncomplete({
        isValueAdd: true,
        hasMfr: true,
        unitMix: [{ unitsToRenovate: 1 }],
      }),
    ).toBe(false);
  });
});

// ── Stabilization OpsCard ────────────────────────────────────────────────────
// Warning fires when (a) value-add is yes and there are no reno/lease-up units,
// OR (b) value-add is yes and the renovation/lease-up period is empty (0).

function computeStabIncomplete(args: {
  isValueAdd: boolean | null;
  hasMfr: boolean;
  unitMix?: MfrUnit[];
  stabDuration: number;
  offlinePerUnit: number;
  calcScheduleIncomplete?: boolean;
}): boolean {
  const { isValueAdd, hasMfr, unitMix, stabDuration, offlinePerUnit, calcScheduleIncomplete } = args;
  if (isValueAdd !== true) return false;
  const someReno = hasMfr && (unitMix ?? []).some((e) => (e.unitsToRenovate ?? 0) > 0);
  const someLU = hasMfr && (unitMix ?? []).some((e) => (e.leaseUpUnits ?? 0) > 0);
  const hasAnyUnits = someReno || someLU;
  return !hasAnyUnits || stabDuration === 0 || (someReno && offlinePerUnit === 0) || !!calcScheduleIncomplete;
}

describe('Stabilization OpsCard — stabIncomplete (warning trigger)', () => {
  const baseUnits: MfrUnit[] = [{ unitsToRenovate: 2, leaseUpUnits: 3 }];

  it('value-add is No → not incomplete (no warning)', () => {
    expect(
      computeStabIncomplete({ isValueAdd: false, hasMfr: true, unitMix: baseUnits, stabDuration: 0, offlinePerUnit: 0 }),
    ).toBe(false);
  });

  it('value-add yes + units set + period > 0 + reno time > 0 → COMPLETE (green check)', () => {
    expect(
      computeStabIncomplete({ isValueAdd: true, hasMfr: true, unitMix: baseUnits, stabDuration: 12, offlinePerUnit: 2 }),
    ).toBe(false);
  });

  it('value-add yes + units set + period = 0 → INCOMPLETE (warning)', () => {
    expect(
      computeStabIncomplete({ isValueAdd: true, hasMfr: true, unitMix: baseUnits, stabDuration: 0, offlinePerUnit: 2 }),
    ).toBe(true);
  });

  it('value-add yes + no units + any period → INCOMPLETE (warning)', () => {
    expect(
      computeStabIncomplete({ isValueAdd: true, hasMfr: true, unitMix: [{}], stabDuration: 12, offlinePerUnit: 2 }),
    ).toBe(true);
  });

  it('value-add yes + no units + no period → INCOMPLETE (both reasons)', () => {
    expect(
      computeStabIncomplete({ isValueAdd: true, hasMfr: true, unitMix: [], stabDuration: 0, offlinePerUnit: 0 }),
    ).toBe(true);
  });

  it('value-add yes + reno units + reno time = 0 → INCOMPLETE (impossible — reno takes time)', () => {
    expect(
      computeStabIncomplete({ isValueAdd: true, hasMfr: true, unitMix: [{ unitsToRenovate: 2 }], stabDuration: 12, offlinePerUnit: 0 }),
    ).toBe(true);
  });

  it('value-add yes + only lease-up units (no reno) + reno time = 0 → COMPLETE (no reno → time irrelevant)', () => {
    expect(
      computeStabIncomplete({ isValueAdd: true, hasMfr: true, unitMix: [{ leaseUpUnits: 3 }], stabDuration: 12, offlinePerUnit: 0 }),
    ).toBe(false);
  });

  it('value-add null/unanswered → not incomplete (warning only fires for "Yes")', () => {
    expect(
      computeStabIncomplete({ isValueAdd: null, hasMfr: true, unitMix: baseUnits, stabDuration: 0, offlinePerUnit: 0 }),
    ).toBe(false);
  });

  it('value-add yes + everything else valid + calcScheduleIncomplete → INCOMPLETE (the fix)', () => {
    // The schedule monthly cells dont sum to the units count → calculator surfaces this as
    // "Complete the schedule for all renovation and lease-up units". Now also flagged in
    // the section warning so the Pre-ProForma banner mentions Stabilization.
    expect(
      computeStabIncomplete({
        isValueAdd: true,
        hasMfr: true,
        unitMix: baseUnits,
        stabDuration: 12,
        offlinePerUnit: 2,
        calcScheduleIncomplete: true,
      }),
    ).toBe(true);
  });

  it('value-add yes + everything else valid + calcScheduleIncomplete=false → COMPLETE', () => {
    expect(
      computeStabIncomplete({
        isValueAdd: true,
        hasMfr: true,
        unitMix: baseUnits,
        stabDuration: 12,
        offlinePerUnit: 2,
        calcScheduleIncomplete: false,
      }),
    ).toBe(false);
  });
});

// ── Pre-ProForma banner — message construction ───────────────────────────────
// When any of (rent / value-add / stabilization) is incomplete, a banner
// appears above the Pro Forma listing the offending sections by name.

function buildIncompleteSectionsMessage(args: {
  rentIncomplete: boolean;
  valueAddIncomplete: boolean;
  stabIncomplete: boolean;
}): string | null {
  const { rentIncomplete, valueAddIncomplete, stabIncomplete } = args;
  const sections: string[] = [];
  if (rentIncomplete) sections.push('Rent');
  if (valueAddIncomplete) sections.push('Value-Add Plan');
  // Stabilization is implied when value-add is incomplete (you can't have a stab
  // schedule without a value-add answer), so suppress the duplicate mention.
  if (stabIncomplete && !valueAddIncomplete) sections.push('Stabilization');
  if (sections.length === 0) return null;
  if (sections.length === 1) return sections[0];
  if (sections.length === 2) return `${sections[0]} and ${sections[1]}`;
  return `${sections.slice(0, -1).join(', ')}, and ${sections[sections.length - 1]}`;
}

describe('Pre-ProForma banner — section name list', () => {
  it('returns null when nothing is incomplete', () => {
    expect(
      buildIncompleteSectionsMessage({ rentIncomplete: false, valueAddIncomplete: false, stabIncomplete: false }),
    ).toBeNull();
  });

  it('only Rent → "Rent"', () => {
    expect(
      buildIncompleteSectionsMessage({ rentIncomplete: true, valueAddIncomplete: false, stabIncomplete: false }),
    ).toBe('Rent');
  });

  it('only Value-Add → "Value-Add Plan"', () => {
    expect(
      buildIncompleteSectionsMessage({ rentIncomplete: false, valueAddIncomplete: true, stabIncomplete: false }),
    ).toBe('Value-Add Plan');
  });

  it('only Stabilization → "Stabilization"', () => {
    expect(
      buildIncompleteSectionsMessage({ rentIncomplete: false, valueAddIncomplete: false, stabIncomplete: true }),
    ).toBe('Stabilization');
  });

  it('Rent + Value-Add → "Rent and Value-Add Plan"', () => {
    expect(
      buildIncompleteSectionsMessage({ rentIncomplete: true, valueAddIncomplete: true, stabIncomplete: false }),
    ).toBe('Rent and Value-Add Plan');
  });

  it('Rent + Stabilization → "Rent and Stabilization"', () => {
    expect(
      buildIncompleteSectionsMessage({ rentIncomplete: true, valueAddIncomplete: false, stabIncomplete: true }),
    ).toBe('Rent and Stabilization');
  });

  it('Value-Add + Stabilization → "Value-Add Plan" only (Stab is implied by Value-Add incompleteness)', () => {
    expect(
      buildIncompleteSectionsMessage({ rentIncomplete: false, valueAddIncomplete: true, stabIncomplete: true }),
    ).toBe('Value-Add Plan');
  });

  it('all three incomplete → "Rent and Value-Add Plan" (Stab still suppressed)', () => {
    expect(
      buildIncompleteSectionsMessage({ rentIncomplete: true, valueAddIncomplete: true, stabIncomplete: true }),
    ).toBe('Rent and Value-Add Plan');
  });

  it('Rent + Value-Add + Stab where Value-Add is fine but Stab is not → "Rent and Stabilization"', () => {
    expect(
      buildIncompleteSectionsMessage({ rentIncomplete: true, valueAddIncomplete: false, stabIncomplete: true }),
    ).toBe('Rent and Stabilization');
  });
});
