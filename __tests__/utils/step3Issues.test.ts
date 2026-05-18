/**
 * Tests for the unified step-3 validation module. These pin the contract
 * that every consumer in DealAnalyzerForm derives from — section badges,
 * Pre-Pro Forma banner, Pro Forma render gate, inline notices.
 *
 * Two regressions live here as named cases:
 *   - "missing rent" issue on the broken prod deal (PR #11 fix)
 *   - "schedule mismatch" loading-race false positive on No → Yes toggle
 */

import { describe, it, expect } from 'vitest';
import type { CoCAcquisition, ProFormaData, CalcPersistedState, CoCUnitMixEntry } from '@/types';
import {
  buildStep3Issues,
  hasBlockingIssue,
  sectionHasError,
  blockingSections,
  findIssue,
  formatSectionList,
  type BuildStep3IssuesArgs,
} from '@/utils/step3Issues';

// ── Fixtures ─────────────────────────────────────────────────────────────────

function mfrUnit(over: Partial<CoCUnitMixEntry> = {}): CoCUnitMixEntry {
  return {
    id: 'a', beds: 1, baths: 1, count: 4,
    inPlaceRent: 1_000, rentMonthly: 1_500, preStabRent: 0,
    unitsToRenovate: 0, leaseUpUnits: 0,
    ...over,
  };
}

function mfrAcq(unitMix: CoCUnitMixEntry[]): CoCAcquisition {
  return {
    propertyAddress: '123 Main St',
    propertyType: 'mfr',
    units: unitMix.reduce((s, u) => s + u.count, 0) || 1,
    sfrBeds: 0, sfrBaths: 0, sfrInPlaceRent: 0, sfrPreStabRent: 0, sfrTargetRent: 0,
    unitMix,
    purchasePrice: 1_000_000, arv: 0,
    downPaymentPct: 25, closingCostsPct: 2, points: 0,
    additionalFeeItems: [], hardCostItems: [], softCostItems: [], opportunityCostItems: [],
    renovationMonths: 0, interestRate: 7, loanTermYears: 30, ioPeriodMonths: 0,
    stabilizedMonth: 1, projectionYears: 5,
    exitCapRate: 6, exitClosingCostPct: 3, exitMethod: 'capRate',
  };
}

function sfrAcq(target: number, inPlace: number = 0): CoCAcquisition {
  return {
    ...mfrAcq([]),
    propertyType: 'sfr',
    units: 1,
    sfrBeds: 3, sfrBaths: 2,
    sfrTargetRent: target, sfrInPlaceRent: inPlace, sfrPreStabRent: 0,
    unitMix: [],
  };
}

function pf(stabilized: number = 0): ProFormaData {
  return {
    grossRent:     { t12: 0, stab: null, stabilized,    growthPct: 3 },
    otherIncome:   { t12: 0, stab: null, stabilized: 0, growthPct: 2 },
    vacancyPct:    { t12: 5, stab: null, stabilized: 5 },
    creditLossPct: { t12: 0, stab: null, stabilized: 0 },
    expenses: [],
    yearOverrides: {},
  };
}

function args(over: Partial<BuildStep3IssuesArgs> = {}): BuildStep3IssuesArgs {
  return {
    acquisition: mfrAcq([mfrUnit()]),
    proForma: pf(),
    calcState: undefined,
    isValueAdd: null,
    preStabMethod: 'calculator',
    stabDuration: 12,
    offlinePerUnit: 1,
    ...over,
  };
}

// ── Rent issues ──────────────────────────────────────────────────────────────

describe('buildStep3Issues — rent', () => {
  it('MFR with target rent set on all unit types → no rent issue', () => {
    const issues = buildStep3Issues(args());
    expect(issuesById(issues, 'rent.missing_target')).toBeUndefined();
  });

  it('MFR with any unit missing target rent → rent.missing_target error', () => {
    const issues = buildStep3Issues(args({
      acquisition: mfrAcq([mfrUnit({ rentMonthly: 1_500 }), mfrUnit({ id: 'b', rentMonthly: 0 })]),
    }));
    expect(findIssue(issues, 'rent.missing_target')).toBeDefined();
    expect(findIssue(issues, 'rent.missing_target')?.severity).toBe('error');
  });

  it('SFR with target rent → no issue', () => {
    const issues = buildStep3Issues(args({ acquisition: sfrAcq(2_000) }));
    expect(findIssue(issues, 'rent.missing_target')).toBeUndefined();
  });

  it('SFR with no target rent AND no proForma fallback → rent.missing_target', () => {
    const issues = buildStep3Issues(args({ acquisition: sfrAcq(0), proForma: pf(0) }));
    expect(findIssue(issues, 'rent.missing_target')).toBeDefined();
  });

  it('SFR with no target rent BUT proForma.grossRent.stabilized > 0 → no issue (fallback satisfies)', () => {
    const issues = buildStep3Issues(args({ acquisition: sfrAcq(0), proForma: pf(24_000) }));
    expect(findIssue(issues, 'rent.missing_target')).toBeUndefined();
  });

  it('regression: the broken prod deal shape — MFR with all rentMonthly=0 → rent.missing_target', () => {
    // Mirrors deal 51acb5e9-d272-4284-96a8-ad86dcb01dbd from the original
    // user-reported repro. Persistence was the real bug; the warning was
    // correct. Pin the warning so we don't accidentally silence it.
    const issues = buildStep3Issues(args({
      acquisition: mfrAcq([mfrUnit({ count: 16, rentMonthly: 0 })]),
    }));
    expect(findIssue(issues, 'rent.missing_target')).toBeDefined();
  });
});

