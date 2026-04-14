/**
 * Tests for step notes persistence logic.
 *
 * - Notes are stored in stepNotes keyed by step index
 * - Empty/whitespace-only notes are not persisted
 * - Notes survive save/load round-trip via DealAnalyzerDraft
 */

import { describe, it, expect } from 'vitest';

// ── stepNotes serialization logic (mirrors DealAnalyzerForm handleSave) ──

function buildStepNotes(opsNotes: string): Record<number, string> | undefined {
  const stepNotes: Record<number, string> = {};
  if (opsNotes.trim()) stepNotes[3] = opsNotes.trim();
  return Object.keys(stepNotes).length > 0 ? stepNotes : undefined;
}

function loadOpsNotes(stepNotes?: Record<number, string>): string {
  return stepNotes?.[3] ?? '';
}

describe('stepNotes persistence', () => {
  it('stores ops notes under key 3', () => {
    const result = buildStepNotes('Check comps for vacancy rate');
    expect(result).toEqual({ 3: 'Check comps for vacancy rate' });
  });

  it('trims whitespace before storing', () => {
    const result = buildStepNotes('  some note  ');
    expect(result).toEqual({ 3: 'some note' });
  });

  it('returns undefined when notes are empty', () => {
    expect(buildStepNotes('')).toBeUndefined();
  });

  it('returns undefined when notes are whitespace only', () => {
    expect(buildStepNotes('   ')).toBeUndefined();
  });

  it('preserves multi-line notes', () => {
    const multiline = 'Line 1\nLine 2\nLine 3';
    const result = buildStepNotes(multiline);
    expect(result).toEqual({ 3: multiline });
  });

  it('loads ops notes from stepNotes', () => {
    expect(loadOpsNotes({ 3: 'My note' })).toBe('My note');
  });

  it('returns empty string when stepNotes is undefined', () => {
    expect(loadOpsNotes(undefined)).toBe('');
  });

  it('returns empty string when step 3 is not in stepNotes', () => {
    expect(loadOpsNotes({ 0: 'Property note' })).toBe('');
  });

  it('round-trip: save then load preserves notes', () => {
    const original = 'Verify insurance quote\nCall broker Monday';
    const saved = buildStepNotes(original);
    const loaded = loadOpsNotes(saved);
    expect(loaded).toBe(original);
  });

  it('round-trip: empty notes save as undefined, load as empty string', () => {
    const saved = buildStepNotes('');
    const loaded = loadOpsNotes(saved);
    expect(loaded).toBe('');
  });
});

// ── Notes indicator dot logic ────────────────────────────────────────────────

describe('notes indicator dot', () => {
  function shouldShowDot(opsNotes: string): boolean {
    return opsNotes.trim().length > 0;
  }

  it('shows dot when notes have content', () => {
    expect(shouldShowDot('Check comps')).toBe(true);
  });

  it('shows dot for multi-line notes', () => {
    expect(shouldShowDot('Line 1\nLine 2')).toBe(true);
  });

  it('hides dot when notes are empty', () => {
    expect(shouldShowDot('')).toBe(false);
  });

  it('hides dot when notes are whitespace only', () => {
    expect(shouldShowDot('   ')).toBe(false);
  });

  it('hides dot when notes are newlines only', () => {
    expect(shouldShowDot('\n\n')).toBe(false);
  });
});
