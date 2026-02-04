import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'REPS Tracker',
  description: 'Real Estate Professional Status Hours Tracking Application',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#3B82F6' },
    { media: '(prefers-color-scheme: dark)', color: '#1E40AF' },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100 transition-colors">
        {children}
      </body>
    </html>
  );
}
