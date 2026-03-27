'use client';

import { useState, useRef, useEffect } from 'react';
import { ArrowLeft, BookmarkPlus, BookmarkCheck, Check, Pencil, Calculator } from 'lucide-react';
import { Card } from '@/components/UI/Card';
import { Button } from '@/components/UI/Button';
import { StepProperty } from './steps/StepProperty';
import { StepFinancing } from './steps/StepFinancing';
import { StepRenovation } from './steps/StepRenovation';
import { StepExit } from './steps/StepExit';
import { ResultsPanel } from './ResultsPanel';
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
import type { MCRanges, SavedMCResults } from '@/utils/monteCarlo';

// ── Step definitions ───────────────────────────────────────────────────────────

const FORM_STEPS = [
  { id: 0, label: 'Property' },
  { id: 1, label: 'Financing' },
  { id: 2, label: 'Renovation' },
  { id: 3, label: 'Operations' },
  { id: 4, label: 'Exit & Refi' },
] as const;

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
  refiCostPct: 2,
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

// ── Validation ─────────────────────────────────────────────────────────────────

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

// ── Step summaries ─────────────────────────────────────────────────────────────

function summarizeProperty(a: CoCAcquisition): string {
  const type = a.propertyType === 'mfr' ? 'MFR' : 'SFR';
  const addr = a.propertyAddress.trim() || 'No address';
  const unitCount = a.unitMix.length > 0
    ? a.unitMix.reduce((s, e) => s + e.count, 0)
    : a.propertyType === 'sfr' ? 1 : 0;
  const units = unitCount > 0 ? `${unitCount} unit${unitCount !== 1 ? 's' : ''}` : '';
  return [type, addr, units].filter(Boolean).join(' · ');
}

function summarizeFinancing(a: CoCAcquisition): string {
  const price = a.purchasePrice > 0 ? `$${(a.purchasePrice / 1000).toFixed(0)}k` : '—';
  const down = a.downPaymentPct > 0 ? `${a.downPaymentPct}% down` : '';
  const rate = a.interestRate > 0 ? `${a.interestRate}%` : '';
  const term = a.loanTermYears > 0 ? `${a.loanTermYears}yr` : '';
  return [price, down, rate, term].filter(Boolean).join(' · ');
}

function summarizeRenovation(a: CoCAcquisition): string {
  const hard = (a.hardCostItems ?? []).reduce((s, e) => s + e.amount, 0);
  const soft = (a.softCostItems ?? []).reduce((s, e) => s + e.amount, 0);
  if (hard === 0 && soft === 0) return 'No renovation costs';
  const parts: string[] = [];
  if (hard > 0) parts.push(`$${Math.round(hard / 1000)}k hard`);
  if (soft > 0) parts.push(`$${Math.round(soft / 1000)}k soft`);
  if (a.renovationMonths > 0) parts.push(`${a.renovationMonths}mo`);
  return parts.join(' · ');
}

function summarizeOperations(pf: ProFormaData, years: number): string {
  if (pf.grossRent.stabilized === 0) return 'Not configured';
  return `$${Math.round(pf.grossRent.stabilized / 1000)}k gross rent · ${years}yr projection`;
}

function summarizeExit(a: CoCAcquisition, r: CoCRefinance): string {
  const parts: string[] = [];
  if (a.arv > 0) parts.push(`$${(a.arv / 1000).toFixed(0)}k exit`);
  if (a.exitCapRate > 0) parts.push(`${a.exitCapRate}% cap`);
  if ((a.exitClosingCostPct ?? 3) > 0) parts.push(`${a.exitClosingCostPct ?? 3}% costs`);
  if (r.enabled) parts.push(`Yr${r.refiYear} refi`);
  return parts.length > 0 ? parts.join(' · ') : 'No exit assumptions';
}

