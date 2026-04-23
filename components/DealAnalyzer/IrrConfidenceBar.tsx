'use client';

import type { MCResults } from '@/utils/monteCarlo';
import { useDealSettingsStore } from '@/lib/dealSettingsStore';

interface IrrConfidenceBarProps {
  results: MCResults;
  targetIRR: number;
}

const fmtPct = (v: number): string => `${v.toFixed(1)}%`;

/**
 * Zones-style confidence readout: one horizontal bar split into four regions
 * (Loss / Below Target / Above Target / Upside), each sized by probability.
 * Replaces the histogram — users get the one-sentence probability they need
 * plus a visual of where they are in the spread, with no individual-bar
 * fixation.
 */
export function IrrConfidenceBar({ results, targetIRR }: IrrConfidenceBarProps) {
  const { bearPercentile, bullPercentile } = useDealSettingsStore();

  const irrs = results.sorted.map(r => r.irr).filter(v => v > -900);
  if (irrs.length === 0) return null;

  const n = irrs.length;
  const upsideIrr   = (results[bullPercentile] ?? results.p80).irr;
  const downsideIrr = (results[bearPercentile] ?? results.p20).irr;
  const typicalIrr  = results.p50.irr;

  const lossCount       = irrs.filter(v => v < 0).length;
  const belowTargetCount = irrs.filter(v => v >= 0 && v < targetIRR).length;
  const aboveTargetCount = irrs.filter(v => v >= targetIRR && v < upsideIrr).length;
  const upsideCount      = irrs.filter(v => v >= upsideIrr).length;

  const pct = (count: number): number => Math.round((count / n) * 100);
  const zones = [
    { label: 'Loss',         sub: '< 0%',                     count: lossCount,        bg: 'bg-red-500',       fg: 'text-red-600 dark:text-red-400' },
    { label: 'Below Target', sub: `0% – ${fmtPct(targetIRR)}`, count: belowTargetCount, bg: 'bg-amber-400',     fg: 'text-amber-700 dark:text-amber-400' },
    { label: 'Above Target', sub: `${fmtPct(targetIRR)} – ${fmtPct(upsideIrr)}`, count: aboveTargetCount, bg: 'bg-emerald-500', fg: 'text-emerald-700 dark:text-emerald-400' },
    { label: 'Upside',       sub: `≥ ${fmtPct(upsideIrr)}`,   count: upsideCount,      bg: 'bg-emerald-700',   fg: 'text-emerald-800 dark:text-emerald-300' },
  ] as const;

  const confidencePct = pct(aboveTargetCount + upsideCount);
  const confidenceClass =
    confidencePct >= 70 ? 'text-secondary-600 dark:text-secondary-400' :
    confidencePct >= 50 ? 'text-amber-600 dark:text-amber-400' :
                          'text-red-500';

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
      <div className="px-4 py-3 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-100 dark:border-slate-700">
        <p className="text-xs font-bold text-slate-700 dark:text-slate-300">
          Confidence of hitting{' '}
          <span className="text-primary-600 dark:text-primary-400">{fmtPct(targetIRR)}</span>{' '}
          target at your current price:{' '}
          <span className={`text-sm font-extrabold tabular-nums ${confidenceClass}`}>{confidencePct}%</span>
        </p>
        <p className="text-[10px] text-slate-400 mt-0.5">
          Downside {fmtPct(downsideIrr)} · Typical {fmtPct(typicalIrr)} · Upside {fmtPct(upsideIrr)}
        </p>
      </div>

      <div className="px-4 py-4">
        {/* Zone labels above the bar */}
        <div className="flex w-full mb-1" role="presentation">
          {zones.map(z => {
            const width = (z.count / n) * 100;
            if (width === 0) return null;
            return (
              <div key={z.label} style={{ width: `${width}%` }} className="min-w-0 px-1 text-center">
                <p className={`text-[10px] font-semibold truncate ${z.fg}`} title={z.label}>{z.label}</p>
                <p className={`text-sm font-bold tabular-nums ${z.fg}`}>{pct(z.count)}%</p>
              </div>
            );
          })}
        </div>

        {/* Bar */}
        <div className="flex w-full h-3 rounded-full overflow-hidden" role="img" aria-label="IRR distribution by zone">
          {zones.map(z => {
            const width = (z.count / n) * 100;
            if (width === 0) return null;
            return (
              <div
                key={z.label}
                className={z.bg}
                style={{ width: `${width}%` }}
                title={`${z.label} — ${pct(z.count)}% (${z.sub})`}
              />
            );
          })}
        </div>

        {/* IRR tick legend */}
        <div className="flex justify-between mt-1.5 text-[10px] text-slate-400 dark:text-slate-500">
          <span>0%</span>
          <span className="text-primary-500 dark:text-primary-400 font-medium">
            Target {fmtPct(targetIRR)}
          </span>
          <span className="text-secondary-600 dark:text-secondary-400 font-medium">
            Upside {fmtPct(upsideIrr)}
          </span>
        </div>
      </div>
    </div>
  );
}
