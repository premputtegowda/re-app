'use client';

import { useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Gift, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import GoogleLoginButton from '@/components/Auth/GoogleLoginButton';
import { useAuthStore } from '@/lib/authStore';

export default function InvitePage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get('token');
  const [status, setStatus] = useState<'loading' | 'valid' | 'invalid'>('loading');
  const { checkAuth, isAuthenticated } = useAuthStore();

  useEffect(() => {
    // Resolve auth state so GoogleLoginButton doesn't stay in loading limbo
    checkAuth().finally(() => {
      setStatus(token ? 'valid' : 'invalid');
    });
  }, [token, checkAuth]);

  // Already logged in — send straight to the app
  useEffect(() => {
    if (isAuthenticated) router.push('/');
  }, [isAuthenticated, router]);

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900">
        <Loader2 size={28} className="animate-spin text-primary-500" />
      </div>
    );
  }

  if (status === 'invalid') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900 p-4">
        <div className="max-w-md w-full bg-white dark:bg-slate-800 rounded-2xl p-8 shadow-lg text-center space-y-4">
          <div className="w-14 h-14 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center mx-auto">
            <AlertCircle className="text-red-500" size={28} />
          </div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">Invalid invite link</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            This invite link is missing or invalid. Ask your admin to resend the invitation.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900 p-4">
      <div className="max-w-md w-full bg-white dark:bg-slate-800 rounded-2xl p-8 shadow-lg text-center space-y-6">
        <div className="w-14 h-14 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center mx-auto">
          <Gift className="text-emerald-600 dark:text-emerald-400" size={28} />
        </div>

        <div className="space-y-2">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">You're invited!</h1>
          <p className="text-slate-600 dark:text-slate-400 text-sm">
            You've been given complimentary access to <span className="font-semibold text-slate-900 dark:text-white">REPS Tracker</span> — sign in with Google to activate your account.
          </p>
        </div>

        <ul className="text-left space-y-2 text-sm text-slate-600 dark:text-slate-400">
          {[
            'Track real estate hours for REPS qualification',
            'AI-powered activity classification',
            'Audit-ready PDF & CSV export',
            'Google Drive attachment support',
          ].map((feature) => (
            <li key={feature} className="flex items-center gap-2">
              <CheckCircle2 size={15} className="text-emerald-500 shrink-0" />
              {feature}
            </li>
          ))}
        </ul>

        <GoogleLoginButton onSuccess={() => router.push('/')} />

        <p className="text-xs text-slate-400 dark:text-slate-500">
          Your complimentary access is tied to the email address this invite was sent to.
          Make sure to sign in with that Google account.
        </p>
      </div>
    </div>
  );
}
