'use client';

import { useState, useRef, useCallback, cloneElement, useEffect, Fragment } from 'react';
import { flushSync } from 'react-dom';
import { Plus, X, RotateCcw, ChevronLeft, ChevronRight, TrendingUp, AlertTriangle, Link2, Unlink } from 'lucide-react';
import type { ProFormaData, ProFormaItem } from '@/types';
import { computeEGI } from '@/utils/dealAnalyzerCalc';
import { makeChainedValue, makeChainedExpenseValue } from '@/utils/proFormaChaining';

// ── Expenses that must keep their type (no $ ↔ % toggle allowed) ─────────────

const NON_TOGGLEABLE_EXPENSES = new Set(['Insurance', 'Property Taxes']);

// ── Preset expense templates ──────────────────────────────────────────────────

const SFR_PRESETS: Omit<ProFormaItem, 'id'>[] = [
  { name: 'Property Taxes',        isPercentOfEGI: false, t12Value: 0, stabValue: null, stabilizedValue: 0, growthPct: 2 },
  { name: 'Insurance',             isPercentOfEGI: false, t12Value: 0, stabValue: null, stabilizedValue: 0, growthPct: 2 },
  { name: 'Maintenance & Repairs', isPercentOfEGI: true,  t12Value: 5, stabValue: null, stabilizedValue: 5, growthPct: 0 },
  { name: 'CapEx Reserves',        isPercentOfEGI: false, t12Value: 0, stabValue: null, stabilizedValue: 0, growthPct: 0 },
  { name: 'Property Management',   isPercentOfEGI: true,  t12Value: 8, stabValue: null, stabilizedValue: 8, growthPct: 0 },
];

const MFR_PRESETS: Omit<ProFormaItem, 'id'>[] = [
  { name: 'Property Taxes',        isPercentOfEGI: false, t12Value: 0, stabValue: null, stabilizedValue: 0, growthPct: 2 },
  { name: 'Insurance',             isPercentOfEGI: false, t12Value: 0, stabValue: null, stabilizedValue: 0, growthPct: 2 },
  { name: 'Common Area Utilities', isPercentOfEGI: false, t12Value: 0, stabValue: null, stabilizedValue: 0, growthPct: 3 },
  { name: 'Landscaping',           isPercentOfEGI: false, t12Value: 0, stabValue: null, stabilizedValue: 0, growthPct: 2 },
  { name: 'Trash Removal',         isPercentOfEGI: false, t12Value: 0, stabValue: null, stabilizedValue: 0, growthPct: 2 },
  { name: 'Maintenance & Repairs', isPercentOfEGI: true,  t12Value: 5, stabValue: null, stabilizedValue: 5, growthPct: 0 },
  { name: 'CapEx Reserves',        isPercentOfEGI: false, t12Value: 0, stabValue: null, stabilizedValue: 0, growthPct: 0 },
  { name: 'Property Management',   isPercentOfEGI: true,  t12Value: 8, stabValue: null, stabilizedValue: 8, growthPct: 0 },
];

export interface ProFormaDefaults {
  propertyMgmtPct: number;
  capExPerUnit: number;
  maintenancePct: number;
  units: number;
}

export function defaultProForma(propertyType: 'sfr' | 'mfr', defaults?: Partial<ProFormaDefaults>): ProFormaData {
  const presets = propertyType === 'mfr' ? MFR_PRESETS : SFR_PRESETS;
  const expenses = presets.map((p, i) => {
    const e = { ...p, id: `preset-${i}` };
    if (defaults?.propertyMgmtPct !== undefined && e.name === 'Property Management') {
      e.stabilizedValue = defaults.propertyMgmtPct;
    }
    if (defaults?.capExPerUnit !== undefined && defaults?.units !== undefined && e.name === 'CapEx Reserves') {
      e.stabilizedValue = defaults.capExPerUnit * defaults.units;
    }
    if (defaults?.maintenancePct !== undefined && e.name === 'Maintenance & Repairs') {
      e.stabilizedValue = defaults.maintenancePct;
    }
    return e;
  });
  return {
    grossRent:     { t12: 0, stab: null, stabilized: 0, growthPct: 3 },
    otherIncome:   { t12: 0, stab: null, stabilized: 0, growthPct: 2 },
    vacancyPct:    { t12: 5, stab: null, stabilized: 5 },
    creditLossPct: { t12: 0, stab: null, stabilized: 0 },
    expenses,
    yearOverrides: {},
  };
}

// ── Column type ───────────────────────────────────────────────────────────────

type Col = { type: 't12' } | { type: 'year'; year: number };

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt$(n: number): string {
  const v = n ?? 0;
  return v === 0 ? '—' : `$${Math.round(v).toLocaleString()}`;
}
function fmtPct(n: number): string { return `${(n ?? 0).toFixed(2)}%`; }
function uid(): string { return Math.random().toString(36).slice(2, 9); }


// ── Sticky label ──────────────────────────────────────────────────────────────

const STICKY = 'sticky left-0 z-10 bg-white dark:bg-slate-800 shadow-[1px_0_0_0_theme(colors.slate.200)] dark:shadow-[1px_0_0_0_theme(colors.slate.700)]';
const STICKY_HOVER = 'group-hover:bg-slate-50 dark:group-hover:bg-slate-700/40';
const STICKY_MUTED = 'bg-slate-50 dark:bg-slate-700/30 shadow-[1px_0_0_0_theme(colors.slate.200)] dark:shadow-[1px_0_0_0_theme(colors.slate.700)]';
const STICKY_HIGHLIGHT = 'bg-primary-50 dark:bg-primary-900/20 shadow-[1px_0_0_0_theme(colors.primary.100)] dark:shadow-[1px_0_0_0_theme(colors.primary.800/40)]';

// ── Cell ──────────────────────────────────────────────────────────────────────

function Cell({ value, onChange, format, onCommit, isOverridden }: {
  value: number; onChange: (v: number) => void; format: 'currency' | 'percent' | 'growthPct';
  onCommit?: (v: number) => void;
  isOverridden?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const display = format === 'currency' ? fmt$(value) : format === 'growthPct' ? `${value.toFixed(2)}%` : fmtPct(value);
  const start = () => { setDraft(value === 0 ? '' : String(value)); setEditing(true); setTimeout(() => inputRef.current?.select(), 0); };
  const commit = () => {
    const p = parseFloat(draft.replace(/[$,\s]/g, ''));
    const v = isNaN(p) ? 0 : p;
    if (onCommit) { onCommit(v); } else { flushSync(() => onChange(v)); }
    setEditing(false);
  };
  const color = value === 0 ? 'text-slate-300 dark:text-slate-600' : 'text-slate-800 dark:text-slate-200';

  if (editing) return (
    <div className="flex items-center gap-0.5">
      <input ref={inputRef} className="text-sm tabular-nums text-right font-medium text-slate-800 dark:text-slate-200 bg-transparent w-full border-none outline-none ring-0 p-0" value={draft} onChange={e => setDraft(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } if (e.key === 'Escape') { setEditing(false); } }} />
    </div>
  );
  return (
    <div className="flex items-center gap-0.5 group/cell">
      <button onClick={start} className={`text-sm tabular-nums text-right font-medium w-full hover:text-primary-600 dark:hover:text-primary-400 cursor-text touch-manipulation ${color}`}>{display}</button>
    </div>
  );
}

// ── YearCell ──────────────────────────────────────────────────────────────────

function YearCell({ computed, override, format, onOverride, onClearOverride, onYearOnly, cascadeDelay, pushToFutureOff }: {
  computed: number;
  override: number | undefined;
  format: 'currency' | 'percent' | 'growthPct';
  onOverride: (v: number) => void;
  onClearOverride?: () => void;
  onYearOnly?: (v: number) => void;
  cascadeDelay?: number; // ms — staggered wave animation delay
  pushToFutureOff?: boolean; // persisted toggle state
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [pushToFuture, setPushToFuture] = useState(true);
  const [cascading, setCascading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const prevComputedRef = useRef(computed);

  const isFixed = override !== undefined && override !== computed;
  const val = isFixed ? override : computed;
  const display = format === 'currency' ? fmt$(val) : format === 'growthPct' ? `${val.toFixed(2)}%` : fmtPct(val);

  // Staggered cascade flash — fires when formula value changes while cell is in Flow state
  useEffect(() => {
    if (isFixed || editing) { prevComputedRef.current = computed; return; }
    if (prevComputedRef.current !== computed) {
      prevComputedRef.current = computed;
      const delay = cascadeDelay ?? 0;
      const t1 = setTimeout(() => setCascading(true), delay);
      const t2 = setTimeout(() => setCascading(false), delay + 400);
      return () => { clearTimeout(t1); clearTimeout(t2); };
    }
  }, [computed, isFixed, editing]);

  const start = () => {
    setDraft(val === 0 ? '' : String(val));
    setPushToFuture(!pushToFutureOff);
    setEditing(true);
    setTimeout(() => inputRef.current?.select(), 0);
  };

  const commit = () => {
    const p = parseFloat(draft.replace(/[$,\s]/g, ''));
    if (!isNaN(p)) {
      if (p === computed && onClearOverride) { onClearOverride(); }
      else if (!pushToFuture && onYearOnly) { onYearOnly(p); }
      else { onOverride(p); }
    }
    setEditing(false);
  };

  // ── Editing state ──
  if (editing) return (
    <div className="flex flex-col items-end gap-1">
      <input
        ref={inputRef}
        className="text-sm tabular-nums text-right font-semibold text-slate-900 dark:text-slate-100 bg-transparent w-full border-none outline-none ring-0 p-0"
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } if (e.key === 'Escape') setEditing(false); }}
        autoFocus
      />
      {onYearOnly && (
        <div className="flex items-center justify-end gap-1.5 w-full pt-1 border-t border-slate-100 dark:border-slate-700">
          <span className="text-[9px] text-slate-400 dark:text-slate-500">Push to future</span>
          <button
            type="button"
            onMouseDown={e => { e.preventDefault(); setPushToFuture(v => !v); }}
            className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors duration-200 ${pushToFuture ? 'bg-primary-500' : 'bg-slate-300 dark:bg-slate-600'}`}
          >
            <span className={`inline-block h-3 w-3 rounded-full bg-white shadow-sm transition-transform duration-200 ${pushToFuture ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
          </button>
        </div>
      )}
    </div>
  );

  // ── Fixed state (manual override) ──
  if (isFixed) return (
    <div className="group/fixed flex items-center justify-end gap-0.5">
      {onClearOverride && (
        <button
          type="button"
          onClick={e => { e.stopPropagation(); onClearOverride(); }}
          title="Resume flow"
          className="opacity-0 group-hover/fixed:opacity-100 transition-opacity shrink-0 p-0.5 rounded text-slate-400 hover:text-primary-500 dark:hover:text-primary-400"
        >
          <RotateCcw size={9} />
        </button>
      )}
      <button
        onClick={start}
        className="text-sm tabular-nums text-right font-semibold cursor-text text-slate-900 dark:text-slate-100 ring-1 ring-slate-300 dark:ring-slate-500 rounded px-1 hover:ring-primary-400 dark:hover:ring-primary-500 transition-all"
      >
        {display}
      </button>
    </div>
  );

  // ── Flow state (formula / inherited) ──
  return (
    <div className="flex items-center justify-end">
      <button
        onClick={start}
        className={`text-sm tabular-nums text-right font-normal w-full cursor-text border-b border-dashed transition-colors duration-300 ${
          cascading
            ? 'text-primary-500 dark:text-primary-400 border-primary-300 dark:border-primary-600'
            : val === 0
            ? 'text-slate-300 dark:text-slate-600 border-slate-200 dark:border-slate-700 hover:text-slate-500'
            : 'text-slate-400 dark:text-slate-500 border-slate-200 dark:border-slate-700 hover:text-slate-700 dark:hover:text-slate-300'
        }`}
      >
        {display}
      </button>
    </div>
  );
}

