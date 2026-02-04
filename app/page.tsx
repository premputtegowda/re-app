'use client';

import { useState } from 'react';
import { Toaster } from 'sonner';
import { Layout } from '@/components/Layout/Layout';
import { Dashboard } from '@/components/Dashboard/Dashboard';
import { ChatLikeEntry } from '@/components/HoursEntry/ChatLikeEntry';
import { HoursList } from '@/components/HoursList/HoursList';
import { Settings } from '@/components/Settings/Settings';
import type { ViewMode } from '@/types';

export default function Home() {
  const [currentView, setCurrentView] = useState<ViewMode>('dashboard');

  const renderView = () => {
    switch (currentView) {
      case 'dashboard':
        return <Dashboard onViewChange={setCurrentView} />;
      case 'entry':
        return <ChatLikeEntry />;
      case 'list':
        return <HoursList />;
      case 'settings':
        return <Settings />;
      default:
        return <Dashboard onViewChange={setCurrentView} />;
    }
  };

  return (
    <>
      <Layout currentView={currentView} onViewChange={setCurrentView}>
        {renderView()}
      </Layout>
      <Toaster position="top-right" richColors closeButton />
    </>
  );
}
