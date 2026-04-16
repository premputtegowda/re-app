'use client';

import React, { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { Pencil, Calculator, AlertTriangle, MapPin, CreditCard, Hammer, BarChart2, TrendingUp, ChevronRight, ChevronUp, ChevronDown, Check, Zap, X, FileText, RotateCcw } from 'lucide-react';
import { ShareButton } from './ShareButton';
import { Card } from '@/components/UI/Card';
import { Button } from '@/components/UI/Button';
import { StepProperty } from './steps/StepProperty';
import { StepFinancing } from './steps/StepFinancing';
import { StepRenovation } from './steps/StepRenovation';
import { StepExit } from './steps/StepExit';
import { ResultsPanel } from './ResultsPanel';
import { ProFormaGrid, defaultProForma } from './ProFormaGrid';
import { RehabRentCalculator } from './RehabRentCalculator';
import type { CalcPersistedState } from '@/types';
import { projectScenario, formatCurrencyCompact } from '@/utils/dealAnalyzerCalc';
import { useDealAnalyzerStore, type DealAnalyzerDraft } from '@/lib/dealAnalyzerStore';
import { useDealSettingsStore } from '@/lib/dealSettingsStore';
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

const STEP_CARD_STYLE = {
  bg: 'bg-white dark:bg-slate-800',
  iconColor: 'text-primary-500 dark:text-primary-400',
  border: 'border-slate-200 dark:border-slate-700',
};

function getStepCardData(
  stepId: number,
  acquisition: CoCAcquisition,
  proForma: ProFormaData,
  refinance: CoCRefinance,
  result?: CoCResult | null,
): { primary: string; primaryExtra: string | null; sub: string } {
  switch (stepId) {
    case 0: {
      const addr = acquisition.propertyAddress.trim() || 'No address';
      const type = acquisition.propertyType === 'mfr' ? 'Multi-Family' : 'Single Family';
      const totalUnits = acquisition.unitMix && acquisition.unitMix.length > 0
        ? acquisition.unitMix.reduce((s, e) => s + e.count, 0)
        : acquisition.units;
      const units = acquisition.propertyType === 'mfr' && totalUnits > 0
        ? `${totalUnits} units` : '';
      return { primary: addr, primaryExtra: null, sub: [type, units].filter(Boolean).join(' · ') };
    }
    case 1: {
      const price = acquisition.purchasePrice > 0 ? formatCurrencyCompact(acquisition.purchasePrice) : '—';
      const rate = acquisition.interestRate > 0 ? `${acquisition.interestRate}%` : null;
      const down = acquisition.downPaymentPct > 0 ? `${acquisition.downPaymentPct}% down` : '';
      const term = acquisition.loanTermYears > 0 ? `${acquisition.loanTermYears}yr term` : '';
      const exitYr = acquisition.projectionYears > 0 ? `Exit Yr ${acquisition.projectionYears}` : '';
      return { primary: price, primaryExtra: rate, sub: [down, term, exitYr].filter(Boolean).join(' · ') };
    }
    case 2: {
      const hard = (acquisition.hardCostItems ?? []).reduce((s, e) => s + e.amount, 0);
      const soft = (acquisition.softCostItems ?? []).reduce((s, e) => s + e.amount, 0);
      const total = hard + soft;
      if (total === 0) return { primary: 'No renovation', primaryExtra: null, sub: '' };
      const subParts = [
        hard > 0 ? 'Hard cost' : '',
        soft > 0 ? 'Soft cost' : '',
        acquisition.renovationMonths > 0 ? `${acquisition.renovationMonths} mo` : '',
      ].filter(Boolean);
      return { primary: formatCurrencyCompact(total), primaryExtra: null, sub: subParts.join(' · ') };
    }
    case 3: {
      const exitYearIdx = acquisition.projectionYears - 1;
      const exitNOI = result?.yearlyProjections?.[exitYearIdx]?.noi ?? null;
      const stabYear = acquisition.stabilizedMonth > 0
        ? Math.ceil(acquisition.stabilizedMonth / 12)
        : null;
      return {
        primary: exitNOI !== null ? formatCurrencyCompact(exitNOI) : (proForma.grossRent.stabilized > 0 ? formatCurrencyCompact(proForma.grossRent.stabilized) : '—'),
        primaryExtra: null,
        sub: [
          exitNOI !== null ? `Exit yr NOI` : `Gross rent`,
          stabYear !== null ? `Stab yr ${stabYear}` : '',
          `${acquisition.projectionYears}yr projection`,
        ].filter(Boolean).join(' · '),
      };
    }
    case 4: {
      const method = acquisition.exitMethod ?? 'value';
      const exitVal = method === 'capRate'
        ? (acquisition.exitCapRate > 0 ? `${acquisition.exitCapRate}% cap rate` : '—')
        : (acquisition.arv > 0 ? formatCurrencyCompact(acquisition.arv) : '—');
      const subParts = [
        method === 'value' && acquisition.arv > 0 ? 'Exit value' : method === 'capRate' ? 'Cap rate exit' : '',
        refinance.enabled ? `Yr${refinance.refiYear} refi` : '',
      ].filter(Boolean);
      return { primary: exitVal, primaryExtra: null, sub: subParts.join(' · ') };
    }
    default: return { primary: '—', primaryExtra: null, sub: '' };
  }
}

// ── AccordionHeader ────────────────────────────────────────────────────────────
// Defined at module level so React never sees a new component type between renders.

function AccordionHeader({ num, title, summary, isOpen, onToggle, isComplete }: {
  num: number; title: string; summary: string;
  isOpen: boolean; onToggle: () => void; isComplete: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="w-full flex items-center gap-3 px-4 py-3.5 text-left touch-manipulation"
    >
      <span className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${
        isComplete
          ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400'
          : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400'
      }`}>
        {isComplete ? <Check size={12} /> : <span className="text-xs font-bold">{num}</span>}
      </span>
      <span className="text-sm font-semibold text-slate-700 dark:text-slate-200 flex-1">{title}</span>
      {!isOpen && summary && (
        <span className="text-xs text-slate-400 dark:text-slate-500 mr-1 truncate max-w-[150px]">{summary}</span>
      )}
      {isOpen
        ? <ChevronUp size={16} className="text-slate-400 shrink-0" />
        : <ChevronRight size={16} className="text-slate-400 shrink-0" />}
    </button>
  );
}

// ── OpsCard ────────────────────────────────────────────────────────────────────
// Completed sub-section summary card for the Operations mini-step flow.

function OpsCard({ num, title, summary, onEdit, warning }: {
  num: number; title: string; summary: string; onEdit: () => void; warning?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onEdit}
      className="w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-left group hover:border-primary-300 dark:hover:border-primary-600 transition-colors"
    >
      {warning ? (
        <span className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 bg-amber-100 dark:bg-amber-900/40 text-amber-500 dark:text-amber-400">
          <AlertTriangle size={12} />
        </span>
      ) : (
        <span className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400">
          <Check size={12} />
        </span>
      )}
      <span className="text-sm font-semibold text-slate-700 dark:text-slate-200 flex-1">{title}</span>
      {summary && <span className="text-xs text-slate-400 dark:text-slate-500 truncate max-w-[180px]">{summary}</span>}
      <Pencil size={13} className="text-slate-300 dark:text-slate-600 group-hover:text-primary-500 dark:group-hover:text-primary-400 transition-colors shrink-0" />
    </button>
  );
}

// ── OpsSectionHeader ───────────────────────────────────────────────────────────
// Non-interactive header for an active Operations sub-section.

function OpsSectionHeader({ num, title, isComplete }: { num: number; title: string; isComplete: boolean }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3.5">
      <span className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${
        isComplete
          ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400'
          : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400'
      }`}>
        {isComplete ? <Check size={12} /> : <span className="text-xs font-bold">{num}</span>}
      </span>
      <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">{title}</span>
    </div>
  );
}

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
  const exit = a.projectionYears > 0 ? `Exit Yr ${a.projectionYears}` : '';
  return [price, down, rate, term, exit].filter(Boolean).join(' · ');
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
  const { defaultPropertyMgmtPct, defaultCapExPerUnit, defaultMaintenancePct } = useDealSettingsStore();

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
  const [calcState, setCalcState] = useState<CalcPersistedState | undefined>(initialDeal?.calcState);
  const [calcKey, setCalcKey] = useState(0);
  const [isValueAdd, setIsValueAdd] = useState<boolean | null>(() => {
    // Prefer explicitly persisted value
    if (initialDeal?.calcState?.isValueAdd !== undefined) return initialDeal.calcState.isValueAdd ?? null;
    if (!initialDeal) return null;
    // Fallback: infer from data for deals saved before this field was added
    const isMfr = initialDeal.acquisition.propertyType === 'mfr';
    const hasPreStab = isMfr
      ? initialDeal.acquisition.unitMix.some(e => (e.preStabRent || 0) > 0)
      : (initialDeal.acquisition.sfrPreStabRent || 0) > 0;
    const hasCalcOverrides = Object.values(initialDeal.proForma.yearOverrides ?? {}).some(ov => ov?.grossRentSystem);
    if (hasPreStab || hasCalcOverrides) return true;
    return null;
  });
  const [preStabMethod, setPreStabMethod] = useState<'calculator' | 'manual' | null>(() => {
    // Prefer explicitly persisted value
    if (initialDeal?.calcState?.preStabMethod !== undefined) return initialDeal.calcState.preStabMethod ?? 'calculator';
    if (!initialDeal) return 'calculator';
    // Fallback: infer from data for deals saved before this field was added
    const isMfr = initialDeal.acquisition.propertyType === 'mfr';
    const hasPreStab = isMfr
      ? initialDeal.acquisition.unitMix.some(e => (e.preStabRent || 0) > 0)
      : (initialDeal.acquisition.sfrPreStabRent || 0) > 0;
    const hasCalcOverrides = Object.values(initialDeal.proForma.yearOverrides ?? {}).some(ov => ov?.grossRentSystem);
    if (hasCalcOverrides) return 'calculator';
    if (hasPreStab) return 'manual';
    return 'calculator';
  });
  const [stabDuration, setStabDuration] = useState(() => initialDeal?.calcState?.totalDuration ?? 12);
  const [offlinePerUnit, setOfflinePerUnit] = useState(() => initialDeal?.calcState?.perUnitMonths?.[0] || 1);
  const [distributionMethod, setDistributionMethod] = useState<'weighted' | 'custom'>(() =>
    initialDeal?.calcState?.distributionMethod === 'custom' ? 'custom' : 'weighted'
  );
  const [calcCollapsed, setCalcCollapsed] = useState(true);
  const [opsNotes, setOpsNotes] = useState(() => initialDeal?.stepNotes?.[3] ?? '');
  const [opsNotesOpen, setOpsNotesOpen] = useState(false);

  // ── Operations mini-step state ────────────────────────────────────────────────
  type OpsSection = 'rent' | 'valueAdd' | 'stab';

  const [activeOpsSection, setActiveOpsSection] = useState<OpsSection | null>(() => {
    if (!initialDeal) return 'rent';
    const acq = initialDeal.acquisition;
    const isMfr = acq.propertyType === 'mfr' && (acq.unitMix?.length ?? 0) > 0;
    const rentDone = isMfr
      ? (acq.unitMix ?? []).some(e => (e.rentMonthly || 0) > 0)
      : (acq.sfrTargetRent || 0) > 0;
    if (!rentDone) return 'rent';
    const vaState = initialDeal.calcState?.isValueAdd;
    const hasCalcOvs = Object.values(initialDeal.proForma?.yearOverrides ?? {}).some(ov => ov?.grossRentSystem);
    const hasPreStab = isMfr
      ? (acq.unitMix ?? []).some(e => (e.preStabRent || 0) > 0)
      : (acq.sfrPreStabRent || 0) > 0;
    const vaAnswered = vaState !== undefined && vaState !== null
      ? true : (hasCalcOvs || hasPreStab);
    if (!vaAnswered) return 'valueAdd';
    const vaYes = vaState === true || (vaState === undefined && (hasCalcOvs || hasPreStab));
    if (!vaYes) return null;
    const stabDone = hasCalcOvs || hasPreStab;
    return stabDone ? null : 'stab';
  });

  const [completedOpsSections, setCompletedOpsSections] = useState<Set<OpsSection>>(() => {
    const s = new Set<OpsSection>();
    if (!initialDeal) return s;
    const acq = initialDeal.acquisition;
    const isMfr = acq.propertyType === 'mfr' && (acq.unitMix?.length ?? 0) > 0;
    const rentDone = isMfr
      ? (acq.unitMix ?? []).some(e => (e.rentMonthly || 0) > 0)
      : (acq.sfrTargetRent || 0) > 0;
    if (rentDone) s.add('rent');
    const vaState = initialDeal.calcState?.isValueAdd;
    const hasCalcOvs = Object.values(initialDeal.proForma?.yearOverrides ?? {}).some(ov => ov?.grossRentSystem);
    const hasPreStab = isMfr
      ? (acq.unitMix ?? []).some(e => (e.preStabRent || 0) > 0)
      : (acq.sfrPreStabRent || 0) > 0;
    const vaAnswered = (vaState !== undefined && vaState !== null) || hasCalcOvs || hasPreStab;
    if (vaAnswered) s.add('valueAdd');
    if (vaState === false || hasCalcOvs || hasPreStab) s.add('stab');
    return s;
  });

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
    const pfDefaults = { propertyMgmtPct: defaultPropertyMgmtPct, capExPerUnit: defaultCapExPerUnit, maintenancePct: defaultMaintenancePct, units: DEFAULT_ACQUISITION.units };
    let pf = initialDeal?.proForma ?? defaultProForma(DEFAULT_ACQUISITION.propertyType, pfDefaults);
    if (initialDeal?.operations.annualRentGrowthPct) {
      pf = { ...pf, grossRent: { ...pf.grossRent, growthPct: initialDeal.operations.annualRentGrowthPct } };
    }
    // Sync base growthPct from Year 2 override if it exists (fixes deals saved before this sync was added)
    const yr2GrowthOverride = pf.yearOverrides?.[2]?.grossRentGrowthPct;
    if (yr2GrowthOverride !== undefined) {
      pf = { ...pf, grossRent: { ...pf.grossRent, growthPct: yr2GrowthOverride } };
    }
    // Clear stale Year 2 grossRent pin — chainedValue computes Year 2 correctly.
    // Keep Year 2 grossRent only if it's a calculator-driven stabilizing value (below target).
    if (pf.yearOverrides?.[2]?.grossRentSystem) {
      const targetAnnual = initialDeal
        ? (initialDeal.acquisition.propertyType === 'mfr'
            ? initialDeal.acquisition.unitMix.reduce((s, e) => s + e.count * (e.rentMonthly || 0), 0) * 12
            : (initialDeal.acquisition.sfrTargetRent || 0) * 12)
        : 0;
      const yr2Rent = pf.yearOverrides[2].grossRent;
      const isStabilizing = typeof yr2Rent === 'number' && targetAnnual > 0 && yr2Rent < targetAnnual;
      if (!isStabilizing) {
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


  // Save state
  const [savedDealId, setSavedDealId] = useState<string | null>(initialDeal?.id ?? null);
  const [saveName, setSaveName] = useState(initialDeal?.name ?? '');
  const [editingTitle, setEditingTitle] = useState(false);
  const titleBeforeEdit = useRef('');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showExitWarning, setShowExitWarning] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved'>('idle');
  const [calcPhase, setCalcPhase] = useState<'idle' | 'returns' | 'uncertainty' | 'done'>('idle');
  const saveStatusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashSaved = () => {
    setSaveStatus('saved');
    if (saveStatusTimer.current) clearTimeout(saveStatusTimer.current);
    saveStatusTimer.current = setTimeout(() => setSaveStatus('idle'), 3000);
  };

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
    (savedSnapshot.current !== JSON.stringify({ acquisition, operations, proForma, refinance }) ||
      saveName !== (initialDeal?.name ?? ''));

  const resultsRef = useRef<HTMLDivElement>(null);
  const mcSimRunRef = useRef<(() => void) | null>(null);
  const calcDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    lastCalcSnapshotRef.current = JSON.stringify({ acquisition, operations, proForma, refinance });
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
      // Clear any stale Year 2 grossRent pin — chainedValue computes Year 2
      // correctly as stabilized × (1 + yr2Growth). Only keep non-grossRent overrides.
      if (ovs[2]) {
        const yr2StabilizingFromCalc = ovs[2]?.grossRentSystem === true &&
          typeof ovs[2]?.grossRent === 'number' &&
          targetAnnual > 0 &&
          ovs[2].grossRent < targetAnnual;
        // Keep calculator-driven stabilizing overrides (pre-stab extending into Year 2)
        if (!yr2StabilizingFromCalc) {
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
      setProForma((prev) => {
        // When calculator method is active, never let manual preStabRent fields override
        // the ProForma — the calculator's onApplyRents owns those year overrides.
        const preStabAnnual = preStabMethod === 'calculator' ? 0 : totalPreStab * 12;
        const targetAnnual = allHaveTarget ? totalTarget * 12 : 0;
        const preserveCalcOverrides = preStabAnnual === 0 &&
          Object.values(prev.yearOverrides ?? {}).some(ov => ov?.grossRentSystem === true);
        return {
          ...prev,
          grossRent: {
            ...prev.grossRent,
            ...(allHaveTarget  ? { stabilized: totalTarget * 12 } : { stabilized: 0 }),
            ...(allHaveInPlace ? { t12: totalInPlace * 12 }       : { t12: 0 }),
          },
          yearOverrides: preserveCalcOverrides
            ? prev.yearOverrides
            : applyRentOverrides(prev, preStabAnnual, targetAnnual),
        };
      });
    } else if (acquisition.propertyType === 'sfr') {
      const target  = acquisition.sfrTargetRent  || 0;
      const inPlace = acquisition.sfrInPlaceRent || 0;
      const preStab = acquisition.sfrPreStabRent || 0;
      if (target > 0) setOperations((prev) => ({ ...prev, grossRentMonthly: target }));
      setProForma((prev) => {
        // When calculator method is active, never let manual preStabRent fields override
        // the ProForma — the calculator's onApplyRents owns those year overrides.
        const preStabAnnual = preStabMethod === 'calculator' ? 0 : preStab * 12;
        const preserveCalcOverrides = preStabAnnual === 0 &&
          Object.values(prev.yearOverrides ?? {}).some(ov => ov?.grossRentSystem === true);
        return {
          ...prev,
          grossRent: {
            ...prev.grossRent,
            stabilized: target  > 0 ? target  * 12 : prev.grossRent.stabilized,
            t12:        inPlace > 0 ? inPlace * 12 : prev.grossRent.t12,
          },
          yearOverrides: preserveCalcOverrides
            ? prev.yearOverrides
            : applyRentOverrides(prev, preStabAnnual, target * 12),
        };
      });
    }
  }, [acquisition.unitMix, acquisition.propertyType, acquisition.sfrTargetRent, acquisition.sfrInPlaceRent, acquisition.sfrPreStabRent, preStabMethod]);

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
    const units = acquisition.propertyType === 'mfr' ? Math.max(1, totalMFRUnits) : 1;
    setProForma(defaultProForma(acquisition.propertyType, { propertyMgmtPct: defaultPropertyMgmtPct, capExPerUnit: defaultCapExPerUnit, maintenancePct: defaultMaintenancePct, units }));
  }, [acquisition.propertyType, totalMFRUnits, defaultPropertyMgmtPct, defaultCapExPerUnit, defaultMaintenancePct]);

  // Recalculate CapEx when unit count changes
  const prevUnitCount = useRef(acquisition.propertyType === 'mfr' ? totalMFRUnits : 1);
  useEffect(() => {
    const units = acquisition.propertyType === 'mfr' ? Math.max(1, totalMFRUnits) : 1;
    if (units === prevUnitCount.current) return;
    prevUnitCount.current = units;
    setProForma(prev => ({
      ...prev,
      expenses: prev.expenses.map(e =>
        e.name === 'CapEx Reserves' && !e.isPercentOfEGI
          ? { ...e, stabilizedValue: defaultCapExPerUnit * units }
          : e
      ),
    }));
  }, [acquisition.propertyType, totalMFRUnits, defaultCapExPerUnit]);

  // Auto-fill save name when address changes — only if user hasn't set a custom name
  const prevAddressRef = useRef(initialDeal?.acquisition?.propertyAddress ?? '');
  useEffect(() => {
    const prev = prevAddressRef.current;
    const next = acquisition.propertyAddress;
    prevAddressRef.current = next;
    // Only sync when there is an actual address value, and the user hasn't customised the title
    if (next && (!saveName || saveName === prev)) {
      setSaveName(next);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [acquisition.propertyAddress]);


  // ── Stable arrays for calculator props (must be memoized — new refs trigger external effects) ──

  const unitsToRenovateMemo = React.useMemo(
    () => acquisition.propertyType === 'mfr' && acquisition.unitMix.length > 0
      ? acquisition.unitMix.map(e => e.unitsToRenovate ?? 0)
      : [1],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [acquisition.propertyType, acquisition.unitMix.map(e => e.unitsToRenovate ?? 0).join(',')]
  );

  const leaseUpUnitsArrMemo = React.useMemo(
    () => acquisition.propertyType === 'mfr' && acquisition.unitMix.length > 0
      ? acquisition.unitMix.map(e => e.leaseUpUnits ?? 0)
      : [0],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [acquisition.propertyType, acquisition.unitMix.map(e => e.leaseUpUnits ?? 0).join(',')]
  );

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

  // Enrich calcState with form-level fields before saving so they survive a reload
  const buildCalcState = (): CalcPersistedState | undefined => {
    const base = calcState ?? ({} as CalcPersistedState);
    // Always stamp the form-level fields so they survive a reload even if the
    // calculator's onStateChange hasn't fired (e.g. user only typed in the
    // duration/offline inputs without opening the calculator).
    const unitCount = acquisition.propertyType === 'mfr' ? acquisition.unitMix.length : 1;
    const perUnitMonths = base.perUnitMonths?.length === unitCount
      ? base.perUnitMonths.map(() => offlinePerUnit)
      : Array(unitCount).fill(offlinePerUnit);
    return {
      ...base,
      totalDuration: stabDuration,
      perUnitMonths,
      isValueAdd,
      preStabMethod,
    } as CalcPersistedState;
  };

  // ── Calculate ──

  const [resultsStale, setResultsStale] = useState(false);
  const lastCalcSnapshotRef = useRef<string | null>(null);

  // Mark results as stale only when inputs actually changed since last calculation
  const scheduleCalculate = () => {
    if (Object.keys(scenarioResults).length === 0) return;
    const currentSnapshot = JSON.stringify({ acquisition, operations, proForma, refinance });
    if (lastCalcSnapshotRef.current === currentSnapshot) return; // nothing changed
    setResultsStale(true);
  };

  const handleCalculate = () => {
    setResultsStale(false);
    lastCalcSnapshotRef.current = JSON.stringify({ acquisition, operations, proForma, refinance });
    setCalcPhase('returns');
    // Smooth scroll to results area
    resultsRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });

    // Delay to let the UI show the loading state before heavy computation
    setTimeout(() => {
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

    const name = saveName || defaultSaveName(acquisition);
    const enriched = buildCalcState();
    const stepNotesObj: Record<number, string> = {};
    if (opsNotes.trim()) stepNotesObj[3] = opsNotes.trim();
    const draft: DealAnalyzerDraft = {
      acquisition, operations, proForma, refinance,
      currentStep: activeStep,
      visitedSteps: Array.from(completedSteps),
      activeType,
      ...(enriched ? { calcState: enriched } : {}),
      ...(Object.keys(stepNotesObj).length > 0 ? { stepNotes: stepNotesObj } : {}),
    };

    if (savedDealId) {
      updateSavedDeal(savedDealId, name, updatedResults, draft, mcRanges as unknown as SavedDeal['mcRanges'] ?? undefined, mcResults ?? undefined);
    } else if (acquisition.propertyAddress.trim()) {
      // Auto-save new deal on first calculate
      const newId = saveDeal(name, draft, updatedResults, mcRanges as unknown as SavedDeal['mcRanges'] ?? undefined, mcResults ?? undefined);
      setSavedDealId(newId);
      setSaveName(name);
      savedSnapshot.current = JSON.stringify({ acquisition, operations, proForma, refinance });
    }

    // Show uncertainty phase briefly, then reveal results
    setCalcPhase('uncertainty');
    setTimeout(() => setCalcPhase('done'), 1500);
    setTimeout(() => setCalcPhase('idle'), 2000);
    }, 100); // end of setTimeout from setCalcPhase('returns')
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

    // Auto-save draft on every step completion
    {
      const name = saveName || defaultSaveName(acquisition);
      const enriched = buildCalcState();
      const stepNotesObj: Record<number, string> = {};
      if (opsNotes.trim()) stepNotesObj[3] = opsNotes.trim();
      const draft: DealAnalyzerDraft = {
        acquisition, operations, proForma, refinance,
        currentStep: editingStep !== null ? activeStep : stepId + 1,
        visitedSteps: Array.from(new Set([...Array.from(completedSteps), stepId])),
        activeType,
        ...(enriched ? { calcState: enriched } : {}),
        ...(Object.keys(stepNotesObj).length > 0 ? { stepNotes: stepNotesObj } : {}),
      };

      if (savedDealId) {
        updateSavedDeal(savedDealId, name, scenarioResults, draft, mcRanges as unknown as SavedDeal['mcRanges'] ?? undefined, mcResults ?? undefined);
        flashSaved();
      } else if (acquisition.propertyAddress.trim()) {
        const newId = saveDeal(name, draft, scenarioResults, mcRanges as unknown as SavedDeal['mcRanges'] ?? undefined, mcResults ?? undefined);
        setSavedDealId(newId);
        setSaveName(name);
        savedSnapshot.current = JSON.stringify({ acquisition, operations, proForma, refinance });
        flashSaved();
      }
    }

    // Schedule recalculate with debounce so rapid Done clicks don't fire multiple times
    scheduleCalculate();
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
    const enriched = buildCalcState();
    const stepNotes: Record<number, string> = {};
    if (opsNotes.trim()) stepNotes[3] = opsNotes.trim();
    const currentDraft: DealAnalyzerDraft = {
      acquisition, operations, proForma, refinance,
      currentStep: activeStep,
      visitedSteps: Array.from(completedSteps),
      activeType,
      ...(enriched ? { calcState: enriched } : {}),
      ...(Object.keys(stepNotes).length > 0 ? { stepNotes } : {}),
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

        const hasTargetRent = hasMfr
          ? acquisition.unitMix.some(e => (e.rentMonthly || 0) > 0)
          : (acquisition.sfrTargetRent || 0) > 0;

        const hasPreStab = hasMfr
          ? acquisition.unitMix.some(e => (e.preStabRent || 0) > 0)
          : (acquisition.sfrPreStabRent || 0) > 0;

        const calcApplied = Object.values(proForma.yearOverrides ?? {}).some(ov => ov?.grossRentSystem);

        const unitsToRenovate = hasMfr
          ? acquisition.unitMix.map(e => e.unitsToRenovate ?? 0)
          : [1];

        const leaseUpUnitsArr = hasMfr
          ? acquisition.unitMix.map(e => e.leaseUpUnits ?? 0)
          : [0];

        const renoScheduleTotals = unitsToRenovate.map((_, t) =>
          (calcState?.scheduleByType?.[t] ?? []).reduce((s: number, n: number) => s + n, 0)
        );
        const luScheduleTotals = leaseUpUnitsArr.map((_, t) =>
          (calcState?.leaseUpScheduleByType?.[t] ?? []).reduce((s: number, n: number) => s + n, 0)
        );
        const someReno = unitsToRenovate.some(u => u > 0);
        const someLU = leaseUpUnitsArr.some(u => u > 0);
        const calcScheduleIncomplete = preStabMethod === 'calculator' && (someReno || someLU) && !calcApplied && (
          stabDuration === 0 ||
          unitsToRenovate.some((u, t) => u > 0 && renoScheduleTotals[t] !== u) ||
          leaseUpUnitsArr.some((u, t) => u > 0 && luScheduleTotals[t] !== u)
        );

        const hasAnyUnits = someReno || someLU;
        const valueAddIncomplete = isValueAdd === true && !hasAnyUnits;
        const stepComplete =
          isValueAdd === false ||
          (isValueAdd === true && !calcScheduleIncomplete);

        const unitTypes = hasMfr
          ? acquisition.unitMix.map(e => ({
              label: `${e.beds}BR/${e.baths}BA`,
              count: e.count,
              inPlaceRent: e.inPlaceRent || 0,
              targetRent: e.rentMonthly || 0,
              preStabRent: e.preStabRent || 0,
            }))
          : [{
              label: 'SFR',
              count: 1,
              inPlaceRent: acquisition.sfrInPlaceRent || 0,
              targetRent: acquisition.sfrTargetRent || 0,
              preStabRent: acquisition.sfrPreStabRent || 0,
            }];

        const calcAppliedYears: Record<number, number> = {};
        for (let y = 1; y <= acquisition.projectionYears; y++) {
          const ov = proForma.yearOverrides?.[y]?.grossRent;
          if (ov !== undefined) calcAppliedYears[y] = ov;
        }

        // Pre-stab schedule rows — only years below stabilized rent
        const fmtRent = (n: number) => `$${Math.round(n).toLocaleString()}`;
        const stabilizedAnnual = proForma.grossRent.stabilized;
        const preStabRows: { year: number; rent: number }[] = [];
        if (calcApplied) {
          Object.entries(proForma.yearOverrides ?? {})
            .filter(([, ov]) => ov?.grossRentSystem && typeof ov?.grossRent === 'number' && ov.grossRent < stabilizedAnnual)
            .sort(([a], [b]) => Number(a) - Number(b))
            .forEach(([yr, ov]) => preStabRows.push({ year: Number(yr), rent: ov!.grossRent! }));
        } else if (hasPreStab && stabDuration > 0) {
          const totalPreStabMonthly = hasMfr
            ? acquisition.unitMix.reduce((s, e) => s + e.count * (e.preStabRent || 0), 0)
            : (acquisition.sfrPreStabRent || 0);
          const totalTargetMonthly = hasMfr
            ? acquisition.unitMix.reduce((s, e) => s + e.count * (e.rentMonthly || 0), 0)
            : (acquisition.sfrTargetRent || 0);
          const totalYears = Math.ceil(stabDuration / 12);
          for (let y = 1; y <= totalYears; y++) {
            const preStabMonths = Math.min(12, stabDuration - (y - 1) * 12);
            const rent = totalPreStabMonthly * preStabMonths + totalTargetMonthly * (12 - preStabMonths);
            if (rent < stabilizedAnnual) preStabRows.push({ year: y, rent });
          }
        }

        const card = 'rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden bg-white dark:bg-slate-800';
        const totalUnits = hasMfr ? acquisition.unitMix.reduce((s, e) => s + e.count, 0) : 1;

        // ── Accordion summaries ──
        const rentSummary = hasMfr
          ? acquisition.unitMix.map(e =>
              `${e.beds}BR $${e.inPlaceRent || 0}→$${e.rentMonthly || 0} ×${e.count}`
            ).join(' · ')
          : `$${acquisition.sfrInPlaceRent || 0} → $${acquisition.sfrTargetRent || 0}`;

        const totalReno = unitsToRenovate.reduce((s, n) => s + n, 0);
        const totalLU   = leaseUpUnitsArr.reduce((s, n) => s + n, 0);
        const valueAddSummary = isValueAdd === false
          ? 'No — already at market'
          : isValueAdd === true
            ? [totalReno > 0 && `${totalReno} reno`, totalLU > 0 && `${totalLU} lease-up`].filter(Boolean).join(' · ') || 'No units assigned'
            : '';

        const stabSummary = stepComplete
          ? preStabMethod === 'calculator'
            ? `${stabDuration} mo · Schedule applied`
            : `${stabDuration} mo · Manual`
          : '';

        return (
          <div className="space-y-3">

            {/* ── Section 1: Rent ── */}
            {completedOpsSections.has('rent') && activeOpsSection !== 'rent' ? (
              <OpsCard num={1} title="Rent" summary={rentSummary} onEdit={() => setActiveOpsSection('rent')} />
            ) : (
            <div className={card}>
              <OpsSectionHeader num={1} title="Rent" isComplete={hasTargetRent} />
                <div className="border-t border-slate-100 dark:border-slate-700/60">
                  <p className="px-4 pt-3 text-xs text-slate-400 dark:text-slate-500">Estimate ok if exact figures aren't available</p>
                  {hasMfr ? (
                    <>
                      {/* Mobile: card-per-unit layout */}
                      <div className="sm:hidden divide-y divide-slate-100 dark:divide-slate-700/60">
                        {acquisition.unitMix.map(entry => (
                          <div key={entry.id} className="px-4 py-3 space-y-2">
                            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                              {entry.beds}BR/{entry.baths}BA <span className="text-slate-400">×{entry.count}</span>
                            </p>
                            <div className="grid grid-cols-2 gap-3">
                              {([
                                { field: 'inPlaceRent' as const, label: 'In-Place' },
                                { field: 'rentMonthly' as const, label: 'Target'   },
                              ]).map(({ field, label }) => {
                                const warn = field === 'rentMonthly' && isVisited && !(entry[field] || 0);
                                return (
                                  <div key={field}>
                                    <label className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1 flex items-center gap-1">
                                      {label}
                                      {warn && <AlertTriangle size={12} className="text-amber-500" />}
                                    </label>
                                    <div className="relative">
                                      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400">$</span>
                                      <input
                                        type="number" min={0} placeholder="0"
                                        className={`input text-sm pl-5 text-right w-full ${warn ? 'border-amber-300 focus:ring-amber-400' : ''}`}
                                        value={(entry[field] || 0) === 0 ? '' : entry[field]}
                                        onChange={e => {
                                          updateAcquisition('unitMix', acquisition.unitMix.map(u =>
                                            u.id === entry.id ? { ...u, [field]: Number(e.target.value) } : u
                                          ));
                                        }}
                                      />
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                            {(entry.preStabRent || 0) > 0 && (
                              <p className="text-xs text-primary-600 dark:text-primary-400">
                                Pre-Stab: ${entry.preStabRent} <span className="text-slate-400">(calc)</span>
                              </p>
                            )}
                          </div>
                        ))}
                        <div className="px-4 py-2 flex justify-between text-xs text-slate-400">
                          <span>Avg In-Place: ${acquisition.unitMix.length > 0 ? Math.round(acquisition.unitMix.reduce((s, e) => s + (e.inPlaceRent || 0), 0) / acquisition.unitMix.length) : 0}</span>
                          <span>Avg Target: ${acquisition.unitMix.length > 0 ? Math.round(acquisition.unitMix.reduce((s, e) => s + (e.rentMonthly || 0), 0) / acquisition.unitMix.length) : 0}</span>
                        </div>
                      </div>
                      {/* Desktop: table layout */}
                      <div className="hidden sm:block">
                        <table className="w-full text-sm mt-1">
                          <thead>
                            <tr className="border-b border-slate-100 dark:border-slate-700/60">
                              <th className="px-4 py-2 text-left text-xs font-medium text-slate-400">Unit Type</th>
                              <th className="px-3 py-2 text-right text-xs font-medium text-slate-400">In-Place</th>
                              <th className="px-3 py-2 text-right text-xs font-medium text-slate-400">
                                <span className="flex items-center justify-end gap-1">
                                  Target
                                  {isVisited && acquisition.unitMix.some(e => !(e.rentMonthly || 0)) && (
                                    <AlertTriangle size={12} className="text-amber-500" data-testid="mfr-target-rent-warning" />
                                  )}
                                </span>
                              </th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
                            {acquisition.unitMix.map(entry => (
                              <tr key={entry.id}>
                                <td className="px-4 py-2.5 text-xs font-medium text-slate-600 dark:text-slate-300 whitespace-nowrap">
                                  {entry.beds}BR/{entry.baths}BA <span className="text-slate-400 font-normal">×{entry.count}</span>
                                </td>
                                {(['inPlaceRent', 'rentMonthly'] as const).map(field => {
                                  const warn = field === 'rentMonthly' && isVisited && !(entry[field] || 0);
                                  return (
                                    <td key={field} className="px-2 py-2">
                                      <div className="relative">
                                        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400">$</span>
                                        <input
                                          type="number" min={0} placeholder="0"
                                          className={`input text-sm pl-5 text-right w-full ${warn ? 'border-amber-300 focus:ring-amber-400' : ''}`}
                                          value={(entry[field] || 0) === 0 ? '' : entry[field]}
                                          onChange={e => {
                                            updateAcquisition('unitMix', acquisition.unitMix.map(u =>
                                              u.id === entry.id ? { ...u, [field]: Number(e.target.value) } : u
                                            ));
                                          }}
                                        />
                                      </div>
                                    </td>
                                  );
                                })}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  ) : (
                    <div className="px-4 py-3">
                      <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2">Rent Schedule ($/mo)</p>
                      {(acquisition.sfrPreStabRent || 0) > 0 && (
                        <p className="mb-2 text-xs text-primary-600 dark:text-primary-400">
                          Pre-stab: ${acquisition.sfrPreStabRent} — <span className="text-slate-400">from calculator</span>
                        </p>
                      )}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {([
                          { field: 'sfrInPlaceRent' as const, label: 'In-Place' },
                          { field: 'sfrTargetRent'  as const, label: 'Target'   },
                        ]).map(({ field, label }) => {
                          const warn = field === 'sfrTargetRent' && isVisited && !acquisition[field];
                          return (
                            <div key={field}>
                              <label className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5 flex items-center gap-1">
                                {label}
                                {warn && <AlertTriangle size={12} className="text-amber-500" data-testid="sfr-target-rent-warning" />}
                              </label>
                              <div className="relative">
                                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400">$</span>
                                <input
                                  type="number" min={0} placeholder="0"
                                  className={`input text-sm pl-6 ${warn ? 'border-amber-300 focus:ring-amber-400' : ''}`}
                                  value={(acquisition[field] || 0) === 0 ? '' : acquisition[field]}
                                  onChange={e => {
                                    updateAcquisition(field, Number(e.target.value));
                                  }}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              <div className="flex gap-3 px-4 pb-4 pt-2 border-t border-slate-100 dark:border-slate-700/60 mt-2">
                {completedOpsSections.has('rent') && (
                  <Button variant="secondary" onClick={() => setActiveOpsSection(null)}>Cancel</Button>
                )}
                <Button variant="primary" fullWidth={!completedOpsSections.has('rent')} onClick={() => {
                  const vaDone = completedOpsSections.has('valueAdd');
                  setCompletedOpsSections(prev => { const s = new Set(prev); s.add('rent'); return s; });
                  setActiveOpsSection(hasTargetRent && !vaDone ? 'valueAdd' : null);
                  scheduleCalculate();
                }}>Done</Button>
              </div>
            </div>
            )}

            {/* ── Section 2: Value-Add Plan ── */}
            <AnimatePresence>
            {completedOpsSections.has('rent') && completedOpsSections.has('valueAdd') && activeOpsSection !== 'valueAdd' && (
              <motion.div
                key="va-summary"
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.25, ease: 'easeOut' }}
              >
                <OpsCard num={2} title="Value-Add Plan" summary={valueAddSummary} onEdit={() => setActiveOpsSection('valueAdd')} warning={valueAddIncomplete} />
              </motion.div>
            )}
            {completedOpsSections.has('rent') && activeOpsSection === 'valueAdd' && (
              <motion.div
                key="va-active"
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.25, ease: 'easeOut' }}
                className={card}
              >
                <OpsSectionHeader num={2} title="Value-Add Plan" isComplete={isValueAdd !== null} />
                  <div className="border-t border-slate-100 dark:border-slate-700/60 px-4 py-4 space-y-4">

                    {/* Yes / No */}
                    <div>
                      <p className="text-sm font-medium text-slate-600 dark:text-slate-300 mb-2.5">
                        Will any units be renovated or leased up?
                      </p>
                      <div className="grid grid-cols-2 gap-2">
                        {([
                          { val: false as const, label: 'No',  sub: 'Already at market' },
                          { val: true  as const, label: 'Yes', sub: 'Value-add'          },
                        ]).map(({ val, label, sub }) => (
                          <button
                            key={String(val)}
                            type="button"
                            onClick={() => {
                              setIsValueAdd(val);
                              if (!val) {
                                if (hasMfr) updateAcquisition('unitMix', acquisition.unitMix.map(u => ({ ...u, preStabRent: 0 })));
                                else updateAcquisition('sfrPreStabRent', 0);
                                setProForma(prev => {
                                  const ovs = { ...(prev.yearOverrides ?? {}) };
                                  for (let y = 1; y <= acquisition.projectionYears; y++) {
                                    if (ovs[y]) {
                                      const { grossRent: _r, grossRentSystem: _s, ...rest } = ovs[y];
                                      ovs[y] = Object.keys(rest).length ? rest : undefined as never;
                                      if (!ovs[y]) delete ovs[y];
                                    }
                                  }
                                  return { ...prev, yearOverrides: ovs };
                                });
                              }
                            }}
                            className={`py-3 px-3 rounded-xl text-left transition-colors ${
                              isValueAdd === val
                                ? 'bg-primary-600 text-white'
                                : 'bg-slate-100 dark:bg-slate-700/60 text-slate-600 dark:text-slate-300'
                            }`}
                          >
                            <p className="text-sm font-semibold">{label}</p>
                            <p className={`text-xs mt-0.5 ${isValueAdd === val ? 'text-primary-100' : 'text-slate-400'}`}>{sub}</p>
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Rent gap notice (No selected) */}
                    {isValueAdd === false && (
                      hasMfr
                        ? acquisition.unitMix.some(e => (e.inPlaceRent || 0) < (e.rentMonthly || 0))
                        : (acquisition.sfrInPlaceRent || 0) < (acquisition.sfrTargetRent || 0)
                    ) && (
                      <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800/40">
                        <AlertTriangle size={13} className="text-amber-500 mt-0.5 shrink-0" />
                        <p className="text-xs text-amber-700 dark:text-amber-400">
                          Current rent is below target. The Pro Forma will use target rent starting Year 1.
                        </p>
                      </div>
                    )}

                    {/* Stabilization plan table (Yes selected) */}
                    {isValueAdd === true && (
                      <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                        {hasMfr ? (
                          <div className="divide-y divide-slate-100 dark:divide-slate-700/60">
                            {acquisition.unitMix.map(entry => (
                              <div key={entry.id} className="px-4 py-3 space-y-2">
                                <p className="text-xs font-medium text-slate-600 dark:text-slate-300">
                                  {entry.beds}BR/{entry.baths}BA <span className="text-slate-400 font-normal">×{entry.count}</span>
                                </p>
                                <div className="grid grid-cols-2 gap-3">
                                  <div>
                                    <label className="text-[10px] font-medium text-slate-400 uppercase mb-1 block">Renovation</label>
                                    <input
                                      type="number" min={0} max={entry.count} placeholder="0"
                                      className="input text-sm text-right w-full"
                                      value={(entry.unitsToRenovate ?? 0) === 0 ? '' : entry.unitsToRenovate}
                                      onChange={e => updateAcquisition('unitMix', acquisition.unitMix.map(u =>
                                        u.id === entry.id ? { ...u, unitsToRenovate: Math.min(Number(e.target.value) || 0, entry.count) } : u
                                      ))}
                                    />
                                  </div>
                                  <div>
                                    <label className="text-[10px] font-medium text-slate-400 uppercase mb-1 block">Lease-up</label>
                                    <input
                                      type="number" min={0} max={entry.count - (entry.unitsToRenovate ?? 0)} placeholder="0"
                                      className="input text-sm text-right w-full"
                                      value={(entry.leaseUpUnits ?? 0) === 0 ? '' : entry.leaseUpUnits}
                                      onChange={e => {
                                        const val = Math.min(Number(e.target.value) || 0, entry.count - (entry.unitsToRenovate ?? 0));
                                        updateAcquisition('unitMix', acquisition.unitMix.map(u =>
                                          u.id === entry.id ? { ...u, leaseUpUnits: val } : u
                                        ));
                                      }}
                                    />
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="px-4 py-3.5 flex items-center justify-between">
                            <span className="text-sm text-slate-600 dark:text-slate-300">1 unit to renovate</span>
                            <div className="flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400">
                              <span>Target</span>
                              <div className="relative">
                                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400">$</span>
                                <input
                                  type="number" min={0} placeholder="0"
                                  className="input text-sm pl-5 text-right w-28"
                                  value={(acquisition.sfrTargetRent || 0) === 0 ? '' : acquisition.sfrTargetRent}
                                  onChange={e => updateAcquisition('sfrTargetRent', Number(e.target.value))}
                                />
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Warning: value-add selected but no units assigned */}
                    {isValueAdd === true && (() => {
                      const noReno = hasMfr
                        ? acquisition.unitMix.every(e => (e.unitsToRenovate ?? 0) === 0)
                        : false; // SFR always has 1 reno unit
                      const noLU = hasMfr
                        ? acquisition.unitMix.every(e => (e.leaseUpUnits ?? 0) === 0)
                        : true;
                      return noReno && noLU ? (
                        <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800/40">
                          <AlertTriangle size={13} className="text-amber-500 mt-0.5 shrink-0" />
                          <p className="text-xs text-amber-700 dark:text-amber-400">
                            No renovation or lease-up units specified. Target rent will be used from Year 1 since there is no stabilization period.
                          </p>
                        </div>
                      ) : null;
                    })()}
                  </div>
                <div className="flex gap-3 px-4 pb-4 pt-2 border-t border-slate-100 dark:border-slate-700/60 mt-2">
                  {completedOpsSections.has('valueAdd') && (
                    <Button variant="secondary" onClick={() => setActiveOpsSection(null)}>Cancel</Button>
                  )}
                  <Button variant="primary" fullWidth={!completedOpsSections.has('valueAdd')} onClick={() => {
                    const stabDone = completedOpsSections.has('stab');
                    setCompletedOpsSections(prev => { const s = new Set(prev); s.add('valueAdd'); return s; });
                    if (isValueAdd === true && !stabDone) {
                      setActiveOpsSection('stab');
                      setCalcCollapsed(false);
                    } else {
                      setActiveOpsSection(null);
                    }
                    scheduleCalculate();
                  }}>Done</Button>
                </div>
              </motion.div>
            )}
            </AnimatePresence>

            {/* ── Section 3: Stabilization ── */}
            <AnimatePresence>
            {completedOpsSections.has('valueAdd') && isValueAdd === true && completedOpsSections.has('stab') && activeOpsSection !== 'stab' && (
              <motion.div
                key="stab-summary"
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.25, ease: 'easeOut' }}
              >
                <OpsCard num={3} title="Stabilization" summary={stabSummary} onEdit={() => { setActiveOpsSection('stab'); setCalcCollapsed(false); }} warning={valueAddIncomplete} />
              </motion.div>
            )}
            {completedOpsSections.has('valueAdd') && isValueAdd === true && activeOpsSection === 'stab' && (
              <motion.div
                key="stab-active"
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.25, ease: 'easeOut' }}
                className={card}
              >
                <OpsSectionHeader num={3} title="Stabilization" isComplete={stepComplete} />
                {/* Warning: no reno/lease-up units assigned */}
                {hasMfr && acquisition.unitMix.every(e => (e.unitsToRenovate ?? 0) === 0 && (e.leaseUpUnits ?? 0) === 0) && (
                  <div className="flex items-start gap-2 mx-4 mt-3 px-3 py-2.5 rounded-xl bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800/40">
                    <AlertTriangle size={13} className="text-amber-500 mt-0.5 shrink-0" />
                    <p className="text-xs text-amber-700 dark:text-amber-400">
                      Specify renovation or lease-up units in the Value-Add Plan to build a stabilization schedule. Target rent will be used from Year 1 until units are assigned.
                    </p>
                  </div>
                )}
                {/* Distribution/revenue-loss info row */}
                <div className="px-4 py-2 border-t border-slate-100 dark:border-slate-700/60">
                  {hasMfr ? (
                    <div className="flex flex-col gap-0.5 min-w-0">
                      <span className="text-[11px] font-medium text-slate-600 dark:text-slate-400">
                        {distributionMethod === 'weighted' ? 'Weighted distribution' : 'Custom schedule'}
                      </span>
                      <p className="text-[11px] text-slate-400 dark:text-slate-500 leading-snug">
                        {distributionMethod === 'weighted'
                          ? '20% of units in the first third · 50% at peak · 30% in the finishing stretch'
                          : 'Units renovate at a custom pace — edit schedule to adjust'}
                      </p>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="text-[11px] text-slate-500 dark:text-slate-400 shrink-0">
                        Unit offline: <span className="font-semibold text-slate-700 dark:text-slate-200">{offlinePerUnit} mo</span>
                      </span>
                      {acquisition.sfrTargetRent > 0 && offlinePerUnit > 0 && (
                        <>
                          <span className="text-slate-200 dark:text-slate-700">·</span>
                          <span className="text-[11px] text-amber-600 dark:text-amber-400 shrink-0">
                            Est. lost revenue: <span className="font-semibold">${Math.round(offlinePerUnit * acquisition.sfrTargetRent).toLocaleString()}</span>
                          </span>
                        </>
                      )}
                    </div>
                  )}
                </div>
                <div className="border-t border-slate-100 dark:border-slate-700/60 space-y-4 px-4 py-4">

                    {/* Timeline */}
                    <div className={`grid gap-4 ${someReno ? 'grid-cols-2' : 'grid-cols-1'}`}>
                      <div>
                        <label className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5 flex items-center gap-1">
                          Renovation period
                          {isVisited && stabDuration === 0 && <AlertTriangle size={12} className="text-amber-500" />}
                        </label>
                        <div className="relative">
                          <input
                            type="number" min={1} max={acquisition.projectionYears * 12} placeholder="e.g. 12"
                            className={`input text-sm pr-10 w-full ${isVisited && stabDuration === 0 ? 'border-amber-300 focus:ring-amber-400' : ''}`}
                            value={stabDuration === 0 ? '' : stabDuration}
                            onChange={e => setStabDuration(Math.min(acquisition.projectionYears * 12, Math.max(0, Number(e.target.value) || 0)))}
                          />
                          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">mo</span>
                        </div>
                      </div>
                      {someReno && (
                        <div>
                          <label className="text-xs font-medium text-slate-500 dark:text-slate-400 block mb-1.5">Reno time per unit</label>
                          <div className="relative">
                            <input
                              type="number" min={0} max={24} step={0.25} placeholder="e.g. 1"
                              className="input text-sm pr-10 w-full"
                              value={offlinePerUnit === 0 ? '' : offlinePerUnit}
                              onChange={e => setOfflinePerUnit(Math.min(24, Math.max(0, Number(e.target.value) || 0)))}
                            />
                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">mo</span>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Rent schedule — collapsed summary by default, expand to edit */}
                    {/* Summary bar — shown when collapsed */}
                    {calcCollapsed && (
                      <div className="space-y-2">
                        {/* Status + edit link */}
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <Zap size={12} className={`shrink-0 ${calcApplied ? 'text-blue-500' : calcScheduleIncomplete ? 'text-amber-500' : 'text-slate-300 dark:text-slate-600'}`} />
                            {calcApplied ? (
                              <span className="text-xs text-slate-500 dark:text-slate-400 truncate">
                                {[totalReno > 0 && `${totalReno} reno`, totalLU > 0 && `${totalLU} lease-up`].filter(Boolean).join(' · ')}
                                {' · '}{stabDuration} mo
                                <span className="text-emerald-600 dark:text-emerald-400 font-medium"> · Pro Forma updated</span>
                              </span>
                            ) : calcScheduleIncomplete ? (
                              <span className="text-xs text-amber-600 dark:text-amber-400">Some unit types need schedule update — edit to fix</span>
                            ) : stabDuration > 0 ? (
                              <span className="text-xs text-slate-400 dark:text-slate-500">Schedule auto-filled</span>
                            ) : (
                              <span className="text-xs text-slate-400 dark:text-slate-500">Set renovation period to auto-calculate</span>
                            )}
                          </div>
                          <div className="shrink-0 flex items-center gap-2">
                            {calcApplied && (
                              <button
                                type="button"
                                onClick={() => {
                                  setCalcState(undefined);
                                  setCalcKey(k => k + 1);
                                  setProForma(prev => {
                                    const ovs = { ...(prev.yearOverrides ?? {}) };
                                    for (let y = 1; y <= acquisition.projectionYears; y++) {
                                      if (ovs[y]) {
                                        const { grossRent: _r, grossRentSystem: _s, ...rest } = ovs[y];
                                        if (Object.keys(rest).length > 0) ovs[y] = rest; else delete ovs[y];
                                      }
                                    }
                                    return { ...prev, yearOverrides: ovs };
                                  });
                                  if (hasMfr) updateAcquisition('unitMix', acquisition.unitMix.map(u => ({ ...u, preStabRent: 0 })));
                                  else updateAcquisition('sfrPreStabRent', 0);
                                }}
                                className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors touch-manipulation"
                              >
                                <X size={11} />
                                Use target rent
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => { setCalcCollapsed(false); setPreStabMethod('calculator'); }}
                              className="flex items-center gap-1 text-xs font-medium text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 transition-colors touch-manipulation"
                            >
                              <Pencil size={11} />
                              Edit schedule
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Calculator — always mounted so auto-fill runs even when collapsed */}
                    <div className={calcCollapsed ? 'hidden' : 'rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden -mx-4'}>
                      <RehabRentCalculator
                          key={calcKey}
                          hideHeader={false}
                          unitTypes={unitTypes}
                          projectionYears={acquisition.projectionYears}
                          appliedYears={calcAppliedYears}
                          grossRentGrowthPct={proForma.grossRent.growthPct}
                          externalDuration={stabDuration}
                          externalOffline={offlinePerUnit}
                          externalUnitsToStabilize={unitsToRenovateMemo}
                          externalLeaseUpToStabilize={leaseUpUnitsArrMemo}
                          onOpenChange={v => { if (!v) setCalcCollapsed(true); }}
                          initialState={calcState}
                          externalDistributionMethod={distributionMethod}
                          onStateChange={s => { setCalcState(s); if (s.distributionMethod && s.distributionMethod !== distributionMethod) setDistributionMethod(s.distributionMethod); }}
                          onApplyRents={rents => {
                            if (hasMfr) updateAcquisition('unitMix', acquisition.unitMix.map((u, i) => ({
                              ...u, inPlaceRent: rents[i]?.inPlace ?? u.inPlaceRent, rentMonthly: rents[i]?.target ?? u.rentMonthly,
                            })));
                            else {
                              updateAcquisition('sfrInPlaceRent', rents[0]?.inPlace ?? acquisition.sfrInPlaceRent);
                              updateAcquisition('sfrTargetRent',  rents[0]?.target  ?? acquisition.sfrTargetRent);
                            }
                          }}
                          onApplyPreStab={values => {
                            if (hasMfr) updateAcquisition('unitMix', acquisition.unitMix.map((u, i) => ({ ...u, preStabRent: Math.round(values[i] ?? 0) })));
                            else updateAcquisition('sfrPreStabRent', Math.round(values[0] ?? 0));
                          }}
                          onApply={overrides => {
                            setProForma(prev => {
                              const ovs = { ...(prev.yearOverrides ?? {}) };
                              Object.entries(overrides).forEach(([yr, rent]) => {
                                const y = Number(yr);
                                // Skip years the user has manually overridden (grossRentSystem===false)
                                if (ovs[y]?.grossRentSystem === false) return;
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
                                  const { grossRent: _r, grossRentSystem: _s, ...rest } = ovs[y];
                                  if (Object.keys(rest).length > 0) ovs[y] = rest; else delete ovs[y];
                                }
                              }
                              return { ...prev, yearOverrides: ovs };
                            });
                            if (hasMfr) updateAcquisition('unitMix', acquisition.unitMix.map(u => ({ ...u, preStabRent: 0 })));
                            else updateAcquisition('sfrPreStabRent', 0);
                          }}
                        />
                    </div>

                    {/* Schedule incomplete notice */}
                    {isVisited && calcScheduleIncomplete && (
                      <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800/40">
                        <AlertTriangle size={13} className="text-amber-500 mt-0.5 shrink-0" />
                        <p className="text-xs text-amber-700 dark:text-amber-400">
                          Complete the schedule for all renovation and lease-up units — it's needed to calculate rent for the Pro Forma.
                        </p>
                      </div>
                    )}


                </div>
                <div className="flex gap-3 px-4 pb-4 pt-2 border-t border-slate-100 dark:border-slate-700/60 mt-2">
                  {completedOpsSections.has('stab') && (
                    <Button variant="secondary" onClick={() => setActiveOpsSection(null)}>Cancel</Button>
                  )}
                  <Button variant="primary" fullWidth={!completedOpsSections.has('stab')} onClick={() => {
                    setCompletedOpsSections(prev => { const s = new Set(prev); s.add('stab'); return s; });
                    setActiveOpsSection(null);
                    scheduleCalculate();
                  }}>Done</Button>
                </div>
              </motion.div>
            )}
            </AnimatePresence>

            {/* Value-add incomplete warning */}
            {valueAddIncomplete && (
              <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800/40">
                <AlertTriangle size={13} className="text-amber-500 mt-0.5 shrink-0" />
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  Value-add plan incomplete. Target rent will be used in Pro Forma for Year 1.
                </p>
              </div>
            )}

            {/* ── Pro Forma ── */}
            <ProFormaGrid
              data={proForma}
              onChange={setProForma}
              projectionYears={acquisition.projectionYears}
              showWarnings={isVisited}
              units={acquisition.propertyType === 'mfr' ? (acquisition.unitMix.length > 0 ? acquisition.unitMix.reduce((s, e) => s + e.count, 0) : acquisition.units) : 1}
              purchasePrice={acquisition.purchasePrice}
            />

            {/* ── Notes ── */}
            <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
              <button
                type="button"
                onClick={() => setOpsNotesOpen(v => !v)}
                className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <span className="relative">
                    <FileText size={14} className="text-slate-400" />
                    {opsNotes.trim() && <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-primary-500" />}
                  </span>
                  <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">Notes</span>
                  {!opsNotesOpen && opsNotes.trim() && (
                    <span className="text-xs text-slate-400 dark:text-slate-500 truncate max-w-[200px]">{opsNotes.split('\n')[0]}</span>
                  )}
                </div>
                {opsNotesOpen ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
              </button>
              {opsNotesOpen && (
                <div className="px-4 pb-3">
                  <textarea
                    value={opsNotes}
                    onChange={e => setOpsNotes(e.target.value)}
                    placeholder="Add notes about this deal's operations, assumptions, or things to verify…"
                    rows={4}
                    className="w-full text-sm text-slate-700 dark:text-slate-200 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 resize-y placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-primary-400"
                  />
                </div>
              )}
            </div>

          </div>
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
            computedRefiValue={computedRefiValue}
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
          (method !== 'capRate' && !refinance.refiMarketValue) ||
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

  // When exit method is cap rate, derive refi property value from the projection's NOI at refi year
  const computedRefiValue: number | null = (() => {
    if ((acquisition.exitMethod ?? 'value') !== 'capRate') return null;
    if (!acquisition.exitCapRate || !refinance.refiYear) return null;
    const noi = currentResult?.yearlyProjections?.[refinance.refiYear - 1]?.noi;
    if (!noi || noi <= 0) return null;
    return Math.round(noi / (acquisition.exitCapRate / 100));
  })();
  const hasAddress = acquisition.propertyAddress.trim().length > 0;
  const hasNewDealData = !savedDealId && (hasAddress || acquisition.purchasePrice > 0);
  const allStepsCompleted = [0, 1, 2, 3, 4].every(id => completedSteps.has(id));
  const hasAnyWarning = [0, 1, 2, 3, 4].some(id => getStepWarning(id) !== null);

  // ── Render ──

  return (
    <div className="min-h-screen pb-48 lg:pb-36">
      <div className="max-w-4xl mx-auto px-4 py-6 space-y-5">

        {/* Header: title + always-visible Cancel / Next / Save */}
        <div className="flex items-center justify-between gap-4">
          {editingTitle ? (
            <div className="flex items-center gap-1.5 flex-1 min-w-0">
              <input
                autoFocus
                type="text"
                value={saveName}
                onChange={e => setSaveName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    const name = saveName.trim() || defaultSaveName(acquisition);
                    setSaveName(name);
                    setEditingTitle(false);
                    if (savedDealId) updateSavedDeal(savedDealId, name, scenarioResults);
                  }
                  if (e.key === 'Escape') { setSaveName(titleBeforeEdit.current); setEditingTitle(false); }
                }}
                className="flex-1 text-lg font-semibold bg-transparent border-b-2 border-primary-500 outline-none text-slate-900 dark:text-white min-w-0"
              />
              <button
                type="button"
                onClick={() => {
                  const name = saveName.trim() || defaultSaveName(acquisition);
                  setSaveName(name);
                  setEditingTitle(false);
                  if (savedDealId) updateSavedDeal(savedDealId, name, scenarioResults);
                }}
                className="p-1 rounded-full hover:bg-emerald-100 dark:hover:bg-emerald-900/30 text-emerald-500 transition-colors shrink-0"
                title="Confirm"
              >
                <Check size={16} />
              </button>
              <button
                type="button"
                onClick={() => { setSaveName(titleBeforeEdit.current); setEditingTitle(false); }}
                className="p-1 rounded-full hover:bg-red-100 dark:hover:bg-red-900/30 text-red-400 transition-colors shrink-0"
                title="Cancel"
              >
                <X size={16} />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => { const current = saveName || acquisition.propertyAddress.trim() || defaultSaveName(acquisition); if (!saveName) setSaveName(current); titleBeforeEdit.current = current; setEditingTitle(true); }}
              className="group flex items-center gap-1.5 min-w-0 text-left"
              title="Click to rename"
            >
              <h1 className="text-lg font-semibold text-slate-900 dark:text-white truncate">
                {saveName || acquisition.propertyAddress.trim() || 'New Analysis'}
              </h1>
              <Pencil size={13} className="shrink-0 text-slate-300 dark:text-slate-600 group-hover:text-primary-500 transition-colors" />
            </button>
          )}

          <div className="flex items-center gap-2 shrink-0">
            {saveError && (
              <span className="text-xs text-red-600 dark:text-red-400 max-w-[160px] text-right leading-tight">
                {saveError}
              </span>
            )}
            {savedDealId && <ShareButton dealId={savedDealId} />}
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
                    {/* Completed summary card */}
                    {isCompleted && !isEditing && (() => {
                      const warning = getStepWarning(step.id);
                      const infoAmber = step.id === 3 && isValueAdd === true && !(
                        (acquisition.propertyType === 'mfr' && acquisition.unitMix.length > 0)
                          ? acquisition.unitMix.some(e => (e.unitsToRenovate ?? 0) > 0 || (e.leaseUpUnits ?? 0) > 0)
                          : true
                      );
                      const style = STEP_CARD_STYLE;
                      const { primary, primaryExtra, sub } = getStepCardData(step.id, acquisition, proForma, refinance, currentResult);
                      return (
                        <button
                          type="button"
                          data-testid={`step-summary-${step.id}`}
                          onClick={() => { setPausedActiveStep(activeStep); setEditingStep(step.id); }}
                          className={`w-full flex items-stretch rounded-xl overflow-hidden border transition-all text-left group ${
                            warning
                              ? 'border-amber-300 dark:border-amber-700 hover:border-amber-400'
                              : `${style.border} hover:border-primary-300 dark:hover:border-primary-500`
                          } ${style.bg}`}
                        >
                          {/* Icon zone */}
                          <div className={`flex items-center justify-center px-4 ${style.iconColor}`}>
                            {STEP_ICONS[step.id]}
                          </div>

                          {/* Divider */}
                          <div className="w-px bg-slate-200 dark:bg-slate-700/60 self-stretch" />

                          {/* Content */}
                          <div className="flex-1 px-4 py-3 min-w-0">
                            <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-0.5">
                              {step.label}
                            </p>
                            <div className="flex items-baseline gap-2 flex-wrap">
                              <p className={`font-bold text-slate-900 dark:text-white leading-tight truncate ${
                                step.id === 0 ? 'text-sm' : 'text-lg'
                              }`}>
                                {primary}
                              </p>
                              {primaryExtra && (
                                <p className="text-base font-semibold text-slate-500 dark:text-slate-400 shrink-0">
                                  {primaryExtra}
                                </p>
                              )}
                            </div>
                            {sub && (
                              <p className="text-[10px] text-slate-400 dark:text-slate-500 uppercase tracking-wide mt-0.5 truncate">
                                {sub}
                              </p>
                            )}
                          </div>

                          {/* Right action */}
                          <div className="flex items-center px-3 shrink-0">
                            {warning ? (
                              <span
                                data-testid={`step-warning-${step.id}`}
                                className="text-amber-500 dark:text-amber-400"
                              >
                                <AlertTriangle size={14} />
                              </span>
                            ) : (
                              <div className="flex items-center gap-1.5">
                                {infoAmber && <AlertTriangle size={12} className="text-amber-400 dark:text-amber-500" />}
                                <Pencil size={13} className="text-slate-300 dark:text-slate-600 group-hover:text-primary-500 transition-colors" />
                              </div>
                            )}
                          </div>
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
                <div className="text-center space-y-1" data-testid="calc-missing-fields-msg">
                  <p className="text-sm text-amber-600 dark:text-amber-400">
                    Fill in the highlighted fields to see your returns
                  </p>
                  <p className="text-xs text-slate-400 dark:text-slate-500">
                    or{' '}
                    <button type="button" onClick={onBack} className="text-primary-500 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300 font-medium transition-colors">
                      return to dashboard
                    </button>
                    {' '}to fill in the data later
                  </p>
                </div>
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

            {hasAnyResult && resultsStale && calcPhase === 'idle' && (
              <div className="text-center space-y-3 py-6">
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  Your inputs have changed since the last calculation
                </p>
                <Button variant="primary" onClick={handleCalculate}>
                  <RotateCcw size={15} className="mr-2" />
                  Refresh your returns
                </Button>
              </div>
            )}

            {hasAnyResult && !resultsStale && (
              <>
                {hasAnyWarning && calcPhase === 'idle' && (
                  <p className="text-center text-sm text-amber-600 dark:text-amber-400" data-testid="calc-incomplete-warning">
                    Some fields are missing — results may be incomplete
                  </p>
                )}
                <div style={calcPhase === 'idle' || calcPhase === 'done' ? { animation: 'fade-in 0.6s ease-out' } : undefined}>
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
                    mcSimRunRef={mcSimRunRef}
                    calcPhase={calcPhase}
                  />
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* ── Fixed bottom bar — always visible ── */}
      {!currentResult && (
        <div className="fixed bottom-[60px] lg:bottom-0 left-0 right-0 z-50 bg-white dark:bg-slate-800 border-t border-slate-200 dark:border-slate-700 shadow-[0_-4px_16px_rgba(0,0,0,0.06)]">
          <div className="max-w-4xl mx-auto px-3 py-3 flex items-center justify-between" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
            <div className="flex items-center gap-2 min-w-0">
              {saveStatus === 'saved' ? (
                <span className="flex items-center gap-1 text-xs text-secondary-600 dark:text-secondary-400 font-medium animate-fade-in">
                  <Check size={12} /> Saved
                </span>
              ) : (
                <p className="text-xs text-slate-400 dark:text-slate-500">
                  Click <span className="font-semibold text-slate-500 dark:text-slate-400">Done</span> on each step to save your progress
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={onBack}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400 text-xs font-semibold hover:bg-primary-100 dark:hover:bg-primary-900/50 transition-colors shrink-0"
            >
              ← Dashboard
            </button>
          </div>
        </div>
      )}
      {currentResult && (() => {
        const projs = currentResult.yearlyProjections;
        const avgMoCF = projs.length > 0 ? projs.reduce((s, p) => s + p.cashFlow, 0) / projs.length / 12 : 0;
        const fmt = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

        // Most likely = p50 from simulation if available, otherwise null (hidden)
        const p50 = mcResults ? mcResults.p50 : null;
        const mlIRR   = p50 ? p50.irr : null;
        const mlCoC   = p50 ? p50.avgCoCReturn : null;
        const mlEM    = p50 ? p50.equityMultiple : null;
        const mlMoCF  = p50 ? p50.totalCashFlow / projs.length / 12 : null;
        const hasML   = p50 !== null;

        return (
          <div className="fixed bottom-[60px] lg:bottom-0 left-0 right-0 z-50 bg-white dark:bg-slate-800 border-t border-slate-200 dark:border-slate-700 shadow-[0_-4px_16px_rgba(0,0,0,0.06)]">
            <div className="max-w-4xl mx-auto px-3 pt-2.5" style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}>
              {resultsStale && calcPhase === 'idle' ? (
                <div className="flex items-center justify-between py-1">
                  <p className="text-xs text-amber-600 dark:text-amber-400 font-medium">Inputs changed — results may be outdated</p>
                  <button type="button" onClick={handleCalculate}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary-600 text-white text-xs font-semibold hover:bg-primary-700 transition-colors shrink-0">
                    <RotateCcw size={12} /> Refresh
                  </button>
                </div>
              ) : calcPhase !== 'idle' && calcPhase !== 'done' ? (
                <div className="flex items-center gap-2 py-1">
                  <svg className="w-4 h-4 text-primary-500 shrink-0 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                  </svg>
                  <p className="text-xs font-medium text-primary-600 dark:text-primary-400">
                    {calcPhase === 'returns' ? 'Calculating returns…' : 'Analyzing market uncertainty…'}
                  </p>
                </div>
              ) : (
              <>
              <div className="flex items-start justify-center lg:justify-between gap-3">

                {/* Metrics */}
                <div className="flex items-start w-full lg:w-auto gap-0 lg:gap-3">

                  {/* IRR */}
                  <div className="flex flex-col flex-1 lg:flex-none lg:shrink-0 items-center lg:items-start">
                    <p className="text-[9px] font-medium text-slate-400 dark:text-slate-500 uppercase tracking-wide">IRR</p>
                    <p className={`text-[13px] font-bold tabular-nums leading-tight ${currentResult.irr == null ? 'text-slate-400' : currentResult.irr >= 8 ? 'text-secondary-600 dark:text-secondary-400' : currentResult.irr < 0 ? 'text-red-500' : 'text-slate-700 dark:text-slate-300'}`}>
                      {currentResult.irr == null ? '—' : `${currentResult.irr.toFixed(2)}%`}
                      {hasML && mlIRR != null && <span className="lg:hidden text-[10px] font-normal text-slate-400 dark:text-slate-500 ml-0.5">{`(${mlIRR.toFixed(2)}%)`}</span>}
                    </p>
                    {hasML && mlIRR != null && <p className="hidden lg:block text-[9px] tabular-nums text-slate-400 dark:text-slate-500">{`(${mlIRR.toFixed(2)}%)`}</p>}
                  </div>

                  <div className="w-px bg-slate-200 dark:bg-slate-700 shrink-0 self-stretch" />

                  {/* Avg CoC */}
                  <div className="flex flex-col flex-1 lg:flex-none lg:shrink-0 items-center lg:items-start">
                    <p className="text-[9px] font-medium text-slate-400 dark:text-slate-500 uppercase tracking-wide">Avg CoC</p>
                    <p className={`text-[13px] font-bold tabular-nums leading-tight ${currentResult.avgCoCReturn >= 6 ? 'text-secondary-600 dark:text-secondary-400' : currentResult.avgCoCReturn < 0 ? 'text-red-500' : 'text-slate-700 dark:text-slate-300'}`}>
                      {currentResult.avgCoCReturn.toFixed(2)}%
                      {hasML && mlCoC != null && <span className="lg:hidden text-[10px] font-normal text-slate-400 dark:text-slate-500 ml-0.5">{`(${mlCoC.toFixed(2)}%)`}</span>}
                    </p>
                    {hasML && mlCoC != null && <p className="hidden lg:block text-[9px] tabular-nums text-slate-400 dark:text-slate-500">{`(${mlCoC.toFixed(2)}%)`}</p>}
                  </div>

                  <div className="w-px bg-slate-200 dark:bg-slate-700 shrink-0 self-stretch" />

                  {/* Equity Multiple */}
                  <div className="flex flex-col flex-1 lg:flex-none lg:shrink-0 items-center lg:items-start">
                    <p className="text-[9px] font-medium text-slate-400 dark:text-slate-500 uppercase tracking-wide">Equity ×</p>
                    <p className={`text-[13px] font-bold tabular-nums leading-tight ${currentResult.equityMultiple >= 1.5 ? 'text-primary-600 dark:text-primary-400' : currentResult.equityMultiple < 1 ? 'text-red-500' : 'text-slate-700 dark:text-slate-300'}`}>
                      {currentResult.equityMultiple.toFixed(2)}×
                      {hasML && mlEM != null && <span className="lg:hidden text-[10px] font-normal text-slate-400 dark:text-slate-500 ml-0.5">{`(${mlEM.toFixed(2)}×)`}</span>}
                    </p>
                    {hasML && mlEM != null && <p className="hidden lg:block text-[9px] tabular-nums text-slate-400 dark:text-slate-500">{`(${mlEM.toFixed(2)}×)`}</p>}
                  </div>

                  <div className="w-px bg-slate-200 dark:bg-slate-700 shrink-0 self-stretch hidden sm:block" />

                  {/* Avg Mo. CF — hidden on mobile */}
                  <div className="hidden sm:flex flex-col flex-1 lg:flex-none lg:shrink-0 items-center lg:items-start">
                    <p className="text-[9px] font-medium text-slate-400 dark:text-slate-500 uppercase tracking-wide">Avg Mo. CF</p>
                    <p className={`text-[13px] font-bold tabular-nums leading-tight ${avgMoCF >= 0 ? 'text-secondary-600 dark:text-secondary-400' : 'text-red-500'}`}>
                      {fmt(avgMoCF)}
                      {hasML && mlMoCF != null && <span className="lg:hidden text-[10px] font-normal text-slate-400 dark:text-slate-500 ml-0.5">{`(${fmt(mlMoCF)})`}</span>}
                    </p>
                    {hasML && mlMoCF != null && <p className="hidden lg:block text-[9px] tabular-nums text-slate-400 dark:text-slate-500">{`(${fmt(mlMoCF)})`}</p>}
                  </div>

                </div>

                {/* Dashboard link — desktop only, mobile has nav bar below */}
                <button
                  type="button"
                  onClick={onBack}
                  className="hidden lg:flex items-center gap-1.5 px-3 py-2 rounded-xl bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400 text-xs font-semibold hover:bg-primary-100 dark:hover:bg-primary-900/50 transition-colors shrink-0 whitespace-nowrap"
                >
                  ← Dashboard
                </button>
              </div>

              {hasML && (
                <p className="text-[7px] text-slate-400 dark:text-slate-500 mt-0.5">( ) = most likely accounting for market uncertainty</p>
              )}
              </>
              )}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
