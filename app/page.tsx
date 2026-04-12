'use client';

import { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Toaster } from 'sonner';
import { LoginPage } from '@/components/Auth';
import { useAuthStore } from '@/lib/authStore';

function HomeContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get('redirect') ?? '/dashboard';
  const { isAuthenticated, isLoading, checkAuth, error } = useAuthStore();

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      router.replace(redirectTo);
    }
  }, [isLoading, isAuthenticated, router, redirectTo]);

  // If access request was submitted/pending and we came from a shared link,
  // redirect back so the user can see the deal and the confirmation banner
  useEffect(() => {
    if ((error === 'ACCESS_REQUEST_SUBMITTED' || error === 'ACCESS_REQUEST_PENDING') &&
        redirectTo.startsWith('/shared/')) {
      const sep = redirectTo.includes('?') ? '&' : '?';
      router.replace(`${redirectTo}${sep}access_requested=true`);
    }
  }, [error, redirectTo, router]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" />
      </div>
    );
  }

  return <LoginPage onLoginSuccess={() => router.replace(redirectTo)} />;
}

export default function Home() {
  return (
    <>
      <Suspense fallback={
        <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" />
        </div>
      }>
        <HomeContent />
      </Suspense>
      <Toaster position="top-right" richColors closeButton />
    </>
  );
}
