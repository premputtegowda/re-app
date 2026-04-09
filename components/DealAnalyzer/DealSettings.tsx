'use client';

import { PageHeader } from '@/components/UI/PageHeader';
import { useDealSettingsStore, BEAR_OPTIONS, BULL_OPTIONS, CONFIDENCE_OPTIONS } from '@/lib/dealSettingsStore';
import type { BearPercentile, BullPercentile, ConfidenceLevel } from '@/lib/dealSettingsStore';

function OptionGroup<T extends string>({
  title,
  description,
  options,
  value,
  onChange,
}: {
  title: string;
  description: string;
  options: { percentile?: T; value?: T; label: string; sub: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-5 space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{title}</h3>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{description}</p>
      </div>
      <div className="space-y-2">
        {options.map(option => {
          const key = (option.percentile ?? option.value) as T;
          const isSelected = value === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => onChange(key)}
              className={`w-full flex items-start gap-3 p-3.5 rounded-xl border-2 text-left transition-all ${
                isSelected
                  ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                  : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
              }`}
            >
              <div className={`w-4 h-4 rounded-full border-2 shrink-0 mt-0.5 flex items-center justify-center ${
                isSelected ? 'border-primary-500 bg-primary-500' : 'border-slate-300 dark:border-slate-600'
              }`}>
                {isSelected && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
              </div>
              <div>
                <p className={`text-sm font-semibold ${isSelected ? 'text-primary-700 dark:text-primary-300' : 'text-slate-700 dark:text-slate-300'}`}>
                  {option.label}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{option.sub}</p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function DealSettings() {
  const {
    bearPercentile, setBearPercentile,
    bullPercentile, setBullPercentile,
    recommendedPriceConfidence, setRecommendedPriceConfidence,
  } = useDealSettingsStore();

  return (
    <div className="space-y-8">
      <PageHeader title="Deal Settings" subtitle="Configure Monte Carlo scenario thresholds" />

      <OptionGroup
        title="Bear Case"
        description="Sets the likelihood threshold for the bear case — how probable is it that outcomes are this bad or worse?"
        options={BEAR_OPTIONS}
        value={bearPercentile}
        onChange={setBearPercentile as (v: string) => void}
      />

      <OptionGroup
        title="Bull Case"
        description="Sets the likelihood threshold for the bull case — how probable is it that outcomes reach this level or better?"
        options={BULL_OPTIONS}
        value={bullPercentile}
        onChange={setBullPercentile as (v: string) => void}
      />

      <OptionGroup
        title="Conservative Max Price Confidence"
        description="How confident you want to be when sizing the conservative max purchase price."
        options={CONFIDENCE_OPTIONS.map(o => ({ percentile: o.percentile, label: o.label, sub: o.sub }))}
        value={CONFIDENCE_OPTIONS.find(o => o.value === recommendedPriceConfidence)?.percentile ?? 'p20'}
        onChange={(percentile) => {
          const opt = CONFIDENCE_OPTIONS.find(o => o.percentile === percentile);
          if (opt) setRecommendedPriceConfidence(opt.value as ConfidenceLevel);
        }}
      />
    </div>
  );
}
