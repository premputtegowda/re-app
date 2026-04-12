'use client';

import { useEffect, useRef, useState } from 'react';
import { Share, Copy, Check, X, Clock, Users, Building2, UserCheck } from 'lucide-react';
import { api, ApiError } from '@/lib/api';

interface ShareButtonProps {
  dealId: string;
}

interface ActiveLink {
  shareToken: string;
  shareUrl: string;
  expiresAt: string;
}

function timeRemaining(expiresAt: string): string {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return 'Expired';
  const hours = Math.floor(ms / 3_600_000);
  const mins = Math.floor((ms % 3_600_000) / 60_000);
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

export function ShareButton({ dealId }: ShareButtonProps) {
  const [open, setOpen] = useState(false);
  const [activeLink, setActiveLink] = useState<ActiveLink | null>(null);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timeLeft, setTimeLeft] = useState('');
  const popoverRef = useRef<HTMLDivElement>(null);

  // Update countdown every minute when link is active
  useEffect(() => {
    if (!activeLink) return;
    setTimeLeft(timeRemaining(activeLink.expiresAt));
    const interval = setInterval(() => setTimeLeft(timeRemaining(activeLink.expiresAt)), 30_000);
    return () => clearInterval(interval);
  }, [activeLink]);

  // Close popover on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  async function handleGenerate() {
    setLoading(true);
    setError(null);
    try {
      const data = await api.generateShareLink(dealId);
      setActiveLink({ shareToken: data.shareToken, shareUrl: data.shareUrl, expiresAt: data.expiresAt });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to generate link');
    } finally {
      setLoading(false);
    }
  }

  async function handleRevoke() {
    setLoading(true);
    setError(null);
    try {
      await api.revokeShareLink(dealId);
      setActiveLink(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to revoke link');
    } finally {
      setLoading(false);
    }
  }

  function handleCopy() {
    if (!activeLink) return;
    navigator.clipboard.writeText(activeLink.shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="relative" ref={popoverRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors border border-slate-200 dark:border-slate-600"
      >
        <Share size={15} />
        Share
        {activeLink && (
          <span className="w-2 h-2 rounded-full bg-green-500 ml-0.5" />
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 bg-white dark:bg-slate-800 rounded-xl shadow-xl border border-slate-200 dark:border-slate-700 z-50 p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Share this deal</h3>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
            >
              <X size={16} />
            </button>
          </div>

          {error && (
            <p className="text-xs text-red-500 mb-3">{error}</p>
          )}

          {!activeLink ? (
            <>
              <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
                Choose who you&apos;re sharing with:
              </p>

              <div className="space-y-2 mb-4">
                {/* Partner — active */}
                <div className="flex items-center gap-3 p-3 rounded-lg border-2 border-primary-500 bg-primary-50 dark:bg-primary-900/20">
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary-100 dark:bg-primary-800 flex items-center justify-center">
                    <Users size={16} className="text-primary-600 dark:text-primary-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">Partner</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">Full view + run simulations</p>
                  </div>
                  <div className="w-4 h-4 rounded-full bg-primary-500 flex items-center justify-center flex-shrink-0">
                    <Check size={10} className="text-white" />
                  </div>
                </div>

                {/* Lender — coming soon */}
                <div className="flex items-center gap-3 p-3 rounded-lg border border-slate-200 dark:border-slate-700 opacity-50 cursor-not-allowed">
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-700 flex items-center justify-center">
                    <Building2 size={16} className="text-slate-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-500 dark:text-slate-400">Lender</p>
                    <p className="text-xs text-slate-400">Loan-focused summary</p>
                  </div>
                  <span className="text-[10px] font-semibold text-slate-400 bg-slate-100 dark:bg-slate-700 px-1.5 py-0.5 rounded">
                    Soon
                  </span>
                </div>

                {/* Buyer's Agent — coming soon */}
                <div className="flex items-center gap-3 p-3 rounded-lg border border-slate-200 dark:border-slate-700 opacity-50 cursor-not-allowed">
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-700 flex items-center justify-center">
                    <UserCheck size={16} className="text-slate-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-500 dark:text-slate-400">Buyer&apos;s Agent</p>
                    <p className="text-xs text-slate-400">Market comp highlights</p>
                  </div>
                  <span className="text-[10px] font-semibold text-slate-400 bg-slate-100 dark:bg-slate-700 px-1.5 py-0.5 rounded">
                    Soon
                  </span>
                </div>
              </div>

              <button
                type="button"
                onClick={handleGenerate}
                disabled={loading}
                className="w-full py-2 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium transition-colors disabled:opacity-60"
              >
                {loading ? 'Generating…' : 'Generate Partner Link'}
              </button>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2 mb-1">
                <div className="w-2 h-2 rounded-full bg-green-500" />
                <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">Partner link active</p>
              </div>
              <div className="flex items-center gap-1 mb-3 text-xs text-slate-400 dark:text-slate-500">
                <Clock size={11} />
                <span>Expires in {timeLeft}</span>
              </div>

              {/* URL + copy */}
              <div className="flex items-center gap-2 mb-3">
                <input
                  readOnly
                  value={activeLink.shareUrl}
                  className="flex-1 min-w-0 text-xs bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg px-2.5 py-2 text-slate-600 dark:text-slate-300 truncate"
                />
                <button
                  type="button"
                  onClick={handleCopy}
                  className="flex-shrink-0 flex items-center gap-1 px-2.5 py-2 rounded-lg bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-xs font-medium text-slate-700 dark:text-slate-300 transition-colors"
                >
                  {copied ? <Check size={13} className="text-green-500" /> : <Copy size={13} />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>

              <p className="text-[11px] text-amber-600 dark:text-amber-400 mb-3">
                Recipients who add this to their dashboard get a full copy of all inputs.
              </p>

              <button
                type="button"
                onClick={handleRevoke}
                disabled={loading}
                className="w-full py-2 rounded-lg border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 text-sm font-medium hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors disabled:opacity-60"
              >
                {loading ? 'Revoking…' : 'Revoke Link'}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
