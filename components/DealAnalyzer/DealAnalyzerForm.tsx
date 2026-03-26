'use client';

import { useState, useRef, useEffect } from 'react';
import { ArrowLeft, BookmarkPlus, BookmarkCheck } from 'lucide-react';
import { Card } from '@/components/UI/Card';
import { Button } from '@/components/UI/Button';
import { StepBar } from './StepBar';
import { StepProperty } from './steps/StepProperty';
import { StepFinancing } from './steps/StepFinancing';
import { StepRenovation } from './steps/StepRenovation';
import { ResultsPanel } from './ResultsPanel';
import { WhatIfPanel } from './WhatIfPanel';
import { ExitAndRefiPanel } from './ExitAndRefiPanel';
import { ProFormaGrid, defaultProForma } from './ProFormaGrid';
import { RehabRentCalculator } from './RehabRentCalculator';
import { projectScenario } from '@/utils/dealAnalyzerCalc';
import { useDealAnalyzerStore, type DealAnalyzerDraft } from '@/lib/dealAnalyzerStore';
import type {
  CoCAcquisition,
  CoCOperations,
  CoCRefinance,
  CoCResult,
  CoCScenario,
  CoCScenarioType,
  ProFormaData,
  SavedDeal,
} from '@/types';

// ── Step definitions ───────────────────────────────────────────────────────────

const STEPS = [
  { label: 'Property' },
  { label: 'Financing' },
  { label: 'Renovation', optional: true },
  { label: 'Operations' },
  { label: 'Results' },
] as const;

const RESULTS_STEP = STEPS.length - 1;

// ── Defaults ───────────────────────────────────────────────────────────────────

const DEFAULT_ACQUISITION: CoCAcquisition = {
  propertyAddress: '',
  propertyType: 'sfr',
  units: 1,
  sfrBeds: 0,
  sfrBaths: 0,
  sfrInPlaceRent: 0,
  sfrPreStabRent: 0,
  sfrTargetRent: 0,
  unitMix: [],
  purchasePrice: 0,
  arv: 0,
  downPaymentPct: 0,
  closingCostsPct: 0,
  points: 0,
  additionalFeeItems: [],
  hardCostItems: [],
  softCostItems: [],
  opportunityCostItems: [],
  renovationMonths: 0,
  interestRate: 0,
  loanTermYears: 0,
  ioPeriodMonths: 0,
  stabilizedMonth: 1,
  projectionYears: 5,
  exitCapRate: 0,
  exitClosingCostPct: 3,
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
  refiMarketValue: 0,
  newLTV: 0,
  newInterestRate: 0,
  newLoanTermYears: 0,
};

// ── Scenario chip styles ───────────────────────────────────────────────────────

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

// ── Step validation ────────────────────────────────────────────────────────────

function validateStep(step: number, acquisition: CoCAcquisition): string[] {
  if (step === 1) {
    const errs: string[] = [];
    if (acquisition.purchasePrice <= 0) errs.push('Purchase price must be greater than 0');
    if (acquisition.downPaymentPct < 0 || acquisition.downPaymentPct > 100)
      errs.push('Down payment must be between 0% and 100%');
    if (acquisition.projectionYears < 1 || acquisition.projectionYears > 30)
      errs.push('Projection horizon must be 1–30 years');
    return errs;
  }
  return [];
}

