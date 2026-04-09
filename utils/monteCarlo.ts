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

export interface MCRanges {
  targetRentPerUnit: MCRange;
  vacancyPct:        MCRange;
  rentGrowthPct:     MCRange;
  exitCapRate:       MCRange;
  renoOverrunPct:    MCRange; // 0 = base cost, 30 = 30% overrun
  interestRate:      MCRange;
  refiRate:          MCRange; // refinance interest rate — only meaningful when refinance.enabled
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

export interface MCResults {
  n:                    number;
  sorted:               MCRunResult[]; // by IRR ascending
  p10: MCRunResult; p20: MCRunResult; p30: MCRunResult; p50: MCRunResult; p70: MCRunResult; p80: MCRunResult; p90: MCRunResult;
  probPositiveCashFlow: number; // % of runs avgCoCReturn > 0
  sensitivity:          MCSensitivity[];
  irrBuckets:           MCHistogramBucket[];
  irrMin:               number;
  irrMax:               number;
}

/** Serialisable subset of MCResults — replaces the large `sorted` array with compact per-run data. */
export interface SavedMCResults extends Omit<MCResults, 'sorted'> {
  compactRuns: Array<{ irr: number; coc: number }>;
  /** Max purchase price at P50 (median) conditions — recommended target. Null = not achievable. */
  recommendedMaxPrice?: number | null;
  /** Max purchase price at P20 (conservative, ~80% confidence) conditions. Null = not achievable. */
  conservativeMaxPrice?: number | null;
  /** Target IRR used when computing the max purchase prices above. */
  targetIRR?: number | null;
  /** Target CoC set in the MC panel at the time the simulation was run. */
  targetCoC?: number | null;
}

export function toSavedMCResults(
  r: MCResults,
  recommendedMaxPrice?: number | null,
  conservativeMaxPrice?: number | null,
  targetIRR?: number | null,
  targetCoC?: number | null,
): SavedMCResults {
  const { sorted, ...rest } = r;
  return { ...rest, compactRuns: sorted.map(run => ({ irr: run.irr, coc: run.avgCoCReturn })), recommendedMaxPrice, conservativeMaxPrice, targetIRR, targetCoC };
}

export function hydrateMCResults(saved: SavedMCResults): MCResults {
  // Reconstruct a minimal `sorted` from compactRuns (only irr/avgCoCReturn needed for prob filters)
  // Guard: pre-compactRuns saved data (old format) won't have this array
  const sorted = (saved.compactRuns ?? []).map(({ irr, coc }) => ({
    irr, avgCoCReturn: coc, equityMultiple: 0, totalCashFlow: 0,
    sampled: { targetRentPerUnit: 0, vacancyPct: 0, rentGrowthPct: 0, exitCapRate: 0, renoOverrunPct: 0, interestRate: 0, refiRate: 0 },
  }));
  // Back-fill p30/p70 for results saved before those percentiles were added
  const saved_ = saved as unknown as MCResults;
  const p30 = saved_.p30 ?? saved_.p20 ?? saved_.p50;
  const p70 = saved_.p70 ?? saved_.p80 ?? saved_.p50;
  return { ...saved, sorted, p30, p70 };
}

// ── Default ranges ────────────────────────────────────────────────────────────

/**
 * Asymmetric defaults reflecting real estate risk:
 * - Rent: harder to hit than expected (−15 / +10)
 * - Vacancy: almost always surprises high (+8 / −2)
 * - Renovation: only overruns, never under (0 / +30%)
 * - Exit cap: expansion is the big IRR killer (+1.5 / −0.5)
 */
export function computeDefaultRanges(
  acquisition: CoCAcquisition,
  proForma: ProFormaData,
  avgTargetRentPerUnit: number,
  units: number,
  refinance?: CoCRefinance,
): MCRanges {
  const effectiveUnits = Math.max(1, units);
  // Derive per-unit rent from proForma.stabilized so MC base exactly matches the calculator
  const rent   = proForma.grossRent.stabilized > 0
    ? proForma.grossRent.stabilized / (effectiveUnits * 12)
    : avgTargetRentPerUnit > 0 ? avgTargetRentPerUnit : 1000;
  // Use ?? (not ||) so that legitimate 0 values aren't replaced by fallbacks
  const vac    = proForma.vacancyPct.stabilized ?? 5;
  const growth = proForma.grossRent.growthPct   ?? 3;
  const cap    = acquisition.exitCapRate         ?? 6;
  const rate   = acquisition.interestRate        ?? 7;
  const refi   = refinance?.enabled ? (refinance.newInterestRate ?? rate) : rate;

  return {
    targetRentPerUnit: { min: rent * 0.85,          mode: rent,   max: rent * 1.10 },
    vacancyPct:        { min: Math.max(0, vac - 2),  mode: vac,    max: vac + 8 },
    rentGrowthPct:     { min: growth - 1,             mode: growth, max: growth + 2 },
    exitCapRate:       { min: cap - 0.5,              mode: cap,    max: cap + 1.5 },
    renoOverrunPct:    { min: 0,                      mode: 0,      max: 30 },
    interestRate:      { min: rate - 0.5,             mode: rate,   max: rate + 2.0 },
    refiRate:          { min: refi - 0.5,             mode: refi,   max: refi + 2.0 },
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
): MCRunResult {
  const rent     = sampleTriangular(ranges.targetRentPerUnit.min, ranges.targetRentPerUnit.mode, ranges.targetRentPerUnit.max);
  const vac      = sampleTriangular(ranges.vacancyPct.min,        ranges.vacancyPct.mode,        ranges.vacancyPct.max);
  const growth   = sampleTriangular(ranges.rentGrowthPct.min,     ranges.rentGrowthPct.mode,     ranges.rentGrowthPct.max);
  const cap      = sampleTriangular(ranges.exitCapRate.min,       ranges.exitCapRate.mode,       ranges.exitCapRate.max);
  const renoOver = sampleTriangular(ranges.renoOverrunPct.min,    ranges.renoOverrunPct.mode,    ranges.renoOverrunPct.max);
  const rate     = sampleTriangular(ranges.interestRate.min,      ranges.interestRate.mode,      ranges.interestRate.max);
  // ranges.refiRate may be absent in ranges saved before this field was added
  const refiRateRange = ranges.refiRate ?? { min: rate, mode: rate, max: rate };
  const refiRate = sampleTriangular(refiRateRange.min, refiRateRange.mode, refiRateRange.max);

  // When every sampled value equals its mode, use the original data objects directly.
  // This guarantees bit-identical cash flows to the base case — no reconstruction drift.
  const atBase =
    rent     === ranges.targetRentPerUnit.mode &&
    vac      === ranges.vacancyPct.mode        &&
    growth   === ranges.rentGrowthPct.mode     &&
    cap      === ranges.exitCapRate.mode       &&
    renoOver === ranges.renoOverrunPct.mode    &&
    rate     === ranges.interestRate.mode      &&
    refiRate === refiRateRange.mode;

  const baseScenario: CoCScenario = {
    id: 'mc', name: 'MC', scenarioType: 'base',
    acquisition, operations, proForma, refinance,
    createdAt: '', updatedAt: '',
  };

  if (atBase) {
    const r = projectScenario(baseScenario);
    return {
      irr: r.irr ?? -999, avgCoCReturn: r.avgCoCReturn,
      equityMultiple: r.equityMultiple, totalCashFlow: r.totalCashFlow,
      sampled: { targetRentPerUnit: rent, vacancyPct: vac, rentGrowthPct: growth,
                 exitCapRate: cap, renoOverrunPct: renoOver, interestRate: rate, refiRate },
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
      hardCostItems: acquisition.hardCostItems.map(item => ({ ...item, amount: item.amount * renoMultiplier })),
      softCostItems: acquisition.softCostItems.map(item => ({ ...item, amount: item.amount * renoMultiplier })),
    },
    operations,
    proForma: {
      ...proForma,
      grossRent: { ...proForma.grossRent, stabilized: newTargetAnnual, growthPct: growth },
      vacancyPct: { ...proForma.vacancyPct, stabilized: vac },
      creditLossPct: proForma.creditLossPct ?? { t12: 0, stab: null, stabilized: 0 },
      yearOverrides: scalePreStabOverrides(proForma, newTargetAnnual, origStabilizedAnnual, sampledPreStab, Math.max(1, units), origDefaultPreStabAnnual),
    },
    refinance: refinance.enabled
      ? { ...refinance, newInterestRate: refiRate }
      : refinance,
    createdAt: '', updatedAt: '',
  };

  const r = projectScenario(scenario);
  return {
    irr:            r.irr ?? -999,
    avgCoCReturn:   r.avgCoCReturn,
    equityMultiple: r.equityMultiple,
    totalCashFlow:  r.totalCashFlow,
    sampled: { targetRentPerUnit: rent, vacancyPct: vac, rentGrowthPct: growth, exitCapRate: cap, renoOverrunPct: renoOver, interestRate: rate, refiRate },
  };
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

  const all: MCRunResult[] = [];
  const CHUNK = 250;

  for (let i = 0; i < n; i += CHUNK) {
    const end = Math.min(i + CHUNK, n);
    for (let j = i; j < end; j++) {
      all.push(runOnce(ranges, acquisition, operations, proForma, refinance, units, origStabilizedAnnual, origDefaultPreStabAnnual, avgPreStabPerUnit));
    }
    onProgress?.((end / n) * 100);
    await new Promise(r => setTimeout(r, 0)); // yield to event loop
  }

  // Sort by IRR ascending
  const sorted = [...all].sort((a, b) => a.irr - b.irr);

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
    probPositiveCashFlow: all.filter(r => r.avgCoCReturn > 0).length / n,
    sensitivity,
    irrBuckets: computeHistogram(validIrrs),
    irrMin: validIrrs.length ? Math.min(...validIrrs) : 0,
    irrMax: validIrrs.length ? Math.max(...validIrrs) : 0,
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
  const { targetRentPerUnit, vacancyPct, rentGrowthPct, exitCapRate, renoOverrunPct, interestRate } = p80sampled;

  const newTargetAnnual = targetRentPerUnit * effectiveUnits * 12;
  const renoMultiplier  = 1 + renoOverrunPct / 100;
  const sampledPreStab  = avgPreStabPerUnit > 0
    ? avgPreStabPerUnit * (targetRentPerUnit / (origStabilizedAnnual / (effectiveUnits * 12)))
    : targetRentPerUnit * 0.8;

  function irrAtPrice(price: number): number {
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
        grossRent:     { ...proForma.grossRent,     stabilized: newTargetAnnual, growthPct: rentGrowthPct },
        vacancyPct:    { ...proForma.vacancyPct,    stabilized: vacancyPct },
        creditLossPct: proForma.creditLossPct ?? { t12: 0, stab: null, stabilized: 0 },
        yearOverrides: scalePreStabOverrides(proForma, newTargetAnnual, origStabilizedAnnual, sampledPreStab, effectiveUnits, origDefaultPreStabAnnual),
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
  const refiRange = ranges.refiRate ?? { min: ranges.interestRate.mode, mode: ranges.interestRate.mode, max: ranges.interestRate.mode };

  // P50 (median) of each triangular distribution — accounts for range skewness
  const modeSampled: MCRunResult['sampled'] = {
    targetRentPerUnit: triangularQuantile(ranges.targetRentPerUnit.min, ranges.targetRentPerUnit.mode, ranges.targetRentPerUnit.max, 0.50),
    vacancyPct:        triangularQuantile(ranges.vacancyPct.min,        ranges.vacancyPct.mode,        ranges.vacancyPct.max,        0.50),
    rentGrowthPct:     triangularQuantile(ranges.rentGrowthPct.min,     ranges.rentGrowthPct.mode,     ranges.rentGrowthPct.max,     0.50),
    exitCapRate:       triangularQuantile(ranges.exitCapRate.min,        ranges.exitCapRate.mode,        ranges.exitCapRate.max,        0.50),
    renoOverrunPct:    triangularQuantile(ranges.renoOverrunPct.min,    ranges.renoOverrunPct.mode,    ranges.renoOverrunPct.max,    0.50),
    interestRate:      triangularQuantile(ranges.interestRate.min,      ranges.interestRate.mode,      ranges.interestRate.max,      0.50),
    refiRate:          triangularQuantile(refiRange.min,                refiRange.mode,                refiRange.max,                0.50),
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
  };

  const args = [acquisition, operations, proForma, refinance, units, avgPreStabPerUnit] as const;
  return {
    recommendedMaxPrice:  findMaxPriceAtConditions(modeSampled,        targetIRR, ...args),
    conservativeMaxPrice: findMaxPriceAtConditions(conservativeSampled, targetIRR, ...args),
  };
}
