'use client';

import { useEffect, useState } from 'react';
import { Mail, CheckCircle, LogOut, Loader2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useAuthStore } from '@/lib/authStore';

export function GmailSettings() {
  const user = useAuthStore(s => s.user);
  const setUser = useAuthStore(s => s.setUser);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Handle ?gmail_connected=1 or ?gmail_error=... redirect from OAuth callback
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has('gmail_connected')) {
      api.getCurrentUser().then(setUser).catch(() => {});
      // Clean the query param without a full reload
      const url = new URL(window.location.href);
      url.searchParams.delete('gmail_connected');
      window.history.replaceState({}, '', url.toString());
    }
    if (params.has('gmail_error')) {
      setError('Gmail connection failed. Please try again.');
      const url = new URL(window.location.href);
      url.searchParams.delete('gmail_error');
      window.history.replaceState({}, '', url.toString());
    }
  }, []);

  async function handleConnect() {
    setConnecting(true);
    setError(null);
    try {
      const { url } = await api.getGmailAuthUrl();
      window.location.href = url;
    } catch {
      setError('Could not start Gmail connection. Please try again.');
      setConnecting(false);
    }
  }

  async function handleDisconnect() {
    if (!confirm('Disconnect Gmail? LOI emails will no longer be sent until you reconnect.')) return;
    setDisconnecting(true);
    try {
      await api.disconnectGmail();
      const updated = await api.getCurrentUser();
      setUser(updated);
    } catch {
      setError('Failed to disconnect Gmail.');
    } finally {
      setDisconnecting(false);
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Gmail for Sending</h4>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
          Connect a Gmail account to send signed LOI copies from your own email address.
          Required to use the Send LOI feature.
        </p>
      </div>

      {user?.gmail_connected ? (
        <div className="flex items-center justify-between rounded-xl border border-secondary-200 dark:border-secondary-800 bg-secondary-50 dark:bg-secondary-900/20 px-4 py-3">
          <div className="flex items-center gap-2.5">
            <CheckCircle size={16} className="text-secondary-600 dark:text-secondary-400 shrink-0" />
            <div>
              <p className="text-sm font-medium text-slate-800 dark:text-slate-200">Connected</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">{user.gmail_sender_email}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleDisconnect}
            disabled={disconnecting}
            className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-red-500 dark:hover:text-red-400 transition-colors disabled:opacity-50"
          >
            {disconnecting ? <Loader2 size={13} className="animate-spin" /> : <LogOut size={13} />}
            Disconnect
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={handleConnect}
          disabled={connecting}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-600 text-sm font-medium text-slate-700 dark:text-slate-300 hover:border-primary-400 hover:text-primary-600 dark:hover:text-primary-400 transition-colors disabled:opacity-50"
        >
          {connecting ? (
            <Loader2 size={15} className="animate-spin" />
          ) : (
            <Mail size={15} />
          )}
          {connecting ? 'Redirecting to Google…' : 'Connect Gmail'}
        </button>
      )}

      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}
