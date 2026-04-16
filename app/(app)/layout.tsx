'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Toaster } from 'sonner';
import { Layout } from '@/components/Layout/Layout';
import { useAuthStore } from '@/lib/authStore';
import { useStore } from '@/lib/store';
import { useDealAnalyzerStore } from '@/lib/dealAnalyzerStore';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { isAuthenticated, isLoading, checkAuth, user } = useAuthStore();
  const syncFromBackend = useStore((s) => s.syncFromBackend);
  const syncDealsFromBackend = useDealAnalyzerStore((s) => s.syncDealsFromBackend);

  // Persist last visited route for post-login redirect
  useEffect(() => {
    if (isAuthenticated && pathname) {
      localStorage.setItem('dealstack_last_route', pathname);
    }
  }, [isAuthenticated, pathname]);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace('/');
    }
  }, [isLoading, isAuthenticated, router]);

  // Feature-gate: bounce users away from sections they don't have access to.
  // /deal-analyzer routes need 'deal_analyzer'; everything else needs 'reps'.
  useEffect(() => {
    if (isLoading || !isAuthenticated || !user) return;
    const features = user.features ?? [];
    if (features.length === 0) return; // no features yet — let them see the empty state, will be invited
    const isDealAnalyzerRoute = pathname?.startsWith('/deal-analyzer') ?? false;
    const isAdminRoute = pathname?.startsWith('/admin') ?? false;
    if (isAdminRoute) return; // admin gating handled in /admin/page.tsx
    const needs = isDealAnalyzerRoute ? 'deal_analyzer' : 'reps';
    if (features.includes(needs)) return;
    // Redirect to a feature they DO have
    if (features.includes('reps')) router.replace('/dashboard');
    else if (features.includes('deal_analyzer')) router.replace('/deal-analyzer');
  }, [isLoading, isAuthenticated, user, pathname, router]);

  useEffect(() => {
    if (isAuthenticated) {
      syncFromBackend().catch(console.error);
      syncDealsFromBackend();
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
      <Toaster position="top-right" richColors closeButton />
    </>
  );
}
