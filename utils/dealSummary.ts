import type { CoCAcquisition, ProFormaData } from '@/types';
import { makeProFormaProjector } from './proFormaYearCalc';

// ── Unit-mix rent breakdown ─────────────────────────────────────────────────

export interface UnitMixRentRow {
  label: string;              // e.g. "2× 1BR/1BA" or "SFR (3BR/2BA)"
  count: number;
  inPlaceRentMonthly: number; // per unit
  targetRentMonthly: number;  // per unit
  monthlyTotal: number;       // count × target
  annualTotal: number;        // monthlyTotal × 12
}

export function buildUnitMixRentRows(acquisition: CoCAcquisition): {
  rows: UnitMixRentRow[];
  totals: { monthly: number; annual: number };
} {
  if (acquisition.propertyType === 'sfr') {
    const targetMo = acquisition.sfrTargetRent || 0;
    const beds = acquisition.sfrBeds || 0;
    const baths = acquisition.sfrBaths || 0;
    const label = beds && baths ? `SFR (${beds}BR/${baths}BA)` : 'SFR';
    const row: UnitMixRentRow = {
      label,
      count: 1,
      inPlaceRentMonthly: acquisition.sfrInPlaceRent || 0,
      targetRentMonthly: targetMo,
      monthlyTotal: targetMo,
      annualTotal: targetMo * 12,
    };
    return { rows: [row], totals: { monthly: targetMo, annual: targetMo * 12 } };
  }

  const rows: UnitMixRentRow[] = (acquisition.unitMix ?? []).map((u) => {
    const monthlyTotal = (u.rentMonthly || 0) * u.count;
    return {
      label: `${u.count}× ${u.beds}BR/${u.baths}BA`,
      count: u.count,
      inPlaceRentMonthly: u.inPlaceRent || 0,
      targetRentMonthly: u.rentMonthly || 0,
      monthlyTotal,
      annualTotal: monthlyTotal * 12,
    };
  });

  const monthly = rows.reduce((s, r) => s + r.monthlyTotal, 0);
  return { rows, totals: { monthly, annual: monthly * 12 } };
}

// ── Pro forma matrix ────────────────────────────────────────────────────────

export interface ProFormaMatrixRow {
  label: string;
  t12: number;
  years: number[];
  isHeader?: boolean;   // section header (Expenses divider)
  isBold?: boolean;     // subtotal / total row
  isPositive?: boolean; // NOI highlight
}

/**
 * Build the full pro forma matrix for display: income line items, expense line
 * items, and totals across T12 + Yr1..YrN. Uses the same projector as the
 * on-screen ProFormaGrid so the numbers match exactly.
 */
