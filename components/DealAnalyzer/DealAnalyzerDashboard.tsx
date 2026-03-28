'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, FileText, Trash2, TrendingUp, ChevronRight, PenLine } from 'lucide-react';
import { Card } from '@/components/UI/Card';
import { Button } from '@/components/UI/Button';
import { PageHeader } from '@/components/UI/PageHeader';
import { useDealAnalyzerStore } from '@/lib/dealAnalyzerStore';
import { formatCurrency, formatPct } from '@/utils/dealAnalyzerCalc';
import type { SavedDeal, CoCScenarioType } from '@/types';

// ── Helpers ────────────────────────────────────────────────────────────────────

const SCENARIO_COLORS: Record<CoCScenarioType, string> = {
  base: 'text-primary-600 dark:text-primary-400 bg-primary-50 dark:bg-primary-900/20',
  bull: 'text-secondary-600 dark:text-secondary-400 bg-secondary-50 dark:bg-secondary-900/20',
  bear: 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20',
};

function formatRelativeDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

// ── DealCard ──────────────────────────────────────────────────────────────────

interface DealCardProps {
  deal: SavedDeal;
  onLoad: () => void;
  onDelete: () => void;
}

function DealCard({ deal, onLoad, onDelete }: DealCardProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const scenarioKeys = Object.keys(deal.results) as CoCScenarioType[];
  const bestResult = deal.results.base ?? deal.results.bull ?? deal.results.bear;
  const isDraft = scenarioKeys.length === 0;

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirmDelete) {
      onDelete();
    } else {
      setConfirmDelete(true);
    }
  };

  return (
    <button
      type="button"
      onClick={onLoad}
      className="w-full text-left rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-primary-300 dark:hover:border-primary-600 hover:shadow-md transition-all p-4 group"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-3 min-w-0">
          <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
            isDraft ? 'bg-amber-50 dark:bg-amber-900/20' : 'bg-primary-50 dark:bg-primary-900/20'
          }`}>
            {isDraft
              ? <PenLine size={16} className="text-amber-500 dark:text-amber-400" />
              : <FileText size={16} className="text-primary-600 dark:text-primary-400" />}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold text-slate-900 dark:text-white truncate group-hover:text-primary-700 dark:group-hover:text-primary-300 transition-colors">
                {deal.name}
              </p>
              {isDraft && (
                <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400">
                  Draft
                </span>
              )}
            </div>
            {deal.acquisition.propertyAddress?.trim() && deal.acquisition.propertyAddress.trim() !== deal.name && (
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                {deal.acquisition.propertyAddress.trim()}
              </p>
            )}
            <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
              {deal.acquisition.propertyType === 'mfr' ? `${deal.acquisition.units} units · ` : ''}
              {deal.acquisition.purchasePrice > 0 ? `${formatCurrency(deal.acquisition.purchasePrice)} · ` : ''}
              {formatRelativeDate(deal.savedAt)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={handleDelete}
            className={`p-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-all ${
              confirmDelete
                ? 'bg-red-100 dark:bg-red-900/30 text-red-500 opacity-100'
                : 'text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20'
            }`}
            title={confirmDelete ? 'Click again to confirm' : 'Delete'}
          >
            <Trash2 size={14} />
          </button>
          <ChevronRight size={16} className="text-slate-300 dark:text-slate-600 group-hover:text-primary-400 transition-colors" />
        </div>
      </div>

      {/* KPIs */}
      {scenarioKeys.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {scenarioKeys.map((type) => {
            const r = deal.results[type]!;
            return (
              <span
                key={type}
                className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-lg ${SCENARIO_COLORS[type]}`}
              >
                <TrendingUp size={10} />
                {formatPct(r.avgCoCReturn)} CoC · {r.irr !== null ? `${formatPct(r.irr)} IRR` : `${r.equityMultiple.toFixed(2)}x`}
              </span>
            );
          })}
        </div>
      )}

      {/* Cost basis summary */}
      {bestResult && (
        <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-700 flex gap-4 text-xs text-slate-500 dark:text-slate-400">
          <span>Invested: <span className="font-medium text-slate-700 dark:text-slate-300">{formatCurrency(bestResult.totalInvested)}</span></span>
          <span>ARV: <span className="font-medium text-slate-700 dark:text-slate-300">{formatCurrency(deal.acquisition.arv)}</span></span>
        </div>
      )}
    </button>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export function DealAnalyzerDashboard() {
  const router = useRouter();
  const { savedDeals, deleteSavedDeal } = useDealAnalyzerStore();

  const drafts   = savedDeals.filter(d => Object.keys(d.results).length === 0);
  const analyses = savedDeals.filter(d => Object.keys(d.results).length > 0);

  return (
    <div className="min-h-screen pb-24 overflow-x-hidden">
      <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
        <PageHeader
          title="Deal Analyzer"
          subtitle="Model and save your real estate investment scenarios"
          action={
            <Button variant="primary" onClick={() => router.push('/deal-analyzer/new')}>
              <Plus size={15} className="mr-1.5" />
              New Analysis
            </Button>
          }
        />

        {savedDeals.length > 0 ? (
          <div className="space-y-6">
            {analyses.length > 0 && (
              <div className="space-y-3">
                <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500">
                  Analyses · {analyses.length}
                </h2>
                <div className="flex flex-col gap-3">
                  {analyses.map((deal) => (
                    <DealCard key={deal.id} deal={deal} onLoad={() => router.push(`/deal-analyzer/${deal.id}`)} onDelete={() => deleteSavedDeal(deal.id)} />
                  ))}
                </div>
              </div>
            )}
            {drafts.length > 0 && (
              <div className="space-y-3">
                <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500">
                  Drafts · {drafts.length}
                </h2>
                <div className="flex flex-col gap-3">
                  {drafts.map((deal) => (
                    <DealCard key={deal.id} deal={deal} onLoad={() => router.push(`/deal-analyzer/${deal.id}`)} onDelete={() => deleteSavedDeal(deal.id)} />
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <Card>
            <div className="flex flex-col items-center gap-4 py-10 text-center">
              <div className="w-14 h-14 rounded-2xl bg-primary-50 dark:bg-primary-900/20 flex items-center justify-center">
                <TrendingUp size={24} className="text-primary-600 dark:text-primary-400" />
              </div>
              <div>
                <p className="text-base font-semibold text-slate-900 dark:text-white">No analyses yet</p>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                  Start your first deal analysis to model returns and compare scenarios.
                </p>
              </div>
              <Button variant="primary" onClick={() => router.push('/deal-analyzer/new')}>
                <Plus size={15} className="mr-1.5" />
                Start Analysis
              </Button>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
