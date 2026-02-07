'use client';

import { Clock, Menu, X, LogOut } from 'lucide-react';
import { useAuthStore } from '@/lib/authStore';
import { useStore } from '@/lib/store';

interface HeaderProps {
  onMenuToggle: () => void;
  isMobileMenuOpen: boolean;
}

export function Header({ onMenuToggle, isMobileMenuOpen }: HeaderProps) {
  const { user, logout } = useAuthStore();
  const { clearData } = useStore();

  const handleLogout = async () => {
    await logout();
    clearData();
  };

  return (
    <header className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          {/* Logo and title */}
          <div className="flex items-center gap-3">
            <div className="bg-primary-600 p-2 rounded-lg">
              <Clock className="text-white" size={24} />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900 dark:text-white">REPS Tracker</h1>
              <p className="text-xs text-slate-600 dark:text-slate-400 hidden sm:block">Real Estate Professional Status Hours</p>
            </div>
          </div>

          {/* User info and actions */}
          <div className="flex items-center gap-4">
            {/* User avatar and name (desktop) */}
            {user && (
              <div className="hidden md:flex items-center gap-3">
                {user.picture_url ? (
                  <img
                    src={user.picture_url}
                    alt={user.name}
                    className="w-8 h-8 rounded-full"
                  />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-primary-100 dark:bg-primary-900 flex items-center justify-center">
                    <span className="text-sm font-medium text-primary-600 dark:text-primary-400">
                      {user.name.charAt(0).toUpperCase()}
                    </span>
                  </div>
                )}
                <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                  {user.name}
                </span>
              </div>
            )}

            {/* Logout button (desktop) */}
            <button
              onClick={handleLogout}
              className="hidden md:flex items-center gap-2 px-3 py-2 text-sm text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
              title="Logout"
            >
              <LogOut size={18} />
              <span>Logout</span>
            </button>

            {/* Mobile menu button */}
            <button
              onClick={onMenuToggle}
              className="lg:hidden p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors text-slate-700 dark:text-slate-200"
            >
              {isMobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}
