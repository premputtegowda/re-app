/**
 * Tests for deal title save logic.
 *
 * - Title saves immediately on confirm (not deferred to step completion)
 * - Empty title falls back to default name
 * - Escape reverts to original title without saving
 * - Only saves when deal already exists (savedDealId is set)
 */

import { describe, it, expect } from 'vitest';

// ── Replicate title confirm logic from DealAnalyzerForm ──

interface TitleConfirmInput {
  saveName: string;
  defaultName: string;
  savedDealId: string | null;
}

interface TitleConfirmResult {
  finalName: string;
  shouldSave: boolean;
}

function confirmTitle(input: TitleConfirmInput): TitleConfirmResult {
  const name = input.saveName.trim() || input.defaultName;
  return {
    finalName: name,
    shouldSave: input.savedDealId !== null,
  };
}

function cancelTitle(currentName: string, originalName: string): string {
  return originalName;
}

describe('title confirm', () => {
  it('saves trimmed name when deal exists', () => {
    const result = confirmTitle({
      saveName: '  My Deal  ',
      defaultName: '123 Main St',
      savedDealId: 'deal-123',
    });
    expect(result.finalName).toBe('My Deal');
    expect(result.shouldSave).toBe(true);
  });

  it('falls back to default name when empty', () => {
    const result = confirmTitle({
      saveName: '',
      defaultName: '123 Main St',
      savedDealId: 'deal-123',
    });
    expect(result.finalName).toBe('123 Main St');
    expect(result.shouldSave).toBe(true);
  });

  it('falls back to default when whitespace only', () => {
    const result = confirmTitle({
      saveName: '   ',
      defaultName: '456 Oak Ave',
      savedDealId: 'deal-456',
    });
    expect(result.finalName).toBe('456 Oak Ave');
  });

  it('does not save when no savedDealId (new unsaved deal)', () => {
    const result = confirmTitle({
      saveName: 'New Deal',
      defaultName: '123 Main St',
      savedDealId: null,
    });
    expect(result.finalName).toBe('New Deal');
    expect(result.shouldSave).toBe(false);
  });

  it('preserves special characters in name', () => {
    const result = confirmTitle({
      saveName: '123 Main St — Unit #4',
      defaultName: 'Default',
      savedDealId: 'deal-789',
    });
    expect(result.finalName).toBe('123 Main St — Unit #4');
  });
});

describe('title cancel (Escape)', () => {
  it('reverts to original name', () => {
    const result = cancelTitle('New Name', 'Original Name');
    expect(result).toBe('Original Name');
  });

  it('reverts even when original was empty', () => {
    const result = cancelTitle('Typed Something', '');
    expect(result).toBe('');
  });
});