function defaultSaveName(acquisition: CoCAcquisition): string {
  if (acquisition.propertyAddress.trim()) return acquisition.propertyAddress.trim();
  return `Deal Analysis — ${new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
}

// ── Props ──────────────────────────────────────────────────────────────────────

interface DealAnalyzerFormProps {
  initialDeal?: SavedDeal;
  onBack: () => void;
}

// ── Component ──────────────────────────────────────────────────────────────────

export function DealAnalyzerForm({ initialDeal, onBack }: DealAnalyzerFormProps) {
  const { addScenario, saveDraft, saveDeal, updateSavedDeal, draft } = useDealAnalyzerStore();

  // formSource: which data to use for form fields (saved deal > draft > defaults)
  const formSource = initialDeal ?? draft;

  const [currentStep, setCurrentStep] = useState(
    initialDeal ? 0 : Math.min(draft?.currentStep ?? 0, RESULTS_STEP)
  );
  const [visitedSteps, setVisitedSteps] = useState<Set<number>>(
    new Set(initialDeal ? [0] : (draft?.visitedSteps ?? [0]))
  );
  const [errors, setErrors] = useState<string[]>([]);

  const [acquisition, setAcquisition] = useState<CoCAcquisition>(
    formSource?.acquisition ?? DEFAULT_ACQUISITION
  );
  const [operations, setOperations] = useState<CoCOperations>(
    formSource?.operations ?? DEFAULT_OPERATIONS
  );
  const [refinance, setRefinance] = useState<CoCRefinance>(
    formSource?.refinance ?? DEFAULT_REFINANCE
  );
  const [proForma, setProForma] = useState<ProFormaData>(
    formSource?.proForma ?? defaultProForma(DEFAULT_ACQUISITION.propertyType)
  );
  const [activeType, setActiveType] = useState<CoCScenarioType>(
    initialDeal ? 'base' : (draft?.activeType ?? 'base')
  );
  const [scenarioResults, setScenarioResults] = useState<Partial<Record<CoCScenarioType, CoCResult>>>(
    initialDeal?.results ?? {}
  );

  // Save state
  const [savedDealId, setSavedDealId] = useState<string | null>(initialDeal?.id ?? null);
  const [saveName, setSaveName] = useState(initialDeal?.name ?? '');
  const [showSaveBar, setShowSaveBar] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [savedAsDraft, setSavedAsDraft] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showExitWarning, setShowExitWarning] = useState(false);

  // Snapshot of saved deal inputs to detect unsaved changes
  const savedSnapshot = useRef(
    initialDeal
      ? JSON.stringify({ acquisition: initialDeal.acquisition, operations: initialDeal.operations, proForma: initialDeal.proForma, refinance: initialDeal.refinance })
      : null
  );
  const isDirty =
    !!savedDealId &&
    savedSnapshot.current !== null &&
    savedSnapshot.current !== JSON.stringify({ acquisition, operations, proForma, refinance });

  const resultsRef = useRef<HTMLDivElement>(null);
  const recalcTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep latest draft values in refs so unmount cleanup can save them synchronously
  const draftRef = useRef<DealAnalyzerDraft | null>(null);
  useEffect(() => {
    draftRef.current = { acquisition, operations, proForma, refinance, currentStep, visitedSteps: Array.from(visitedSteps), activeType };
  });
  useEffect(() => {
    return () => { if (draftRef.current) saveDraft(draftRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Recompute results on mount when opening a saved deal (so solver changes are reflected)
  useEffect(() => {
    if (!initialDeal) return;
    const scenario: CoCScenario = {
      id: Date.now().toString(36),
      name: CHIP_LABELS[activeType],
      scenarioType: activeType,
      acquisition, operations, proForma, refinance,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const freshResults: Partial<Record<CoCScenarioType, CoCResult>> = {};
    for (const type of Object.keys(initialDeal.results) as CoCScenarioType[]) {
      freshResults[type] = projectScenario({ ...scenario, scenarioType: type, name: CHIP_LABELS[type] });
    }
    setScenarioResults(freshResults);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep grossRentMonthly and proForma rent columns in sync with rent fields.
  // Clearing a rent field removes its override so ProForma reverts to manual entry.
  useEffect(() => {
    const applyRentOverrides = (
      prev: ProFormaData,
      preStabAnnual: number,
      targetAnnual: number
    ): ProFormaData['yearOverrides'] => {
      const ovs = { ...(prev.yearOverrides ?? {}) };

      // Year 1: set or clear pre-stab override
      if (preStabAnnual > 0) {
        ovs[1] = { ...ovs[1], grossRent: preStabAnnual };
      } else {
        if (ovs[1]) {
          const { grossRent: _removed, ...rest } = ovs[1];
          ovs[1] = Object.keys(rest).length ? rest : undefined as never;
          if (!ovs[1]) delete ovs[1];
        }
      }

      // Year 2: set or clear target override
      if (targetAnnual > 0) {
        ovs[2] = { ...ovs[2], grossRent: targetAnnual };
      } else {
        if (ovs[2]) {
          const { grossRent: _removed, ...rest } = ovs[2];
          ovs[2] = Object.keys(rest).length ? rest : undefined as never;
          if (!ovs[2]) delete ovs[2];
        }
      }

      return ovs;
    };

    if (acquisition.propertyType === 'mfr' && acquisition.unitMix.length > 0) {
      const totalTarget   = acquisition.unitMix.reduce((sum, e) => sum + e.count * (e.rentMonthly  || 0), 0);
      const totalInPlace  = acquisition.unitMix.reduce((sum, e) => sum + e.count * (e.inPlaceRent  || 0), 0);
      const totalPreStab  = acquisition.unitMix.reduce((sum, e) => sum + e.count * (e.preStabRent  || 0), 0);
      const allHaveTarget  = acquisition.unitMix.every((e) => (e.rentMonthly || 0) > 0);
      const allHaveInPlace = acquisition.unitMix.every((e) => (e.inPlaceRent || 0) > 0);

      setOperations((prev) => ({ ...prev, grossRentMonthly: totalTarget }));
      setProForma((prev) => ({
        ...prev,
        grossRent: {
          ...prev.grossRent,
          ...(allHaveTarget  ? { stabilized: totalTarget * 12 } : { stabilized: 0 }),
          ...(allHaveInPlace ? { t12: totalInPlace * 12 }       : { t12: 0 }),
        },
        yearOverrides: applyRentOverrides(prev, totalPreStab * 12, allHaveTarget ? totalTarget * 12 : 0),
      }));
    } else if (acquisition.propertyType === 'sfr') {
      const target  = acquisition.sfrTargetRent  || 0;
      const inPlace = acquisition.sfrInPlaceRent || 0;
      const preStab = acquisition.sfrPreStabRent || 0;

      if (target > 0) setOperations((prev) => ({ ...prev, grossRentMonthly: target }));
      setProForma((prev) => ({
        ...prev,
        grossRent: {
          ...prev.grossRent,
          stabilized: target  > 0 ? target  * 12 : prev.grossRent.stabilized,
          t12:        inPlace > 0 ? inPlace * 12 : prev.grossRent.t12,
        },
        yearOverrides: applyRentOverrides(prev, preStab * 12, target * 12),
      }));
    }
  }, [acquisition.unitMix, acquisition.propertyType, acquisition.sfrTargetRent, acquisition.sfrInPlaceRent, acquisition.sfrPreStabRent]);

  // Reset proForma presets only when the user explicitly changes property type (not on mount)
  const prevPropertyType = useRef(acquisition.propertyType);
  useEffect(() => {
    if (acquisition.propertyType === prevPropertyType.current) return;
    prevPropertyType.current = acquisition.propertyType;
    setProForma(defaultProForma(acquisition.propertyType));
  }, [acquisition.propertyType]);

  // Persist draft on every change
  useEffect(() => {
    const d: DealAnalyzerDraft = {
      acquisition,
      operations,
      proForma,
      refinance,
      currentStep,
      visitedSteps: Array.from(visitedSteps),
      activeType,
    };
    saveDraft(d);
  }, [acquisition, operations, proForma, refinance, currentStep, visitedSteps, activeType, saveDraft]);

  // Auto-fill save name when address changes
  useEffect(() => {
    if (!saveName || saveName === '') {
      setSaveName(defaultSaveName(acquisition));
    }
  }, [acquisition.propertyAddress]); // eslint-disable-line react-hooks/exhaustive-deps

  const currentResult = scenarioResults[activeType] ?? null;
  const hasAnyResult = Object.keys(scenarioResults).length > 0;
  const hasAddress = acquisition.propertyAddress.trim().length > 0;
  const canSave = hasAddress;
  // New unsaved deal has data if anything meaningful has been entered
  const hasNewDealData = !savedDealId && (hasAddress || acquisition.purchasePrice > 0);

  // Auto-recalculate whenever any input affecting IRR/CoC changes.
  // Debounced to avoid recalculating on every keystroke.
  useEffect(() => {
    if (!hasAnyResult) return;
    if (recalcTimer.current) clearTimeout(recalcTimer.current);
    recalcTimer.current = setTimeout(() => {
      const scenario: CoCScenario = {
        id: Date.now().toString(36),
        name: CHIP_LABELS[activeType],
        scenarioType: activeType,
        acquisition, operations, proForma, refinance,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      setScenarioResults(prev => ({ ...prev, [activeType]: projectScenario(scenario) }));
    }, 1000);
    return () => { if (recalcTimer.current) clearTimeout(recalcTimer.current); };
  }, [acquisition, operations, proForma, refinance]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Field updaters ──

  const updateAcquisition = (field: keyof CoCAcquisition, value: unknown) =>
    setAcquisition((prev) => ({ ...prev, [field]: value }));

  const updateOperations = (field: keyof CoCOperations, value: number) =>
    setOperations((prev) => ({ ...prev, [field]: value }));

  const updateRefinance = (field: keyof CoCRefinance, value: number | boolean) =>
    setRefinance((prev) => ({ ...prev, [field]: value }));

  // ── Calculate ──

  const handleCalculate = () => {
    const errs = [
      ...(acquisition.purchasePrice <= 0 ? ['Purchase price must be greater than 0'] : []),
    ];
    if (errs.length > 0) { setErrors(errs); return; }
    setErrors([]);

    const scenario: CoCScenario = {
      id: Date.now().toString(36),
      name: CHIP_LABELS[activeType],
      scenarioType: activeType,
      acquisition,
      operations,
      proForma,
      refinance,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const newResult = projectScenario(scenario);
    addScenario(scenario);

    const updatedResults = { ...scenarioResults, [activeType]: newResult };
    setScenarioResults(updatedResults);
    setVisitedSteps((prev) => { const s = new Set(prev); s.add(RESULTS_STEP); return s; });
    setCurrentStep(RESULTS_STEP);

    // If this deal is already saved, auto-update it (including all inputs)
    if (savedDealId) {
      const name = saveName || defaultSaveName(acquisition);
      updateSavedDeal(savedDealId, name, updatedResults, { acquisition, operations, proForma, refinance, currentStep, visitedSteps: Array.from(visitedSteps), activeType });
    }

    setTimeout(() => {
      resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 150);
  };

  // ── Navigation ──

  const goToStep = (step: number) => {
    if (step === RESULTS_STEP && !currentResult) return;
    // Auto-recalculate when navigating directly to Results so results stay fresh
    if (step === RESULTS_STEP && currentResult) {
      handleCalculate();
      return;
    }
    setCurrentStep(step);
    setVisitedSteps((prev) => { const s = new Set(prev); s.add(step); return s; });
    setErrors([]);
  };

  const handleSaveAndExit = () => {
    if (!hasAddress) {
      // Can't save without address — just leave
      onBack();
      return;
    }
    handleSave();
    onBack();
  };

  const handleNext = () => {
    const errs = validateStep(currentStep, acquisition);
    if (errs.length > 0) { setErrors(errs); return; }
    setErrors([]);
    goToStep(currentStep + 1);
  };

  const handleSave = () => {
    if (!hasAddress) {
      setSaveError('Please enter a property address before saving.');
      setTimeout(() => setSaveError(null), 4000);
      return;
    }
    setSaveError(null);
    const name = saveName.trim() || defaultSaveName(acquisition);
    const currentDraft: DealAnalyzerDraft = {
      acquisition, operations, proForma, refinance,
      currentStep, visitedSteps: Array.from(visitedSteps), activeType,
    };

    if (savedDealId) {
      updateSavedDeal(savedDealId, name, scenarioResults, currentDraft);
    } else {
      const newId = saveDeal(name, currentDraft, scenarioResults);
      setSavedDealId(newId);
    }

    setSaveName(name);
    setShowSaveBar(false);
    savedSnapshot.current = JSON.stringify({ acquisition, operations, proForma, refinance });

    const isComplete = acquisition.purchasePrice > 0 && hasAnyResult;
    if (isComplete) {
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 3000);
    } else {
      setSavedAsDraft(true);
      setTimeout(() => setSavedAsDraft(false), 4000);
    }
  };

  // ── Step content renderer ──

  const renderStepContent = () => {
    switch (currentStep) {
      case 0: return <StepProperty data={acquisition} onChange={updateAcquisition} />;
      case 1: return <StepFinancing data={acquisition} onChange={updateAcquisition} />;
      case 2: return <StepRenovation data={acquisition} onChange={updateAcquisition} />;
      case 3: {
        const hasMfr = acquisition.propertyType === 'mfr' && acquisition.unitMix.length > 0;
        const unitTypes = hasMfr
          ? acquisition.unitMix.map(e => ({
              label: `${e.beds}BR/${e.baths}BA × ${e.count}`,
              count: e.count,
              inPlaceRent: e.inPlaceRent || 0,
              targetRent: e.rentMonthly || 0,
            }))
          : [{
              label: 'SFR',
              count: 1,
              inPlaceRent: acquisition.sfrInPlaceRent || 0,
              targetRent: acquisition.sfrTargetRent || 0,
            }];

        // Track which year overrides were written by the calculator (so we can clear them)
        const calcAppliedYears: Record<number, number> = {};
        for (let y = 1; y <= acquisition.projectionYears; y++) {
          const ov = proForma.yearOverrides?.[y]?.grossRent;
          if (ov !== undefined) calcAppliedYears[y] = ov;
        }

        return (
          <>
            <RehabRentCalculator
              unitTypes={unitTypes}
              projectionYears={acquisition.projectionYears}
              appliedYears={calcAppliedYears}
              onApply={(overrides) => {
                setProForma(prev => {
                  const ovs = { ...(prev.yearOverrides ?? {}) };
                  Object.entries(overrides).forEach(([yr, rent]) => {
                    const y = Number(yr);
                    ovs[y] = { ...(ovs[y] ?? {}), grossRent: rent };
                  });
                  return { ...prev, yearOverrides: ovs };
                });
              }}
              onClear={() => {
                setProForma(prev => {
                  const ovs = { ...(prev.yearOverrides ?? {}) };
                  for (let y = 1; y <= acquisition.projectionYears; y++) {
                    if (ovs[y]) {
                      const { grossRent: _removed, ...rest } = ovs[y];
                      if (Object.keys(rest).length > 0) ovs[y] = rest; else delete ovs[y];
                    }
                  }
                  return { ...prev, yearOverrides: ovs };
                });
              }}
            />
            <ProFormaGrid data={proForma} onChange={setProForma} projectionYears={acquisition.projectionYears} />
          </>
        );
      }
      case 4:
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
    <div className="min-h-screen pb-24 overflow-x-hidden">
      <div className="max-w-2xl mx-auto px-4 py-6 space-y-5">

        {/* Back nav + title */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => (isDirty || hasNewDealData) ? setShowExitWarning(true) : onBack()}
              className="flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors"
            >
              <ArrowLeft size={16} />
              <span>Deals</span>
            </button>
            <span className="text-slate-300 dark:text-slate-600">/</span>
            <h1 className="text-sm font-medium text-slate-700 dark:text-slate-300 truncate max-w-[200px]">
              {saveName || (acquisition.propertyAddress.trim() ? acquisition.propertyAddress : 'New Analysis')}
            </h1>
          </div>

          {/* Save button */}
          {(hasAnyResult || hasAddress) && (
            <div className="flex items-center gap-2 shrink-0">
              {justSaved && (
                <span className="flex items-center gap-1 text-xs text-secondary-600 dark:text-secondary-400">
                  <BookmarkCheck size={14} /> Saved
                </span>
              )}
              {savedAsDraft && (
                <span className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                  <BookmarkCheck size={14} /> Saved as Draft
                </span>
              )}
              {saveError && (
                <span className="text-xs text-red-600 dark:text-red-400 max-w-[180px] text-right leading-tight">
                  {saveError}
                </span>
              )}
              {showSaveBar ? (
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={saveName}
                    onChange={(e) => setSaveName(e.target.value)}
                    placeholder="Name this analysis…"
                    className="text-sm border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-1.5 bg-white dark:bg-slate-800 text-slate-900 dark:text-white w-44 focus:outline-none focus:ring-2 focus:ring-primary-500"
                    autoFocus
                    onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') setShowSaveBar(false); }}
                  />
                  <Button variant="primary" size="sm" onClick={handleSave}>
                    {savedDealId ? 'Update' : 'Save'}
                  </Button>
                  <button
                    type="button"
                    onClick={() => setShowSaveBar(false)}
                    className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1"
                  >
                    ✕
                  </button>
                </div>
              ) : (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setSaveName(saveName || defaultSaveName(acquisition));
                    setShowSaveBar(true);
                  }}
                >
                  <BookmarkPlus size={14} className="mr-1.5" />
                  {savedDealId ? 'Update' : 'Save'}
                </Button>
              )}
            </div>
          )}
        </div>

        {/* Unsaved changes warning */}
        {showExitWarning && (
          <div className="rounded-lg border border-amber-200 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 p-4 space-y-3">
            <p className="text-sm text-amber-800 dark:text-amber-300">
              {hasNewDealData && !savedDealId
                ? 'Your changes won\'t be saved. Save as Draft to keep this analysis.'
                : 'You have unsaved changes. Leave without saving?'}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setShowExitWarning(false)}
                className="text-sm px-3 py-1.5 rounded-lg border border-amber-300 dark:border-amber-600 text-amber-800 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-800/30"
              >
                Cancel
              </button>
              {hasAddress && (
                <button
                  type="button"
                  onClick={handleSaveAndExit}
                  className="text-sm px-3 py-1.5 rounded-lg bg-primary-600 text-white hover:bg-primary-700"
                >
                  Save as Draft
                </button>
              )}
              <button
                type="button"
                onClick={onBack}
                className="text-sm px-3 py-1.5 rounded-lg bg-amber-600 text-white hover:bg-amber-700"
              >
                Leave without saving
              </button>
            </div>
          </div>
        )}

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

          {errors.length > 0 && (
            <div className="mt-4 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-3">
              <ul className="list-disc list-inside space-y-0.5">
                {errors.map((e, i) => (
                  <li key={i} className="text-sm text-red-700 dark:text-red-300">{e}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-6">{renderStepContent()}</div>

          {currentStep < RESULTS_STEP && (
            <div className="flex justify-between items-center mt-6 pt-4 border-t border-slate-100 dark:border-slate-700">
              {currentStep > 0 ? (
                <Button variant="secondary" size="sm" onClick={() => goToStep(currentStep - 1)}>
                  ← Back
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => (isDirty || hasNewDealData) ? setShowExitWarning(true) : onBack()}
                >
                  Cancel
                </Button>
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

        {/* Results */}
        {currentResult && (
          <div ref={resultsRef} className="animate-fade-in space-y-6">
            <ResultsPanel result={currentResult} />
            <ExitAndRefiPanel
              acquisition={acquisition}
              refinance={refinance}
              onAcquisitionChange={updateAcquisition}
              onRefinanceChange={updateRefinance}
            />
            <WhatIfPanel
              acquisition={acquisition}
              operations={operations}
              proForma={proForma}
              refinance={refinance}
              baseResult={currentResult}
            />
          </div>
        )}
      </div>
    </div>
  );
}
