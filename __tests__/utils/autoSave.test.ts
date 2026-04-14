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
