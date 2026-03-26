'use client';

import { useState } from 'react';
import { useDealAnalyzerStore } from '@/lib/dealAnalyzerStore';
import { DealAnalyzerDashboard } from './DealAnalyzerDashboard';
import { DealAnalyzerForm } from './DealAnalyzerForm';
import type { SavedDeal } from '@/types';

type View = 'dashboard' | 'form';

export function DealAnalyzer() {
  const { clearDraft } = useDealAnalyzerStore();
  const [view, setView] = useState<View>('dashboard');
  const [activeDeal, setActiveDeal] = useState<SavedDeal | undefined>();

  const handleNewAnalysis = () => {
    clearDraft();
    setActiveDeal(undefined);
    setView('form');
  };

  const handleContinueDraft = () => {
    setActiveDeal(undefined);
    setView('form');
  };

  const handleLoadDeal = (deal: SavedDeal) => {
    setActiveDeal(deal);
    setView('form');
  };

  const handleBack = () => {
    setActiveDeal(undefined);
    setView('dashboard');
  };

  if (view === 'form') {
    return <DealAnalyzerForm initialDeal={activeDeal} onBack={handleBack} />;
  }

  return (
    <DealAnalyzerDashboard
      onNewAnalysis={handleNewAnalysis}
      onContinueDraft={handleContinueDraft}
      onLoadDeal={handleLoadDeal}
    />
  );
}
