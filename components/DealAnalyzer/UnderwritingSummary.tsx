'use client';

import type { CoCAcquisition, CoCCostItem, CoCOperations, CoCRefinance, CoCResult, ProFormaData, CoCYearlyProjection } from '@/types';
import { formatCurrency, formatPct, formatMultiple } from '@/utils/dealAnalyzerCalc';
import { buildUnitMixRentRows, buildProFormaMatrix } from '@/utils/dealSummary';

interface UnderwritingSummaryProps {
  dealName: string;
  acquisition: CoCAcquisition;
  operations: CoCOperations;
  proForma: ProFormaData;
  refinance: CoCRefinance;
  result: CoCResult;
  generatedAt?: Date;
}

function sumItems(items: { amount: number }[] = []): number {
  return items.reduce((s, i) => s + (i.amount || 0), 0);
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
}

function fmtIsoAsOf(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

// ── Sub-components ──────────────────────────────────────────────────────────

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-xs font-bold uppercase tracking-wider text-primary-700 dark:text-primary-400 mt-6 mb-3">
      {children}
    </h2>
  );
}

function KV({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[max-content_1fr] items-baseline gap-x-6 py-1.5 border-b border-slate-100 dark:border-slate-800">
      <span className="text-sm text-slate-600 dark:text-slate-400">{label}</span>
      <span className="text-sm font-semibold text-slate-900 dark:text-slate-100 tabular-nums text-right break-words">{value}</span>
    </div>
  );
}

function ItemList({ items }: { items: CoCCostItem[] }) {
  const nonZero = items.filter((i) => i.amount > 0);
  if (nonZero.length === 0) return null;
  return (
    <div className="pl-4 pb-2 space-y-0.5">
      {nonZero.map((item) => (
        <div key={item.id} className="grid grid-cols-[max-content_1fr] items-baseline gap-x-6 py-0.5">
          <span className="text-xs text-slate-500 dark:text-slate-400">— {item.description || 'Unnamed'}</span>
          <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums text-right">{formatCurrency(item.amount)}</span>
        </div>
      ))}
    </div>
  );
}

function MetricCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-slate-50 dark:bg-slate-800/50 rounded-lg p-4">
      <p className="text-[10px] font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">{label}</p>
      <p className="text-2xl font-bold text-slate-900 dark:text-slate-100 mt-1 tabular-nums">{value}</p>
      {sub && <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-1">{sub}</p>}
    </div>
  );
}

// ── Cash flow chart (inline SVG) ────────────────────────────────────────────

