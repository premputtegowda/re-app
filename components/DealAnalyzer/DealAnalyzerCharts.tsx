'use client';

import { useState } from 'react';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from 'recharts';
import { Card } from '@/components/UI/Card';
import type { CoCYearlyProjection } from '@/types';
import { formatCurrency } from '@/utils/dealAnalyzerCalc';

type Tab = 'cashflow' | 'coc';

interface DealChartsProps {
  projections: CoCYearlyProjection[];
}

export function DealCharts({ projections }: DealChartsProps) {
  const [tab, setTab] = useState<Tab>('cashflow');

  return (
    <Card padding="none">
      {/* Tab bar */}
      <div className="flex border-b border-slate-100 dark:border-slate-700">
        <TabBtn active={tab === 'cashflow'} onClick={() => setTab('cashflow')}>Cash Flow</TabBtn>
        <TabBtn active={tab === 'coc'} onClick={() => setTab('coc')}>CoC Return</TabBtn>
      </div>

      <div className="p-4">
        {tab === 'cashflow' ? (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={projections} margin={{ top: 4, right: 8, bottom: 8, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="year" tick={{ fontSize: 11 }} tickLine={false} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} width={52} axisLine={false} tickLine={false} />
              <Tooltip
                formatter={(value: number) => [formatCurrency(value), 'Cash Flow']}
                contentStyle={{ fontSize: 12, borderRadius: 8, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
              />
              <ReferenceLine y={0} stroke="#94A3B8" strokeDasharray="4 4" />
              <Line
                type="monotone"
                dataKey="cashFlow"
                stroke="#3B82F6"
                strokeWidth={2.5}
                dot={{ fill: '#3B82F6', r: 3.5, strokeWidth: 0 }}
                activeDot={{ r: 5 }}
              />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={projections} margin={{ top: 4, right: 8, bottom: 8, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              <XAxis dataKey="year" tick={{ fontSize: 11 }} tickLine={false} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${v.toFixed(0)}%`} width={40} axisLine={false} tickLine={false} />
              <Tooltip
                formatter={(value: number) => [`${value.toFixed(2)}%`, 'CoC Return']}
                contentStyle={{ fontSize: 12, borderRadius: 8, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
              />
              <ReferenceLine y={0} stroke="#94A3B8" />
              <Bar dataKey="coCReturn" radius={[4, 4, 0, 0]}>
                {projections.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.coCReturn >= 0 ? '#10B981' : '#EF4444'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </Card>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 py-2.5 text-xs font-semibold transition-colors ${
        active
          ? 'text-primary-600 dark:text-primary-400 border-b-2 border-primary-600 dark:border-primary-400'
          : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
      }`}
    >
      {children}
    </button>
  );
}

// Legacy named exports kept for any direct imports elsewhere
export function CashFlowTrendChart({ projections }: { projections: CoCYearlyProjection[] }) {
  return <DealCharts projections={projections} />;
}
export function CoCReturnChart({ projections }: { projections: CoCYearlyProjection[] }) {
  return <DealCharts projections={projections} />;
}
