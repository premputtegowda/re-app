'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type AutoSaveStatus = 'idle' | 'pending' | 'saving' | 'error';

export interface UseDebouncedAutoSaveOptions<T> {
  /** Value to auto-save. When it changes, a save is scheduled after delayMs. */
  value: T;
  /** Called with the current value once the debounce settles. */
  saveFn: (value: T) => Promise<void>;
  /** Debounce delay in ms. Default 1500. */
  delayMs?: number;
  /** When false, no autosaves fire. Default true. */
  enabled?: boolean;
  /** Fired whenever the internal status transitions. */
  onStatusChange?: (status: AutoSaveStatus) => void;
}

export interface UseDebouncedAutoSaveResult {
  /** Current sync status. */
  status: AutoSaveStatus;
  /** The most recent error from saveFn, or null. */
  lastError: Error | null;
  /** Bypass the debounce timer and save immediately. */
  flushNow: () => Promise<void>;
  /** Clear any pending debounce timer without saving. Does not roll back
   *  anything already persisted. */
  cancel: () => void;
}

/**
 * Debounced auto-save hook. Watches `value`; on change, schedules a save via
 * `saveFn` after `delayMs` of idle time. Rapid changes reset the timer so a
 * burst of edits results in a single save. On unmount, any pending save is
 * flushed immediately (fire-and-forget) so typing doesn't get lost when the
 * component tears down.
 *
 * Change detection uses JSON.stringify on the value, which handles nested
 * object identity churn from React re-renders. Callers with expensive-to-
 * serialize values should memoize or pass a projection.
 */
export function useDebouncedAutoSave<T>({
  value,
  saveFn,
  delayMs = 1500,
  enabled = true,
  onStatusChange,
}: UseDebouncedAutoSaveOptions<T>): UseDebouncedAutoSaveResult {
  const [status, setStatus] = useState<AutoSaveStatus>('idle');
  const [lastError, setLastError] = useState<Error | null>(null);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const valueRef = useRef(value);
  // Hash of the last successfully saved value. null before first save so we
  // don't fire on initial mount (initial value != "no previous value").
  const savedHashRef = useRef<string | null>(null);
  // Guard against overlapping saveFn invocations.
  const savingRef = useRef(false);
  const isMountedRef = useRef(true);
  const saveFnRef = useRef(saveFn);
  const onStatusRef = useRef(onStatusChange);

  useEffect(() => { valueRef.current = value; }, [value]);
  useEffect(() => { saveFnRef.current = saveFn; }, [saveFn]);
  useEffect(() => { onStatusRef.current = onStatusChange; }, [onStatusChange]);

  const setStatusAndNotify = useCallback((s: AutoSaveStatus) => {
    setStatus(s);
    onStatusRef.current?.(s);
  }, []);

  // scheduleTimer is defined after performSave so it can reference it via
  // ref, breaking the mutual-dependency loop between the two.
  const performSaveRef = useRef<() => Promise<void>>(async () => {});

  const scheduleTimer = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void performSaveRef.current();
    }, delayMs);
  }, [delayMs]);

  const performSave = useCallback(async (): Promise<void> => {
    if (savingRef.current) return;
    const snapshotValue = valueRef.current;
    const snapshotHash = JSON.stringify(snapshotValue);

    // Nothing to save — bail without touching status.
    if (snapshotHash === savedHashRef.current) {
      return;
    }

    savingRef.current = true;
    if (isMountedRef.current) setStatusAndNotify('saving');
    try {
      await saveFnRef.current(snapshotValue);
      savedHashRef.current = snapshotHash;
      if (isMountedRef.current) {
        setLastError(null);
        // If the value changed while we were saving, schedule another cycle
        // so the user's latest edits eventually land.
        if (JSON.stringify(valueRef.current) !== snapshotHash) {
          setStatusAndNotify('pending');
          scheduleTimer();
        } else {
          setStatusAndNotify('idle');
        }
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      if (isMountedRef.current) {
        setLastError(error);
        setStatusAndNotify('error');
      }
    } finally {
      savingRef.current = false;
    }
  }, [setStatusAndNotify, scheduleTimer]);

  // Keep the ref pointing at the latest performSave so the timer callback
  // (which is captured once via scheduleTimer's setTimeout) always calls
  // the current closure.
  useEffect(() => { performSaveRef.current = performSave; }, [performSave]);

  // Watch value; on real change, transition to pending and schedule a save.
  useEffect(() => {
    if (!enabled) return;
    const currentHash = JSON.stringify(value);
    // First observation: prime the "last saved" reference so the initial
    // value doesn't count as a change requiring save.
    if (savedHashRef.current === null) {
      savedHashRef.current = currentHash;
      return;
    }
    if (currentHash === savedHashRef.current) return;
    // If we're mid-save, don't reschedule; performSave will re-schedule
    // itself when it completes and sees the value has moved.
    if (savingRef.current) return;
    setStatusAndNotify('pending');
    scheduleTimer();
  }, [value, enabled, scheduleTimer, setStatusAndNotify]);

  const flushNow = useCallback(async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    await performSave();
  }, [performSave]);

  const cancel = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (isMountedRef.current) setStatusAndNotify('idle');
  }, [setStatusAndNotify]);

  // On unmount: if there is a pending debounce timer, fire the save
  // immediately (fire-and-forget) so the user's typed changes aren't lost.
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
        void performSaveRef.current();
      }
    };
  }, []);

  return { status, lastError, flushNow, cancel };
}
