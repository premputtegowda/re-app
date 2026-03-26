'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Card } from '@/components/UI/Card';
import type { CoCResult } from '@/types';
import { formatCurrency, formatPct, formatMultiple } from '@/utils/dealAnalyzerCalc';
import { DealCharts } from './DealAnalyzerCharts';

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
  const { yearlyProjections } = result;
  const terminalPropertyValue = result.terminalPropertyValue ?? 0;
  const exitClosingCosts = result.exitClosingCosts ?? 0;
  const terminalEquity = result.terminalEquity ?? 0;
  const final = yearlyProjections[yearlyProjections.length - 1];
  if (!final) return null;

  const totalProceeds = final.cashFlow + terminalEquity;

  return (
    <Card padding="none">
      <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-700">
        <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Exit — Yr {final.year}</h3>
      </div>
      <div className="px-4 py-3">
        <ExitRow label="Sale Price" value={formatCurrency(terminalPropertyValue)} />
        <ExitRow label="Loan Balance" value={`(${formatCurrency(final.loanBalance)})`} muted />
        <ExitRow label="Selling Costs" value={`(${formatCurrency(exitClosingCosts)})`} muted />
        <div className="border-t border-slate-100 dark:border-slate-700 mt-2 pt-2">
          <ExitRow label="Net Equity" value={formatCurrency(terminalEquity)} bold />
        </div>
        <ExitRow label={`Cash Flow (Yr ${final.year})`} value={formatCurrency(final.cashFlow)} />
        <div className="border-t border-slate-200 dark:border-slate-600 mt-2 pt-2">
          <ExitRow label="Total Proceeds" value={formatCurrency(totalProceeds)} bold highlight />
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

// ── Main ────────────────────────────────────────────────────────────────────────

interface ResultsPanelProps {
  result: CoCResult;
}

export function ResultsPanel({ result }: ResultsPanelProps) {
  const { totalInvested, avgCoCReturn, irr, equityMultiple, peakCoCReturn, totalCashFlow } = result;
  const v = verdict(irr, avgCoCReturn);

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
        <div className="grid grid-cols-3 gap-px bg-slate-100 dark:bg-slate-700 rounded-xl overflow-hidden">
          <MetricCell
            label="IRR"
            value={irr !== null ? formatPct(irr) : '—'}
            sub="Internal rate of return"
            color={irr !== null && irr >= 8 ? 'text-secondary-600 dark:text-secondary-400' : irr !== null && irr < 0 ? 'text-red-500' : 'text-slate-800 dark:text-slate-200'}
            large
          />
          <MetricCell
            label="Avg CoC"
            value={formatPct(avgCoCReturn)}
            sub={`Peak ${formatPct(peakCoCReturn)}`}
            color={avgCoCReturn >= 6 ? 'text-secondary-600 dark:text-secondary-400' : avgCoCReturn < 0 ? 'text-red-500' : 'text-slate-800 dark:text-slate-200'}
          />
          <MetricCell
            label="Equity ×"
            value={formatMultiple(equityMultiple)}
            sub={`${formatCurrency(totalCashFlow)} cash`}
            color={equityMultiple >= 1.5 ? 'text-primary-600 dark:text-primary-400' : equityMultiple < 1 ? 'text-red-500' : 'text-slate-800 dark:text-slate-200'}
          />
        </div>
      </Card>

      {/* ── Charts (tabbed) ── */}
      <DealCharts projections={result.yearlyProjections} />

      {/* ── Exit summary ── */}
      <ExitSummary result={result} />

      {/* ── Projection table ── */}
      <ProjectionTable result={result} />

      {/* ── Cost basis (collapsed by default) ── */}
      <CostBasis result={result} />
    </div>
  );
}

function MetricCell({ label, value, sub, color, large }: { label: string; value: string; sub?: string; color: string; large?: boolean }) {
  return (
    <div className="bg-white dark:bg-slate-800 px-4 py-3.5 flex flex-col">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-1">{label}</p>
      <p className={`font-bold tabular-nums leading-none ${large ? 'text-3xl' : 'text-xl'} ${color}`}>{value}</p>
      {sub && <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-1.5 leading-tight">{sub}</p>}
    </div>
  );
}
