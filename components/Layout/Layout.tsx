'use client';

import React, { useState } from 'react';
import { Header } from './Header';
import { Navigation } from './Navigation';
import type { ViewMode } from '@/types';

interface LayoutProps {
  children: React.ReactNode;
  currentView: ViewMode;
  onViewChange: (view: ViewMode) => void;
}

export function Layout({ children, currentView, onViewChange }: LayoutProps) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const handleMenuToggle = () => {
    setIsMobileMenuOpen(!isMobileMenuOpen);
  };

  const handleMenuClose = () => {
    setIsMobileMenuOpen(false);
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <Header onMenuToggle={handleMenuToggle} isMobileMenuOpen={isMobileMenuOpen} />

      <Navigation
        currentView={currentView}
        onViewChange={onViewChange}
        isMobileMenuOpen={isMobileMenuOpen}
        onMenuClose={handleMenuClose}
      />

      {/* Main content */}
      <main className="lg:ml-64 pt-4">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-8">
          {children}
        </div>
      </main>
    </div>
  );
}