// ── StabilizingCell ───────────────────────────────────────────────────────────

function StabilizingCell({ value, anticipated, onClearOverride, onOverride }: {
  value: number; anticipated: number; onClearOverride: () => void; onOverride: (v: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const pct = anticipated > 0 ? Math.min(100, Math.round((value / anticipated) * 100)) : 0;
  const start = () => { setDraft(value === 0 ? '' : String(value)); setEditing(true); setTimeout(() => inputRef.current?.select(), 0); };
  const commit = () => { const p = parseFloat(draft.replace(/[$,\s]/g, '')); if (!isNaN(p)) onOverride(p); setEditing(false); };

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center justify-end gap-1 w-full group/sc">
        <TrendingUp size={10} className="text-amber-400 dark:text-amber-500 shrink-0" />
        {editing
          ? <>
              <input ref={inputRef} autoFocus className="text-sm tabular-nums text-right font-medium text-amber-600 dark:text-amber-400 bg-transparent w-full border-none outline-none ring-0 p-0" value={draft} onChange={e => setDraft(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } if (e.key === 'Escape') setEditing(false); }} />
              <button type="button" onClick={e => { e.stopPropagation(); onClearOverride(); }} title="Reset to formula"
                className="p-1 rounded text-primary-500 bg-primary-50 dark:bg-primary-900/40 hover:bg-primary-100 transition-all shrink-0">
                <RotateCcw size={10} />
              </button>
            </>
          : <>
              <button onClick={start} className="text-sm tabular-nums text-right font-medium text-amber-600 dark:text-amber-400 hover:text-amber-700 dark:hover:text-amber-300 w-full cursor-text">{fmt$(value)}</button>
              <button type="button" onClick={e => { e.stopPropagation(); onClearOverride(); }} title="Reset to formula"
                className="p-1 rounded text-primary-500 bg-primary-50 dark:bg-primary-900/40 hover:bg-primary-100 transition-all hidden group-hover/sc:flex shrink-0">
                <RotateCcw size={10} />
              </button>
            </>
        }
      </div>
      <div className="w-full flex items-center gap-1">
        <div className="flex-1 h-1 rounded-full bg-slate-200 dark:bg-slate-600 overflow-hidden">
          <div className="h-full rounded-full bg-amber-400 dark:bg-amber-500 transition-all" style={{ width: `${pct}%` }} />
        </div>
        <span className="text-[9px] tabular-nums text-amber-500 dark:text-amber-400 shrink-0">{pct}%</span>
      </div>
    </div>
  );
}

// ── LabelCell ─────────────────────────────────────────────────────────────────

function LabelCell({ value, onChange, placeholder = 'Expense name', autoFocus }: {
  value: string; onChange: (v: string) => void; placeholder?: string; autoFocus?: boolean;
}) {
  const [editing, setEditing] = useState(!!autoFocus);
  const [draft, setDraft] = useState(value);
  const commit = () => { onChange(draft.trim() || value); setEditing(false); };
  if (editing) return <input autoFocus={autoFocus} className="text-sm font-medium text-slate-800 dark:text-slate-200 bg-transparent border-none outline-none ring-0 p-0 w-full" value={draft} placeholder={placeholder} onChange={e => setDraft(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } if (e.key === 'Escape') { setDraft(value); setEditing(false); } }} />;
  return <button onClick={() => { setDraft(value); setEditing(true); }} className="text-sm font-medium text-slate-700 dark:text-slate-300 text-left w-full hover:text-primary-600 dark:hover:text-primary-400 cursor-text truncate">{value || <span className="text-slate-400">{placeholder}</span>}</button>;
}

// ── SectionRow ────────────────────────────────────────────────────────────────

function SectionRow({ label, span }: { label: string; span: number }) {
  return (
    <tr>
      <td colSpan={span} className="px-3 pt-4 pb-1 bg-white dark:bg-slate-800 sticky left-0 z-10">
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">{label}</p>
      </td>
    </tr>
  );
}

// ── ChainConnector ────────────────────────────────────────────────────────────

function ChainConnector({ broken }: { broken: boolean }) {
  if (broken) return <Unlink size={8} className="text-orange-400 dark:text-orange-500" />;
  return <Link2 size={8} className="text-slate-300 dark:text-slate-600" />;
}

// ── Main component ────────────────────────────────────────────────────────────

interface ProFormaGridProps {
  data: ProFormaData;
  onChange: (data: ProFormaData) => void;
  projectionYears?: number;
  showWarnings?: boolean;
  inPlaceRent?: number;   // for pre-stab formula: InPlace_n = inPlaceRent × (1+g)^(n-1)
  targetRent?: number;    // for pre-stab formula: Target_n = targetRent × (1+g)^(n-1)
}

const PAGE_SIZE = 3;

