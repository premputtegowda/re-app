'use client';

import { LogOut } from 'lucide-react';
import { useAuthStore } from '@/lib/authStore';
import { useStore } from '@/lib/store';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';

export function Header() {
  const { user, logout } = useAuthStore();
  const { clearData } = useStore();

  const handleLogout = async () => {
    await logout();
    clearData();
  };

  return (
    <header className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700/60 sticky top-0 z-40 backdrop-blur-sm bg-white/95 dark:bg-slate-900/95">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-14 grid grid-cols-3 items-center gap-4">

        {/* Left — Brand */}
        <div className="flex items-center gap-2.5 min-w-0">
          {/* Logomark */}
          <div className="shrink-0 w-8 h-8 rounded-lg bg-gradient-to-br from-primary-500 to-primary-700 flex items-center justify-center shadow-sm">
            <span className="text-white font-black text-sm tracking-tight select-none">D</span>
          </div>
          <div className="hidden sm:block min-w-0">
            <p className="text-sm font-bold text-slate-900 dark:text-white leading-none tracking-tight truncate">
              DealstackRE
            </p>
            <p className="text-[10px] text-slate-400 dark:text-slate-500 leading-none mt-0.5 tracking-wide uppercase">
              Real Estate Suite
            </p>
          </div>
        </div>

        {/* Center — Workspace switcher (always perfectly centered) */}
        <div className="flex justify-center">
          <WorkspaceSwitcher />
        </div>

        {/* Right — User */}
        <div className="flex items-center justify-end gap-2">
          {user && (
            <>
              {/* Avatar + name (desktop) */}
              <div className="hidden md:flex items-center gap-2.5">
                {user.picture_url ? (
                  <img
                    src={user.picture_url}
                    alt={user.name}
                    className="w-7 h-7 rounded-full ring-2 ring-slate-200 dark:ring-slate-700"
                  />
                ) : (
                  <div className="w-7 h-7 rounded-full bg-primary-100 dark:bg-primary-900/50 ring-2 ring-primary-200 dark:ring-primary-800 flex items-center justify-center shrink-0">
                    <span className="text-xs font-bold text-primary-600 dark:text-primary-400">
                      {user.name.charAt(0).toUpperCase()}
                    </span>
                  </div>
                )}
                <span className="text-sm font-medium text-slate-600 dark:text-slate-300 max-w-[120px] truncate">
                  {user.name.split(' ')[0]}
                </span>
              </div>

              {/* Divider (desktop) */}
              <div className="hidden md:block w-px h-5 bg-slate-200 dark:bg-slate-700 mx-1" />

              {/* Logout */}
              <button
                onClick={handleLogout}
                title="Sign out"
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                <LogOut size={14} />
                <span className="hidden md:inline">Sign out</span>
              </button>
            </>
          )}
        </div>

      </div>
    </header>
  );
}
