'use client';

import { LayoutDashboard, List, PlusCircle, Settings, Folder, Tag } from 'lucide-react';
import type { ViewMode } from '@/types';

interface NavigationProps {
  currentView: ViewMode;
  onViewChange: (view: ViewMode) => void;
  isMobileMenuOpen: boolean;
  onMenuClose: () => void;
}

export function Navigation({ currentView, onViewChange, isMobileMenuOpen, onMenuClose }: NavigationProps) {
  const navItems = [
    { id: 'dashboard' as ViewMode, label: 'Dashboard', icon: LayoutDashboard },
    { id: 'entry' as ViewMode, label: 'Add Hours', icon: PlusCircle },
    { id: 'list' as ViewMode, label: 'View Hours', icon: List },
    { id: 'settings' as ViewMode, label: 'Settings', icon: Settings },
  ];

  const handleNavClick = (view: ViewMode) => {
    onViewChange(view);
    onMenuClose();
  };

  return (
    <>
      {/* Desktop Navigation */}
      <nav className="hidden lg:block bg-white border-r border-slate-200 w-64 fixed left-0 top-16 bottom-0 overflow-y-auto">
        <div className="p-4 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = currentView === item.id;

            return (
              <button
                key={item.id}
                onClick={() => handleNavClick(item.id)}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                  isActive
                    ? 'bg-primary-50 text-primary-700 font-medium'
                    : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                <Icon size={20} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>

        {/* Quick Links */}
        <div className="p-4 border-t border-slate-200 mt-4">
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
            Quick Actions
          </h3>
          <div className="space-y-1">
            <button
              onClick={() => handleNavClick('settings')}
              className="w-full flex items-center gap-3 px-4 py-2 rounded-lg text-slate-600 hover:bg-slate-50 transition-colors text-sm"
            >
              <Tag size={18} />
              <span>Manage Categories</span>
            </button>
            <button
              onClick={() => handleNavClick('settings')}
              className="w-full flex items-center gap-3 px-4 py-2 rounded-lg text-slate-600 hover:bg-slate-50 transition-colors text-sm"
            >
              <Folder size={18} />
              <span>Manage Properties</span>
            </button>
          </div>
        </div>
      </nav>

      {/* Mobile Navigation */}
      {isMobileMenuOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black bg-opacity-50 z-40 lg:hidden"
            onClick={onMenuClose}
          />

          {/* Menu */}
          <nav className="fixed left-0 top-16 bottom-0 w-64 bg-white border-r border-slate-200 z-50 lg:hidden overflow-y-auto">
            <div className="p-4 space-y-1">
              {navItems.map((item) => {
                const Icon = item.icon;
                const isActive = currentView === item.id;

                return (
                  <button
                    key={item.id}
                    onClick={() => handleNavClick(item.id)}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                      isActive
                        ? 'bg-primary-50 text-primary-700 font-medium'
                        : 'text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    <Icon size={20} />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>
          </nav>
        </>
      )}
    </>
  );
}
