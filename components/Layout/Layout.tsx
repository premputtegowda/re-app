'use client';

import React from 'react';
import { usePathname } from 'next/navigation';
import { Header } from './Header';
import { Navigation } from './Navigation';
import { FeedbackButton } from '@/components/Feedback/FeedbackButton';

interface LayoutProps {
  children: React.ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const pathname = usePathname();
  const hasSidebar = true;

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
      <Header />

      <Navigation />

      {/* Main content — bottom padding accounts for mobile tab bar */}
      <main className={`${hasSidebar ? 'lg:ml-64' : ''} pt-4 pb-20 lg:pb-8`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          {children}
        </div>
      </main>

      <FeedbackButton />
    </div>
  );
}
