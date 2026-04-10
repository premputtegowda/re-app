'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type BearPercentile = 'p10' | 'p20' | 'p30';
export type BullPercentile = 'p70' | 'p80' | 'p90';
export type ConfidenceLevel = 70 | 80 | 90;

export const BEAR_OPTIONS: { percentile: BearPercentile; label: string; sub: string }[] = [
  { percentile: 'p10', label: 'Severe downside', sub: '10% chance market conditions are this bad or worse' },
  { percentile: 'p20', label: 'Moderate downside', sub: '20% chance market conditions are this bad or worse (default)' },
  { percentile: 'p30', label: 'Mild downside', sub: '30% chance market conditions are this bad or worse' },
];

export const BULL_OPTIONS: { percentile: BullPercentile; label: string; sub: string }[] = [
  { percentile: 'p70', label: 'Mild upside', sub: '30% chance market conditions are this favorable or better' },
  { percentile: 'p80', label: 'Moderate upside', sub: '20% chance market conditions are this favorable or better (default)' },
  { percentile: 'p90', label: 'Strong upside', sub: '10% chance market conditions are this favorable or better' },
];

export const CONFIDENCE_OPTIONS: { value: ConfidenceLevel; label: string; percentile: BearPercentile; sub: string }[] = [
  { value: 90, label: '90% Confidence', percentile: 'p10', sub: 'Target is hit in 9 out of 10 market conditions — very conservative price' },
  { value: 80, label: '80% Confidence', percentile: 'p20', sub: 'Target is hit in 4 out of 5 market conditions (default)' },
  { value: 70, label: '70% Confidence', percentile: 'p30', sub: 'Target is hit in 7 out of 10 market conditions — more aggressive price' },
];

export const PROFORMA_DEFAULTS = {
  propertyMgmtPct: 8,
  capExPerUnit: 500,
  maintenancePct: 5,
};

interface DealSettingsState {
  bearPercentile: BearPercentile;
  bullPercentile: BullPercentile;
  recommendedPriceConfidence: ConfidenceLevel;
  // Pro Forma defaults
  defaultPropertyMgmtPct: number;
  defaultCapExPerUnit: number;
  defaultMaintenancePct: number;
  setBearPercentile: (p: BearPercentile) => void;
  setBullPercentile: (p: BullPercentile) => void;
  setRecommendedPriceConfidence: (level: ConfidenceLevel) => void;
  setDefaultPropertyMgmtPct: (v: number) => void;
  setDefaultCapExPerUnit: (v: number) => void;
  setDefaultMaintenancePct: (v: number) => void;
}

export const useDealSettingsStore = create<DealSettingsState>()(
  persist(
    (set) => ({
      bearPercentile: 'p20',
      bullPercentile: 'p80',
      recommendedPriceConfidence: 80,
      defaultPropertyMgmtPct: PROFORMA_DEFAULTS.propertyMgmtPct,
      defaultCapExPerUnit: PROFORMA_DEFAULTS.capExPerUnit,
      defaultMaintenancePct: PROFORMA_DEFAULTS.maintenancePct,
      setBearPercentile: (p) => set({ bearPercentile: p }),
      setBullPercentile: (p) => set({ bullPercentile: p }),
      setRecommendedPriceConfidence: (level) => set({ recommendedPriceConfidence: level }),
      setDefaultPropertyMgmtPct: (v) => set({ defaultPropertyMgmtPct: v }),
      setDefaultCapExPerUnit: (v) => set({ defaultCapExPerUnit: v }),
      setDefaultMaintenancePct: (v) => set({ defaultMaintenancePct: v }),
    }),
    { name: 'deal-settings' }
  )
);
