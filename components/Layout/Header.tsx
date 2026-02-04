'use client';

import { Clock, Menu, X } from 'lucide-react';

interface HeaderProps {
  onMenuToggle: () => void;
  isMobileMenuOpen: boolean;
}

export function Header({ onMenuToggle, isMobileMenuOpen }: HeaderProps) {
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

          {/* Mobile menu button */}
          <button
            onClick={onMenuToggle}
            className="lg:hidden p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors text-slate-700 dark:text-slate-200"
          >
            {isMobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
        </div>
      </div>
    </header>
  );
}
