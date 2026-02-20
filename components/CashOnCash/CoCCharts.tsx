'use client';

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
import { formatCurrency } from '@/utils/cashOnCashCalc';

interface CashFlowTrendChartProps {
  projections: CoCYearlyProjection[];
}

export function CashFlowTrendChart({ projections }: CashFlowTrendChartProps) {
  return (
    <Card>
      <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">
        Annual Cash Flow Trend
      </h3>
      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={projections}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="year" tick={{ fontSize: 12 }} label={{ value: 'Year', position: 'insideBottom', offset: -2 }} />
          <YAxis
            tick={{ fontSize: 12 }}
            tickFormatter={(v) => formatCurrency(v)}
            width={90}
          />
          <Tooltip formatter={(value: number) => [formatCurrency(value), 'Cash Flow']} />
          <ReferenceLine y={0} stroke="#94A3B8" strokeDasharray="4 4" />
          <Line
            type="monotone"
            dataKey="cashFlow"
            stroke="#3B82F6"
            strokeWidth={2}
            dot={{ fill: '#3B82F6', r: 4 }}
            activeDot={{ r: 6 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </Card>
  );
}

interface CoCReturnChartProps {
  projections: CoCYearlyProjection[];
}

export function CoCReturnChart({ projections }: CoCReturnChartProps) {
  return (
    <Card>
      <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">
        Cash-on-Cash Return by Year
      </h3>
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={projections}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="year" tick={{ fontSize: 12 }} label={{ value: 'Year', position: 'insideBottom', offset: -2 }} />
          <YAxis
            tick={{ fontSize: 12 }}
            tickFormatter={(v) => `${v.toFixed(1)}%`}
            width={60}
          />
          <Tooltip formatter={(value: number) => [`${value.toFixed(2)}%`, 'CoC Return']} />
          <ReferenceLine y={0} stroke="#94A3B8" />
          <Bar dataKey="coCReturn" radius={[4, 4, 0, 0]}>
            {projections.map((entry, index) => (
              <Cell
                key={`cell-${index}`}
                fill={entry.coCReturn >= 0 ? '#10B981' : '#EF4444'}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </Card>
  );
}
