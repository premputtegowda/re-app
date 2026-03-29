'use client';

import React, { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { Pencil, Calculator, AlertTriangle, MapPin, CreditCard, Hammer, BarChart2, TrendingUp } from 'lucide-react';
import { Card } from '@/components/UI/Card';
import { Button } from '@/components/UI/Button';
import { StepProperty } from './steps/StepProperty';
import { StepFinancing } from './steps/StepFinancing';
import { StepRenovation } from './steps/StepRenovation';
import { StepExit } from './steps/StepExit';
import { ResultsPanel } from './ResultsPanel';
import { ProFormaGrid, defaultProForma } from './ProFormaGrid';
import { RehabRentCalculator } from './RehabRentCalculator';
import { PropertyTaxEstimator } from './PropertyTaxEstimator';
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

const STEP_ICONS: Record<number, React.ReactNode> = {
  0: <MapPin size={20} />,
  1: <CreditCard size={20} />,
  2: <Hammer size={20} />,
  3: <BarChart2 size={20} />,
  4: <TrendingUp size={20} />,
};

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
  exitMethod: 'value',
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
  refiYear: 0,
  refiMarketValue: 0,
  newLTV: 0,
  newInterestRate: 0,
  newLoanTermYears: 0,
  refiCostPct: 2,
};

// ── Scenario names ─────────────────────────────────────────────────────────────

const CHIP_LABELS: Record<CoCScenarioType, string> = {
  base: 'Base Case',
  bull: 'Bull Case',
  bear: 'Bear Case',
};

// ── Validation ─────────────────────────────────────────────────────────────────

function validateStep(step: number, acquisition: CoCAcquisition): string[] {
  if (step === 0) {
    if (!acquisition.propertyAddress.trim()) return ['Property address is required'];
    return [];
  }
  return [];
}

// ── Step summaries ─────────────────────────────────────────────────────────────

function summarizeProperty(a: CoCAcquisition): string {
  const type = a.propertyType === 'mfr' ? 'MFR' : 'SFR';
  const addr = a.propertyAddress.trim() || 'No address';
  const unitCount = a.propertyType === 'mfr' && a.unitMix.length > 0
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
  const method = a.exitMethod ?? 'value';
  if (method === 'capRate' && a.exitCapRate > 0) parts.push(`${a.exitCapRate}% cap rate`);
  else if (a.arv > 0) parts.push(`$${(a.arv / 1000).toFixed(0)}k exit`);
  if ((a.exitClosingCostPct ?? 3) > 0) parts.push(`${a.exitClosingCostPct ?? 3}% costs`);
  if (r.enabled) parts.push(r.refiYear > 0 ? `Yr${r.refiYear} refi` : 'refi');
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
}

// ── Component ──────────────────────────────────────────────────────────────────

