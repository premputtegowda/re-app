'use client';

import { useState } from 'react';
import { HardDrive, CheckCircle2, XCircle, Loader2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/UI/Button';
import { useDriveStore } from '@/lib/driveStore';
import { requestDriveToken } from '@/lib/driveApi';

export function DriveSettings() {
  const { permission, setPermission, disconnect } = useDriveStore();
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState('');

  const handleConnect = async () => {
    setIsConnecting(true);
    setError('');
    try {
      const token = await requestDriveToken();
      if (token) {
        setPermission('granted');
      } else {
        setError('Access was declined. Make sure pop-ups are allowed and try again.');
      }
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDisconnect = () => {
    disconnect();
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Google Drive</h3>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Used to store attachment files for your entries. Files are saved to a <strong>REPS Tracker</strong> folder in your own Drive account.
        </p>
      </div>

      {/* Status card */}
      <div className="flex items-start gap-4 p-4 border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-800/50">
        <HardDrive size={20} className={`mt-0.5 shrink-0 ${permission === 'granted' ? 'text-green-500' : 'text-slate-400'}`} />
        <div className="flex-1 space-y-1">
          <div className="flex items-center gap-2">
            {permission === 'granted' && (
              <>
                <CheckCircle2 size={14} className="text-green-500" />
                <span className="text-sm font-medium text-slate-800 dark:text-slate-200">Connected</span>
              </>
            )}
            {permission === 'denied' && (
              <>
                <XCircle size={14} className="text-slate-400" />
                <span className="text-sm font-medium text-slate-800 dark:text-slate-200">Not connected</span>
              </>
            )}
            {permission === 'unknown' && (
              <>
                <AlertCircle size={14} className="text-amber-500" />
                <span className="text-sm font-medium text-slate-800 dark:text-slate-200">Not set up</span>
              </>
            )}
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {permission === 'granted'
              ? 'New attachments will automatically upload to your Google Drive. You can still paste manual links instead.'
              : 'Attachments require you to paste a link manually (Dropbox, iCloud, OneDrive, etc.).'}
          </p>
        </div>
        <div className="shrink-0">
          {permission === 'granted' ? (
            <Button variant="secondary" onClick={handleDisconnect} className="text-xs">
              Disconnect
            </Button>
          ) : (
            <Button onClick={handleConnect} disabled={isConnecting} className="text-xs">
              {isConnecting
                ? <span className="flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> Connecting…</span>
                : 'Connect Drive'}
            </Button>
          )}
        </div>
      </div>

      {error && (
        <p className="text-xs text-red-500 bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2">{error}</p>
      )}

      {/* Info about existing links */}
      {permission !== 'granted' && (
        <div className="text-xs text-slate-400 dark:text-slate-500 space-y-1">
          <p>
            <strong>What happens to existing attachments?</strong> Files already uploaded to your Drive remain there and their links still work — revoking access only stops the app from uploading new files. You can delete files from your Drive directly if needed.
          </p>
        </div>
      )}
    </div>
  );
}
