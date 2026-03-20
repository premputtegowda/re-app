'use client';

import { useState } from 'react';
import { HardDrive, X, Upload, Link } from 'lucide-react';
import { Button } from '@/components/UI/Button';
import { useDriveStore } from '@/lib/driveStore';
import { requestDriveToken } from '@/lib/driveApi';

interface DriveConsentModalProps {
  onClose: () => void;
}

export function DriveConsentModal({ onClose }: DriveConsentModalProps) {
  const setPermission = useDriveStore((s) => s.setPermission);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState('');

  const handleConnect = async () => {
    setIsConnecting(true);
    setError('');
    try {
      const token = await requestDriveToken();
      if (token) {
        setPermission('granted');
        onClose();
      } else {
        setError('Google declined the request or access was denied. You can try again in Settings.');
        setPermission('denied');
      }
    } catch {
      setError('Something went wrong. You can connect later in Settings.');
      setPermission('denied');
    } finally {
      setIsConnecting(false);
    }
  };

  const handleSkip = () => {
    setPermission('denied');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-5">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-50 dark:bg-blue-900/30 rounded-xl">
              <HardDrive size={22} className="text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                Connect Google Drive?
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">Optional — you can change this later in Settings</p>
            </div>
          </div>
          <button onClick={handleSkip} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">
            <X size={18} />
          </button>
        </div>

        {/* Benefits */}
        <div className="space-y-3 text-sm">
          <div className="flex items-start gap-3 p-3 bg-slate-50 dark:bg-slate-700/50 rounded-xl">
            <Upload size={16} className="text-blue-500 mt-0.5 shrink-0" />
            <div>
              <p className="font-medium text-slate-800 dark:text-slate-200">Automatic file uploads</p>
              <p className="text-slate-500 dark:text-slate-400 text-xs">Attach receipts, photos, or documents directly from your device. They go to a <strong>REPS Tracker</strong> folder in your own Drive.</p>
            </div>
          </div>
          <div className="flex items-start gap-3 p-3 bg-slate-50 dark:bg-slate-700/50 rounded-xl">
            <Link size={16} className="text-slate-500 mt-0.5 shrink-0" />
            <div>
              <p className="font-medium text-slate-800 dark:text-slate-200">Or skip and paste links</p>
              <p className="text-slate-500 dark:text-slate-400 text-xs">If you prefer Dropbox, iCloud, or OneDrive, you can paste a link manually — no Drive needed.</p>
            </div>
          </div>
        </div>

        {/* Privacy note */}
        <p className="text-xs text-slate-400 dark:text-slate-500 border-t border-slate-100 dark:border-slate-700 pt-4">
          <strong>Privacy:</strong> We request the <code>drive.file</code> scope — the app can only access files it creates, never the rest of your Drive. Revoking access doesn&apos;t delete existing files from your Drive.
        </p>

        {error && (
          <p className="text-xs text-red-500 bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2">{error}</p>
        )}

        {/* Actions */}
        <div className="flex gap-3 pt-1">
          <Button variant="secondary" onClick={handleSkip} fullWidth>
            Skip for now
          </Button>
          <Button onClick={handleConnect} fullWidth disabled={isConnecting}>
            {isConnecting ? 'Connecting…' : 'Connect Drive'}
          </Button>
        </div>
      </div>
    </div>
  );
}
