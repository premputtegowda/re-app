'use client';

import { useState, useEffect } from 'react';
import { Archive, Download, Loader2, CheckCircle, AlertTriangle, Info } from 'lucide-react';
import { useStore } from '@/lib/store';
import { createExportBundle, sortedEntries } from '@/lib/exportUtils';
import { Button } from '@/components/UI/Button';
import { Card } from '@/components/UI/Card';

const LAST_EXPORT_KEY = 'reps_last_export_ts';

export function ExportBundle() {
  const entries = useStore((s) => s.entries);
  const categories = useStore((s) => s.categories);
  const properties = useStore((s) => s.properties);
  // Attachments are stored in Google Drive — links come from the backend manifest, not local files
  const attachmentFiles: Record<string, File[]> = {};

  const [isExporting, setIsExporting] = useState(false);
  const [exported, setExported] = useState(false);
  // Initialise to null (server) and compute on client-only to avoid hydration mismatch.
  const [days, setDays] = useState<number | null>(null);

  useEffect(() => {
    const ts = localStorage.getItem(LAST_EXPORT_KEY);
    if (ts) {
      setDays(Math.floor((Date.now() - parseInt(ts, 10)) / 86_400_000));
    }
  }, []);

  const showReminder = days === null || days >= 30;


  const handleExport = async () => {
    setIsExporting(true);
    try {
      const blob = await createExportBundle(entries, categories, properties, attachmentFiles);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `REPS_Audit_Bundle_${new Date().getFullYear()}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      localStorage.setItem(LAST_EXPORT_KEY, String(Date.now()));
      setDays(0);
      setExported(true);
      setTimeout(() => setExported(false), 3500);
    } catch (err) {
      console.error('Export failed', err);
    } finally {
      setIsExporting(false);
    }
  };

  // Build a preview of what will be in the ZIP
  const sorted = sortedEntries(entries);

  return (
    <Card>
      {/* Monthly reminder banner */}
      {showReminder && (
        <div className="mb-4 flex gap-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg p-3">
          <AlertTriangle className="text-amber-500 shrink-0 mt-0.5" size={16} />
          <p className="text-sm text-amber-800 dark:text-amber-300">
            {days === null
              ? "You haven't exported your audit bundle yet."
              : `It's been ${days} days since your last export.`}{' '}
            <span className="font-medium">IRS best practice: export monthly.</span>
          </p>
        </div>
      )}

      <div className="flex items-start gap-4">
        {/* Icon */}
        <div className="w-10 h-10 bg-primary-50 dark:bg-primary-900/30 rounded-lg flex items-center justify-center shrink-0">
          <Archive className="text-primary-600 dark:text-primary-400" size={20} />
        </div>

        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-slate-900 dark:text-white mb-1">One-Click Audit Bundle</h3>
          <p className="text-sm text-slate-600 dark:text-slate-400 mb-3">
            Downloads a ZIP with your full activity log and any attached receipts or photos,
            renamed to match entry numbers for easy audit reference.
          </p>

          {/* Bundle contents preview */}
          <div className="bg-slate-50 dark:bg-slate-700/50 rounded-lg p-3 mb-4 space-y-1.5 text-xs font-mono text-slate-600 dark:text-slate-300">
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 bg-green-400 rounded-sm shrink-0" />
              <span>REPS_Audit_Log_{new Date().getFullYear()}.csv</span>
              <span className="text-slate-400 ml-auto">{entries.length} entries</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 bg-blue-400 rounded-sm shrink-0" />
              <span>REPS_Attachments_{new Date().getFullYear()}.csv</span>
              <span className="text-slate-400 ml-auto">Drive links</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 bg-slate-300 dark:bg-slate-500 rounded-sm shrink-0" />
              <span>README.txt</span>
            </div>
          </div>

          {entries.length > 0 && (
            <div className="flex gap-2 text-xs text-slate-500 dark:text-slate-400 mb-4">
              <Info size={13} className="shrink-0 mt-0.5" />
              <span>Attachments are stored in your Google Drive. Links are included in the weekly email manifest.</span>
            </div>
          )}

          <Button
            onClick={handleExport}
            disabled={isExporting || entries.length === 0}
            className="flex items-center gap-2"
          >
            {isExporting ? (
              <><Loader2 size={16} className="animate-spin" /> Building bundle…</>
            ) : exported ? (
              <><CheckCircle size={16} /> Downloaded!</>
            ) : (
              <><Download size={16} /> Download Audit Bundle</>
            )}
          </Button>
          {entries.length === 0 && (
            <p className="text-xs text-slate-400 mt-2">Log some hours first.</p>
          )}
          {!exported && days !== null && days < 30 && (
            <p className="text-xs text-slate-400 mt-2">Last exported {days === 0 ? 'today' : `${days} day${days !== 1 ? 's' : ''} ago`}.</p>
          )}
        </div>
      </div>
    </Card>
  );
}
