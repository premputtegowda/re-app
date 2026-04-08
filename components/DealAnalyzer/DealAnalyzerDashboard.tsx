'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2, TrendingUp, ChevronRight, PenLine, FileText, ArrowUpDown, X, GitCompare } from 'lucide-react';
import { Button } from '@/components/UI/Button';
import { PageHeader } from '@/components/UI/PageHeader';
import { useDealAnalyzerStore } from '@/lib/dealAnalyzerStore';
import { formatCurrency, formatPct, formatMultiple } from '@/utils/dealAnalyzerCalc';
import type { SavedDeal, CoCResult, CoCScenarioType } from '@/types';

// ── Helpers ────────────────────────────────────────────────────────────────────

type SortKey = 'irr' | 'coc' | 'verdict' | 'date' | 'price';

function getBestResult(deal: SavedDeal): CoCResult | null {
  return deal.results.base ?? deal.results.bull ?? deal.results.bear ?? null;
}

function getVerdict(result: CoCResult | null): { label: string; score: number; color: string; badge: string } {
  if (!result) return { label: 'Draft', score: -1, color: 'text-slate-400', badge: 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400' };
  const score = (result.irr ?? 0) * 0.6 + result.avgCoCReturn * 0.4;
  if (score >= 15) return { label: 'Strong',   score, color: 'text-secondary-600 dark:text-secondary-400', badge: 'bg-secondary-100 dark:bg-secondary-900/40 text-secondary-700 dark:text-secondary-300' };
  if (score >= 8)  return { label: 'Solid',    score, color: 'text-primary-600 dark:text-primary-400',     badge: 'bg-primary-100 dark:bg-primary-900/40 text-primary-700 dark:text-primary-300' };
  if (score >= 4)  return { label: 'Marginal', score, color: 'text-amber-600 dark:text-amber-400',         badge: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300' };
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
  const totalInvested = results.reduce((s, r) => s + r.totalInvested, 0);
  const avgIRR = results.filter(r => r.irr !== null).reduce((s, r) => s + (r.irr ?? 0), 0) / (results.filter(r => r.irr !== null).length || 1);
  const avgCoC = results.reduce((s, r) => s + r.avgCoCReturn, 0) / results.length;

  const stats = [
    { label: 'Deals Analyzed', value: analyses.length.toString() },
    { label: 'Total Invested', value: formatCurrency(totalInvested) },
    { label: 'Avg IRR', value: formatPct(avgIRR) },
    { label: 'Avg CoC', value: formatPct(avgCoC) },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
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
  const isDraft = !result;

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirmDelete) onDelete();
    else setConfirmDelete(true);
  };

  const handleClick = () => {
    if (compareMode) onToggleSelect();
    else onLoad();
  };

  return (
    <div
      onClick={handleClick}
      className={`relative rounded-xl border-2 bg-white dark:bg-slate-800 transition-all cursor-pointer group ${
        selected
          ? 'border-primary-500 shadow-md shadow-primary-100 dark:shadow-primary-900/20'
          : 'border-slate-200 dark:border-slate-700 hover:border-primary-300 dark:hover:border-primary-600 hover:shadow-md'
      }`}
    >
      {/* Compare checkbox */}
      {compareMode && (
        <div className={`absolute top-3 right-3 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${
          selected ? 'bg-primary-500 border-primary-500' : 'border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800'
        }`}>
          {selected && <span className="text-white text-[10px] font-bold">✓</span>}
        </div>
      )}

      <div className="p-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
              isDraft ? 'bg-amber-50 dark:bg-amber-900/20' : 'bg-primary-50 dark:bg-primary-900/20'
            }`}>
              {isDraft
                ? <PenLine size={14} className="text-amber-500" />
                : <FileText size={14} className="text-primary-600 dark:text-primary-400" />}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-900 dark:text-white truncate group-hover:text-primary-700 dark:group-hover:text-primary-300 transition-colors">
                {deal.name}
              </p>
              {deal.acquisition.propertyAddress?.trim() && deal.acquisition.propertyAddress.trim() !== deal.name && (
                <p className="text-[11px] text-slate-400 dark:text-slate-500 truncate">{deal.acquisition.propertyAddress}</p>
              )}
            </div>
          </div>

          {/* Verdict badge */}
          <span className={`shrink-0 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${verdict.badge}`}>
            {verdict.label}
          </span>
        </div>

        {/* KPI grid */}
        {result ? (
          <div className="grid grid-cols-2 gap-2 mb-3">
            {[
              { label: 'IRR',      value: result.irr !== null ? formatPct(result.irr) : '—' },
              { label: 'Avg CoC',  value: formatPct(result.avgCoCReturn) },
              { label: 'Eq. Mult', value: formatMultiple(result.equityMultiple) },
              { label: 'Invested', value: formatCurrency(result.totalInvested) },
            ].map(({ label, value }) => (
              <div key={label} className="bg-slate-50 dark:bg-slate-700/40 rounded-lg px-3 py-2">
                <p className="text-[10px] text-slate-400 dark:text-slate-500">{label}</p>
                <p className="text-sm font-bold text-slate-800 dark:text-slate-200 tabular-nums">{value}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-slate-400 mb-3">No results yet — open to calculate</p>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-700">
          <span className="text-[11px] text-slate-400">{formatRelativeDate(deal.savedAt)}</span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handleDelete}
              className={`p-1.5 rounded-lg transition-all ${
                confirmDelete
                  ? 'bg-red-100 dark:bg-red-900/30 text-red-500'
                  : 'text-slate-300 dark:text-slate-600 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 opacity-0 group-hover:opacity-100'
              }`}
            >
              <Trash2 size={13} />
            </button>
            {!compareMode && (
              <ChevronRight size={15} className="text-slate-300 dark:text-slate-600 group-hover:text-primary-400 transition-colors" />
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

// ── Main ──────────────────────────────────────────────────────────────────────

export function DealAnalyzerDashboard() {
  const router = useRouter();
  const { savedDeals, deleteSavedDeal } = useDealAnalyzerStore();
  const [sortKey, setSortKey] = useState<SortKey>('date');
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const compareMode = compareIds.length > 0 || false;

  const analyses = savedDeals.filter(d => getBestResult(d));
  const drafts   = savedDeals.filter(d => !getBestResult(d));

  const sortedAnalyses = useMemo(() => {
    return [...analyses].sort((a, b) => {
      const ra = getBestResult(a)!, rb = getBestResult(b)!;
      if (sortKey === 'irr')     return (rb.irr ?? -999) - (ra.irr ?? -999);
      if (sortKey === 'coc')     return rb.avgCoCReturn - ra.avgCoCReturn;
      if (sortKey === 'verdict') return getVerdict(rb).score - getVerdict(ra).score;
      if (sortKey === 'price')   return b.acquisition.purchasePrice - a.acquisition.purchasePrice;
      return new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime(); // date
    });
  }, [analyses, sortKey]);

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

            {/* Analyses */}
            {analyses.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500">
                    Analyses · {analyses.length}
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

                {compareMode && (
                  <p className="text-xs text-primary-600 dark:text-primary-400">
                    Select up to 3 deals to compare · {3 - compareIds.length} remaining
                  </p>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
