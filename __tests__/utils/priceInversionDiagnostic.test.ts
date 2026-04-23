import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  detectPriceInversion,
  logPriceInversion,
  readPriceInversionEvents,
  clearPriceInversionEvents,
  diagnosticPayload,
} from '@/utils/priceInversionDiagnostic';

beforeEach(() => {
  clearPriceInversionEvents();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('detectPriceInversion', () => {
  it('returns false when either price is null', () => {
    expect(detectPriceInversion({ recommendedMaxPrice: null, conservativeMaxPrice: 100 })).toBe(false);
    expect(detectPriceInversion({ recommendedMaxPrice: 100, conservativeMaxPrice: null })).toBe(false);
    expect(detectPriceInversion({ recommendedMaxPrice: null, conservativeMaxPrice: null })).toBe(false);
  });

  it('returns false when prices are equal or conservative is lower', () => {
    expect(detectPriceInversion({ recommendedMaxPrice: 1_000_000, conservativeMaxPrice: 900_000 })).toBe(false);
    expect(detectPriceInversion({ recommendedMaxPrice: 1_000_000, conservativeMaxPrice: 1_000_000 })).toBe(false);
  });

  it('ignores sub-dollar differences (solver noise / rounding)', () => {
    expect(detectPriceInversion({ recommendedMaxPrice: 1_000_000, conservativeMaxPrice: 1_000_000.5 })).toBe(false);
  });

  it('flags when conservative exceeds recommended by > $1', () => {
    expect(detectPriceInversion({ recommendedMaxPrice: 1_000_000, conservativeMaxPrice: 1_000_002 })).toBe(true);
  });

  it('ignores non-finite numbers', () => {
    expect(detectPriceInversion({ recommendedMaxPrice: NaN, conservativeMaxPrice: 100 })).toBe(false);
    expect(detectPriceInversion({ recommendedMaxPrice: Infinity, conservativeMaxPrice: -Infinity })).toBe(false);
  });
});

describe('logPriceInversion + localStorage ring buffer', () => {
  const baseEvent = {
    recommendedMaxPrice: 1_000_000,
    conservativeMaxPrice: 1_050_000,
    recommendedSampled: { note: 'rec' },
    conservativeSampled: { note: 'con' },
    targetIRR: 12,
    acquisitionSnapshot: { propertyAddress: '123 Main' },
    source: 'test',
  };

  it('writes an event to localStorage with timestamp and diff', () => {
    logPriceInversion(baseEvent);
    const events = readPriceInversionEvents();
    expect(events).toHaveLength(1);
    expect(events[0].differenceUsd).toBe(50_000);
    expect(events[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(events[0].source).toBe('test');
  });

  it('keeps the 5 most recent events (ring buffer)', () => {
    for (let i = 0; i < 8; i++) {
      logPriceInversion({ ...baseEvent, source: `event-${i}` });
    }
    const events = readPriceInversionEvents();
    expect(events).toHaveLength(5);
    // Newest first
    expect(events[0].source).toBe('event-7');
    expect(events[4].source).toBe('event-3');
  });

  it('produces a diagnosticPayload string when events exist', () => {
    logPriceInversion(baseEvent);
    const payload = diagnosticPayload();
    expect(payload).not.toBeNull();
    const parsed = JSON.parse(payload as string);
    expect(parsed.events).toHaveLength(1);
    expect(parsed.capturedAt).toMatch(/^\d{4}-/);
  });

  it('returns null from diagnosticPayload when no events captured', () => {
    expect(diagnosticPayload()).toBeNull();
  });
});
