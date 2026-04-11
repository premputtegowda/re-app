'use client';

import { useEffect, useState } from 'react';
import { FileSignature, Download, X, RefreshCw } from 'lucide-react';
import { LOIWizard } from './LOIWizard';
import { api, ApiError } from '@/lib/api';
import type { CoCAcquisition } from '@/types';
import { useAuthStore } from '@/lib/authStore';

interface LOI {
  id: string;
  deal_id: string;
  status: 'pending' | 'completed' | 'expired';
  terms: Record<string, unknown>;
  signers: { name: string; email: string; role: string }[];
  signed_pdf_url: string | null;
  created_at: string;
  updated_at: string;
}

interface LOIStatusBadgeProps {
  dealId: string;
  acquisition: CoCAcquisition;
}

export function LOIStatusBadge({ dealId, acquisition }: LOIStatusBadgeProps) {
  const user = useAuthStore(s => s.user);
  const [loi, setLoi] = useState<LOI | null | undefined>(undefined); // undefined = loading
  const [wizardOpen, setWizardOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    api.getLOI(dealId)
      .then(data => setLoi(data))
      .catch(() => setLoi(null));
  }, [dealId]);

  async function handleDownload() {
    setDownloading(true);
    try {
      const { url } = await api.getLOIDownloadUrl(dealId);
      window.open(url, '_blank');
    } catch {
      // silently ignore — URL may have expired
    } finally {
      setDownloading(false);
    }
  }

  async function handleCancel() {
    if (!confirm('Cancel this LOI? The signing link will be voided.')) return;
    setCancelling(true);
    try {
      await api.cancelLOI(dealId);
      setLoi(null);
    } catch {
      // ignore
    } finally {
      setCancelling(false);
    }
  }

  function handleSent() {
    setWizardOpen(false);
    // Reload LOI status
    api.getLOI(dealId).then(data => setLoi(data)).catch(() => {});
  }

  // Loading
  if (loi === undefined) return null;

  // No LOI yet
  if (!loi) {
    // Gmail not connected — nudge user to Settings
    if (!user?.gmail_connected) {
      return (
        <span
          title="Connect your Gmail in Settings to send LOIs"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-dashed border-slate-300 dark:border-slate-600 text-xs text-slate-400 cursor-default select-none"
        >
          <FileSignature size={13} />
          Send LOI
          <span className="text-[10px] bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400 px-1.5 py-0.5 rounded-full font-medium">
            Connect Gmail in Settings
          </span>
        </span>
      );
    }

    return (
      <>
        <button
          type="button"
          onClick={() => setWizardOpen(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-600 text-xs font-medium text-slate-600 dark:text-slate-400 hover:border-primary-400 hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
        >
          <FileSignature size={13} />
          Send LOI
        </button>

        {wizardOpen && user && (
          <LOIWizard
            dealId={dealId}
            acquisition={acquisition}
            userName={user.name ?? ''}
            userEmail={user.email ?? ''}
            onClose={() => setWizardOpen(false)}
            onSent={handleSent}
          />
        )}
      </>
    );
  }

  // Pending
  if (loi.status === 'pending') {
    const signedCount = loi.signers.filter(s => {
      // DocuSeal doesn't return per-signer status in our current GET — show total count
      return false;
    }).length;
    const total = loi.signers.length;

    return (
      <div className="flex items-center gap-2">
        <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 text-[11px] font-semibold">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
          LOI Pending · {total} signer{total !== 1 ? 's' : ''}
        </span>
        <button
          type="button"
          onClick={handleCancel}
          disabled={cancelling}
          title="Cancel LOI"
          className="text-slate-400 hover:text-red-500 transition-colors disabled:opacity-50"
        >
          <X size={14} />
        </button>
        <button
          type="button"
          onClick={() => setWizardOpen(true)}
          title="Resend LOI"
          className="text-slate-400 hover:text-primary-500 transition-colors"
        >
          <RefreshCw size={13} />
        </button>

        {wizardOpen && user && (
          <LOIWizard
            dealId={dealId}
            acquisition={acquisition}
            userName={user.name ?? ''}
            userEmail={user.email ?? ''}
            onClose={() => setWizardOpen(false)}
            onSent={handleSent}
          />
        )}
      </div>
    );
  }

  // Completed
  if (loi.status === 'completed') {
    return (
      <div className="flex items-center gap-2">
        <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-secondary-100 dark:bg-secondary-900/30 text-secondary-700 dark:text-secondary-300 text-[11px] font-semibold">
          <span className="w-1.5 h-1.5 rounded-full bg-secondary-500" />
          LOI Signed ✓
        </span>
        <button
          type="button"
          onClick={handleDownload}
          disabled={downloading}
          className="flex items-center gap-1 text-[11px] font-medium text-primary-600 dark:text-primary-400 hover:underline transition-colors disabled:opacity-60"
        >
          <Download size={12} />
          {downloading ? 'Opening…' : 'Download PDF'}
        </button>
      </div>
    );
  }

  // Expired
  return (
    <div className="flex items-center gap-2">
      <span className="px-2.5 py-1 rounded-full bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 text-[11px] font-semibold">
        LOI Expired
      </span>
      <button
        type="button"
        onClick={() => { setLoi(null); setWizardOpen(true); }}
        className="text-xs text-primary-600 dark:text-primary-400 hover:underline font-medium"
      >
        Resend
      </button>
    </div>
  );
}
