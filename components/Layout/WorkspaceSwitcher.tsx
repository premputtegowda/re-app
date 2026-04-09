'use client';

import { useRouter, usePathname } from 'next/navigation';
import { Clock, Calculator, BarChart2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuthStore } from '@/lib/authStore';

interface Workspace {
  key: string;
  label: string;
  shortLabel: string;
  icon: React.ElementType;
  homeRoute: string;
  requiredFeature: string;
  comingSoon?: boolean;
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
  {
    key: 'market_research',
    label: 'Market Research',
    shortLabel: 'Markets',
    icon: BarChart2,
    homeRoute: '',
    requiredFeature: '',
    comingSoon: true,
  },
];

function getActiveKey(pathname: string): string {
  if (pathname.startsWith('/deal-analyzer')) return 'deal_analyzer';
  return 'reps';
}

function useWorkspaceProps() {
  const router = useRouter();
  const pathname = usePathname();
  const features = useAuthStore((s) => s.user?.features ?? []);
  const activeKey = getActiveKey(pathname);
  const visible = WORKSPACES.filter((w) => w.comingSoon || features.includes(w.requiredFeature));

  const handleClick = (ws: Workspace) => {
    if (ws.comingSoon) {
      toast.info(`${ws.label} — Coming Soon!`, {
        id: `coming-soon-${ws.key}`,
        description: "We're working on it. Stay tuned.",
        duration: 3000,
      });
      return;
    }
    router.push(ws.homeRoute);
  };

  return { visible, activeKey, handleClick };
}

/** Full-width tab strip — shown on mobile only */
export function WorkspaceTabBar() {
  const { visible, activeKey, handleClick } = useWorkspaceProps();
  if (visible.length <= 1) return null;

  return (
    <div className="flex lg:hidden border-t border-slate-200 dark:border-slate-700/60">
      {visible.map((ws) => {
        const Icon = ws.icon;
        const isActive = ws.key === activeKey && !ws.comingSoon;
        return (
          <button
            key={ws.key}
            onClick={() => handleClick(ws)}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 relative transition-colors
              ${ws.comingSoon
                ? 'text-slate-400 dark:text-slate-600 cursor-default'
                : isActive
                  ? 'text-primary-600 dark:text-primary-400'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/50'
              }`}
          >
            {isActive && (
              <span className="absolute bottom-0 left-4 right-4 h-0.5 rounded-full bg-primary-500 dark:bg-primary-400" />
            )}
            <Icon size={15} className="shrink-0" />
            <span className="text-xs font-semibold">{ws.shortLabel}</span>
            {ws.comingSoon && (
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 leading-none">
                Soon
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** Compact inline tabs — shown in header on desktop only */
export function WorkspaceTabsDesktop() {
  const { visible, activeKey, handleClick } = useWorkspaceProps();
  if (visible.length <= 1) return null;

  return (
    <div className="hidden lg:flex items-center gap-1">
      {visible.map((ws) => {
        const Icon = ws.icon;
        const isActive = ws.key === activeKey && !ws.comingSoon;
        return (
          <button
            key={ws.key}
            onClick={() => handleClick(ws)}
            className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-semibold transition-all
              ${ws.comingSoon
                ? 'text-slate-400 dark:text-slate-600 cursor-default'
                : isActive
                  ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
          >
            <Icon size={15} className="shrink-0" />
            <span>{ws.label}</span>
            {ws.comingSoon && (
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 leading-none">
                Soon
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