export function buildProFormaMatrix(pf: ProFormaData, projectionYears: number): ProFormaMatrixRow[] {
  const projector = makeProFormaProjector(pf);
  const years = Array.from({ length: projectionYears }, (_, i) => i + 1);

  const grossRentT12 = pf.grossRent.t12;
  const marketRentT12 = grossRentT12 + (pf.lossToLeaseT12 ?? 0);
  const otherIncomeT12 = pf.otherIncome.t12;
  const vacancyPctT12 = pf.vacancyPct.t12;
  const creditLossPctT12 = pf.creditLossPct.t12;

  // T12 vacancy/credit loss in dollars — % of market rent
  const vacancyT12 = marketRentT12 * (vacancyPctT12 / 100);
  const creditLossT12 = marketRentT12 * (creditLossPctT12 / 100);
  const egiT12 = grossRentT12 - vacancyT12 - creditLossT12 + otherIncomeT12;

  const opexT12 = pf.expenses.reduce((sum, e) => {
    if (e.isPercentOfEGI) return sum + egiT12 * (e.t12Value / 100);
    return sum + e.t12Value * 12; // monthly $ → annual
  }, 0);

  // Per-year computed values
  const marketRentYr = years.map((y) => projector.getMarketRentForYear(y));
  const grossRentYr = years.map((y) => projector.getGrossRentForYear(y));
  const lossToLeaseYr = years.map((y, i) => marketRentYr[i] - grossRentYr[i]);
  const egiYr = years.map((y) => projector.getEGIForYear(y));
  const opexYr = egiYr.map((egi, i) => projector.getOpExForYear(years[i], egi));
  const noiYr = egiYr.map((egi, i) => egi - opexYr[i]);

  // Other income + vacancy + credit loss per year — reconstruct from EGI equation:
  //   EGI = grossRent - vacancy - creditLoss + otherIncome
  // We need each component separately for display.
  const otherIncomeYr = years.map((y) => {
    const ov = pf.yearOverrides?.[y]?.otherIncome;
    if (ov !== undefined) return ov;
    // Chained: apply growth from t12 base for years going forward
    let value = pf.otherIncome.stabilized;
    let growth = pf.otherIncome.growthPct;
    for (let yr = 2; yr <= y; yr++) {
      const rateOv = pf.yearOverrides?.[yr]?.otherIncomeGrowthPct;
      if (rateOv !== undefined) growth = rateOv;
      value = value * (1 + growth / 100);
    }
    return value;
  });
  const vacancyPctYr = years.map((y) => {
    const ov = pf.yearOverrides?.[y]?.vacancyPct;
    return ov !== undefined ? ov : pf.vacancyPct.stabilized;
  });
  const creditLossPctYr = years.map((y) => {
    const ov = pf.yearOverrides?.[y]?.creditLossPct;
    return ov !== undefined ? ov : pf.creditLossPct.stabilized;
  });
  const vacancyYr = marketRentYr.map((mr, i) => mr * (vacancyPctYr[i] / 100));
  const creditLossYr = marketRentYr.map((mr, i) => mr * (creditLossPctYr[i] / 100));

  const rows: ProFormaMatrixRow[] = [
    { label: 'Market Rent (GPR)', t12: marketRentT12, years: marketRentYr },
    { label: 'Loss to Lease', t12: -(pf.lossToLeaseT12 ?? 0), years: lossToLeaseYr.map((v) => -v) },
    { label: 'Gross Rent', t12: grossRentT12, years: grossRentYr, isBold: true },
    { label: 'Vacancy', t12: -vacancyT12, years: vacancyYr.map((v) => -v) },
    { label: 'Credit Loss', t12: -creditLossT12, years: creditLossYr.map((v) => -v) },
    { label: 'Other Income', t12: otherIncomeT12, years: otherIncomeYr },
    { label: 'Effective Gross Income (EGI)', t12: egiT12, years: egiYr, isBold: true },
    { label: 'Operating Expenses', t12: 0, years: [], isHeader: true },
  ];

  // Individual expense rows
  pf.expenses.forEach((e) => {
    const t12Val = e.isPercentOfEGI ? egiT12 * (e.t12Value / 100) : e.t12Value * 12;
    const yearsVals = years.map((y) => {
      const egi = egiYr[years.indexOf(y)];
      if (e.isPercentOfEGI) {
        let pct = e.stabilizedValue;
        for (let yr = 1; yr <= y; yr++) {
          const ov = pf.yearOverrides?.[yr]?.expenses?.[e.id];
          if (ov !== undefined) pct = ov;
        }
        return egi * (pct / 100);
      }
      const ov = pf.yearOverrides?.[y]?.expenses?.[e.id];
      if (ov !== undefined) return ov;
      // Chained annual $ with growth
      let value = e.stabilizedValue * 12; // monthly $ → annual for stabilized
      let growth = e.growthPct;
      for (let yr = 2; yr <= y; yr++) {
        value = value * (1 + growth / 100);
      }
      return value;
    });
    rows.push({
      label: e.isPercentOfEGI ? `${e.name} (${e.stabilizedValue}% EGI)` : e.name,
      t12: -t12Val,
      years: yearsVals.map((v) => -v),
    });
  });

  rows.push(
    { label: 'Total Operating Expenses', t12: -opexT12, years: opexYr.map((v) => -v), isBold: true },
    { label: 'Net Operating Income (NOI)', t12: egiT12 - opexT12, years: noiYr, isBold: true, isPositive: true },
  );

  return rows;
}
