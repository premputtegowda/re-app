'use client';

import { useRouter, usePathname } from 'next/navigation';
import { LayoutDashboard, List, PlusCircle, Settings, ShieldCheck, Tag, Folder } from 'lucide-react';
import { useAuthStore } from '@/lib/authStore';

const REPS_ROUTES = ['/dashboard', '/entry', '/list', '/settings', '/admin'];

export function Navigation() {
  const router = useRouter();
  const pathname = usePathname();
  const isAdmin = useAuthStore((s) => s.user?.is_admin ?? false);

  // Don't show sidebar navigation on Deal Analyzer pages
  const isDealAnalyzer = pathname.startsWith('/deal-analyzer');
  if (isDealAnalyzer) return null;

  const navItems = [
    { href: '/dashboard', label: 'Home', icon: LayoutDashboard },
    { href: '/entry', label: 'Add', icon: PlusCircle },
    { href: '/list', label: 'List', icon: List },
    { href: '/settings', label: 'Settings', icon: Settings },
    ...(isAdmin ? [{ href: '/admin', label: 'Admin', icon: ShieldCheck }] : []),
  ];

  return (
    <>
      {/* Desktop sidebar */}
      <nav className="hidden lg:block bg-white dark:bg-slate-800 border-r border-slate-200 dark:border-slate-700 w-64 fixed left-0 top-16 bottom-0 overflow-y-auto">
        <div className="p-4 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href;

            return (
              <button
                key={item.href}
                onClick={() => router.push(item.href)}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                  isActive
                    ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-400 font-medium'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'
                }`}
              >
                <Icon size={20} />
                <span>{item.label === 'Add' ? 'Add Hours' : item.label === 'List' ? 'View Hours' : item.label}</span>
              </button>
            );
          })}
        </div>

        {/* Quick Links */}
        <div className="p-4 border-t border-slate-200 dark:border-slate-700 mt-4">
          <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3">
            Quick Actions
          </h3>
          <div className="space-y-1">
            <button
              onClick={() => router.push('/settings#categories')}
              className="w-full flex items-center gap-3 px-4 py-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors text-sm"
            >
              <Tag size={18} />
              <span>Manage Categories</span>
            </button>
            <button
              onClick={() => router.push('/settings#properties')}
              className="w-full flex items-center gap-3 px-4 py-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors text-sm"
            >
              <Folder size={18} />
              <span>Manage Properties</span>
            </button>
          </div>
        </div>
      </nav>

      {/* Mobile bottom tab bar */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 bg-white dark:bg-slate-800 border-t border-slate-200 dark:border-slate-700 z-40">
        <div className="flex">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href;

            return (
              <button
                key={item.href}
                onClick={() => router.push(item.href)}
                className={`flex-1 flex flex-col items-center justify-center py-2 gap-1 transition-colors ${
                  isActive
                    ? 'text-primary-600 dark:text-primary-400'
                    : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                <Icon size={22} />
                <span className="text-xs font-medium">{item.label}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </>
  );
}
