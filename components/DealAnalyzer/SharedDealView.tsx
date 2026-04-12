'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Clock, Home, ArrowRight, LogIn, Lock } from 'lucide-react';
import { ResultsPanel } from './ResultsPanel';
import { projectScenario } from '@/utils/dealAnalyzerCalc';
import { useAuthStore } from '@/lib/authStore';
import { api, ApiError } from '@/lib/api';
import type { SavedDeal, CoCResult, CoCScenarioType, CoCScenario } from '@/types';
import type { MCRanges, SavedMCResults } from '@/utils/monteCarlo';

interface SharedDealViewProps {
  deal: SavedDeal & { shareRole: string; expiresAt: string };
  token: string;
}

function timeRemaining(expiresAt: string): string {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return 'Expired';
  const hours = Math.floor(ms / 3_600_000);
  const mins = Math.floor((ms % 3_600_000) / 60_000);
  if (hours > 0) return `${hours}h ${mins}m remaining`;
  return `${mins}m remaining`;
}

export function SharedDealView({ deal, token }: SharedDealViewProps) {
  const router = useRouter();
  const { isAuthenticated, user } = useAuthStore((s) => ({ isAuthenticated: s.isAuthenticated, user: s.user }));
  const features: string[] = user?.features ?? [];
  const hasDealAnalyzer = features.includes('deal_analyzer');
  const hasAnyAccess = features.length > 0;

  const [mcRanges, setMcRanges] = useState<MCRanges | null>(
    deal.mcRanges ? (deal.mcRanges as unknown as MCRanges) : null
  );
  const [mcResults, setMcResults] = useState<SavedMCResults | null>(
    deal.mcResults ? (deal.mcResults as SavedMCResults) : null
  );
  const searchParams = useSearchParams();
  const [forking, setForking] = useState(false);
  const [forkError, setForkError] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [accessModal, setAccessModal] = useState<'no_deal_analyzer' | 'no_access' | null>(null);

  // After login redirect, check access and prompt accordingly
  useEffect(() => {
    if (!isAuthenticated || searchParams.get('prompt') !== 'add') return;
    if (!hasAnyAccess) {
      setAccessModal('no_access');
    } else if (!hasDealAnalyzer) {
      setAccessModal('no_deal_analyzer');
    } else {
      setShowConfirm(true);
    }
  }, [isAuthenticated, searchParams, hasDealAnalyzer, hasAnyAccess]);

  // Compute result client-side from deal inputs
  const resultRef = useRef<CoCResult | null>(null);
  if (!resultRef.current) {
    const scenario: CoCScenario = {
      id: deal.id,
      name: 'base',
      scenarioType: 'base' as CoCScenarioType,
      acquisition: deal.acquisition,
      operations: deal.operations,
      proForma: deal.proForma,
      refinance: deal.refinance,
      createdAt: deal.savedAt,
      updatedAt: deal.updatedAt,
    };
    const savedResult = (deal.results as Partial<Record<CoCScenarioType, CoCResult>>)?.base;
    resultRef.current = savedResult ?? projectScenario(scenario);
  }
  const result = resultRef.current;

  async function handleAddToDashboard() {
    if (!isAuthenticated) {
      router.push(`/?redirect=${encodeURIComponent(`/shared/${token}?prompt=add`)}`);
      return;
    }
    if (!hasAnyAccess) {
      setAccessModal('no_access');
      return;
    }
    if (!hasDealAnalyzer) {
      setAccessModal('no_deal_analyzer');
      return;
    }
    setShowConfirm(true);
  }

  async function handleConfirmAdd() {
    setShowConfirm(false);
    setForking(true);
    setForkError(null);
    try {
      const { id } = await api.forkSharedDeal(token);
      router.push(`/deal-analyzer/${id}`);
    } catch (err) {
      setForkError(err instanceof ApiError ? err.message : 'Failed to copy deal');
      setForking(false);
    }
  }

  function handleDecline() {
    setShowConfirm(false);
    router.push('/deal-analyzer');
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 pb-24">
      {/* Shared deal banner */}
      <div className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 px-4 py-3">
        <div className="max-w-2xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 rounded-full bg-primary-100 dark:bg-primary-900/40 flex items-center justify-center flex-shrink-0">
              <Home size={16} className="text-primary-600 dark:text-primary-400" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-800 dark:text-slate-200 truncate">
                {deal.name || deal.acquisition.propertyAddress || 'Shared Deal'}
              </p>
              <div className="flex items-center gap-1 text-xs text-slate-400 dark:text-slate-500">
                <Clock size={11} />
                <span>{timeRemaining(deal.expiresAt)}</span>
                <span className="mx-1">·</span>
                <span className="capitalize">{deal.shareRole} view</span>
              </div>
            </div>
          </div>

          <div className="flex-shrink-0">
            <span className="text-[11px] font-semibold text-slate-400 bg-slate-100 dark:bg-slate-700 px-2 py-1 rounded-full">
              Read-only
            </span>
          </div>
        </div>
      </div>

      {/* Results */}
      <div className="max-w-2xl mx-auto px-4 pt-6 space-y-5">
        <ResultsPanel
          result={result}
          acquisition={deal.acquisition}
          operations={deal.operations}
          proForma={deal.proForma}
          refinance={deal.refinance}
          mcRanges={mcRanges}
          onMcRangesChange={setMcRanges}
          mcResults={mcResults}
          onMcResultsChange={setMcResults}
        />

        {/* Add to dashboard CTA */}
        <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5">
          <div className="flex items-start gap-4">
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200 mb-1">
                Add to your dashboard
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Creates a full copy including all inputs in your account. The original is not affected.
              </p>
              {forkError && (
                <p className="text-xs text-red-500 mt-2">{forkError}</p>
              )}
            </div>

            <button
              type="button"
              onClick={handleAddToDashboard}
              disabled={forking}
              className="flex-shrink-0 flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium transition-colors disabled:opacity-60"
            >
              {forking ? (
                'Copying…'
              ) : isAuthenticated ? (
                <>Add <ArrowRight size={15} /></>
              ) : (
                <>Sign in <LogIn size={15} /></>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Confirmation modal */}
      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl p-6 max-w-sm w-full space-y-4">
            <h2 className="text-base font-semibold text-slate-800 dark:text-slate-200">
              Add to your dashboard?
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              This will create a full copy of{' '}
              <span className="font-medium text-slate-700 dark:text-slate-300">
                {deal.name || deal.acquisition.propertyAddress || 'this deal'}
              </span>{' '}
              in your account. The original is not affected.
            </p>
            <div className="flex gap-3 pt-1">
              <button
                type="button"
                onClick={handleDecline}
                className="flex-1 px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-600 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
              >
                No, go to dashboard
              </button>
              <button
                type="button"
                onClick={handleConfirmAdd}
                className="flex-1 px-4 py-2.5 rounded-xl bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium transition-colors"
              >
                Yes, add it
              </button>
            </div>
          </div>
        </div>
      )}

      {/* No Deal Analyzer access modal */}
      {accessModal === 'no_deal_analyzer' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl p-6 max-w-sm w-full space-y-4">
            <div className="w-12 h-12 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
              <Lock size={22} className="text-amber-500" />
            </div>
            <h2 className="text-base font-semibold text-slate-800 dark:text-slate-200">
              Deal Analyzer access required
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              You don't have access to the Deal Analyzer. Contact your administrator to request access, or continue to your dashboard.
            </p>
            <button
              type="button"
              onClick={() => { setAccessModal(null); router.push('/dashboard'); }}
              className="w-full px-4 py-2.5 rounded-xl bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium transition-colors"
            >
              Go to my dashboard
            </button>
          </div>
        </div>
      )}

      {/* No app access modal */}
      {accessModal === 'no_access' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl p-6 max-w-sm w-full space-y-4">
            <div className="w-12 h-12 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
              <Lock size={22} className="text-red-500" />
            </div>
            <h2 className="text-base font-semibold text-slate-800 dark:text-slate-200">
              No access to DealstackRE
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Your account doesn't have access to DealstackRE. Please contact support or request access from an administrator.
            </p>
            <button
              type="button"
              onClick={() => { setAccessModal(null); router.push('/'); }}
              className="w-full px-4 py-2.5 rounded-xl bg-slate-700 hover:bg-slate-800 text-white text-sm font-medium transition-colors"
            >
              Back to home
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
