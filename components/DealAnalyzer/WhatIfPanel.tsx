'use client';

import { useState, useMemo } from 'react';
import { RotateCcw } from 'lucide-react';
import { Card } from '@/components/UI/Card';
import { projectScenario, formatCurrency, formatPct, formatMultiple } from '@/utils/dealAnalyzerCalc';
import type { CoCAcquisition, CoCOperations, CoCRefinance, CoCResult, ProFormaData, CoCScenario } from '@/types';

// ── Types ──────────────────────────────────────────────────────────────────────

interface WhatIfOverrides {
  grossRent: number; // absolute $/yr — matches ProForma annual values
  vacancyPct: number;
  rentGrowthPct: number;
  opexScale: number;        // multiplier on all expense values (1.0 = unchanged)
  exitCapRate: number;
  interestRate: number;
}

interface WhatIfPanelProps {
  acquisition: CoCAcquisition;
  operations: CoCOperations;
  proForma: ProFormaData;
  refinance: CoCRefinance;
  baseResult: CoCResult;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function deltaColor(delta: number, inverse = false): string {
  const positive = inverse ? delta < 0 : delta > 0;
  if (Math.abs(delta) < 0.001) return 'text-slate-500 dark:text-slate-400';
  return positive
    ? 'text-secondary-600 dark:text-secondary-400'
    : 'text-red-500 dark:text-red-400';
}

function deltaArrow(delta: number, inverse = false): string {
  const positive = inverse ? delta < 0 : delta > 0;
  if (Math.abs(delta) < 0.001) return '';
  return positive ? '▲' : '▼';
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

// ── Slider component ───────────────────────────────────────────────────────────

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  displayValue: string;
  onChange: (v: number) => void;
  isChanged: boolean;
}

function Slider({ label, value, min, max, step, displayValue, onChange, isChanged }: SliderProps) {
  const pct = ((value - min) / (max - min)) * 100;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className={`text-xs font-medium ${isChanged ? 'text-primary-600 dark:text-primary-400' : 'text-slate-600 dark:text-slate-400'}`}>
          {label}
          {isChanged && <span className="ml-1 text-[10px] bg-primary-100 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400 px-1 rounded">edited</span>}
        </span>
        <span className={`text-sm font-semibold tabular-nums ${isChanged ? 'text-primary-700 dark:text-primary-300' : 'text-slate-800 dark:text-slate-200'}`}>
          {displayValue}
        </span>
      </div>
      <div className="relative h-5 flex items-center">
        <div className="w-full h-1.5 rounded-full bg-slate-200 dark:bg-slate-600">
          <div
            className={`h-full rounded-full transition-all ${isChanged ? 'bg-primary-500' : 'bg-slate-400 dark:bg-slate-500'}`}
            style={{ width: `${clamp(pct, 0, 100)}%` }}
          />
        </div>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="absolute inset-0 w-full opacity-0 cursor-pointer h-full"
        />
        {/* Thumb */}
        <div
          className={`absolute w-4 h-4 rounded-full border-2 shadow-sm pointer-events-none transition-colors ${
            isChanged
              ? 'bg-white border-primary-500'
              : 'bg-white dark:bg-slate-300 border-slate-400 dark:border-slate-500'
          }`}
          style={{ left: `calc(${clamp(pct, 0, 100)}% - 8px)` }}
        />
      </div>
      <div className="flex justify-between text-[10px] text-slate-400 dark:text-slate-500">
        <span>{min}{typeof min === 'number' && max <= 100 && min >= 0 ? '%' : ''}</span>
        <span>{max}{typeof max === 'number' && max <= 100 && min >= 0 ? '%' : ''}</span>
      </div>
    </div>
  );
}

// ── KPI delta card ─────────────────────────────────────────────────────────────

interface KPIDeltaProps {
  label: string;
  value: string;
  delta: number;
  deltaFormatted: string;
  inverse?: boolean;
}