function CashFlowChart({ projections }: { projections: CoCYearlyProjection[] }) {
  if (projections.length === 0) return null;

  const width = 640;
  const height = 260;
  const padding = { top: 20, right: 40, bottom: 40, left: 60 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  const annualValues = projections.map((p) => p.cashFlow);
  const cumulativeValues = projections.map((p) => p.cumulativeCashFlow);
  const allValues = [...annualValues, ...cumulativeValues, 0];
  const minVal = Math.min(...allValues);
  const maxVal = Math.max(...allValues);
  const valueRange = maxVal - minVal || 1;

  const barSlotWidth = plotWidth / projections.length;
  const barWidth = barSlotWidth * 0.6;

  const yFromValue = (v: number) => padding.top + plotHeight - ((v - minVal) / valueRange) * plotHeight;
  const zeroY = yFromValue(0);

  const formatK = (n: number): string => {
    if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
    if (Math.abs(n) >= 1_000) return `$${Math.round(n / 1_000)}K`;
    return `$${Math.round(n)}`;
  };

  const yTicks = 4;
  const tickValues = Array.from({ length: yTicks + 1 }, (_, i) => minVal + (valueRange * i) / yTicks);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto">
      {tickValues.map((val, i) => {
        const y = yFromValue(val);
        return (
          <g key={`grid-${i}`}>
            <line x1={padding.left} x2={width - padding.right} y1={y} y2={y} stroke="#E2E8F0" strokeWidth={0.5} />
            <text x={padding.left - 8} y={y + 4} fontSize={9} textAnchor="end" fill="#64748B">
              {formatK(val)}
            </text>
          </g>
        );
      })}
      <line x1={padding.left} x2={width - padding.right} y1={zeroY} y2={zeroY} stroke="#94A3B8" strokeWidth={1} />

      {projections.map((p, i) => {
        const barX = padding.left + i * barSlotWidth + (barSlotWidth - barWidth) / 2;
        const barTop = p.cashFlow >= 0 ? yFromValue(p.cashFlow) : zeroY;
        const barHeight = Math.abs(yFromValue(p.cashFlow) - zeroY);
        const fill = p.cashFlow >= 0 ? '#3B82F6' : '#EF4444';
        return <rect key={`bar-${i}`} x={barX} y={barTop} width={barWidth} height={barHeight} fill={fill} />;
      })}

      {projections.slice(0, -1).map((p, i) => {
        const x1 = padding.left + i * barSlotWidth + barSlotWidth / 2;
        const x2 = padding.left + (i + 1) * barSlotWidth + barSlotWidth / 2;
        const y1 = yFromValue(p.cumulativeCashFlow);
        const y2 = yFromValue(projections[i + 1].cumulativeCashFlow);
        return <line key={`cum-${i}`} x1={x1} x2={x2} y1={y1} y2={y2} stroke="#10B981" strokeWidth={2} />;
      })}

      {projections.map((p, i) => {
        const cx = padding.left + i * barSlotWidth + barSlotWidth / 2;
        const cy = yFromValue(p.cumulativeCashFlow);
        return <circle key={`dot-${i}`} cx={cx} cy={cy} r={3} fill="#10B981" />;
      })}

      {projections.map((p, i) => {
        const x = padding.left + i * barSlotWidth + barSlotWidth / 2;
        return (
          <text key={`x-${i}`} x={x} y={height - padding.bottom + 14} fontSize={9} textAnchor="middle" fill="#64748B">
            Yr {p.year}
          </text>
        );
      })}

      <g transform={`translate(${padding.left}, ${height - 8})`}>
        <rect x={0} y={-8} width={10} height={8} fill="#3B82F6" />
        <text x={14} y={-1} fontSize={9} fill="#334155">Annual Cash Flow</text>
        <line x1={110} x2={124} y1={-4} y2={-4} stroke="#10B981" strokeWidth={2} />
        <circle cx={117} cy={-4} r={2.5} fill="#10B981" />
        <text x={128} y={-1} fontSize={9} fill="#334155">Cumulative</text>
      </g>
    </svg>
  );
}

// ── Main ────────────────────────────────────────────────────────────────────

