import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';
import type { CoCAcquisition, CoCCostItem, CoCOperations, CoCRefinance, CoCResult, ProFormaData } from '@/types';
import { formatCurrency, formatPct, formatMultiple } from '@/utils/dealAnalyzerCalc';
import { buildUnitMixRentRows, buildProFormaMatrix, enrichProFormaForDisplay, computeOpexBreakdown, getDisplayVacancyCredit } from '@/utils/dealSummary';
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
  ltrBadge: '#EEF2FF',
  ltrBadgeText: '#4338CA',
  mtrBadge: '#FEF3C7',
  mtrBadgeText: '#B45309',
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
  subSectionTitle: {
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
    color: COLORS.slate,
    marginTop: 10,
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },

  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 12,
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
    alignItems: 'flex-start',
    paddingVertical: 3,
    borderBottomWidth: 0.5,
    borderBottomColor: COLORS.hairline,
    gap: 12,
  },
  // paddingRight guarantees space between the label and value even when
  // the value wraps or when `gap` isn't honored by older react-pdf versions.
  kvLabel: { color: COLORS.slate, paddingRight: 8 },
  // flexShrink lets long address strings wrap gracefully instead of
  // overflowing the column; textAlign keeps the value right-aligned.
  kvValue: { color: COLORS.ink, fontFamily: 'Helvetica-Bold', flexShrink: 1, textAlign: 'right' },

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
  tableSubHeader: {
    flexDirection: 'row',
    paddingVertical: 3,
    paddingHorizontal: 4,
    backgroundColor: COLORS.panel,
  },
  tableCell: { fontSize: 8, color: COLORS.ink },
  tableCellRight: { fontSize: 8, color: COLORS.ink, textAlign: 'right' },

  badge: {
    marginLeft: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 2,
    fontSize: 6.5,
    fontFamily: 'Helvetica-Bold',
    letterSpacing: 0.3,
  },

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
  /** Persisted market assumptions block. Optional; hidden when absent. */
  aiAssumptions?: Record<string, unknown> | null;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function fmtDate(d: Date): string {
  return d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
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
  dealName, acquisition, operations, proForma, refinance, result,
  generatedAt = new Date(), aiAssumptions,
}: DealPDFProps) {
  void operations;

  // Enrich pf ONCE at the top — every downstream renderer reuses this so
  // the PDF's numbers cannot drift from the app's grid.
  const enrichedPf = enrichProFormaForDisplay(proForma, acquisition, aiAssumptions);

  const address = acquisition.propertyAddress || '';
  const firstYear = result.yearlyProjections[0];
  const lastYear = result.yearlyProjections[result.yearlyProjections.length - 1];
  const projectionYears = acquisition.projectionYears;
  const years = Array.from({ length: projectionYears }, (_, i) => i + 1);
  const isCash = acquisition.downPaymentPct >= 100;

  // Purchase / cost breakdown
  const additionalFees = sumItems(acquisition.additionalFeeItems);
  const hardCosts = sumItems(acquisition.hardCostItems);
  const softCosts = sumItems(acquisition.softCostItems);
  const opportunityCosts = sumItems(acquisition.opportunityCostItems);
  const totalReno = hardCosts + softCosts + opportunityCosts;
  const closingCostAmt = acquisition.purchasePrice * (acquisition.closingCostsPct / 100);
  const loanAmount = result.initialLoanAmount;
  const pointsCost = loanAmount * (acquisition.points / 100);

  // Cap-rate assumptions block (from persisted market assumptions)
  const capBlock = (aiAssumptions?.cap_rate_estimation ?? null) as {
    current_market_cap_rate_pct?: number | null;
    exit_cap_rate_pct?: number | null;
  } | null;
  const entryCap = capBlock?.current_market_cap_rate_pct ?? null;
  const exitCapFromAi = capBlock?.exit_cap_rate_pct ?? null;
  const impliedValueAtEntry = entryCap != null && entryCap > 0 && firstYear
    ? firstYear.noi / (entryCap / 100)
    : null;

  // Rent-by-unit rows (with in-place → target)
  const unitMixRows = acquisition.propertyType === 'mfr' && acquisition.unitMix?.length
    ? acquisition.unitMix.map((u) => ({
        label: `${u.beds}BR/${u.baths}BA`,
        count: u.count,
        inPlaceMonthly: u.inPlaceRent || 0,
        targetMonthly: u.rentMonthly || 0,
        rentalType: (u.rentalType ?? 'LTR') as 'LTR' | 'MTR' | 'STR',
      }))
    : [{
        label: `SFR${acquisition.sfrBeds ? ` (${acquisition.sfrBeds}BR/${acquisition.sfrBaths}BA)` : ''}`,
        count: 1,
        inPlaceMonthly: acquisition.sfrInPlaceRent || 0,
        targetMonthly: acquisition.sfrTargetRent || 0,
        rentalType: (acquisition.sfrRentalType ?? 'LTR') as 'LTR' | 'MTR' | 'STR',
      }];

  // Growth rates — pull from proForma (matches app's Assumptions page).
  const incomeGrowthPct = enrichedPf.grossRent.growthPct;
  const insuranceExp = enrichedPf.expenses.find((e) => /insurance/i.test(e.name));
  const insuranceGrowthPct = insuranceExp?.growthPct ?? 5;
  const nonInsExp = enrichedPf.expenses.find((e) => !/insurance/i.test(e.name) && e.growthPct > 0);
  const expenseGrowthPct = nonInsExp?.growthPct ?? 2;

  // Vacancy — for single-strategy deals use the helper (which picks the
  // strategy-appropriate %); for mixed LTR+MTR deals we show both blocks
  // labeled by strategy. Reading `enrichedPf.vacancyPct.stabilized` raw would
  // surface the LTR default (5%) even on MTR-only deals.
  const vc = getDisplayVacancyCredit(enrichedPf);
  const ltrVacPct = vc.soleStrategy === 'mtr' ? vc.vacancyPct : enrichedPf.vacancyPct.stabilized;
  const ltrCLPct = vc.soleStrategy === 'mtr' ? vc.creditLossPct : enrichedPf.creditLossPct.stabilized;
  const mtrVacPct = enrichedPf.vacancyMtrPct?.stabilized;
  const mtrCLPct = enrichedPf.creditLossMtrPct?.stabilized;
  const strategies = enrichedPf.strategyByType ?? [];
  const hasMtr = strategies.some((s) => s === 'MTR' || s === 'STR');
  // hasLtr defaults to true when strategyByType is missing entirely — a deal
  // without strategy info is treated as LTR-only for backward compat.
  const hasLtr = strategies.length === 0 || strategies.some((s) => !s || s === 'LTR');

  // Pro-forma matrix (split-by-strategy) — same helper the app uses.
  const matrix = buildProFormaMatrix(enrichedPf, projectionYears);

  // Grouped expenses for Page 3 Operating Expenses breakdown.
  // MTR match includes both "(MTR)" AND "(MTR/STR)" (utilities bundled, internet, etc.)
  // AND any name with the word MTR anywhere — mirrors the projector's
  // strategyForExpenseName classifier so grouping is consistent.
  const isMtrName = (name: string) => /\(mtr/i.test(name) || /\bmtr\b/i.test(name);
  const isLtrName = (name: string) => /\(ltr\)/i.test(name);
  // Hide zero-value rows on the PDF — an empty line item is just noise.
  // For both fixed-$ and %-of-EGI items, a stabilizedValue of 0 means "no
  // cost", so we filter it out before grouping.
  const nonZeroExp = enrichedPf.expenses.filter((e) => (e.stabilizedValue ?? 0) > 0);
  // Strategy filter — mirrors the flat pro-forma grid's `expensesForTotal`
  // logic. An MTR-only deal shouldn't render an "LTR Expenses" section at
  // all (and vice versa) — the projector's opex sum already excludes
  // cross-strategy items, so the PDF's breakdown must too or the reader
  // sees line items that don't reconcile to NOI.
  const strategyFiltered = nonZeroExp.filter((e) => {
    const isLtr = isLtrName(e.name);
    const isMtr = isMtrName(e.name);
    if (!isLtr && !isMtr) return true;                    // common — always show
    if (hasLtr && hasMtr) return true;                    // mixed — show all
    if (hasMtr && !hasLtr) return isMtr;                  // MTR-only — hide LTR
    if (hasLtr && !hasMtr) return isLtr;                  // LTR-only — hide MTR
    return true;
  });
  const commonExp = strategyFiltered.filter((e) => !isLtrName(e.name) && !isMtrName(e.name));
  const ltrExp    = strategyFiltered.filter((e) => isLtrName(e.name));
  const mtrExp    = strategyFiltered.filter((e) => isMtrName(e.name));

  // Single-strategy deals (MTR-only or LTR-only) have no ambiguity, so
  // strip the strategy suffix from expense names — "Property Management
  // (MTR)" → "Property Management", "Insurance Rider (MTR/STR)" →
  // "Insurance Rider". Mixed deals keep the suffix so the reader can
  // distinguish the LTR vs MTR versions of a shared category.
  const isSingleStrategy = (hasMtr && !hasLtr) || (hasLtr && !hasMtr);
  const stripSuffix = (name: string): string =>
    isSingleStrategy
      ? name.replace(/\s*\((LTR|MTR|MTR\/STR|STR)\)\s*$/i, '').trim()
      : name;

  const renderOpexRow = (exp: (typeof enrichedPf.expenses)[number]) => {
    const b = computeOpexBreakdown(exp.name, exp.stabilizedValue, exp.isPercentOfEGI, acquisition, enrichedPf);
    // %-of-EGI expenses (Property Management, Repairs & Maintenance) don't
    // have a meaningful per-unit dollar — the underlying assumption IS the
    // percentage. Show the % in all three $ columns instead of a derived
    // per-unit number that misleads the reader.
    const pctLabel = `${exp.stabilizedValue}% EGI`;
    const displayName = stripSuffix(exp.name);
    return (
      <View key={exp.id} style={styles.tableRow}>
        <Text style={[styles.tableCell, { flex: 2.4 }]}>
          {displayName}{exp.isPercentOfEGI ? ` (${pctLabel})` : ''}
        </Text>
        <Text style={[styles.tableCellRight, { flex: 1.2 }]}>
          {exp.isPercentOfEGI ? pctLabel : formatCurrency(b.annual)}
        </Text>
        <Text style={[styles.tableCellRight, { flex: 1.2 }]}>
          {exp.isPercentOfEGI ? pctLabel : formatCurrency(b.perUnitYr)}
        </Text>
        <Text style={[styles.tableCellRight, { flex: 1.2 }]}>
          {exp.isPercentOfEGI ? pctLabel : formatCurrency(b.perUnitMo)}
        </Text>
        <Text style={[styles.tableCellRight, { flex: 0.8 }]}>{formatPct(exp.growthPct)}</Text>
      </View>
    );
  };

  // For "Total Cash Invested" line on Page 2.
  const totalCashInvested = result.totalInvested;

  return (
    <Document>
      {/* ── Page 1: Executive Summary ────────────────────────────────── */}
      <Page size="LETTER" style={styles.page}>
        <PageHeader dealName={dealName} address={address} pageLabel="Executive Summary" generatedAt={generatedAt} />

        <Text style={styles.sectionTitle}>Deal Overview</Text>
        <View style={styles.twoCol}>
          <View style={styles.col}>
            <KV label="Property" value={propertySummary(acquisition)} />
            <KV label="Purchase Price" value={formatCurrency(acquisition.purchasePrice)} />
            <KV label="Total Cash Invested" value={formatCurrency(totalCashInvested)} />
          </View>
          <View style={styles.col}>
            <KV label="Loan Amount" value={isCash ? '—' : formatCurrency(loanAmount)} />
            <KV label="Down Payment" value={formatPct(acquisition.downPaymentPct)} />
            <KV label="Projection" value={`${projectionYears} year${projectionYears !== 1 ? 's' : ''}`} />
          </View>
        </View>

        <Text style={styles.sectionTitle}>Key Returns</Text>
        <View style={styles.metricsGrid}>
          <View style={styles.metricCard}>
            <View style={styles.metricCardInner}>
              <Text style={styles.metricLabel}>Year 1 CoC</Text>
              <Text style={styles.metricValue}>{formatPct(firstYear?.coCReturn ?? 0)}</Text>
              <Text style={styles.metricSub}>Cash-on-cash, year 1</Text>
            </View>
          </View>
          <View style={styles.metricCard}>
            <View style={styles.metricCardInner}>
              <Text style={styles.metricLabel}>Avg CoC</Text>
              <Text style={styles.metricValue}>{formatPct(result.avgCoCReturn)}</Text>
              <Text style={styles.metricSub}>Averaged over projection</Text>
            </View>
          </View>
          <View style={styles.metricCard}>
            <View style={styles.metricCardInner}>
              <Text style={styles.metricLabel}>IRR</Text>
              <Text style={styles.metricValue}>
                {result.irr === null ? '—' : formatPct(result.irr)}
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

        <PageFooter />
      </Page>

      {/* ── Page 2: Property & Financing ─────────────────────────────── */}
      <Page size="LETTER" style={styles.page}>
        <PageHeader dealName={dealName} address={address} pageLabel="Property & Financing" generatedAt={generatedAt} />

        <Text style={styles.sectionTitle}>Property</Text>
        <View style={styles.twoCol}>
          <View style={styles.col}>
            <KV label="Address" value={address || '—'} />
            <KV label="Type" value={acquisition.propertyType === 'mfr' ? 'Multi-Family' : 'Single-Family'} />
          </View>
          <View style={styles.col}>
            <KV label="Total Units" value={String(unitMixRows.reduce((s, r) => s + r.count, 0))} />
            <KV label="Hold Period" value={`${projectionYears} year${projectionYears !== 1 ? 's' : ''}`} />
          </View>
        </View>

        <Text style={styles.sectionTitle}>Purchase Breakdown</Text>
        <View style={{ marginTop: 4 }}>
          <KV label="Purchase Price" value={formatCurrency(acquisition.purchasePrice)} />
          {!isCash && <KV label={`Closing Costs (${formatPct(acquisition.closingCostsPct)})`} value={formatCurrency(closingCostAmt)} />}
          {!isCash && acquisition.points > 0 && <KV label={`Loan Points (${formatPct(acquisition.points)})`} value={formatCurrency(pointsCost)} />}
          {additionalFees > 0 && (
            <>
              <KV label="Additional Fees" value={formatCurrency(additionalFees)} />
              <ItemList items={acquisition.additionalFeeItems ?? []} />
            </>
          )}
          {totalReno > 0 && (
            <>
              <KV label="Renovation Budget" value={formatCurrency(totalReno)} />
              {hardCosts > 0 && <ItemList items={acquisition.hardCostItems ?? []} />}
              {softCosts > 0 && <ItemList items={acquisition.softCostItems ?? []} />}
              {opportunityCosts > 0 && <ItemList items={acquisition.opportunityCostItems ?? []} />}
            </>
          )}
          <View style={[styles.kvRow, { borderBottomWidth: 0, marginTop: 4, paddingTop: 6, borderTopWidth: 1, borderTopColor: COLORS.slate }]}>
            <Text style={[styles.kvLabel, { fontFamily: 'Helvetica-Bold' }]}>Total Cash Invested</Text>
            <Text style={[styles.kvValue, { color: COLORS.primary }]}>{formatCurrency(totalCashInvested)}</Text>
          </View>
        </View>

        {!isCash && (
          <>
            <Text style={styles.sectionTitle}>Financing</Text>
            <View style={styles.twoCol}>
              <View style={styles.col}>
                <KV label="Loan Amount" value={formatCurrency(loanAmount)} />
                <KV label="Down Payment %" value={formatPct(acquisition.downPaymentPct)} />
                <KV label="Loan Term" value={`${acquisition.loanTermYears} years`} />
              </View>
              <View style={styles.col}>
                <KV label="Interest Rate" value={formatPct(acquisition.interestRate)} />
                <KV label="Loan Points" value={formatPct(acquisition.points)} />
                <KV label="Interest-Only Period" value={`${acquisition.ioPeriodMonths} months`} />
              </View>
            </View>
          </>
        )}

        <PageFooter />
      </Page>

      {/* ── Page 3: Assumptions ──────────────────────────────────────── */}
      <Page size="LETTER" style={styles.page}>
        <PageHeader dealName={dealName} address={address} pageLabel="Assumptions" generatedAt={generatedAt} />

        {/* Exit assumption block — swaps between Cap Rate Assumptions and
            ARV Assumption depending on `acquisition.exitMethod`. Users who
            exit on ARV (not cap rate) shouldn't see cap-rate math in the
            PDF, it's not what's driving their terminal value. */}
        {acquisition.exitMethod === 'capRate' ? (
          (entryCap != null || exitCapFromAi != null) && (
            <>
              <Text style={styles.sectionTitle}>Cap Rate Assumptions</Text>
              <View style={styles.twoCol}>
                <View style={styles.col}>
                  {entryCap != null && <KV label="Current Market Cap" value={formatPct(entryCap)} />}
                  {exitCapFromAi != null && <KV label="Exit Cap" value={formatPct(exitCapFromAi)} />}
                  {entryCap != null && exitCapFromAi != null && (
                    <KV label="Spread" value={`${(exitCapFromAi - entryCap) >= 0 ? '+' : ''}${(exitCapFromAi - entryCap).toFixed(2)}%`} />
                  )}
                </View>
                <View style={styles.col}>
                  {impliedValueAtEntry != null && (
                    <KV label="Implied Value @ Entry" value={formatCurrency(impliedValueAtEntry)} />
                  )}
                </View>
              </View>
            </>
          )
        ) : (
          acquisition.arv > 0 && (
            <>
              <Text style={styles.sectionTitle}>ARV Assumption</Text>
              <View style={styles.twoCol}>
                <View style={styles.col}>
                  <KV label="ARV / Exit Value" value={formatCurrency(acquisition.arv)} />
                  {acquisition.purchasePrice > 0 && (
                    <KV
                      label="Value Uplift vs Purchase"
                      value={`${acquisition.arv >= acquisition.purchasePrice ? '+' : ''}${(((acquisition.arv - acquisition.purchasePrice) / acquisition.purchasePrice) * 100).toFixed(1)}%`}
                    />
                  )}
                </View>
                <View style={styles.col}>
                  {acquisition.purchasePrice > 0 && (
                    <KV
                      label="Purchase Price"
                      value={formatCurrency(acquisition.purchasePrice)}
                    />
                  )}
                </View>
              </View>
            </>
          )
        )}

        <Text style={styles.sectionTitle}>Growth</Text>
        <View style={styles.twoCol}>
          <View style={styles.col}>
            <KV label="Income Growth" value={`${formatPct(incomeGrowthPct)}/yr`} />
            <KV label="Expense Growth" value={`${formatPct(expenseGrowthPct)}/yr`} />
          </View>
          <View style={styles.col}>
            <KV label="Insurance Growth" value={`${formatPct(insuranceGrowthPct)}/yr`} />
          </View>
        </View>

        <Text style={styles.sectionTitle}>Vacancy & Collections</Text>
        <View style={styles.twoCol}>
          {hasLtr && (
            <View style={styles.col}>
              <KV label={hasMtr ? "LTR Vacancy" : "Vacancy"} value={formatPct(ltrVacPct)} />
              <KV label={hasMtr ? "LTR Credit Loss / Bad Debt" : "Credit Loss / Bad Debt"} value={formatPct(ltrCLPct)} />
            </View>
          )}
          {hasMtr && (
            <View style={styles.col}>
              <KV label={hasLtr ? "MTR / STR Vacancy" : "Vacancy"} value={formatPct(mtrVacPct ?? 20)} />
              <KV label={hasLtr ? "MTR / STR Credit Loss / Bad Debt" : "Credit Loss / Bad Debt"} value={formatPct(mtrCLPct ?? 2)} />
            </View>
          )}
        </View>

        <Text style={styles.sectionTitle}>Rent by Unit</Text>
        <View style={styles.tableHeader}>
          <Text style={[styles.tableHeaderCell, { flex: 2 }]}>Unit Type</Text>
          <Text style={[styles.tableHeaderCell, { flex: 0.6, textAlign: 'center' }]}>Count</Text>
          <Text style={[styles.tableHeaderCell, { flex: 1.4, textAlign: 'right' }]}>In-Place $/mo</Text>
          <Text style={[styles.tableHeaderCell, { flex: 1.4, textAlign: 'right' }]}>Target $/mo</Text>
          <Text style={[styles.tableHeaderCell, { flex: 1.6, textAlign: 'right' }]}>Annual (Target)</Text>
        </View>
        {unitMixRows.map((r, i) => {
          const badgeStyle = r.rentalType === 'LTR'
            ? { backgroundColor: COLORS.ltrBadge, color: COLORS.ltrBadgeText }
            : { backgroundColor: COLORS.mtrBadge, color: COLORS.mtrBadgeText };
          return (
            <View key={i} style={styles.tableRow}>
              <View style={{ flex: 2, flexDirection: 'row', alignItems: 'center' }}>
                <Text style={styles.tableCell}>{r.label}</Text>
                <Text style={[styles.badge, badgeStyle]}>{r.rentalType}</Text>
              </View>
              <Text style={[styles.tableCellRight, { flex: 0.6, textAlign: 'center' }]}>{r.count}</Text>
              <Text style={[styles.tableCellRight, { flex: 1.4 }]}>{formatCurrency(r.inPlaceMonthly)}</Text>
              <Text style={[styles.tableCellRight, { flex: 1.4 }]}>{formatCurrency(r.targetMonthly)}</Text>
              <Text style={[styles.tableCellRight, { flex: 1.6 }]}>{formatCurrency(r.targetMonthly * r.count * 12)}</Text>
            </View>
          );
        })}
        {(() => {
          const totals = buildUnitMixRentRows(acquisition).totals;
          return (
            <View style={[styles.tableRow, { backgroundColor: COLORS.panel }]}>
              <Text style={[styles.tableCell, { flex: 2, fontFamily: 'Helvetica-Bold' }]}>Total (Market)</Text>
              <Text style={[styles.tableCellRight, { flex: 0.6 }]}></Text>
              <Text style={[styles.tableCellRight, { flex: 1.4 }]}></Text>
              <Text style={[styles.tableCellRight, { flex: 1.4, fontFamily: 'Helvetica-Bold' }]}>{formatCurrency(totals.monthly)}</Text>
              <Text style={[styles.tableCellRight, { flex: 1.6, fontFamily: 'Helvetica-Bold' }]}>{formatCurrency(totals.annual)}</Text>
            </View>
          );
        })()}

        <Text style={styles.sectionTitle}>Operating Expenses (Stabilized)</Text>
        <View style={styles.tableHeader}>
          <Text style={[styles.tableHeaderCell, { flex: 2.4 }]}>Line Item</Text>
          <Text style={[styles.tableHeaderCell, { flex: 1.2, textAlign: 'right' }]}>Total $/yr</Text>
          <Text style={[styles.tableHeaderCell, { flex: 1.2, textAlign: 'right' }]}>$/unit/yr</Text>
          <Text style={[styles.tableHeaderCell, { flex: 1.2, textAlign: 'right' }]}>$/unit/mo</Text>
          <Text style={[styles.tableHeaderCell, { flex: 0.8, textAlign: 'right' }]}>Growth</Text>
        </View>
        {commonExp.length > 0 && commonExp.map(renderOpexRow)}
        {ltrExp.length > 0 && (
          <>
            {!isSingleStrategy && (
              <View style={styles.tableSubHeader}>
                <Text style={{ fontSize: 7, color: COLORS.slate, fontFamily: 'Helvetica-Bold', textTransform: 'uppercase', letterSpacing: 0.4 }}>
                  LTR Expenses
                </Text>
              </View>
            )}
            {ltrExp.map(renderOpexRow)}
          </>
        )}
        {mtrExp.length > 0 && (
          <>
            {!isSingleStrategy && (
              <View style={styles.tableSubHeader}>
                <Text style={{ fontSize: 7, color: COLORS.slate, fontFamily: 'Helvetica-Bold', textTransform: 'uppercase', letterSpacing: 0.4 }}>
                  MTR / STR Expenses
                </Text>
              </View>
            )}
            {mtrExp.map(renderOpexRow)}
          </>
        )}

        <PageFooter />
      </Page>

      {/* ── Page 4: Exit & Refi ──────────────────────────────────────── */}
      <Page size="LETTER" style={styles.page}>
        <PageHeader dealName={dealName} address={address} pageLabel="Exit & Refinance" generatedAt={generatedAt} />

        <Text style={styles.sectionTitle}>Exit Assumptions</Text>
        <View style={styles.twoCol}>
          <View style={styles.col}>
            <KV label="Exit Method" value={acquisition.exitMethod === 'capRate' ? 'Cap Rate' : 'Direct Value'} />
            {acquisition.exitMethod === 'capRate' && (
              <KV label="Exit Cap Rate" value={formatPct(acquisition.exitCapRate)} />
            )}
            <KV label="Exit Closing Costs %" value={formatPct(acquisition.exitClosingCostPct)} />
          </View>
          <View style={styles.col}>
            <KV label="Terminal Value" value={formatCurrency(result.terminalPropertyValue)} />
            <KV label="Exit Closing Costs $" value={formatCurrency(result.exitClosingCosts)} />
            <KV label="Terminal Equity" value={formatCurrency(result.terminalEquity)} />
          </View>
        </View>

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

        <PageFooter />
      </Page>

      {/* ── Page 5: Returns ──────────────────────────────────────────── */}
      <Page size="LETTER" style={styles.page}>
        <PageHeader dealName={dealName} address={address} pageLabel="Returns" generatedAt={generatedAt} />

        <Text style={styles.sectionTitle}>Yearly Projections</Text>
        <View style={styles.tableHeader}>
          <Text style={[styles.tableHeaderCell, { flex: 0.6 }]}>Yr</Text>
          <Text style={[styles.tableHeaderCell, { flex: 1.3, textAlign: 'right' }]}>EGI</Text>
          <Text style={[styles.tableHeaderCell, { flex: 1.3, textAlign: 'right' }]}>NOI</Text>
          <Text style={[styles.tableHeaderCell, { flex: 1.3, textAlign: 'right' }]}>Debt Svc</Text>
          <Text style={[styles.tableHeaderCell, { flex: 1.3, textAlign: 'right' }]}>Cash Flow</Text>
          <Text style={[styles.tableHeaderCell, { flex: 1, textAlign: 'right' }]}>CoC</Text>
          <Text style={[styles.tableHeaderCell, { flex: 1.3, textAlign: 'right' }]}>IRR CF</Text>
        </View>

        {/* Year 0 — initial outlay */}
        <View style={styles.tableRow}>
          <Text style={[styles.tableCell, { flex: 0.6, fontFamily: 'Helvetica-Bold' }]}>0</Text>
          <Text style={[styles.tableCell, { flex: 1.3 * 5, color: COLORS.mute, fontStyle: 'italic' }]}>Initial outlay</Text>
          <Text style={[styles.tableCellRight, { flex: 1.3, color: COLORS.negative, fontFamily: 'Helvetica-Bold' }]}>
            {formatCurrency((result.irrCashFlows?.[0]) ?? -totalCashInvested)}
          </Text>
        </View>

        {result.yearlyProjections.map((p) => {
          const irrCF = (result.irrCashFlows?.length ?? 0) > p.year ? result.irrCashFlows[p.year] : p.cashFlow;
          return (
            <View key={p.year} style={styles.tableRow}>
              <Text style={[styles.tableCell, { flex: 0.6, fontFamily: 'Helvetica-Bold' }]}>{p.year}</Text>
              <Text style={[styles.tableCellRight, { flex: 1.3 }]}>{formatCurrency(p.effectiveRent)}</Text>
              <Text style={[styles.tableCellRight, { flex: 1.3 }]}>{formatCurrency(p.noi)}</Text>
              <Text style={[styles.tableCellRight, { flex: 1.3, color: COLORS.mute }]}>{formatCurrency(p.debtService)}</Text>
              <Text style={[styles.tableCellRight, { flex: 1.3, color: p.cashFlow >= 0 ? COLORS.positive : COLORS.negative, fontFamily: 'Helvetica-Bold' }]}>
                {formatCurrency(p.cashFlow)}
              </Text>
              <Text style={[styles.tableCellRight, { flex: 1, color: p.coCReturn >= 0 ? COLORS.positive : COLORS.negative, fontFamily: 'Helvetica-Bold' }]}>
                {formatPct(p.coCReturn)}
              </Text>
              <Text style={[styles.tableCellRight, { flex: 1.3, color: irrCF >= 0 ? COLORS.primary : COLORS.negative, fontFamily: 'Helvetica-Bold' }]}>
                {formatCurrency(irrCF)}
              </Text>
            </View>
          );
        })}

        {/* Totals row */}
        {(() => {
          const totals = result.yearlyProjections.reduce(
            (a, p) => ({
              egi: a.egi + p.effectiveRent,
              noi: a.noi + p.noi,
              debt: a.debt + p.debtService,
              cf: a.cf + p.cashFlow,
            }),
            { egi: 0, noi: 0, debt: 0, cf: 0 }
          );
          return (
            <View style={[styles.tableRow, { backgroundColor: COLORS.panel, borderTopWidth: 1, borderTopColor: COLORS.slate }]}>
              <Text style={[styles.tableCell, { flex: 0.6, fontFamily: 'Helvetica-Bold' }]}>Total</Text>
              <Text style={[styles.tableCellRight, { flex: 1.3, fontFamily: 'Helvetica-Bold' }]}>{formatCurrency(totals.egi)}</Text>
              <Text style={[styles.tableCellRight, { flex: 1.3, fontFamily: 'Helvetica-Bold' }]}>{formatCurrency(totals.noi)}</Text>
              <Text style={[styles.tableCellRight, { flex: 1.3, fontFamily: 'Helvetica-Bold', color: COLORS.mute }]}>{formatCurrency(totals.debt)}</Text>
              <Text style={[styles.tableCellRight, { flex: 1.3, fontFamily: 'Helvetica-Bold', color: totals.cf >= 0 ? COLORS.positive : COLORS.negative }]}>
                {formatCurrency(totals.cf)}
              </Text>
              <Text style={[styles.tableCellRight, { flex: 1 }]}></Text>
              <Text style={[styles.tableCellRight, { flex: 1.3 }]}></Text>
            </View>
          );
        })()}

        <Text style={styles.sectionTitle}>Cash Flow Over Time</Text>
        <View style={{ alignItems: 'center', marginTop: 6 }}>
          <CashFlowChart projections={result.yearlyProjections} width={520} height={180} />
        </View>

        <Text style={styles.sectionTitle}>Returns Summary</Text>
        <View style={styles.twoCol}>
          <View style={styles.col}>
            <KV label="Year 1 CoC" value={formatPct(firstYear?.coCReturn ?? 0)} />
            <KV label="Average CoC" value={formatPct(result.avgCoCReturn)} />
            <KV label="Peak CoC" value={formatPct(result.peakCoCReturn)} />
          </View>
          <View style={styles.col}>
            <KV label="IRR" value={result.irr === null ? '—' : formatPct(result.irr)} />
            <KV label="Equity Multiple" value={formatMultiple(result.equityMultiple)} />
            <KV label="Total Cash Flow" value={formatCurrency(result.totalCashFlow)} />
          </View>
        </View>
        {lastYear && (
          <View style={{ marginTop: 12, backgroundColor: COLORS.panel, padding: 10, borderRadius: 4 }}>
            <Text style={{ fontSize: 8, color: COLORS.slate }}>
              Over the {projectionYears}-year hold, cumulative pre-tax cash flow is{' '}
              <Text style={{ fontFamily: 'Helvetica-Bold' }}>{formatCurrency(lastYear.cumulativeCashFlow)}</Text>.
              Combined with terminal equity of {formatCurrency(result.terminalEquity)}, the equity multiple
              on {formatCurrency(totalCashInvested)} invested is {formatMultiple(result.equityMultiple)}.
            </Text>
          </View>
        )}

        <PageFooter />
      </Page>

      {/* ── Page 6 (landscape): Pro Forma Detail ─────────────────────── */}
      <Page size="LETTER" orientation="landscape" style={styles.page}>
        <PageHeader dealName={dealName} address={address} pageLabel="Pro Forma Detail" generatedAt={generatedAt} />

        <Text style={styles.sectionTitle}>Pro Forma Detail — {projectionYears}-Year Projection</Text>
        <View style={styles.tableHeader}>
          <Text style={[styles.tableHeaderCell, { flex: 2.4 }]}>Line Item</Text>
          {years.map((y) => (
            <Text key={y} style={[styles.tableHeaderCell, { flex: 1, textAlign: 'right' }]}>Yr {y}</Text>
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
              <Text style={[styles.tableCell, { flex: 2.4, fontSize: 7.5 }, boldStyle, colorStyle]}>{row.label}</Text>
              {row.years.map((v, j) => (
                <Text key={j} style={[styles.tableCellRight, { flex: 1, fontSize: 7.5 }, boldStyle, colorStyle]}>
                  {formatCurrency(v)}
                </Text>
              ))}
            </View>
          );
        })}

        <PageFooter />
      </Page>
    </Document>
  );
}
