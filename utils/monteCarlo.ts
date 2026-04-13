import { projectScenario } from './dealAnalyzerCalc';
import type { CoCAcquisition, CoCOperations, CoCRefinance, ProFormaData, CoCScenario } from '@/types';

// ── Distributions ─────────────────────────────────────────────────────────────

/** Triangular distribution: maps human min/likely/max to a random sample. */
function sampleTriangular(min: number, mode: number, max: number): number {
  if (max <= min) return mode;
  const u = Math.random();
  const F = (mode - min) / (max - min);
  if (u <= F) return min + Math.sqrt(u * (max - min) * (mode - min));
  return max - Math.sqrt((1 - u) * (max - min) * (max - mode));
}

/**
 * Analytical p-th quantile of a triangular distribution.
 * Deterministic — no randomness, same answer every call.
 */
function triangularQuantile(min: number, mode: number, max: number, p: number): number {
  if (max <= min) return mode;
  const F = (mode - min) / (max - min);
  if (p <= F) return min + Math.sqrt(p * (max - min) * (mode - min));
  return max - Math.sqrt((1 - p) * (max - min) * (max - mode));
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface MCRange {
  min: number;
  mode: number; // user's base assumption
  max: number;
}

/**
 * User-configurable default range deltas for Monte Carlo assumptions.
 * These control how wide the pessimistic/optimistic bands are relative to the base.
 * "Pct" variables are in percentage points; "Pts" variables are in rate points.
 */
export interface MCRangeDefaults {
  // % variables (percentage-point offsets from base)
  rentPessimisticPct:         number; // how far below base rent (% of base, e.g. 15 = −15%)
  rentOptimisticPct:          number; // how far above base rent (% of base, e.g. 10 = +10%)
  vacancyPessimisticPts:      number; // pts above base vacancy (e.g. 8)
  vacancyOptimisticPts:       number; // pts below base vacancy (e.g. 2)
  rentGrowthPessimisticPts:   number; // pts below base growth (e.g. 1)
  rentGrowthOptimisticPts:    number; // pts above base growth (e.g. 2)
  expenseGrowthPessimisticPts: number; // pts above base expense growth (e.g. 2)
  expenseGrowthOptimisticPts: number; // pts below base expense growth (e.g. 1)
  renoOverrunMaxPct:          number; // max reno overrun % (e.g. 30)
  // Rate variables (points)
  exitCapRatePessimisticPts:  number; // pts above base cap rate (e.g. 1.5)
  exitCapRateOptimisticPts:   number; // pts below base cap rate (e.g. 0.5)
  interestRatePessimisticPts: number; // pts above base rate (e.g. 2.0)
  interestRateOptimisticPts:  number; // pts below base rate (e.g. 0.5)
  refiRatePessimisticPts:     number; // pts above base refi rate
  refiRateOptimisticPts:      number; // pts below base refi rate
}

export const MC_RANGE_DEFAULTS: MCRangeDefaults = {
  rentPessimisticPct:          15,
  rentOptimisticPct:            5,
  vacancyPessimisticPts:        8,
  vacancyOptimisticPts:         2,
  rentGrowthPessimisticPts:     2,
  rentGrowthOptimisticPts:      1,
  expenseGrowthPessimisticPts:  2,
  expenseGrowthOptimisticPts:   1,
  renoOverrunMaxPct:           30,
  exitCapRatePessimisticPts:    2,
  exitCapRateOptimisticPts:   0.5,
  interestRatePessimisticPts:   0,
  interestRateOptimisticPts:    0,
  refiRatePessimisticPts:       2,
  refiRateOptimisticPts:      0.5,
};

export interface MCRanges {
  targetRentPerUnit: MCRange;
  vacancyPct:        MCRange;
  rentGrowthPct:     MCRange;
  exitCapRate:       MCRange;
  renoOverrunPct:    MCRange; // 0 = base cost, 30 = 30% overrun
  interestRate:      MCRange;
  refiRate:          MCRange; // refinance interest rate — only meaningful when refinance.enabled
  expenseGrowthPct?: MCRange; // annual growth rate for fixed-dollar expenses
  arv?:              MCRange; // ARV uncertainty — only when exitMethod is 'value' and arv > 0
}

export interface MCRunResult {
  irr:           number; // null → stored as -999 for sorting
  avgCoCReturn:  number;
  equityMultiple: number;
  totalCashFlow: number;
  sampled: {
    targetRentPerUnit: number;
    vacancyPct:        number;
    rentGrowthPct:     number;
    exitCapRate:       number;
    renoOverrunPct:    number;
    interestRate:      number;
    refiRate:          number;
    expenseGrowthPct:  number;
    arv:               number;
  };
}

export interface MCSensitivity {
  key:         keyof MCRanges;
  label:       string;
  correlation: number; // |Pearson r| with IRR, 0–1
}

export interface MCHistogramBucket {
  center: number;
  count:  number;
}

export interface MCYearlyP50 {
  year:             number;
  cashFlow:         number;
  coCReturn:        number;
  cashOutProceeds:  number; // median refi cash-out for this year (0 for non-refi years)
}

/** Independent percentiles for each metric (sorted independently, not from a single run). */
export interface MCPercentileMetrics {
  irr:             number;
  avgCoCReturn:    number;
  equityMultiple:  number;
}

export interface MCResults {
  n:                    number;
  sorted:               MCRunResult[]; // by IRR ascending
  p10: MCRunResult; p20: MCRunResult; p30: MCRunResult; p50: MCRunResult; p70: MCRunResult; p80: MCRunResult; p90: MCRunResult;
  /** Independent percentiles — each metric sorted separately so P50 CoC = true CoC median. */
  independentP10: MCPercentileMetrics; independentP20: MCPercentileMetrics; independentP30: MCPercentileMetrics;
  independentP50: MCPercentileMetrics; independentP70: MCPercentileMetrics; independentP80: MCPercentileMetrics; independentP90: MCPercentileMetrics;
  probPositiveCashFlow: number; // % of runs avgCoCReturn > 0
  sensitivity:          MCSensitivity[];
  irrBuckets:           MCHistogramBucket[];
  irrMin:               number;
  irrMax:               number;
  yearlyP50:            MCYearlyP50[]; // median cash flow & CoC per projection year
}

/** Serialisable subset of MCResults — replaces the large `sorted` array with compact per-run data. */
export interface SavedMCResults extends Omit<MCResults, 'sorted'> {
  compactRuns: Array<{ irr: number; coc: number; em?: number }>;
  /** Max purchase price at P50 (median) conditions — recommended target. Null = not achievable. */
  recommendedMaxPrice?: number | null;
  /** Max purchase price at P20 (conservative, ~80% confidence) conditions. Null = not achievable. */
  conservativeMaxPrice?: number | null;
  /** Target IRR used when computing the max purchase prices above. */
  targetIRR?: number | null;
  /** Target CoC set in the MC panel at the time the simulation was run. */
  targetCoC?: number | null;
  /** Fingerprint of inputs at the time the simulation was run — used to detect staleness. */
  inputFingerprint?: string | null;
}

export function toSavedMCResults(
  r: MCResults,
  recommendedMaxPrice?: number | null,
  conservativeMaxPrice?: number | null,
  targetIRR?: number | null,
  targetCoC?: number | null,
  inputFingerprint?: string | null,
): SavedMCResults {
  const { sorted, ...rest } = r;
  return { ...rest, compactRuns: sorted.map(run => ({ irr: run.irr, coc: run.avgCoCReturn, em: run.equityMultiple })), recommendedMaxPrice, conservativeMaxPrice, targetIRR, targetCoC, inputFingerprint };
}

export function hydrateMCResults(saved: SavedMCResults): MCResults {
  // Reconstruct a minimal `sorted` from compactRuns (only irr/avgCoCReturn needed for prob filters)
  // Guard: pre-compactRuns saved data (old format) won't have this array
  const sorted = (saved.compactRuns ?? []).map(({ irr, coc, em }) => ({
    irr, avgCoCReturn: coc, equityMultiple: em ?? 0, totalCashFlow: 0,
    sampled: { targetRentPerUnit: 0, vacancyPct: 0, rentGrowthPct: 0, exitCapRate: 0, renoOverrunPct: 0, interestRate: 0, refiRate: 0, expenseGrowthPct: 0, arv: 0 },
  }));
  // Back-fill p30/p70 for results saved before those percentiles were added
  const saved_ = saved as unknown as MCResults;
  const p30 = saved_.p30 ?? saved_.p20 ?? saved_.p50;
  const p70 = saved_.p70 ?? saved_.p80 ?? saved_.p50;
  // Back-fill yearlyP50 for results saved before this field was added
  const yearlyP50 = (saved_.yearlyP50 ?? []).map(y => ({ ...y, cashOutProceeds: y.cashOutProceeds ?? 0 }));
  // Back-fill independent percentiles for results saved before this field was added
  const fallbackIndependent = (p: MCRunResult): MCPercentileMetrics => ({
    irr: p.irr, avgCoCReturn: p.avgCoCReturn, equityMultiple: p.equityMultiple,
  });
  const independentP10 = saved_.independentP10 ?? fallbackIndependent(saved_.p10 ?? saved_.p50);
  const independentP20 = saved_.independentP20 ?? fallbackIndependent(saved_.p20 ?? saved_.p50);
  const independentP30 = saved_.independentP30 ?? fallbackIndependent(p30);
  const independentP50 = saved_.independentP50 ?? fallbackIndependent(saved_.p50);
  const independentP70 = saved_.independentP70 ?? fallbackIndependent(p70);
  const independentP80 = saved_.independentP80 ?? fallbackIndependent(saved_.p80 ?? saved_.p50);
  const independentP90 = saved_.independentP90 ?? fallbackIndependent(saved_.p90 ?? saved_.p50);
  return { ...saved, sorted, p30, p70, yearlyP50, independentP10, independentP20, independentP30, independentP50, independentP70, independentP80, independentP90 };
}

// ── Default ranges ────────────────────────────────────────────────────────────

/**
 * Asymmetric defaults reflecting real estate risk:
 * - Rent: harder to hit than expected (−15 / +10)
 * - Vacancy: almost always surprises high (+8 / −2)
 * - Renovation: only overruns, never under (0 / +30%)
 * - Exit cap: expansion is the big IRR killer (+1.5 / −0.5)
 */
// ── Base value helpers — read what the projector actually uses ──

/**
 * Rent growth rate from Year 2 (where growth first applies).
 * Uses Year 2 override if set, otherwise the default grossRent.growthPct.
 */
function getBaseGrowthRate(proForma: ProFormaData): number {
  return proForma.yearOverrides?.[2]?.grossRentGrowthPct ?? proForma.grossRent.growthPct ?? 3;
}

/**
 * Vacancy rate from Year 1 — what the projector uses for the first projection year.
 * Uses Year 1 override if set, otherwise the stabilized value.
 */
function getBaseVacancyRate(proForma: ProFormaData): number {
  return proForma.yearOverrides?.[1]?.vacancyPct ?? proForma.vacancyPct.stabilized ?? 5;
}

/**
 * Average expense growth rate from Year 2 (where growth first applies).
 * For each fixed-dollar expense, uses the Year 2 override if set, otherwise the default growthPct.
 * % of EGI expenses are excluded — their cost moves with EGI automatically.
 */
function getBaseExpenseGrowthRate(proForma: ProFormaData): number {
  const yr2ExpGrowth = proForma.yearOverrides?.[2]?.expenseGrowthPcts;
  const growing = proForma.expenses.filter(e => !e.isPercentOfEGI).filter(e => {
    const rate = yr2ExpGrowth?.[e.id] ?? e.growthPct;
    return rate > 0;
  });
  if (growing.length === 0) return 0;
  return Math.round(growing.reduce((acc, e) => {
    const rate = yr2ExpGrowth?.[e.id] ?? e.growthPct;
    return acc + rate;
  }, 0) / growing.length * 100) / 100;
}

/**
 * Scale per-year growth and vacancy overrides multiplicatively by (sampled / base).
 * Every year's rate moves by the same factor, preserving the relative year-to-year
 * shape while the overall level scales with the sampled value.
 * Falls back to the overrides unchanged when base is zero.
 */
function applyPerYearShifts(
  overrides: ProFormaData['yearOverrides'],
  sampledGrowth: number,
  sampledVac: number,
  baseGrowth: number,
  baseVac: number,
  sampledExpGrowth?: number,
  baseExpGrowth?: number,
): ProFormaData['yearOverrides'] {
  const growthRatio   = baseGrowth    !== 0 ? sampledGrowth   / baseGrowth   : 1;
  const vacRatio      = baseVac       !== 0 ? sampledVac      / baseVac      : 1;
  const expGrowthRatio = (sampledExpGrowth !== undefined && baseExpGrowth !== undefined && baseExpGrowth !== 0)
    ? sampledExpGrowth / baseExpGrowth : 1;
  if (growthRatio === 1 && vacRatio === 1 && expGrowthRatio === 1) return overrides;

  const result: ProFormaData['yearOverrides'] = {};
  for (const [yearStr, ov] of Object.entries(overrides ?? {})) {
    if (!ov) continue;
    const y = Number(yearStr);
    const patched = { ...ov };
    if (ov.grossRentGrowthPct !== undefined) patched.grossRentGrowthPct = ov.grossRentGrowthPct * growthRatio;
    if (ov.vacancyPct          !== undefined) patched.vacancyPct         = Math.max(0, ov.vacancyPct * vacRatio);
    if (ov.expenseGrowthPcts && expGrowthRatio !== 1) {
      const scaled: Record<string, number> = {};
      for (const [id, rate] of Object.entries(ov.expenseGrowthPcts)) scaled[id] = rate * expGrowthRatio;
      patched.expenseGrowthPcts = scaled;
    }
    result[y] = patched;
  }
  return result;
}

export function computeDefaultRanges(
  acquisition: CoCAcquisition,
  proForma: ProFormaData,
  avgTargetRentPerUnit: number,
  units: number,
  refinance?: CoCRefinance,
  rangeDefaults?: MCRangeDefaults,
): MCRanges {
  const d = { ...MC_RANGE_DEFAULTS, ...rangeDefaults };
  const effectiveUnits = Math.max(1, units);
  // Use target rent per unit (average across units) as the MC base
  const rent = avgTargetRentPerUnit > 0 ? avgTargetRentPerUnit : (proForma.grossRent.stabilized / effectiveUnits / 12) || 1000;

  const growth    = getBaseGrowthRate(proForma);
  const vac       = getBaseVacancyRate(proForma);
  const expGrowth = getBaseExpenseGrowthRate(proForma);
  const cap  = acquisition.exitCapRate ?? 6;
  const rate = acquisition.interestRate ?? 7;
  const refi = refinance?.enabled ? (refinance.newInterestRate ?? rate) : rate;

  const arvRound = (v: number) => Math.round(v / 1000) * 1000;
  const arvRange: MCRange | undefined = acquisition.arv > 0 && acquisition.exitMethod !== 'capRate'
    ? { min: arvRound(acquisition.arv * 0.85), mode: acquisition.arv, max: arvRound(acquisition.arv * 1.15) }
    : undefined;

  return {
    targetRentPerUnit: { min: rent * (1 - d.rentPessimisticPct / 100),          mode: rent,      max: rent * (1 + d.rentOptimisticPct / 100) },
    vacancyPct:        { min: Math.max(0, vac - d.vacancyOptimisticPts),         mode: vac,       max: vac + d.vacancyPessimisticPts },
    rentGrowthPct:     { min: growth - d.rentGrowthPessimisticPts,               mode: growth,    max: growth + d.rentGrowthOptimisticPts },
    exitCapRate:       { min: cap  - d.exitCapRateOptimisticPts,                 mode: cap,       max: cap  + d.exitCapRatePessimisticPts },
    renoOverrunPct:    { min: 0,                                                  mode: 0,         max: d.renoOverrunMaxPct },
    interestRate:      { min: rate - d.interestRateOptimisticPts,                mode: rate,      max: rate + d.interestRatePessimisticPts },
    refiRate:          { min: refi - d.refiRateOptimisticPts,                    mode: refi,      max: refi + d.refiRatePessimisticPts },
    expenseGrowthPct:  { min: Math.max(0, expGrowth - d.expenseGrowthOptimisticPts), mode: expGrowth, max: expGrowth + d.expenseGrowthPessimisticPts },
    ...(arvRange ? { arv: arvRange } : {}),
  };
}

/**
 * Reverse of computeDefaultRanges — extracts the pessimistic/optimistic deltas
 * from a set of ranges so they can be saved as the user's global defaults.
 */
export function rangesToMCRangeDefaults(ranges: MCRanges): MCRangeDefaults {
  const r = ranges;
  const rent      = r.targetRentPerUnit;
  const vac       = r.vacancyPct;
  const growth    = r.rentGrowthPct;
  const expGrowth = r.expenseGrowthPct ?? { min: 0, mode: 0, max: 0 };
  const reno      = r.renoOverrunPct;
  const cap       = r.exitCapRate;
  const rate      = r.interestRate;
  const refi      = r.refiRate ?? { min: 0, mode: 0, max: 0 };
  return {
    rentPessimisticPct:          rent.mode > 0 ? Math.round((rent.mode - rent.min) / rent.mode * 1000) / 10 : MC_RANGE_DEFAULTS.rentPessimisticPct,
    rentOptimisticPct:           rent.mode > 0 ? Math.round((rent.max - rent.mode) / rent.mode * 1000) / 10 : MC_RANGE_DEFAULTS.rentOptimisticPct,
    vacancyPessimisticPts:       Math.round((vac.max       - vac.mode)       * 10) / 10,
    vacancyOptimisticPts:        Math.round((vac.mode      - vac.min)        * 10) / 10,
    rentGrowthPessimisticPts:    Math.round((growth.mode   - growth.min)     * 100) / 100,
    rentGrowthOptimisticPts:     Math.round((growth.max    - growth.mode)    * 100) / 100,
    expenseGrowthPessimisticPts: Math.round((expGrowth.max - expGrowth.mode) * 100) / 100,
    expenseGrowthOptimisticPts:  Math.round((expGrowth.mode- expGrowth.min)  * 100) / 100,
    renoOverrunMaxPct:           reno.max,
    exitCapRatePessimisticPts:   Math.round((cap.max       - cap.mode)       * 100) / 100,
    exitCapRateOptimisticPts:    Math.round((cap.mode      - cap.min)        * 100) / 100,
    interestRatePessimisticPts:  Math.round((rate.max      - rate.mode)      * 1000) / 1000,
    interestRateOptimisticPts:   Math.round((rate.mode     - rate.min)       * 1000) / 1000,
    refiRatePessimisticPts:      Math.round((refi.max      - refi.mode)      * 1000) / 1000,
    refiRateOptimisticPts:       Math.round((refi.mode     - refi.min)       * 1000) / 1000,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function scalePreStabOverrides(
  proForma: ProFormaData,
  newTargetAnnual: number,
  origStabilizedAnnual: number,
  newPreStabPerUnit: number,
  units: number,
  origDefaultPreStabAnnual: number,
): ProFormaData['yearOverrides'] {
  const newPreStabAnnual = newPreStabPerUnit * units * 12;

  // Short-circuit: if nothing changed, return the original overrides exactly
  // (avoids floating-point drift from x/y*y ≠ x).
  if (newTargetAnnual === origStabilizedAnnual && newPreStabAnnual === origDefaultPreStabAnnual) {
    return proForma.yearOverrides;
  }

  const result: ProFormaData['yearOverrides'] = {};

  for (const [yearStr, ov] of Object.entries(proForma.yearOverrides ?? {})) {
    if (!ov) continue;
    const y = Number(yearStr);
    if (ov.grossRent !== undefined && ov.grossRent < origStabilizedAnnual) {
      const ratio = origDefaultPreStabAnnual > 0 ? ov.grossRent / origDefaultPreStabAnnual : 1;
      result[y] = { ...ov, grossRent: newPreStabAnnual * ratio };
    } else if (ov.grossRentSystem && ov.grossRent !== undefined && origStabilizedAnnual > 0) {
      result[y] = { ...ov, grossRent: newTargetAnnual * (ov.grossRent / origStabilizedAnnual) };
    } else {
      result[y] = ov;
    }
  }
  return result;
}

function pearsonCorrelation(x: number[], y: number[]): number {
  const n = x.length;
  if (n === 0) return 0;
  const mx = x.reduce((s, v) => s + v, 0) / n;
  const my = y.reduce((s, v) => s + v, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    num += (x[i] - mx) * (y[i] - my);
    dx  += (x[i] - mx) ** 2;
    dy  += (y[i] - my) ** 2;
  }
  return dx * dy === 0 ? 0 : num / Math.sqrt(dx * dy);
}

function percentileItem(sorted: MCRunResult[], p: number): MCRunResult {
  const idx = Math.min(sorted.length - 1, Math.round((p / 100) * sorted.length));
  return sorted[idx];
}

function computeHistogram(irrs: number[], buckets = 20): MCHistogramBucket[] {
  const valid = irrs.filter(v => v > -900);
  if (valid.length === 0) return [];
  const min = Math.min(...valid);
  const max = Math.max(...valid);
  const width = (max - min) / buckets || 1;
  const out: MCHistogramBucket[] = Array.from({ length: buckets }, (_, i) => ({
    center: min + (i + 0.5) * width,
    count: 0,
  }));
  valid.forEach(v => {
    const idx = Math.min(buckets - 1, Math.floor((v - min) / width));
    out[idx].count++;
  });
  return out;
}

// ── Single run ────────────────────────────────────────────────────────────────

function runOnce(
  ranges:                 MCRanges,
  acquisition:            CoCAcquisition,
  operations:             CoCOperations,
  proForma:               ProFormaData,
  refinance:              CoCRefinance,
  units:                  number,
  origStabilizedAnnual:   number,
  origDefaultPreStabAnnual: number,
  avgPreStabPerUnit:      number,
): MCRunResultInternal {
  const rent     = sampleTriangular(ranges.targetRentPerUnit.min, ranges.targetRentPerUnit.mode, ranges.targetRentPerUnit.max);
  const vac      = sampleTriangular(ranges.vacancyPct.min,        ranges.vacancyPct.mode,        ranges.vacancyPct.max);
  const growth   = sampleTriangular(ranges.rentGrowthPct.min,     ranges.rentGrowthPct.mode,     ranges.rentGrowthPct.max);
  const cap      = sampleTriangular(ranges.exitCapRate.min,       ranges.exitCapRate.mode,       ranges.exitCapRate.max);
  const renoOver = sampleTriangular(ranges.renoOverrunPct.min,    ranges.renoOverrunPct.mode,    ranges.renoOverrunPct.max);
  const rate     = sampleTriangular(ranges.interestRate.min,      ranges.interestRate.mode,      ranges.interestRate.max);
  // ranges.refiRate may be absent in ranges saved before this field was added
  const refiRateRange = ranges.refiRate ?? { min: rate, mode: rate, max: rate };
  const refiRate = sampleTriangular(refiRateRange.min, refiRateRange.mode, refiRateRange.max);
  // Expense growth — sampled when range exists, otherwise defaults to base (no variation)
  const baseExpGrowth = getBaseExpenseGrowthRate(proForma);
  const expGrowthRange = ranges.expenseGrowthPct ?? { min: baseExpGrowth, mode: baseExpGrowth, max: baseExpGrowth };
  const expGrowth = sampleTriangular(expGrowthRange.min, expGrowthRange.mode, expGrowthRange.max);
  // ARV — sampled when exit method is 'value' and range is defined
  const arvSampled = ranges.arv ? sampleTriangular(ranges.arv.min, ranges.arv.mode, ranges.arv.max) : acquisition.arv;

  // When every sampled value equals its mode, use the original data objects directly.
  // This guarantees bit-identical cash flows to the base case — no reconstruction drift.
  const atBase =
    rent       === ranges.targetRentPerUnit.mode &&
    vac        === ranges.vacancyPct.mode        &&
    growth     === ranges.rentGrowthPct.mode     &&
    cap        === ranges.exitCapRate.mode       &&
    renoOver   === ranges.renoOverrunPct.mode    &&
    rate       === ranges.interestRate.mode      &&
    refiRate   === refiRateRange.mode            &&
    expGrowth  === expGrowthRange.mode           &&
    arvSampled === (ranges.arv?.mode ?? acquisition.arv);

  const baseScenario: CoCScenario = {
    id: 'mc', name: 'MC', scenarioType: 'base',
    acquisition, operations, proForma, refinance,
    createdAt: '', updatedAt: '',
  };

  if (atBase) {
    const r = projectScenario(baseScenario, { dynamicRefiValue: true });
    return {
      irr: r.irr ?? -999, avgCoCReturn: r.avgCoCReturn,
      equityMultiple: r.equityMultiple, totalCashFlow: r.totalCashFlow,
      sampled: { targetRentPerUnit: rent, vacancyPct: vac, rentGrowthPct: growth,
                 exitCapRate: cap, renoOverrunPct: renoOver, interestRate: rate, refiRate, expenseGrowthPct: expGrowth, arv: arvSampled },
      _yearlyProjections: r.yearlyProjections.map(p => ({ cashFlow: p.cashFlow, coCReturn: p.coCReturn, cashOutProceeds: p.cashOutProceeds })),
    };
  }

  // Scale as a ratio of origStabilizedAnnual to avoid floating-point drift
  const rentRatio       = ranges.targetRentPerUnit.mode > 0 ? rent / ranges.targetRentPerUnit.mode : 1;
  const newTargetAnnual = origStabilizedAnnual * rentRatio;
  const renoMultiplier  = 1 + renoOver / 100;

  const sampledPreStab = avgPreStabPerUnit > 0
    ? avgPreStabPerUnit * (rent / ranges.targetRentPerUnit.mode)
    : rent * 0.8;

  const scenario: CoCScenario = {
    id: 'mc', name: 'MC', scenarioType: 'base',
    acquisition: {
      ...acquisition,
      interestRate: rate,
      exitCapRate:  cap,
      arv:          arvSampled,
      hardCostItems: acquisition.hardCostItems.map(item => ({ ...item, amount: item.amount * renoMultiplier })),
      softCostItems: acquisition.softCostItems.map(item => ({ ...item, amount: item.amount * renoMultiplier })),
    },
    operations,
    proForma: {
      ...proForma,
      grossRent:     { ...proForma.grossRent,     stabilized: newTargetAnnual, growthPct: growth },
      vacancyPct:    { ...proForma.vacancyPct,    stabilized: vac },
      creditLossPct: proForma.creditLossPct ?? { t12: 0, stab: null, stabilized: 0 },
      expenses: proForma.expenses.map(e =>
        e.isPercentOfEGI ? e : { ...e, growthPct: baseExpGrowth !== 0 ? e.growthPct * (expGrowth / baseExpGrowth) : e.growthPct }
      ),
      yearOverrides: applyPerYearShifts(
        scalePreStabOverrides(proForma, newTargetAnnual, origStabilizedAnnual, sampledPreStab, Math.max(1, units), origDefaultPreStabAnnual),
        growth, vac, getBaseGrowthRate(proForma), getBaseVacancyRate(proForma),
        expGrowth, baseExpGrowth,
      ),
    },
    refinance: refinance.enabled
      ? { ...refinance, newInterestRate: refiRate }
      : refinance,
    createdAt: '', updatedAt: '',
  };

  const r = projectScenario(scenario, { dynamicRefiValue: true });
  return {
    irr:            r.irr ?? -999,
    avgCoCReturn:   r.avgCoCReturn,
    equityMultiple: r.equityMultiple,
    totalCashFlow:  r.totalCashFlow,
    sampled: { targetRentPerUnit: rent, vacancyPct: vac, rentGrowthPct: growth, exitCapRate: cap, renoOverrunPct: renoOver, interestRate: rate, refiRate, expenseGrowthPct: expGrowth, arv: arvSampled },
    _yearlyProjections: r.yearlyProjections.map(p => ({ cashFlow: p.cashFlow, coCReturn: p.coCReturn, cashOutProceeds: p.cashOutProceeds })),
  };
}

// ── Internal run result — carries yearly projections during simulation, stripped before storage ──
interface MCRunResultInternal extends MCRunResult {
  _yearlyProjections: Array<{ cashFlow: number; coCReturn: number; cashOutProceeds: number }>;
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface RunSimulationOptions {
  n:                       number;
  ranges:                  MCRanges;
  acquisition:             CoCAcquisition;
  operations:              CoCOperations;
  proForma:                ProFormaData;
  refinance:               CoCRefinance;
  units:                   number;
  avgPreStabPerUnit:       number;
  onProgress?:             (pct: number) => void;
}

/**
 * Runs N scenarios asynchronously in chunks to keep UI responsive.
 * Returns a promise that resolves with the full simulation results.
 */
export async function runSimulation(opts: RunSimulationOptions): Promise<MCResults> {
  const { n, ranges, acquisition, operations, proForma, refinance, units, avgPreStabPerUnit, onProgress } = opts;
  const origStabilizedAnnual     = proForma.grossRent.stabilized;
  const origDefaultPreStabAnnual = avgPreStabPerUnit * Math.max(1, units) * 12;

  const all: MCRunResultInternal[] = [];
  const CHUNK = 1000;

  for (let i = 0; i < n; i += CHUNK) {
    const end = Math.min(i + CHUNK, n);
    for (let j = i; j < end; j++) {
      all.push(runOnce(ranges, acquisition, operations, proForma, refinance, units, origStabilizedAnnual, origDefaultPreStabAnnual, avgPreStabPerUnit) as MCRunResultInternal);
    }
    onProgress?.((end / n) * 100);
    await new Promise(r => setTimeout(r, 0)); // yield to event loop
  }

  // Compute per-year median cash flow, CoC, and refi cash-out across all runs
  const yearCount = all[0]?._yearlyProjections?.length ?? 0;
  const yearlyP50: MCYearlyP50[] = Array.from({ length: yearCount }, (_, i) => {
    const cfs   = all.map(r => r._yearlyProjections[i].cashFlow).sort((a, b) => a - b);
    const cocs  = all.map(r => r._yearlyProjections[i].coCReturn).sort((a, b) => a - b);
    const cops  = all.map(r => r._yearlyProjections[i].cashOutProceeds).sort((a, b) => a - b);
    const mid   = Math.floor(cfs.length / 2);
    return { year: i + 1, cashFlow: cfs[mid], coCReturn: cocs[mid], cashOutProceeds: cops[mid] };
  });

  // Sort by IRR ascending (strip internal _yearlyProjections)
  const sorted = [...all].sort((a, b) => a.irr - b.irr) as MCRunResult[];

  // Independent percentiles — each metric sorted separately
  const sortedByCoC = [...all].sort((a, b) => a.avgCoCReturn - b.avgCoCReturn);
  const sortedByEM  = [...all].sort((a, b) => a.equityMultiple - b.equityMultiple);
  function independentPercentile(p: number): MCPercentileMetrics {
    const idx = Math.min(all.length - 1, Math.round((p / 100) * all.length));
    return {
      irr:            sorted[idx].irr,
      avgCoCReturn:   sortedByCoC[idx].avgCoCReturn,
      equityMultiple: sortedByEM[idx].equityMultiple,
    };
  }

  // Sensitivity: |Pearson r| of each input with IRR
  const irrs = all.map(r => r.irr);
  const SENSITIVITY_KEYS: Array<[keyof MCRanges, string]> = [
    ['targetRentPerUnit', 'Rent Achievement'],
    ['vacancyPct',        'Vacancy Rate'],
    ['rentGrowthPct',     'Rent Growth'],
    ['exitCapRate',       'Exit Cap Rate'],
    ['renoOverrunPct',    'Renovation Cost'],
    ['interestRate',      'Interest Rate'],
    ['refiRate',          'Refi Rate'],
    ['expenseGrowthPct',  'Expense Growth'],
  ];
  const sensitivity: MCSensitivity[] = SENSITIVITY_KEYS
    .map(([key, label]) => ({
      key,
      label,
      correlation: Math.abs(pearsonCorrelation(all.map(r => r.sampled[key]), irrs)),
    }))
    .sort((a, b) => b.correlation - a.correlation);

  const validIrrs = irrs.filter(v => v > -900);

  return {
    n,
    sorted,
    p10: percentileItem(sorted, 10),
    p20: percentileItem(sorted, 20),
    p30: percentileItem(sorted, 30),
    p50: percentileItem(sorted, 50),
    p70: percentileItem(sorted, 70),
    p80: percentileItem(sorted, 80),
    p90: percentileItem(sorted, 90),
    independentP10: independentPercentile(10),
    independentP20: independentPercentile(20),
    independentP30: independentPercentile(30),
    independentP50: independentPercentile(50),
    independentP70: independentPercentile(70),
    independentP80: independentPercentile(80),
    independentP90: independentPercentile(90),
    probPositiveCashFlow: all.filter(r => r.avgCoCReturn > 0).length / n,
    sensitivity,
    irrBuckets: computeHistogram(validIrrs),
    irrMin: validIrrs.length ? Math.min(...validIrrs) : 0,
    irrMax: validIrrs.length ? Math.max(...validIrrs) : 0,
    yearlyP50,
  };
}

// ── P80 Max Purchase Price ────────────────────────────────────────────────────

/**
 * Given a specific scenario's sampled market conditions, finds the maximum purchase
 * price at which the deal still achieves the target IRR using bisection search.
 *
 * Typical usage:
 *   - Pass P20 sampled values → conservative max price (things went somewhat badly)
 *   - Pass P50 sampled values → median max price (average conditions)
 *
 * Returns null if the target is unachievable even at a very low price,
 * or if sampled values are zeroed (hydrated results without full data).
 */
export function findMaxPriceAtConditions(
  p80sampled: MCRunResult['sampled'],
  targetIRR: number,
  acquisition: CoCAcquisition,
  operations: CoCOperations,
  proForma: ProFormaData,
  refinance: CoCRefinance,
  units: number,
  avgPreStabPerUnit: number,
): number | null {
  // Guard: hydrated results have zeroed sampled values — can't compute meaningfully
  if (p80sampled.targetRentPerUnit === 0) return null;

  const effectiveUnits = Math.max(1, units);
  const origStabilizedAnnual = proForma.grossRent.stabilized;
  if (origStabilizedAnnual === 0) return null;

  const origDefaultPreStabAnnual = avgPreStabPerUnit * effectiveUnits * 12;
  const { targetRentPerUnit, vacancyPct, rentGrowthPct, exitCapRate, renoOverrunPct, interestRate, expenseGrowthPct: sampledExpGrowth } = p80sampled;
  const baseExpGrowth = getBaseExpenseGrowthRate(proForma);

  const newTargetAnnual = targetRentPerUnit * effectiveUnits * 12;
  const renoMultiplier  = 1 + renoOverrunPct / 100;
  const sampledPreStab  = avgPreStabPerUnit > 0
    ? avgPreStabPerUnit * (targetRentPerUnit / (origStabilizedAnnual / (effectiveUnits * 12)))
    : targetRentPerUnit * 0.8;

  function irrAtPrice(price: number): number {
    // If property tax rate is stored, recompute the tax expense at this candidate price; also scale growth rates
    const expenses = proForma.expenses.map(e => {
      const withTax = (proForma.propertyTaxRatePct && proForma.propertyTaxRatePct > 0 && e.name === 'Property Taxes' && !e.isPercentOfEGI)
        ? { ...e, stabilizedValue: price * proForma.propertyTaxRatePct! / 12 }
        : e;
      return withTax.isPercentOfEGI ? withTax
        : { ...withTax, growthPct: baseExpGrowth !== 0 ? withTax.growthPct * (sampledExpGrowth / baseExpGrowth) : withTax.growthPct };
    });

    const scenario: CoCScenario = {
      id: 'p80-price', name: 'P80 Price', scenarioType: 'base',
      acquisition: {
        ...acquisition,
        purchasePrice: price,
        interestRate,
        exitCapRate,
        hardCostItems: acquisition.hardCostItems.map(item => ({ ...item, amount: item.amount * renoMultiplier })),
        softCostItems: acquisition.softCostItems.map(item => ({ ...item, amount: item.amount * renoMultiplier })),
      },
      operations,
      proForma: {
        ...proForma,
        expenses,
        grossRent:     { ...proForma.grossRent,     stabilized: newTargetAnnual, growthPct: rentGrowthPct },
        vacancyPct:    { ...proForma.vacancyPct,    stabilized: vacancyPct },
        creditLossPct: proForma.creditLossPct ?? { t12: 0, stab: null, stabilized: 0 },
        yearOverrides: applyPerYearShifts(
          scalePreStabOverrides(proForma, newTargetAnnual, origStabilizedAnnual, sampledPreStab, effectiveUnits, origDefaultPreStabAnnual),
          rentGrowthPct, vacancyPct, getBaseGrowthRate(proForma), getBaseVacancyRate(proForma),
          sampledExpGrowth, baseExpGrowth,
        ),
      },
      refinance,
      createdAt: '', updatedAt: '',
    };
    return projectScenario(scenario).irr ?? -999;
  }

  // If current price already hits target under P80 conditions — great deal
  if (irrAtPrice(acquisition.purchasePrice) >= targetIRR) return acquisition.purchasePrice;

  // Floor: 30% of current price — if still can't hit target, it's infeasible
  const floorPrice = acquisition.purchasePrice * 0.3;
  if (irrAtPrice(floorPrice) < targetIRR) return null;

  // Bisect between floor and current price to find max price where IRR ≥ target
  let lo = floorPrice;
  let hi = acquisition.purchasePrice;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (irrAtPrice(mid) >= targetIRR) lo = mid; else hi = mid;
    if (hi - lo < 500) break; // converged within $500
  }

  return Math.round(lo / 1000) * 1000; // round to nearest $1k
}

/**
 * Deterministic max purchase price bounds — no randomness, same answer every call.
 *
 * Recommended  = max price at P50 (median) of each variable's distribution.
 *   For symmetric ranges P50 = mode, but for right-skewed ranges (e.g. reno overrun
 *   0–0–30%) P50 is meaningfully worse than mode (~8.8% vs 0%), so this price
 *   accounts for distributional uncertainty rather than just the base case.
 *   Answers: "at median conditions, accounting for the shape of uncertainty, how much
 *   can you pay and still hit target IRR?"
 * Conservative = max price at analytically-derived pessimistic inputs:
 *   - Variables where higher hurts (vacancy, cap rate, rates): P80 quantile
 *   - Variables where lower hurts (rent, rent growth):         P20 quantile
 *
 * Both prices are fully deterministic (no randomness).
 */
export function computeDeterministicPrices(
  ranges: MCRanges,
  targetIRR: number,
  acquisition: CoCAcquisition,
  operations: CoCOperations,
  proForma: ProFormaData,
  refinance: CoCRefinance,
  units: number,
  avgPreStabPerUnit: number,
): { recommendedMaxPrice: number | null; conservativeMaxPrice: number | null } {
  const refiRange    = ranges.refiRate         ?? { min: ranges.interestRate.mode, mode: ranges.interestRate.mode, max: ranges.interestRate.mode };
  const expGrowRange = ranges.expenseGrowthPct ?? { min: 0, mode: 0, max: 0 };

  const arvRange = ranges.arv;
  const arvMode = arvRange ? triangularQuantile(arvRange.min, arvRange.mode, arvRange.max, 0.50) : 0;
  const arvConservative = arvRange ? triangularQuantile(arvRange.min, arvRange.mode, arvRange.max, 0.20) : 0;

  // P50 (median) of each triangular distribution — accounts for range skewness
  const modeSampled: MCRunResult['sampled'] = {
    targetRentPerUnit: triangularQuantile(ranges.targetRentPerUnit.min, ranges.targetRentPerUnit.mode, ranges.targetRentPerUnit.max, 0.50),
    vacancyPct:        triangularQuantile(ranges.vacancyPct.min,        ranges.vacancyPct.mode,        ranges.vacancyPct.max,        0.50),
    rentGrowthPct:     triangularQuantile(ranges.rentGrowthPct.min,     ranges.rentGrowthPct.mode,     ranges.rentGrowthPct.max,     0.50),
    exitCapRate:       triangularQuantile(ranges.exitCapRate.min,        ranges.exitCapRate.mode,        ranges.exitCapRate.max,        0.50),
    renoOverrunPct:    triangularQuantile(ranges.renoOverrunPct.min,    ranges.renoOverrunPct.mode,    ranges.renoOverrunPct.max,    0.50),
    interestRate:      triangularQuantile(ranges.interestRate.min,      ranges.interestRate.mode,      ranges.interestRate.max,      0.50),
    refiRate:          triangularQuantile(refiRange.min,                refiRange.mode,                refiRange.max,                0.50),
    expenseGrowthPct:  triangularQuantile(expGrowRange.min,             expGrowRange.mode,             expGrowRange.max,             0.50),
    arv:               arvMode,
  };

  // Pessimistic: worse-than-base values at ~80th percentile of the bad tail
  const conservativeSampled: MCRunResult['sampled'] = {
    targetRentPerUnit: triangularQuantile(ranges.targetRentPerUnit.min, ranges.targetRentPerUnit.mode, ranges.targetRentPerUnit.max, 0.20),
    vacancyPct:        triangularQuantile(ranges.vacancyPct.min,        ranges.vacancyPct.mode,        ranges.vacancyPct.max,        0.80),
    rentGrowthPct:     triangularQuantile(ranges.rentGrowthPct.min,     ranges.rentGrowthPct.mode,     ranges.rentGrowthPct.max,     0.20),
    exitCapRate:       triangularQuantile(ranges.exitCapRate.min,       ranges.exitCapRate.mode,       ranges.exitCapRate.max,       0.80),
    renoOverrunPct:    triangularQuantile(ranges.renoOverrunPct.min,    ranges.renoOverrunPct.mode,    ranges.renoOverrunPct.max,    0.80),
    interestRate:      triangularQuantile(ranges.interestRate.min,      ranges.interestRate.mode,      ranges.interestRate.max,      0.80),
    refiRate:          triangularQuantile(refiRange.min,                refiRange.mode,                refiRange.max,                0.80),
    expenseGrowthPct:  triangularQuantile(expGrowRange.min,             expGrowRange.mode,             expGrowRange.max,             0.80),
    arv:               arvConservative,
  };

  const args = [acquisition, operations, proForma, refinance, units, avgPreStabPerUnit] as const;
  return {
    recommendedMaxPrice:  findMaxPriceAtConditions(modeSampled,        targetIRR, ...args),
    conservativeMaxPrice: findMaxPriceAtConditions(conservativeSampled, targetIRR, ...args),
  };
}
