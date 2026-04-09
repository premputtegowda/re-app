'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type BearPercentile = 'p10' | 'p20' | 'p30';
export type BullPercentile = 'p70' | 'p80' | 'p90';
export type ConfidenceLevel = 70 | 80 | 90;

export const BEAR_OPTIONS: { percentile: BearPercentile; label: string; sub: string }[] = [
  { percentile: 'p10', label: 'P10 — Severe downside', sub: 'Worse than 90% of runs' },
  { percentile: 'p20', label: 'P20 — Moderate downside', sub: 'Worse than 80% of runs (default)' },
  { percentile: 'p30', label: 'P30 — Mild downside', sub: 'Worse than 70% of runs' },
];

export const BULL_OPTIONS: { percentile: BullPercentile; label: string; sub: string }[] = [
  { percentile: 'p70', label: 'P70 — Mild upside', sub: 'Better than 70% of runs' },
  { percentile: 'p80', label: 'P80 — Moderate upside', sub: 'Better than 80% of runs (default)' },
  { percentile: 'p90', label: 'P90 — Strong upside', sub: 'Better than 90% of runs' },
];

export const CONFIDENCE_OPTIONS: { value: ConfidenceLevel; label: string; percentile: BearPercentile; sub: string }[] = [
  { value: 90, label: '90% Confidence', percentile: 'p10', sub: 'Succeeds in 9 out of 10 scenarios' },
  { value: 80, label: '80% Confidence', percentile: 'p20', sub: 'Succeeds in 4 out of 5 scenarios (default)' },
  { value: 70, label: '70% Confidence', percentile: 'p30', sub: 'Succeeds in 7 out of 10 scenarios' },
];

interface DealSettingsState {
  bearPercentile: BearPercentile;
  bullPercentile: BullPercentile;
  recommendedPriceConfidence: ConfidenceLevel;
  setBearPercentile: (p: BearPercentile) => void;
  setBullPercentile: (p: BullPercentile) => void;
  setRecommendedPriceConfidence: (level: ConfidenceLevel) => void;
}

export const useDealSettingsStore = create<DealSettingsState>()(
  persist(
    (set) => ({
      bearPercentile: 'p20',
      bullPercentile: 'p80',
      recommendedPriceConfidence: 80,
      setBearPercentile: (p) => set({ bearPercentile: p }),
      setBullPercentile: (p) => set({ bullPercentile: p }),
      setRecommendedPriceConfidence: (level) => set({ recommendedPriceConfidence: level }),
    }),
    { name: 'deal-settings' }
  )
);
