'use client';

import { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Toaster } from 'sonner';
import { LoginPage } from '@/components/Auth';
import { useAuthStore } from '@/lib/authStore';

function HomeContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const lastRoute = typeof window !== 'undefined' ? localStorage.getItem('dealstack_last_route') : null;
  const { isAuthenticated, isLoading, checkAuth, error, user } = useAuthStore();

  // Default landing page is feature-aware. Users without REPS access should
  // never land on a REPS route; if their lastRoute is a REPS route but they
  // only have Deal Analyzer access, redirect to the Deal Analyzer dashboard.
  const hasReps = !!user?.features?.includes('reps');
  const hasDealAnalyzer = !!user?.features?.includes('deal_analyzer');
  const featureDefault = hasReps ? '/dashboard' : hasDealAnalyzer ? '/deal-analyzer' : '/dashboard';
  // Treat `/deal-analyzer*` as Deal Analyzer; everything else as REPS-side.
  const lastRouteFeature: 'deal_analyzer' | 'reps' = lastRoute?.startsWith('/deal-analyzer') ? 'deal_analyzer' : 'reps';
  const lastRouteAllowed = lastRoute && (lastRouteFeature === 'reps' ? hasReps || !user : hasDealAnalyzer || !user);
  const redirectTo = searchParams.get('redirect') ?? (lastRouteAllowed ? lastRoute! : featureDefault);

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
