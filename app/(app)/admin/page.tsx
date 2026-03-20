'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { AdminView } from '@/components/Admin/AdminView';
import { useAuthStore } from '@/lib/authStore';

export default function AdminPage() {
  const router = useRouter();
  const isAdmin = useAuthStore((s) => s.user?.is_admin ?? false);

  useEffect(() => {
    if (!isAdmin) router.replace('/dashboard');
  }, [isAdmin, router]);

  if (!isAdmin) return null;

  return <AdminView />;
}