function KPIDelta({ label, value, delta, deltaFormatted, inverse }: KPIDeltaProps) {
  return (
    <div className="bg-slate-50 dark:bg-slate-700/40 rounded-xl p-3">
      <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">{label}</p>
      <p className="text-lg font-bold text-slate-900 dark:text-white tabular-nums">{value}</p>
      {Math.abs(delta) > 0.001 && (
        <p className={`text-xs font-medium tabular-nums mt-0.5 ${deltaColor(delta, inverse)}`}>
          {deltaArrow(delta, inverse)} {deltaFormatted}
        </p>
      )}
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export function WhatIfPanel({ acquisition, operations, proForma, refinance, baseResult }: WhatIfPanelProps) {
  const [isOpen, setIsOpen] = useState(false);

  // Base annual rent — prefer stabilized, fall back to t12
  const baseRent = proForma.grossRent.stabilized || proForma.grossRent.t12 || 12000;

  const defaults: WhatIfOverrides = {
    grossRent: baseRent,
    vacancyPct: proForma.vacancyPct.stabilized || proForma.vacancyPct.t12 || 5,
    rentGrowthPct: proForma.grossRent.growthPct,
    opexScale: 1.0,
    exitCapRate: acquisition.exitCapRate || 6,
    interestRate: acquisition.interestRate,
  };

  const [overrides, setOverrides] = useState<WhatIfOverrides>(defaults);

  const set = (key: keyof WhatIfOverrides) => (v: number) =>
    setOverrides((prev) => ({ ...prev, [key]: v }));

  const isChanged = (key: keyof WhatIfOverrides) => overrides[key] !== defaults[key];
  const anyChanged = Object.keys(defaults).some((k) => isChanged(k as keyof WhatIfOverrides));

  const reset = () => setOverrides(defaults);

  // Build modified scenario from overrides
  const whatIfResult = useMemo<CoCResult>(() => {
    const modifiedProForma: ProFormaData = {
      ...proForma,
      grossRent: {
        t12: overrides.grossRent,
        stab: overrides.grossRent,
        stabilized: overrides.grossRent,
        growthPct: overrides.rentGrowthPct,
      },
      otherIncome: {
        ...proForma.otherIncome,
      },
      vacancyPct: {
        t12: overrides.vacancyPct,
        stab: null,
        stabilized: overrides.vacancyPct,
      },
      creditLossPct: proForma.creditLossPct ?? { t12: 0, stab: null, stabilized: 0 },
      expenses: proForma.expenses.map((e) => ({
        ...e,
        t12Value: e.t12Value * overrides.opexScale,
        stabValue: e.stabValue != null ? e.stabValue * overrides.opexScale : null,
        stabilizedValue: e.stabilizedValue * overrides.opexScale,
      })),
    };

    const modifiedAcquisition: CoCAcquisition = {
      ...acquisition,
      interestRate: overrides.interestRate,
      exitCapRate: overrides.exitCapRate,
    };

    const scenario: CoCScenario = {
      id: 'whatif',
      name: 'What If',
      scenarioType: 'base',
      acquisition: modifiedAcquisition,
      operations,
      proForma: modifiedProForma,
      refinance,
      createdAt: '',
      updatedAt: '',
    };

    return projectScenario(scenario);
  }, [overrides, acquisition, operations, proForma, refinance]);

  // Rent slider — annual values matching the ProForma grid
  const rentMin = Math.round(baseRent * 0.5);
  const rentMax = Math.round(baseRent * 2.0);

  return (
    <Card padding="none">
      {/* Header toggle */}
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors rounded-xl"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">
            What If Analysis
          </span>
          {anyChanged && (
            <span className="text-[10px] font-medium bg-primary-100 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400 px-1.5 py-0.5 rounded-full">
              active
            </span>
          )}
        </div>
        <span className="text-xs text-slate-400">{isOpen ? '▲ collapse' : '▼ expand'}</span>
      </button>

      {isOpen && (
        <div className="px-5 pb-5 space-y-6 border-t border-slate-100 dark:border-slate-700 pt-4">

          {/* KPI deltas */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <KPIDelta
              label="Avg CoC Return"
              value={formatPct(whatIfResult.avgCoCReturn)}
              delta={whatIfResult.avgCoCReturn - baseResult.avgCoCReturn}
              deltaFormatted={formatPct(Math.abs(whatIfResult.avgCoCReturn - baseResult.avgCoCReturn))}
            />
            <KPIDelta
              label="IRR"
              value={whatIfResult.irr !== null ? formatPct(whatIfResult.irr) : '—'}
              delta={(whatIfResult.irr ?? 0) - (baseResult.irr ?? 0)}
              deltaFormatted={formatPct(Math.abs((whatIfResult.irr ?? 0) - (baseResult.irr ?? 0)))}
            />
            <KPIDelta
              label="Equity Multiple"
              value={formatMultiple(whatIfResult.equityMultiple)}
              delta={whatIfResult.equityMultiple - baseResult.equityMultiple}
              deltaFormatted={`${Math.abs(whatIfResult.equityMultiple - baseResult.equityMultiple).toFixed(2)}x`}
            />
            <KPIDelta
              label="Total Cash Flow"
              value={formatCurrency(whatIfResult.totalCashFlow)}
              delta={whatIfResult.totalCashFlow - baseResult.totalCashFlow}
              deltaFormatted={formatCurrency(Math.abs(whatIfResult.totalCashFlow - baseResult.totalCashFlow))}
            />
          </div>

          {/* Sliders */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-5">
            <Slider
              label="Gross Rent"
              value={overrides.grossRent}
              min={rentMin}
              max={rentMax}
              step={1000}
              displayValue={`$${Math.round(overrides.grossRent).toLocaleString()}/yr`}
              onChange={set('grossRent')}
              isChanged={isChanged('grossRent')}
            />
            <Slider
              label="Vacancy Rate"
              value={overrides.vacancyPct}
              min={0}
              max={25}
              step={0.5}
              displayValue={formatPct(overrides.vacancyPct)}
              onChange={set('vacancyPct')}
              isChanged={isChanged('vacancyPct')}
            />
            <Slider
              label="Rent Growth / yr"
              value={overrides.rentGrowthPct}
              min={-5}
              max={15}
              step={0.25}
              displayValue={formatPct(overrides.rentGrowthPct)}
              onChange={set('rentGrowthPct')}
              isChanged={isChanged('rentGrowthPct')}
            />
            <Slider
              label="Operating Expenses"
              value={Math.round(overrides.opexScale * 100)}
              min={50}
              max={200}
              step={5}
              displayValue={`${Math.round(overrides.opexScale * 100)}% of base`}
              onChange={(v) => set('opexScale')(v / 100)}
              isChanged={isChanged('opexScale')}
            />
            <Slider
              label="Exit Cap Rate"
              value={overrides.exitCapRate}
              min={3}
              max={12}
              step={0.25}
              displayValue={formatPct(overrides.exitCapRate)}
              onChange={set('exitCapRate')}
              isChanged={isChanged('exitCapRate')}
            />
            <Slider
              label="Interest Rate"
              value={overrides.interestRate}
              min={2}
              max={15}
              step={0.125}
              displayValue={formatPct(overrides.interestRate)}
              onChange={set('interestRate')}
              isChanged={isChanged('interestRate')}
            />
          </div>

          {/* Reset */}
          {anyChanged && (
            <button
              type="button"
              onClick={reset}
              className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 transition-colors"
            >
              <RotateCcw size={12} />
              Reset to original inputs
            </button>
          )}
        </div>
      )}
    </Card>
  );
}