export function ProFormaGrid({ data, onChange, projectionYears = 5, showWarnings = false, inPlaceRent, targetRent }: ProFormaGridProps) {
  const [newExpenseName, setNewExpenseName] = useState('');
  const [addingRow, setAddingRow] = useState(false);
  const [page, setPage] = useState(0);
  const [yearPage, setYearPage] = useState(0); // mobile: 0 = yr1, 1 = yr2, ...
  const [isMobile, setIsMobile] = useState(false);


  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 640);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  // Reset year page when projection years change
  useEffect(() => { setYearPage(0); }, [projectionYears]);


  // Years where grossRent override is below stabilized — these are calculator-driven transition years
  const stabilizingYears = new Set(
    Object.entries(data.yearOverrides ?? {})
      .filter(([, ov]) => ov?.grossRent !== undefined && ov.grossRent < data.grossRent.stabilized)
      .map(([y]) => Number(y))
  );

  // All columns: T12 then Yr1..YrN — paginated in groups of PAGE_SIZE
  const allCols: Col[] = [
    { type: 't12' },
    ...Array.from({ length: projectionYears }, (_, i) => ({ type: 'year' as const, year: i + 1 })),
  ];
  const totalPages = Math.ceil(allCols.length / PAGE_SIZE);
  const visibleCols = allCols.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const exitYear = projectionYears;
  const totalCols = 1 + visibleCols.length; // sticky label + visible cols

  // ── Row helper functions ──

  function incomeRowHasOverride(field: 'grossRent' | 'otherIncome' | 'vacancyPct' | 'creditLossPct'): boolean {
    for (let y = 1; y <= projectionYears; y++) {
      if (data.yearOverrides?.[y]?.[field] !== undefined) return true;
    }
    return false;
  }

  function revertIncomeRow(field: 'grossRent' | 'otherIncome' | 'vacancyPct' | 'creditLossPct') {
    const prev = data.yearOverrides ?? {};
    const updated: NonNullable<ProFormaData['yearOverrides']> = {};
    for (const [yStr, ye] of Object.entries(prev)) {
      const y = Number(yStr);
      const newYe = { ...ye };
      // grossRent: clear all years (stabilized becomes the anchor after revert)
      // other fields: keep Year 1 override as the chain base; clear Year 2+ only
      const shouldClear = field === 'grossRent' || y > 1;
      if (shouldClear) {
        delete newYe[field as keyof typeof newYe];
        if (field === 'grossRent') delete newYe.grossRentSystem;
      }
      updated[y] = newYe;
    }
    let newData = { ...data, yearOverrides: updated };
    if (field === 'grossRent') {
      const yr1Override = data.yearOverrides?.[1]?.grossRent;
      const yr1Val = typeof yr1Override === 'number' ? yr1Override : data.grossRent.stabilized;
      newData = { ...newData, grossRent: { ...data.grossRent, stabilized: yr1Val } };
    }
    onChange(newData);
  }

  function expenseRowHasOverride(expenseId: string): boolean {
    for (let y = 2; y <= projectionYears; y++) {
      if (data.yearOverrides?.[y]?.expenses?.[expenseId] !== undefined) return true;
      if (data.yearOverrides?.[y]?.expenseGrowthPcts?.[expenseId] !== undefined) return true;
    }
    return false;
  }

  function revertExpenseRow(expense: ProFormaItem) {
    const prev = data.yearOverrides ?? {};
    const updated: NonNullable<ProFormaData['yearOverrides']> = {};
    for (const [yStr, ye] of Object.entries(prev)) {
      const newYe = { ...ye };
      if (newYe.expenses) {
        const e = { ...newYe.expenses };
        delete e[expense.id];
        newYe.expenses = Object.keys(e).length ? e : undefined;
      }
      if (newYe.expenseGrowthPcts) {
        const g = { ...newYe.expenseGrowthPcts };
        delete g[expense.id];
        newYe.expenseGrowthPcts = Object.keys(g).length ? g : undefined;
      }
      updated[Number(yStr)] = newYe;
    }
    onChange({ ...data, yearOverrides: updated });
  }

  // ── Cascade prompt helpers ──

  function getDownstreamGrayYears(
    field: 'grossRent' | 'otherIncome' | 'vacancyPct' | 'creditLossPct',
    fromYear: number
  ): number[] {
    const result: number[] = [];
    for (let y = fromYear + 1; y <= projectionYears; y++) {
      const ov = data.yearOverrides?.[y];
      const hasWall = ov?.[field] !== undefined && !(field === 'grossRent' && ov.grossRentSystem === true);
      if (hasWall) break;
      result.push(y);
    }
    return result;
  }

  function getDownstreamGrayExpenseYears(expenseId: string, fromYear: number): number[] {
    const result: number[] = [];
    for (let y = fromYear + 1; y <= projectionYears; y++) {
      if (data.yearOverrides?.[y]?.expenses?.[expenseId] !== undefined) break;
      result.push(y);
    }
    return result;
  }

  function getIncomeFieldMeta(field: 'grossRent' | 'otherIncome' | 'vacancyPct' | 'creditLossPct') {
    if (field === 'grossRent') return { chainBase: data.grossRent.stabilized, growthPct: data.grossRent.growthPct, growthRateKey: 'grossRentGrowthPct' as const };
    if (field === 'otherIncome') return { chainBase: 0, growthPct: data.otherIncome.growthPct, growthRateKey: 'otherIncomeGrowthPct' as const };
    return { chainBase: 0, growthPct: 0, growthRateKey: null };
  }

  function applyIncomeYearOnly(year: number, field: 'grossRent' | 'otherIncome' | 'vacancyPct' | 'creditLossPct', value: number) {
    const { chainBase, growthPct: gp, growthRateKey: grk } = getIncomeFieldMeta(field);
    const currentChained = makeChainedValue(data.yearOverrides);
    const updated = { ...(data.yearOverrides ?? {}) };
    // Pin the immediate next year as a formula snapshot so cascade stops here.
    // Mark it cascaded so it doesn't appear as a user break.
    const nextYear = year + 1;
    if (nextYear <= projectionYears && data.yearOverrides?.[nextYear]?.[field] === undefined) {
      const formulaVal = currentChained(field, grk, chainBase, gp, nextYear);
      const ne = updated[nextYear] ?? {};
      updated[nextYear] = {
        ...ne,
        [field]: formulaVal,
        cascadedFields: { ...(ne.cascadedFields ?? {}), [field]: true },
      };
    }
    const extra = field === 'grossRent' ? { grossRentSystem: false } : {};
    const cur = updated[year] ?? {};
    // Mark toggleOffFields so the toggle stays OFF when the cell is reopened.
    // Year 1 also gets yr1Blocked so isIncomeChainBroken(field,1) returns true.
    const yr1Extra = year === 1 ? { yr1Blocked: true } : {};
    updated[year] = {
      ...cur,
      [field]: value,
      ...extra,
      ...yr1Extra,
      toggleOffFields: { ...(cur.toggleOffFields ?? {}), [field]: true },
    };
    onChange({ ...data, yearOverrides: updated });
  }

  function applyExpenseYearOnly(year: number, expenseId: string, value: number) {
    const expense = data.expenses.find(e => e.id === expenseId)!;
    const currentChained = makeChainedExpenseValue(data.yearOverrides);
    const updated = { ...(data.yearOverrides ?? {}) };
    const nextYear = year + 1;
    if (nextYear <= projectionYears && data.yearOverrides?.[nextYear]?.expenses?.[expenseId] === undefined) {
      const formulaVal = currentChained(expense, nextYear);
      const ye = updated[nextYear] ?? {};
      updated[nextYear] = {
        ...ye,
        expenses: { ...(ye.expenses ?? {}), [expenseId]: formulaVal },
        cascadedExpenses: { ...(ye.cascadedExpenses ?? {}), [expenseId]: true },
      };
    }
    const ye = updated[year] ?? {};
    // Mark toggleOffExpenses for all years so the toggle stays OFF when cell reopens.
    updated[year] = {
      ...ye,
      expenses: { ...(ye.expenses ?? {}), [expenseId]: value },
      toggleOffExpenses: { ...(ye.toggleOffExpenses ?? {}), [expenseId]: true as const },
    };
    onChange({ ...data, yearOverrides: updated });
  }

  // ── Year override helpers ──

  const setYearOverride = useCallback((year: number, field: 'grossRent' | 'otherIncome' | 'vacancyPct' | 'creditLossPct', value: number) => {
    const prev = data.yearOverrides ?? {};
    const extra = field === 'grossRent' ? { grossRentSystem: false } : {};
    const cur = prev[year] ?? {};
    // push-to-future=ON: clear toggleOffFields, cascadedFields, yr1Blocked for this field
    const tf = { ...(cur.toggleOffFields ?? {}) } as Record<string, unknown>;
    delete tf[field];
    const cf = { ...(cur.cascadedFields ?? {}) } as Record<string, unknown>;
    delete cf[field];
    const yr1Clear = year === 1 ? { yr1Blocked: undefined } : {};
    onChange({ ...data, yearOverrides: { ...prev, [year]: {
      ...cur, [field]: value, ...extra, ...yr1Clear,
      toggleOffFields: Object.keys(tf).length ? tf as typeof cur.toggleOffFields : undefined,
      cascadedFields: Object.keys(cf).length ? cf as typeof cur.cascadedFields : undefined,
    } } });
  }, [data, onChange]);

  const clearYearOverride = useCallback((year: number, field: 'grossRent' | 'otherIncome' | 'vacancyPct' | 'creditLossPct') => {
    const prev = data.yearOverrides ?? {};
    // Remove this year's override. Year N chains from Year N-1 (or stabilized for Year 1).
    // Propagation naturally flows forward until it hits the next blocked year.
    const e = { ...(prev[year] ?? {}) };
    delete e[field];
    if (field === 'grossRent') delete e.grossRentSystem;
    onChange({ ...data, yearOverrides: { ...prev, [year]: e } });
  }, [data, onChange]);

  const setExpenseYearOverride = useCallback((year: number, expenseId: string, value: number) => {
    const prev = data.yearOverrides ?? {};
    const ye = prev[year] ?? {};
    // push-to-future=ON: clear toggleOffExpenses + cascadedExpenses for this expense
    const toe = { ...(ye.toggleOffExpenses ?? {}) } as Record<string, unknown>;
    delete toe[expenseId];
    const ce = { ...(ye.cascadedExpenses ?? {}) } as Record<string, unknown>;
    delete ce[expenseId];
    const updated = { ...prev, [year]: { ...ye,
      expenses: { ...(ye.expenses ?? {}), [expenseId]: value },
      toggleOffExpenses: Object.keys(toe).length ? toe as typeof ye.toggleOffExpenses : undefined,
      cascadedExpenses: Object.keys(ce).length ? ce as typeof ye.cascadedExpenses : undefined,
    } };
    onChange({ ...data, yearOverrides: updated });
  }, [data, onChange]);

  const clearExpenseYearOverride = useCallback((year: number, expenseId: string) => {
    const prev = data.yearOverrides ?? {};
    // Remove this year's override. Propagation flows forward until the next blocked year.
    const ye = { ...(prev[year] ?? {}) };
    const expenses = { ...(ye.expenses ?? {}) };
    delete expenses[expenseId];
    onChange({ ...data, yearOverrides: { ...prev, [year]: { ...ye, expenses } } });
  }, [data, onChange]);

  // push-to-future=ON: cascade to year..N and clear toggleOff flag
  const setYearGrowthPct = useCallback((year: number, field: 'grossRentGrowthPct' | 'otherIncomeGrowthPct', value: number) => {
    const prev = data.yearOverrides ?? {};
    const updated = { ...prev };
    for (let y = year; y <= projectionYears; y++) {
      const cur = updated[y] ?? {};
      const tgp = { ...(cur.toggleOffGrowthPcts ?? {}) };
      delete tgp[field];
      updated[y] = { ...cur, [field]: value, toggleOffGrowthPcts: Object.keys(tgp).length ? tgp : undefined };
    }
    onChange({ ...data, yearOverrides: updated });
  }, [data, onChange, projectionYears]);

  // push-to-future=OFF: pin just this year, mark toggleOff
  const applyIncomeGrowthYearOnly = useCallback((year: number, field: 'grossRentGrowthPct' | 'otherIncomeGrowthPct', value: number) => {
    const prev = data.yearOverrides ?? {};
    const cur = prev[year] ?? {};
    const tgp = { ...(cur.toggleOffGrowthPcts ?? {}), [field]: true as const };
    onChange({ ...data, yearOverrides: { ...prev, [year]: { ...cur, [field]: value, toggleOffGrowthPcts: tgp } } });
  }, [data, onChange]);

  const clearYearGrowthPct = useCallback((year: number, field: 'grossRentGrowthPct' | 'otherIncomeGrowthPct') => {
    const prev = data.yearOverrides ?? {};
    const cur = { ...(prev[year] ?? {}) } as Record<string, unknown>;
    delete cur[field];
    const tgp = { ...((cur.toggleOffGrowthPcts as Record<string, unknown>) ?? {}) };
    delete tgp[field];
    cur.toggleOffGrowthPcts = Object.keys(tgp).length ? tgp : undefined;
    onChange({ ...data, yearOverrides: { ...prev, [year]: cur as NonNullable<ProFormaData['yearOverrides']>[number] } });
  }, [data, onChange]);

  // push-to-future=ON: cascade expense growth pct to year..N
  const setExpenseYearGrowthPct = useCallback((year: number, expenseId: string, value: number) => {
    const prev = data.yearOverrides ?? {};
    const updated = { ...prev };
    for (let y = year; y <= projectionYears; y++) {
      const ye = updated[y] ?? {};
      const tegp = { ...(ye.toggleOffExpenseGrowthPcts ?? {}) };
      delete tegp[expenseId];
      updated[y] = { ...ye, expenseGrowthPcts: { ...(ye.expenseGrowthPcts ?? {}), [expenseId]: value }, toggleOffExpenseGrowthPcts: Object.keys(tegp).length ? tegp : undefined };
    }
    onChange({ ...data, yearOverrides: updated });
  }, [data, onChange, projectionYears]);

  // push-to-future=OFF: pin just this year
  const applyExpenseGrowthYearOnly = useCallback((year: number, expenseId: string, value: number) => {
    const prev = data.yearOverrides ?? {};
    const ye = prev[year] ?? {};
    const tegp = { ...(ye.toggleOffExpenseGrowthPcts ?? {}), [expenseId]: true as const };
    onChange({ ...data, yearOverrides: { ...prev, [year]: { ...ye, expenseGrowthPcts: { ...(ye.expenseGrowthPcts ?? {}), [expenseId]: value }, toggleOffExpenseGrowthPcts: tegp } } });
  }, [data, onChange]);

  const clearExpenseYearGrowthPct = useCallback((year: number, expenseId: string) => {
    const prev = data.yearOverrides ?? {};
    const ye = { ...(prev[year] ?? {}) };
    const g = { ...(ye.expenseGrowthPcts ?? {}) };
    delete g[expenseId];
    ye.expenseGrowthPcts = Object.keys(g).length ? g : undefined;
    const tegp = { ...(ye.toggleOffExpenseGrowthPcts ?? {}) };
    delete tegp[expenseId];
    ye.toggleOffExpenseGrowthPcts = Object.keys(tegp).length ? tegp : undefined;
    onChange({ ...data, yearOverrides: { ...prev, [year]: ye } });
  }, [data, onChange]);

  // ── Data helpers ──

  const chainedValue = makeChainedValue(data.yearOverrides);
  const chainedExpenseValue = makeChainedExpenseValue(data.yearOverrides);

  const setGrossRent = useCallback((field: keyof typeof data.grossRent, value: number | null) => {
    const u = { ...data.grossRent, [field]: value };
    if (field === 't12' && typeof value === 'number' && data.grossRent.stabilized === 0) u.stabilized = value;
    onChange({ ...data, grossRent: u });
  }, [data, onChange]);

  const setOtherIncome = useCallback((field: keyof typeof data.otherIncome, value: number | null) => {
    onChange({ ...data, otherIncome: { ...data.otherIncome, [field]: value } });
  }, [data, onChange]);

  const setVacancy = useCallback((field: keyof typeof data.vacancyPct, value: number | null) => {
    onChange({ ...data, vacancyPct: { ...data.vacancyPct, [field]: value } });
  }, [data, onChange]);

  const setCreditLoss = useCallback((field: keyof typeof data.creditLossPct, value: number | null) => {
    onChange({ ...data, creditLossPct: { ...data.creditLossPct, [field]: value } });
  }, [data, onChange]);

  const updateExpense = useCallback((id: string, patch: Partial<ProFormaItem>) => {
    const newExpenses = data.expenses.map(e => {
      if (e.id !== id) return e;
      const m = { ...e, ...patch };
      if ('t12Value' in patch && e.stabilizedValue === 0) m.stabilizedValue = m.t12Value;
      return m;
    });
    const newData = { ...data, expenses: newExpenses };
    onChange(newData);
  }, [data, onChange]);

  const deleteExpense = useCallback((id: string) => { onChange({ ...data, expenses: data.expenses.filter(e => e.id !== id) }); }, [data, onChange]);

  const toggleExpenseType = useCallback((id: string) => {
    const t12Egi = getT12EGI();
    const stabEgi = computeEGI(
      data.grossRent.stabilized,
      data.otherIncome.stabilized,
      data.vacancyPct.stabilized,
      data.creditLossPct?.stabilized ?? 0,
    );
    onChange({
      ...data,
      expenses: data.expenses.map(e => {
        if (e.id !== id) return e;
        const toPercent = !e.isPercentOfEGI;
        if (toPercent) {
          // $ → %: convert dollar values to % of EGI
          return {
            ...e,
            isPercentOfEGI: true,
            t12Value:        t12Egi  > 0 ? parseFloat(((e.t12Value        / t12Egi)  * 100).toFixed(2)) : 0,
            stabilizedValue: stabEgi > 0 ? parseFloat(((e.stabilizedValue / stabEgi) * 100).toFixed(2)) : 0,
            stabValue:       e.stabValue !== null && stabEgi > 0
                               ? parseFloat(((e.stabValue / stabEgi) * 100).toFixed(2))
                               : null,
          };
        } else {
          // % → $: convert % values back to dollar amounts using EGI
          return {
            ...e,
            isPercentOfEGI: false,
            t12Value:        t12Egi  > 0 ? Math.round((e.t12Value        / 100) * t12Egi)  : 0,
            stabilizedValue: stabEgi > 0 ? Math.round((e.stabilizedValue / 100) * stabEgi) : 0,
            stabValue:       e.stabValue !== null && stabEgi > 0
                               ? Math.round((e.stabValue / 100) * stabEgi)
                               : null,
          };
        }
      }),
    });
  }, [data, onChange]);

  const addExpense = useCallback((name: string) => {
    if (!name.trim()) return;
    onChange({ ...data, expenses: [...data.expenses, { id: uid(), name: name.trim(), isPercentOfEGI: false, t12Value: 0, stabValue: null, stabilizedValue: 0, growthPct: 2 }] });
    setAddingRow(false); setNewExpenseName('');
  }, [data, onChange]);

  // ── Per-year computed values ──

  const cl = { t12: data.creditLossPct?.t12 ?? 0, stabilized: data.creditLossPct?.stabilized ?? 0 };

  function getEGIForYear(year: number): number {
    const rentOv = data.yearOverrides?.[year];
    const rent = (rentOv?.grossRent !== undefined && rentOv?.grossRentSystem !== true)
      ? rentOv.grossRent
      : chainedValue('grossRent', 'grossRentGrowthPct', data.grossRent.stabilized, data.grossRent.growthPct, year);
    const other = data.yearOverrides?.[year]?.otherIncome ?? chainedValue('otherIncome', 'otherIncomeGrowthPct', 0, data.otherIncome.growthPct, year);
    const vac   = data.yearOverrides?.[year]?.vacancyPct   ?? chainedValue('vacancyPct',   null, 0, 0, year);
    const clv   = data.yearOverrides?.[year]?.creditLossPct ?? chainedValue('creditLossPct', null, 0, 0, year);
    return computeEGI(rent, other, vac, clv);
  }

  function getEffectivePctForYear(expenseId: string, stabilizedPct: number, year: number): number {
    let lastPct = stabilizedPct;
    for (let y = 1; y <= year; y++) {
      const ov = data.yearOverrides?.[y]?.expenses?.[expenseId];
      if (ov !== undefined) lastPct = ov;
    }
    return lastPct;
  }

  function getOpExForYear(year: number, egi: number): number {
    return data.expenses.reduce((sum, e) => {
      if (e.isPercentOfEGI) {
        const pct = getEffectivePctForYear(e.id, e.stabilizedValue, year);
        return sum + egi * (pct / 100);
      }
      const ov = data.yearOverrides?.[year]?.expenses?.[e.id];
      return sum + (ov !== undefined ? ov : chainedExpenseValue(e, year));
    }, 0);
  }

  function getT12EGI() { return computeEGI(data.grossRent.t12, data.otherIncome.t12, data.vacancyPct.t12, cl.t12); }
  function getT12OpEx(t12egi: number) { return data.expenses.reduce((s, e) => s + (e.isPercentOfEGI ? t12egi * (e.t12Value / 100) : e.t12Value), 0); }

  // ── Page dot indicator — any override in that page's years? ──

  function pageHasOverride(p: number): boolean {
    return allCols.slice(p * PAGE_SIZE, (p + 1) * PAGE_SIZE).some(col => {
      if (col.type !== 'year') return false;
      const ov = data.yearOverrides?.[col.year];
      if (!ov) return false;
      const { expenses, expenseGrowthPcts, grossRent, grossRentSystem, ...rest } = ov;
      const hasManualGrossRent = grossRent !== undefined && grossRentSystem !== true;
      return hasManualGrossRent || Object.values(rest).some(v => v !== undefined) || (!!expenses && Object.keys(expenses).length > 0);
    });
  }

  // ── Chain break helpers ──

  function isIncomeChainBroken(field: 'grossRent' | 'otherIncome' | 'vacancyPct' | 'creditLossPct', toYear: number): boolean {
    const ov = data.yearOverrides?.[toYear];
    if (!ov) return false;
    if (field === 'grossRent' && ov.grossRentSystem === true) return false; // stabilizing — not a user break
    if (ov.cascadedFields?.[field]) return false; // auto-cascaded pin — not a user break
    if (toYear === 1) return ov.yr1Blocked === true; // Year 1 only breaks if toggle=OFF
    return ov[field] !== undefined;
  }

  function isExpenseChainBroken(expenseId: string, toYear: number): boolean {
    const ov = data.yearOverrides?.[toYear];
    if (!ov) return false;
    if (ov.cascadedExpenses?.[expenseId]) return false; // auto-cascaded — not a user break
    if (toYear === 1) return ov.toggleOffExpenses?.[expenseId] === true; // Year 1 only breaks if toggle=OFF
    return ov.expenses?.[expenseId] !== undefined;
  }

  function isIncomeToggleOff(field: 'grossRent' | 'otherIncome' | 'vacancyPct' | 'creditLossPct', year: number): boolean {
    const ov = data.yearOverrides?.[year];
    if (!ov) return false;
    if (year === 1) return ov.yr1Blocked === true;
    return ov.toggleOffFields?.[field] === true;
  }

  function isExpenseToggleOff(expenseId: string, year: number): boolean {
    return data.yearOverrides?.[year]?.toggleOffExpenses?.[expenseId] === true;
  }

  function revertIncomeGrowthRow(field: 'grossRentGrowthPct' | 'otherIncomeGrowthPct', baseGrowthPct: number) {
    const prev = data.yearOverrides ?? {};
    const yr2Rate = prev[2]?.[field] ?? baseGrowthPct;
    const updated: NonNullable<ProFormaData['yearOverrides']> = { ...prev };
    for (let y = 3; y <= projectionYears; y++) {
      updated[y] = { ...(updated[y] ?? {}), [field]: yr2Rate };
    }
    onChange({ ...data, yearOverrides: updated });
  }

  function revertExpenseGrowthRow(expenseId: string, baseGrowthPct: number) {
    const prev = data.yearOverrides ?? {};
    const yr2Rate = prev[2]?.expenseGrowthPcts?.[expenseId] ?? baseGrowthPct;
    const updated: NonNullable<ProFormaData['yearOverrides']> = { ...prev };
    for (let y = 3; y <= projectionYears; y++) {
      const ye = updated[y] ?? {};
      updated[y] = { ...ye, expenseGrowthPcts: { ...(ye.expenseGrowthPcts ?? {}), [expenseId]: yr2Rate } };
    }
    onChange({ ...data, yearOverrides: updated });
  }

  // getBroken(y): year y has a user override — highlights the year number orange
  // isToggleOff(y): year y was committed with push-to-future=OFF — breaks the connector AFTER year y
  function renderChainMap(getBroken: (y: number) => boolean, isToggleOff?: (y: number) => boolean) {
    const years = Array.from({ length: projectionYears }, (_, i) => i + 1);
    const anyBroken = years.some(y => getBroken(y));
    if (!anyBroken) return null;
    return (
      <div className="flex items-center mt-0.5">
        {years.map((y, idx) => {
          const broken = getBroken(y);
          // connector between y-1 and y: broken if y has incoming override OR y-1 stopped the chain (toggle=OFF)
          const connectorBroken = idx > 0 && (broken || (isToggleOff ? isToggleOff(y - 1) : false));
          return (
            <Fragment key={y}>
              {idx > 0 && (
                connectorBroken
                  ? <Unlink size={7} className="text-orange-400 mx-0.5 shrink-0" />
                  : <span className="w-2 h-px bg-slate-200 dark:bg-slate-600 block mx-0.5 shrink-0" />
              )}
              <span className={`text-[8px] tabular-nums leading-none ${broken ? 'text-orange-400 font-semibold' : 'text-slate-400 dark:text-slate-500'}`}>{y}</span>
            </Fragment>
          );
        })}
      </div>
    );
  }

  function renderGrowthChainMap(getRate: (y: number) => number, hasOverride: (y: number) => boolean, onRevert: () => void) {
    const years = Array.from({ length: projectionYears - 1 }, (_, i) => i + 2);
    const rates = years.map(y => getRate(y));
    if (rates.every(r => r === rates[0])) return null;
    const maxRate = Math.max(...rates, 0.1);
    const BAR_W = 2.5;
    const GAP = 1;
    const MAX_H = 10;
    const MIN_H = 1.5;
    const totalW = years.length * BAR_W + (years.length - 1) * GAP;

    return (
      <div className="flex items-center gap-1 mt-0.5">
        <svg width={totalW} height={MAX_H} className="shrink-0 overflow-visible">
          {years.map((y, idx) => {
            const barH = Math.max(MIN_H, (rates[idx] / maxRate) * MAX_H);
            return (
              <rect
                key={y}
                x={idx * (BAR_W + GAP)}
                y={MAX_H - barH}
                width={BAR_W}
                height={barH}
                rx={0.5}
                className={hasOverride(y) ? 'fill-orange-400' : 'fill-slate-300 dark:fill-slate-600'}
              />
            );
          })}
        </svg>
        <button type="button" onClick={onRevert} title="Cascade Yr2 growth rate to all later years"
          className="p-0.5 rounded text-primary-500 hover:text-primary-700 dark:hover:text-primary-300 shrink-0">
          <RotateCcw size={9} />
        </button>
      </div>
    );
  }

  // ── Column header meta ──

  function colHeader(col: Col): { label: string; sub: string; color: string; isExit: boolean } {
    if (col.type === 't12') return { label: 'T12', sub: 'Actuals/yr', color: 'text-slate-500 dark:text-slate-400', isExit: false };
    const isExit = col.year === exitYear;
    const isStabilizing = stabilizingYears.has(col.year);
    const ov = data.yearOverrides?.[col.year];
    const hasOv = !isStabilizing && ov?.grossRent !== undefined && ov.grossRentSystem !== true;
    return {
      label: `Yr ${col.year}${isExit ? ' ★' : ''}`,
      sub: isStabilizing ? '↗ Stabilizing' : col.year === 1 ? 'Base + growth' : hasOv ? 'Override' : 'Formula',
      color: isExit
        ? 'text-amber-600 dark:text-amber-400'
        : isStabilizing
        ? 'text-amber-500 dark:text-amber-400'
        : col.year === 1
        ? 'text-emerald-600 dark:text-emerald-400'
        : 'text-slate-500 dark:text-slate-400',
      isExit,
    };
  }

  // ── Income row cell renderer ──

  function renderIncomeCell(
    col: Col,
    overrideKey: 'grossRent' | 'otherIncome' | 'vacancyPct' | 'creditLossPct',
    stabilized: number,
    growthPct: number,
    isPercent: boolean,
    onT12: (v: number) => void,
    onStabilized: (v: number) => void,
    onGrowthPct: (v: number) => void,
    t12Val: number,
  ) {
    const isGrossRent = overrideKey === 'grossRent';
    const fmt = isPercent ? 'percent' : 'currency';
    const growthRateKey = overrideKey === 'grossRent' ? 'grossRentGrowthPct' as const : overrideKey === 'otherIncome' ? 'otherIncomeGrowthPct' as const : null;

    if (col.type === 't12') {
      const grossT12 = data.grossRent.t12;
      return (
        <td className="px-2 py-2.5 align-top">
          <div className="flex flex-col items-end gap-0.5">
            <Cell value={t12Val} onChange={onT12} format={fmt} />
            {isPercent && grossT12 > 0 && <span className="text-[10px] text-slate-400 tabular-nums">{fmt$(grossT12 * t12Val / 100)}</span>}
          </div>
        </td>
      );
    }

    const { year } = col;
    const bg = '';

    if (year === 1) {
      const yr1Ov = data.yearOverrides?.[1];
      const yr1Override = yr1Ov?.[overrideKey];
      const isSystem = isGrossRent && yr1Ov?.grossRentSystem === true;
      const isStabilizing = isGrossRent && typeof yr1Override === 'number' && yr1Override < stabilized;

      // Non-grossRent: Year 1 is the direct chain-starting entry — no formula behind it
      if (!isGrossRent) {
        const yr1Val = typeof yr1Override === 'number' ? yr1Override : 0;
        return (
          <td className={`px-2 py-2.5 align-top ${bg}`}>
            <div className="flex flex-col items-end gap-0.5">
              <YearCell
                computed={0}
                override={typeof yr1Override === 'number' ? yr1Override : undefined}
                format={fmt}
                onOverride={v => setYearOverride(1, overrideKey, v)}
                onYearOnly={v => applyIncomeYearOnly(1, overrideKey, v)}
                pushToFutureOff={yr1Ov?.toggleOffFields?.[overrideKey] === true}
              />
              {isPercent && (() => {
                const gross = yr1Ov?.grossRent ?? data.grossRent.stabilized;
                const displayVal = typeof yr1Override === 'number' ? yr1Override : 0;
                return gross > 0 && displayVal > 0
                  ? <span className="text-[10px] text-slate-400 tabular-nums">{fmt$(gross * displayVal / 100)}</span>
                  : null;
              })()}
            </div>
          </td>
        );
      }

      return (
        <td className={`px-2 py-2.5 align-top ${bg}`}>
          <div className="flex flex-col items-end gap-0.5">
            {isStabilizing ? (
              <StabilizingCell value={yr1Override as number} anticipated={stabilized}
                onOverride={v => setYearOverride(1, overrideKey, v)}
                onClearOverride={() => clearYearOverride(1, overrideKey)} />
            ) : isSystem ? (
              <Cell value={yr1Override as number} onChange={v => setYearOverride(1, overrideKey, v)} format={fmt} />
            ) : (
              <YearCell
                computed={stabilized}
                override={typeof yr1Override === 'number' ? yr1Override : undefined}
                format={fmt}
                onOverride={v => setYearOverride(1, overrideKey, v)}
                onYearOnly={v => applyIncomeYearOnly(1, overrideKey, v)}
                pushToFutureOff={yr1Ov?.toggleOffFields?.[overrideKey] === true}
              />
            )}
          </div>
        </td>
      );
    }

    // Year 2+
    const yrOv = data.yearOverrides?.[year];
    const yrOverride = yrOv?.[overrideKey];
    const isSystem = isGrossRent && yrOv?.grossRentSystem === true;
    const isStabilizing = isGrossRent && typeof yrOverride === 'number' && yrOverride < stabilized;

    // Pre-stab formula: use inPlaceRent/targetRent if provided
    const effectiveInPlace = inPlaceRent ?? data.grossRent.t12;
    const effectiveTarget = targetRent ?? stabilized;
    const inPlaceN = isGrossRent ? effectiveInPlace * Math.pow(1 + growthPct / 100, year - 1) : 0;
    const targetN = isGrossRent ? effectiveTarget * Math.pow(1 + growthPct / 100, year - 1) : 0;
    const anticipated = isGrossRent ? Math.min(inPlaceN, targetN) : stabilized * Math.pow(1 + growthPct / 100, year - 1);

    const chainBase = isGrossRent ? stabilized : 0;
    const computedVal = chainedValue(
      overrideKey as 'grossRent' | 'otherIncome' | 'vacancyPct' | 'creditLossPct',
      growthRateKey,
      chainBase,
      growthPct,
      year
    );
    const yrGrowthPct = growthRateKey ? (yrOv?.[growthRateKey as 'grossRentGrowthPct' | 'otherIncomeGrowthPct'] ?? growthPct) : growthPct;
    return (
      <td key={year} className={`px-2 py-2.5 align-top ${bg}`}>
        <div className="flex flex-col items-end gap-0.5">
          {isStabilizing ? (
            <StabilizingCell
              value={yrOverride as number}
              anticipated={anticipated}
              onOverride={v => setYearOverride(year, overrideKey, v)}
              onClearOverride={() => clearYearOverride(year, overrideKey)}
            />
          ) : isSystem ? (
            <>
              <Cell value={yrOverride as number} onChange={v => setYearOverride(year, overrideKey, v)} format={fmt} />
              {!isPercent && growthRateKey && (
                <div className="flex items-center gap-0.5">
                  <Cell value={yrGrowthPct} onChange={v => setYearGrowthPct(year, growthRateKey, v)} format="growthPct" />
                  <span className="text-[10px] text-slate-400">/yr</span>
                </div>
              )}
            </>
          ) : (
            <>
              <YearCell
                computed={computedVal}
                override={typeof yrOverride === 'number' ? yrOverride : undefined}
                format={fmt}
                onOverride={v => setYearOverride(year, overrideKey, v)}
                onClearOverride={() => clearYearOverride(year, overrideKey)}
                onYearOnly={v => applyIncomeYearOnly(year, overrideKey, v)}
                cascadeDelay={(year - 1) * 50}
                pushToFutureOff={yrOv?.toggleOffFields?.[overrideKey] === true}
              />
              {!isPercent && growthRateKey && (
                <div className="flex items-center gap-0.5">
                  <YearCell
                    computed={growthPct}
                    override={yrOv?.[growthRateKey as 'grossRentGrowthPct' | 'otherIncomeGrowthPct'] !== undefined ? yrGrowthPct : undefined}
                    format="growthPct"
                    onOverride={v => setYearGrowthPct(year, growthRateKey, v)}
                    onClearOverride={() => clearYearGrowthPct(year, growthRateKey)}
                    onYearOnly={v => applyIncomeGrowthYearOnly(year, growthRateKey, v)}
                    pushToFutureOff={yrOv?.toggleOffGrowthPcts?.[growthRateKey] === true}
                  />
                  <span className="text-[10px] text-slate-400">/yr</span>
                </div>
              )}
            </>
          )}
          {isPercent && !isStabilizing && (() => {
            const gross = chainedValue('grossRent', 'grossRentGrowthPct', data.grossRent.stabilized, data.grossRent.growthPct, year);
            const pct = typeof yrOverride === 'number' ? yrOverride : computedVal;
            return gross > 0 ? <span className="text-[10px] text-slate-400 tabular-nums">{fmt$(gross * pct / 100)}</span> : null;
          })()}
        </div>
      </td>
    );
  }

  // ── Computed row cell renderer ──

  function renderComputedCell(col: Col, t12Val: number, highlight: boolean) {
    const rowBg = highlight ? 'bg-primary-50 dark:bg-primary-900/20' : 'bg-slate-50 dark:bg-slate-700/30';
    const valColor = highlight ? 'text-primary-700 dark:text-primary-300' : 'text-slate-700 dark:text-slate-300';

    let cellBg = rowBg;
    let value: number;

    if (col.type === 't12') {
      value = t12Val;
    } else {
      if (col.year === exitYear) cellBg = highlight ? 'bg-primary-50/40 dark:bg-primary-900/10' : '';
      const egi = col.year === 1
        ? computeEGI(data.yearOverrides?.[1]?.grossRent ?? data.grossRent.stabilized, data.yearOverrides?.[1]?.otherIncome ?? 0, data.yearOverrides?.[1]?.vacancyPct ?? 0, data.yearOverrides?.[1]?.creditLossPct ?? 0)
        : getEGIForYear(col.year);
      value = highlight ? (egi - getOpExForYear(col.year, egi)) : egi; // reused for both EGI and NOI
    }

    return (
      <td className={`px-2 py-2.5 text-right whitespace-nowrap ${cellBg}`}>
        <span className={`text-sm font-bold tabular-nums ${valColor}`}>{fmt$(value)}</span>
      </td>
    );
  }

  const t12EGI = getT12EGI();
  const t12OpEx = getT12OpEx(t12EGI);

  // ── Mobile card layout ──────────────────────────────────────────────────────

  const mobileYear = yearPage + 1; // 1-based year shown on mobile

  function MobileIncomeRow({ label, overrideKey, stabilized, growthPct, isPercent, onT12, onStabilized, onGrowthPct, t12Val }: {
    label: string; overrideKey: 'grossRent' | 'otherIncome' | 'vacancyPct' | 'creditLossPct'; stabilized: number; growthPct: number; isPercent: boolean;
    onT12: (v: number) => void; onStabilized: (v: number) => void; onGrowthPct: (v: number) => void; t12Val: number;
  }) {
    const fmt = isPercent ? 'percent' : 'currency';
    const yr1Ov = data.yearOverrides?.[1];
    const yr1Override = yr1Ov?.[overrideKey];
    const isSystem = overrideKey === 'grossRent' && yr1Ov?.grossRentSystem === true;
    const isGrossRent = overrideKey === 'grossRent';

    const chainBrokenHere = mobileYear > 1 && isIncomeChainBroken(overrideKey, mobileYear);
    const hasOverride = incomeRowHasOverride(overrideKey);

    return (
      <div className="px-3 py-3 border-b border-slate-100 dark:border-slate-700">
        {/* Label row with revert button + chain map */}
        <div className="flex items-start justify-between mb-2 gap-2">
          <div className="min-w-0">
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300">{label}</p>
            {renderChainMap(y => isIncomeChainBroken(overrideKey, y), y => isIncomeToggleOff(overrideKey, y))}
          </div>
          {hasOverride && (
            <button type="button" title="Revert row to formula"
              onClick={() => revertIncomeRow(overrideKey)}
              className="shrink-0 p-1 rounded text-primary-500 hover:text-primary-700 dark:hover:text-primary-300 touch-manipulation">
              <RotateCcw size={12} />
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          {/* T12 */}
          <div>
            <p className="text-[10px] font-semibold uppercase text-slate-400 mb-1">T12</p>
            <Cell value={t12Val} onChange={onT12} format={fmt} />
          </div>
          {/* Year cell */}
          <div>
            <div className="flex items-center gap-1 mb-1">
              <p className="text-[10px] font-semibold uppercase text-slate-400">
                Yr {mobileYear}{mobileYear === projectionYears ? ' ★' : ''}
              </p>
              {chainBrokenHere
                ? <Unlink size={9} className="text-orange-400 dark:text-orange-500 shrink-0" />
                : mobileYear > 1 && <Link2 size={9} className="text-slate-300 dark:text-slate-600 shrink-0" />
              }
            </div>
            {mobileYear === 1 ? (
              <div className="space-y-1">
                {isSystem ? (
                  <Cell value={yr1Override as number} onChange={v => setYearOverride(1, overrideKey, v)} format={fmt} />
                ) : isGrossRent ? (
                  <YearCell
                    computed={stabilized}
                    override={typeof yr1Override === 'number' ? yr1Override : undefined}
                    format={fmt}
                    onOverride={v => setYearOverride(1, overrideKey, v)}
                    onYearOnly={v => applyIncomeYearOnly(1, overrideKey, v)}
                  />
                ) : (
                  <Cell
                    value={typeof yr1Override === 'number' ? yr1Override : 0}
                    onChange={v => v === 0 ? clearYearOverride(1, overrideKey) : setYearOverride(1, overrideKey, v)}
                    format={fmt}
                  />
                )}
              </div>
            ) : (
              <div className="space-y-1">
                {(() => {
                  const yrOv = data.yearOverrides?.[mobileYear];
                  const yrOverride = yrOv?.[overrideKey];
                  const growthRateKey = overrideKey === 'grossRent' ? 'grossRentGrowthPct' as const : overrideKey === 'otherIncome' ? 'otherIncomeGrowthPct' as const : null;
                  const yrGrowthPct = growthRateKey ? (yrOv?.[growthRateKey] ?? growthPct) : growthPct;
                  const mobileChainBase = overrideKey === 'grossRent' ? stabilized : 0;
                  const computedVal = chainedValue(
                    overrideKey as 'grossRent' | 'otherIncome' | 'vacancyPct' | 'creditLossPct',
                    growthRateKey,
                    mobileChainBase,
                    growthPct,
                    mobileYear
                  );
                  return (
                    <>
                      <YearCell computed={computedVal} override={typeof yrOverride === 'number' ? yrOverride : undefined} format={fmt}
                        onOverride={(v) => {
                          const extra = overrideKey === 'grossRent' ? { grossRentSystem: false } : {};
                          const updated = { ...(data.yearOverrides ?? {}) };
                          const ye = updated[mobileYear] ?? {};
                          updated[mobileYear] = { ...ye, [overrideKey]: v, ...extra };
                          onChange({ ...data, yearOverrides: updated });
                        }}
                        onClearOverride={mobileYear > 1 ? () => clearYearOverride(mobileYear, overrideKey) : undefined}
                        onYearOnly={v => applyIncomeYearOnly(mobileYear, overrideKey, v)}
                        cascadeDelay={(mobileYear - 1) * 50}
                        />
                      {!isPercent && growthRateKey && (
                        <div className="flex items-center gap-0.5">
                          <Cell value={yrGrowthPct} onChange={() => {}} onCommit={(v) => {
                            setYearGrowthPct(mobileYear, growthRateKey, v);
                          }} format="growthPct" isOverridden={yrOv?.[growthRateKey] !== undefined} />
                          <span className="text-[10px] text-slate-400">/yr</span>
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  function MobileExpenseRow({ expense }: { expense: ProFormaItem }) {
    const fmt = expense.isPercentOfEGI ? 'percent' : 'currency';
    const egi = mobileYear === 1
      ? computeEGI(data.yearOverrides?.[1]?.grossRent ?? data.grossRent.stabilized, data.yearOverrides?.[1]?.otherIncome ?? 0, data.yearOverrides?.[1]?.vacancyPct ?? 0, data.yearOverrides?.[1]?.creditLossPct ?? 0)
      : getEGIForYear(mobileYear);
    const hasExpOverride = expenseRowHasOverride(expense.id);
    const expChainBrokenHere = mobileYear > 1 && isExpenseChainBroken(expense.id, mobileYear);
    return (
      <div className="px-3 py-3 border-b border-slate-100 dark:border-slate-700">
        <div className="flex items-start justify-between mb-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <LabelCell value={expense.name} onChange={name => updateExpense(expense.id, { name })} />
              {showWarnings && !expense.isPercentOfEGI && expense.stabilizedValue === 0 && (
                <AlertTriangle size={12} className="text-amber-500 shrink-0" />
              )}
            </div>
            {renderChainMap(y => isExpenseChainBroken(expense.id, y), y => isExpenseToggleOff(expense.id, y))}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {hasExpOverride && (
              <button type="button" title="Revert row to formula"
                onClick={() => revertExpenseRow(expense)}
                className="p-1 rounded text-primary-500 hover:text-primary-700 dark:hover:text-primary-300 touch-manipulation">
                <RotateCcw size={12} />
              </button>
            )}
            {!NON_TOGGLEABLE_EXPENSES.has(expense.name) && (
              <button type="button" onClick={() => toggleExpenseType(expense.id)}
                className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-slate-400 touch-manipulation">
                {expense.isPercentOfEGI ? '→ $' : '→ %'}
              </button>
            )}
            {!expense.id.startsWith('preset-') && (
              <button type="button" onClick={() => deleteExpense(expense.id)}
                className="p-1 rounded text-red-400 bg-red-50 dark:bg-red-900/30 touch-manipulation">
                <X size={12} />
              </button>
            )}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase text-slate-400 mb-1">T12</p>
            <Cell value={expense.t12Value} onChange={v => updateExpense(expense.id, { t12Value: v })} format={fmt} />
          </div>
          <div>
            <div className="flex items-center gap-1 mb-1">
              <p className="text-[10px] font-semibold uppercase text-slate-400">
                Yr {mobileYear}{mobileYear === projectionYears ? ' ★' : ''}
              </p>
              {expChainBrokenHere
                ? <Unlink size={9} className="text-orange-400 dark:text-orange-500 shrink-0" />
                : mobileYear > 1 && <Link2 size={9} className="text-slate-300 dark:text-slate-600 shrink-0" />
              }
            </div>
            {mobileYear === 1 ? (
              <div className="space-y-1">
                <Cell value={expense.stabilizedValue} onChange={v => updateExpense(expense.id, { stabilizedValue: v })} format={fmt} />
                {!expense.isPercentOfEGI && (
                  <div className="flex items-center gap-0.5">
                    <Cell value={expense.growthPct} onChange={v => updateExpense(expense.id, { growthPct: v })} format="growthPct" />
                    <span className="text-[10px] text-slate-400">/yr</span>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-1">
                {(() => {
                  const yrExpOv = data.yearOverrides?.[mobileYear]?.expenses?.[expense.id];
                  const computed = expense.isPercentOfEGI
                    ? getEffectivePctForYear(expense.id, expense.stabilizedValue, mobileYear)
                    : chainedExpenseValue(expense, mobileYear);
                  const yrGrowth = data.yearOverrides?.[mobileYear]?.expenseGrowthPcts?.[expense.id] ?? expense.growthPct;
                  const expHasDownstream = mobileYear < projectionYears;
                  return (
                    <>
                      <YearCell computed={computed} override={typeof yrExpOv === 'number' ? yrExpOv : undefined} format={fmt}
                        onOverride={(v) => {
                          setExpenseYearOverride(mobileYear, expense.id, v);
                        }}
                        onClearOverride={mobileYear > 1 ? () => clearExpenseYearOverride(mobileYear, expense.id) : undefined}
                        onYearOnly={v => applyExpenseYearOnly(mobileYear, expense.id, v)}
                        cascadeDelay={(mobileYear - 1) * 50}
                        />
                      {!expense.isPercentOfEGI && (
                        <div className="flex items-center gap-0.5">
                          <Cell value={yrGrowth} onChange={() => {}} onCommit={(v) => {
                            setExpenseYearGrowthPct(mobileYear, expense.id, v);
                          }} format="growthPct" isOverridden={data.yearOverrides?.[mobileYear]?.expenseGrowthPcts?.[expense.id] !== undefined} />
                          <span className="text-[10px] text-slate-400">/yr</span>
                        </div>
                      )}
                      {expense.isPercentOfEGI && egi > 0 && (
                        <span className="text-[10px] text-slate-400 tabular-nums">{fmt$(egi * (yrExpOv ?? computed) / 100)}</span>
                      )}
                    </>
                  );
                })()}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (isMobile) {
    const mobileEGI = mobileYear === 1
      ? computeEGI(data.yearOverrides?.[1]?.grossRent ?? data.grossRent.stabilized, data.yearOverrides?.[1]?.otherIncome ?? 0, data.yearOverrides?.[1]?.vacancyPct ?? 0, data.yearOverrides?.[1]?.creditLossPct ?? 0)
      : getEGIForYear(mobileYear);
    const mobileOpEx = mobileYear === 1 ? getOpExForYear(1, mobileEGI) : getOpExForYear(mobileYear, mobileEGI);

    return (
      <div className="flex flex-col max-h-[70vh]">
        {/* Mobile year navigation — sticky */}
        <div className="sticky top-0 z-20 bg-white dark:bg-slate-900 pb-2 border-b border-slate-100 dark:border-slate-700/60">
          <div className="flex items-center justify-between px-0.5 gap-2 pt-1">
            <span className="text-xs text-slate-500 dark:text-slate-400 font-medium min-w-0 truncate">
              T12 · Yr {mobileYear}{mobileYear === projectionYears ? ' ★ exit' : ''}
            </span>
            <div className="flex items-center gap-1 shrink-0 overflow-x-auto">
              <button type="button" onClick={() => setYearPage(p => Math.max(0, p - 1))} disabled={yearPage === 0}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 disabled:opacity-30 touch-manipulation">
                <ChevronLeft size={14} />
              </button>
              {Array.from({ length: projectionYears }, (_, i) => (
                <button key={i} type="button" onClick={() => setYearPage(i)}
                  className={`relative w-6 h-6 rounded-full text-xs font-semibold transition-all touch-manipulation ${
                    i === yearPage ? 'bg-primary-600 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400'
                  }`}>
                  {i + 1}
                </button>
              ))}
              <button type="button" onClick={() => setYearPage(p => Math.min(projectionYears - 1, p + 1))} disabled={yearPage === projectionYears - 1}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 disabled:opacity-30 touch-manipulation">
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        </div>

        <div className="overflow-y-auto mt-2">
        <div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
          {/* Section: Income */}
          <div className="px-3 pt-3 pb-1 bg-white dark:bg-slate-800">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">Income</p>
          </div>
          <MobileIncomeRow label="Gross Rent" overrideKey="grossRent" stabilized={data.grossRent.stabilized} growthPct={data.grossRent.growthPct} isPercent={false} onT12={v => setGrossRent('t12', v)} onStabilized={v => setGrossRent('stabilized', v)} onGrowthPct={v => setGrossRent('growthPct', v)} t12Val={data.grossRent.t12} />
          <MobileIncomeRow label="Other Income" overrideKey="otherIncome" stabilized={data.otherIncome.stabilized} growthPct={data.otherIncome.growthPct} isPercent={false} onT12={v => setOtherIncome('t12', v)} onStabilized={v => setOtherIncome('stabilized', v)} onGrowthPct={v => setOtherIncome('growthPct', v)} t12Val={data.otherIncome.t12} />
          <MobileIncomeRow label="Vacancy" overrideKey="vacancyPct" stabilized={data.vacancyPct.stabilized} growthPct={0} isPercent={true} onT12={v => setVacancy('t12', v)} onStabilized={v => setVacancy('stabilized', v)} onGrowthPct={() => {}} t12Val={data.vacancyPct.t12} />
          <MobileIncomeRow label="Credit Loss" overrideKey="creditLossPct" stabilized={cl.stabilized} growthPct={0} isPercent={true} onT12={v => setCreditLoss('t12', v)} onStabilized={v => setCreditLoss('stabilized', v)} onGrowthPct={() => {}} t12Val={cl.t12} />

          {/* EGI summary */}
          <div className="px-3 py-2.5 bg-slate-50 dark:bg-slate-700/30 border-b border-slate-100 dark:border-slate-700">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-0.5">EGI · T12</p>
                <span className="text-sm font-bold tabular-nums text-slate-700 dark:text-slate-300">{fmt$(t12EGI)}</span>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-0.5">EGI · Yr {mobileYear}</p>
                <span className="text-sm font-bold tabular-nums text-slate-700 dark:text-slate-300">{fmt$(mobileEGI)}</span>
              </div>
            </div>
          </div>

          {/* Section: Expenses */}
          <div className="px-3 pt-3 pb-1 bg-white dark:bg-slate-800">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">Operating Expenses</p>
          </div>
          {data.expenses.map(expense => <MobileExpenseRow key={expense.id} expense={expense} />)}

          {/* Add expense */}
          {addingRow ? (
            <div className="px-3 py-2.5 bg-primary-50/40 dark:bg-primary-900/10 border-t border-dashed border-primary-200 dark:border-primary-800/40">
              <input autoFocus className="text-sm font-medium text-slate-800 dark:text-slate-200 bg-transparent border-none outline-none ring-0 p-0 w-full placeholder:text-slate-400"
                placeholder="Expense name…" value={newExpenseName} onChange={e => setNewExpenseName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addExpense(newExpenseName); } if (e.key === 'Escape') { setAddingRow(false); setNewExpenseName(''); } }}
                onBlur={() => { if (newExpenseName.trim()) addExpense(newExpenseName); else { setAddingRow(false); setNewExpenseName(''); } }} />
            </div>
          ) : (
            <div className="border-t border-dashed border-slate-200 dark:border-slate-700">
              <button onClick={() => setAddingRow(true)} className="w-full flex items-center gap-2 px-3 py-2.5 text-xs font-medium text-slate-400 hover:text-primary-600 dark:hover:text-primary-400 hover:bg-primary-50/40 transition-colors touch-manipulation">
                <Plus size={13} /> Add expense
              </button>
            </div>
          )}

          {/* Total OpEx */}
          <div className="px-3 py-2.5 bg-slate-50 dark:bg-slate-700/30 border-t border-slate-100 dark:border-slate-700">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-0.5">OpEx · T12</p>
                <span className="text-sm font-bold tabular-nums text-slate-700 dark:text-slate-300">{fmt$(t12OpEx)}</span>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-0.5">OpEx · Yr {mobileYear}</p>
                <span className="text-sm font-bold tabular-nums text-slate-700 dark:text-slate-300">{fmt$(mobileOpEx)}</span>
              </div>
            </div>
          </div>

          {/* NOI */}
          <div className="px-3 py-2.5 bg-primary-50 dark:bg-primary-900/20 border-t border-primary-100 dark:border-primary-800/40">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wide text-primary-600 dark:text-primary-400 mb-0.5">NOI · T12</p>
                <span className="text-sm font-bold tabular-nums text-primary-700 dark:text-primary-300">{fmt$(t12EGI - t12OpEx)}</span>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wide text-primary-600 dark:text-primary-400 mb-0.5">NOI · Yr {mobileYear}</p>
                <span className="text-sm font-bold tabular-nums text-primary-700 dark:text-primary-300">{fmt$(mobileEGI - mobileOpEx)}</span>
              </div>
            </div>
          </div>
        </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col max-h-[70vh]">
      {/* Page navigation — sticky above scroll area */}
      {totalPages > 1 && (
        <div className="sticky top-0 z-30 bg-white dark:bg-slate-900 flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-700/60 mb-2 px-0.5">
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {visibleCols.map(c => c.type === 't12' ? 'T12' : `Yr ${c.year}`).join(' · ')}
            {visibleCols.some(c => c.type === 'year' && c.year === exitYear) && (
              <span className="ml-1 text-amber-500 font-medium">★ exit</span>
            )}
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
              className="p-1 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 disabled:opacity-30 transition-colors"
            >
              <ChevronLeft size={14} />
            </button>
            {Array.from({ length: totalPages }, (_, p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPage(p)}
                className={`relative w-6 h-6 rounded-full text-xs font-semibold transition-all ${
                  p === page
                    ? 'bg-primary-600 text-white'
                    : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-600'
                }`}
              >
                {p + 1}
                {pageHasOverride(p) && p !== page && (
                  <span className="absolute top-0 right-0 w-1.5 h-1.5 rounded-full bg-blue-400" />
                )}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
              disabled={page === totalPages - 1}
              className="p-1 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 disabled:opacity-30 transition-colors"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto overflow-y-auto w-full flex-1 border border-slate-200 dark:border-slate-700 rounded-xl">
        <div>
          <table className="w-full border-collapse text-sm" style={{ minWidth: 120 + 120 * visibleCols.length }}>

            {/* Headers */}
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-700">
                <th className="sticky top-0 left-0 z-40 bg-slate-50 dark:bg-slate-800/80 shadow-[1px_0_0_0_theme(colors.slate.200)] dark:shadow-[1px_0_0_0_theme(colors.slate.700)] px-3 py-2.5 w-[140px] text-left" />
                {visibleCols.map((col, i) => {
                  const { label, sub, color } = colHeader(col);
                  return (
                    <th key={`h-${i}`} className="sticky top-0 z-20 px-2 py-2.5 w-[120px] bg-slate-50 dark:bg-slate-800/80">
                      <div className={`text-right ${color}`}>
                        <p className="text-xs font-bold uppercase tracking-wide">{label}</p>
                        <div className="flex justify-end mt-0.5">
                          {sub === 'Override' ? (
                            <span className="inline-block text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400">Override</span>
                          ) : sub === '↗ Stabilizing' ? (
                            <span className="inline-block text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400">↗ Stabilizing</span>
                          ) : (
                            <span className="text-[10px] opacity-60">{sub}</span>
                          )}
                        </div>
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>

            <tbody>
              <SectionRow label="Income" span={totalCols} />

              {/* Gross Rent */}
              <tr className="group hover:bg-slate-50/60 dark:hover:bg-slate-700/20 transition-colors">
                <td className={`${STICKY} ${STICKY_HOVER} px-3 py-2.5 align-top`}>
                  <div className="flex items-center gap-1">
                    <span className="text-sm text-slate-700 dark:text-slate-300 flex-1">Gross Rent</span>
                    {incomeRowHasOverride('grossRent') && (
                      <button type="button" title="Revert row to formula"
                        onClick={() => revertIncomeRow('grossRent')}
                        className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-primary-500 hover:text-primary-700 dark:hover:text-primary-300 transition-all shrink-0">
                        <RotateCcw size={10} />
                      </button>
                    )}
                  </div>
                  {renderChainMap(y => isIncomeChainBroken('grossRent', y), y => isIncomeToggleOff('grossRent', y))}
                  {renderGrowthChainMap(y => data.yearOverrides?.[y]?.grossRentGrowthPct ?? data.grossRent.growthPct, y => data.yearOverrides?.[y]?.grossRentGrowthPct !== undefined, () => revertIncomeGrowthRow('grossRentGrowthPct', data.grossRent.growthPct))}
                </td>
                {visibleCols.map((col, i) => cloneElement(renderIncomeCell(col, 'grossRent', data.grossRent.stabilized, data.grossRent.growthPct, false, v => setGrossRent('t12', v), v => setGrossRent('stabilized', v), v => setGrossRent('growthPct', v), data.grossRent.t12), { key: `gr-${i}` }))}
              </tr>

              {/* Other Income */}
              <tr className="group hover:bg-slate-50/60 dark:hover:bg-slate-700/20 transition-colors">
                <td className={`${STICKY} ${STICKY_HOVER} px-3 py-2.5 align-top`}>
                  <div className="flex items-center gap-1">
                    <span className="text-sm text-slate-700 dark:text-slate-300 flex-1">Other Income</span>
                    {incomeRowHasOverride('otherIncome') && (
                      <button type="button" title="Revert row to formula"
                        onClick={() => revertIncomeRow('otherIncome')}
                        className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-primary-500 hover:text-primary-700 dark:hover:text-primary-300 transition-all shrink-0">
                        <RotateCcw size={10} />
                      </button>
                    )}
                  </div>
                  {renderChainMap(y => isIncomeChainBroken('otherIncome', y), y => isIncomeToggleOff('otherIncome', y))}
                  {renderGrowthChainMap(y => data.yearOverrides?.[y]?.otherIncomeGrowthPct ?? data.otherIncome.growthPct, y => data.yearOverrides?.[y]?.otherIncomeGrowthPct !== undefined, () => revertIncomeGrowthRow('otherIncomeGrowthPct', data.otherIncome.growthPct))}
                </td>
                {visibleCols.map((col, i) => cloneElement(renderIncomeCell(col, 'otherIncome', data.otherIncome.stabilized, data.otherIncome.growthPct, false, v => setOtherIncome('t12', v), v => setOtherIncome('stabilized', v), v => setOtherIncome('growthPct', v), data.otherIncome.t12), { key: `oi-${i}` }))}
              </tr>

              {/* Vacancy */}
              <tr className="group hover:bg-slate-50/60 dark:hover:bg-slate-700/20 transition-colors">
                <td className={`${STICKY} ${STICKY_HOVER} px-3 py-2.5 align-top`}>
                  <div className="flex items-center gap-1">
                    <span className="text-sm text-slate-700 dark:text-slate-300 flex-1">Vacancy</span>
                    {incomeRowHasOverride('vacancyPct') && (
                      <button type="button" title="Revert row to formula"
                        onClick={() => revertIncomeRow('vacancyPct')}
                        className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-primary-500 hover:text-primary-700 dark:hover:text-primary-300 transition-all shrink-0">
                        <RotateCcw size={10} />
                      </button>
                    )}
                  </div>
                  {renderChainMap(y => isIncomeChainBroken('vacancyPct', y), y => isIncomeToggleOff('vacancyPct', y))}
                </td>
                {visibleCols.map((col, i) => cloneElement(renderIncomeCell(col, 'vacancyPct', data.vacancyPct.stabilized, 0, true, v => setVacancy('t12', v), v => setVacancy('stabilized', v), () => {}, data.vacancyPct.t12), { key: `vac-${i}` }))}
              </tr>

              {/* Credit Loss */}
              <tr className="group hover:bg-slate-50/60 dark:hover:bg-slate-700/20 transition-colors">
                <td className={`${STICKY} ${STICKY_HOVER} px-3 py-2.5 align-top`}>
                  <div className="flex items-center gap-1">
                    <span className="text-sm text-slate-700 dark:text-slate-300 flex-1">Credit Loss</span>
                    {incomeRowHasOverride('creditLossPct') && (
                      <button type="button" title="Revert row to formula"
                        onClick={() => revertIncomeRow('creditLossPct')}
                        className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-primary-500 hover:text-primary-700 dark:hover:text-primary-300 transition-all shrink-0">
                        <RotateCcw size={10} />
                      </button>
                    )}
                  </div>
                  <p className="text-[10px] text-slate-400 leading-tight">Concessions, bad debt</p>
                  {renderChainMap(y => isIncomeChainBroken('creditLossPct', y), y => isIncomeToggleOff('creditLossPct', y))}
                </td>
                {visibleCols.map((col, i) => cloneElement(renderIncomeCell(col, 'creditLossPct', cl.stabilized, 0, true, v => setCreditLoss('t12', v), v => setCreditLoss('stabilized', v), () => {}, cl.t12), { key: `cl-${i}` }))}
              </tr>

              {/* EGI */}
              <tr className="bg-slate-50 dark:bg-slate-700/30 border-t border-slate-100 dark:border-slate-700">
                <td className={`sticky left-0 z-10 px-3 py-2.5 ${STICKY_MUTED}`}>
                  <span className="text-xs font-bold uppercase tracking-wide text-slate-600 dark:text-slate-400">Eff. Gross Income</span>
                </td>
                {visibleCols.map((col, i) => {
                  const val = col.type === 't12' ? t12EGI : col.year === 1
                    ? computeEGI(data.yearOverrides?.[1]?.grossRent ?? data.grossRent.stabilized, data.yearOverrides?.[1]?.otherIncome ?? 0, data.yearOverrides?.[1]?.vacancyPct ?? 0, data.yearOverrides?.[1]?.creditLossPct ?? 0)
                    : getEGIForYear(col.year);
                  return <td key={`egi-${i}`} className="px-2 py-2.5 text-right whitespace-nowrap bg-slate-50 dark:bg-slate-700/30"><span className="text-sm font-bold tabular-nums text-slate-700 dark:text-slate-300">{fmt$(val)}</span></td>;
                })}
              </tr>

              <SectionRow label="Operating Expenses" span={totalCols} />

              {data.expenses.map(expense => {
                const fmt = expense.isPercentOfEGI ? 'percent' : 'currency';
                return (
                  <tr key={expense.id} className="group hover:bg-slate-50/60 dark:hover:bg-slate-700/20 transition-colors">
                    <td className={`${STICKY} ${STICKY_HOVER} px-3 py-2.5 align-top`}>
                      <div className="flex items-center gap-1">
                        <LabelCell value={expense.name} onChange={name => updateExpense(expense.id, { name })} />
                        {expenseRowHasOverride(expense.id) && (
                          <button type="button" title="Revert expense row"
                            onClick={() => revertExpenseRow(expense)}
                            className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-primary-500 hover:text-primary-700 transition-all shrink-0">
                            <RotateCcw size={10} />
                          </button>
                        )}
                        {showWarnings && !expense.isPercentOfEGI && expense.stabilizedValue === 0 && (
                          <AlertTriangle size={12} className="text-amber-500 shrink-0" data-testid={`expense-warning-${expense.name}`} />
                        )}
                        {!NON_TOGGLEABLE_EXPENSES.has(expense.name) && (
                          <button
                            type="button"
                            onClick={() => toggleExpenseType(expense.id)}
                            title={expense.isPercentOfEGI ? 'Convert to fixed $ amount' : 'Convert to % of Eff. Gross Income'}
                            aria-label={expense.isPercentOfEGI ? 'Convert to fixed amount' : 'Convert to percent of EGI'}
                            className="opacity-0 group-hover:opacity-100 shrink-0 text-[9px] font-semibold px-1 py-0.5 rounded transition-all text-slate-400 hover:text-primary-600 dark:hover:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/30"
                          >
                            {expense.isPercentOfEGI ? '→ $' : '→ %'}
                          </button>
                        )}
                      </div>
                      {expense.isPercentOfEGI && (
                        <span className="text-[10px] text-slate-400">% of Eff. Gross Income</span>
                      )}
                      {renderChainMap(y => isExpenseChainBroken(expense.id, y), y => isExpenseToggleOff(expense.id, y))}
                      {!expense.isPercentOfEGI && renderGrowthChainMap(y => data.yearOverrides?.[y]?.expenseGrowthPcts?.[expense.id] ?? expense.growthPct, y => data.yearOverrides?.[y]?.expenseGrowthPcts?.[expense.id] !== undefined, () => revertExpenseGrowthRow(expense.id, expense.growthPct))}
                    </td>
                    {visibleCols.flatMap((col, i) => {
                      const prevCol = visibleCols[i - 1];
                      const bg = '';

                      if (col.type === 't12') {
                        const cell = (
                          <td key={`exp-t12-${expense.id}`} className="px-2 py-2.5 align-top">
                            <div className="flex flex-col items-end gap-0.5">
                              <Cell value={expense.t12Value} onChange={v => updateExpense(expense.id, { t12Value: v })} format={fmt} />
                              {expense.isPercentOfEGI && t12EGI > 0 && (
                                <span className="text-[10px] text-slate-400 tabular-nums">{fmt$(t12EGI * expense.t12Value / 100)}</span>
                              )}
                            </div>
                          </td>
                        );
                        return [cell];
                      }

                      const { year } = col;
                      const egi = year === 1
                        ? computeEGI(data.yearOverrides?.[1]?.grossRent ?? data.grossRent.stabilized, data.yearOverrides?.[1]?.otherIncome ?? 0, data.yearOverrides?.[1]?.vacancyPct ?? 0, data.yearOverrides?.[1]?.creditLossPct ?? 0)
                        : getEGIForYear(year);

                      if (year === 1) {
                        const cell = (
                          <td key={`exp-yr1-${expense.id}`} className={`px-2 py-2.5 align-top ${bg}`}>
                            <div className="flex flex-col items-end gap-0.5">
                              <Cell value={expense.stabilizedValue} onChange={v => updateExpense(expense.id, { stabilizedValue: v })} format={fmt} />
                              {expense.isPercentOfEGI && egi > 0 && <span className="text-[10px] text-slate-400 tabular-nums">{fmt$(egi * expense.stabilizedValue / 100)}</span>}
                              {!expense.isPercentOfEGI && (
                                <div className="flex items-center gap-0.5">
                                  <Cell value={expense.growthPct} onChange={v => updateExpense(expense.id, { growthPct: v })} format="growthPct" />
                                  <span className="text-[10px] text-slate-400">/yr</span>
                                </div>
                              )}
                            </div>
                          </td>
                        );
                        return [cell];
                      }

                      const yrExpOv = data.yearOverrides?.[year]?.expenses?.[expense.id];
                      const computed = expense.isPercentOfEGI
                        ? getEffectivePctForYear(expense.id, expense.stabilizedValue, year)
                        : chainedExpenseValue(expense, year);
                      const displayVal = yrExpOv ?? computed;
                      const yrGrowth = data.yearOverrides?.[year]?.expenseGrowthPcts?.[expense.id] ?? expense.growthPct;
                      const expHasDownstream = getDownstreamGrayExpenseYears(expense.id, year).length > 0;

                      const cell = (
                        <td key={`exp-${expense.id}-${year}`} className={`px-2 py-2.5 align-top ${bg}`}>
                          <div className="flex flex-col items-end gap-0.5">
                            <YearCell computed={computed} override={typeof yrExpOv === 'number' ? yrExpOv : undefined} format={fmt}
                              onOverride={v => setExpenseYearOverride(year, expense.id, v)}
                              onClearOverride={year > 1 ? () => clearExpenseYearOverride(year, expense.id) : undefined}
                              onYearOnly={v => applyExpenseYearOnly(year, expense.id, v)}
                              cascadeDelay={(year - 1) * 50}
                              pushToFutureOff={data.yearOverrides?.[year]?.toggleOffExpenses?.[expense.id] === true}
                            />
                            {expense.isPercentOfEGI && egi > 0 && <span className="text-[10px] text-slate-400 tabular-nums">{fmt$(egi * displayVal / 100)}</span>}
                            {!expense.isPercentOfEGI && (
                              <div className="flex items-center gap-0.5">
                                <YearCell
                                  computed={expense.growthPct}
                                  override={data.yearOverrides?.[year]?.expenseGrowthPcts?.[expense.id] !== undefined ? yrGrowth : undefined}
                                  format="growthPct"
                                  onOverride={v => setExpenseYearGrowthPct(year, expense.id, v)}
                                  onClearOverride={() => clearExpenseYearGrowthPct(year, expense.id)}
                                  onYearOnly={v => applyExpenseGrowthYearOnly(year, expense.id, v)}
                                  pushToFutureOff={data.yearOverrides?.[year]?.toggleOffExpenseGrowthPcts?.[expense.id] === true}
                                />
                                <span className="text-[10px] text-slate-400">/yr</span>
                              </div>
                            )}
                          </div>
                        </td>
                      );
                      return [cell];
                    })}
                    <td className="w-0 p-0 relative">
                      {!expense.id.startsWith('preset-') && (
                        <button aria-label="Delete expense" onClick={() => deleteExpense(expense.id)} className="absolute top-2 right-1 opacity-0 group-hover:opacity-100 p-1 rounded text-red-400 bg-red-50 dark:bg-red-900/30 hover:bg-red-100 transition-all"><X size={12} /></button>
                      )}
                    </td>
                  </tr>
                );
              })}

              {/* Add expense */}
              {addingRow ? (
                <tr className="bg-primary-50/40 dark:bg-primary-900/10 border-t border-dashed border-primary-200 dark:border-primary-800/40">
                  <td colSpan={totalCols} className="px-3 py-2.5 sticky left-0 bg-primary-50/40 dark:bg-primary-900/10">
                    <input autoFocus className="text-sm font-medium text-slate-800 dark:text-slate-200 bg-transparent border-none outline-none ring-0 p-0 w-full placeholder:text-slate-400" placeholder="Expense name…" value={newExpenseName} onChange={e => setNewExpenseName(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addExpense(newExpenseName); } if (e.key === 'Escape') { setAddingRow(false); setNewExpenseName(''); } }}
                      onBlur={() => { if (newExpenseName.trim()) addExpense(newExpenseName); else { setAddingRow(false); setNewExpenseName(''); } }} />
                  </td>
                </tr>
              ) : (
                <tr className="border-t border-dashed border-slate-200 dark:border-slate-700">
                  <td colSpan={totalCols} className="sticky left-0">
                    <button onClick={() => setAddingRow(true)} className="w-full flex items-center gap-2 px-3 py-2.5 text-xs font-medium text-slate-400 hover:text-primary-600 dark:hover:text-primary-400 hover:bg-primary-50/40 transition-colors"><Plus size={13} /> Add expense</button>
                  </td>
                </tr>
              )}
            </tbody>

            <tfoot>
              {/* Total OpEx */}
              <tr className="bg-slate-50 dark:bg-slate-700/30 border-t border-slate-100 dark:border-slate-700">
                <td className={`sticky left-0 z-10 px-3 py-2.5 ${STICKY_MUTED}`}>
                  <span className="text-xs font-bold uppercase tracking-wide text-slate-600 dark:text-slate-400">Total OpEx</span>
                </td>
                {visibleCols.map((col, i) => {
                  const egi = col.type === 't12' ? t12EGI : col.year === 1
                    ? computeEGI(data.yearOverrides?.[1]?.grossRent ?? data.grossRent.stabilized, data.yearOverrides?.[1]?.otherIncome ?? 0, data.yearOverrides?.[1]?.vacancyPct ?? 0, data.yearOverrides?.[1]?.creditLossPct ?? 0)
                    : getEGIForYear(col.year);
                  const val = col.type === 't12' ? t12OpEx : getOpExForYear(col.year, egi);
                  return <td key={`opex-${i}`} className="px-2 py-2.5 text-right whitespace-nowrap bg-slate-50 dark:bg-slate-700/30"><span className="text-sm font-bold tabular-nums text-slate-700 dark:text-slate-300">{fmt$(val)}</span></td>;
                })}
              </tr>

              {/* NOI */}
              <tr className="bg-primary-50 dark:bg-primary-900/20 border-t border-b border-primary-100 dark:border-primary-800/40">
                <td className={`sticky left-0 z-10 px-3 py-2.5 ${STICKY_HIGHLIGHT}`}>
                  <span className="text-xs font-bold uppercase tracking-wide text-primary-700 dark:text-primary-300">NOI</span>
                </td>
                {visibleCols.map((col, i) => {
                  const egi = col.type === 't12' ? t12EGI : col.year === 1
                    ? computeEGI(data.yearOverrides?.[1]?.grossRent ?? data.grossRent.stabilized, data.yearOverrides?.[1]?.otherIncome ?? 0, data.yearOverrides?.[1]?.vacancyPct ?? 0, data.yearOverrides?.[1]?.creditLossPct ?? 0)
                    : getEGIForYear(col.year);
                  const opex = col.type === 't12' ? t12OpEx : getOpExForYear(col.year, egi);
                  const val = egi - opex;
                  return <td key={`noi-${i}`} className="px-2 py-2.5 text-right whitespace-nowrap bg-primary-50 dark:bg-primary-900/20"><span className="text-sm font-bold tabular-nums text-primary-700 dark:text-primary-300">{fmt$(val)}</span></td>;
                })}
              </tr>

              <tr>
                <td colSpan={totalCols} className="px-3 py-2 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-100 dark:border-slate-700">
                  <span className="text-[10px] text-slate-400 dark:text-slate-500">
                    Click any value to edit · <span className="text-blue-400 font-medium">Blue</span> = override (↺ on label to reset row) · <span className="text-orange-400 font-medium inline-flex items-center gap-0.5"><Unlink size={9} /> broken chain</span> = cascade stops here · <span className="text-amber-500 font-medium">↗</span> = stabilizing · <span className="text-amber-500 font-medium">★</span> = exit year
                  </span>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}