export function DealAnalyzerForm({ initialDeal }: DealAnalyzerFormProps) {
  const router = useRouter();
  const onBack = () => router.push('/deal-analyzer');
  const { addScenario, saveDeal, updateSavedDeal, updateMCData, updateCurrentStep } = useDealAnalyzerStore();

  // Stepper state
  const [activeStep, setActiveStep] = useState<number>(
    initialDeal?.currentStep ?? (initialDeal ? 4 : 0)
  );
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(
    new Set(initialDeal ? [0, 1, 2, 3, 4] : [])
  );
  const [editingStep, setEditingStep] = useState<number | null>(null);
  const [pausedActiveStep, setPausedActiveStep] = useState<number | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [errorStep, setErrorStep] = useState<number | null>(null);
  const [calcOpen, setCalcOpen] = useState(false);

  // Form data
  const [acquisition, setAcquisition] = useState<CoCAcquisition>(
    initialDeal?.acquisition ?? DEFAULT_ACQUISITION
  );
  const [operations, setOperations] = useState<CoCOperations>(
    initialDeal?.operations ?? DEFAULT_OPERATIONS
  );
  const [refinance, setRefinance] = useState<CoCRefinance>(
    initialDeal?.refinance ?? DEFAULT_REFINANCE
  );
  const [proForma, setProForma] = useState<ProFormaData>(() => {
    let pf = initialDeal?.proForma ?? defaultProForma(DEFAULT_ACQUISITION.propertyType);
    if (initialDeal?.operations.annualRentGrowthPct) {
      pf = { ...pf, grossRent: { ...pf.grossRent, growthPct: initialDeal.operations.annualRentGrowthPct } };
    }
    // Clear stale year-2 rent pin when preStab >= target (no actual gap to bridge)
    if (pf.yearOverrides?.[2]?.grossRentSystem) {
      const targetAnnual = initialDeal
        ? (initialDeal.acquisition.propertyType === 'mfr'
            ? initialDeal.acquisition.unitMix.reduce((s, e) => s + e.count * (e.rentMonthly || 0), 0) * 12
            : (initialDeal.acquisition.sfrTargetRent || 0) * 12)
        : 0;
      const preStabAnnual = initialDeal
        ? (initialDeal.acquisition.propertyType === 'mfr'
            ? initialDeal.acquisition.unitMix.reduce((s, e) => s + e.count * (e.preStabRent || 0), 0) * 12
            : (initialDeal.acquisition.sfrPreStabRent || 0) * 12)
        : 0;
      if (!(preStabAnnual > 0 && preStabAnnual < targetAnnual)) {
        const { grossRent: _r, grossRentSystem: _s, ...rest } = pf.yearOverrides[2];
        const ovs = { ...pf.yearOverrides };
        if (Object.keys(rest).length) { ovs[2] = rest; } else { delete ovs[2]; }
        pf = { ...pf, yearOverrides: ovs };
      }
    }
    return pf;
  });
  const activeType: CoCScenarioType = 'base';
  const [scenarioResults, setScenarioResults] = useState<Partial<Record<CoCScenarioType, CoCResult>>>(
    initialDeal?.results ?? {}
  );

  // Inline address editing

  // MC ranges state — persisted with deal
  const [mcRanges, setMcRanges] = useState<MCRanges | null>(
    initialDeal?.mcRanges ? (initialDeal.mcRanges as unknown as MCRanges) : null
  );
  const [mcResults, setMcResults] = useState<SavedMCResults | null>(
    initialDeal?.mcResults ? (initialDeal.mcResults as SavedMCResults) : null
  );


  // Property tax state — value is $/mo for the Property Taxes ProForma expense
  const [propertyTaxValue, setPropertyTaxValue] = useState(0);
  const [propertyTaxIsManual, setPropertyTaxIsManual] = useState(false);

  // Save state
  const [savedDealId, setSavedDealId] = useState<string | null>(initialDeal?.id ?? null);
  const [saveName, setSaveName] = useState(initialDeal?.name ?? '');
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
      // Only pin year 2 to target when there's a pre-stab period in year 1;
      // otherwise let year 2 grow naturally from stabilized via growth rate.
      if (targetAnnual > 0 && preStabAnnual > 0 && preStabAnnual < targetAnnual) {
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

  // Auto-set exit method based on property type + unit count:
  //   MFR > 4 units  → 'capRate'
  //   SFR or MFR ≤ 4 → 'value'
  // Unit count comes from unitMix (sum of entry.count), not acquisition.units
  const totalMFRUnits = acquisition.unitMix.reduce((sum, e) => sum + e.count, 0);
  const prevWasLargeMFR = useRef(acquisition.propertyType === 'mfr' && totalMFRUnits > 4);
  useEffect(() => {
    const isLargeMFR = acquisition.propertyType === 'mfr' && totalMFRUnits > 4;
    if (isLargeMFR && !prevWasLargeMFR.current) {
      updateAcquisition('exitMethod', 'capRate');
    } else if (!isLargeMFR && prevWasLargeMFR.current) {
      updateAcquisition('exitMethod', 'value');
    }
    prevWasLargeMFR.current = isLargeMFR;
  }, [acquisition.propertyType, totalMFRUnits]);

  // Reset proForma presets when property type changes
  const prevPropertyType = useRef(acquisition.propertyType);
  useEffect(() => {
    if (acquisition.propertyType === prevPropertyType.current) return;
    prevPropertyType.current = acquisition.propertyType;
    setProForma(defaultProForma(acquisition.propertyType));
  }, [acquisition.propertyType]);

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

  const updateOperations = (field: keyof CoCOperations, value: number) => {
    setOperations((prev) => ({ ...prev, [field]: value }));
    if (field === 'annualRentGrowthPct') {
      setProForma((prev) => ({ ...prev, grossRent: { ...prev.grossRent, growthPct: value } }));
    }
  };

  const updateRefinance = (field: keyof CoCRefinance, value: number | boolean) =>
    setRefinance((prev) => ({ ...prev, [field]: value }));

  // ── Calculate ──

  const handleCalculate = () => {
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

    if (savedDealId) {
      const name = saveName || defaultSaveName(acquisition);
      updateSavedDeal(savedDealId, name, updatedResults, {
        acquisition, operations, proForma, refinance,
        currentStep: activeStep,
        visitedSteps: Array.from(completedSteps),
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
      const next = stepId + 1;
      setActiveStep(next);
      if (savedDealId) updateCurrentStep(savedDealId, next);
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
    savedSnapshot.current = JSON.stringify({ acquisition, operations, proForma, refinance });
    onBack();
  };

  const handleSaveAndExit = () => {
    if (!acquisition.propertyAddress.trim()) { onBack(); return; }
    handleSave();
    onBack();
  };

  // ── Financing missing fields (for inline warning icons) ──

  const getFinancingMissingFields = (): Set<string> => {
    const isCash = acquisition.downPaymentPct >= 100;
    const missing = new Set<string>();
    if (acquisition.purchasePrice <= 0) missing.add('purchasePrice');
    if (acquisition.downPaymentPct <= 0) missing.add('downPaymentPct');
    if (!isCash) {
      if (acquisition.closingCostsPct <= 0) missing.add('closingCostsPct');
      if (acquisition.interestRate <= 0) missing.add('interestRate');
      if (acquisition.loanTermYears <= 0) missing.add('loanTermYears');
    }
    return missing;
  };

  // ── Step content ──

  const renderStepContent = (stepId: number, isVisited: boolean) => {
    switch (stepId) {
      case 0:
        return <StepProperty data={acquisition} onChange={updateAcquisition} showWarnings={isVisited} />;
      case 1:
        return (
          <StepFinancing
            data={acquisition}
            onChange={updateAcquisition}
            missingFields={isVisited ? getFinancingMissingFields() : undefined}
          />
        );
      case 2:
        return <StepRenovation data={acquisition} onChange={updateAcquisition} showWarnings={isVisited} />;
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
                    <th className="px-3 py-2 text-right text-xs font-medium text-slate-500 dark:text-slate-400">
                      <span className="flex items-center justify-end gap-1">
                        Target
                        {isVisited && acquisition.unitMix.some(e => !(e.rentMonthly || 0)) && (
                          <AlertTriangle size={12} className="text-amber-500 shrink-0" data-testid="mfr-target-rent-warning" />
                        )}
                      </span>
                    </th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-slate-500 dark:text-slate-400"><PreStabHeader onOpen={() => setCalcOpen(true)} /></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
                  {acquisition.unitMix.map((entry) => (
                    <tr key={entry.id}>
                      <td className="px-3 py-2 text-xs font-medium text-slate-600 dark:text-slate-400 whitespace-nowrap">
                        {entry.beds}BR/{entry.baths}BA × {entry.count}
                      </td>
                      {(['inPlaceRent', 'rentMonthly', 'preStabRent'] as const).map((field) => {
                        const warnCell = field === 'rentMonthly' && isVisited && !(entry[field] || 0);
                        return (
                          <td key={field} className="px-2 py-1.5">
                            <input
                              type="number"
                              className={`input text-sm text-right w-full ${warnCell ? 'border-amber-300 focus:ring-amber-400' : ''}`}
                              min={0}
                              placeholder="0"
                              value={(entry[field] || 0) === 0 ? '' : entry[field]}
                              onChange={(e) => updateAcquisition('unitMix', acquisition.unitMix.map((u) =>
                                u.id === entry.id ? { ...u, [field]: Number(e.target.value) } : u
                              ))}
                            />
                          </td>
                        );
                      })}
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
              ] as const).map(({ field, label, isPreStab }) => {
                const warnTarget = field === 'sfrTargetRent' && isVisited && !acquisition.sfrTargetRent;
                return (
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
                    {warnTarget && <AlertTriangle size={12} className="text-amber-500 shrink-0" data-testid="sfr-target-rent-warning" />}
                  </label>
                  <input
                    type="number"
                    className={`input text-sm ${warnTarget ? 'border-amber-300 focus:ring-amber-400' : ''}`}
                    min={0}
                    placeholder="0"
                    value={(acquisition[field] || 0) === 0 ? '' : acquisition[field]}
                    onChange={(e) => updateAcquisition(field, Number(e.target.value))}
                  />
                </div>
                );
              })}
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
            <PropertyTaxEstimator
              address={acquisition.propertyAddress}
              purchasePrice={acquisition.purchasePrice}
              value={propertyTaxValue}
              onChange={(monthly) => {
                setPropertyTaxValue(monthly);
                // Sync into the ProForma "Property Taxes" expense
                setProForma((prev) => ({
                  ...prev,
                  expenses: prev.expenses.map((exp) =>
                    exp.name === 'Property Taxes'
                      ? { ...exp, stabValue: monthly, t12Value: monthly }
                      : exp
                  ),
                }));
              }}
              isManual={propertyTaxIsManual}
              onManualChange={setPropertyTaxIsManual}
            />
            <ProFormaGrid
              data={proForma}
              onChange={setProForma}
              projectionYears={acquisition.projectionYears}
              showWarnings={isVisited}
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
            showWarnings={isVisited}
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

  // ── Step warnings (soft — non-blocking) ──

  const getStepWarning = (stepId: number): string | null => {
    switch (stepId) {
      case 0:
        if (acquisition.propertyType === 'sfr' && (!acquisition.sfrBeds || !acquisition.sfrBaths))
          return 'incomplete';
        if (acquisition.propertyType === 'mfr' && acquisition.unitMix.length === 0)
          return 'incomplete';
        return null;
      case 1: {
        const isCash = acquisition.downPaymentPct >= 100;
        const hasMissing =
          acquisition.purchasePrice <= 0 ||
          acquisition.downPaymentPct <= 0 ||
          (!isCash && (
            acquisition.closingCostsPct <= 0 ||
            acquisition.interestRate <= 0 ||
            acquisition.loanTermYears <= 0
          ));
        return hasMissing ? 'incomplete' : null;
      }
      case 2: {
        const hasIncomplete = (items: typeof acquisition.hardCostItems) =>
          items.some(item => item.description.trim() !== '' && item.amount === 0);
        if (hasIncomplete(acquisition.hardCostItems) || hasIncomplete(acquisition.softCostItems))
          return 'incomplete';
        return null;
      }
      case 3:
        if (proForma.grossRent.stabilized === 0)
          return 'incomplete';
        return null;
      case 4: {
        const method = acquisition.exitMethod ?? 'value';
        if (method === 'capRate' && acquisition.exitCapRate === 0) return 'incomplete';
        if (method === 'value' && acquisition.arv === 0) return 'incomplete';
        if (refinance.enabled && (
          !refinance.refiMarketValue ||
          !refinance.refiYear ||
          !refinance.newLTV ||
          !refinance.newInterestRate ||
          !refinance.newLoanTermYears
        )) return 'incomplete';
        return null;
      }
      default:
        return null;
    }
  };

  // ── Derived ──

  const currentResult = scenarioResults[activeType] ?? null;
  const hasAnyResult = Object.keys(scenarioResults).length > 0;
  const hasAddress = acquisition.propertyAddress.trim().length > 0;
  const hasNewDealData = !savedDealId && (hasAddress || acquisition.purchasePrice > 0);
  const allStepsCompleted = [0, 1, 2, 3, 4].every(id => completedSteps.has(id));
  const hasAnyWarning = [0, 1, 2, 3, 4].some(id => getStepWarning(id) !== null);

  // ── Render ──

  return (
    <div className="min-h-screen pb-24 overflow-x-hidden">
      <div className="max-w-2xl mx-auto px-4 py-6 space-y-5">

        {/* Header: title + always-visible Cancel / Next / Save */}
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-lg font-semibold text-slate-900 dark:text-white truncate">
            {acquisition.propertyAddress.trim() || 'New Analysis'}
          </h1>

          <div className="flex items-center gap-2 shrink-0">
            {saveError && (
              <span className="text-xs text-red-600 dark:text-red-400 max-w-[160px] text-right leading-tight">
                {saveError}
              </span>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => (isDirty || hasNewDealData) ? setShowExitWarning(true) : onBack()}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={!hasAddress || (savedDealId ? !isDirty : false)}
              onClick={() => { setSaveName(saveName || defaultSaveName(acquisition)); handleSave(); }}
              data-testid="header-save-btn"
            >
              {savedDealId ? 'Update' : 'Save'}
            </Button>
          </div>
        </div>


        {/* Unsaved changes warning */}
        {showExitWarning && (
          <div className="rounded-lg border border-amber-200 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 p-4 space-y-3">
            <p className="text-sm text-amber-800 dark:text-amber-300">
              {savedDealId ? 'You have unsaved changes.' : "Your changes won't be saved. Save as Draft to keep this analysis."}
            </p>
            <div className="flex gap-2">
              <button type="button" onClick={() => setShowExitWarning(false)} className="text-sm px-3 py-1.5 rounded-lg border border-amber-300 dark:border-amber-600 text-amber-800 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-800/30">Cancel</button>
              {savedDealId ? (
                <button type="button" onClick={handleSaveAndExit} className="text-sm px-3 py-1.5 rounded-lg bg-primary-600 text-white hover:bg-primary-700">Save</button>
              ) : hasAddress && (
                <button type="button" onClick={handleSaveAndExit} className="text-sm px-3 py-1.5 rounded-lg bg-primary-600 text-white hover:bg-primary-700">Save as Draft</button>
              )}
              <button type="button" onClick={onBack} className="text-sm px-3 py-1.5 rounded-lg bg-amber-600 text-white hover:bg-amber-700">Leave without saving</button>
            </div>
          </div>
        )}

        {/* ── Horizontal progress bar ── */}
        <div className="flex items-center gap-2">
          {FORM_STEPS.map((step) => (
            <motion.div
              key={step.id}
              initial={{ scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ delay: step.id * 0.08 }}
              className={`h-1.5 flex-1 rounded-full transition-colors duration-300 ${
                step.id <= activeStep ? 'bg-primary-600' : 'bg-slate-200 dark:bg-slate-700'
              }`}
            />
          ))}
        </div>

        {/* ── Step cards ── */}
        <div className="space-y-3">
          {FORM_STEPS.map((step) => {
            const isCompleted = completedSteps.has(step.id);
            const isActive = activeStep === step.id && editingStep === null;
            const isEditing = editingStep === step.id;
            const isExpanded = isActive || isEditing;
            const isVisible = isCompleted || isExpanded;
            const showErrors = errors.length > 0 && errorStep === step.id;

            return (
              <AnimatePresence key={step.id}>
                {isVisible && (
                  <motion.div
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.25, ease: 'easeOut' }}
                  >
                    {/* Completed summary bar */}
                    {isCompleted && !isEditing && (() => {
                      const warning = getStepWarning(step.id);
                      return (
                        <button
                          type="button"
                          data-testid={`step-summary-${step.id}`}
                          onClick={() => { setPausedActiveStep(activeStep); setEditingStep(step.id); }}
                          className={`w-full flex items-center gap-3 px-4 py-3 bg-white dark:bg-slate-800 rounded-xl transition-colors text-left group border ${
                            warning
                              ? 'border-amber-300 dark:border-amber-700 hover:border-amber-400 dark:hover:border-amber-600 hover:bg-amber-50/30 dark:hover:bg-amber-900/10'
                              : 'border-slate-200 dark:border-slate-700 hover:border-primary-300 dark:hover:border-primary-700 hover:bg-primary-50/30 dark:hover:bg-primary-900/10'
                          }`}
                        >
                          <span className={`shrink-0 ${warning ? 'text-amber-500 dark:text-amber-400' : 'text-primary-500 dark:text-primary-400'}`}>
                            {STEP_ICONS[step.id]}
                          </span>
                          <span className="text-sm font-medium text-slate-500 dark:text-slate-400 shrink-0">{step.label}</span>
                          <span className="flex-1 text-sm text-slate-700 dark:text-slate-300 truncate">· {getStepSummary(step.id)}</span>
                          {warning ? (
                            <span
                              data-testid={`step-warning-${step.id}`}
                              className="flex items-center gap-1 shrink-0 text-xs font-medium text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700 rounded-full px-2 py-0.5"
                            >
                              <AlertTriangle size={11} />
                            </span>
                          ) : (
                            <Pencil size={13} className="text-slate-300 dark:text-slate-600 group-hover:text-primary-500 transition-colors shrink-0" />
                          )}
                        </button>
                      );
                    })()}

                    {/* Expanded card (active or editing) */}
                    {isExpanded && (
                      <Card>
                        <div className="space-y-4">
                          {/* Card header: icon + step name */}
                          <div className="flex items-center gap-3">
                            <span className="text-primary-600 dark:text-primary-400">
                              {STEP_ICONS[step.id]}
                            </span>
                            <h3 className="text-base font-semibold text-slate-900 dark:text-white">{step.label}</h3>
                          </div>

                          {showErrors && (
                            <div className="rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-3">
                              <ul className="list-disc list-inside space-y-0.5">
                                {errors.map((e, i) => (
                                  <li key={i} className="text-sm text-red-700 dark:text-red-300">{e}</li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {renderStepContent(step.id, completedSteps.has(step.id))}

                          {/* Action buttons */}
                          {isEditing ? (
                            <div className="flex gap-3 pt-2">
                              <Button variant="secondary" fullWidth onClick={() => { setEditingStep(null); setPausedActiveStep(null); setErrors([]); setErrorStep(null); }}>
                                Cancel
                              </Button>
                              <Button variant="primary" fullWidth onClick={() => handleContinue(step.id)}>
                                Done
                              </Button>
                            </div>
                          ) : (
                            <Button
                              variant="primary"
                              fullWidth
                              onClick={() => handleContinue(step.id)}
                              data-testid="header-next-btn"
                            >
                              {step.id === 4 ? 'Done' : 'Next'}
                            </Button>
                          )}
                        </div>
                      </Card>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            );
          })}
        </div>

        {/* Calculate / prompt / results */}
        {allStepsCompleted && (
          <div ref={resultsRef} className="pt-2 space-y-4">
            {!hasAnyResult && (
              hasAnyWarning ? (
                <p className="text-center text-sm text-amber-600 dark:text-amber-400" data-testid="calc-missing-fields-msg">
                  Fill in the highlighted fields to see your returns
                </p>
              ) : (
                <Button
                  variant="primary"
                  fullWidth
                  onClick={handleCalculate}
                  data-testid="calculate-btn"
                >
                  <Calculator size={16} className="mr-2" />
                  See Your Returns
                </Button>
              )
            )}

            {hasAnyResult && (
              <>
                {hasAnyWarning && (
                  <p className="text-center text-sm text-amber-600 dark:text-amber-400" data-testid="calc-incomplete-warning">
                    Some fields are missing — results may be incomplete
                  </p>
                )}
                <div className="animate-fade-in">
                  <ResultsPanel
                    result={currentResult!}
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
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
