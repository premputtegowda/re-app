'use client';

import {
  ComposedChart,
  Bar,
  Line,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { Card } from '@/components/UI/Card';
import type { CoCYearlyProjection } from '@/types';
import { formatCurrency } from '@/utils/dealAnalyzerCalc';

interface DealChartsProps {
  projections: CoCYearlyProjection[];
}

export function DealCharts({ projections }: DealChartsProps) {
  const exitYear = projections.length;

  // Split cash flow into operating vs refi cash-out.
  // Exit year proceeds are part of the deal story but not refi — keep them in operatingCF.
  const data = projections.map((p) => {
    const isRefiYear = p.year < exitYear && p.cashOutProceeds > 0;
    return {
      ...p,
      operatingCF: isRefiYear ? p.cashFlow - p.cashOutProceeds : p.cashFlow,
      refiCashOut: isRefiYear ? p.cashOutProceeds : 0,
    };
  });

  const hasRefi = data.some((d) => d.refiCashOut > 0);

  return (
    <Card padding="none">
      <div className="px-4 pt-4 pb-1">
        <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">Cash Flow &amp; CoC Return</p>
        <p className="text-[10px] text-slate-400 mt-0.5">Yearly projection{hasRefi ? ' · Refi cash-out highlighted' : ''}</p>
      </div>
      <div className="p-4 pt-2">
        <ResponsiveContainer width="100%" height={240}>
          <ComposedChart data={data} margin={{ top: 4, right: 48, bottom: 8, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
            <XAxis
              dataKey="year"
              tick={{ fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => `Yr ${v}`}
            />
            {/* Left axis — dollars */}
            <YAxis
              yAxisId="left"
              orientation="left"
              tick={{ fontSize: 10 }}
              tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
              width={52}
              axisLine={false}
              tickLine={false}
            />
            {/* Right axis — percentage */}
            <YAxis
              yAxisId="right"
              orientation="right"
              tick={{ fontSize: 10 }}
              tickFormatter={(v) => `${v.toFixed(0)}%`}
              width={36}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              contentStyle={{ fontSize: 12, borderRadius: 8, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
              formatter={(value: number, name: string) => {
                if (name === 'operatingCF') return [formatCurrency(value), 'Operating Cash Flow'];
                if (name === 'refiCashOut') return [formatCurrency(value), 'Refi Cash-Out'];
                if (name === 'coCReturn') return [`${value.toFixed(2)}%`, 'CoC Return'];
                return [value, name];
              }}
              labelFormatter={(label) => `Year ${label}`}
            />
            <Legend
              wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
              formatter={(value) => {
                if (value === 'operatingCF') return 'Cash Flow ($)';
                if (value === 'refiCashOut') return 'Refi Cash-Out ($)';
                if (value === 'coCReturn') return 'CoC Return (%)';
                return value;
              }}
            />
            <ReferenceLine yAxisId="left" y={0} stroke="#94A3B8" strokeDasharray="4 4" />

            {/* Operating cash flow — green positive, red negative */}
            <Bar yAxisId="left" dataKey="operatingCF" stackId="cf" radius={[0, 0, 0, 0]} maxBarSize={40}>
              {data.map((entry, i) => (
                <Cell key={i} fill={entry.operatingCF >= 0 ? '#10B981' : '#EF4444'} />
              ))}
            </Bar>

            {/* Refi cash-out — stacked on top in indigo */}
            {hasRefi && (
              <Bar yAxisId="left" dataKey="refiCashOut" stackId="cf" radius={[3, 3, 0, 0]} maxBarSize={40} fill="#6366F1" />
            )}

            {/* CoC return line */}
            <Line
              yAxisId="right"
              type="monotone"
              dataKey="coCReturn"
              stroke="#F59E0B"
              strokeWidth={2}
              dot={{ fill: '#F59E0B', r: 3, strokeWidth: 0 }}
              activeDot={{ r: 5 }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

// Legacy named exports kept for any direct imports elsewhere
export function CashFlowTrendChart({ projections }: { projections: CoCYearlyProjection[] }) {
  return <DealCharts projections={projections} />;
}
export function CoCReturnChart({ projections }: { projections: CoCYearlyProjection[] }) {
  return <DealCharts projections={projections} />;
}
