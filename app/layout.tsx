import type { Metadata } from 'next';
import Script from 'next/script';
import './globals.css';

export const metadata: Metadata = {
  title: 'REPS Tracker',
  description: 'Real Estate Professional Status Hours Tracking Application',
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
        {/* Unregister any stale service workers, then load the current one */}
        <Script id="sw-cleanup" strategy="afterInteractive">{`
          if ('serviceWorker' in navigator) {
            navigator.serviceWorker.getRegistrations().then(registrations => {
              registrations.forEach(r => r.unregister());
            });
          }
        `}</Script>
        <Script src="/registerSW.js" strategy="afterInteractive" />
      </body>
    </html>
  );
}
