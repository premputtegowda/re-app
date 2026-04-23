'use client';

import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ReferenceLine, ReferenceArea, ResponsiveContainer,
} from 'recharts';
import type { MCResults } from '@/utils/monteCarlo';
import { useDealSettingsStore } from '@/lib/dealSettingsStore';

interface IrrConfidenceChartProps {
  results: MCResults;
  targetIRR: number;
}

const fmtPct = (v: number): string => `${v.toFixed(1)}%`;

/**
 * Cumulative distribution of simulated IRRs at the user's current price —
 * plus a headline "Confidence of hitting target" number. Replaces the raw
 * histogram: the CDF makes the probability read direct (trace the curve at
 * Target IRR, read the y-value) instead of asking the user to integrate
 * over individual bars.
 */
export function IrrConfidenceChart({ results, targetIRR }: IrrConfidenceChartProps) {
  const { bearPercentile, bullPercentile } = useDealSettingsStore();

  const valid = results.sorted.filter(r => r.irr > -900).map(r => r.irr).sort((a, b) => a - b);
  if (valid.length === 0) return null;

  const n = valid.length;
  // Cumulative data: at each sampled IRR, what fraction of runs is at or below it?
  const data = valid.map((irr, i) => ({ irr, cumPct: ((i + 1) / n) * 100 }));

  const irrMin = valid[0];
  const irrMax = valid[n - 1];

  // Look up the cumulative percentage at the target IRR (linear interpolation
  // between the two bracketing data points so the readout is smooth).
  function cumAt(x: number): number {
    if (x <= data[0].irr) return data[0].cumPct;
    if (x >= data[n - 1].irr) return 100;
    for (let i = 1; i < n; i++) {
      if (data[i].irr >= x) {
        const a = data[i - 1];
        const b = data[i];
        const t = (x - a.irr) / (b.irr - a.irr || 1);
        return a.cumPct + t * (b.cumPct - a.cumPct);
      }
    }
    return 100;
  }

  const pctBelowTarget = Math.round(cumAt(targetIRR));
  const pctAtOrAboveTarget = 100 - pctBelowTarget;

  const downsideIrr = (results[bearPercentile] ?? results.p20).irr;
  const typicalIrr  = results.p50.irr;
  const upsideIrr   = (results[bullPercentile] ?? results.p80).irr;

  const confidenceClass =
    pctAtOrAboveTarget >= 70 ? 'text-secondary-600 dark:text-secondary-400' :
    pctAtOrAboveTarget >= 50 ? 'text-amber-600 dark:text-amber-400' :
                               'text-red-500';

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
      <div className="px-4 py-3 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-100 dark:border-slate-700 flex items-baseline justify-between gap-2 flex-wrap">
        <p className="text-xs font-bold text-slate-700 dark:text-slate-300">
          Confidence of hitting{' '}
          <span className="text-primary-600 dark:text-primary-400">{fmtPct(targetIRR)}</span>{' '}
          target at your current price:{' '}
          <span className={`text-sm font-extrabold tabular-nums ${confidenceClass}`}>{pctAtOrAboveTarget}%</span>
        </p>
        <p className="text-[10px] text-slate-400">
          Downside {fmtPct(downsideIrr)} · Typical {fmtPct(typicalIrr)} · Upside {fmtPct(upsideIrr)}
        </p>
      </div>
      <div className="px-2 py-3" style={{ height: 220 }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 12, right: 16, left: 0, bottom: 18 }}>
            <defs>
              <linearGradient id="cdf-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"   stopColor="#94a3b8" stopOpacity={0.35} />
                <stop offset="100%" stopColor="#94a3b8" stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="irr"
              type="number"
              domain={[irrMin, irrMax]}
              tickFormatter={fmtPct}
              tick={{ fontSize: 10, fill: '#94a3b8' }}
              axisLine={{ stroke: '#cbd5e1' }}
              tickLine={false}
              label={{ value: 'IRR', position: 'insideBottom', offset: -4, style: { fontSize: 10, fill: '#94a3b8' } }}
            />
            <YAxis
              type="number"
              domain={[0, 100]}
              tickFormatter={(v: number) => `${v}%`}
              tick={{ fontSize: 10, fill: '#94a3b8' }}
              axisLine={false}
              tickLine={false}
              width={32}
              label={{ value: 'cum. %', angle: -90, position: 'insideLeft', offset: 12, style: { fontSize: 9, fill: '#94a3b8' } }}
            />
            <Tooltip
              formatter={(value: number) => [`${value.toFixed(0)}% of runs`, 'At or below this IRR']}
              labelFormatter={(label: number) => `IRR ${fmtPct(label)}`}
              contentStyle={{ fontSize: 11, padding: '4px 8px', borderRadius: 6 }}
            />

            {/* Success zone — shaded green between Target and the top of the x-axis */}
            <ReferenceArea x1={targetIRR} x2={irrMax} fill="#10b981" fillOpacity={0.08} />
            {/* Loss zone — shaded red for IRR < 0, if applicable */}
            {irrMin < 0 && (
              <ReferenceArea x1={irrMin} x2={0} fill="#ef4444" fillOpacity={0.08} />
            )}

            <Area
              type="monotone"
              dataKey="cumPct"
              stroke="#475569"
              strokeWidth={2}
              fill="url(#cdf-fill)"
              isAnimationActive={false}
            />

            <ReferenceLine x={downsideIrr} stroke="#ef4444" strokeDasharray="3 3" label={{ value: 'Downside', position: 'top', fontSize: 9, fill: '#ef4444' }} />
            <ReferenceLine x={typicalIrr}  stroke="#f59e0b" strokeDasharray="3 3" label={{ value: 'Typical',  position: 'top', fontSize: 9, fill: '#f59e0b' }} />
            <ReferenceLine x={upsideIrr}   stroke="#10b981" strokeDasharray="3 3" label={{ value: 'Upside',   position: 'top', fontSize: 9, fill: '#10b981' }} />
            <ReferenceLine x={targetIRR} stroke="#2563eb" strokeWidth={2} label={{ value: `Target`, position: 'top', fontSize: 10, fill: '#2563eb' }} />

            {/* Horizontal helper at the curve-meets-target probability */}
            <ReferenceLine
              y={pctBelowTarget}
              stroke="#2563eb"
              strokeDasharray="2 4"
              strokeOpacity={0.4}
              label={{ value: `${pctBelowTarget}% below`, position: 'insideTopRight', fontSize: 9, fill: '#2563eb' }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
