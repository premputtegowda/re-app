'use client';

import { useState, useRef, useCallback } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Card } from '@/components/UI/Card';
import type { CoCResult, CoCAcquisition, CoCOperations, CoCRefinance, ProFormaData } from '@/types';
import { formatCurrency, formatPct, formatMultiple } from '@/utils/dealAnalyzerCalc';
import { DealCharts } from './DealAnalyzerCharts';
import { WhatIfPanel } from './WhatIfPanel';
import { MonteCarloPanel } from './MonteCarloPanel';
import type { MCRanges, SavedMCResults } from '@/utils/monteCarlo';

// ── Verdict badge ───────────────────────────────────────────────────────────────

function verdict(irr: number | null, avgCoC: number): { label: string; color: string } {
  const score = (irr ?? 0) * 0.6 + avgCoC * 0.4;
  if (score >= 15) return { label: 'Strong Deal', color: 'bg-secondary-100 text-secondary-700 dark:bg-secondary-900/40 dark:text-secondary-300' };
  if (score >= 8)  return { label: 'Solid Deal',  color: 'bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300' };
  if (score >= 4)  return { label: 'Marginal',    color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' };
  return              { label: 'Weak Deal',   color: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' };
}

// ── Collapsible Cost Basis ──────────────────────────────────────────────────────

interface CostBasisProps {
  result: CoCResult;
}

function CostBasis({ result }: CostBasisProps) {
  const [open, setOpen] = useState(false);
  const { downPayment, closingCosts, pointsCost, additionalFeeItems, additionalFees,
          hardCostItems, hardCosts, softCostItems, softCosts,
          opportunityCostItems, lostOpportunityCost, totalInvested } = result;
  const hasRenovation = hardCosts > 0 || softCosts > 0;

  return (
    <Card padding="none">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3.5 text-left hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors rounded-xl"
      >
        <div className="flex items-center gap-2">
          {open ? <ChevronDown size={15} className="text-slate-400" /> : <ChevronRight size={15} className="text-slate-400" />}
          <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">Cost Basis</span>
        </div>
        <span className="text-sm font-bold text-slate-900 dark:text-white tabular-nums">
          {formatCurrency(totalInvested)}
        </span>
      </button>

      {open && (
        <div className="px-4 pb-4 border-t border-slate-100 dark:border-slate-700 pt-3 space-y-1 text-sm">
          <Row label="Down Payment" value={formatCurrency(downPayment)} />
          <Row label="Closing Costs" value={formatCurrency(closingCosts)} />
          {pointsCost > 0 && <Row label="Loan Points" value={formatCurrency(pointsCost)} />}
          {(additionalFees ?? 0) > 0 && (
            <>
              <SectionLabel label="Additional Fees" />
              {(additionalFeeItems ?? []).map(item => (
                <Row key={item.id} label={item.description || '(unlabeled)'} value={formatCurrency(item.amount)} indent />
              ))}
              <Row label="Additional Fees Total" value={formatCurrency(additionalFees ?? 0)} bold />
            </>
          )}

          {hasRenovation && (
            <>
              {hardCostItems.length > 0 ? (
                <>
                  <SectionLabel label="Hard Costs" />
                  {hardCostItems.map(item => (
                    <Row key={item.id} label={item.description || '(unlabeled)'} value={formatCurrency(item.amount)} indent />
                  ))}
                  <Row label="Hard Costs Total" value={formatCurrency(hardCosts)} bold />
                </>
              ) : hardCosts > 0 ? (
                <Row label="Hard Costs" value={formatCurrency(hardCosts)} />
              ) : null}

              {softCostItems.length > 0 ? (
                <>
                  <SectionLabel label="Soft Costs" />
                  {softCostItems.map(item => (
                    <Row key={item.id} label={item.description || '(unlabeled)'} value={formatCurrency(item.amount)} indent />
                  ))}
                  <Row label="Soft Costs Total" value={formatCurrency(softCosts)} bold />
                </>
              ) : softCosts > 0 ? (
                <Row label="Soft Costs" value={formatCurrency(softCosts)} />
              ) : null}
            </>
          )}

          {lostOpportunityCost > 0 && (
            <>
              <SectionLabel label="Lost Opportunity Cost" amber />
              {opportunityCostItems.map(item => (
                <Row key={item.id} label={item.description || '(unlabeled)'} value={formatCurrency(item.amount)} indent amber />
              ))}
              <Row label="Total Lost Opportunity" value={formatCurrency(lostOpportunityCost)} bold amber />
            </>
          )}

          <div className="flex justify-between pt-2 mt-1 border-t border-slate-200 dark:border-slate-600 font-semibold text-slate-900 dark:text-white">
            <span>Total Invested</span>
            <span className="tabular-nums">{formatCurrency(totalInvested)}</span>
          </div>
        </div>
      )}
    </Card>
  );
}

function Row({ label, value, indent, bold, amber }: { label: string; value: string; indent?: boolean; bold?: boolean; amber?: boolean }) {
  return (
    <div className={`flex justify-between py-1 border-b border-slate-100 dark:border-slate-700/60 ${indent ? 'pl-4' : ''}`}>
      <span className={`${bold ? 'font-medium' : ''} ${amber ? 'text-amber-600 dark:text-amber-400' : 'text-slate-600 dark:text-slate-400'} text-xs`}>{label}</span>
      <span className={`text-xs tabular-nums ${bold ? 'font-semibold' : 'font-medium'} ${amber ? 'text-amber-600 dark:text-amber-400' : 'text-slate-800 dark:text-slate-200'}`}>{value}</span>
    </div>
  );
}

function SectionLabel({ label, amber }: { label: string; amber?: boolean }) {
  return (
    <div className="pt-2 pb-0.5">
      <span className={`text-[10px] font-bold uppercase tracking-widest ${amber ? 'text-amber-500 dark:text-amber-400' : 'text-slate-400 dark:text-slate-500'}`}>{label}</span>
    </div>
  );
}

// ── Exit Summary ────────────────────────────────────────────────────────────────

function ExitSummary({ result }: { result: CoCResult }) {
  const { yearlyProjections, totalInvested, equityMultiple } = result;
  const terminalPropertyValue = result.terminalPropertyValue ?? 0;
  const exitClosingCosts = result.exitClosingCosts ?? 0;
  const terminalEquity = result.terminalEquity ?? 0;
  const final = yearlyProjections[yearlyProjections.length - 1];
  if (!final) return null;

  const exitYear = final.year;
  const priorCF = yearlyProjections.slice(0, -1).reduce((sum, p) => sum + (p.noi - p.debtService), 0);
  const exitYearCF = final.noi - final.debtService;
  const totalRefiProceeds = yearlyProjections.reduce((sum, p) => sum + p.cashOutProceeds, 0);
  const totalProceeds = priorCF + exitYearCF + totalRefiProceeds + terminalEquity;

  return (
    <Card padding="none">
      <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-700">
        <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Exit — Yr {exitYear}</h3>
      </div>
      <div className="px-4 py-3">
        {/* Sale proceeds */}
        <ExitRow label="Sale Price" value={formatCurrency(terminalPropertyValue)} />
        <ExitRow label="Loan Balance" value={`(${formatCurrency(final.loanBalance)})`} muted />
        <ExitRow label="Selling Costs" value={`(${formatCurrency(exitClosingCosts)})`} muted />
        <div className="border-t border-slate-100 dark:border-slate-700 mt-2 pt-2">
          <ExitRow label="Sale Proceeds" value={formatCurrency(terminalEquity)} bold />
        </div>

        {/* Cash flows */}
        <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-700">
          {exitYear > 1 && (
            <ExitRow label={`Cash Flow (Yr 1–${exitYear - 1})`} value={formatCurrency(priorCF)} />
          )}
          <ExitRow label={`Cash Flow (Yr ${exitYear})`} value={formatCurrency(exitYearCF)} />
          {totalRefiProceeds > 0 && (
            <ExitRow label="Refi Cash-Out" value={formatCurrency(totalRefiProceeds)} />
          )}
        </div>

        {/* Total proceeds + EM */}
        <div className="border-t border-slate-200 dark:border-slate-600 mt-2 pt-2 space-y-1">
          <ExitRow label="Total Proceeds" value={formatCurrency(totalProceeds)} bold highlight />
          <ExitRow label="Total Invested" value={`(${formatCurrency(totalInvested)})`} muted />
          <div className="flex justify-between items-baseline pt-1">
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">Equity Multiple</span>
            <span className="text-sm font-bold tabular-nums text-primary-600 dark:text-primary-400">{formatMultiple(equityMultiple)}</span>
          </div>
        </div>
      </div>
    </Card>
  );
}

function ExitRow({ label, value, muted, bold, highlight }: {
  label: string; value: string; muted?: boolean; bold?: boolean; highlight?: boolean;
}) {
  return (
    <div className="flex justify-between items-baseline py-1">
      <span className={`text-xs ${muted ? 'text-slate-400 dark:text-slate-500' : 'text-slate-600 dark:text-slate-400'}`}>{label}</span>
      <span className={`text-xs tabular-nums ${bold ? 'font-semibold' : 'font-medium'} ${
        highlight ? 'text-secondary-700 dark:text-secondary-400'
        : muted ? 'text-slate-500 dark:text-slate-400'
        : 'text-slate-800 dark:text-slate-200'
      }`}>{value}</span>
    </div>
  );
}

// ── Projection table ────────────────────────────────────────────────────────────

function ProjectionTable({ result }: { result: CoCResult }) {
  const { yearlyProjections, totalInvested } = result;
  const irrCashFlows: number[] = result.irrCashFlows ?? [];

  const totals = yearlyProjections.reduce(
    (acc, p) => ({
      effectiveRent: acc.effectiveRent + p.effectiveRent,
      noi: acc.noi + p.noi,
      debtService: acc.debtService + p.debtService,
      cashFlow: acc.cashFlow + p.cashFlow,
    }),
    { effectiveRent: 0, noi: 0, debtService: 0, cashFlow: 0 }
  );

  const avgCoC = yearlyProjections.reduce((s, p) => s + p.coCReturn, 0) / yearlyProjections.length;

  return (
    <Card padding="none">
      <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-700">
        <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Yearly Projections</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-slate-50 dark:bg-slate-700/40">
              <th className="sticky left-0 bg-slate-50 dark:bg-slate-800 px-3 py-2.5 text-left font-semibold text-slate-500 dark:text-slate-400 whitespace-nowrap">Yr</th>
              <th className="px-3 py-2.5 text-right font-semibold text-slate-500 dark:text-slate-400 whitespace-nowrap">EGI</th>
              <th className="px-3 py-2.5 text-right font-semibold text-slate-500 dark:text-slate-400 whitespace-nowrap">NOI</th>
              <th className="px-3 py-2.5 text-right font-semibold text-slate-500 dark:text-slate-400 whitespace-nowrap">Debt Svc</th>
              <th className="px-3 py-2.5 text-right font-semibold text-slate-500 dark:text-slate-400 whitespace-nowrap">Cash Flow</th>
              <th className="px-3 py-2.5 text-right font-semibold text-slate-500 dark:text-slate-400 whitespace-nowrap">CoC</th>
              <th className="px-3 py-2.5 text-right font-semibold text-primary-500 dark:text-primary-400 whitespace-nowrap">IRR CF</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
            {/* Year 0 — initial outlay */}
            <tr className="bg-slate-50/60 dark:bg-slate-700/10">
              <td className="sticky left-0 bg-slate-50/80 dark:bg-slate-800/60 px-3 py-2 font-semibold text-slate-400 dark:text-slate-500">0</td>
              <td colSpan={5} className="px-3 py-2 text-slate-400 dark:text-slate-500 italic">Initial outlay</td>
              <td className="px-3 py-2 text-right font-semibold tabular-nums whitespace-nowrap text-red-500 dark:text-red-400">
                {formatCurrency(irrCashFlows.length > 0 ? irrCashFlows[0] : -totalInvested)}
              </td>
            </tr>
            {yearlyProjections.map((p) => {
              const irrCF = irrCashFlows.length > p.year ? irrCashFlows[p.year] : p.cashFlow;
              const isExitYear = p.year === yearlyProjections.length;
              return (
                <tr key={p.year} className="hover:bg-slate-50/70 dark:hover:bg-slate-700/20 transition-colors">
                  <td className="sticky left-0 bg-white dark:bg-slate-800 px-3 py-2 font-semibold text-slate-700 dark:text-slate-300">
                    {p.year}
                    {p.cashOutProceeds > 0 && (
                      <span className="ml-1 text-[10px] text-primary-500 font-normal">↺</span>
                    )}
                    {isExitYear && (
                      <span className="ml-1 text-[10px] text-amber-500 font-normal">★</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right text-slate-600 dark:text-slate-400 tabular-nums whitespace-nowrap">{formatCurrency(p.effectiveRent)}</td>
                  <td className="px-3 py-2 text-right text-slate-700 dark:text-slate-300 tabular-nums whitespace-nowrap">{formatCurrency(p.noi)}</td>
                  <td className="px-3 py-2 text-right text-slate-500 dark:text-slate-500 tabular-nums whitespace-nowrap">{formatCurrency(p.debtService)}</td>
                  <td className={`px-3 py-2 text-right font-semibold tabular-nums whitespace-nowrap ${p.cashFlow >= 0 ? 'text-secondary-600 dark:text-secondary-400' : 'text-red-500 dark:text-red-400'}`}>
                    {formatCurrency(p.cashFlow)}
                  </td>
                  <td className={`px-3 py-2 text-right font-semibold tabular-nums ${p.coCReturn >= 0 ? 'text-secondary-600 dark:text-secondary-400' : 'text-red-500 dark:text-red-400'}`}>
                    {formatPct(p.coCReturn)}
                  </td>
                  <td className={`px-3 py-2 text-right font-semibold tabular-nums whitespace-nowrap ${irrCF >= 0 ? 'text-primary-600 dark:text-primary-400' : 'text-red-500 dark:text-red-400'}`}>
                    {formatCurrency(irrCF)}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="bg-slate-50 dark:bg-slate-700/40 border-t-2 border-slate-200 dark:border-slate-600 font-semibold">
              <td className="sticky left-0 bg-slate-50 dark:bg-slate-800 px-3 py-2.5 text-slate-700 dark:text-slate-300 text-xs">Total</td>
              <td className="px-3 py-2.5 text-right text-slate-700 dark:text-slate-300 tabular-nums whitespace-nowrap">{formatCurrency(totals.effectiveRent)}</td>
              <td className="px-3 py-2.5 text-right text-slate-700 dark:text-slate-300 tabular-nums whitespace-nowrap">{formatCurrency(totals.noi)}</td>
              <td className="px-3 py-2.5 text-right text-slate-600 dark:text-slate-400 tabular-nums whitespace-nowrap">{formatCurrency(totals.debtService)}</td>
              <td className={`px-3 py-2.5 text-right tabular-nums whitespace-nowrap ${totals.cashFlow >= 0 ? 'text-secondary-600 dark:text-secondary-400' : 'text-red-500'}`}>
                {formatCurrency(totals.cashFlow)}
              </td>
              <td className="px-3 py-2.5 text-right text-slate-600 dark:text-slate-400 tabular-nums">{formatPct(avgCoC)} avg</td>
              <td className="px-3 py-2.5 text-right text-slate-400 dark:text-slate-500 tabular-nums">—</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </Card>
  );
}

// ── Tab types ───────────────────────────────────────────────────────────────────

type ResultTab = 'summary' | 'projections' | 'whatif' | 'montecarlo';

const TAB_LABELS: Record<ResultTab, string> = {
  summary:     'Summary',
  projections: 'Projections',
  whatif:      'What If',
  montecarlo:  'Stress Testing',
};

// ── Main ────────────────────────────────────────────────────────────────────────

interface ResultsPanelProps {
  result: CoCResult;
  acquisition: CoCAcquisition;
  operations: CoCOperations;
  proForma: ProFormaData;
  refinance: CoCRefinance;
  mcRanges?: MCRanges | null;
  onMcRangesChange?: (r: MCRanges) => void;
  mcResults?: SavedMCResults | null;
  onMcResultsChange?: (r: SavedMCResults) => void;
  /** Ref filled with the MC simulation run function — caller can trigger a run externally */
  mcSimRunRef?: React.MutableRefObject<(() => void) | null>;
}

function computeAvgRents(acquisition: CoCAcquisition): { units: number; avgTargetRent: number; avgPreStabRent: number } {
  if (acquisition.propertyType === 'sfr') {
    return { units: 1, avgTargetRent: acquisition.sfrTargetRent || 0, avgPreStabRent: acquisition.sfrPreStabRent || 0 };
  }
  if (acquisition.unitMix && acquisition.unitMix.length > 0) {
    const totalUnits = acquisition.unitMix.reduce((s, u) => s + u.count, 0);
    if (totalUnits === 0) return { units: 0, avgTargetRent: 0, avgPreStabRent: 0 };
    return {
      units: totalUnits,
      avgTargetRent: acquisition.unitMix.reduce((s, u) => s + u.rentMonthly * u.count, 0) / totalUnits,
      avgPreStabRent: acquisition.unitMix.reduce((s, u) => s + u.preStabRent * u.count, 0) / totalUnits,
    };
  }
  return { units: acquisition.units || 1, avgTargetRent: 0, avgPreStabRent: 0 };
}

export function ResultsPanel({ result, acquisition, operations, proForma, refinance, mcRanges, onMcRangesChange, mcResults, onMcResultsChange, mcSimRunRef }: ResultsPanelProps) {
  const [activeTab, setActiveTab] = useState<ResultTab>('summary');
  const { units, avgTargetRent, avgPreStabRent } = computeAvgRents(acquisition);
  const { totalInvested, avgCoCReturn, irr, equityMultiple, peakCoCReturn, totalCashFlow } = result;
  const v = verdict(irr, avgCoCReturn);

  // Stress test state lifted from MonteCarloPanel
  const [stressRunning, setStressRunning]   = useState(false);
  const [stressProgress, setStressProgress] = useState(0);
  const internalRunRef = useRef<(() => void) | null>(null);
  // Use external ref if provided so callers (e.g. handleCalculate) can trigger simulation
  const stressRunRef = mcSimRunRef ?? internalRunRef;
  const openEditorRef = useRef<(() => void) | null>(null);

  const handleRunningChange = useCallback((running: boolean, progress: number) => {
    setStressRunning(running);
    setStressProgress(progress);
  }, []);

  return (
    <div className="space-y-4">

      {/* ── Hero scoreboard ── */}
      <Card>
        {/* Verdict + invested */}
        <div className="flex items-center justify-between mb-4">
          <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${v.color}`}>{v.label}</span>
          <div className="text-right">
            <p className="text-[10px] text-slate-400 dark:text-slate-500 uppercase tracking-wide">Total Invested</p>
            <p className="text-sm font-bold text-slate-700 dark:text-slate-300 tabular-nums">{formatCurrency(totalInvested)}</p>
          </div>
        </div>


        {/* Primary metrics — IRR takes prominence */}
        <div className="grid grid-cols-3 gap-px bg-slate-100 dark:bg-slate-700 rounded-xl overflow-hidden w-full">
          <MetricCell
            label="IRR"
            value={irr !== null ? formatPct(irr) : '—'}
            sub="Internal rate of return"
            mostLikely={mcResults?.p50?.irr != null && mcResults.p50.irr > -900 ? formatPct(mcResults.p50.irr) : null}
            loading={stressRunning}
            color={irr !== null && irr >= 8 ? 'text-secondary-600 dark:text-secondary-400' : irr !== null && irr < 0 ? 'text-red-500' : 'text-slate-800 dark:text-slate-200'}
            large
          />
          <MetricCell
            label="Avg CoC"
            value={formatPct(avgCoCReturn)}
            sub={`Peak ${formatPct(peakCoCReturn)}`}
            mostLikely={mcResults?.p50?.avgCoCReturn != null ? formatPct(mcResults.p50.avgCoCReturn) : null}
            loading={stressRunning}
            color={avgCoCReturn >= 6 ? 'text-secondary-600 dark:text-secondary-400' : avgCoCReturn < 0 ? 'text-red-500' : 'text-slate-800 dark:text-slate-200'}
            large
          />
          <MetricCell
            label="Equity ×"
            value={formatMultiple(equityMultiple)}
            sub={`${formatCurrency(totalCashFlow)} cash`}
            mostLikely={mcResults?.p50?.equityMultiple != null ? formatMultiple(mcResults.p50.equityMultiple) : null}
            loading={stressRunning}
            color={equityMultiple >= 1.5 ? 'text-primary-600 dark:text-primary-400' : equityMultiple < 1 ? 'text-red-500' : 'text-slate-800 dark:text-slate-200'}
            large
          />
        </div>

        {/* Legend — only when stress test values are present */}
        {mcResults?.p50 && (
          <div className="flex items-center gap-1.5 mt-2 flex-wrap">
            <span className="text-[10px] text-slate-400 dark:text-slate-500 font-medium">( )</span>
            <p className="text-[10px] text-slate-400 dark:text-slate-500">Median outcome from stress test</p>
            <span className="text-[10px] text-slate-300 dark:text-slate-600">·</span>
            <button
              type="button"
              onClick={() => { setActiveTab('montecarlo'); openEditorRef.current?.(); }}
              className="text-[10px] text-primary-500 hover:text-primary-600 dark:text-primary-400 dark:hover:text-primary-300 font-medium transition-colors"
            >
              Refine market uncertainty ranges →
            </button>
          </div>
        )}

        {/* Stress test progress — shown below metrics while simulation runs */}
        {stressRunning && (
          <div className="mt-4 px-4 py-3 rounded-xl bg-primary-50 dark:bg-primary-900/20 border border-primary-100 dark:border-primary-800 space-y-2.5 animate-fade-in">
            <div className="flex items-center gap-2.5">
              <svg className="w-4 h-4 text-primary-500 shrink-0 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
              </svg>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-primary-700 dark:text-primary-300">
                  {stressProgress < 40 ? 'Sampling market conditions…'
                    : stressProgress < 80 ? 'Running scenarios…'
                    : 'Wrapping up…'}
                </p>
                <p className="text-[10px] text-primary-500 dark:text-primary-400 mt-0.5">
                  {stressProgress < 40 ? 'Rent, vacancy, rates & exit across thousands of paths'
                    : stressProgress < 80 ? 'Projecting cash flows and returns'
                    : 'Computing price guidance and risk drivers'}
                </p>
              </div>
              <span className="text-sm font-bold text-primary-600 dark:text-primary-400 tabular-nums shrink-0">{Math.round(stressProgress)}%</span>
            </div>
            <div className="h-2 w-full rounded-full bg-primary-100 dark:bg-primary-800 overflow-hidden">
              <div className="h-full rounded-full bg-primary-500 transition-all duration-300" style={{ width: `${stressProgress}%` }} />
            </div>
          </div>
        )}
      </Card>

      {/* ── Tab chips ── */}
      <div className="grid grid-cols-2 sm:flex gap-2">
        {(Object.keys(TAB_LABELS) as ResultTab[]).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={`px-3 py-1.5 rounded-full text-xs sm:text-sm font-medium border transition-all ${
              activeTab === tab
                ? 'bg-primary-600 text-white border-primary-600'
                : 'border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-400 hover:border-primary-400 dark:hover:border-primary-500'
            }`}
          >
            {TAB_LABELS[tab]}
          </button>
        ))}
      </div>

      {/* ── Tab content ── */}
      {activeTab === 'summary' && (
        <div className="space-y-4">
          <ExitSummary result={result} />
          <CostBasis result={result} />
        </div>
      )}

      {activeTab === 'projections' && (
        <div className="space-y-4">
          <DealCharts projections={result.yearlyProjections} mcResults={mcResults} />
          <ProjectionTable result={result} />
        </div>
      )}

      {activeTab === 'whatif' && (
        <Card>
          <div className="pb-1">
            <WhatIfPanel
              acquisition={acquisition}
              operations={operations}
              proForma={proForma}
              refinance={refinance}
              baseResult={result}
              embedded
            />
          </div>
        </Card>
      )}

      {activeTab === 'montecarlo' && (
        <MonteCarloPanel
          acquisition={acquisition}
          operations={operations}
          proForma={proForma}
          refinance={refinance}
          avgTargetRentPerUnit={avgTargetRent}
          avgPreStabPerUnit={avgPreStabRent}
          units={units}
          savedRanges={mcRanges ?? null}
          onRangesChange={onMcRangesChange}
          savedResults={mcResults ?? null}
          onResultsChange={onMcResultsChange}
          onRunningChange={handleRunningChange}
          runTriggerRef={stressRunRef}
          openEditorRef={openEditorRef}
        />
      )}
    </div>
  );
}

function MetricCell({ label, value, sub, mostLikely, loading, color, large }: { label: string; value: string; sub?: string; mostLikely?: string | null; loading?: boolean; color: string; large?: boolean }) {
  return (
    <div className="bg-white dark:bg-slate-800 px-2 sm:px-4 py-3 sm:py-3.5 flex flex-col min-w-0">
      <p className="text-[9px] sm:text-[10px] font-semibold uppercase tracking-wide sm:tracking-widest text-slate-400 dark:text-slate-500 mb-1 truncate">{label}</p>
      <p className={`font-bold tabular-nums leading-none ${large ? 'text-base sm:text-2xl lg:text-3xl' : 'text-sm sm:text-xl'} ${color}`}>{value}</p>
      {loading ? (
        <span className="mt-1 h-2.5 w-8 sm:w-10 rounded bg-slate-200 dark:bg-slate-600 animate-pulse" />
      ) : mostLikely ? (
        <span className="text-[10px] tabular-nums text-slate-400 dark:text-slate-500 mt-0.5 leading-none truncate animate-fade-in">({mostLikely})</span>
      ) : null}
      {sub && <p className="text-[9px] sm:text-[10px] text-slate-400 dark:text-slate-500 mt-1 leading-tight line-clamp-2">{sub}</p>}
    </div>
  );
}
