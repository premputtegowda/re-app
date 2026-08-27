'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useDealAnalyzerStore } from '@/lib/dealAnalyzerStore';
import { DealAnalyzerForm } from '@/components/DealAnalyzer/DealAnalyzerForm';
import type { SavedDeal } from '@/types';

export default function EditDealPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [deal, setDeal] = useState<SavedDeal | null | undefined>(undefined);
  const loaded = useRef(false);

  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;

    // Fetch fresh deal data from the backend BEFORE mounting the form.
    // The zustand-persist localStorage snapshot can shadow fresh data (see
    // e.g. rents typed elsewhere, autosaves from other tabs, or edits made
    // between sessions) — mounting the form with stale `initialDeal` bakes
    // those old values into the form's internal state (rentByType,
    // localRents, etc.) and no amount of background sync can fix it after
    // the fact. Awaiting `syncDealsFromBackend` here guarantees the mount
    // reads server-authoritative data.
    //
    // Cost: ~200-400ms loading state on deal open. Worth it to eliminate
    // the stale-hydration class of bug that surfaced repeatedly across
    // rents, opex, and cached results.
    (async () => {
      try {
        await useDealAnalyzerStore.getState().syncDealsFromBackend();
      } catch {
        // Sync failed (offline / auth expired / backend down). Fall back to
        // whatever's in the local store — better to show stale data than a
        // blank page while the user tries to figure out what's wrong.
      }
      const found = useDealAnalyzerStore.getState().savedDeals.find((d) => d.id === id) ?? null;
      setDeal(found);
    })();
  }, [id]);

  if (deal === undefined) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-slate-500 dark:text-slate-400">
          <div className="w-6 h-6 border-2 border-slate-300 dark:border-slate-600 border-t-primary-500 rounded-full animate-spin" />
          <p className="text-sm">Loading deal…</p>
        </div>
      </div>
    );
  }

  if (deal === null) {
    router.replace('/deal-analyzer');
    return null;
  }

  return <DealAnalyzerForm initialDeal={deal} />;
}
