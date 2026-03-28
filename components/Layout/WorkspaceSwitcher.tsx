'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Clock, Calculator, ChevronDown, Check } from 'lucide-react';
import { useAuthStore } from '@/lib/authStore';

interface Workspace {
  key: string;
  label: string;
  shortLabel: string;
  icon: React.ElementType;
  homeRoute: string;
  requiredFeature: string;
}

const WORKSPACES: Workspace[] = [
  {
    key: 'reps',
    label: 'REPS Tracker',
    shortLabel: 'REPS',
    icon: Clock,
    homeRoute: '/dashboard',
    requiredFeature: 'reps',
  },
  {
    key: 'deal_analyzer',
    label: 'Deal Analyzer',
    shortLabel: 'Deals',
    icon: Calculator,
    homeRoute: '/deal-analyzer',
    requiredFeature: 'deal_analyzer',
  },
];

const SEGMENT_THRESHOLD = 3; // use segmented control up to this count, dropdown beyond

function getActiveKey(pathname: string): string {
  if (pathname.startsWith('/deal-analyzer')) return 'deal_analyzer';
  return 'reps';
}

// ── Segmented control (≤ SEGMENT_THRESHOLD features) ─────────────────────────

function SegmentedSwitcher({
  available,
  activeKey,
  onSelect,
}: {
  available: Workspace[];
  activeKey: string;
  onSelect: (ws: Workspace) => void;
}) {
  return (
    <div className="flex items-center bg-slate-100 dark:bg-slate-700/60 rounded-xl p-1 gap-0.5">
      {available.map((ws) => {
        const Icon = ws.icon;
        const isActive = ws.key === activeKey;
        return (
          <button
            key={ws.key}
            onClick={() => onSelect(ws)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-150 ${
              isActive
                ? 'bg-white dark:bg-slate-800 text-primary-600 dark:text-primary-400 shadow-sm ring-1 ring-slate-200 dark:ring-slate-600'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-white/50 dark:hover:bg-slate-800/50'
            }`}
          >
            <Icon size={15} className="shrink-0" />
            <span className="hidden sm:inline">{ws.label}</span>
            <span className="sm:hidden">{ws.shortLabel}</span>
          </button>
        );
      })}
    </div>
  );
}

// ── Dropdown (> SEGMENT_THRESHOLD features) ───────────────────────────────────

function DropdownSwitcher({
  available,
  activeKey,
  onSelect,
}: {
  available: Workspace[];
  activeKey: string;
  onSelect: (ws: Workspace) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const active = available.find((w) => w.key === activeKey) ?? available[0];
  const ActiveIcon = active.icon;

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2.5 px-4 py-2 rounded-xl bg-primary-50 dark:bg-primary-900/30 border border-primary-200 dark:border-primary-700/50 hover:bg-primary-100 dark:hover:bg-primary-900/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <ActiveIcon size={15} className="text-primary-600 dark:text-primary-400 shrink-0" />
          <span className="text-sm font-semibold text-primary-700 dark:text-primary-300 hidden sm:inline">
            {active.label}
          </span>
          <span className="text-sm font-semibold text-primary-700 dark:text-primary-300 sm:hidden">
            {active.shortLabel}
          </span>
        </div>
        <ChevronDown
          size={14}
          className={`text-primary-500 dark:text-primary-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="absolute left-1/2 -translate-x-1/2 top-full mt-2 w-52 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl z-50 py-1.5 overflow-hidden">
          <p className="px-4 pt-1.5 pb-2 text-[10px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-widest">
            Switch to
          </p>
          {available.map((ws) => {
            const Icon = ws.icon;
            const isActive = ws.key === activeKey;
            return (
              <button
                key={ws.key}
                onClick={() => { onSelect(ws); setOpen(false); }}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                  isActive
                    ? 'bg-primary-50 dark:bg-primary-900/20'
                    : 'hover:bg-slate-50 dark:hover:bg-slate-700/50'
                }`}
              >
                <div className={`p-1.5 rounded-lg shrink-0 ${
                  isActive
                    ? 'bg-primary-100 dark:bg-primary-900/50'
                    : 'bg-slate-100 dark:bg-slate-700'
                }`}>
                  <Icon size={14} className={isActive ? 'text-primary-600 dark:text-primary-400' : 'text-slate-500 dark:text-slate-400'} />
                </div>
                <span className={`text-sm font-medium flex-1 ${
                  isActive
                    ? 'text-primary-700 dark:text-primary-300'
                    : 'text-slate-700 dark:text-slate-200'
                }`}>
                  {ws.label}
                </span>
                {isActive && <Check size={13} className="text-primary-500 shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

export function WorkspaceSwitcher() {
  const router = useRouter();
  const pathname = usePathname();

  const features = useAuthStore((s) => s.user?.features ?? []);
  const available = WORKSPACES.filter((w) => features.includes(w.requiredFeature));
  const activeKey = getActiveKey(pathname);

  if (available.length <= 1) return null;

  const handleSelect = (ws: Workspace) => router.push(ws.homeRoute);

  if (available.length <= SEGMENT_THRESHOLD) {
    return <SegmentedSwitcher available={available} activeKey={activeKey} onSelect={handleSelect} />;
  }

  return <DropdownSwitcher available={available} activeKey={activeKey} onSelect={handleSelect} />;
}
