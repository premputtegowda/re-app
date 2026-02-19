'use client';

import React from 'react';
import { Header } from './Header';
import { Navigation } from './Navigation';
import type { ViewMode } from '@/types';

interface LayoutProps {
  children: React.ReactNode;
  currentView: ViewMode;
  onViewChange: (view: ViewMode) => void;
}

export function Layout({ children, currentView, onViewChange }: LayoutProps) {
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
      <Header />

      <Navigation currentView={currentView} onViewChange={onViewChange} />

      {/* Main content — bottom padding accounts for mobile tab bar */}
      <main className="lg:ml-64 pt-4 pb-20 lg:pb-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          {children}
        </div>
      </main>
    </div>
  );
}
