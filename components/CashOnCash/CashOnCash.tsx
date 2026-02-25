'use client';

import { useState, useRef, useEffect } from 'react';
import { Calculator, RefreshCw } from 'lucide-react';
import { Card } from '@/components/UI/Card';
import { Button } from '@/components/UI/Button';
import { StepBar } from './StepBar';
import { StepProperty } from './steps/StepProperty';
import { StepFinancing } from './steps/StepFinancing';
import { StepRenovation } from './steps/StepRenovation';
import { StepOperations } from './steps/StepOperations';
import { StepRefinance } from './steps/StepRefinance';
import { ResultsPanel } from './ResultsPanel';
import { projectScenario } from '@/utils/cashOnCashCalc';
import { useCoCStore } from '@/lib/cashOnCashStore';
import type {
  CoCAcquisition,
  CoCOperations,
  CoCRefinance,
  CoCResult,
  CoCScenario,
  CoCScenarioType,
} from '@/types';

// ── Step definitions ──────────────────────────────────────────────────────────

const STEPS = [
  { label: 'Property' },
  { label: 'Financing' },
  { label: 'Renovation', optional: true },
  { label: 'Operations' },
  { label: 'Refinance', optional: true },
  { label: 'Results' },
] as const;

const RESULTS_STEP = STEPS.length - 1;

// ── Default form values ───────────────────────────────────────────────────────

const DEFAULT_ACQUISITION: CoCAcquisition = {
  propertyAddress: '',
  propertyType: 'sfr',
  units: 1,
  sfrBeds: 0,
  sfrBaths: 0,
  unitMix: [],
  purchasePrice: 0,
  arv: 0,
  downPaymentPct: 0,
  closingCostsPct: 0,
  points: 0,
  hardCostItems: [],
  softCostItems: [],
  opportunityCostItems: [],
  renovationMonths: 0,
  interestRate: 0,
  loanTermYears: 0,
  ioPeriodMonths: 0,
  stabilizedMonth: 1,
  projectionYears: 5,
};

const DEFAULT_OPERATIONS: CoCOperations = {
  grossRentMonthly: 0,
  vacancyRatePct: 0,
  opexPct: 0,
  propertyMgmtPct: 0,
  annualRentGrowthPct: 0,
};

const DEFAULT_REFINANCE: CoCRefinance = {
  enabled: false,
  refiYear: 3,
  newLTV: 0,
  newInterestRate: 0,
  newLoanTermYears: 0,
};

// ── Scenario chip styles ──────────────────────────────────────────────────────

const CHIP_ACTIVE: Record<CoCScenarioType, string> = {
  base: 'bg-primary-600 text-white border-primary-600',
  bull: 'bg-secondary-600 text-white border-secondary-600',
  bear: 'bg-red-600 text-white border-red-600',
};

const CHIP_INACTIVE: Record<CoCScenarioType, string> = {
  base: 'border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-400 hover:border-primary-400 dark:hover:border-primary-500',
  bull: 'border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-400 hover:border-secondary-400 dark:hover:border-secondary-500',
  bear: 'border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-400 hover:border-red-400 dark:hover:border-red-500',
};

const CHIP_LABELS: Record<CoCScenarioType, string> = {
  base: 'Base Case',
  bull: 'Bull Case',
  bear: 'Bear Case',
};

// ── Step validation ───────────────────────────────────────────────────────────

function validateStep(
  step: number,
  acquisition: CoCAcquisition,
  operations: CoCOperations
): string[] {
  if (step === 1) {
    const errs: string[] = [];
    if (acquisition.purchasePrice <= 0) errs.push('Purchase price must be greater than 0');
    if (acquisition.arv <= 0) errs.push('ARV must be greater than 0');
    if (acquisition.downPaymentPct < 0 || acquisition.downPaymentPct > 100)
      errs.push('Down payment must be between 0% and 100%');
    if (acquisition.projectionYears < 1 || acquisition.projectionYears > 30)
      errs.push('Projection horizon must be 1–30 years');
    return errs;
  }
  if (step === 3) {
    const errs: string[] = [];
    const effectiveRent =
      acquisition.unitMix.length > 0
        ? acquisition.unitMix.reduce((sum, e) => sum + e.count * e.rentMonthly, 0)
        : operations.grossRentMonthly;
    if (effectiveRent <= 0) errs.push('Gross rent must be greater than 0');
    if (operations.vacancyRatePct < 0 || operations.vacancyRatePct > 100)
      errs.push('Vacancy rate must be between 0% and 100%');
    return errs;
  }
  return [];
}

