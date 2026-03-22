'use client';

import { useState, useMemo } from 'react';
import {
  Package, FileText, Paperclip, CheckCircle2,
  Download, Loader2, ChevronDown,
} from 'lucide-react';
import { useStore } from '@/lib/store';
import { api } from '@/lib/api';

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: CURRENT_YEAR - 2019 }, (_, i) => CURRENT_YEAR - i);

export function AuditExport() {
  const entries = useStore((s) => s.entries);
  const [year, setYear] = useState(CURRENT_YEAR);
  const [isDownloading, setIsDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { entryCount, attachmentCount } = useMemo(() => {
    const yearEntries = entries.filter((e) => new Date(e.date).getFullYear() === year);
    const attachments = yearEntries.reduce((sum, e) => sum + (e.attachments?.length ?? 0), 0);
    return { entryCount: yearEntries.length, attachmentCount: attachments };
  }, [entries, year]);

  const handleDownload = async () => {
    setIsDownloading(true);
    setError(null);
    try {
      const blob = await api.downloadAuditPackage(year);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `REPS_Audit_Package_${year}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Download failed. Please try again.');
    } finally {
      setIsDownloading(false);
    }
  };

  const CHECKLIST = [
    { label: 'Activity log CSV — numbered entries, ready for Excel or Google Sheets' },
    { label: 'Supporting files, labeled by entry number for easy cross-reference' },
    { label: 'Self-contained — no expiring links, no app access needed' },
  ];

  return (
    <div className="relative overflow-hidden rounded-2xl border border-amber-200 dark:border-amber-800/60 bg-gradient-to-br from-amber-50 via-white to-orange-50 dark:from-amber-950/30 dark:via-slate-900 dark:to-orange-950/20 shadow-sm">

      {/* Top accent bar */}
      <div className="h-1 w-full bg-gradient-to-r from-amber-400 via-orange-400 to-amber-500" />

      <div className="p-6 sm:p-8">

        {/* Header */}
        <div className="flex items-start gap-4 mb-6">
          <div className="flex-shrink-0 w-12 h-12 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow-md">
            <Package size={24} className="text-white" />
          </div>
          <div>
            <h3 className="text-xl font-bold text-slate-900 dark:text-white">
              Audit Package
            </h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
              Everything your CPA needs, in one download
            </p>
          </div>
        </div>

        {/* Stats + Year selector */}
        <div className="grid grid-cols-3 gap-3 mb-6">
          <div className="rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-4 py-3 text-center shadow-sm">
            <div className="flex items-center justify-center gap-1.5 mb-1">
              <FileText size={14} className="text-amber-500" />
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Entries</span>
            </div>
            <p className="text-2xl font-bold text-slate-900 dark:text-white">{entryCount}</p>
          </div>

          <div className="rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-4 py-3 text-center shadow-sm">
            <div className="flex items-center justify-center gap-1.5 mb-1">
              <Paperclip size={14} className="text-amber-500" />
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Files</span>
            </div>
            <p className="text-2xl font-bold text-slate-900 dark:text-white">{attachmentCount}</p>
          </div>

          <div className="rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-4 py-3 text-center shadow-sm">
            <div className="flex items-center justify-center gap-1.5 mb-1">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Year</span>
              <ChevronDown size={12} className="text-slate-400" />
            </div>
            <select
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              className="w-full text-center text-xl font-bold text-slate-900 dark:text-white bg-transparent border-none outline-none cursor-pointer"
            >
              {YEARS.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
        </div>

        {/* What's inside */}
        <div className="mb-6 space-y-2.5">
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-3">
            What&apos;s inside
          </p>
          {CHECKLIST.map((item) => (
            <div key={item.label} className="flex items-start gap-2.5">
              <CheckCircle2 size={16} className="text-amber-500 mt-0.5 shrink-0" />
              <span className="text-sm text-slate-700 dark:text-slate-300">{item.label}</span>
            </div>
          ))}
        </div>

        {/* Package structure preview */}
        <div className="mb-6 rounded-xl bg-slate-900 dark:bg-slate-950 p-4 font-mono text-xs leading-relaxed">
          <p className="text-amber-400 font-semibold mb-2">REPS_Audit_Package_{year}.zip</p>
          <p className="text-slate-400">├── <span className="text-green-400">REPS_Audit_Log_{year}.csv</span></p>
          <p className="text-slate-400">└── attachments/</p>
          <p className="text-slate-400">&nbsp;&nbsp;&nbsp;&nbsp;├── <span className="text-blue-400">001_2024-01-15_receipt.pdf</span></p>
          <p className="text-slate-400">&nbsp;&nbsp;&nbsp;&nbsp;├── <span className="text-blue-400">002_2024-01-22_inspection.jpg</span></p>
          <p className="text-slate-500">&nbsp;&nbsp;&nbsp;&nbsp;└── ...</p>
        </div>

        {/* Error */}
        {error && (
          <p className="mb-4 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        {/* CTA */}
        <button
          onClick={handleDownload}
          disabled={isDownloading || entryCount === 0}
          className="w-full flex items-center justify-center gap-3 px-6 py-4 rounded-xl font-semibold text-white bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-amber-200 dark:shadow-amber-900/30 hover:shadow-xl hover:shadow-amber-300/40 dark:hover:shadow-amber-900/50 hover:-translate-y-0.5 active:translate-y-0 text-base"
        >
          {isDownloading ? (
            <>
              <Loader2 size={20} className="animate-spin" />
              Preparing package…
            </>
          ) : (
            <>
              <Download size={20} />
              Download Audit Package {year}
            </>
          )}
        </button>

        {entryCount === 0 && (
          <p className="text-center text-xs text-slate-400 mt-3">
            No entries found for {year}
          </p>
        )}
      </div>
    </div>
  );
}
