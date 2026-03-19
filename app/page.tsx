'use client';

import { useState, useEffect } from 'react';
import { Toaster } from 'sonner';
import { Layout } from '@/components/Layout/Layout';
import { Dashboard } from '@/components/Dashboard/Dashboard';
import { ChatLikeEntry } from '@/components/HoursEntry/ChatLikeEntry';
import { HoursList } from '@/components/HoursList/HoursList';
import { Settings } from '@/components/Settings/Settings';
import { AdminView } from '@/components/Admin/AdminView';
import { LoginPage } from '@/components/Auth';
import { useAuthStore } from '@/lib/authStore';
import { useStore } from '@/lib/store';
import { useDriveStore } from '@/lib/driveStore';
import { DriveConsentModal } from '@/components/Settings/DriveConsentModal';
import type { ViewMode } from '@/types';

export default function Home() {
  const [currentView, setCurrentView] = useState<ViewMode>('dashboard');
  const { isAuthenticated, isLoading, checkAuth } = useAuthStore();
  const syncFromBackend = useStore((s) => s.syncFromBackend);
  const drivePermission = useDriveStore((s) => s.permission);
  const [showDriveConsent, setShowDriveConsent] = useState(false);

  // Check authentication on mount
  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  // Sync data from backend whenever authenticated (covers both fresh login and page refresh)
  useEffect(() => {
    if (isAuthenticated) {
      syncFromBackend().catch((error) => {
        console.error('Failed to sync data:', error);
      });
      // Show Drive consent prompt once for new users
      if (drivePermission === 'unknown') {
        setShowDriveConsent(true);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);

  // Sync data from backend when authenticated (called from LoginPage after Google OAuth)
  const handleLoginSuccess = async () => {
    // syncFromBackend is handled by the isAuthenticated effect above
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
      case 'admin':
        return <AdminView />;
      default:
        return <Dashboard onViewChange={setCurrentView} />;
    }
  };

  return (
    <>
      <Layout currentView={currentView} onViewChange={setCurrentView}>
        {renderView()}
      </Layout>
      {showDriveConsent && (
        <DriveConsentModal onClose={() => setShowDriveConsent(false)} />
      )}
      <Toaster position="top-right" richColors closeButton />
    </>
  );
}
