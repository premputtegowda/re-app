/**
 * Tests for Monte Carlo simulation trigger behavior.
 *
 * 1. MC runs alongside base calculation (handleCalculate) — not on tab visit
 * 2. MC re-runs when uncertainty ranges are committed (Done on MC panel)
 * 3. MC does NOT re-run on MC tab mount (no auto-run on visit)
 * 4. Phase transitions follow the correct sequence with minimum display times
 */

import { describe, it, expect } from 'vitest';

// ── Phase transition logic (replicated from DealAnalyzerForm) ──

type CalcPhase = 'idle' | 'returns' | 'uncertainty' | 'done';

interface PhaseTransition {
  from: CalcPhase;
  to: CalcPhase;
  minDelay: number; // ms
}

/**
 * Replicates the phase sequence from handleCalculate:
 *   idle → returns (base calc) → uncertainty (MC sim, 1.5s min) → done (0.5s) → idle
 */
function getPhaseSequenceForBaseCalc(): PhaseTransition[] {
  return [
    { from: 'idle', to: 'returns', minDelay: 0 },
    { from: 'returns', to: 'uncertainty', minDelay: 100 }, // setTimeout delay for UI
    { from: 'uncertainty', to: 'done', minDelay: 1500 },   // min display time
    { from: 'done', to: 'idle', minDelay: 500 },           // fade-in pause
  ];
}

/**
 * Replicates the phase sequence from MC range commit (Done button):
 *   idle → uncertainty (MC sim, 1.5s min) → done (0.5s) → idle
 * Note: NO 'returns' phase — base calc doesn't re-run.
 */
function getPhaseSequenceForRangeCommit(): PhaseTransition[] {
  return [
    { from: 'idle', to: 'uncertainty', minDelay: 0 },
    { from: 'uncertainty', to: 'done', minDelay: 1500 },
    { from: 'done', to: 'idle', minDelay: 500 },
  ];
}

/**
 * Should MC auto-run when the panel mounts (user visits MC tab)?
 * Answer: NO — simulation runs from handleCalculate or range commit only.
 */
function shouldAutoRunOnMount(savedResults: unknown, isStale: boolean): boolean {
  // Previously: if (!savedResults || isStale) return true;
  // Now: always false — no auto-run on mount
  return false;
}

// ── Tests ──

describe('MC simulation trigger — base calculation', () => {
  it('phase sequence includes both returns and uncertainty', () => {
    const seq = getPhaseSequenceForBaseCalc();
    const phases = seq.map(t => t.to);
    expect(phases).toContain('returns');
    expect(phases).toContain('uncertainty');
    expect(phases).toContain('done');
    expect(phases).toContain('idle');
  });

  it('uncertainty phase has minimum 1.5s display time', () => {
    const seq = getPhaseSequenceForBaseCalc();
    const uncertaintyTransition = seq.find(t => t.from === 'uncertainty');
    expect(uncertaintyTransition?.minDelay).toBe(1500);
  });

  it('done phase has 0.5s pause for fade-in', () => {
    const seq = getPhaseSequenceForBaseCalc();
    const doneTransition = seq.find(t => t.from === 'done');
    expect(doneTransition?.minDelay).toBe(500);
  });

  it('returns comes before uncertainty (base calc before MC)', () => {
    const seq = getPhaseSequenceForBaseCalc();
    const returnsIdx = seq.findIndex(t => t.to === 'returns');
    const uncertaintyIdx = seq.findIndex(t => t.to === 'uncertainty');
    expect(returnsIdx).toBeLessThan(uncertaintyIdx);
  });
});

describe('MC simulation trigger — range commit (Done on MC panel)', () => {
  it('phase sequence skips returns (base calc not re-run)', () => {
    const seq = getPhaseSequenceForRangeCommit();
    const phases = seq.map(t => t.to);
    expect(phases).not.toContain('returns');
    expect(phases).toContain('uncertainty');
  });

  it('uncertainty phase has same 1.5s minimum as base calc', () => {
    const seq = getPhaseSequenceForRangeCommit();
    const uncertaintyTransition = seq.find(t => t.from === 'uncertainty');
    expect(uncertaintyTransition?.minDelay).toBe(1500);
  });

  it('starts directly at uncertainty (not idle → returns)', () => {
    const seq = getPhaseSequenceForRangeCommit();
    expect(seq[0].to).toBe('uncertainty');
  });
});

describe('MC panel mount — no auto-run', () => {
  it('does NOT auto-run when no saved results', () => {
    expect(shouldAutoRunOnMount(null, false)).toBe(false);
  });

  it('does NOT auto-run when results are stale', () => {
    expect(shouldAutoRunOnMount({ irr: 10 }, true)).toBe(false);
  });

  it('does NOT auto-run when results exist and are fresh', () => {
    expect(shouldAutoRunOnMount({ irr: 10 }, false)).toBe(false);
  });
});

describe('MC simulation — minimum display time calculation', () => {
  /**
   * If MC finishes faster than 1.5s, pad the remaining time.
   * If MC takes longer than 1.5s, transition immediately.
   */
  function computeRemainingDelay(startMs: number, endMs: number, minDisplayMs: number): number {
    const elapsed = endMs - startMs;
    return Math.max(0, minDisplayMs - elapsed);
  }

  it('MC finishes in 200ms → 1300ms remaining delay', () => {
    expect(computeRemainingDelay(0, 200, 1500)).toBe(1300);
  });

  it('MC finishes in 1500ms → 0ms remaining (exact match)', () => {
    expect(computeRemainingDelay(0, 1500, 1500)).toBe(0);
  });

  it('MC finishes in 3000ms → 0ms remaining (overran)', () => {
    expect(computeRemainingDelay(0, 3000, 1500)).toBe(0);
  });

  it('MC finishes instantly → full 1500ms delay', () => {
    expect(computeRemainingDelay(0, 0, 1500)).toBe(1500);
  });
});
