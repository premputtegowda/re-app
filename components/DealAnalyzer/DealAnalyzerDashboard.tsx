'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2, TrendingUp, ChevronRight, PenLine, Home, Building2, ArrowUpDown, X, GitCompare, SlidersHorizontal, BarChart2, Coins, ArrowRight, Target } from 'lucide-react';
import { Button } from '@/components/UI/Button';
import { PageHeader } from '@/components/UI/PageHeader';
import { useDealAnalyzerStore } from '@/lib/dealAnalyzerStore';
import { formatCurrency, formatCurrencyCompact, formatPct, formatMultiple } from '@/utils/dealAnalyzerCalc';
import { computeDeterministicPrices } from '@/utils/monteCarlo';
import type { SavedDeal, CoCResult, CoCScenarioType } from '@/types';
import type { SavedMCResults, MCRanges } from '@/utils/monteCarlo';
import { STATE_ABBR, parseAddress, normalizeStateInput } from '@/utils/stateSearch';

// ── Helpers ────────────────────────────────────────────────────────────────────

type SortKey = 'irr' | 'coc' | 'verdict' | 'date' | 'price';

function getBestResult(deal: SavedDeal): CoCResult | null {
  return deal.results.base ?? deal.results.bull ?? deal.results.bear ?? null;
}