// ── Component ─────────────────────────────────────────────────────────────────

export function CashOnCash() {
  const [currentStep, setCurrentStep] = useState(0);
  const [visitedSteps, setVisitedSteps] = useState<Set<number>>(new Set([0]));
  const [errors, setErrors] = useState<string[]>([]);

  const [acquisition, setAcquisition] = useState<CoCAcquisition>(DEFAULT_ACQUISITION);
  const [operations, setOperations] = useState<CoCOperations>(DEFAULT_OPERATIONS);
  const [refinance, setRefinance] = useState<CoCRefinance>(DEFAULT_REFINANCE);

  const [activeType, setActiveType] = useState<CoCScenarioType>('base');
  const [scenarioResults, setScenarioResults] = useState<
    Partial<Record<CoCScenarioType, CoCResult>>
  >({});

  const { addScenario } = useCoCStore();
  const resultsRef = useRef<HTMLDivElement>(null);

  // Keep grossRentMonthly in sync with unit mix total for MFR
  useEffect(() => {
    if (acquisition.propertyType === 'mfr' && acquisition.unitMix.length > 0) {
      const total = acquisition.unitMix.reduce((sum, e) => sum + e.count * e.rentMonthly, 0);
      setOperations((prev) => ({ ...prev, grossRentMonthly: total }));
    }
  }, [acquisition.unitMix, acquisition.propertyType]);


  const currentResult = scenarioResults[activeType] ?? null;

  // ── Field updaters ──

  const updateAcquisition = (field: keyof CoCAcquisition, value: unknown) =>
    setAcquisition((prev) => ({ ...prev, [field]: value }));

  const updateOperations = (field: keyof CoCOperations, value: number) =>
    setOperations((prev) => ({ ...prev, [field]: value }));

  const updateRefinance = (field: keyof CoCRefinance, value: number | boolean) =>
    setRefinance((prev) => ({ ...prev, [field]: value }));

  // ── Navigation ──

  const goToStep = (step: number) => {
    if (step === RESULTS_STEP && !currentResult) return;
    setCurrentStep(step);
    setVisitedSteps((prev) => { const s = new Set(prev); s.add(step); return s; });
    setErrors([]);
  };

  const handleNext = () => {
    const errs = validateStep(currentStep, acquisition, operations);
    if (errs.length > 0) {
      setErrors(errs);
      return;
    }
    setErrors([]);
    goToStep(currentStep + 1);
  };

  const handleCalculate = () => {
    const effectiveRent =
      acquisition.unitMix.length > 0
        ? acquisition.unitMix.reduce((sum, e) => sum + e.count * e.rentMonthly, 0)
        : operations.grossRentMonthly;
    const errs = [
      ...(acquisition.purchasePrice <= 0 ? ['Purchase price must be greater than 0'] : []),
      ...(acquisition.arv <= 0 ? ['ARV must be greater than 0'] : []),
      ...(effectiveRent <= 0 ? ['Gross rent must be greater than 0'] : []),
    ];
    if (errs.length > 0) {
      setErrors(errs);
      return;
    }
    setErrors([]);

    const scenario: CoCScenario = {
      id: Date.now().toString(36),
      name: CHIP_LABELS[activeType],
      scenarioType: activeType,
      acquisition,
      operations,
      refinance,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const newResult = projectScenario(scenario);
    addScenario(scenario);
    setScenarioResults((prev) => ({ ...prev, [activeType]: newResult }));
    setVisitedSteps((prev) => { const s = new Set(prev); s.add(RESULTS_STEP); return s; });
    setCurrentStep(RESULTS_STEP);

    setTimeout(() => {
      resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 150);
  };

  const handleNewAnalysis = () => {
    setAcquisition(DEFAULT_ACQUISITION);
    setOperations(DEFAULT_OPERATIONS);
    setRefinance(DEFAULT_REFINANCE);
    setScenarioResults({});
    setActiveType('base');
    setCurrentStep(0);
    setVisitedSteps(new Set<number>([0]));
    setErrors([]);
  };

  // ── Step content renderer ──

  const renderStepContent = () => {
    switch (currentStep) {
      case 0:
        return <StepProperty data={acquisition} onChange={updateAcquisition} />;
      case 1:
        return <StepFinancing data={acquisition} onChange={updateAcquisition} />;
      case 2:
        return <StepRenovation data={acquisition} onChange={updateAcquisition} />;
      case 3:
        return (
          <StepOperations
            data={operations}
            onChange={updateOperations}
            propertyType={acquisition.propertyType}
            unitMix={acquisition.unitMix}
            onUnitMixChange={(mix) => updateAcquisition('unitMix', mix)}
          />
        );
      case 4:
        return (
          <StepRefinance
            data={refinance}
            projectionYears={acquisition.projectionYears}
            onChange={updateRefinance}
          />
        );
      case 5:
        return (
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Results are shown below. Go back to any step to update your assumptions.
            </p>
            <Button variant="secondary" size="sm" onClick={() => goToStep(0)}>
              ← Edit Inputs
            </Button>
          </div>
        );
    }
  };

  const isLastFormStep = currentStep === RESULTS_STEP - 1;

  return (
    <div className="min-h-screen pb-24">
      <div className="max-w-2xl mx-auto px-4 py-6 space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary-100 dark:bg-primary-900/30">
              <Calculator className="text-primary-600 dark:text-primary-400" size={20} />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900 dark:text-white">Cash on Cash</h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Real estate investment analyzer
              </p>
            </div>
          </div>
          <Button variant="secondary" size="sm" onClick={handleNewAnalysis}>
            <RefreshCw size={14} className="mr-1.5" />
            New
          </Button>
        </div>

        {/* Scenario chips */}
        <div className="flex gap-2">
          {(['base', 'bull', 'bear'] as CoCScenarioType[]).map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => setActiveType(type)}
              className={`flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-medium border transition-all ${
                activeType === type ? CHIP_ACTIVE[type] : CHIP_INACTIVE[type]
              }`}
            >
              {CHIP_LABELS[type]}
              {scenarioResults[type] && activeType !== type && (
                <span className="w-1.5 h-1.5 rounded-full bg-current opacity-60" />
              )}
            </button>
          ))}
        </div>

        {/* Wizard card */}
        <Card>
          <StepBar
            steps={[...STEPS]}
            currentStep={currentStep}
            completedSteps={visitedSteps}
            onStepClick={goToStep}
          />

          {/* Validation errors */}
          {errors.length > 0 && (
            <div className="mt-4 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-3">
              <ul className="list-disc list-inside space-y-0.5">
                {errors.map((e, i) => (
                  <li key={i} className="text-sm text-red-700 dark:text-red-300">
                    {e}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Step content */}
          <div className="mt-6">{renderStepContent()}</div>

          {/* Navigation footer */}
          {currentStep < RESULTS_STEP && (
            <div className="flex justify-between items-center mt-6 pt-4 border-t border-slate-100 dark:border-slate-700">
              {currentStep > 0 ? (
                <Button variant="secondary" size="sm" onClick={() => goToStep(currentStep - 1)}>
                  ← Back
                </Button>
              ) : (
                <div />
              )}

              {isLastFormStep ? (
                <Button variant="primary" onClick={handleCalculate}>
                  Calculate →
                </Button>
              ) : (
                <Button variant="primary" size="sm" onClick={handleNext}>
                  Next: {STEPS[currentStep + 1].label} →
                </Button>
              )}
            </div>
          )}
        </Card>

        {/* Results — animate in below the wizard */}
        {currentResult && (
          <div ref={resultsRef} className="animate-fade-in">
            <ResultsPanel result={currentResult} />
          </div>
        )}
      </div>
    </div>
  );
}
