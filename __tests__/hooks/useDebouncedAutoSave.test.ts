import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDebouncedAutoSave } from '@/hooks/useDebouncedAutoSave';

// ── Setup ──────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

/** Advance both fake timers and the microtask queue so awaited promises settle. */
async function advance(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
    await Promise.resolve();
  });
}

/** Just flush microtasks (for post-await settlement without moving the clock). */
async function flushMicrotasks() {
  await act(async () => { await Promise.resolve(); });
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('useDebouncedAutoSave — initial mount', () => {
  it('starts idle and does not call saveFn for the initial value', async () => {
    const saveFn = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useDebouncedAutoSave({ value: 'hello', saveFn, delayMs: 500 }));

    expect(result.current.status).toBe('idle');
    await advance(1000);
    expect(saveFn).not.toHaveBeenCalled();
  });
});

describe('useDebouncedAutoSave — debounce', () => {
  it('transitions pending → saving → idle when value changes and debounce elapses', async () => {
    const saveFn = vi.fn().mockResolvedValue(undefined);
    const { result, rerender } = renderHook(
      ({ v }: { v: string }) => useDebouncedAutoSave({ value: v, saveFn, delayMs: 500 }),
      { initialProps: { v: 'a' } }
    );

    // Initial value is primed silently.
    expect(result.current.status).toBe('idle');

    rerender({ v: 'b' });
    // Change was observed → pending, timer running, not yet firing.
    expect(result.current.status).toBe('pending');
    expect(saveFn).not.toHaveBeenCalled();

    // Advance almost the full delay — still pending.
    await advance(499);
    expect(saveFn).not.toHaveBeenCalled();

    // Elapse — saveFn fires, then resolves.
    await advance(1);
    await flushMicrotasks();
    expect(saveFn).toHaveBeenCalledExactlyOnceWith('b');
    expect(result.current.status).toBe('idle');
    expect(result.current.lastError).toBeNull();
  });

  it('resets the timer when the value changes again during the debounce window', async () => {
    const saveFn = vi.fn().mockResolvedValue(undefined);
    const { result, rerender } = renderHook(
      ({ v }: { v: string }) => useDebouncedAutoSave({ value: v, saveFn, delayMs: 500 }),
      { initialProps: { v: 'a' } }
    );

    rerender({ v: 'b' });
    await advance(300);
    rerender({ v: 'c' });
    await advance(300);
    // 600ms total elapsed since first change, but only 300ms since last change → still pending.
    expect(saveFn).not.toHaveBeenCalled();
    expect(result.current.status).toBe('pending');

    await advance(200); // total 500ms since last change
    await flushMicrotasks();
    // Only ONE save, with the latest value.
    expect(saveFn).toHaveBeenCalledExactlyOnceWith('c');
  });

  it('does not schedule a save when the value re-passes the same content', async () => {
    const saveFn = vi.fn().mockResolvedValue(undefined);
    const obj = { x: 1 };
    const { result, rerender } = renderHook(
      ({ v }: { v: { x: number } }) => useDebouncedAutoSave({ value: v, saveFn, delayMs: 500 }),
      { initialProps: { v: obj } }
    );

    // Re-render with a fresh object literal that has the same content.
    rerender({ v: { x: 1 } });
    await advance(1000);
    expect(saveFn).not.toHaveBeenCalled();
    expect(result.current.status).toBe('idle');
  });
});

describe('useDebouncedAutoSave — flushNow and cancel', () => {
  it('flushNow bypasses the debounce and saves immediately', async () => {
    const saveFn = vi.fn().mockResolvedValue(undefined);
    const { result, rerender } = renderHook(
      ({ v }: { v: string }) => useDebouncedAutoSave({ value: v, saveFn, delayMs: 5000 }),
      { initialProps: { v: 'a' } }
    );

    rerender({ v: 'b' });
    expect(result.current.status).toBe('pending');

    await act(async () => { await result.current.flushNow(); });
    expect(saveFn).toHaveBeenCalledExactlyOnceWith('b');
    expect(result.current.status).toBe('idle');
  });

  it('cancel clears the pending timer and returns to idle without calling saveFn', async () => {
    const saveFn = vi.fn().mockResolvedValue(undefined);
    const { result, rerender } = renderHook(
      ({ v }: { v: string }) => useDebouncedAutoSave({ value: v, saveFn, delayMs: 500 }),
      { initialProps: { v: 'a' } }
    );

    rerender({ v: 'b' });
    expect(result.current.status).toBe('pending');

    act(() => { result.current.cancel(); });
    expect(result.current.status).toBe('idle');

    await advance(1000);
    expect(saveFn).not.toHaveBeenCalled();
  });
});

describe('useDebouncedAutoSave — error handling', () => {
  it('sets status to error and records lastError when saveFn rejects', async () => {
    const boom = new Error('offline');
    const saveFn = vi.fn().mockRejectedValue(boom);
    const { result, rerender } = renderHook(
      ({ v }: { v: string }) => useDebouncedAutoSave({ value: v, saveFn, delayMs: 500 }),
      { initialProps: { v: 'a' } }
    );

    rerender({ v: 'b' });
    await advance(500);
    await flushMicrotasks();

    expect(result.current.status).toBe('error');
    expect(result.current.lastError).toBe(boom);
  });

  it('recovers to idle on a subsequent successful save', async () => {
    const saveFn = vi.fn()
      .mockRejectedValueOnce(new Error('flake'))
      .mockResolvedValue(undefined);
    const { result, rerender } = renderHook(
      ({ v }: { v: string }) => useDebouncedAutoSave({ value: v, saveFn, delayMs: 500 }),
      { initialProps: { v: 'a' } }
    );

    rerender({ v: 'b' });
    await advance(500);
    await flushMicrotasks();
    expect(result.current.status).toBe('error');

    rerender({ v: 'c' });
    await advance(500);
    await flushMicrotasks();
    expect(result.current.status).toBe('idle');
    expect(result.current.lastError).toBeNull();
  });
});

