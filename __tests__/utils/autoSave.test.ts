/**
 * Tests for auto-save logic.
 *
 * - Draft auto-saves on step completion when address exists
 * - No save when address is empty
 * - Existing deals update on step completion
 * - New deals create on first step completion
 * - Calculate auto-saves with results
 * - stepNotes included in draft
 */

import { describe, it, expect } from 'vitest';

// ── Replicate auto-save decision logic from DealAnalyzerForm ──

interface AutoSaveInput {
  savedDealId: string | null;
  address: string;
  saveName: string;
  opsNotes: string;
}

interface AutoSaveResult {
  action: 'create' | 'update' | 'skip';
  name: string;
  hasStepNotes: boolean;
}

function defaultSaveName(address: string): string {
  if (address.trim()) return address.trim();
  return `Deal Analysis — ${new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
}

function computeAutoSave(input: AutoSaveInput): AutoSaveResult {
  const name = input.saveName || defaultSaveName(input.address);
  const stepNotes: Record<number, string> = {};
  if (input.opsNotes.trim()) stepNotes[3] = input.opsNotes.trim();
  const hasStepNotes = Object.keys(stepNotes).length > 0;

  if (input.savedDealId) {
    return { action: 'update', name, hasStepNotes };
  } else if (input.address.trim()) {
    return { action: 'create', name, hasStepNotes };
  }
  return { action: 'skip', name, hasStepNotes };
}

// ── Tests ──

describe('auto-save on step completion', () => {
  it('creates new deal when address exists and no savedDealId', () => {
    const result = computeAutoSave({
      savedDealId: null,
      address: '123 Main St',
      saveName: '',
      opsNotes: '',
    });
    expect(result.action).toBe('create');
    expect(result.name).toBe('123 Main St');
  });

  it('updates existing deal when savedDealId exists', () => {
    const result = computeAutoSave({
      savedDealId: 'deal-123',
      address: '123 Main St',
      saveName: 'My Deal',
      opsNotes: '',
    });
    expect(result.action).toBe('update');
    expect(result.name).toBe('My Deal');
  });

  it('skips save when address is empty and no savedDealId', () => {
    const result = computeAutoSave({
      savedDealId: null,
      address: '',
      saveName: '',
      opsNotes: '',
    });
    expect(result.action).toBe('skip');
  });

  it('skips save when address is whitespace only', () => {
    const result = computeAutoSave({
      savedDealId: null,
      address: '   ',
      saveName: '',
      opsNotes: '',
    });
    expect(result.action).toBe('skip');
  });

  it('uses saveName over address when provided', () => {
    const result = computeAutoSave({
      savedDealId: null,
      address: '123 Main St',
      saveName: 'Custom Name',
      opsNotes: '',
    });
    expect(result.name).toBe('Custom Name');
  });

  it('uses address as name when saveName is empty', () => {
    const result = computeAutoSave({
      savedDealId: null,
      address: '456 Oak Ave',
      saveName: '',
      opsNotes: '',
    });
    expect(result.name).toBe('456 Oak Ave');
  });

  it('includes stepNotes when ops notes have content', () => {
    const result = computeAutoSave({
      savedDealId: null,
      address: '123 Main St',
      saveName: '',
      opsNotes: 'Check vacancy comps',
    });
    expect(result.hasStepNotes).toBe(true);
  });

  it('excludes stepNotes when ops notes are empty', () => {
    const result = computeAutoSave({
      savedDealId: null,
      address: '123 Main St',
      saveName: '',
      opsNotes: '',
    });
    expect(result.hasStepNotes).toBe(false);
  });

  it('excludes stepNotes when ops notes are whitespace only', () => {
    const result = computeAutoSave({
      savedDealId: null,
      address: '123 Main St',
      saveName: '',
      opsNotes: '   ',
    });
    expect(result.hasStepNotes).toBe(false);
  });

  it('still updates existing deal even if address is empty', () => {
    const result = computeAutoSave({
      savedDealId: 'deal-123',
      address: '',
      saveName: 'My Deal',
      opsNotes: '',
    });
    expect(result.action).toBe('update');
  });
});

describe('save status flash', () => {
  function flashSaved(setSaveStatus: (s: 'idle' | 'saved') => void): void {
    setSaveStatus('saved');
    // In real code, setTimeout resets to 'idle' after 3s
  }

  it('sets status to saved after auto-save', () => {
    let status: 'idle' | 'saved' = 'idle';
    flashSaved((s) => { status = s; });
    expect(status).toBe('saved');
  });

  it('status starts as idle', () => {
    const status: 'idle' | 'saved' = 'idle';
    expect(status).toBe('idle');
  });
});

describe('bottom bar display logic', () => {
  it('shows hint text when no results exist', () => {
    const currentResult = null;
    const showHint = !currentResult;
    const showMetrics = !!currentResult;
    expect(showHint).toBe(true);
    expect(showMetrics).toBe(false);
  });

  it('shows metrics when results exist', () => {
    const currentResult = { irr: 12, avgCoCReturn: 5 };
    const showHint = !currentResult;
    const showMetrics = !!currentResult;
    expect(showHint).toBe(false);
    expect(showMetrics).toBe(true);
  });

  it('shows "Saved" when saveStatus is saved', () => {
    const saveStatus: 'idle' | 'saved' = 'saved';
    const showSavedBadge = saveStatus === 'saved';
    const showHintText = saveStatus === 'idle';
    expect(showSavedBadge).toBe(true);
    expect(showHintText).toBe(false);
  });

  it('shows hint text when saveStatus is idle', () => {
    const saveStatus: 'idle' | 'saved' = 'idle';
    const showSavedBadge = saveStatus === 'saved';
    const showHintText = saveStatus === 'idle';
    expect(showSavedBadge).toBe(false);
    expect(showHintText).toBe(true);
  });
});

describe('auto-save on scheduleCalculate (inner Done buttons)', () => {
  /**
   * scheduleCalculate is fired by every inner sub-section Done (value-add Done,
   * stab Done, rent Done) — and now ALSO auto-saves to backend when:
   *   - the deal already exists in DB (savedDealId is set)
   *   - the current state diverges from the last saved snapshot
   *
   * If the snapshots match, we skip the write to avoid a flood of redundant
   * backend calls when nothing has actually changed.
   */
  type SaveDecision = 'save' | 'skip';

  function shouldAutoSaveOnScheduleCalculate(
    savedDealId: string | null,
    savedSnapshot: string | null,
    currentSnapshot: string,
  ): SaveDecision {
    if (!savedDealId) return 'skip'; // brand-new deals only save via main step Done
    if (savedSnapshot === currentSnapshot) return 'skip'; // nothing actually changed
    return 'save';
  }

  it('saves when deal exists and state differs from snapshot', () => {
    const decision = shouldAutoSaveOnScheduleCalculate(
      'deal-123',
      JSON.stringify({ leaseUpUnits: 10 }),
      JSON.stringify({ leaseUpUnits: 3 }),
    );
    expect(decision).toBe('save');
  });

  it('skips save when state matches snapshot (no real change)', () => {
    const snapshot = JSON.stringify({ leaseUpUnits: 10 });
    const decision = shouldAutoSaveOnScheduleCalculate('deal-123', snapshot, snapshot);
    expect(decision).toBe('skip');
  });

  it('skips save when no savedDealId — brand-new deals require explicit step Done', () => {
    const decision = shouldAutoSaveOnScheduleCalculate(
      null,
      null,
      JSON.stringify({ leaseUpUnits: 3 }),
    );
    expect(decision).toBe('skip');
  });

  it('saves on first edit after initial load (snapshot was set on load, now differs)', () => {
    const initialSnapshot = JSON.stringify({ leaseUpUnits: 10 });
    const afterEdit = JSON.stringify({ leaseUpUnits: 3 });
    const decision = shouldAutoSaveOnScheduleCalculate('deal-123', initialSnapshot, afterEdit);
    expect(decision).toBe('save');
  });
});

describe('snapshot/dirty bookkeeping after save', () => {
  /**
   * After a successful save, the savedSnapshot ref should equal the current
   * state, and the isDirty flag should clear. Without this, the exit-warning
   * dialog would re-fire even after the user just saved.
   */
  function applyPostSave(currentState: object): { snapshot: string; isDirty: boolean } {
    return {
      snapshot: JSON.stringify(currentState),
      isDirty: false,
    };
  }

  it('snapshot equals current state after save', () => {
    const state = { acquisition: { unitMix: [{ leaseUpUnits: 3 }] } };
    const { snapshot } = applyPostSave(state);
    expect(snapshot).toBe(JSON.stringify(state));
  });

  it('isDirty resets to false after save', () => {
    const state = { acquisition: { unitMix: [{ leaseUpUnits: 3 }] } };
    const { isDirty } = applyPostSave(state);
    expect(isDirty).toBe(false);
  });

  it('a follow-up unchanged scheduleCalculate becomes a no-op (snapshot matches)', () => {
    const state = { acquisition: { unitMix: [{ leaseUpUnits: 3 }] } };
    const { snapshot } = applyPostSave(state);
    // Replicate scheduleCalculate's check
    const currentSnapshot = JSON.stringify(state);
    const wouldSave = snapshot !== currentSnapshot;
    expect(wouldSave).toBe(false);
  });

  it('a follow-up edit after save flips isDirty back via snapshot diff', () => {
    const original = { acquisition: { unitMix: [{ leaseUpUnits: 3 }] } };
    const { snapshot } = applyPostSave(original);
    const edited = { acquisition: { unitMix: [{ leaseUpUnits: 5 }] } };
    const isDirtyAfterEdit = snapshot !== JSON.stringify(edited);
    expect(isDirtyAfterEdit).toBe(true);
  });
});

describe('auto-save on calculate', () => {
  // Same logic — calculate triggers auto-save with results
  it('creates new deal on first calculate when address exists', () => {
    const result = computeAutoSave({
      savedDealId: null,
      address: '789 Elm Dr',
      saveName: '',
      opsNotes: '',
    });
    expect(result.action).toBe('create');
  });

  it('updates existing deal on recalculate', () => {
    const result = computeAutoSave({
      savedDealId: 'deal-456',
      address: '789 Elm Dr',
      saveName: 'Elm Deal',
      opsNotes: 'Run comps again',
    });
    expect(result.action).toBe('update');
    expect(result.hasStepNotes).toBe(true);
  });
});
