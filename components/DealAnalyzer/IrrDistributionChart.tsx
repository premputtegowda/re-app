'use client';

import {
  BarChart, Bar, Cell, XAxis, YAxis, Tooltip, ReferenceLine, ResponsiveContainer,
} from 'recharts';
import type { MCResults } from '@/utils/monteCarlo';
import { useDealSettingsStore } from '@/lib/dealSettingsStore';

interface IrrDistributionChartProps {
  results: MCResults;
  targetIRR: number;
}

const fmtPct = (v: number): string => `${v.toFixed(1)}%`;

/**
 * Distribution of simulated IRRs at the user's current purchase price.
 * Answers the question "given my price, what IRR range should I expect?"
 * Complements the Price Guidance card, which answers the inverse question
 * "given my target IRR, what price hits it?"
 *
 * Downside / Upside reference lines respect the user's Scenario confidence
 * setting (bear/bull percentiles). Labels are plain-English so users don't
 * need to think in P-percentiles.
 */
export function IrrDistributionChart({ results, targetIRR }: IrrDistributionChartProps) {
  const { bearPercentile, bullPercentile } = useDealSettingsStore();

  if (!results.irrBuckets || results.irrBuckets.length === 0) return null;

  // Buckets whose IRR center is negative are drawn BELOW the y=0 baseline so
  // the chart visually separates gain from loss territory. The tooltip still
  // reports the underlying (positive) run count.
  const data = results.irrBuckets.map(b => ({
    center: b.center,
    count: b.center < 0 ? -b.count : b.count,
    absCount: b.count,
  }));
  const downsideIrr = (results[bearPercentile] ?? results.p20).irr;
  const typicalIrr  = results.p50.irr;
  const upsideIrr   = (results[bullPercentile] ?? results.p80).irr;
  const allIrrs = results.sorted.map(r => r.irr).filter(v => v > -900);
  const irrMin = allIrrs.length ? Math.min(...allIrrs) : 0;
  const irrMax = allIrrs.length ? Math.max(...allIrrs) : 0;

  // Share of the distribution at or above the target IRR.
  const pctAtOrAboveTarget = allIrrs.length
    ? Math.round((allIrrs.filter(v => v >= targetIRR).length / allIrrs.length) * 100)
    : 0;

  // Colour each bar according to whether its center clears target IRR.
  const barColor = (irr: number): string => (irr >= targetIRR ? '#10b981' : '#ef4444'); // emerald-500 / red-500

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
      <div className="px-4 py-3 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-100 dark:border-slate-700">
        <p className="text-xs font-bold text-slate-700 dark:text-slate-300">IRR distribution at your current price</p>
        <p className="text-[10px] text-slate-400 mt-0.5">
          Downside {fmtPct(downsideIrr)} · Typical {fmtPct(typicalIrr)} · Upside {fmtPct(upsideIrr)}
          <span className="mx-1.5 text-slate-300 dark:text-slate-600">·</span>
          <span className={pctAtOrAboveTarget >= 70 ? 'text-secondary-600 dark:text-secondary-400' : pctAtOrAboveTarget >= 50 ? 'text-amber-600 dark:text-amber-400' : 'text-red-500'}>
            {pctAtOrAboveTarget}% of runs at or above target {fmtPct(targetIRR)}
          </span>
        </p>
      </div>
      <div className="px-2 py-3" style={{ height: 180 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 16 }}>
            <XAxis
              dataKey="center"
              type="number"
              domain={[irrMin, irrMax]}
              tickFormatter={fmtPct}
              tick={{ fontSize: 10, fill: '#94a3b8' }}
              axisLine={{ stroke: '#cbd5e1' }}
              tickLine={false}
              label={{ value: 'IRR', position: 'insideBottom', offset: -6, style: { fontSize: 10, fill: '#94a3b8' } }}
            />
            <YAxis
              tick={{ fontSize: 10, fill: '#94a3b8' }}
              axisLine={false}
              tickLine={false}
              width={28}
              tickFormatter={(v: number) => String(Math.abs(v))}
            />
            <Tooltip
              formatter={(_: number, __: string, entry: { payload?: { absCount?: number } }) =>
                [`${entry.payload?.absCount ?? 0} runs`, 'Count']
              }
              labelFormatter={(label: number) => `IRR ${fmtPct(label)}`}
              contentStyle={{ fontSize: 11, padding: '4px 8px', borderRadius: 6 }}
            />
            <ReferenceLine y={0} stroke="#cbd5e1" />
            <ReferenceLine x={downsideIrr} stroke="#ef4444" strokeDasharray="3 3" label={{ value: 'Downside', position: 'top', fontSize: 9, fill: '#ef4444' }} />
            <ReferenceLine x={upsideIrr}   stroke="#10b981" strokeDasharray="3 3" label={{ value: 'Upside',   position: 'top', fontSize: 9, fill: '#10b981' }} />
            <ReferenceLine x={targetIRR} stroke="#2563eb" strokeWidth={2} label={{ value: `Target ${fmtPct(targetIRR)}`, position: 'top', fontSize: 10, fill: '#2563eb' }} />
            <Bar dataKey="count" radius={[2, 2, 0, 0]}>
              {data.map((entry, idx) => (
                <Cell key={idx} fill={barColor(entry.center)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
