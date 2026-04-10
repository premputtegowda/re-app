'use client';

import { useState } from 'react';
import { PageHeader } from '@/components/UI/PageHeader';
import { useDealSettingsStore, BEAR_OPTIONS, BULL_OPTIONS, CONFIDENCE_OPTIONS, PROFORMA_DEFAULTS } from '@/lib/dealSettingsStore';
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

function NumberField({ label, value, onChange, suffix, prefix, hint }: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  suffix?: string;
  prefix?: string;
  hint?: string;
}) {
  const [draft, setDraft] = useState(String(value));
  const [focused, setFocused] = useState(false);

  const commit = () => {
    const p = parseFloat(draft);
    if (!isNaN(p) && p >= 0) onChange(p);
    else setDraft(String(value));
    setFocused(false);
  };

  return (
    <div className="flex items-center justify-between gap-4 py-3 border-b border-slate-100 dark:border-slate-700 last:border-0">
      <div>
        <p className="text-sm font-medium text-slate-700 dark:text-slate-300">{label}</p>
        {hint && <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">{hint}</p>}
      </div>
      <div className={`flex items-center gap-1 rounded-lg border px-3 py-1.5 transition-colors ${focused ? 'border-primary-400 dark:border-primary-500' : 'border-slate-200 dark:border-slate-600'} bg-white dark:bg-slate-800`}>
        {prefix && <span className="text-sm text-slate-400 dark:text-slate-500 shrink-0">{prefix}</span>}
        <input
          className="w-16 text-sm text-right font-medium text-slate-800 dark:text-slate-200 bg-transparent border-none outline-none"
          value={focused ? draft : String(value)}
          onChange={e => setDraft(e.target.value)}
          onFocus={() => { setDraft(String(value)); setFocused(true); }}
          onBlur={commit}
          onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setDraft(String(value)); setFocused(false); } }}
        />
        {suffix && <span className="text-sm text-slate-400 dark:text-slate-500 shrink-0">{suffix}</span>}
      </div>
    </div>
  );
}

export function DealSettings() {
  const {
    bearPercentile, setBearPercentile,
    bullPercentile, setBullPercentile,
    recommendedPriceConfidence, setRecommendedPriceConfidence,
    defaultPropertyMgmtPct, setDefaultPropertyMgmtPct,
    defaultCapExPerUnit, setDefaultCapExPerUnit,
    defaultMaintenancePct, setDefaultMaintenancePct,
  } = useDealSettingsStore();

  return (
    <div className="space-y-8">
      <PageHeader title="Deal Settings" subtitle="Configure Pro Forma defaults and Monte Carlo scenario thresholds" />

      {/* Pro Forma Defaults */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-5">
        <div className="mb-4">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Pro Forma Defaults</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Initial values applied when creating a new Pro Forma. You can override these per deal.</p>
        </div>
        <NumberField
          label="Property Management"
          value={defaultPropertyMgmtPct}
          onChange={setDefaultPropertyMgmtPct}
          suffix="%"
          hint="% of Effective Gross Income"
        />
        <NumberField
          label="CapEx Reserves"
          value={defaultCapExPerUnit}
          onChange={setDefaultCapExPerUnit}
          prefix="$"
          suffix="/ unit"
          hint="Multiplied by unit count when initializing"
        />
        <NumberField
          label="Maintenance & Repairs"
          value={defaultMaintenancePct}
          onChange={setDefaultMaintenancePct}
          suffix="%"
          hint="% of Effective Gross Income"
        />
        <button
          type="button"
          onClick={() => { setDefaultPropertyMgmtPct(PROFORMA_DEFAULTS.propertyMgmtPct); setDefaultCapExPerUnit(PROFORMA_DEFAULTS.capExPerUnit); setDefaultMaintenancePct(PROFORMA_DEFAULTS.maintenancePct); }}
          className="mt-3 text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
        >
          Reset to defaults
        </button>
      </div>

      {/* Monte Carlo Settings */}
      <div>
        <h2 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-4">Monte Carlo Settings</h2>

        <div className="space-y-4">
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
      </div>
    </div>
  );
}
