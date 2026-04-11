'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { AlertTriangle } from 'lucide-react';
import { SharedDealView } from '@/components/DealAnalyzer/SharedDealView';
import { api, ApiError } from '@/lib/api';
import type { SavedDeal } from '@/types';

type SharedDeal = SavedDeal & { shareRole: string; expiresAt: string };

export default function SharedDealPage() {
  const { token } = useParams<{ token: string }>();
  const [deal, setDeal] = useState<SharedDeal | null | undefined>(undefined);
  const [errorCode, setErrorCode] = useState<number | null>(null);

  useEffect(() => {
    if (!token) return;
    api.getSharedDeal(token)
      .then((data) => setDeal(data as SharedDeal))
      .catch((err) => {
        setErrorCode(err instanceof ApiError ? err.status : 0);
        setDeal(null);
      });
  }, [token]);

  if (deal === undefined) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-600" />
      </div>
    );
  }

  if (deal === null) {
    const msg = errorCode === 410
      ? 'This link has expired.'
      : 'This link is invalid or no longer available.';
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900 px-4">
        <div className="max-w-sm text-center space-y-4">
          <div className="w-14 h-14 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center mx-auto">
            <AlertTriangle size={28} className="text-amber-500" />
          </div>
          <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-200">Link unavailable</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">{msg}</p>
        </div>
      </div>
    );
  }

  return <SharedDealView deal={deal} token={token} />;
}