export function UnderwritingSummary({
  dealName,
  acquisition,
  operations,
  proForma,
  refinance,
  result,
  generatedAt = new Date(),
}: UnderwritingSummaryProps) {
  void operations;

  const address = acquisition.propertyAddress || '';
  const totalUnits = acquisition.propertyType === 'mfr' && acquisition.unitMix?.length
    ? acquisition.unitMix.reduce((s, e) => s + e.count, 0)
    : 1;
  const loanAmount = result.initialLoanAmount;
  const additionalFees = sumItems(acquisition.additionalFeeItems);
  const hardCosts = sumItems(acquisition.hardCostItems);
  const softCosts = sumItems(acquisition.softCostItems);
  const opportunityCosts = sumItems(acquisition.opportunityCostItems);
  const totalReno = hardCosts + softCosts + opportunityCosts;
  const isCash = acquisition.downPaymentPct >= 100;
  const firstYear = result.yearlyProjections[0];

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="pb-4 border-b border-slate-200 dark:border-slate-700">
        <div className="flex justify-between items-start gap-6">
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 break-words">
              {dealName || 'Untitled Deal'}
            </h1>
            {address && address !== dealName && (
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 break-words">{address}</p>
            )}
          </div>
          <div className="text-right flex-shrink-0">
            <p className="text-[10px] uppercase tracking-wider text-slate-400 dark:text-slate-500 whitespace-nowrap">
              Underwriting Summary
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 whitespace-nowrap">
              Generated {fmtDate(generatedAt)}
            </p>
          </div>
        </div>
      </div>

      {/* Executive Summary */}
      <section>
        <SectionTitle>Deal Overview</SectionTitle>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8">
          <div>
            <KV label="Property Type" value={`${acquisition.propertyType === 'mfr' ? 'Multi-Family' : 'Single-Family'} · ${totalUnits} unit${totalUnits !== 1 ? 's' : ''}`} />
            <KV label="Purchase Price" value={formatCurrency(acquisition.purchasePrice)} />
            <KV label="Total Cash Invested" value={formatCurrency(result.totalInvested)} />
          </div>
          <div>
            <KV label="Loan Amount" value={isCash ? '— (Cash purchase)' : formatCurrency(loanAmount)} />
            <KV label="Projection Horizon" value={`${acquisition.projectionYears} years`} />
            {acquisition.marketRateAtCreation && (
              <KV
                label={`Market Rate (${acquisition.marketRateAtCreation.series})`}
                value={`${acquisition.marketRateAtCreation.rate.toFixed(2)}% · ${fmtIsoAsOf(acquisition.marketRateAtCreation.asOf)}`}
              />
            )}
          </div>
        </div>

        <SectionTitle>Key Returns</SectionTitle>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <MetricCard
            label="Year 1 CoC"
            value={formatPct((firstYear?.coCReturn ?? 0) * 100)}
            sub="Cash-on-cash return, year 1"
          />
          <MetricCard
            label="Avg CoC"
            value={formatPct(result.avgCoCReturn * 100)}
            sub="Averaged over projection"
          />
          <MetricCard
            label="IRR"
            value={result.irr === null ? '—' : formatPct(result.irr * 100)}
            sub="Internal rate of return"
          />
          <MetricCard
            label="Equity Multiple"
            value={formatMultiple(result.equityMultiple)}
            sub="Total distributions / cash in"
          />
          <MetricCard
            label="Total Cash Flow"
            value={formatCurrency(result.totalCashFlow)}
            sub="Sum over projection"
          />
          <MetricCard
            label="Terminal Equity"
            value={formatCurrency(result.terminalEquity)}
            sub="Net proceeds at exit"
          />
        </div>
      </section>

      {/* Acquisition & Financing */}
      <section>
        <SectionTitle>Property</SectionTitle>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8">
          <div>
            <KV label="Address" value={address || '—'} />
            <KV label="Type" value={acquisition.propertyType === 'mfr' ? 'Multi-Family' : 'Single-Family'} />
            <KV label="Units" value={String(totalUnits)} />
          </div>
          {acquisition.propertyType === 'sfr' && (
            <div>
              <KV label="Bedrooms" value={String(acquisition.sfrBeds)} />
              <KV label="Bathrooms" value={String(acquisition.sfrBaths)} />
            </div>
          )}
        </div>

        {acquisition.propertyType === 'mfr' && acquisition.unitMix?.length > 0 && (
          <>
            <SectionTitle>Unit Mix</SectionTitle>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-700">
                    <th className="text-left py-2 text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">Type</th>
                    <th className="text-right py-2 text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">Units</th>
                    <th className="text-right py-2 text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">In-Place Rent</th>
                    <th className="text-right py-2 text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">Target Rent</th>
                  </tr>
                </thead>
                <tbody>
                  {acquisition.unitMix.map((u, i) => (
                    <tr key={i} className="border-b border-slate-100 dark:border-slate-800">
                      <td className="py-1.5 text-slate-700 dark:text-slate-300">{`${u.beds}bd / ${u.baths}ba`}</td>
                      <td className="py-1.5 text-right tabular-nums">{u.count}</td>
                      <td className="py-1.5 text-right tabular-nums">{formatCurrency(u.inPlaceRent || 0)}/mo</td>
                      <td className="py-1.5 text-right tabular-nums">{formatCurrency(u.rentMonthly || 0)}/mo</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        <SectionTitle>Purchase Breakdown</SectionTitle>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8">
          <div>
            <KV label="Purchase Price" value={formatCurrency(acquisition.purchasePrice)} />
            <KV label={`Down Payment (${acquisition.downPaymentPct}%)`} value={formatCurrency(result.downPayment)} />
            {!isCash && <KV label={`Closing Costs (${acquisition.closingCostsPct}%)`} value={formatCurrency(result.closingCosts)} />}
          </div>
          <div>
            {!isCash && acquisition.points > 0 && <KV label={`Loan Points (${acquisition.points})`} value={formatCurrency(result.pointsCost)} />}
            {additionalFees > 0 && (
              <>
                <KV label="Additional Fees" value={formatCurrency(additionalFees)} />
                <ItemList items={acquisition.additionalFeeItems} />
              </>
            )}
          </div>
        </div>

        {totalReno > 0 && (
          <>
            <SectionTitle>Renovation Budget</SectionTitle>
            <div>
              {hardCosts > 0 && (
                <>
                  <KV label="Hard Costs" value={formatCurrency(hardCosts)} />
                  <ItemList items={acquisition.hardCostItems} />
                </>
              )}
              {softCosts > 0 && (
                <>
                  <KV label="Soft Costs" value={formatCurrency(softCosts)} />
                  <ItemList items={acquisition.softCostItems} />
                </>
              )}
              {opportunityCosts > 0 && (
                <>
                  <KV label="Opportunity Cost" value={formatCurrency(opportunityCosts)} />
                  <ItemList items={acquisition.opportunityCostItems} />
                </>
              )}
              <KV label="Renovation Duration" value={`${acquisition.renovationMonths} months`} />
              <KV label="Total Renovation" value={<span className="text-primary-600">{formatCurrency(totalReno)}</span>} />
            </div>
          </>
        )}

        <SectionTitle>Financing</SectionTitle>
        {isCash ? (
          <p className="text-sm text-slate-500 italic">All-cash purchase — no financing.</p>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8">
              <div>
                <KV label="Loan Amount" value={formatCurrency(loanAmount)} />
                <KV label="Interest Rate" value={formatPct(acquisition.interestRate)} />
              </div>
              <div>
                <KV label="Loan Term" value={`${acquisition.loanTermYears} years`} />
                {acquisition.ioPeriodMonths > 0 && (
                  <KV label="Interest-Only Period" value={`${acquisition.ioPeriodMonths} months`} />
                )}
              </div>
            </div>
            {acquisition.marketRateAtCreation && (
              <div className="mt-3 bg-slate-50 dark:bg-slate-800/50 border-l-4 border-primary-500 p-3 rounded-r">
                <p className="text-xs text-slate-600 dark:text-slate-300">
                  Underwriting assumes <span className="font-semibold">{formatPct(acquisition.interestRate)}</span>. FRED 30-yr fixed benchmark was{' '}
                  <span className="font-semibold">{acquisition.marketRateAtCreation.rate.toFixed(2)}%</span> on {fmtIsoAsOf(acquisition.marketRateAtCreation.asOf)}.
                </p>
              </div>
            )}
          </>
        )}
      </section>

      {/* Operations & Rent */}
      <section>
        <SectionTitle>Rent by Unit</SectionTitle>
        {(() => {
          const { rows: mixRows, totals } = buildUnitMixRentRows(acquisition);
          return (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-700">
                    <th className="text-left py-2 text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">Unit Type</th>
                    <th className="text-right py-2 text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">Count</th>
                    <th className="text-right py-2 text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">In-Place / Unit</th>
                    <th className="text-right py-2 text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">Target / Unit</th>
                    <th className="text-right py-2 text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">Monthly Total</th>
                    <th className="text-right py-2 text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">Annual Total</th>
                  </tr>
                </thead>
                <tbody>
                  {mixRows.map((r, i) => (
                    <tr key={i} className="border-b border-slate-100 dark:border-slate-800">
                      <td className="py-1.5 text-slate-700 dark:text-slate-300">{r.label}</td>
                      <td className="py-1.5 text-right tabular-nums">{r.count}</td>
                      <td className="py-1.5 text-right tabular-nums">{formatCurrency(r.inPlaceRentMonthly)}/mo</td>
                      <td className="py-1.5 text-right tabular-nums">{formatCurrency(r.targetRentMonthly)}/mo</td>
                      <td className="py-1.5 text-right tabular-nums">{formatCurrency(r.monthlyTotal)}/mo</td>
                      <td className="py-1.5 text-right tabular-nums">{formatCurrency(r.annualTotal)}/yr</td>
                    </tr>
                  ))}
                  {mixRows.length > 1 && (
                    <tr className="border-b border-slate-300 dark:border-slate-600 font-semibold">
                      <td className="py-1.5 text-slate-800 dark:text-slate-200">Total</td>
                      <td className="py-1.5 text-right tabular-nums">{mixRows.reduce((s, r) => s + r.count, 0)}</td>
                      <td className="py-1.5"></td>
                      <td className="py-1.5"></td>
                      <td className="py-1.5 text-right tabular-nums">{formatCurrency(totals.monthly)}/mo</td>
                      <td className="py-1.5 text-right tabular-nums">{formatCurrency(totals.annual)}/yr</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          );
        })()}

        <SectionTitle>Other Rent Assumptions</SectionTitle>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8">
          <div>
            <KV label="Gross Rent (T-12)" value={`${formatCurrency(proForma.grossRent.t12)}/yr`} />
            <KV label="Other Income (Stabilized)" value={`${formatCurrency(proForma.otherIncome.stabilized)}/yr`} />
            <KV label="Annual Rent Growth" value={formatPct(proForma.grossRent.growthPct)} />
          </div>
          <div>
            <KV label="Vacancy" value={formatPct(proForma.vacancyPct.stabilized)} />
            <KV label="Credit Loss" value={formatPct(proForma.creditLossPct.stabilized)} />
          </div>
        </div>

        <SectionTitle>Operating Expenses (Stabilized)</SectionTitle>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-700">
                <th className="text-left py-2 text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">Line Item</th>
                <th className="text-right py-2 text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">Stabilized</th>
                <th className="text-right py-2 text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">Growth</th>
              </tr>
            </thead>
            <tbody>
              {proForma.expenses.map((exp) => (
                <tr key={exp.id} className="border-b border-slate-100 dark:border-slate-800">
                  <td className="py-1.5 text-slate-700 dark:text-slate-300">{exp.name}</td>
                  <td className="py-1.5 text-right tabular-nums">
                    {exp.isPercentOfEGI ? `${exp.stabilizedValue}% of EGI` : `${formatCurrency(exp.stabilizedValue)}/mo`}
                  </td>
                  <td className="py-1.5 text-right tabular-nums">{formatPct(exp.growthPct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {refinance.enabled && (
          <>
            <SectionTitle>Refinance Plan</SectionTitle>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8">
              <div>
                <KV label="Refi Year" value={String(refinance.refiYear)} />
                <KV label="Assumed Value" value={formatCurrency(refinance.refiMarketValue)} />
                <KV label="New LTV" value={formatPct(refinance.newLTV)} />
              </div>
              <div>
                <KV label="New Interest Rate" value={formatPct(refinance.newInterestRate)} />
                <KV label="New Loan Term" value={`${refinance.newLoanTermYears} years`} />
                <KV label="Refi Closing Costs" value={formatPct(refinance.refiCostPct)} />
              </div>
            </div>
          </>
        )}

        <SectionTitle>Exit Assumptions</SectionTitle>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8">
          <div>
            <KV label="Exit Method" value={acquisition.exitMethod === 'capRate' ? 'Cap Rate' : 'Direct Value'} />
            {acquisition.exitMethod === 'capRate' && (
              <KV label="Exit Cap Rate" value={formatPct(acquisition.exitCapRate)} />
            )}
            <KV label="Exit Closing Costs" value={formatPct(acquisition.exitClosingCostPct)} />
          </div>
          <div>
            <KV label="Terminal Value" value={formatCurrency(result.terminalPropertyValue)} />
            <KV label="Exit Closing Costs" value={formatCurrency(result.exitClosingCosts)} />
            <KV label="Terminal Equity" value={<span className="text-primary-600">{formatCurrency(result.terminalEquity)}</span>} />
          </div>
        </div>
      </section>

      {/* Pro Forma & Returns */}
      <section>
        <SectionTitle>Annual Projection</SectionTitle>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-700">
                <th className="text-left py-2 text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">Year</th>
                <th className="text-right py-2 text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">Gross Rent</th>
                <th className="text-right py-2 text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">OpEx</th>
                <th className="text-right py-2 text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">NOI</th>
                <th className="text-right py-2 text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">Debt Svc</th>
                <th className="text-right py-2 text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">Cash Flow</th>
                <th className="text-right py-2 text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">CoC%</th>
              </tr>
            </thead>
            <tbody>
              {result.yearlyProjections.map((p) => (
                <tr key={p.year} className="border-b border-slate-100 dark:border-slate-800">
                  <td className="py-1.5 font-medium text-slate-700 dark:text-slate-300">{p.year}</td>
                  <td className="py-1.5 text-right tabular-nums">{formatCurrency(p.grossRent)}</td>
                  <td className="py-1.5 text-right tabular-nums">{formatCurrency(p.opex)}</td>
                  <td className="py-1.5 text-right tabular-nums">{formatCurrency(p.noi)}</td>
                  <td className="py-1.5 text-right tabular-nums">{formatCurrency(p.debtService)}</td>
                  <td className={`py-1.5 text-right tabular-nums font-semibold ${p.cashFlow >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                    {formatCurrency(p.cashFlow)}
                  </td>
                  <td className="py-1.5 text-right tabular-nums">{formatPct(p.coCReturn * 100)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <SectionTitle>Operation Grid (Pro Forma Detail)</SectionTitle>
        {(() => {
          const matrix = buildProFormaMatrix(proForma, acquisition.projectionYears);
          const years = Array.from({ length: acquisition.projectionYears }, (_, i) => i + 1);
          return (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
                    <th className="text-left py-2 px-2 text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 sticky left-0 bg-slate-50 dark:bg-slate-800/50 z-10">Line Item</th>
                    <th className="text-right py-2 px-2 text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">T-12</th>
                    {years.map((y) => (
                      <th key={y} className="text-right py-2 px-2 text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">Yr {y}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {matrix.map((row, i) => {
                    if (row.isHeader) {
                      return (
                        <tr key={i}>
                          <td colSpan={years.length + 2} className="py-2 px-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/30">
                            {row.label}
                          </td>
                        </tr>
                      );
                    }
                    const rowClass = row.isBold
                      ? 'font-semibold border-b border-slate-300 dark:border-slate-600'
                      : 'border-b border-slate-100 dark:border-slate-800';
                    const cellClass = row.isPositive ? 'text-emerald-600' : '';
                    return (
                      <tr key={i} className={rowClass}>
                        <td className={`py-1.5 px-2 text-slate-700 dark:text-slate-300 sticky left-0 bg-white dark:bg-slate-900 z-10 ${cellClass}`}>{row.label}</td>
                        <td className={`py-1.5 px-2 text-right tabular-nums ${cellClass}`}>{formatCurrency(row.t12)}</td>
                        {row.years.map((v, j) => (
                          <td key={j} className={`py-1.5 px-2 text-right tabular-nums ${cellClass}`}>{formatCurrency(v)}</td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        })()}

        <SectionTitle>Cash Flow Over Time</SectionTitle>
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-4">
          <CashFlowChart projections={result.yearlyProjections} />
        </div>

        <SectionTitle>Returns Summary</SectionTitle>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8">
          <div>
            <KV label="Total Cash Invested" value={formatCurrency(result.totalInvested)} />
            <KV label="Total Cash Flow" value={formatCurrency(result.totalCashFlow)} />
            <KV label="Terminal Equity" value={formatCurrency(result.terminalEquity)} />
          </div>
          <div>
            <KV label="Average CoC" value={formatPct(result.avgCoCReturn * 100)} />
            <KV label="Peak CoC" value={formatPct(result.peakCoCReturn * 100)} />
            <KV label="Equity Multiple" value={formatMultiple(result.equityMultiple)} />
            <KV label="IRR" value={result.irr === null ? '—' : formatPct(result.irr * 100)} />
          </div>
        </div>
      </section>

      <div className="pt-6 mt-6 border-t border-slate-200 dark:border-slate-700 text-center">
        <p className="text-[10px] text-slate-400 dark:text-slate-500">
          Underwriting model · For discussion purposes only
        </p>
      </div>
    </div>
  );
}
