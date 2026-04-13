'use client';

import { useState } from 'react';
import { PageHeader } from '@/components/UI/PageHeader';
import { useDealSettingsStore, BEAR_OPTIONS, BULL_OPTIONS, CONFIDENCE_OPTIONS, PROFORMA_DEFAULTS, MC_RANGE_DEFAULTS } from '@/lib/dealSettingsStore';
import type { BearPercentile, BullPercentile, ConfidenceLevel, MCRangeDefaults } from '@/lib/dealSettingsStore';

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

function RangeDefaultRow({ label, unit, pessimisticValue, optimisticValue, onPessimisticChange, onOptimisticChange, step = 0.5, decimals = 1, singleLabel, singleValue, onSingleChange }: {
  label: string;
  unit: string;
  pessimisticValue?: number;
  optimisticValue?: number;
  onPessimisticChange?: (v: number) => void;
  onOptimisticChange?: (v: number) => void;
  step?: number;
  decimals?: number;
  // For single-value rows (e.g. reno overrun max)
  singleLabel?: string;
  singleValue?: number;
  onSingleChange?: (v: number) => void;
}) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const commit = (key: string, raw: string, onChange?: (v: number) => void) => {
    const v = parseFloat(raw);
    if (!isNaN(v) && v >= 0 && onChange) onChange(v);
    setDrafts(d => { const n = { ...d }; delete n[key]; return n; });
  };

  const fieldCls = 'w-16 text-sm text-right font-medium tabular-nums bg-transparent border-none outline-none text-slate-800 dark:text-slate-200';
  const wrapCls  = 'flex items-center gap-1 rounded-lg border px-2.5 py-1.5 border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800';

  return (
    <div className="flex items-center justify-between gap-4 py-3 border-b border-slate-100 dark:border-slate-700 last:border-0">
      <p className="text-sm font-medium text-slate-700 dark:text-slate-300 shrink-0">{label}</p>
      <div className="flex items-center gap-3">
        {singleValue !== undefined && onSingleChange ? (
          <div className={wrapCls}>
            <input className={fieldCls} type="number" step={step}
              value={drafts['single'] ?? parseFloat(singleValue.toFixed(decimals)).toString()}
              onChange={e => setDrafts(d => ({ ...d, single: e.target.value }))}
              onBlur={() => commit('single', drafts['single'] ?? '', onSingleChange)}
              onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
            />
            <span className="text-xs text-slate-400 shrink-0">{singleLabel ?? unit}</span>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-red-400 font-semibold uppercase tracking-wide w-16 text-right">Pessimistic</span>
              <div className={wrapCls}>
                <input className={fieldCls} type="number" step={step}
                  value={drafts['pess'] ?? parseFloat((pessimisticValue ?? 0).toFixed(decimals)).toString()}
                  onChange={e => setDrafts(d => ({ ...d, pess: e.target.value }))}
                  onBlur={() => commit('pess', drafts['pess'] ?? '', onPessimisticChange)}
                  onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                />
                <span className="text-xs text-slate-400 shrink-0">{unit}</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-secondary-500 font-semibold uppercase tracking-wide w-16 text-right">Optimistic</span>
              <div className={wrapCls}>
                <input className={fieldCls} type="number" step={step}
                  value={drafts['optim'] ?? parseFloat((optimisticValue ?? 0).toFixed(decimals)).toString()}
                  onChange={e => setDrafts(d => ({ ...d, optim: e.target.value }))}
                  onBlur={() => commit('optim', drafts['optim'] ?? '', onOptimisticChange)}
                  onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                />
                <span className="text-xs text-slate-400 shrink-0">{unit}</span>
              </div>
            </div>
          </>
        )}
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
    mcRangeDefaults, setMCRangeDefaults,
  } = useDealSettingsStore();

  const setMC = (patch: Partial<MCRangeDefaults>) => setMCRangeDefaults({ ...mcRangeDefaults, ...patch });

  return (
    <div className="space-y-8">
      <PageHeader title="Deal Settings" subtitle="Configure Pro Forma defaults and stress test scenario thresholds" />

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

      {/* Monte Carlo Default Ranges */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-5">
        <div className="mb-1">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Simulation Default Ranges</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            How far below / above the base value the pessimistic and optimistic assumptions reach.
            Percentages are relative offsets; rate variables use points.
          </p>
        </div>

        <div className="mt-3 mb-1">
          <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Percentages</p>
        </div>
        <RangeDefaultRow label="Rent / unit" unit="%"
          pessimisticValue={mcRangeDefaults.rentPessimisticPct}
          optimisticValue={mcRangeDefaults.rentOptimisticPct}
          onPessimisticChange={v => setMC({ rentPessimisticPct: v })}
          onOptimisticChange={v => setMC({ rentOptimisticPct: v })}
        />
        <RangeDefaultRow label="Vacancy Rate" unit="pts"
          pessimisticValue={mcRangeDefaults.vacancyPessimisticPts}
          optimisticValue={mcRangeDefaults.vacancyOptimisticPts}
          onPessimisticChange={v => setMC({ vacancyPessimisticPts: v })}
          onOptimisticChange={v => setMC({ vacancyOptimisticPts: v })}
        />
        <RangeDefaultRow label="Rent Growth" unit="pts"
          pessimisticValue={mcRangeDefaults.rentGrowthPessimisticPts}
          optimisticValue={mcRangeDefaults.rentGrowthOptimisticPts}
          onPessimisticChange={v => setMC({ rentGrowthPessimisticPts: v })}
          onOptimisticChange={v => setMC({ rentGrowthOptimisticPts: v })}
        />
        <RangeDefaultRow label="Expense Growth" unit="pts"
          pessimisticValue={mcRangeDefaults.expenseGrowthPessimisticPts}
          optimisticValue={mcRangeDefaults.expenseGrowthOptimisticPts}
          onPessimisticChange={v => setMC({ expenseGrowthPessimisticPts: v })}
          onOptimisticChange={v => setMC({ expenseGrowthOptimisticPts: v })}
        />
        <RangeDefaultRow label="Reno Overrun" unit="%" step={5} decimals={0}
          singleLabel="max %"
          singleValue={mcRangeDefaults.renoOverrunMaxPct}
          onSingleChange={v => setMC({ renoOverrunMaxPct: v })}
        />

        <div className="mt-4 mb-1">
          <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Rate Points</p>
        </div>
        <RangeDefaultRow label="Exit Cap Rate" unit="pts" step={0.25} decimals={2}
          pessimisticValue={mcRangeDefaults.exitCapRatePessimisticPts}
          optimisticValue={mcRangeDefaults.exitCapRateOptimisticPts}
          onPessimisticChange={v => setMC({ exitCapRatePessimisticPts: v })}
          onOptimisticChange={v => setMC({ exitCapRateOptimisticPts: v })}
        />
        <RangeDefaultRow label="Interest Rate" unit="pts" step={0.25} decimals={2}
          pessimisticValue={mcRangeDefaults.interestRatePessimisticPts}
          optimisticValue={mcRangeDefaults.interestRateOptimisticPts}
          onPessimisticChange={v => setMC({ interestRatePessimisticPts: v })}
          onOptimisticChange={v => setMC({ interestRateOptimisticPts: v })}
        />
        <RangeDefaultRow label="Refi Rate" unit="pts" step={0.25} decimals={2}
          pessimisticValue={mcRangeDefaults.refiRatePessimisticPts}
          optimisticValue={mcRangeDefaults.refiRateOptimisticPts}
          onPessimisticChange={v => setMC({ refiRatePessimisticPts: v })}
          onOptimisticChange={v => setMC({ refiRateOptimisticPts: v })}
        />

        <button
          type="button"
          onClick={() => setMCRangeDefaults(MC_RANGE_DEFAULTS)}
          className="mt-3 text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
        >
          Reset to defaults
        </button>
      </div>

      {/* Stress Test Settings */}
      <div>
        <h2 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-4">Stress Test Settings</h2>

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
