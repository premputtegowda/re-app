'use client';

import { useState } from 'react';
import { Calculator } from 'lucide-react';
import { Button } from '@/components/UI/Button';
import { ScenarioForm } from './ScenarioForm';
import { ResultsPanel } from './ResultsPanel';
import { useCoCStore } from '@/lib/cashOnCashStore';
import { projectScenario } from '@/utils/cashOnCashCalc';
import type { CoCResult, CoCScenario, CoCScenarioType } from '@/types';

const SCENARIO_CHIPS: { type: CoCScenarioType; label: string }[] = [
  { type: 'base', label: 'Base Case' },
  { type: 'bull', label: 'Bull Case' },
  { type: 'bear', label: 'Bear Case' },
];

const CHIP_COLORS: Record<CoCScenarioType, { active: string; inactive: string }> = {
  base: {
    active: 'bg-primary-600 text-white border-primary-600',
    inactive: 'bg-white dark:bg-slate-800 text-primary-600 dark:text-primary-400 border-primary-300 dark:border-primary-700 hover:bg-primary-50 dark:hover:bg-primary-900/20',
  },
  bull: {
    active: 'bg-secondary-600 text-white border-secondary-600',
    inactive: 'bg-white dark:bg-slate-800 text-secondary-600 dark:text-secondary-400 border-secondary-300 dark:border-secondary-700 hover:bg-secondary-50 dark:hover:bg-secondary-900/20',
  },
  bear: {
    active: 'bg-red-600 text-white border-red-600',
    inactive: 'bg-white dark:bg-slate-800 text-red-600 dark:text-red-400 border-red-300 dark:border-red-700 hover:bg-red-50 dark:hover:bg-red-900/20',
  },
};

export function CashOnCash() {
  const { scenarios, addScenario, updateScenario } = useCoCStore();
  const [activeType, setActiveType] = useState<CoCScenarioType>('base');
  const [results, setResults] = useState<Partial<Record<CoCScenarioType, CoCResult>>>({});
  const [isCalculating, setIsCalculating] = useState(false);

  const getScenarioByType = (type: CoCScenarioType) =>
    scenarios.find((s) => s.scenarioType === type);

  const activeScenario = getScenarioByType(activeType);
  const activeResult = results[activeType] ?? null;

  const handleCalculate = (scenario: CoCScenario) => {
    setIsCalculating(true);
    try {
      const existing = getScenarioByType(scenario.scenarioType);
      if (existing) {
        updateScenario(existing.id, {
          ...scenario,
          id: existing.id,
          createdAt: existing.createdAt,
        });
        const result = projectScenario({ ...scenario, id: existing.id });
        setResults((prev) => ({ ...prev, [activeType]: result }));
      } else {
        const id = addScenario(scenario);
        const result = projectScenario({ ...scenario, id });
        setResults((prev) => ({ ...prev, [activeType]: result }));
      }
    } finally {
      setIsCalculating(false);
    }
  };

  const handleNewAnalysis = () => {
    setActiveType('base');
    setResults({});
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary-50 dark:bg-primary-900/30 rounded-lg text-primary-600 dark:text-primary-400">
            <Calculator size={24} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
              Cash on Cash Analyzer
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Model SFR/MFR investment scenarios with multi-year projections
            </p>
          </div>
        </div>
        <Button variant="secondary" size="sm" onClick={handleNewAnalysis}>
          New Analysis
        </Button>
      </div>

      {/* Scenario Chips */}
      <div className="flex gap-2 flex-wrap">
        {SCENARIO_CHIPS.map(({ type, label }) => {
          const isActive = activeType === type;
          const colors = CHIP_COLORS[type];
          const hasResult = !!results[type];
          return (
            <button
              key={type}
              onClick={() => setActiveType(type)}
              className={`px-4 py-2 rounded-full border font-medium text-sm transition-all ${
                isActive ? colors.active : colors.inactive
              }`}
            >
              {label}
              {hasResult && !isActive && (
                <span className="ml-2 inline-block w-2 h-2 rounded-full bg-current opacity-60" />
              )}
            </button>
          );
        })}
      </div>

      {/* Main Layout */}
      <div className="lg:grid lg:grid-cols-12 lg:gap-6 space-y-6 lg:space-y-0">
        {/* Form Column */}
        <div className="lg:col-span-5">
          <ScenarioForm
            key={activeType}
            scenarioType={activeType}
            defaultValues={activeScenario}
            onCalculate={handleCalculate}
          />
        </div>

        {/* Results Column */}
        <div className="lg:col-span-7">
          {activeResult ? (
            <ResultsPanel result={activeResult} />
          ) : (
            <div className="flex flex-col items-center justify-center h-64 rounded-xl border-2 border-dashed border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
              <Calculator size={48} className="text-slate-300 dark:text-slate-600 mb-4" />
              <p className="text-slate-500 dark:text-slate-400 font-medium">
                Enter deal parameters and click Calculate
              </p>
              <p className="text-slate-400 dark:text-slate-500 text-sm mt-1">
                KPI cards, projection table, and charts will appear here
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
