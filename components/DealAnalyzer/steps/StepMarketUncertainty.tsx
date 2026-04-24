'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Check, RotateCcw, X } from 'lucide-react';
import type { CoCAcquisition, CoCRefinance, ProFormaData } from '@/types';
import type { MCRanges } from '@/utils/monteCarlo';
import { computeDefaultRanges } from '@/utils/monteCarlo';
import { useDealSettingsStore } from '@/lib/dealSettingsStore';
import { RangeEditor } from '../MonteCarloPanel';

const VARIABLE_LABELS: Partial<Record<keyof MCRanges, string>> = {
  targetRentPerUnit: 'Rent / unit',
  vacancyPct: 'Vacancy',
  rentGrowthPct: 'Rent growth',
  exitCapRate: 'Exit cap rate',
  renoOverrunPct: 'Reno overrun',
  interestRate: 'Interest rate',
  refiRate: 'Refi rate',
  expenseGrowthPct: 'Expense growth',
  arv: 'Exit value (ARV)',
};

interface StepMarketUncertaintyProps {
  acquisition: CoCAcquisition;
  proForma: ProFormaData;
  refinance: CoCRefinance;
  /** Current persisted ranges, or null if never reviewed. */
  ranges: MCRanges | null;
  /** ISO timestamp of last review, or null if never reviewed. */
  reviewedAt: string | null;
  /** Called when the user accepts ranges (either the recommended defaults or an edited set). */
  onAccept: (ranges: MCRanges) => void;
}

/**
 * Final step of the deal wizard. Users confirm (or adjust) the uncertainty
 * ranges that drive the Recommended Max / Ideal Entry prices downstream.
 *
 * First-time behavior: ranges come pre-filled from computeDefaultRanges.
 * The primary CTA reads "Accept recommended ranges and continue" so users
 * who don't want to tune get a one-click path. Any edit flips the CTA to
 * "Save ranges and continue" so the user knows they're committing their
 * changes.
 */
