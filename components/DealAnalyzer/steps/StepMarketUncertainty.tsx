'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, RotateCcw, X } from 'lucide-react';
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

  // Re-anchor detection moved to the parent (DealAnalyzerForm) so the
  // notice can sit in the collapsed step-card header instead of inside
  // the editor body. No banner rendered here anymore.

  // Edits are held in local draft state only — nothing persists to the
  // parent/backend until the user hits Done. Cancel reverts the draft
  // back to whatever was last saved (the `ranges` prop) merged with
  // current defaults (so re-anchoring stays applied).
  const handleRangesChange = (r: MCRanges) => {
    const merged = { ...defaults, ...r };
    setDraftRanges(merged);
    setUserEdited(true);
    userEditedRef.current = true;
  };

  const handleReset = () => {
    setDraftRanges(defaults);
    setUserEdited(false);
    userEditedRef.current = false;
  };

  const handleSaveDefaults = () => {
    // No-op — preserving the MC editor's prop signature; profile defaults
    // are a separate settings concern not surfaced here.
  };

  const handleDone = () => {
    onAccept({ ...defaults, ...draftRanges });
  };

  const handleCancel = () => {
    // Revert draft to the last-saved ranges (or defaults if never saved),
    // applying the same merge-with-defaults safeguard used at mount.
    if (!ranges) {
      setDraftRanges(defaults);
    } else {
      setDraftRanges({ ...defaults, ...ranges });
    }
    setUserEdited(ranges !== null);
    userEditedRef.current = ranges !== null;
  };

  // Opening the step IS the review for a never-reviewed deal. Auto-persist
  // once on mount — parent gates step visibility behind "all earlier steps
  // green," so reaching here implies the user has moved past everything
  // else. After this, further edits require an explicit Done click.
  const autoReviewedRef = useRef(false);
  useEffect(() => {
    if (reviewedAt === null && !autoReviewedRef.current) {
      autoReviewedRef.current = true;
      onAccept({ ...defaults, ...draftRanges });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        {reviewedAt && !userEdited && (
          <p className="text-[10px] text-primary-700 dark:text-primary-300 mt-2">
            Last reviewed {new Date(reviewedAt).toLocaleString()}
          </p>
        )}
        {userEdited && (
          <div className="mt-2">
            <button
              type="button"
              onClick={handleReset}
              className="inline-flex items-center gap-1 text-[11px] text-primary-700 dark:text-primary-300 hover:underline"
            >
              <RotateCcw size={10} />
              Reset to recommended
            </button>
          </div>
        )}
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

      {/* Done / Cancel — commits or reverts all in-flight edits at once. */}
      <div className="flex items-center justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={handleCancel}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-400 hover:border-slate-400 text-xs font-medium transition-colors"
        >
          <X size={12} />
          Cancel
        </button>
        <button
          type="button"
          onClick={handleDone}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-xs font-semibold transition-colors"
        >
          <Check size={12} />
          Done
        </button>
      </div>
    </div>
  );
}
