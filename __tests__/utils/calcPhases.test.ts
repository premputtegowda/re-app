/**
 * Tests for calculation loading phase logic.
 *
 * - Phase transitions: idle → returns → uncertainty → done → idle
 * - Phase messages match the current state
 * - Base returns checkmark only shows in uncertainty phase
 */

import { describe, it, expect } from 'vitest';

type CalcPhase = 'idle' | 'returns' | 'uncertainty' | 'done';

function getPhaseMessage(phase: CalcPhase): { heading: string; sub: string } | null {
  if (phase === 'returns') return {
    heading: 'Calculating returns…',
    sub: 'Projecting cash flows, IRR, and equity multiple',
  };
  if (phase === 'uncertainty') return {
    heading: 'Analyzing market uncertainty…',
    sub: 'Stress testing your deal across thousands of market scenarios',
  };
  return null;
}

function showLoading(phase: CalcPhase): boolean {
  return phase !== 'idle' && phase !== 'done';
}

function showBaseReturnsDone(phase: CalcPhase): boolean {
  return phase === 'uncertainty';
}

describe('calcPhase transitions', () => {
  it('starts at idle', () => {
    const phase: CalcPhase = 'idle';
    expect(showLoading(phase)).toBe(false);
  });

  it('returns phase shows loading', () => {
    expect(showLoading('returns')).toBe(true);
  });

  it('uncertainty phase shows loading', () => {
    expect(showLoading('uncertainty')).toBe(true);
  });

  it('done phase hides loading', () => {
    expect(showLoading('done')).toBe(false);
  });

  it('idle phase hides loading', () => {
    expect(showLoading('idle')).toBe(false);
  });
});

describe('calcPhase messages', () => {
  it('returns phase shows calculating returns message', () => {
    const msg = getPhaseMessage('returns');
    expect(msg).not.toBeNull();
    expect(msg!.heading).toBe('Calculating returns…');
    expect(msg!.sub).toContain('cash flows');
  });

  it('uncertainty phase shows market uncertainty message', () => {
    const msg = getPhaseMessage('uncertainty');
    expect(msg).not.toBeNull();
    expect(msg!.heading).toBe('Analyzing market uncertainty…');
    expect(msg!.sub).toContain('Stress testing');
  });

  it('idle phase has no message', () => {
    expect(getPhaseMessage('idle')).toBeNull();
  });

  it('done phase has no message', () => {
    expect(getPhaseMessage('done')).toBeNull();
  });
});

describe('base returns checkmark', () => {
  it('shows only in uncertainty phase', () => {
    expect(showBaseReturnsDone('uncertainty')).toBe(true);
  });

  it('hidden in returns phase', () => {
    expect(showBaseReturnsDone('returns')).toBe(false);
  });

  it('hidden in idle phase', () => {
    expect(showBaseReturnsDone('idle')).toBe(false);
  });

  it('hidden in done phase', () => {
    expect(showBaseReturnsDone('done')).toBe(false);
  });
});

describe('full phase sequence', () => {
  it('follows correct order: idle → returns → uncertainty → done → idle', () => {
    const phases: CalcPhase[] = ['idle', 'returns', 'uncertainty', 'done', 'idle'];
    const loadingStates = phases.map(showLoading);
    expect(loadingStates).toEqual([false, true, true, false, false]);
  });

  it('messages transition correctly through phases', () => {
    const phases: CalcPhase[] = ['idle', 'returns', 'uncertainty', 'done', 'idle'];
    const messages = phases.map(getPhaseMessage);
    expect(messages[0]).toBeNull();
    expect(messages[1]!.heading).toContain('returns');
    expect(messages[2]!.heading).toContain('uncertainty');
    expect(messages[3]).toBeNull();
    expect(messages[4]).toBeNull();
  });
});