describe('useDebouncedAutoSave — enabled flag', () => {
  it('does not schedule saves when enabled=false', async () => {
    const saveFn = vi.fn().mockResolvedValue(undefined);
    const { result, rerender } = renderHook(
      ({ v, enabled }: { v: string; enabled: boolean }) =>
        useDebouncedAutoSave({ value: v, saveFn, delayMs: 500, enabled }),
      { initialProps: { v: 'a', enabled: false } }
    );

    rerender({ v: 'b', enabled: false });
    await advance(1000);
    expect(saveFn).not.toHaveBeenCalled();
    expect(result.current.status).toBe('idle');
  });

  it('treats the value at enabled-flip-time as the baseline (does not fire retro-save)', async () => {
    // Rationale: if enabled was false, the hook wasn't tracking. When it
    // becomes true we can't know whether the current value came from user
    // input or from parent init, so we prime the baseline and only save
    // on subsequent actual changes.
    const saveFn = vi.fn().mockResolvedValue(undefined);
    const { rerender } = renderHook(
      ({ v, enabled }: { v: string; enabled: boolean }) =>
        useDebouncedAutoSave({ value: v, saveFn, delayMs: 500, enabled }),
      { initialProps: { v: 'a', enabled: false } }
    );

    rerender({ v: 'b', enabled: true });
    await advance(500);
    await flushMicrotasks();
    // 'b' was primed as baseline — no save fires.
    expect(saveFn).not.toHaveBeenCalled();

    // A subsequent change fires a save as expected.
    rerender({ v: 'c', enabled: true });
    await advance(500);
    await flushMicrotasks();
    expect(saveFn).toHaveBeenCalledExactlyOnceWith('c');
  });
});

describe('useDebouncedAutoSave — unmount', () => {
  it('flushes the pending save when the component unmounts mid-debounce', async () => {
    const saveFn = vi.fn().mockResolvedValue(undefined);
    const { rerender, unmount } = renderHook(
      ({ v }: { v: string }) => useDebouncedAutoSave({ value: v, saveFn, delayMs: 5000 }),
      { initialProps: { v: 'a' } }
    );

    rerender({ v: 'b' });
    // Way before the timer would have fired naturally.
    unmount();
    await flushMicrotasks();

    expect(saveFn).toHaveBeenCalledExactlyOnceWith('b');
  });

  it('does not flush on unmount if there is no pending timer', async () => {
    const saveFn = vi.fn().mockResolvedValue(undefined);
    const { unmount } = renderHook(() =>
      useDebouncedAutoSave({ value: 'a', saveFn, delayMs: 500 })
    );

    unmount();
    await flushMicrotasks();
    expect(saveFn).not.toHaveBeenCalled();
  });
});

describe('useDebouncedAutoSave — concurrent changes during save', () => {
  it('schedules a follow-up save when value changes while saveFn is in flight', async () => {
    let resolveFirst: (() => void) | null = null;
    const saveFn = vi.fn()
      .mockImplementationOnce(() => new Promise<void>((r) => { resolveFirst = () => r(); }))
      .mockResolvedValue(undefined);

    const { result, rerender } = renderHook(
      ({ v }: { v: string }) => useDebouncedAutoSave({ value: v, saveFn, delayMs: 500 }),
      { initialProps: { v: 'a' } }
    );

    rerender({ v: 'b' });
    await advance(500); // fires save with 'b', now hanging
    expect(saveFn).toHaveBeenCalledExactlyOnceWith('b');
    expect(result.current.status).toBe('saving');

    // User keeps typing while the first save is in flight.
    rerender({ v: 'c' });
    // Still saving — no second call yet.
    expect(saveFn).toHaveBeenCalledOnce();

    // Complete the first save.
    resolveFirst!();
    await flushMicrotasks();

    // Post-completion, the hook sees value moved to 'c' → pending again.
    expect(result.current.status).toBe('pending');

    await advance(500);
    await flushMicrotasks();
    expect(saveFn).toHaveBeenCalledTimes(2);
    expect(saveFn).toHaveBeenLastCalledWith('c');
  });
});

describe('useDebouncedAutoSave — onStatusChange callback', () => {
  it('fires onStatusChange for every status transition', async () => {
    const saveFn = vi.fn().mockResolvedValue(undefined);
    const onStatusChange = vi.fn();

    const { rerender } = renderHook(
      ({ v }: { v: string }) => useDebouncedAutoSave({ value: v, saveFn, delayMs: 500, onStatusChange }),
      { initialProps: { v: 'a' } }
    );

    rerender({ v: 'b' });
    await advance(500);
    await flushMicrotasks();

    const calls = onStatusChange.mock.calls.map((c) => c[0]);
    expect(calls).toEqual(['pending', 'saving', 'idle']);
  });
});
