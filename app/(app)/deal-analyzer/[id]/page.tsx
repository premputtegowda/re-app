'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useDealAnalyzerStore } from '@/lib/dealAnalyzerStore';
import { DealAnalyzerForm } from '@/components/DealAnalyzer/DealAnalyzerForm';
import type { SavedDeal } from '@/types';

export default function EditDealPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  // Read the deal once from the store — don't subscribe to subsequent changes
  // so auto-saves (updateMCData) don't re-initialize the form's internal state.
  const getDeal = useDealAnalyzerStore.getState;
  const [deal, setDeal] = useState<SavedDeal | null | undefined>(undefined);
  const loaded = useRef(false);

  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    const found = getDeal().savedDeals.find((d) => d.id === id) ?? null;
    setDeal(found);
  }, [getDeal, id]);

  if (deal === undefined) return null;

  if (deal === null) {
    router.replace('/deal-analyzer');
    return null;
  }

  return <DealAnalyzerForm initialDeal={deal} />;
}
