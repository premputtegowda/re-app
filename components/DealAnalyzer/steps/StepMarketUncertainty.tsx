'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, RotateCcw } from 'lucide-react';
import type { CoCAcquisition, CoCRefinance, ProFormaData } from '@/types';
import type { MCRanges } from '@/utils/monteCarlo';
import { computeDefaultRanges } from '@/utils/monteCarlo';
import { useDealSettingsStore } from '@/lib/dealSettingsStore';
import { RangeEditor } from '../MonteCarloPanel';

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

  // Local draft ranges — seeded from what's saved (or defaults if never reviewed).
  const [draftRanges, setDraftRanges] = useState<MCRanges>(ranges ?? defaults);
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

  // Edits auto-commit: every RangeEditor onChange is piped up to onAccept,
  // which updates parent state + persists to backend. No explicit Save
  // button — the RangeEditor's own input-level commits ARE the save.
  const handleRangesChange = (r: MCRanges) => {
    setDraftRanges(r);
    setUserEdited(true);
    userEditedRef.current = true;
    onAccept(r);
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
              onClick={() => onAccept(draftRanges)}
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