// ── Default save name ──────────────────────────────────────────────────────────

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
  const { addScenario, saveDraft, saveDeal, updateSavedDeal, updateMCData, draft } = useDealAnalyzerStore();

  const formSource = initialDeal ?? draft;

  // Stepper state
  const [activeStep, setActiveStep] = useState<number>(
    initialDeal ? 4 : Math.min(draft?.currentStep ?? 0, 4)
  );
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(
    new Set(initialDeal ? [0, 1, 2, 3, 4] : (draft?.visitedSteps ?? []))
  );
  const [editingStep, setEditingStep] = useState<number | null>(null);
  const [pausedActiveStep, setPausedActiveStep] = useState<number | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [errorStep, setErrorStep] = useState<number | null>(null);
  const [calcOpen, setCalcOpen] = useState(false);

  // Form data
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

  // MC ranges state — persisted with deal
  const [mcRanges, setMcRanges] = useState<MCRanges | null>(
    initialDeal?.mcRanges ? (initialDeal.mcRanges as unknown as MCRanges) : null
  );
  const [mcResults, setMcResults] = useState<SavedMCResults | null>(
    initialDeal?.mcResults ? (initialDeal.mcResults as SavedMCResults) : null
  );


  // Save state
  const [savedDealId, setSavedDealId] = useState<string | null>(initialDeal?.id ?? null);
  const [saveName, setSaveName] = useState(initialDeal?.name ?? '');
  const [showSaveBar, setShowSaveBar] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [savedAsDraft, setSavedAsDraft] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showExitWarning, setShowExitWarning] = useState(false);

  // Auto-save MC data immediately after a simulation run, if the deal is already saved
  useEffect(() => {
    if (!savedDealId || !mcResults) return;
    updateMCData(
      savedDealId,
      mcRanges as unknown as SavedDeal['mcRanges'] ?? undefined,
      mcResults,
    );
  }, [mcResults]); // eslint-disable-line react-hooks/exhaustive-deps

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
  const draftRef = useRef<DealAnalyzerDraft | null>(null);

  useEffect(() => {
    draftRef.current = {
      acquisition, operations, proForma, refinance,
      currentStep: activeStep,
      visitedSteps: Array.from(completedSteps),
      activeType,
    };
  });

  useEffect(() => {
    return () => { if (draftRef.current) saveDraft(draftRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Recompute results when opening a saved deal
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

  // Sync grossRentMonthly and proForma rent with unit mix / SFR rent fields
  useEffect(() => {
    const applyRentOverrides = (
      prev: ProFormaData,
      preStabAnnual: number,
      targetAnnual: number
    ): ProFormaData['yearOverrides'] => {
      const ovs = { ...(prev.yearOverrides ?? {}) };
      if (preStabAnnual > 0) {
        ovs[1] = { ...ovs[1], grossRent: preStabAnnual, grossRentSystem: true };
      } else {
        if (ovs[1]) {
          const { grossRent: _r, grossRentSystem: _s, ...rest } = ovs[1];
          ovs[1] = Object.keys(rest).length ? rest : undefined as never;
          if (!ovs[1]) delete ovs[1];
        }
      }
      if (targetAnnual > 0) {
        ovs[2] = { ...ovs[2], grossRent: targetAnnual, grossRentSystem: true };
      } else {
        if (ovs[2]) {
          const { grossRent: _r, grossRentSystem: _s, ...rest } = ovs[2];
          ovs[2] = Object.keys(rest).length ? rest : undefined as never;
          if (!ovs[2]) delete ovs[2];
        }
      }
      return ovs;
    };

    if (acquisition.propertyType === 'mfr' && acquisition.unitMix.length > 0) {
      const totalTarget  = acquisition.unitMix.reduce((sum, e) => sum + e.count * (e.rentMonthly  || 0), 0);
      const totalInPlace = acquisition.unitMix.reduce((sum, e) => sum + e.count * (e.inPlaceRent  || 0), 0);
      const totalPreStab = acquisition.unitMix.reduce((sum, e) => sum + e.count * (e.preStabRent  || 0), 0);
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

  // Reset proForma presets when property type changes
  const prevPropertyType = useRef(acquisition.propertyType);
  useEffect(() => {
    if (acquisition.propertyType === prevPropertyType.current) return;
    prevPropertyType.current = acquisition.propertyType;
    setProForma(defaultProForma(acquisition.propertyType));
  }, [acquisition.propertyType]);

  // Persist draft on every change
  useEffect(() => {
    saveDraft({
      acquisition, operations, proForma, refinance,
      currentStep: activeStep,
      visitedSteps: Array.from(completedSteps),
      activeType,
    });
  }, [acquisition, operations, proForma, refinance, activeStep, completedSteps, activeType, saveDraft]);

  // Auto-fill save name when address changes
  useEffect(() => {
    if (!saveName) setSaveName(defaultSaveName(acquisition));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [acquisition.propertyAddress]);

  // Auto-recalculate when inputs change (debounced)
  useEffect(() => {
    if (Object.keys(scenarioResults).length === 0) return;
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
    if (acquisition.purchasePrice <= 0) {
      setErrors(['Purchase price must be greater than 0']);
      setErrorStep(1);
      return;
    }
    setErrors([]);
    setErrorStep(null);

    const scenario: CoCScenario = {
      id: Date.now().toString(36),
      name: CHIP_LABELS[activeType],
      scenarioType: activeType,
      acquisition, operations, proForma, refinance,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const newResult = projectScenario(scenario);
    addScenario(scenario);

    const updatedResults = { ...scenarioResults, [activeType]: newResult };
    setScenarioResults(updatedResults);
    setCompletedSteps(prev => new Set(Array.from(prev).concat(3)));

    if (savedDealId) {
      const name = saveName || defaultSaveName(acquisition);
      updateSavedDeal(savedDealId, name, updatedResults, {
        acquisition, operations, proForma, refinance,
        currentStep: activeStep,
        visitedSteps: Array.from(new Set(Array.from(completedSteps).concat(3))),
        activeType,
      }, mcRanges as unknown as SavedDeal['mcRanges'] ?? undefined, mcResults ?? undefined);
    }

    setTimeout(() => {
      resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 150);
  };

  // ── Step continue ──

  const handleContinue = (stepId: number) => {
    const errs = validateStep(stepId, acquisition);
    if (errs.length > 0) {
      setErrors(errs);
      setErrorStep(stepId);
      return;
    }
    setErrors([]);
    setErrorStep(null);

    setCompletedSteps(prev => new Set(Array.from(prev).concat(stepId)));

    if (editingStep !== null) {
      setEditingStep(null);
      setPausedActiveStep(null);
    } else {
      setActiveStep(stepId + 1);
    }
  };

  // ── Save ──

  const handleSave = () => {
    if (!acquisition.propertyAddress.trim()) {
      setSaveError('Please enter a property address before saving.');
      setTimeout(() => setSaveError(null), 4000);
      return;
    }
    setSaveError(null);
    const name = saveName.trim() || defaultSaveName(acquisition);
    const currentDraft: DealAnalyzerDraft = {
      acquisition, operations, proForma, refinance,
      currentStep: activeStep,
      visitedSteps: Array.from(completedSteps),
      activeType,
    };

    if (savedDealId) {
      updateSavedDeal(savedDealId, name, scenarioResults, currentDraft, mcRanges as unknown as SavedDeal['mcRanges'] ?? undefined, mcResults ?? undefined);
    } else {
      const newId = saveDeal(name, currentDraft, scenarioResults, mcRanges as unknown as SavedDeal['mcRanges'] ?? undefined, mcResults ?? undefined);
      setSavedDealId(newId);
    }

    setSaveName(name);
    setShowSaveBar(false);
    savedSnapshot.current = JSON.stringify({ acquisition, operations, proForma, refinance });

    const isComplete = acquisition.purchasePrice > 0 && Object.keys(scenarioResults).length > 0;
    if (isComplete) {
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 3000);
    } else {
      setSavedAsDraft(true);
      setTimeout(() => setSavedAsDraft(false), 4000);
    }
  };

  const handleSaveAndExit = () => {
    if (!acquisition.propertyAddress.trim()) { onBack(); return; }
    handleSave();
    onBack();
  };

  // ── Step content ──

  const renderStepContent = (stepId: number) => {
    switch (stepId) {
      case 0:
        return <StepProperty data={acquisition} onChange={updateAcquisition} />;
      case 1:
        return <StepFinancing data={acquisition} onChange={updateAcquisition} />;
      case 2:
        return <StepRenovation data={acquisition} onChange={updateAcquisition} />;
      case 3: {
        const hasMfr = acquisition.propertyType === 'mfr' && acquisition.unitMix.length > 0;

        const PreStabHeader = ({ onOpen }: { onOpen: () => void }) => (
          <span className="flex items-center gap-1.5 justify-end">
            Pre-Stab
            <button
              type="button"
              onClick={onOpen}
              className="flex items-center text-amber-500 hover:text-amber-600 dark:text-amber-400 dark:hover:text-amber-300 transition-colors"
              title="Use calculator"
            >
              <Calculator size={11} />
            </button>
          </span>
        );

        const rentSchedule = hasMfr ? (
          <div className="space-y-2">
            <p className="label">Rent Schedule ($/mo per unit)</p>
            <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-700/50">
                    <th className="px-3 py-2 text-left text-xs font-medium text-slate-500 dark:text-slate-400">Unit Type</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-slate-500 dark:text-slate-400">In-Place</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-slate-500 dark:text-slate-400">Target</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-slate-500 dark:text-slate-400"><PreStabHeader onOpen={() => setCalcOpen(true)} /></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
                  {acquisition.unitMix.map((entry) => (
                    <tr key={entry.id}>
                      <td className="px-3 py-2 text-xs font-medium text-slate-600 dark:text-slate-400 whitespace-nowrap">
                        {entry.beds}BR/{entry.baths}BA × {entry.count}
                      </td>
                      {(['inPlaceRent', 'rentMonthly', 'preStabRent'] as const).map((field) => (
                        <td key={field} className="px-2 py-1.5">
                          <input
                            type="number"
                            className="input text-sm text-right w-full"
                            min={0}
                            placeholder="0"
                            value={(entry[field] || 0) === 0 ? '' : entry[field]}
                            onChange={(e) => updateAcquisition('unitMix', acquisition.unitMix.map((u) =>
                              u.id === entry.id ? { ...u, [field]: Number(e.target.value) } : u
                            ))}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
                {(() => {
                  const totalUnits = acquisition.unitMix.reduce((s, e) => s + e.count, 0);
                  if (totalUnits === 0) return null;
                  const avgInPlace  = acquisition.unitMix.reduce((s, e) => s + e.count * (e.inPlaceRent  || 0), 0) / totalUnits;
                  const avgTarget   = acquisition.unitMix.reduce((s, e) => s + e.count * (e.rentMonthly  || 0), 0) / totalUnits;
                  const avgPreStab  = acquisition.unitMix.reduce((s, e) => s + e.count * (e.preStabRent  || 0), 0) / totalUnits;
                  const fmt = (n: number) => n === 0 ? '—' : `$${Math.round(n).toLocaleString()}`;
                  return (
                    <tfoot>
                      <tr className="border-t-2 border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700/30">
                        <td className="px-3 py-2 text-xs font-semibold text-slate-500 dark:text-slate-400">Avg/unit</td>
                        <td className="px-3 py-2 text-right text-xs font-semibold tabular-nums text-slate-700 dark:text-slate-300">{fmt(avgInPlace)}</td>
                        <td className="px-3 py-2 text-right text-xs font-semibold tabular-nums text-slate-700 dark:text-slate-300">{fmt(avgTarget)}</td>
                        <td className="px-3 py-2 text-right text-xs font-semibold tabular-nums text-slate-700 dark:text-slate-300">{fmt(avgPreStab)}</td>
                      </tr>
                    </tfoot>
                  );
                })()}
              </table>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="label">Rent Schedule ($/mo)</p>
            <div className="grid grid-cols-3 gap-3">
              {([
                { field: 'sfrInPlaceRent', label: 'In-Place', isPreStab: false },
                { field: 'sfrTargetRent',  label: 'Target',   isPreStab: false },
                { field: 'sfrPreStabRent', label: 'Pre-Stab', isPreStab: true  },
              ] as const).map(({ field, label, isPreStab }) => (
                <div key={field}>
                  <label className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1 flex items-center gap-1">
                    {label}
                    {isPreStab && (
                      <button type="button" onClick={() => setCalcOpen(true)}
                        className="flex items-center text-amber-500 hover:text-amber-600 dark:text-amber-400 dark:hover:text-amber-300 transition-colors"
                        title="Use calculator">
                        <Calculator size={11} />
                      </button>
                    )}
                  </label>
                  <input
                    type="number"
                    className="input text-sm"
                    min={0}
                    placeholder="0"
                    value={(acquisition[field] || 0) === 0 ? '' : acquisition[field]}
                    onChange={(e) => updateAcquisition(field, Number(e.target.value))}
                  />
                </div>
              ))}
            </div>
          </div>
        );

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

        const calcAppliedYears: Record<number, number> = {};
        for (let y = 1; y <= acquisition.projectionYears; y++) {
          const ov = proForma.yearOverrides?.[y]?.grossRent;
          if (ov !== undefined) calcAppliedYears[y] = ov;
        }

        return (
          <>
            {rentSchedule}
            {calcOpen && (
              <RehabRentCalculator
                unitTypes={unitTypes}
                projectionYears={acquisition.projectionYears}
                appliedYears={calcAppliedYears}
                grossRentGrowthPct={proForma.grossRent.growthPct}
                onOpenChange={setCalcOpen}
                onApplyPreStab={(values) => {
                  if (hasMfr) {
                    updateAcquisition('unitMix', acquisition.unitMix.map((u, i) => ({
                      ...u,
                      preStabRent: Math.round(values[i] ?? 0),
                    })));
                  } else {
                    updateAcquisition('sfrPreStabRent', Math.round(values[0] ?? 0));
                  }
                }}
                onApply={(overrides) => {
                  setProForma(prev => {
                    const ovs = { ...(prev.yearOverrides ?? {}) };
                    Object.entries(overrides).forEach(([yr, rent]) => {
                      const y = Number(yr);
                      ovs[y] = { ...(ovs[y] ?? {}), grossRent: rent, grossRentSystem: true };
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
            )}
            <ProFormaGrid
              data={proForma}
              onChange={setProForma}
              projectionYears={acquisition.projectionYears}
            />
          </>
        );
      }
      case 4:
        return (
          <StepExit
            acquisition={acquisition}
            refinance={refinance}
            onAcquisitionChange={updateAcquisition}
            onRefinanceChange={updateRefinance}
          />
        );
    }
  };

  // ── Step summary ──

  const getStepSummary = (stepId: number): string => {
    switch (stepId) {
      case 0: return summarizeProperty(acquisition);
      case 1: return summarizeFinancing(acquisition);
      case 2: return summarizeRenovation(acquisition);
      case 3: return summarizeOperations(proForma, acquisition.projectionYears);
      case 4: return summarizeExit(acquisition, refinance);
      default: return '';
    }
  };

  // ── Derived ──

  const currentResult = scenarioResults[activeType] ?? null;
  const hasAnyResult = Object.keys(scenarioResults).length > 0;
  const hasAddress = acquisition.propertyAddress.trim().length > 0;
  const hasNewDealData = !savedDealId && (hasAddress || acquisition.purchasePrice > 0);

  // ── Render ──

  return (
    <div className="min-h-screen pb-24 overflow-x-hidden">
      <div className="max-w-2xl mx-auto px-4 py-6 space-y-5">

        {/* Back nav + title + save */}
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
              {saveName || (hasAddress ? acquisition.propertyAddress : 'New Analysis')}
            </h1>
          </div>

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
                  <button type="button" onClick={() => setShowSaveBar(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1">✕</button>
                </div>
              ) : (
                <Button variant="secondary" size="sm" onClick={() => { setSaveName(saveName || defaultSaveName(acquisition)); setShowSaveBar(true); }}>
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
                ? "Your changes won't be saved. Save as Draft to keep this analysis."
                : 'You have unsaved changes. Leave without saving?'}
            </p>
            <div className="flex gap-2">
              <button type="button" onClick={() => setShowExitWarning(false)} className="text-sm px-3 py-1.5 rounded-lg border border-amber-300 dark:border-amber-600 text-amber-800 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-800/30">Cancel</button>
              {hasAddress && (
                <button type="button" onClick={handleSaveAndExit} className="text-sm px-3 py-1.5 rounded-lg bg-primary-600 text-white hover:bg-primary-700">Save as Draft</button>
              )}
              <button type="button" onClick={onBack} className="text-sm px-3 py-1.5 rounded-lg bg-amber-600 text-white hover:bg-amber-700">Leave without saving</button>
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

        {/* ── Vertical stepper ── */}
        <div>
          {FORM_STEPS.map((step, index) => {
            const isCompleted = completedSteps.has(step.id);
            const isActive = activeStep === step.id && editingStep === null;
            const isEditing = editingStep === step.id;
            const isExpanded = isActive || isEditing;
            const isFuture = !isCompleted && !isExpanded;
            const isLast = index === FORM_STEPS.length - 1;
            const showErrors = errors.length > 0 && errorStep === step.id;

            return (
              <div key={step.id} className="flex gap-4">

                {/* Step indicator + connecting line */}
                <div className="flex flex-col items-center">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 border-2 transition-colors duration-200 ${
                    isCompleted && !isEditing
                      ? 'bg-primary-600 border-primary-600 text-white'
                      : isExpanded
                      ? 'bg-primary-600 border-primary-600 text-white'
                      : 'bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-600 text-slate-400 dark:text-slate-500'
                  }`}>
                    {isCompleted && !isEditing
                      ? <Check size={14} strokeWidth={2.5} />
                      : <span className="text-xs font-bold">{step.id + 1}</span>
                    }
                  </div>
                  {!isLast && (
                    <div className={`w-0.5 flex-1 min-h-[16px] mt-1 transition-colors duration-200 ${
                      isCompleted ? 'bg-primary-200 dark:bg-primary-800/60' : 'bg-slate-200 dark:bg-slate-700'
                    }`} />
                  )}
                </div>

                {/* Step content */}
                <div className={`flex-1 pb-6 min-w-0 transition-opacity duration-200 ${isFuture ? 'opacity-40' : 'opacity-100'}`}>

                  {/* Label */}
                  <p className={`text-sm font-semibold mt-0.5 mb-2 transition-colors duration-200 ${
                    isExpanded ? 'text-primary-700 dark:text-primary-300' : 'text-slate-700 dark:text-slate-300'
                  }`}>
                    {step.label}
                  </p>

                  {/* Completed summary bar */}
                  {isCompleted && !isEditing && (
                    <button
                      type="button"
                      onClick={() => { setPausedActiveStep(activeStep); setEditingStep(step.id); }}
                      className="w-full flex items-center gap-3 px-4 py-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl hover:border-primary-300 dark:hover:border-primary-700 hover:bg-primary-50/30 dark:hover:bg-primary-900/10 transition-colors text-left group"
                    >
                      <p className="flex-1 text-sm text-slate-700 dark:text-slate-300 truncate">
                        {getStepSummary(step.id)}
                      </p>
                      <Pencil size={13} className="text-slate-300 dark:text-slate-600 group-hover:text-primary-500 transition-colors shrink-0" />
                    </button>
                  )}

                  {/* Expanded form */}
                  {isExpanded && (
                    <Card>
                      <div className="space-y-4">
                        {showErrors && (
                          <div className="rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-3">
                            <ul className="list-disc list-inside space-y-0.5">
                              {errors.map((e, i) => (
                                <li key={i} className="text-sm text-red-700 dark:text-red-300">{e}</li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {renderStepContent(step.id)}

                        {/* Action buttons */}
                        <div className="flex justify-between items-center pt-4 border-t border-slate-100 dark:border-slate-700">
                          {isEditing ? (
                            <>
                              <Button variant="secondary" size="sm" onClick={() => { setEditingStep(null); setPausedActiveStep(null); setErrors([]); setErrorStep(null); }}>
                                Cancel
                              </Button>
                              <Button variant="primary" size="sm" onClick={() => handleContinue(step.id)}>
                                Done
                              </Button>
                            </>
                          ) : step.id === 4 ? (
                            <Button variant="primary" className="ml-auto" onClick={handleCalculate}>
                              Calculate →
                            </Button>
                          ) : (
                            <Button variant="primary" size="sm" className="ml-auto" onClick={() => handleContinue(step.id)}>
                              Continue →
                            </Button>
                          )}
                        </div>
                      </div>
                    </Card>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Results */}
        {currentResult && (
          <div ref={resultsRef} className="animate-fade-in pt-2">
            <ResultsPanel
              result={currentResult}
              acquisition={acquisition}
              operations={operations}
              proForma={proForma}
              refinance={refinance}
              mcRanges={mcRanges}
              onMcRangesChange={setMcRanges}
              mcResults={mcResults}
              onMcResultsChange={setMcResults}
            />
          </div>
        )}
      </div>
    </div>
  );
}
