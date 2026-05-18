/**
 * Single source of truth for step-3 (Operations) validation in the Deal
 * Analyzer wizard. Replaces the scattered cluster of `opsXxxIncomplete` /
 * `_calcScheduleIncomplete` / `scheduleHasMismatch` flags that previously
 * lived inline in DealAnalyzerForm.tsx (computed in 3 places with slightly
 * different gates — the root cause of the "warning fires when it shouldn't"
 * and "rent missing-target banner stays after fix" bug class).
 *
 * Model: a flat list of `Step3Issue` records. Every consumer (badges,
 * banners, Pro Forma render gate, inline notices, step-warning aggregator)
 * derives what it needs via the selector helpers below. Adding a new
 * validation rule = one push in `buildStep3Issues`; the rule then shows up
 * everywhere automatically.
 *
 * Severity: 'error' blocks the Pro Forma from rendering and surfaces in
 * section badges + the pre-Pro Forma banner. 'warning' is reserved for
 * future non-blocking nudges (none today).
 */

import type {
  CoCAcquisition,
  ProFormaData,
  CalcPersistedState,
} from '@/types';

export type Step3IssueSeverity = 'error' | 'warning';
export type Step3IssueSection = 'rent' | 'valueAdd' | 'stab';

export interface Step3Issue {
  /** Stable key so consumers can target a specific issue (`stab.schedule_mismatch`). */
  id: string;
  section: Step3IssueSection;
  severity: Step3IssueSeverity;
  message: string;
}

export interface BuildStep3IssuesArgs {
  acquisition: CoCAcquisition;
  proForma: ProFormaData;
  calcState: CalcPersistedState | undefined;
  isValueAdd: boolean | null;
  preStabMethod: 'calculator' | 'manual' | null;
  stabDuration: number;
  offlinePerUnit: number;
}

// ── Builder ──────────────────────────────────────────────────────────────────

export function buildStep3Issues(args: BuildStep3IssuesArgs): Step3Issue[] {
  const { acquisition, proForma, calcState, isValueAdd, preStabMethod, stabDuration, offlinePerUnit } = args;
  const issues: Step3Issue[] = [];
  const isMfr = acquisition.propertyType === 'mfr' && acquisition.unitMix.length > 0;

  // ── Rent ────────────────────────────────────────────────────────────────
  const rentMissing = isMfr
    ? acquisition.unitMix.length === 0 || acquisition.unitMix.some(e => (e.rentMonthly || 0) === 0)
    : (acquisition.sfrTargetRent || 0) === 0 && proForma.grossRent.stabilized === 0;
  if (rentMissing) {
    issues.push({
      id: 'rent.missing_target',
      section: 'rent',
      severity: 'error',
      message: isMfr
        ? 'Enter the target rent for every unit type.'
        : 'Enter the target rent.',
    });
  }

  // Value-Add and Stabilization issues only apply when the user said Yes to
  // value-add. No value-add → no schedule, no stab duration, nothing to validate.
  if (isValueAdd !== true) return issues;

  const renoArr = isMfr ? acquisition.unitMix.map(e => e.unitsToRenovate ?? 0) : [1];
  const luArr = isMfr ? acquisition.unitMix.map(e => e.leaseUpUnits ?? 0) : [0];
  const someReno = isMfr && renoArr.some(u => u > 0);
  const someLU = isMfr && luArr.some(u => u > 0);
  const hasAnyUnits = someReno || someLU;

  // ── Value-Add ───────────────────────────────────────────────────────────
  if (!hasAnyUnits) {
    issues.push({
      id: 'valueAdd.no_units',
      section: 'valueAdd',
      severity: 'error',
      message: 'Specify which units will be renovated or leased up.',
    });
    // No point pursuing stab errors when value-add itself isn't filled in —
    // they'd just compound the same root issue.
    return issues;
  }

  // ── Stabilization ───────────────────────────────────────────────────────
  if (stabDuration === 0) {
    issues.push({
      id: 'stab.no_duration',
      section: 'stab',
      severity: 'error',
      message: 'Enter the stabilization duration.',
    });
  }
  if (someReno && offlinePerUnit === 0) {
    issues.push({
      id: 'stab.no_offline_months',
      section: 'stab',
      severity: 'error',
      message: 'Enter how many months each renovation unit is offline.',
    });
  }

  // Schedule mismatch — only check when calcState has actual schedule data.
  // Empty arrays mean the always-mounted calculator hasn't populated yet
  // (loading race), NOT a real mismatch. Without this gate the banner would
  // flash on every fresh-Yes toggle before the auto-compute settled.
  if (preStabMethod === 'calculator') {
    const hasScheduleData = calcState?.scheduleByType?.some(s => s.length > 0) ||
      calcState?.leaseUpScheduleByType?.some(s => s.length > 0);
    if (hasScheduleData) {
      const renoTotals = renoArr.map((_, t) =>
        (calcState?.scheduleByType?.[t] ?? []).reduce((s, n) => s + n, 0));
      const luTotals = luArr.map((_, t) =>
        (calcState?.leaseUpScheduleByType?.[t] ?? []).reduce((s, n) => s + n, 0));
      const mismatch =
        renoArr.some((u, t) => u > 0 && renoTotals[t] !== u) ||
        luArr.some((u, t) => u > 0 && luTotals[t] !== u);
      if (mismatch) {
        issues.push({
          id: 'stab.schedule_mismatch',
          section: 'stab',
          severity: 'error',
          message: "Complete the schedule for all renovation and lease-up units — it's needed to calculate rent for the Pro Forma.",
        });
      }
    }
  }

  return issues;
}

// ── Selectors ────────────────────────────────────────────────────────────────

export function issuesForSection(
  issues: Step3Issue[],
  section: Step3IssueSection,
): Step3Issue[] {
  return issues.filter(i => i.section === section);
}

export function sectionHasError(
  issues: Step3Issue[],
  section: Step3IssueSection,
): boolean {
  return issues.some(i => i.section === section && i.severity === 'error');
}

export function hasBlockingIssue(issues: Step3Issue[]): boolean {
  return issues.some(i => i.severity === 'error');
}

export function blockingSections(issues: Step3Issue[]): Step3IssueSection[] {
  const seen = new Set<Step3IssueSection>();
  const order: Step3IssueSection[] = [];
  for (const i of issues) {
    if (i.severity !== 'error') continue;
    if (seen.has(i.section)) continue;
    seen.add(i.section);
    order.push(i.section);
  }
  return order;
}

export function findIssue(issues: Step3Issue[], id: string): Step3Issue | undefined {
  return issues.find(i => i.id === id);
}

// ── Display helpers ──────────────────────────────────────────────────────────

const SECTION_LABEL: Record<Step3IssueSection, string> = {
  rent: 'Rent',
  valueAdd: 'Value-Add Plan',
  stab: 'Stabilization',
};

export function sectionLabel(section: Step3IssueSection): string {
  return SECTION_LABEL[section];
}

export function formatSectionList(sections: Step3IssueSection[]): string {
  const names = sections.map(sectionLabel);
  if (names.length === 0) return '';
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
}