// ── Value-Add issues ─────────────────────────────────────────────────────────

describe('buildStep3Issues — value-add', () => {
  it('isValueAdd === null → no value-add or stab issues even if data is bare', () => {
    const issues = buildStep3Issues(args({ isValueAdd: null }));
    expect(issuesForSection(issues, 'valueAdd')).toHaveLength(0);
    expect(issuesForSection(issues, 'stab')).toHaveLength(0);
  });

  it('isValueAdd === false → no value-add or stab issues', () => {
    const issues = buildStep3Issues(args({ isValueAdd: false }));
    expect(issuesForSection(issues, 'valueAdd')).toHaveLength(0);
    expect(issuesForSection(issues, 'stab')).toHaveLength(0);
  });

  it('isValueAdd === true with no reno/lease-up units → valueAdd.no_units', () => {
    const issues = buildStep3Issues(args({ isValueAdd: true }));
    expect(findIssue(issues, 'valueAdd.no_units')).toBeDefined();
  });

  it('isValueAdd === true with renovation units → no value-add issue', () => {
    const issues = buildStep3Issues(args({
      isValueAdd: true,
      acquisition: mfrAcq([mfrUnit({ unitsToRenovate: 2 })]),
    }));
    expect(findIssue(issues, 'valueAdd.no_units')).toBeUndefined();
  });

  it('isValueAdd === true with lease-up units → no value-add issue', () => {
    const issues = buildStep3Issues(args({
      isValueAdd: true,
      acquisition: mfrAcq([mfrUnit({ leaseUpUnits: 3 })]),
    }));
    expect(findIssue(issues, 'valueAdd.no_units')).toBeUndefined();
  });

  it('value-add incomplete short-circuits stab issues (no point compounding)', () => {
    const issues = buildStep3Issues(args({ isValueAdd: true, stabDuration: 0 }));
    expect(findIssue(issues, 'valueAdd.no_units')).toBeDefined();
    expect(issuesForSection(issues, 'stab')).toHaveLength(0);
  });
});

// ── Stabilization issues ─────────────────────────────────────────────────────

describe('buildStep3Issues — stabilization', () => {
  const valueAddMfr = mfrAcq([mfrUnit({ unitsToRenovate: 2, leaseUpUnits: 2 })]);

  it('all stab inputs set → no stab issues', () => {
    const issues = buildStep3Issues(args({
      isValueAdd: true,
      acquisition: valueAddMfr,
      stabDuration: 12,
      offlinePerUnit: 1,
      calcState: weightedCalcState({ reno: [2], leaseUp: [2] }),
    }));
    expect(issuesForSection(issues, 'stab')).toHaveLength(0);
  });

  it('stabDuration === 0 → stab.no_duration', () => {
    const issues = buildStep3Issues(args({
      isValueAdd: true,
      acquisition: valueAddMfr,
      stabDuration: 0,
    }));
    expect(findIssue(issues, 'stab.no_duration')).toBeDefined();
  });

  it('renovation units + offlinePerUnit === 0 → stab.no_offline_months', () => {
    const issues = buildStep3Issues(args({
      isValueAdd: true,
      acquisition: valueAddMfr,
      offlinePerUnit: 0,
    }));
    expect(findIssue(issues, 'stab.no_offline_months')).toBeDefined();
  });

  it('lease-up only (no reno) + offlinePerUnit === 0 → NO offline issue (offline irrelevant without reno)', () => {
    const issues = buildStep3Issues(args({
      isValueAdd: true,
      acquisition: mfrAcq([mfrUnit({ leaseUpUnits: 3 })]),
      offlinePerUnit: 0,
    }));
    expect(findIssue(issues, 'stab.no_offline_months')).toBeUndefined();
  });

  it('schedule sums match assigned units → no mismatch issue', () => {
    const issues = buildStep3Issues(args({
      isValueAdd: true,
      acquisition: valueAddMfr,
      calcState: weightedCalcState({ reno: [2], leaseUp: [2] }),
    }));
    expect(findIssue(issues, 'stab.schedule_mismatch')).toBeUndefined();
  });

  it('schedule totals do NOT match assigned units → stab.schedule_mismatch', () => {
    const issues = buildStep3Issues(args({
      isValueAdd: true,
      acquisition: valueAddMfr,
      calcState: weightedCalcState({ reno: [1] /* assigned=2, schedule sums to 1 */, leaseUp: [2] }),
    }));
    expect(findIssue(issues, 'stab.schedule_mismatch')).toBeDefined();
  });

  it('regression: No → Yes loading race — sparse calcState (no schedule arrays) → NO mismatch issue', () => {
    // The fresh-Yes toggle leaves calcState as { isValueAdd: true } until
    // RehabRentCalculator's auto-compute pushes weighted schedules back via
    // onStateChange. Without the hasScheduleData gate, the banner would
    // flash during this loading race.
    const issues = buildStep3Issues(args({
      isValueAdd: true,
      acquisition: valueAddMfr,
      calcState: { isValueAdd: true } as unknown as CalcPersistedState,
    }));
    expect(findIssue(issues, 'stab.schedule_mismatch')).toBeUndefined();
  });

  it('preStabMethod === "manual" → no schedule mismatch issue (calculator bypassed)', () => {
    const issues = buildStep3Issues(args({
      isValueAdd: true,
      acquisition: valueAddMfr,
      preStabMethod: 'manual',
      calcState: weightedCalcState({ reno: [1] /* mismatch */, leaseUp: [2] }),
    }));
    expect(findIssue(issues, 'stab.schedule_mismatch')).toBeUndefined();
  });
});

