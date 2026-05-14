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
  Customized,
  ResponsiveContainer,
} from 'recharts';
import { Card } from '@/components/UI/Card';
import type { CoCYearlyProjection } from '@/types';
import { formatCurrency } from '@/utils/dealAnalyzerCalc';
import type { SavedMCResults } from '@/utils/monteCarlo';

interface DealChartsProps {
  projections: CoCYearlyProjection[];
  mcResults?: SavedMCResults | null;
}

// Renders purple dotted bars overlaid on the CF bars using chart internals
function P50CFOverlay({ xAxisMap, yAxisMap, data }: any) {
  const xAxis = xAxisMap?.[0];
  const yAxis = yAxisMap?.['left'];
  if (!xAxis || !yAxis) return null;

  const bandwidth = xAxis.bandSize ?? xAxis.bandwidth?.() ?? 40;
  const barW = Math.min(40, bandwidth * 0.6);
  const zeroY = yAxis.scale(0);
  const patternId = 'p50-dots';

  return (
    <g>
      <defs>
        <pattern id={patternId} patternUnits="userSpaceOnUse" width="6" height="6">
          <line x1="0" y1="6" x2="6" y2="0" stroke="#1E293B" strokeWidth="1.2" />
        </pattern>
      </defs>
      {data.map((d: any) => {
        if (d.p50CF == null) return null;
        const cx = xAxis.scale(d.year) + bandwidth / 2;
        const x = cx - barW / 2;

        const total = d.p50CF + (d.p50RefiCashOut ?? 0);
        const opY  = yAxis.scale(total);
        const opTop = Math.min(opY, zeroY);
        const opH   = Math.abs(opY - zeroY);

        return (
          <g key={d.year}>
            <rect x={x} y={opTop} width={barW} height={opH}
              fill={`url(#${patternId})`} stroke="#1E293B" strokeWidth={1} strokeOpacity={0.4} rx={3} />
          </g>
        );
      })}
    </g>
  );
}

export function DealCharts({ projections, mcResults }: DealChartsProps) {
  const exitYear = projections.length;
  const yearlyP50 = mcResults?.yearlyP50?.length ? mcResults.yearlyP50 : null;

  const data = projections.map((p) => {
    const isRefiYear = p.year < exitYear && p.cashOutProceeds > 0;
    const p50Year = yearlyP50?.find(y => y.year === p.year);
    const p50Refi = p50Year?.cashOutProceeds ?? 0;
    const isP50RefiYear = p50Year != null && p50Refi > 0;
    return {
      ...p,
      operatingCF: isRefiYear ? p.cashFlow - p.cashOutProceeds : p.cashFlow,
      refiCashOut: isRefiYear ? p.cashOutProceeds : 0,
      ...(p50Year ? {
        p50CF:           isP50RefiYear ? p50Year.cashFlow - p50Refi : p50Year.cashFlow,
        p50RefiCashOut:  p50Refi,
        p50CoC:          p50Year.coCReturn,
      } : {}),
    };
  });

  const hasRefi  = data.some((d) => d.refiCashOut > 0);
  const hasPosCF = data.some((d) => d.operatingCF >= 0);
  const hasNegCF = data.some((d) => d.operatingCF < 0);

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
            <YAxis
              yAxisId="left"
              orientation="left"
              tick={{ fontSize: 10 }}
              tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
              width={52}
              axisLine={false}
              tickLine={false}
            />
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
                if (name === 'operatingCF') return [formatCurrency(value), 'Cash Flow'];
                if (name === 'refiCashOut') return [formatCurrency(value), 'Refi Cash-Out'];
                if (name === 'coCReturn') return [`${value.toFixed(2)}%`, 'CoC Return'];
                if (name === 'p50CoC') return [`${value.toFixed(2)}%`, 'Most Likely CoC'];
                if (name === 'p50CF') return [formatCurrency(value), 'Most Likely CF'];
                if (name === 'p50RefiCashOut') return [formatCurrency(value), 'Most Likely Refi Cash-Out'];
                return [value, name];
              }}
              labelFormatter={(label) => `Year ${label}`}
            />
            <Legend
              wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
              content={() => (
                <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 pt-2 text-[11px] text-slate-500 dark:text-slate-400">
                  <span className="flex items-center gap-1">
                    {hasPosCF && hasNegCF ? (
                      <span className="flex flex-col">
                        <span className="inline-block w-5 h-1.5 rounded-t-sm" style={{ background: '#10B981' }} />
                        <span className="inline-block w-1.5 h-1.5 rounded-b-sm" style={{ background: '#EF4444' }} />
                      </span>
                    ) : (
                      <span className="inline-block w-5 h-3 rounded-sm" style={{ background: hasNegCF ? '#EF4444' : '#10B981' }} />
                    )}
                    Cash Flow{hasPosCF && hasNegCF ? ' (+ / −)' : ''}
                  </span>
                  {hasRefi && (
                    <span className="flex items-center gap-1">
                      <span className="inline-block w-5 h-3 rounded-sm" style={{ background: '#6366F1' }} />
                      Refi Cash-Out
                    </span>
                  )}
                  <span className="flex items-center gap-1">
                    <span className="inline-block w-5 h-0.5 rounded" style={{ background: '#F59E0B' }} />
                    CoC Return (%)
                  </span>
                  {yearlyP50 && (
                    <span className="flex items-center gap-1">
                      <svg width="20" height="12" className="shrink-0">
                        <defs>
                          <pattern id="legend-diag" patternUnits="userSpaceOnUse" width="6" height="6">
                            <line x1="0" y1="6" x2="6" y2="0" stroke="#1E293B" strokeWidth="1.2" />
                          </pattern>
                        </defs>
                        <rect width="20" height="12" rx="2" fill="url(#legend-diag)" stroke="#1E293B" strokeWidth="0.5" strokeOpacity="0.4" />
                      </svg>
                      Most Likely (Accounts for market risk)
                    </span>
                  )}
                </div>
              )}
            />
            <ReferenceLine yAxisId="left" y={0} stroke="#1E293B" strokeDasharray="4 4" />

            {/* Actual cash flow bars */}
            <Bar yAxisId="left" dataKey="operatingCF" stackId="cf" radius={[0, 0, 0, 0]} maxBarSize={40}>
              {data.map((entry, i) => (
                <Cell key={i} fill={entry.operatingCF >= 0 ? '#10B981' : '#EF4444'} />
              ))}
            </Bar>

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

            {/* Most likely CoC — dashed line on right axis */}
            {yearlyP50 && (
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="p50CoC"
                stroke="#1E293B"
                strokeWidth={1.5}
                strokeDasharray="4 3"
                dot={false}
                activeDot={{ r: 4, fill: '#1E293B', strokeWidth: 0 }}
                legendType="none"
              />
            )}

            {/* Most likely cash flow — purple dotted bars overlaid on CF bars */}
            {yearlyP50 && (
              <Customized component={(props: any) => <P50CFOverlay {...props} data={data} />} />
            )}
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
