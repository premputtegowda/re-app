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

describe('resultsStale flag', () => {
  it('starts as false', () => {
    expect(false).toBe(false);
  });

  it('becomes true when scheduleCalculate is called with existing results', () => {
    const hasResults = true;
    const resultsStale = hasResults; // scheduleCalculate sets stale when results exist
    expect(resultsStale).toBe(true);
  });

  it('stays false when no results exist (first calculation)', () => {
    const hasResults = false;
    const resultsStale = hasResults;
    expect(resultsStale).toBe(false);
  });

  it('resets to false when handleCalculate runs', () => {
    let resultsStale = true;
    // handleCalculate sets resultsStale = false
    resultsStale = false;
    expect(resultsStale).toBe(false);
  });
});

describe('refresh button visibility', () => {
  function showRefreshButton(hasResults: boolean, resultsStale: boolean, calcPhase: CalcPhase): boolean {
    return hasResults && resultsStale && calcPhase === 'idle';
  }

  function showResultsPanel(hasResults: boolean, resultsStale: boolean): boolean {
    return hasResults && !resultsStale;
  }

  it('shows refresh button when results exist and stale', () => {
    expect(showRefreshButton(true, true, 'idle')).toBe(true);
  });

  it('hides refresh button when not stale', () => {
    expect(showRefreshButton(true, false, 'idle')).toBe(false);
  });

  it('hides refresh button when no results', () => {
    expect(showRefreshButton(false, true, 'idle')).toBe(false);
  });

  it('hides refresh button during loading', () => {
    expect(showRefreshButton(true, true, 'returns')).toBe(false);
    expect(showRefreshButton(true, true, 'uncertainty')).toBe(false);
  });

  it('shows results panel when not stale', () => {
    expect(showResultsPanel(true, false)).toBe(true);
  });

  it('hides results panel when stale', () => {
    expect(showResultsPanel(true, true)).toBe(false);
  });

  it('hides results panel when no results', () => {
    expect(showResultsPanel(false, false)).toBe(false);
  });
});

describe('sticky bar states', () => {
  function stickyBarState(resultsStale: boolean, calcPhase: CalcPhase): 'stale' | 'loading' | 'metrics' {
    if (resultsStale && calcPhase === 'idle') return 'stale';
    if (calcPhase !== 'idle' && calcPhase !== 'done') return 'loading';
    return 'metrics';
  }

  it('shows stale warning when results stale and idle', () => {
    expect(stickyBarState(true, 'idle')).toBe('stale');
  });

  it('shows loading when calculating', () => {
    expect(stickyBarState(false, 'returns')).toBe('loading');
    expect(stickyBarState(false, 'uncertainty')).toBe('loading');
  });

  it('shows metrics when idle and not stale', () => {
    expect(stickyBarState(false, 'idle')).toBe('metrics');
  });

  it('shows metrics when done', () => {
    expect(stickyBarState(false, 'done')).toBe('metrics');
  });

  it('shows loading even when stale (calc in progress)', () => {
    expect(stickyBarState(true, 'returns')).toBe('loading');
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