function getVerdict(result: CoCResult | null): { label: string; score: number; color: string; badge: string } {
  if (!result) return { label: 'Draft', score: -1, color: 'text-slate-400', badge: 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400' };
  // Score weights IRR (60%) and CoC (40%) — industry standard thresholds
  const score = (result.irr ?? 0) * 0.6 + result.avgCoCReturn * 0.4;
  if (score >= 17) return { label: 'Strong',   score, color: 'text-secondary-600 dark:text-secondary-400', badge: 'bg-secondary-100 dark:bg-secondary-900/40 text-secondary-700 dark:text-secondary-300' };
  if (score >= 12) return { label: 'Solid',    score, color: 'text-primary-600 dark:text-primary-400',     badge: 'bg-primary-100 dark:bg-primary-900/40 text-primary-700 dark:text-primary-300' };
  if (score >= 7)  return { label: 'Marginal', score, color: 'text-amber-600 dark:text-amber-400',         badge: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300' };
  return                   { label: 'Weak',    score, color: 'text-red-600 dark:text-red-400',             badge: 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300' };
}

function formatRelativeDate(iso: string): string {
  const diffDays = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

// ── Portfolio summary ─────────────────────────────────────────────────────────

function PortfolioSummary({ deals }: { deals: SavedDeal[] }) {
  const analyses = deals.filter(d => getBestResult(d));
  if (analyses.length === 0) return null;

  const results = analyses.map(d => getBestResult(d)!);
  const strongCount = analyses.filter(d => getVerdict(getBestResult(d)).label === 'Strong').length;
  const solidCount = analyses.filter(d => getVerdict(getBestResult(d)).label === 'Solid').length;
  const irrValues = results.map(r => r.irr).filter((v): v is number => v !== null);
  const bestIRR = irrValues.length > 0 ? Math.max(...irrValues) : null;
  const bestCoC = results.length > 0 ? Math.max(...results.map(r => r.avgCoCReturn)) : null;

  const stats = [
    { label: 'Deals Analyzed', value: analyses.length.toString() },
    { label: 'Strong', value: strongCount.toString() },
    { label: 'Solid', value: solidCount.toString() },
    { label: 'Best IRR', value: bestIRR !== null ? formatPct(bestIRR) : '—' },
    { label: 'Best CoC', value: bestCoC !== null ? formatPct(bestCoC) : '—' },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
      {stats.map(({ label, value }) => (
        <div key={label} className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500">{label}</p>
          <p className="text-xl font-bold text-slate-900 dark:text-white mt-0.5 tabular-nums">{value}</p>
        </div>
      ))}
    </div>
  );
}

// ── Deal card ─────────────────────────────────────────────────────────────────

interface DealCardProps {
  deal: SavedDeal;
  selected: boolean;
  compareMode: boolean;
  onLoad: () => void;
  onDelete: () => void;
  onToggleSelect: () => void;
}

function DealCard({ deal, selected, compareMode, onLoad, onDelete, onToggleSelect }: DealCardProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const result = getBestResult(deal);
  const verdict = getVerdict(result);
  const acq = deal.acquisition;
  const isDraft = !result;
  const mcResults = deal.mcResults as SavedMCResults | undefined;
  // Use stored deterministic prices if available; otherwise compute from saved ranges
  const { recommendedMaxPrice, conservativeMaxPrice, targetIRR } = useMemo(() => {
    if (!mcResults) return { recommendedMaxPrice: null, conservativeMaxPrice: null, targetIRR: null };
    const storedIRR = mcResults.targetIRR ?? null;
    if (mcResults.recommendedMaxPrice !== undefined && mcResults.conservativeMaxPrice !== undefined) {
      return { recommendedMaxPrice: mcResults.recommendedMaxPrice, conservativeMaxPrice: mcResults.conservativeMaxPrice, targetIRR: storedIRR };
    }
    // Fallback: compute from saved ranges (deals run before deterministic prices were stored)
    const savedRanges = deal.mcRanges as unknown as MCRanges | undefined;
    if (!savedRanges?.targetRentPerUnit) return { recommendedMaxPrice: mcResults.recommendedMaxPrice ?? null, conservativeMaxPrice: null, targetIRR: storedIRR };
    const prices = computeDeterministicPrices(
      savedRanges, 12,
      deal.acquisition, deal.operations, deal.proForma, deal.refinance,
      deal.acquisition.units || 1, 0,
    );
    return { ...prices, targetIRR: storedIRR ?? 12 };
  }, [mcResults, deal.mcRanges, deal.acquisition, deal.operations, deal.proForma, deal.refinance]);

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirmDelete) onDelete();
    else setConfirmDelete(true);
  };

  const handleClick = () => {
    if (compareMode) onToggleSelect();
    else onLoad();
  };

  const PropertyIcon = acq.propertyType === 'sfr' ? Home : Building2;
  const totalUnits = acq.unitMix && acq.unitMix.length > 0
    ? acq.unitMix.reduce((s, e) => s + e.count, 0)
    : acq.units;
  const unitLabel = acq.propertyType === 'sfr'
    ? [acq.sfrBeds && `${acq.sfrBeds}bd`, acq.sfrBaths && `${acq.sfrBaths}ba`].filter(Boolean).join('/')
    : totalUnits > 0 ? `${totalUnits} units` : '';

  const metrics = result ? [
    { icon: TrendingUp, label: 'IRR',  value: result.irr !== null ? formatPct(result.irr) : '—' },
    { icon: BarChart2,  label: 'CoC',  value: formatPct(result.avgCoCReturn) },
    { icon: Coins,      label: 'EM',   value: formatMultiple(result.equityMultiple) },
    { icon: ArrowRight, label: 'CF',   value: formatCurrencyCompact(result.totalCashFlow) },
  ] : [];

  return (
    <div
      onClick={handleClick}
      className={`relative rounded-xl border-2 bg-white dark:bg-slate-800 transition-all cursor-pointer group overflow-hidden ${
        selected
          ? 'border-primary-500 shadow-md shadow-primary-100 dark:shadow-primary-900/20'
          : 'border-slate-200 dark:border-slate-700 hover:border-primary-300 dark:hover:border-primary-600 hover:shadow-md'
      }`}
    >
      {/* Compare checkbox */}
      {compareMode && (
        <div className={`absolute top-3 right-3 w-5 h-5 rounded-full border-2 flex items-center justify-center z-10 transition-all ${
          selected ? 'bg-primary-500 border-primary-500' : 'border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800'
        }`}>
          {selected && <span className="text-white text-[10px] font-bold">✓</span>}
        </div>
      )}

      <div className="px-4 pt-3.5 pb-3 space-y-3">

        {/* ── Row 1: Name + address + verdict ── */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-base font-bold text-slate-900 dark:text-white truncate group-hover:text-primary-700 dark:group-hover:text-primary-300 transition-colors leading-tight">
              {deal.name}
            </p>
            {acq.propertyAddress?.trim() && acq.propertyAddress.trim() !== deal.name && (
              <p className="text-[11px] text-slate-400 dark:text-slate-500 truncate mt-0.5">{acq.propertyAddress}</p>
            )}
          </div>
          <span className={`shrink-0 text-[10px] font-bold uppercase tracking-wide px-2.5 py-1 rounded-full ${verdict.badge}`}>
            {isDraft ? 'Draft' : verdict.label}
          </span>
        </div>

        {/* ── Row 2: Price + financing + metric pills ── */}
        <div className="flex items-center gap-3 flex-wrap">
          {/* Price block */}
          <div className="flex items-baseline gap-2 shrink-0">
            <span className="text-xl font-black text-slate-900 dark:text-white tabular-nums">
              {acq.purchasePrice > 0 ? formatCurrencyCompact(acq.purchasePrice) : '—'}
            </span>
            <div className="text-[11px] text-slate-400 dark:text-slate-500 leading-tight">
              {acq.downPaymentPct > 0 && <span>{acq.downPaymentPct}% down</span>}
              {acq.interestRate > 0 && acq.loanTermYears > 0 && (
                <span className="block">{acq.interestRate}% · {acq.loanTermYears}yr</span>
              )}
            </div>
          </div>

          {/* Metric pills */}
          {metrics.length > 0 && (() => {
            const p50Irr = mcResults?.p50?.irr ?? null;
            const p50BelowTarget = targetIRR !== null && p50Irr !== null && p50Irr < targetIRR;
            return (
              <div className="flex items-start gap-1.5 flex-wrap">
                {metrics.map(({ icon: Icon, label, value }) => (
                  <div key={label} className="flex flex-col items-center gap-0.5">
                    <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-slate-100 dark:bg-slate-700/60 border border-slate-200 dark:border-slate-600">
                      <Icon size={10} className="text-slate-400 shrink-0" />
                      <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400">{label}</span>
                      <span className="text-[11px] font-bold text-slate-800 dark:text-slate-200 tabular-nums">{value}</span>
                    </div>
                    {label === 'IRR' && p50Irr !== null && (
                      <span className={`inline-flex items-center gap-0.5 text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${
                        p50BelowTarget
                          ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'
                          : 'bg-secondary-100 dark:bg-secondary-900/30 text-secondary-700 dark:text-secondary-400'
                      }`}>
                        <span>~</span>
                        <span>Median {p50Irr.toFixed(1)}%</span>
                      </span>
                    )}
                  </div>
                ))}
              </div>
            );
          })()}
          {!result && (
            <span className="text-xs text-slate-400 italic">Open to run analysis</span>
          )}
        </div>

        {/* ── Row 3: Price range bar ── */}
        {(conservativeMaxPrice !== null || recommendedMaxPrice !== null) && (() => {
          const p50Irr = mcResults?.p50?.irr ?? null;
          const p50BelowTarget = targetIRR !== null && p50Irr !== null && p50Irr < targetIRR;
          return (
            <div className="space-y-1.5">
              {/* Target IRR indicator */}
              <div className="flex items-center gap-2">
                {targetIRR !== null && (
                  <div className="flex items-center gap-1">
                    <Target size={10} className="text-slate-400 shrink-0" />
                    <span className="text-[10px] text-slate-400 dark:text-slate-500">
                      Target {targetIRR}% IRR
                    </span>
                  </div>
                )}
              </div>
              {/* Gradient bar */}
              <div className="h-2 rounded-full" style={{ background: 'linear-gradient(to right, #22c55e, #f59e0b)' }} />
              {/* Labels with uncertainty sub-text */}
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-[9px] font-bold text-secondary-600 dark:text-secondary-400 uppercase tracking-wide leading-none">Ideal Entry</p>
                  <p className="text-xs font-bold text-secondary-700 dark:text-secondary-300 tabular-nums mt-0.5">
                    {conservativeMaxPrice !== null ? formatCurrencyCompact(conservativeMaxPrice) : '—'}
                  </p>
                  <p className="text-[9px] text-slate-400 dark:text-slate-500 mt-0.5">stress-tested</p>
                </div>
                <div className="text-right">
                  <p className="text-[9px] font-bold text-amber-600 dark:text-amber-400 uppercase tracking-wide leading-none">Recommended Max</p>
                  <p className="text-xs font-bold text-amber-700 dark:text-amber-300 tabular-nums mt-0.5">
                    {recommendedMaxPrice !== null ? formatCurrencyCompact(recommendedMaxPrice) : '—'}
                  </p>
                </div>
              </div>
            </div>
          );
        })()}

        {/* ── Row 4: Footer ── */}
        <div className="flex items-center justify-between pt-0.5 border-t border-slate-100 dark:border-slate-700/60">
          <div className="flex items-center gap-1.5">
            <PropertyIcon size={11} className="text-slate-400 shrink-0" />
            <span className="text-[10px] text-slate-500 dark:text-slate-400">
              {acq.propertyType?.toUpperCase()}{unitLabel ? ` · ${unitLabel}` : ''}
            </span>
            <span className="text-slate-200 dark:text-slate-600 text-xs">·</span>
            <span className="text-[10px] text-slate-400">{formatRelativeDate(deal.savedAt)}</span>
          </div>
          <div className="flex items-center gap-1">
            {confirmDelete ? (
              <div className="flex items-center gap-1 animate-fade-in">
                <button
                  type="button"
                  onClick={handleDelete}
                  className="px-2 py-1 rounded-lg bg-red-500 text-white text-[10px] font-semibold hover:bg-red-600 transition-colors"
                >
                  Delete
                </button>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setConfirmDelete(false); }}
                  className="px-2 py-1 rounded-lg border border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400 text-[10px] font-medium hover:border-slate-400 transition-colors"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={handleDelete}
                className="p-1.5 rounded-lg transition-all text-slate-300 dark:text-slate-600 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 opacity-0 group-hover:opacity-100"
              >
                <Trash2 size={12} />
              </button>
            )}
            {!compareMode && (
              <ArrowRight size={15} className="text-slate-300 dark:text-slate-600 group-hover:text-primary-400 transition-colors" />
            )}
          </div>
        </div>

      </div>
    </div>
  );
}

// ── Compare panel ─────────────────────────────────────────────────────────────

function ComparePanel({ deals, onClose, onOpen }: { deals: SavedDeal[]; onClose: () => void; onOpen: (id: string) => void }) {
  const results = deals.map(d => getBestResult(d));

  const rows: Array<{ label: string; values: string[] }> = [
    { label: 'Verdict',          values: deals.map((d, i) => getVerdict(results[i]).label) },
    { label: 'Purchase Price',   values: deals.map(d => d.acquisition.purchasePrice > 0 ? formatCurrency(d.acquisition.purchasePrice) : '—') },
    { label: 'Total Invested',   values: results.map(r => r ? formatCurrency(r.totalInvested) : '—') },
    { label: 'ARV',              values: deals.map(d => d.acquisition.arv > 0 ? formatCurrency(d.acquisition.arv) : '—') },
    { label: 'IRR',              values: results.map(r => r ? (r.irr !== null ? formatPct(r.irr) : '—') : '—') },
    { label: 'Avg CoC Return',   values: results.map(r => r ? formatPct(r.avgCoCReturn) : '—') },
    { label: 'Equity Multiple',  values: results.map(r => r ? formatMultiple(r.equityMultiple) : '—') },
    { label: 'Total Cash Flow',  values: results.map(r => r ? formatCurrency(r.totalCashFlow) : '—') },
  ];

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-white dark:bg-slate-900 border-t-2 border-primary-200 dark:border-primary-800 shadow-2xl">
      <div className="max-w-3xl mx-auto px-4 py-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <GitCompare size={16} className="text-primary-500" />
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">Comparing {deals.length} deals</p>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="text-left text-[10px] font-semibold uppercase tracking-widest text-slate-400 pb-2 pr-4 w-32">Metric</th>
                {deals.map(d => (
                  <th key={d.id} className="text-left pb-2 px-2">
                    <button type="button" onClick={() => onOpen(d.id)} className="text-xs font-semibold text-primary-600 dark:text-primary-400 hover:underline truncate max-w-[140px] block text-left">
                      {d.name}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
              {rows.map(({ label, values }) => (
                <tr key={label}>
                  <td className="py-2 pr-4 text-[11px] text-slate-500 dark:text-slate-400 font-medium">{label}</td>
                  {values.map((v, i) => (
                    <td key={i} className="py-2 px-2 text-xs font-semibold text-slate-800 dark:text-slate-200 tabular-nums">{v}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── Filters ───────────────────────────────────────────────────────────────────

type Operator = '>=' | '<=' | '=' | 'between';

interface NumFilter { op: Operator; value: string; value2: string }

interface Filters {
  search:       string;
  propertyType: 'sfr' | 'mfr' | '';
  units:        NumFilter;
  irr:          NumFilter;
  coc:          NumFilter;
  price:        NumFilter;
  state:        string;
  city:         string;
}

const DEFAULT_NUM: NumFilter = { op: '>=', value: '', value2: '' };

const DEFAULT_FILTERS: Filters = {
  search: '',
  propertyType: '',
  units: { ...DEFAULT_NUM, op: '>=' },
  irr:   { ...DEFAULT_NUM },
  coc:   { ...DEFAULT_NUM },
  price: { ...DEFAULT_NUM, op: '<=' },
  state: '',
  city:  '',
};


function applyFilters(deals: SavedDeal[], filters: Filters): SavedDeal[] {
  return deals.filter(deal => {
    const result = getBestResult(deal);
    const acq = deal.acquisition;

    if (filters.search) {
      const q = filters.search.toLowerCase();
      if (!deal.name.toLowerCase().includes(q) && !(acq.propertyAddress ?? '').toLowerCase().includes(q)) return false;
    }

    if (filters.propertyType && acq.propertyType !== filters.propertyType) return false;

    const check = (val: number | null, f: NumFilter) => {
      if (!f.value) return true;
      if (val === null) return false;
      const n = parseFloat(f.value);
      if (isNaN(n)) return true;
      if (f.op === 'between') {
        const n2 = parseFloat(f.value2);
        return isNaN(n2) ? val >= n : val >= n && val <= n2;
      }
      if (f.op === '>=') return val >= n;
      if (f.op === '<=') return val <= n;
      return Math.abs(val - n) < 0.01;
    };

    if (!check(result?.irr ?? null, filters.irr)) return false;
    if (!check(result?.avgCoCReturn ?? null, filters.coc)) return false;
    if (!check(acq.purchasePrice || null, filters.price)) return false;

    const unitCount = acq.propertyType === 'mfr' ? acq.units : null;
    if (!check(unitCount, filters.units)) return false;

    if (filters.state || filters.city) {
      const { city, state } = parseAddress(acq.propertyAddress ?? '');
      if (filters.state && state !== normalizeStateInput(filters.state)) return false;
      if (filters.city && !city.toLowerCase().includes(filters.city.toLowerCase())) return false;
    }

    return true;
  });
}

function NumFilterInput({ label, filterKey, filters, onChange }: {
  label: string;
  filterKey: 'irr' | 'coc' | 'price' | 'units';
  filters: Filters;
  onChange: (f: Filters) => void;
}) {
  const f = filters[filterKey] as NumFilter;
  const isBetween = f.op === 'between';
  const ops: Operator[] = filterKey === 'units' ? ['>=', '<=', '=', 'between'] : ['>=', '<=', '='];
  const placeholder = filterKey === 'price' ? 'e.g. 500000' : filterKey === 'units' ? 'e.g. 10' : 'e.g. 15';

  const set = (field: keyof NumFilter, val: string) =>
    onChange({ ...filters, [filterKey]: { ...f, [field]: val } });

  return (
    <div>
      <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5">{label}</p>
      <div className="flex gap-1.5">
        <select value={f.op} onChange={e => set('op', e.target.value)}
          className="text-xs bg-slate-100 dark:bg-slate-700 border-none rounded-lg px-2 py-1.5 text-slate-600 dark:text-slate-300 font-semibold cursor-pointer outline-none shrink-0">
          {ops.map(op => <option key={op} value={op}>{op === 'between' ? 'between' : op}</option>)}
        </select>
        <input type="number" placeholder={placeholder} min={0}
          value={f.value}
          onChange={e => set('value', e.target.value)}
          className="input text-sm flex-1 min-w-0" />
        {isBetween && (
          <>
            <span className="text-xs text-slate-400 self-center shrink-0">–</span>
            <input type="number" placeholder={placeholder} min={0}
              value={f.value2}
              onChange={e => set('value2', e.target.value)}
              className="input text-sm flex-1 min-w-0" />
          </>
        )}
      </div>
    </div>
  );
}

function FilterBar({ filters, onChange, onClear, activeCount, totalCount, filteredCount }: {
  filters: Filters;
  onChange: (f: Filters) => void;
  onClear: () => void;
  activeCount: number;
  totalCount: number;
  filteredCount: number;
}) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const advancedCount = activeCount - (filters.search ? 1 : 0);
  const showUnits = filters.propertyType === 'mfr' || filters.propertyType === '';

  return (
    <div className="space-y-3">
      {/* Search row — always visible */}
      <div className="flex gap-2">
        <div className="flex-1 relative">
          <SlidersHorizontal size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <input
            type="text"
            placeholder="Search by name, address…"
            value={filters.search}
            onChange={e => onChange({ ...filters, search: e.target.value })}
            className="input pl-9 w-full text-sm"
          />
          {filters.search && (
            <button type="button" onClick={() => onChange({ ...filters, search: '' })}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
              <X size={14} />
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={() => setShowAdvanced(o => !o)}
          className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-sm font-medium transition-all shrink-0 ${
            advancedCount > 0
              ? 'bg-primary-600 text-white border-primary-600'
              : 'border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:border-primary-400 hover:text-primary-600'
          }`}
        >
          <SlidersHorizontal size={15} />
          Filters
          {advancedCount > 0 && (
            <span className="bg-white/30 text-white text-xs px-1.5 py-0.5 rounded-full font-bold">{advancedCount}</span>
          )}
        </button>
      </div>

      {/* Advanced panel */}
      {showAdvanced && (
        <div className="p-4 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Filters</h3>
            {advancedCount > 0 && (
              <button type="button" onClick={onClear}
                className="flex items-center gap-1 text-sm text-primary-600 dark:text-primary-400 hover:text-primary-700">
                <X size={14} /> Clear all
              </button>
            )}
          </div>

          {/* Deal type chips */}
          <div>
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5">Deal Type</p>
            <div className="flex gap-2">
              {([{ value: '', label: 'All' }, { value: 'sfr', label: 'SFR' }, { value: 'mfr', label: 'MFR' }] as const).map(opt => (
                <button key={opt.value} type="button"
                  onClick={() => onChange({ ...filters, propertyType: opt.value, units: DEFAULT_NUM })}
                  className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all ${
                    filters.propertyType === opt.value
                      ? 'bg-primary-600 text-white'
                      : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
                  }`}>
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Returns & price */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <NumFilterInput label="IRR (%)"          filterKey="irr"   filters={filters} onChange={onChange} />
            <NumFilterInput label="CoC Return (%)"   filterKey="coc"   filters={filters} onChange={onChange} />
            <NumFilterInput label="Purchase Price ($)" filterKey="price" filters={filters} onChange={onChange} />
          </div>

          {/* Units — only for MFR or All */}
          {showUnits && (
            <NumFilterInput label="Units (MFR)" filterKey="units" filters={filters} onChange={onChange} />
          )}

          {/* Location */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5">City</p>
              <input type="text" placeholder="e.g. Austin"
                value={filters.city}
                onChange={e => onChange({ ...filters, city: e.target.value })}
                className="input text-sm w-full" />
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5">State</p>
              <input type="text" placeholder="e.g. TX or Texas"
                list="state-options"
                value={filters.state}
                onChange={e => onChange({ ...filters, state: e.target.value })}
                className="input text-sm w-full" />
              <datalist id="state-options">
                {Object.entries(STATE_ABBR).map(([name, abbr]) => (
                  <option key={abbr} value={abbr}>{name.replace(/\b\w/g, c => c.toUpperCase())}</option>
                ))}
              </datalist>
            </div>
          </div>
        </div>
      )}

      {/* Results count */}
      <p className="text-sm text-slate-600 dark:text-slate-400">
        Showing {filteredCount} {filteredCount === 1 ? 'deal' : 'deals'}{activeCount > 0 ? ` of ${totalCount}` : ''}
      </p>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export function DealAnalyzerDashboard() {
  const router = useRouter();
  const { savedDeals, deleteSavedDeal } = useDealAnalyzerStore();
  const [sortKey, setSortKey] = useState<SortKey>('date');
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const compareMode = compareIds.length > 0 || false;

  const activeFilterCount = [
    filters.search, filters.propertyType, filters.units.value,
    filters.irr.value, filters.coc.value, filters.price.value,
    filters.state, filters.city,
  ].filter(Boolean).length;

  const analyses = savedDeals.filter(d => getBestResult(d));
  const allDrafts = savedDeals.filter(d => !getBestResult(d));
  const drafts = useMemo(() => applyFilters(allDrafts, filters), [allDrafts, filters]);

  const sortedAnalyses = useMemo(() => {
    const filtered = applyFilters(analyses, filters);
    return filtered.sort((a, b) => {
      const ra = getBestResult(a)!, rb = getBestResult(b)!;
      if (sortKey === 'irr')     return (rb.irr ?? -999) - (ra.irr ?? -999);
      if (sortKey === 'coc')     return rb.avgCoCReturn - ra.avgCoCReturn;
      if (sortKey === 'verdict') return getVerdict(rb).score - getVerdict(ra).score;
      if (sortKey === 'price')   return b.acquisition.purchasePrice - a.acquisition.purchasePrice;
      return new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime();
    });
  }, [analyses, filters, sortKey]);

  const toggleCompare = (id: string) => {
    setCompareIds(prev =>
      prev.includes(id)
        ? prev.filter(x => x !== id)
        : prev.length < 3 ? [...prev, id] : prev
    );
  };

  const compareDeals = savedDeals.filter(d => compareIds.includes(d.id));

  return (
    <div className="min-h-screen pb-32 overflow-x-hidden">
      <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
        <PageHeader
          title="Deal Analyzer"
          subtitle="Model and compare your real estate investments"
          action={
            <Button variant="primary" onClick={() => router.push('/deal-analyzer/new')}>
              <Plus size={15} className="mr-1.5" />
              New Analysis
            </Button>
          }
        />

        {savedDeals.length > 0 ? (
          <div className="space-y-6">
            {/* Portfolio summary */}
            <PortfolioSummary deals={savedDeals} />

            {/* Search + filters */}
            {analyses.length > 0 && (
              <FilterBar
                filters={filters}
                onChange={setFilters}
                onClear={() => setFilters(DEFAULT_FILTERS)}
                activeCount={activeFilterCount}
                totalCount={savedDeals.length}
                filteredCount={sortedAnalyses.length + drafts.length}
              />
            )}

            {/* Analyses */}
            {analyses.length > 0 && (
              <div className="space-y-3">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500">
                      Analyses · {sortedAnalyses.length}{activeFilterCount > 0 ? ` of ${analyses.length}` : ''}
                    </h2>
                    <div className="flex items-center gap-2">
                      {/* Compare toggle */}
                      <button
                        type="button"
                        onClick={() => setCompareIds([])}
                        className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border transition-all ${
                          compareMode
                            ? 'bg-primary-600 text-white border-primary-600'
                            : 'border-slate-200 dark:border-slate-700 text-slate-500 hover:border-primary-400 hover:text-primary-600'
                        }`}
                      >
                        <GitCompare size={13} />
                        {compareMode ? `${compareIds.length} selected` : 'Compare'}
                      </button>
                      {/* Sort */}
                      <div className="flex items-center gap-1.5 text-xs text-slate-400">
                        <ArrowUpDown size={12} />
                        <select
                          value={sortKey}
                          onChange={e => setSortKey(e.target.value as SortKey)}
                          className="text-xs bg-transparent text-slate-600 dark:text-slate-400 border-none outline-none cursor-pointer"
                        >
                          <option value="date">Date</option>
                          <option value="irr">IRR</option>
                          <option value="coc">CoC</option>
                          <option value="verdict">Verdict</option>
                          <option value="price">Price</option>
                        </select>
                      </div>
                    </div>
                  </div>
                </div>

                {compareMode && (
                  <p className="text-xs text-primary-600 dark:text-primary-400">
                    Select up to 3 deals to compare · {3 - compareIds.length} remaining
                  </p>
                )}

                <div className="grid grid-cols-1 gap-3">
                  {sortedAnalyses.map(deal => (
                    <DealCard
                      key={deal.id}
                      deal={deal}
                      selected={compareIds.includes(deal.id)}
                      compareMode={compareMode}
                      onLoad={() => router.push(`/deal-analyzer/${deal.id}`)}
                      onDelete={() => deleteSavedDeal(deal.id)}
                      onToggleSelect={() => toggleCompare(deal.id)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Drafts */}
            {drafts.length > 0 && (
              <div className="space-y-3">
                <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500">
                  Drafts · {drafts.length}
                </h2>
                <div className="grid grid-cols-1 gap-3">
                  {drafts.map(deal => (
                    <DealCard
                      key={deal.id}
                      deal={deal}
                      selected={false}
                      compareMode={false}
                      onLoad={() => router.push(`/deal-analyzer/${deal.id}`)}
                      onDelete={() => deleteSavedDeal(deal.id)}
                      onToggleSelect={() => {}}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-10 flex flex-col items-center gap-4 text-center">
            <div className="w-14 h-14 rounded-2xl bg-primary-50 dark:bg-primary-900/20 flex items-center justify-center">
              <TrendingUp size={24} className="text-primary-600 dark:text-primary-400" />
            </div>
            <div>
              <p className="text-base font-semibold text-slate-900 dark:text-white">No analyses yet</p>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Start your first deal analysis to model returns and compare scenarios.</p>
            </div>
            <Button variant="primary" onClick={() => router.push('/deal-analyzer/new')}>
              <Plus size={15} className="mr-1.5" />
              Start Analysis
            </Button>
          </div>
        )}
      </div>

      {/* Compare panel */}
      {compareIds.length >= 2 && (
        <ComparePanel
          deals={compareDeals}
          onClose={() => setCompareIds([])}
          onOpen={id => router.push(`/deal-analyzer/${id}`)}
        />
      )}
    </div>
  );
}
