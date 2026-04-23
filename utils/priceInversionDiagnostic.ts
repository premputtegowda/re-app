/**
 * Narrow diagnostic for an intermittent production bug where the Monte Carlo
 * "Ideal Entry" (conservative) price appears higher than the "Recommended
 * Max" (median) price. By design, conservative ≤ recommended must hold —
 * every conservative input is strictly worse than the median. When the UI
 * uses specific sampled runs instead of analytical quantiles, rare
 * run-to-run noise can break the invariant. We log + snapshot inputs so
 * the next occurrence is reproducible.
 */

export interface PriceInversionEvent {
  timestamp: string;
  recommendedMaxPrice: number;
  conservativeMaxPrice: number;
  differenceUsd: number;
  /** Inputs used for the recommended computation (typically the MC median run). */
  recommendedSampled: unknown;
  /** Inputs used for the conservative computation (typically the MC bear run). */
  conservativeSampled: unknown;
  targetIRR: number;
  acquisitionSnapshot: Record<string, unknown>;
  /** Free-form label so we can tell which UI call-site triggered (dashboard / MC panel). */
  source: string;
}

const STORAGE_KEY = 'loi.diag.priceInversion';
const MAX_EVENTS = 5;
/** Prices are emitted in whole dollars already; ignore sub-dollar ties. */
const TOLERANCE_USD = 1;

export function detectPriceInversion(args: {
  recommendedMaxPrice: number | null | undefined;
  conservativeMaxPrice: number | null | undefined;
}): boolean {
  const rec = args.recommendedMaxPrice;
  const con = args.conservativeMaxPrice;
  if (rec == null || con == null) return false;
  if (!Number.isFinite(rec) || !Number.isFinite(con)) return false;
  return con > rec + TOLERANCE_USD;
}

export function logPriceInversion(event: Omit<PriceInversionEvent, 'timestamp' | 'differenceUsd'>): void {
  if (typeof window === 'undefined') return;
  const full: PriceInversionEvent = {
    ...event,
    differenceUsd: event.conservativeMaxPrice - event.recommendedMaxPrice,
    timestamp: new Date().toISOString(),
  };

  // Console: structured, searchable by the string below.
  // eslint-disable-next-line no-console
  console.error('[MC price inversion] conservative > recommended', full);

  // LocalStorage ring buffer so the user can retrieve events across reloads.
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const existing: PriceInversionEvent[] = raw ? JSON.parse(raw) : [];
    const next = [full, ...existing].slice(0, MAX_EVENTS);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Quota exceeded, JSON parse fail, etc. — console log is the fallback.
  }
}

export function readPriceInversionEvents(): PriceInversionEvent[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function clearPriceInversionEvents(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

/**
 * Produce a compact JSON blob suitable for copy/paste into a bug report.
 * Returns null if no events have been captured.
 */
export function diagnosticPayload(): string | null {
  const events = readPriceInversionEvents();
  if (events.length === 0) return null;
  return JSON.stringify({
    capturedAt: new Date().toISOString(),
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
    events,
  }, null, 2);
}
