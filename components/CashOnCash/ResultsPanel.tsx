'use client';

import { Card } from '@/components/UI/Card';
import type { CoCResult } from '@/types';
import { formatCurrency, formatPct, formatMultiple } from '@/utils/cashOnCashCalc';
import { CashFlowTrendChart, CoCReturnChart } from './CoCCharts';

interface KPICardProps {
  title: string;
  value: string;
  subtitle?: string;
  colorClass?: string;
}

function KPICard({ title, value, subtitle, colorClass = 'text-slate-900 dark:text-white' }: KPICardProps) {
  return (
    <Card className="hover:shadow-md transition-shadow">
      <p className="text-sm font-medium text-slate-600 dark:text-slate-400 mb-1">{title}</p>
      <p className={`text-2xl font-bold mb-1 ${colorClass}`}>{value}</p>
      {subtitle && <p className="text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>}
    </Card>
  );
}

interface ResultsPanelProps {
  result: CoCResult;
}

export function ResultsPanel({ result }: ResultsPanelProps) {
  const {
    yearlyProjections,
    totalInvested,
    downPayment,
    closingCosts,
    pointsCost,
    hardCostItems,
    hardCosts,
    softCostItems,
    softCosts,
    opportunityCostItems,
    lostOpportunityCost,
    avgCoCReturn,
    irr,
    equityMultiple,
  } = result;

  const hasRenovation = hardCosts > 0 || softCosts > 0;

  const totals = yearlyProjections.reduce(
    (acc, p) => ({
      grossRent: acc.grossRent + p.grossRent,
      effectiveRent: acc.effectiveRent + p.effectiveRent,
      noi: acc.noi + p.noi,
      debtService: acc.debtService + p.debtService,
      cashFlow: acc.cashFlow + p.cashFlow,
    }),
    { grossRent: 0, effectiveRent: 0, noi: 0, debtService: 0, cashFlow: 0 }
  );

  const avgCoC =
    yearlyProjections.reduce((sum, p) => sum + p.coCReturn, 0) / yearlyProjections.length;

  return (
    <div className="space-y-6">
      {/* KPI Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="Total Invested"
          value={formatCurrency(totalInvested)}
          subtitle="Full cost basis"
        />
        <KPICard
          title="Avg CoC Return"
          value={formatPct(avgCoCReturn)}
          subtitle="Avg across all years"
          colorClass={avgCoCReturn >= 0 ? 'text-secondary-600 dark:text-secondary-400' : 'text-red-600'}
        />
        <KPICard
          title="IRR"
          value={irr !== null ? formatPct(irr) : '—'}
          subtitle="Internal rate of return"
          colorClass={irr !== null && irr >= 0 ? 'text-secondary-600 dark:text-secondary-400' : 'text-slate-900 dark:text-white'}
        />
        <KPICard
          title="Equity Multiple"
          value={formatMultiple(equityMultiple)}
          subtitle="(Cash flow + equity) / invested"
          colorClass={equityMultiple >= 1 ? 'text-primary-600 dark:text-primary-400' : 'text-red-600'}
        />
      </div>

      {/* Cost Basis Breakdown */}
      <Card>
        <h3 className="text-base font-semibold text-slate-900 dark:text-white mb-3">
          Cost Basis Breakdown
        </h3>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-slate-700">
            <span className="text-slate-600 dark:text-slate-400">Down Payment</span>
            <span className="font-medium text-slate-900 dark:text-white">{formatCurrency(downPayment)}</span>
          </div>
          <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-slate-700">
            <span className="text-slate-600 dark:text-slate-400">Closing Costs</span>
            <span className="font-medium text-slate-900 dark:text-white">{formatCurrency(closingCosts)}</span>
          </div>
          {pointsCost > 0 && (
            <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-slate-700">
              <span className="text-slate-600 dark:text-slate-400">Loan Points</span>
              <span className="font-medium text-slate-900 dark:text-white">{formatCurrency(pointsCost)}</span>
            </div>
          )}
          {hasRenovation && (
            <>
              {/* Hard cost line items */}
              {hardCostItems.length > 0 ? (
                <>
                  <div className="pt-1 pb-0.5">
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                      Hard Costs
                    </span>
                  </div>
                  {hardCostItems.map((item) => (
                    <div
                      key={item.id}
                      className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-700 pl-3"
                    >
                      <span className="text-slate-500 dark:text-slate-400 text-xs">
                        {item.description || '(unlabeled)'}
                      </span>
                      <span className="text-slate-700 dark:text-slate-300 text-xs font-medium">
                        {formatCurrency(item.amount)}
                      </span>
                    </div>
                  ))}
                  <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-slate-700">
                    <span className="text-slate-600 dark:text-slate-400 font-medium">Hard Costs Total</span>
                    <span className="font-semibold text-slate-900 dark:text-white">{formatCurrency(hardCosts)}</span>
                  </div>
                </>
              ) : hardCosts > 0 ? (
                <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-slate-700">
                  <span className="text-slate-600 dark:text-slate-400">Hard Costs</span>
                  <span className="font-medium text-slate-900 dark:text-white">{formatCurrency(hardCosts)}</span>
                </div>
              ) : null}

              {/* Soft cost line items */}
              {softCostItems.length > 0 ? (
                <>
                  <div className="pt-1 pb-0.5">
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                      Soft Costs
                    </span>
                  </div>
                  {softCostItems.map((item) => (
                    <div
                      key={item.id}
                      className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-700 pl-3"
                    >
                      <span className="text-slate-500 dark:text-slate-400 text-xs">
                        {item.description || '(unlabeled)'}
                      </span>
                      <span className="text-slate-700 dark:text-slate-300 text-xs font-medium">
                        {formatCurrency(item.amount)}
                      </span>
                    </div>
                  ))}
                  <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-slate-700">
                    <span className="text-slate-600 dark:text-slate-400 font-medium">Soft Costs Total</span>
                    <span className="font-semibold text-slate-900 dark:text-white">{formatCurrency(softCosts)}</span>
                  </div>
                </>
              ) : softCosts > 0 ? (
                <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-slate-700">
                  <span className="text-slate-600 dark:text-slate-400">Soft Costs</span>
                  <span className="font-medium text-slate-900 dark:text-white">{formatCurrency(softCosts)}</span>
                </div>
              ) : null}
            </>
          )}
          {lostOpportunityCost > 0 && (
            <>
              <div className="pt-1 pb-0.5">
                <span className="text-xs font-semibold uppercase tracking-wide text-amber-500 dark:text-amber-400">
                  Lost Opportunity Cost
                </span>
              </div>
              {opportunityCostItems.map((item) => (
                <div
                  key={item.id}
                  className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-700 pl-3"
                >
                  <span className="text-amber-600/80 dark:text-amber-400/80 text-xs">
                    {item.description || '(unlabeled)'}
                  </span>
                  <span className="text-amber-600 dark:text-amber-400 text-xs font-medium">
                    {formatCurrency(item.amount)}
                  </span>
                </div>
              ))}
              <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-slate-700">
                <span className="text-amber-600 dark:text-amber-400 font-medium">Total Lost Opportunity</span>
                <span className="font-semibold text-amber-600 dark:text-amber-400">{formatCurrency(lostOpportunityCost)}</span>
              </div>
            </>
          )}
          <div className="flex justify-between py-2 font-semibold">
            <span className="text-slate-900 dark:text-white">Total Invested</span>
            <span className="text-slate-900 dark:text-white">{formatCurrency(totalInvested)}</span>
          </div>
        </div>
      </Card>

      {/* Yearly Projection Table */}
      <Card padding="none">
        <div className="p-4 border-b border-slate-200 dark:border-slate-700">
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
            Yearly Projections
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-700/50">
                <th className="px-4 py-3 text-left font-medium text-slate-600 dark:text-slate-400 whitespace-nowrap">
                  Year
                </th>
                <th className="px-4 py-3 text-right font-medium text-slate-600 dark:text-slate-400 whitespace-nowrap">
                  Gross Rent
                </th>
                <th className="px-4 py-3 text-right font-medium text-slate-600 dark:text-slate-400 whitespace-nowrap">
                  Eff. Rent
                </th>
                <th className="px-4 py-3 text-right font-medium text-slate-600 dark:text-slate-400 whitespace-nowrap">
                  NOI
                </th>
                <th className="px-4 py-3 text-right font-medium text-slate-600 dark:text-slate-400 whitespace-nowrap">
                  Debt Svc
                </th>
                <th className="px-4 py-3 text-right font-medium text-slate-600 dark:text-slate-400 whitespace-nowrap">
                  Cash Flow
                </th>
                <th className="px-4 py-3 text-right font-medium text-slate-600 dark:text-slate-400 whitespace-nowrap">
                  CoC%
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
              {yearlyProjections.map((p) => (
                <tr
                  key={p.year}
                  className="hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors"
                >
                  <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">
                    {p.year}
                    {p.cashOutProceeds > 0 && (
                      <span className="ml-1 text-xs text-primary-600 dark:text-primary-400 font-normal">
                        (Refi)
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right text-slate-700 dark:text-slate-300 whitespace-nowrap">
                    {formatCurrency(p.grossRent)}
                  </td>
                  <td className="px-4 py-3 text-right text-slate-700 dark:text-slate-300 whitespace-nowrap">
                    {formatCurrency(p.effectiveRent)}
                  </td>
                  <td className="px-4 py-3 text-right text-slate-700 dark:text-slate-300 whitespace-nowrap">
                    {formatCurrency(p.noi)}
                  </td>
                  <td className="px-4 py-3 text-right text-slate-700 dark:text-slate-300 whitespace-nowrap">
                    {formatCurrency(p.debtService)}
                  </td>
                  <td
                    className={`px-4 py-3 text-right font-medium whitespace-nowrap ${
                      p.cashFlow >= 0
                        ? 'text-secondary-600 dark:text-secondary-400'
                        : 'text-red-600 dark:text-red-400'
                    }`}
                  >
                    {formatCurrency(p.cashFlow)}
                  </td>
                  <td
                    className={`px-4 py-3 text-right font-medium whitespace-nowrap ${
                      p.coCReturn >= 0
                        ? 'text-secondary-600 dark:text-secondary-400'
                        : 'text-red-600 dark:text-red-400'
                    }`}
                  >
                    {formatPct(p.coCReturn)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-slate-50 dark:bg-slate-700/50 font-semibold border-t-2 border-slate-200 dark:border-slate-600">
                <td className="px-4 py-3 text-slate-900 dark:text-white">Total</td>
                <td className="px-4 py-3 text-right text-slate-900 dark:text-white whitespace-nowrap">
                  {formatCurrency(totals.grossRent)}
                </td>
                <td className="px-4 py-3 text-right text-slate-900 dark:text-white whitespace-nowrap">
                  {formatCurrency(totals.effectiveRent)}
                </td>
                <td className="px-4 py-3 text-right text-slate-900 dark:text-white whitespace-nowrap">
                  {formatCurrency(totals.noi)}
                </td>
                <td className="px-4 py-3 text-right text-slate-900 dark:text-white whitespace-nowrap">
                  {formatCurrency(totals.debtService)}
                </td>
                <td
                  className={`px-4 py-3 text-right whitespace-nowrap ${
                    totals.cashFlow >= 0
                      ? 'text-secondary-600 dark:text-secondary-400'
                      : 'text-red-600 dark:text-red-400'
                  }`}
                >
                  {formatCurrency(totals.cashFlow)}
                </td>
                <td className="px-4 py-3 text-right text-slate-900 dark:text-white whitespace-nowrap">
                  {formatPct(avgCoC)} avg
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>

      {/* Charts */}
      <CashFlowTrendChart projections={yearlyProjections} />
      <CoCReturnChart projections={yearlyProjections} />
    </div>
  );
}
