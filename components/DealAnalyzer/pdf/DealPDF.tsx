import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';
import type { CoCAcquisition, CoCCostItem, CoCOperations, CoCRefinance, CoCResult, ProFormaData } from '@/types';
import { formatCurrency, formatPct, formatMultiple } from '@/utils/dealAnalyzerCalc';
import { buildUnitMixRentRows, buildProFormaMatrix } from '@/utils/dealSummary';
import { CashFlowChart } from './CashFlowChart';

const COLORS = {
  ink: '#0F172A',
  slate: '#334155',
  mute: '#64748B',
  faint: '#94A3B8',
  hairline: '#E2E8F0',
  panel: '#F8FAFC',
  primary: '#1D4ED8',
  positive: '#059669',
  negative: '#DC2626',
};

const styles = StyleSheet.create({
  page: {
    paddingTop: 36,
    paddingBottom: 36,
    paddingHorizontal: 40,
    fontFamily: 'Helvetica',
    fontSize: 9,
    color: COLORS.ink,
  },
  header: {
    borderBottomWidth: 1,
    borderBottomColor: COLORS.hairline,
    paddingBottom: 8,
    marginBottom: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  headerLeft: { flexDirection: 'column', flex: 1, paddingRight: 12 },
  headerRight: { flexDirection: 'column', alignItems: 'flex-end', flexShrink: 0 },
  dealName: { fontSize: 16, fontFamily: 'Helvetica-Bold', color: COLORS.ink },
  address: { fontSize: 9, color: COLORS.mute, marginTop: 2 },
  pageLabel: { fontSize: 8, color: COLORS.faint, textTransform: 'uppercase', letterSpacing: 1 },
  dateText: { fontSize: 8, color: COLORS.mute, marginTop: 2 },

  sectionTitle: {
    fontSize: 11,
    fontFamily: 'Helvetica-Bold',
    color: COLORS.primary,
    marginTop: 14,
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },

  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 18,
    marginHorizontal: -4,
  },
  metricCard: {
    width: '33.33%',
    padding: 4,
  },
  metricCardInner: {
    backgroundColor: COLORS.panel,
    borderRadius: 4,
    padding: 12,
    minHeight: 72,
  },
  metricLabel: {
    fontSize: 8,
    color: COLORS.mute,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  metricValue: {
    fontSize: 18,
    fontFamily: 'Helvetica-Bold',
    color: COLORS.ink,
    marginTop: 4,
  },
  metricSub: {
    fontSize: 7,
    color: COLORS.faint,
    marginTop: 2,
  },

  kvRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 3,
    borderBottomWidth: 0.5,
    borderBottomColor: COLORS.hairline,
  },
  kvLabel: { color: COLORS.slate },
  kvValue: { color: COLORS.ink, fontFamily: 'Helvetica-Bold' },

  twoCol: { flexDirection: 'row', gap: 20, marginTop: 4 },
  col: { flex: 1 },

  tableHeader: {
    flexDirection: 'row',
    backgroundColor: COLORS.panel,
    paddingVertical: 4,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.hairline,
  },
  tableHeaderCell: {
    fontSize: 7.5,
    color: COLORS.mute,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 3,
    paddingHorizontal: 4,
    borderBottomWidth: 0.5,
    borderBottomColor: COLORS.hairline,
  },
  tableCell: { fontSize: 8, color: COLORS.ink },
  tableCellRight: { fontSize: 8, color: COLORS.ink, textAlign: 'right' },

  callout: {
    backgroundColor: COLORS.panel,
    borderLeftWidth: 3,
    borderLeftColor: COLORS.primary,
    padding: 8,
    marginTop: 8,
  },
  calloutText: { fontSize: 8, color: COLORS.slate },

  footer: {
    position: 'absolute',
    bottom: 18,
    left: 40,
    right: 40,
    borderTopWidth: 0.5,
    borderTopColor: COLORS.hairline,
    paddingTop: 6,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  footerText: { fontSize: 7, color: COLORS.faint },
});

interface DealPDFProps {
  dealName: string;
  acquisition: CoCAcquisition;
  operations: CoCOperations;
  proForma: ProFormaData;
  refinance: CoCRefinance;
  result: CoCResult;
  generatedAt?: Date;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function fmtDate(d: Date): string {
  return d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
}

function fmtIsoAsOf(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function sumItems(items: { amount: number }[] = []): number {
  return items.reduce((s, i) => s + (i.amount || 0), 0);
}

function propertySummary(a: CoCAcquisition): string {
  const type = a.propertyType === 'mfr' ? 'Multi-Family' : 'Single-Family';
  const units = a.propertyType === 'mfr' && a.unitMix?.length
    ? a.unitMix.reduce((s, e) => s + e.count, 0)
    : 1;
  return `${type} · ${units} unit${units !== 1 ? 's' : ''}`;
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.kvRow}>
      <Text style={styles.kvLabel}>{label}</Text>
      <Text style={styles.kvValue}>{value}</Text>
    </View>
  );
}

function ItemList({ items }: { items: CoCCostItem[] }) {
  const nonZero = items.filter((i) => i.amount > 0);
  if (nonZero.length === 0) return null;
  return (
    <View style={{ paddingLeft: 12, paddingBottom: 4 }}>
      {nonZero.map((item) => (
        <View key={item.id} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 1 }}>
          <Text style={{ fontSize: 8, color: COLORS.mute }}>{`— ${item.description || 'Unnamed'}`}</Text>
          <Text style={{ fontSize: 8, color: COLORS.mute }}>{formatCurrency(item.amount)}</Text>
        </View>
      ))}
    </View>
  );
}

