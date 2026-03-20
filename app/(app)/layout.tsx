'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Toaster } from 'sonner';
import { Layout } from '@/components/Layout/Layout';
import { useAuthStore } from '@/lib/authStore';
import { useStore } from '@/lib/store';
import { useDriveStore } from '@/lib/driveStore';
import { DriveConsentModal } from '@/components/Settings/DriveConsentModal';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { isAuthenticated, isLoading, checkAuth } = useAuthStore();
  const syncFromBackend = useStore((s) => s.syncFromBackend);
  const drivePermission = useDriveStore((s) => s.permission);
  const [showDriveConsent, setShowDriveConsent] = useState(false);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace('/');
    }
  }, [isLoading, isAuthenticated, router]);

  useEffect(() => {
    if (isAuthenticated) {
      syncFromBackend().catch(console.error);
      if (drivePermission === 'unknown') {
        setShowDriveConsent(true);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);

  if (isLoading || !isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" />
      </div>
    );
  }

  return (
    <>
      <Layout>
        {children}
      </Layout>
      {showDriveConsent && (
        <DriveConsentModal onClose={() => setShowDriveConsent(false)} />
      )}
      <Toaster position="top-right" richColors closeButton />
    </>
  );
}
