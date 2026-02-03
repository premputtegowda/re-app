import type { Metadata } from 'next';
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
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