export function StepMarketUncertainty({
  acquisition, proForma, refinance, ranges, reviewedAt, onAccept,
}: StepMarketUncertaintyProps) {
  const { mcRangeDefaults } = useDealSettingsStore();

  // Same derivation as MonteCarloPanel so the editor's "defaults" column
  // matches what the user sees elsewhere.
  const units = useMemo(() => {
    if (acquisition.propertyType === 'mfr' && acquisition.unitMix.length > 0) {
      return acquisition.unitMix.reduce((s, u) => s + u.count, 0);
    }
    return acquisition.units || 1;
  }, [acquisition.propertyType, acquisition.unitMix, acquisition.units]);

  const avgTargetRentPerUnit = useMemo(() => {
    if (acquisition.propertyType === 'sfr') return acquisition.sfrTargetRent || 0;
    if (acquisition.unitMix.length > 0) {
      const total = acquisition.unitMix.reduce((s, u) => s + u.count, 0);
      if (total === 0) return 0;
      return acquisition.unitMix.reduce((s, u) => s + u.rentMonthly * u.count, 0) / total;
    }
    return 0;
  }, [acquisition.propertyType, acquisition.sfrTargetRent, acquisition.unitMix]);

  const defaults = useMemo(
    () => computeDefaultRanges(acquisition, proForma, avgTargetRentPerUnit, units, refinance, mcRangeDefaults),
    [acquisition, proForma, avgTargetRentPerUnit, units, refinance, mcRangeDefaults],
  );

  // Local draft ranges — seeded from what's saved, then re-anchored to
  // the current defaults so saved spreads stay valid after deal inputs
  // change (e.g. user bumped interest rate from 6.5% to 8% since the last
  // save — the interest-rate range's mode updates, min/max shift by the
  // same delta, preserving the user's relative pessimism/optimism).
  // Also merges defaults for any optional keys missing from the saved set.
  const [draftRanges, setDraftRanges] = useState<MCRanges>(() => {
    if (!ranges) return defaults;
    const next: MCRanges = { ...defaults, ...ranges };
    for (const key of Object.keys(defaults) as (keyof MCRanges)[]) {
      const def = defaults[key];
      const saved = next[key];
      if (!def || !saved) continue;
      if (saved.mode === def.mode) continue;
      const minSpread = saved.min - saved.mode;
      const maxSpread = saved.max - saved.mode;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (next as any)[key] = { min: def.mode + minSpread, mode: def.mode, max: def.mode + maxSpread };
    }
    return next;
  });
  // Initialize the "has the user customized?" flag to match whether ranges
  // were already saved. Otherwise the mount-time defaults-watch effect below
  // would see userEditedRef=false and wipe saved ranges back to defaults.
  const [userEdited, setUserEdited] = useState(ranges !== null);

  // When deal inputs change, the `defaults` object recomputes.
  //  - If the user hasn't customized → draft tracks the new defaults exactly.
  //  - If the user has customized → preserve the point-spread they chose and
  //    shift min/max by the same delta that each variable's base moved.
  // Mirrors the logic in MonteCarloPanel so ranges always stay anchored on
  // current deal inputs, no matter where they're edited.
  const prevDefaultsRef = useRef<MCRanges>(defaults);
  const userEditedRef = useRef<boolean>(ranges !== null);
  useEffect(() => {
    const prev = prevDefaultsRef.current;
    prevDefaultsRef.current = defaults;
    if (!userEditedRef.current) {
      setDraftRanges(defaults);
      return;
    }
    setDraftRanges(current => {
      const next = { ...current };
      let changed = false;
      for (const key of Object.keys(defaults) as (keyof MCRanges)[]) {
        const oldD = prev[key];
        const newD = defaults[key];
        const r = current[key];
        if (!oldD || !newD || !r) continue;
        if (oldD.mode === newD.mode) continue;
        const minSpread = r.min - oldD.mode;
        const maxSpread = r.max - oldD.mode;
        next[key] = { min: newD.mode + minSpread, mode: newD.mode, max: newD.mode + maxSpread };
        changed = true;
      }
      return changed ? next : current;
    });
  }, [defaults]);

  const showRefiRate = refinance?.enabled === true;
  const showArvRange = acquisition.exitMethod !== 'capRate' && acquisition.arv > 0;

  // Detect which variables had their base re-anchored since the saved ranges
  // were written (user changed something upstream that moved the anchor).
  // Empty list → saved ranges are still anchored on current deal inputs.
  const rebasedFields = useMemo<string[]>(() => {
    if (!ranges) return [];
    const changed: string[] = [];
    for (const key of Object.keys(defaults) as (keyof MCRanges)[]) {
      const def = defaults[key];
      const saved = ranges[key];
      if (!def || !saved) continue;
      if (saved.mode !== def.mode) {
        const label = VARIABLE_LABELS[key] ?? key;
        changed.push(label);
      }
    }
    return changed;
  }, [ranges, defaults]);

  const [banner, setBanner] = useState<'auto' | 'dismissed'>('auto');
  const showRebasedBanner = banner === 'auto' && rebasedFields.length > 0 && !userEdited;

  // Edits auto-commit: every RangeEditor onChange is piped up to onAccept,
  // which updates parent state + persists to backend. No explicit Save
  // button — the RangeEditor's own input-level commits ARE the save.
  //
  // Always merge with the current defaults before bubbling up so any
  // optional key the editor doesn't currently expose (arv off, refi off)
  // still lands in persisted ranges. Keeps later status checks simple.
  const handleRangesChange = (r: MCRanges) => {
    const merged = { ...defaults, ...r };
    setDraftRanges(merged);
    setUserEdited(true);
    userEditedRef.current = true;
    onAccept(merged);
  };

  const handleReset = () => {
    setDraftRanges(defaults);
    setUserEdited(false);
    userEditedRef.current = false;
    onAccept(defaults);
  };

  const handleSaveDefaults = () => {
    // No-op — preserving the MC editor's prop signature; profile defaults
    // are a separate settings concern not surfaced here.
  };

  const isFirstReview = reviewedAt === null;

  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-primary-50 dark:bg-primary-900/20 border border-primary-200 dark:border-primary-800 p-4">
        <p className="text-sm font-semibold text-primary-900 dark:text-primary-100 mb-1">
          Set how much each market variable could swing
        </p>
        <p className="text-xs text-primary-800 dark:text-primary-200 leading-relaxed">
          These ranges drive your Ideal Entry and Recommended Max prices. We&rsquo;ve pre-filled
          each variable with sensible defaults based on your deal. Edits save automatically.
        </p>
        <div className="flex items-center justify-between mt-2 flex-wrap gap-2">
          {isFirstReview ? (
            <button
              type="button"
              onClick={() => onAccept({ ...defaults, ...draftRanges })}
              className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary-700 dark:text-primary-300 hover:underline"
            >
              <Check size={12} />
              Mark as reviewed (accept defaults as-is)
            </button>
          ) : reviewedAt ? (
            <p className="text-[10px] text-primary-700 dark:text-primary-300">
              Last reviewed {new Date(reviewedAt).toLocaleString()}
            </p>
          ) : null}
          {userEdited && (
            <button
              type="button"
              onClick={handleReset}
              className="inline-flex items-center gap-1 text-[11px] text-primary-700 dark:text-primary-300 hover:underline"
            >
              <RotateCcw size={10} />
              Reset to recommended
            </button>
          )}
        </div>
      </div>

      {showRebasedBanner && (
        <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50">
          <AlertTriangle size={14} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <div className="flex-1 text-xs text-amber-900 dark:text-amber-200 leading-relaxed">
            <strong>Base values changed — your spread is preserved.</strong>{' '}
            {rebasedFields.length === 1
              ? `The ${rebasedFields[0]} base moved since your last review.`
              : `The following bases moved since your last review: ${rebasedFields.join(', ')}.`}{' '}
            Your pessimistic/optimistic distances are unchanged, but review if you want to retune the spread around the new anchor.
          </div>
          <button
            type="button"
            onClick={() => setBanner('dismissed')}
            aria-label="Dismiss notice"
            className="text-amber-600 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-200 shrink-0 mt-0.5"
          >
            <X size={12} />
          </button>
        </div>
      )}

      <RangeEditor
        ranges={draftRanges}
        defaults={defaults}
        onChange={handleRangesChange}
        onReset={handleReset}
        onSaveAsDefaults={handleSaveDefaults}
        showRefiRate={showRefiRate}
        showArvRange={showArvRange}
      />
    </div>
  );
}
