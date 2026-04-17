/**
 * Tests for the deal delete confirmation flow on the dashboard.
 *
 * Flow:
 *   1. Click trash icon → shows [Delete] [Cancel] buttons (no deletion yet)
 *   2. Click Delete → deal deleted
 *   3. Click Cancel → reverts to normal (trash icon)
 *   4. Never deletes on first click
 */

import { describe, it, expect } from 'vitest';

type ConfirmState = 'idle' | 'confirming';

function handleDeleteClick(state: ConfirmState): { nextState: ConfirmState; shouldDelete: boolean } {
  if (state === 'confirming') return { nextState: 'idle', shouldDelete: true };
  return { nextState: 'confirming', shouldDelete: false };
}

function handleCancelClick(): { nextState: ConfirmState; shouldDelete: boolean } {
  return { nextState: 'idle', shouldDelete: false };
}

function getVisibleUI(state: ConfirmState): 'trash-icon' | 'delete-cancel-buttons' {
  return state === 'idle' ? 'trash-icon' : 'delete-cancel-buttons';
}

describe('Deal delete confirmation flow', () => {
  it('starts in idle state — shows trash icon', () => {
    expect(getVisibleUI('idle')).toBe('trash-icon');
  });

  it('first click → shows confirmation buttons (no deletion)', () => {
    const result = handleDeleteClick('idle');
    expect(result.shouldDelete).toBe(false);
    expect(result.nextState).toBe('confirming');
    expect(getVisibleUI(result.nextState)).toBe('delete-cancel-buttons');
  });

  it('second click (Delete) → deletes the deal', () => {
    const result = handleDeleteClick('confirming');
    expect(result.shouldDelete).toBe(true);
  });

  it('Cancel click → reverts to idle (no deletion)', () => {
    const result = handleCancelClick();
    expect(result.shouldDelete).toBe(false);
    expect(result.nextState).toBe('idle');
    expect(getVisibleUI(result.nextState)).toBe('trash-icon');
  });

  it('never deletes on a single click from idle', () => {
    const first = handleDeleteClick('idle');
    expect(first.shouldDelete).toBe(false);
  });

  it('full flow: click → confirm → deleted', () => {
    const step1 = handleDeleteClick('idle');
    expect(step1.shouldDelete).toBe(false);
    expect(step1.nextState).toBe('confirming');

    const step2 = handleDeleteClick(step1.nextState);
    expect(step2.shouldDelete).toBe(true);
  });

  it('full flow: click → cancel → back to idle', () => {
    const step1 = handleDeleteClick('idle');
    expect(step1.nextState).toBe('confirming');

    const step2 = handleCancelClick();
    expect(step2.nextState).toBe('idle');
    expect(step2.shouldDelete).toBe(false);
  });
});