// ── Selectors ────────────────────────────────────────────────────────────────

describe('selectors', () => {
  it('hasBlockingIssue returns true when any error exists', () => {
    const issues = buildStep3Issues(args({
      acquisition: mfrAcq([mfrUnit({ rentMonthly: 0 })]),
    }));
    expect(hasBlockingIssue(issues)).toBe(true);
  });

  it('hasBlockingIssue returns false for a fully-valid Yes-path deal', () => {
    const issues = buildStep3Issues(args({
      isValueAdd: true,
      acquisition: mfrAcq([mfrUnit({ unitsToRenovate: 2, leaseUpUnits: 2 })]),
      calcState: weightedCalcState({ reno: [2], leaseUp: [2] }),
    }));
    expect(hasBlockingIssue(issues)).toBe(false);
  });

  it('sectionHasError finds errors scoped to a section', () => {
    const issues = buildStep3Issues(args({
      isValueAdd: true,
      acquisition: mfrAcq([mfrUnit({ rentMonthly: 0 })]),
    }));
    expect(sectionHasError(issues, 'rent')).toBe(true);
    expect(sectionHasError(issues, 'valueAdd')).toBe(true); // no units = error
    expect(sectionHasError(issues, 'stab')).toBe(false);    // short-circuited
  });

  it('blockingSections returns unique sections in first-seen order', () => {
    const issues = buildStep3Issues(args({
      isValueAdd: true,
      acquisition: mfrAcq([mfrUnit({ rentMonthly: 0, unitsToRenovate: 2 })]),
      stabDuration: 0,
    }));
    // rent missing → rent; stab duration 0 → stab. value-add ok (has units).
    expect(blockingSections(issues)).toEqual(['rent', 'stab']);
  });

  it('blockingSections collapses duplicate sections', () => {
    const issues = buildStep3Issues(args({
      isValueAdd: true,
      acquisition: mfrAcq([mfrUnit({ unitsToRenovate: 2 })]),
      stabDuration: 0,
      offlinePerUnit: 0, // two stab issues — should appear once
    }));
    expect(blockingSections(issues)).toEqual(['stab']);
  });
});

// ── Display helpers ──────────────────────────────────────────────────────────

describe('formatSectionList', () => {
  it('empty → ""', () => { expect(formatSectionList([])).toBe(''); });
  it('one → just the label', () => { expect(formatSectionList(['rent'])).toBe('Rent'); });
  it('two → "A and B"', () => { expect(formatSectionList(['rent', 'stab'])).toBe('Rent and Stabilization'); });
  it('three → Oxford-comma list', () => {
    expect(formatSectionList(['rent', 'valueAdd', 'stab'])).toBe('Rent, Value-Add Plan, and Stabilization');
  });
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function weightedCalcState({ reno, leaseUp }: { reno: number[]; leaseUp: number[] }): CalcPersistedState {
  // Synthesize schedules whose per-type sums equal `reno[t]` / `leaseUp[t]`.
  // Avoids depending on weightedDistribute — keeps this unit test pure.
  return {
    mode: 'renovate', totalDuration: 12,
    unitsToStabilize: reno, perUnitMonths: reno.map(() => 1),
    scheduleByType: reno.map(n => padEnd([n], 12, 0)),
    manualDuration: 0, manualPreStabRents: reno.map(() => 0),
    localRents: reno.map(() => ({ inPlace: 1_000, target: 1_500 })),
    leaseUpToStabilize: leaseUp,
    leaseUpScheduleByType: leaseUp.map(n => padEnd([n], 12, 0)),
    distributionMethod: 'weighted',
    isValueAdd: true,
    preStabMethod: 'calculator',
  };
}

function padEnd(arr: number[], len: number, fill: number): number[] {
  const out = [...arr];
  while (out.length < len) out.push(fill);
  return out;
}

function issuesById<T extends { id: string }>(issues: T[], id: string): T | undefined {
  return issues.find(i => i.id === id);
}

function issuesForSection<T extends { section: string }>(issues: T[], section: string): T[] {
  return issues.filter(i => i.section === section);
}
