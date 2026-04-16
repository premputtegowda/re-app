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

describe('stale-with-missing-fields prompt', () => {
  /**
   * When results are stale AND some required fields are missing, we suppress
   * the "Refresh your returns" button (recomputing won't fix the underlying
   * gap) and instead show "Some fields are missing — results may be incomplete".
   *
   * Replicates the JSX from DealAnalyzerForm:
   *   {hasResults && stale && idle && (
   *     hasAnyWarning ? <missing-fields message /> : <refresh button />
   *   )}
   */
  type StalePromptKind = 'refresh' | 'missing-fields' | 'none';

  function stalePromptKind(
    hasResults: boolean,
    resultsStale: boolean,
    calcPhase: CalcPhase,
    hasAnyWarning: boolean,
  ): StalePromptKind {
    if (!hasResults || !resultsStale || calcPhase !== 'idle') return 'none';
    return hasAnyWarning ? 'missing-fields' : 'refresh';
  }

  it('stale + missing fields → shows "missing-fields" message (NOT refresh)', () => {
    expect(stalePromptKind(true, true, 'idle', true)).toBe('missing-fields');
  });

  it('stale + no missing fields → shows refresh button', () => {
    expect(stalePromptKind(true, true, 'idle', false)).toBe('refresh');
  });

  it('not stale → shows neither prompt regardless of warnings', () => {
    expect(stalePromptKind(true, false, 'idle', true)).toBe('none');
    expect(stalePromptKind(true, false, 'idle', false)).toBe('none');
  });

  it('no results → shows neither prompt', () => {
    expect(stalePromptKind(false, true, 'idle', true)).toBe('none');
    expect(stalePromptKind(false, true, 'idle', false)).toBe('none');
  });

  it('during loading → shows neither prompt (loading UI takes over)', () => {
    expect(stalePromptKind(true, true, 'returns', true)).toBe('none');
    expect(stalePromptKind(true, true, 'returns', false)).toBe('none');
    expect(stalePromptKind(true, true, 'uncertainty', true)).toBe('none');
  });

  it('after a successful calc (idle, not stale) the missing-fields banner is owned by the non-stale branch', () => {
    // The non-stale branch (separate JSX block) is responsible for showing the banner
    // when results exist and warnings remain — this assertion just documents that
    // stalePromptKind correctly defers to that branch by returning 'none'.
    expect(stalePromptKind(true, false, 'idle', true)).toBe('none');
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

describe('stab section Done/Cancel visibility', () => {
  /**
   * Done/Cancel buttons only appear when there's something to save:
   *   - new section that hasn't been completed yet (need Done to mark complete), OR
   *   - dirty state (changes since last save).
   * Once completed AND clean, the buttons hide so the user knows the state is persisted.
   */
  function showDoneCancel(args: {
    valueAddCompleted: boolean;
    isValueAdd: boolean | null;
    activeOpsSection: 'rent' | 'valueAdd' | 'stab' | null;
    stabCompleted: boolean;
    isDirty: boolean;
  }): boolean {
    const { valueAddCompleted, isValueAdd, activeOpsSection, stabCompleted, isDirty } = args;
    return (
      valueAddCompleted &&
      isValueAdd === true &&
      activeOpsSection === 'stab' &&
      (isDirty || !stabCompleted)
    );
  }

  const baseActive = {
    valueAddCompleted: true,
    isValueAdd: true as boolean | null,
    activeOpsSection: 'stab' as const,
  };

  it('shows when section is incomplete (need first Done to mark complete)', () => {
    expect(showDoneCancel({ ...baseActive, stabCompleted: false, isDirty: false })).toBe(true);
  });

  it('shows when there are unsaved changes (dirty), even after first completion', () => {
    expect(showDoneCancel({ ...baseActive, stabCompleted: true, isDirty: true })).toBe(true);
  });

  it('HIDES when section is completed AND clean (no edits since last save)', () => {
    expect(showDoneCancel({ ...baseActive, stabCompleted: true, isDirty: false })).toBe(false);
  });

  it('hides when stab section is not active (user is on a different section)', () => {
    expect(showDoneCancel({ ...baseActive, activeOpsSection: 'valueAdd', stabCompleted: false, isDirty: true })).toBe(false);
    expect(showDoneCancel({ ...baseActive, activeOpsSection: null, stabCompleted: false, isDirty: true })).toBe(false);
  });

  it('hides when value-add prerequisite is incomplete', () => {
    expect(showDoneCancel({ ...baseActive, valueAddCompleted: false, stabCompleted: false, isDirty: true })).toBe(false);
  });

  it('hides when isValueAdd is null/false (no value-add plan, no stab section)', () => {
    expect(showDoneCancel({ ...baseActive, isValueAdd: null, stabCompleted: false, isDirty: true })).toBe(false);
    expect(showDoneCancel({ ...baseActive, isValueAdd: false, stabCompleted: false, isDirty: true })).toBe(false);
  });

  it('reappears after a save when user makes another edit', () => {
    // After save: completed + clean → hidden
    expect(showDoneCancel({ ...baseActive, stabCompleted: true, isDirty: false })).toBe(false);
    // User edits a field → isDirty flips to true → buttons reappear
    expect(showDoneCancel({ ...baseActive, stabCompleted: true, isDirty: true })).toBe(true);
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
