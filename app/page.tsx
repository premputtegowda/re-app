'use client';

import { useState, useEffect } from 'react';
import { Toaster } from 'sonner';
import { Layout } from '@/components/Layout/Layout';
import { Dashboard } from '@/components/Dashboard/Dashboard';
import { ChatLikeEntry } from '@/components/HoursEntry/ChatLikeEntry';
import { HoursList } from '@/components/HoursList/HoursList';
import { Settings } from '@/components/Settings/Settings';
import { LoginPage } from '@/components/Auth';
import { useAuthStore } from '@/lib/authStore';
import { useStore } from '@/lib/store';
import type { ViewMode } from '@/types';

export default function Home() {
  const [currentView, setCurrentView] = useState<ViewMode>('dashboard');
  const { isAuthenticated, isLoading, checkAuth } = useAuthStore();
  const { syncFromBackend } = useStore();

  // Check authentication on mount
  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  // Sync data from backend when authenticated
  const handleLoginSuccess = async () => {
    try {
      await syncFromBackend();
    } catch (error) {
      console.error('Failed to sync data:', error);
    }
  };

  // Show loading spinner while checking auth
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  // Show login page if not authenticated
  if (!isAuthenticated) {
    return (
      <>
        <LoginPage onLoginSuccess={handleLoginSuccess} />
        <Toaster position="top-right" richColors closeButton />
      </>
    );
  }

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