function PageHeader({ dealName, address, pageLabel, generatedAt }: {
  dealName: string; address: string; pageLabel: string; generatedAt: Date;
}) {
  return (
    <View style={styles.header} fixed>
      <View style={styles.headerLeft}>
        <Text style={styles.dealName}>{dealName || 'Untitled Deal'}</Text>
        {address && address !== dealName ? <Text style={styles.address}>{address}</Text> : null}
      </View>
      <View style={styles.headerRight}>
        <Text style={styles.pageLabel}>{pageLabel}</Text>
        <Text style={styles.dateText}>Generated {fmtDate(generatedAt)}</Text>
      </View>
    </View>
  );
}

function PageFooter() {
  return (
    <View style={styles.footer} fixed>
      <Text style={styles.footerText}>Underwriting Model — For discussion purposes only</Text>
      <Text
        style={styles.footerText}
        render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
      />
    </View>
  );
}

// ── Document ────────────────────────────────────────────────────────────────

export function DealPDF({
  dealName, acquisition, operations, proForma, refinance, result, generatedAt = new Date(),
}: DealPDFProps) {
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
  const lastYear = result.yearlyProjections[result.yearlyProjections.length - 1];

  return (
    <Document>
      {/* ── Page 1: Cover / Summary ─────────────────────────────────────── */}
      <Page size="LETTER" style={styles.page}>
        <PageHeader
          dealName={dealName}
          address={address}
          pageLabel="Executive Summary"
          generatedAt={generatedAt}
        />

        <Text style={styles.sectionTitle}>Deal Overview</Text>
        <View style={{ marginTop: 4 }}>
          <KV label="Property Type" value={propertySummary(acquisition)} />
          <KV label="Purchase Price" value={formatCurrency(acquisition.purchasePrice)} />
          <KV label="Total Cash Invested" value={formatCurrency(result.totalInvested)} />
          <KV label="Loan Amount" value={isCash ? '— (Cash purchase)' : formatCurrency(loanAmount)} />
          <KV label="Projection Horizon" value={`${acquisition.projectionYears} years`} />
        </View>

        <Text style={styles.sectionTitle}>Key Returns</Text>
        <View style={styles.metricsGrid}>
          <View style={styles.metricCard}>
            <View style={styles.metricCardInner}>
              <Text style={styles.metricLabel}>Year 1 CoC</Text>
              <Text style={styles.metricValue}>{formatPct((firstYear?.coCReturn ?? 0) * 100)}</Text>
              <Text style={styles.metricSub}>Cash-on-cash return, year 1</Text>
            </View>
          </View>
          <View style={styles.metricCard}>
            <View style={styles.metricCardInner}>
              <Text style={styles.metricLabel}>Avg CoC</Text>
              <Text style={styles.metricValue}>{formatPct(result.avgCoCReturn * 100)}</Text>
              <Text style={styles.metricSub}>Averaged over projection</Text>
            </View>
          </View>
          <View style={styles.metricCard}>
            <View style={styles.metricCardInner}>
              <Text style={styles.metricLabel}>IRR</Text>
              <Text style={styles.metricValue}>
                {result.irr === null ? '—' : formatPct(result.irr * 100)}
              </Text>
              <Text style={styles.metricSub}>Internal rate of return</Text>
            </View>
          </View>
          <View style={styles.metricCard}>
            <View style={styles.metricCardInner}>
              <Text style={styles.metricLabel}>Equity Multiple</Text>
              <Text style={styles.metricValue}>{formatMultiple(result.equityMultiple)}</Text>
              <Text style={styles.metricSub}>Total distributions / cash in</Text>
            </View>
          </View>
          <View style={styles.metricCard}>
            <View style={styles.metricCardInner}>
              <Text style={styles.metricLabel}>Total Cash Flow</Text>
              <Text style={styles.metricValue}>{formatCurrency(result.totalCashFlow)}</Text>
              <Text style={styles.metricSub}>Sum over projection</Text>
            </View>
          </View>
          <View style={styles.metricCard}>
            <View style={styles.metricCardInner}>
              <Text style={styles.metricLabel}>Terminal Equity</Text>
              <Text style={styles.metricValue}>{formatCurrency(result.terminalEquity)}</Text>
              <Text style={styles.metricSub}>Net proceeds at exit</Text>
            </View>
          </View>
        </View>

        {acquisition.marketRateAtCreation && (
          <View style={styles.callout}>
            <Text style={styles.calloutText}>
              Market context at time of underwriting: 30-yr fixed mortgage rate was{' '}
              <Text style={{ fontFamily: 'Helvetica-Bold' }}>
                {acquisition.marketRateAtCreation.rate.toFixed(2)}%
              </Text>{' '}
              per FRED ({acquisition.marketRateAtCreation.series}), as of{' '}
              {fmtIsoAsOf(acquisition.marketRateAtCreation.asOf)}.
            </Text>
          </View>
        )}

        <PageFooter />
      </Page>

      {/* ── Page 2: Acquisition & Financing ─────────────────────────────── */}
      <Page size="LETTER" style={styles.page}>
        <PageHeader
          dealName={dealName}
          address={address}
          pageLabel="Acquisition & Financing"
          generatedAt={generatedAt}
        />

        <Text style={styles.sectionTitle}>Property</Text>
        <View style={styles.twoCol}>
          <View style={styles.col}>
            <KV label="Address" value={address || '—'} />
            <KV label="Type" value={acquisition.propertyType === 'mfr' ? 'Multi-Family' : 'Single-Family'} />
            <KV label="Units" value={String(totalUnits)} />
          </View>
          <View style={styles.col}>
            {acquisition.propertyType === 'sfr' && (
              <>
                <KV label="Bedrooms" value={String(acquisition.sfrBeds)} />
                <KV label="Bathrooms" value={String(acquisition.sfrBaths)} />
              </>
            )}
          </View>
        </View>

        {acquisition.propertyType === 'mfr' && acquisition.unitMix?.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>Unit Mix</Text>
            <View style={styles.tableHeader}>
              <Text style={[styles.tableHeaderCell, { flex: 2 }]}>Type</Text>
              <Text style={[styles.tableHeaderCell, { flex: 1, textAlign: 'right' }]}>Units</Text>
              <Text style={[styles.tableHeaderCell, { flex: 1, textAlign: 'right' }]}>Beds</Text>
              <Text style={[styles.tableHeaderCell, { flex: 1, textAlign: 'right' }]}>Baths</Text>
              <Text style={[styles.tableHeaderCell, { flex: 2, textAlign: 'right' }]}>In-Place Rent</Text>
              <Text style={[styles.tableHeaderCell, { flex: 2, textAlign: 'right' }]}>Target Rent</Text>
            </View>
            {acquisition.unitMix.map((u, i) => (
              <View key={i} style={styles.tableRow}>
                <Text style={[styles.tableCell, { flex: 2 }]}>{`${u.beds}bd/${u.baths}ba`}</Text>
                <Text style={[styles.tableCellRight, { flex: 1 }]}>{u.count}</Text>
                <Text style={[styles.tableCellRight, { flex: 1 }]}>{u.beds}</Text>
                <Text style={[styles.tableCellRight, { flex: 1 }]}>{u.baths}</Text>
                <Text style={[styles.tableCellRight, { flex: 2 }]}>{formatCurrency(u.inPlaceRent || 0)}/mo</Text>
                <Text style={[styles.tableCellRight, { flex: 2 }]}>{formatCurrency(u.rentMonthly || 0)}/mo</Text>
              </View>
            ))}
          </>
        )}

        <Text style={styles.sectionTitle}>Purchase Breakdown</Text>
        <KV label="Purchase Price" value={formatCurrency(acquisition.purchasePrice)} />
        <KV label={`Down Payment (${acquisition.downPaymentPct}%)`} value={formatCurrency(result.downPayment)} />
        {!isCash && <KV label={`Closing Costs (${acquisition.closingCostsPct}%)`} value={formatCurrency(result.closingCosts)} />}
        {!isCash && acquisition.points > 0 && <KV label={`Loan Points (${acquisition.points})`} value={formatCurrency(result.pointsCost)} />}
        {additionalFees > 0 && (
          <>
            <KV label="Additional Fees" value={formatCurrency(additionalFees)} />
            <ItemList items={acquisition.additionalFeeItems} />
          </>
        )}

        {totalReno > 0 && (
          <>
            <Text style={styles.sectionTitle}>Renovation Budget</Text>
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
            <KV label="Total Renovation" value={formatCurrency(totalReno)} />
          </>
        )}

        <Text style={styles.sectionTitle}>Financing</Text>
        {isCash ? (
          <Text style={styles.calloutText}>All-cash purchase — no financing.</Text>
        ) : (
          <>
            <KV label="Loan Amount" value={formatCurrency(loanAmount)} />
            <KV label="Interest Rate" value={formatPct(acquisition.interestRate)} />
            <KV label="Loan Term" value={`${acquisition.loanTermYears} years`} />
            {acquisition.ioPeriodMonths > 0 && (
              <KV label="Interest-Only Period" value={`${acquisition.ioPeriodMonths} months`} />
            )}
            {acquisition.marketRateAtCreation && (
              <View style={styles.callout}>
                <Text style={styles.calloutText}>
                  Underwriting assumes {formatPct(acquisition.interestRate)}. FRED 30-yr fixed benchmark was{' '}
                  <Text style={{ fontFamily: 'Helvetica-Bold' }}>
                    {acquisition.marketRateAtCreation.rate.toFixed(2)}%
                  </Text>{' '}
                  on {fmtIsoAsOf(acquisition.marketRateAtCreation.asOf)}.
                </Text>
              </View>
            )}
          </>
        )}

        <View style={{ marginTop: 12, paddingTop: 6, borderTopWidth: 1, borderTopColor: COLORS.hairline }}>
          <View style={styles.kvRow}>
            <Text style={[styles.kvLabel, { fontFamily: 'Helvetica-Bold' }]}>Total Cash Invested</Text>
            <Text style={[styles.kvValue, { color: COLORS.primary }]}>{formatCurrency(result.totalInvested)}</Text>
          </View>
        </View>

        <PageFooter />
      </Page>

      {/* ── Page 3: Operations & Rent ───────────────────────────────────── */}
      <Page size="LETTER" style={styles.page}>
        <PageHeader
          dealName={dealName}
          address={address}
          pageLabel="Operations & Rent"
          generatedAt={generatedAt}
        />

        <Text style={styles.sectionTitle}>Rent by Unit</Text>
        {(() => {
          const { rows: mixRows, totals } = buildUnitMixRentRows(acquisition);
          return (
            <>
              <View style={styles.tableHeader}>
                <Text style={[styles.tableHeaderCell, { flex: 2 }]}>Unit Type</Text>
                <Text style={[styles.tableHeaderCell, { flex: 0.7, textAlign: 'right' }]}>Count</Text>
                <Text style={[styles.tableHeaderCell, { flex: 1.4, textAlign: 'right' }]}>In-Place / Unit</Text>
                <Text style={[styles.tableHeaderCell, { flex: 1.4, textAlign: 'right' }]}>Target / Unit</Text>
                <Text style={[styles.tableHeaderCell, { flex: 1.4, textAlign: 'right' }]}>Monthly Total</Text>
                <Text style={[styles.tableHeaderCell, { flex: 1.4, textAlign: 'right' }]}>Annual Total</Text>
              </View>
              {mixRows.map((r, i) => (
                <View key={i} style={styles.tableRow}>
                  <Text style={[styles.tableCell, { flex: 2 }]}>{r.label}</Text>
                  <Text style={[styles.tableCellRight, { flex: 0.7 }]}>{r.count}</Text>
                  <Text style={[styles.tableCellRight, { flex: 1.4 }]}>{`${formatCurrency(r.inPlaceRentMonthly)}/mo`}</Text>
                  <Text style={[styles.tableCellRight, { flex: 1.4 }]}>{`${formatCurrency(r.targetRentMonthly)}/mo`}</Text>
                  <Text style={[styles.tableCellRight, { flex: 1.4 }]}>{`${formatCurrency(r.monthlyTotal)}/mo`}</Text>
                  <Text style={[styles.tableCellRight, { flex: 1.4 }]}>{`${formatCurrency(r.annualTotal)}/yr`}</Text>
                </View>
              ))}
              {mixRows.length > 1 && (
                <View style={[styles.tableRow, { borderBottomWidth: 1, borderBottomColor: COLORS.hairline }]}>
                  <Text style={[styles.tableCell, { flex: 2, fontFamily: 'Helvetica-Bold' }]}>Total</Text>
                  <Text style={[styles.tableCellRight, { flex: 0.7, fontFamily: 'Helvetica-Bold' }]}>{mixRows.reduce((s, r) => s + r.count, 0)}</Text>
                  <Text style={[styles.tableCellRight, { flex: 1.4 }]}></Text>
                  <Text style={[styles.tableCellRight, { flex: 1.4 }]}></Text>
                  <Text style={[styles.tableCellRight, { flex: 1.4, fontFamily: 'Helvetica-Bold' }]}>{`${formatCurrency(totals.monthly)}/mo`}</Text>
                  <Text style={[styles.tableCellRight, { flex: 1.4, fontFamily: 'Helvetica-Bold' }]}>{`${formatCurrency(totals.annual)}/yr`}</Text>
                </View>
              )}
            </>
          );
        })()}

        <Text style={styles.sectionTitle}>Other Rent Assumptions</Text>
        <View style={styles.twoCol}>
          <View style={styles.col}>
            <KV label="Gross Rent (T-12)" value={`${formatCurrency(proForma.grossRent.t12)}/yr`} />
            <KV label="Other Income (Stabilized)" value={`${formatCurrency(proForma.otherIncome.stabilized)}/yr`} />
            <KV label="Annual Rent Growth" value={formatPct(proForma.grossRent.growthPct)} />
          </View>
          <View style={styles.col}>
            <KV label="Vacancy" value={formatPct(proForma.vacancyPct.stabilized)} />
            <KV label="Credit Loss" value={formatPct(proForma.creditLossPct.stabilized)} />
          </View>
        </View>

        <Text style={styles.sectionTitle}>Operating Expenses (Stabilized)</Text>
        <View style={styles.tableHeader}>
          <Text style={[styles.tableHeaderCell, { flex: 3 }]}>Line Item</Text>
          <Text style={[styles.tableHeaderCell, { flex: 2, textAlign: 'right' }]}>Stabilized</Text>
          <Text style={[styles.tableHeaderCell, { flex: 1, textAlign: 'right' }]}>Growth</Text>
        </View>
        {proForma.expenses.map((exp) => (
          <View key={exp.id} style={styles.tableRow}>
            <Text style={[styles.tableCell, { flex: 3 }]}>{exp.name}</Text>
            <Text style={[styles.tableCellRight, { flex: 2 }]}>
              {exp.isPercentOfEGI
                ? `${exp.stabilizedValue}% of EGI`
                : `${formatCurrency(exp.stabilizedValue)}/mo`}
            </Text>
            <Text style={[styles.tableCellRight, { flex: 1 }]}>
              {formatPct(exp.growthPct)}
            </Text>
          </View>
        ))}

        {refinance.enabled && (
          <>
            <Text style={styles.sectionTitle}>Refinance Plan</Text>
            <View style={styles.twoCol}>
              <View style={styles.col}>
                <KV label="Refi Year" value={String(refinance.refiYear)} />
                <KV label="Assumed Value" value={formatCurrency(refinance.refiMarketValue)} />
                <KV label="New LTV" value={formatPct(refinance.newLTV)} />
              </View>
              <View style={styles.col}>
                <KV label="New Interest Rate" value={formatPct(refinance.newInterestRate)} />
                <KV label="New Loan Term" value={`${refinance.newLoanTermYears} years`} />
                <KV label="Refi Closing Costs" value={formatPct(refinance.refiCostPct)} />
              </View>
            </View>
          </>
        )}

        <Text style={styles.sectionTitle}>Exit Assumptions</Text>
        <View style={styles.twoCol}>
          <View style={styles.col}>
            <KV label="Exit Method" value={acquisition.exitMethod === 'capRate' ? 'Cap Rate' : 'Direct Value'} />
            {acquisition.exitMethod === 'capRate' && (
              <KV label="Exit Cap Rate" value={formatPct(acquisition.exitCapRate)} />
            )}
            <KV label="Exit Closing Costs" value={formatPct(acquisition.exitClosingCostPct)} />
          </View>
          <View style={styles.col}>
            <KV label="Terminal Value" value={formatCurrency(result.terminalPropertyValue)} />
            <KV label="Exit Closing Costs" value={formatCurrency(result.exitClosingCosts)} />
            <KV label="Terminal Equity" value={formatCurrency(result.terminalEquity)} />
          </View>
        </View>

        <PageFooter />
      </Page>

      {/* ── Page 4: Pro Forma & Returns ─────────────────────────────────── */}
      <Page size="LETTER" style={styles.page}>
        <PageHeader
          dealName={dealName}
          address={address}
          pageLabel="Pro Forma & Returns"
          generatedAt={generatedAt}
        />

        <Text style={styles.sectionTitle}>Annual Projection</Text>
        <View style={styles.tableHeader}>
          <Text style={[styles.tableHeaderCell, { flex: 0.6 }]}>Year</Text>
          <Text style={[styles.tableHeaderCell, { flex: 1.5, textAlign: 'right' }]}>Gross Rent</Text>
          <Text style={[styles.tableHeaderCell, { flex: 1.5, textAlign: 'right' }]}>OpEx</Text>
          <Text style={[styles.tableHeaderCell, { flex: 1.5, textAlign: 'right' }]}>NOI</Text>
          <Text style={[styles.tableHeaderCell, { flex: 1.5, textAlign: 'right' }]}>Debt Svc</Text>
          <Text style={[styles.tableHeaderCell, { flex: 1.5, textAlign: 'right' }]}>Cash Flow</Text>
          <Text style={[styles.tableHeaderCell, { flex: 1, textAlign: 'right' }]}>CoC%</Text>
        </View>
        {result.yearlyProjections.map((p) => (
          <View key={p.year} style={styles.tableRow}>
            <Text style={[styles.tableCell, { flex: 0.6 }]}>{p.year}</Text>
            <Text style={[styles.tableCellRight, { flex: 1.5 }]}>{formatCurrency(p.grossRent)}</Text>
            <Text style={[styles.tableCellRight, { flex: 1.5 }]}>{formatCurrency(p.opex)}</Text>
            <Text style={[styles.tableCellRight, { flex: 1.5 }]}>{formatCurrency(p.noi)}</Text>
            <Text style={[styles.tableCellRight, { flex: 1.5 }]}>{formatCurrency(p.debtService)}</Text>
            <Text style={[styles.tableCellRight, { flex: 1.5, color: p.cashFlow >= 0 ? COLORS.positive : COLORS.negative }]}>
              {formatCurrency(p.cashFlow)}
            </Text>
            <Text style={[styles.tableCellRight, { flex: 1 }]}>{formatPct(p.coCReturn * 100)}</Text>
          </View>
        ))}

        <Text style={styles.sectionTitle}>Cash Flow Over Time</Text>
        <View style={{ marginTop: 4 }}>
          <CashFlowChart projections={result.yearlyProjections} width={520} height={180} />
        </View>

        <Text style={styles.sectionTitle}>Returns Summary</Text>
        <View style={styles.twoCol}>
          <View style={styles.col}>
            <KV label="Total Cash Invested" value={formatCurrency(result.totalInvested)} />
            <KV label="Total Cash Flow" value={formatCurrency(result.totalCashFlow)} />
            <KV label="Terminal Equity" value={formatCurrency(result.terminalEquity)} />
          </View>
          <View style={styles.col}>
            <KV label="Average CoC" value={formatPct(result.avgCoCReturn * 100)} />
            <KV label="Peak CoC" value={formatPct(result.peakCoCReturn * 100)} />
            <KV label="Equity Multiple" value={formatMultiple(result.equityMultiple)} />
            <KV label="IRR" value={result.irr === null ? '—' : formatPct(result.irr * 100)} />
          </View>
        </View>

        {lastYear && (
          <View style={styles.callout}>
            <Text style={styles.calloutText}>
              At the end of year {lastYear.year}, cumulative cash flow is{' '}
              <Text style={{ fontFamily: 'Helvetica-Bold' }}>
                {formatCurrency(lastYear.cumulativeCashFlow)}
              </Text>
              . Combined with terminal equity of {formatCurrency(result.terminalEquity)}, the equity multiple
              on {formatCurrency(result.totalInvested)} invested is {formatMultiple(result.equityMultiple)}.
            </Text>
          </View>
        )}

        <PageFooter />
      </Page>

      {/* ── Page 5: Operation Grid (landscape for width) ────────────────── */}
      <Page size="LETTER" orientation="landscape" style={styles.page}>
        <PageHeader
          dealName={dealName}
          address={address}
          pageLabel="Operation Grid"
          generatedAt={generatedAt}
        />

        <Text style={styles.sectionTitle}>Pro Forma Detail — T-12 + {acquisition.projectionYears}-Year Projection</Text>
        {(() => {
          const matrix = buildProFormaMatrix(proForma, acquisition.projectionYears);
          const years = Array.from({ length: acquisition.projectionYears }, (_, i) => i + 1);
          const labelFlex = 2.4;
          const numFlex = 1;
          return (
            <>
              <View style={styles.tableHeader}>
                <Text style={[styles.tableHeaderCell, { flex: labelFlex }]}>Line Item</Text>
                <Text style={[styles.tableHeaderCell, { flex: numFlex, textAlign: 'right' }]}>T-12</Text>
                {years.map((y) => (
                  <Text key={y} style={[styles.tableHeaderCell, { flex: numFlex, textAlign: 'right' }]}>Yr {y}</Text>
                ))}
              </View>
              {matrix.map((row, i) => {
                if (row.isHeader) {
                  return (
                    <View key={i} style={{ paddingVertical: 4, paddingHorizontal: 4, backgroundColor: COLORS.panel }}>
                      <Text style={{ fontSize: 7.5, color: COLORS.mute, textTransform: 'uppercase', letterSpacing: 0.4, fontFamily: 'Helvetica-Bold' }}>
                        {row.label}
                      </Text>
                    </View>
                  );
                }
                const boldStyle = row.isBold ? { fontFamily: 'Helvetica-Bold' as const } : {};
                const colorStyle = row.isPositive ? { color: COLORS.positive } : {};
                return (
                  <View key={i} style={[styles.tableRow, row.isBold ? { borderBottomWidth: 1, borderBottomColor: COLORS.hairline } : {}]}>
                    <Text style={[styles.tableCell, { flex: labelFlex, fontSize: 7.5 }, boldStyle, colorStyle]}>{row.label}</Text>
                    <Text style={[styles.tableCellRight, { flex: numFlex, fontSize: 7.5 }, boldStyle, colorStyle]}>{formatCurrency(row.t12)}</Text>
                    {row.years.map((v, j) => (
                      <Text key={j} style={[styles.tableCellRight, { flex: numFlex, fontSize: 7.5 }, boldStyle, colorStyle]}>
                        {formatCurrency(v)}
                      </Text>
                    ))}
                  </View>
                );
              })}
            </>
          );
        })()}

        <PageFooter />
      </Page>
    </Document>
  );
}
