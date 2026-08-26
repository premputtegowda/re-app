import type { CoCAcquisition, ProFormaData } from '@/types';
import { makeProFormaProjector } from './proFormaYearCalc';
import { bulkSyncAiOpexToProForma } from './proFormaToAssumptions';

/**
 * Compute the 3-value stabilized breakdown for a single opex line item — the
 * same shape shown on the Assumptions page: Annual $, $/unit/yr, $/unit/mo.
 *
 * Uses the projector's Yr-1 per-strategy EGI as the % base, so % expenses
 * (PM / R&M) match the pro-forma grid's Yr-1 value exactly (both apply
 * vacancy + credit loss + LTL).
 */
export function computeOpexBreakdown(
  expenseName: string,
  stabilizedValue: number,
  isPercentOfEGI: boolean,
  acquisition: CoCAcquisition,
  pf: ProFormaData,
): { annual: number; perUnitYr: number; perUnitMo: number; denominatorUnits: number } {
  const strategy: 'ltr' | 'mtr' | null =
    /\(ltr\)/i.test(expenseName) ? 'ltr'
    : /\(mtr\)/i.test(expenseName) || /\bmtr\b/i.test(expenseName) ? 'mtr'
    : null;

  const totalUnits = acquisition.propertyType === 'mfr' && acquisition.unitMix?.length
    ? acquisition.unitMix.reduce((s, u) => s + u.count, 0)
    : 1;
  const ltrUnits = acquisition.propertyType === 'mfr' && acquisition.unitMix?.length
    ? acquisition.unitMix.filter((u) => (u.rentalType ?? 'LTR') === 'LTR').reduce((s, u) => s + u.count, 0)
    : ((acquisition.sfrRentalType ?? 'LTR') === 'LTR' ? 1 : 0);
  const mtrUnits = acquisition.propertyType === 'mfr' && acquisition.unitMix?.length
    ? acquisition.unitMix.filter((u) => u.rentalType === 'MTR' || u.rentalType === 'STR').reduce((s, u) => s + u.count, 0)
    : ((acquisition.sfrRentalType === 'MTR' || acquisition.sfrRentalType === 'STR') ? 1 : 0);

  const denominatorUnits = strategy === 'ltr' ? Math.max(1, ltrUnits)
                         : strategy === 'mtr' ? Math.max(1, mtrUnits)
                         : Math.max(1, totalUnits);

  // Use projector's Yr 1 per-strategy EGI as the % base — matches the pro-forma
  // grid Yr 1 column exactly (both apply vacancy + credit loss + LTL).
  const projector = makeProFormaProjector(pf);
  const inc = projector.getIncomeByStrategy(1);
  const egiBase = strategy === 'ltr' ? inc.ltr.egi
                : strategy === 'mtr' ? inc.mtr.egi
                : inc.totalEgi;

  const annual = isPercentOfEGI ? egiBase * (stabilizedValue / 100) : stabilizedValue;
  const perUnitYr = annual / denominatorUnits;
  const perUnitMo = perUnitYr / 12;

  return { annual, perUnitYr, perUnitMo, denominatorUnits };
}

/**
 * Pick the strategy-appropriate vacancy / credit-loss % for flat displays
 * (Other Rent Assumptions block, PDF Vacancy & Collections). When the deal is
 * MTR-only we must NOT show the raw `pf.vacancyPct.stabilized` (which is the
 * LTR field and typically defaults to 5%) — the actual applied % is
 * `pf.vacancyMtrPct.stabilized` (or the 20% MTR fallback).
 */
export function getDisplayVacancyCredit(pf: ProFormaData): {
  vacancyPct: number;
  creditLossPct: number;
  soleStrategy: 'ltr' | 'mtr' | null;
} {
  const strategies = pf.strategyByType ?? [];
  const hasStrategyInfo = strategies.length > 0;
  const hasLtr = hasStrategyInfo ? strategies.some((s) => !s || s === 'LTR') : true;
  const hasMtr = hasStrategyInfo ? strategies.some((s) => s === 'MTR' || s === 'STR') : false;
  const soleStrategy: 'ltr' | 'mtr' | null =
    !hasStrategyInfo ? null
    : hasLtr && !hasMtr ? 'ltr'
    : !hasLtr && hasMtr ? 'mtr'
    : null;
  const vacancyPct = soleStrategy === 'mtr'
    ? (pf.vacancyMtrPct?.stabilized ?? 20)
    : pf.vacancyPct.stabilized;
  const creditLossPct = soleStrategy === 'mtr'
    ? (pf.creditLossMtrPct?.stabilized ?? 2)
    : pf.creditLossPct.stabilized;
  return { vacancyPct, creditLossPct, soleStrategy };
}

/**
 * Normalize a persisted ProFormaData for display / PDF rendering. Handles two
 * gaps that show up on older deals:
 *
 *   1. `strategyByType` missing — derive from `acquisition.unitMix[i].rentalType`
 *      so the split-by-strategy pro-forma grid renders instead of the flat
 *      fallback.
 *
 *   2. `aiAssumptions` present but not fully synced into `pf.expenses[]` —
 *      overwrite from AI so every AI-populated opex category is visible and
 *      any legacy monthly-scaled `stabilizedValue` is re-normalized to annual.
 *      Preserves user edits (they get persisted to aiAssumptions and flow back).
 */
export function enrichProFormaForDisplay(
  pf: ProFormaData,
  acquisition: CoCAcquisition,
  aiAssumptions?: Record<string, unknown> | null,
  expenseGrowthPct = 2,
  insuranceGrowthPct = 5,
): ProFormaData {
  let next = pf;

  // 1) Derive strategyByType from unit mix if missing.
  if ((!pf.strategyByType || pf.strategyByType.length === 0) && acquisition.propertyType === 'mfr' && acquisition.unitMix?.length) {
    next = { ...next, strategyByType: acquisition.unitMix.map((u) => u.rentalType ?? 'LTR') };
  } else if ((!pf.strategyByType || pf.strategyByType.length === 0) && acquisition.propertyType === 'sfr') {
    next = { ...next, strategyByType: [acquisition.sfrRentalType ?? 'LTR'] };
  }

  // 1b) Vacancy / credit-loss defaults. The app's Vacancy & Collections
  // section shows 5% / 2% via useState fallback when the persisted value is
  // zero, but that display default was never seeded into pf itself — so the
  // projector was calculating with 0%. Normalize here so PDF/agent view and
  // NOI both reflect the underwriting default the user sees on screen. New
  // deals get seeded at the parent (DealAnalyzerForm effect); this handles
  // legacy deals persisted before that seed was added.
  if ((next.vacancyPct?.stabilized ?? 0) === 0) {
    next = { ...next, vacancyPct: { ...next.vacancyPct, stabilized: 5 } };
  }
  if ((next.creditLossPct?.stabilized ?? 0) === 0) {
    next = { ...next, creditLossPct: { ...next.creditLossPct, stabilized: 2 } };
  }

  // 2) Overwrite pf.expenses from AI so every AI-populated category is present
  //    and legacy monthly-scale values get re-normalized to annual.
  if (aiAssumptions) {
    // Per-strategy EGI from AI market rents (mirrors StepAssumptions helper).
    const rentBlock = (aiAssumptions.market_rent_estimation ?? {}) as Record<string, unknown>;
    const byUnitType = ((rentBlock.by_unit_type as unknown[]) ?? []) as Array<{
      count?: number;
      estimated_in_place_rent_monthly?: number | null;
      estimated_market_rent_monthly?: number | null;
    }>;
    const rentalTypes = acquisition.propertyType === 'mfr' && acquisition.unitMix?.length
      ? acquisition.unitMix.map((u) => u.rentalType ?? 'LTR')
      : [acquisition.sfrRentalType ?? 'LTR'];
    let ltrEgi = 0, mtrEgi = 0;
    byUnitType.forEach((entry, i) => {
      const monthly = entry.estimated_in_place_rent_monthly ?? entry.estimated_market_rent_monthly ?? 0;
      const annual = (monthly || 0) * (entry.count || 0) * 12;
      const t = rentalTypes[i] ?? 'LTR';
      if (t === 'MTR' || t === 'STR') mtrEgi += annual;
      else ltrEgi += annual;
    });
    next = bulkSyncAiOpexToProForma(
      next, aiAssumptions, next.grossRent.stabilized,
      expenseGrowthPct, insuranceGrowthPct, ltrEgi, mtrEgi, 'overwrite',
    );
  }

  return next;
}

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
 *
 * When the deal has both LTR and MTR/STR units (strategyByType populated), the
 * income section is split — LTR Market Rent → LTR EGI, then MTR Market Rent →
 * MTR EGI, then Other Income + Total EGI. Same for expenses (Common / LTR /
 * MTR subsections with subtotals). Single-strategy deals keep the flat layout.
 */
export function buildProFormaMatrix(pf: ProFormaData, projectionYears: number): ProFormaMatrixRow[] {
  const projector = makeProFormaProjector(pf);
  const years = Array.from({ length: projectionYears }, (_, i) => i + 1);

  // Per-year strategy income breakdowns
  const incomeYr = years.map((y) => projector.getIncomeByStrategy(y));
  const splitByStrategy = incomeYr[0]?.hasStrategyInfo && incomeYr[0]?.hasLtr && incomeYr[0]?.hasMtr;
  // Single active strategy (used for flat-layout vacancy/CL selection + label
  // simplification). Derived directly from `pf.strategyByType` — NOT from the
  // projector's `hasStrategyInfo`, which also requires `leaseAnniversaryByType`
  // to be populated. An MTR-only deal missing `leaseAnniversaryByType` would
  // otherwise fall through to LTR defaults (5% vacancy) instead of MTR (20%).
  const stratField = pf.strategyByType ?? [];
  const hasStratInfoFlat = stratField.length > 0;
  const flatHasLtr = hasStratInfoFlat ? stratField.some((s) => !s || s === 'LTR') : true;
  const flatHasMtr = hasStratInfoFlat ? stratField.some((s) => s === 'MTR' || s === 'STR') : false;
  const soleStrategy: 'ltr' | 'mtr' | null =
    !hasStratInfoFlat ? null
    : flatHasLtr && !flatHasMtr ? 'ltr'
    : !flatHasLtr && flatHasMtr ? 'mtr'
    : null;

  const grossRentT12 = pf.grossRent.t12;
  const marketRentT12 = grossRentT12 + (pf.lossToLeaseT12 ?? 0);
  const otherIncomeT12 = pf.otherIncome.t12;
  const vacancyPctT12 = pf.vacancyPct.t12;
  const creditLossPctT12 = pf.creditLossPct.t12;

  // T12 vacancy/credit loss in dollars — % of market rent
  const vacancyT12 = marketRentT12 * (vacancyPctT12 / 100);
  const creditLossT12 = marketRentT12 * (creditLossPctT12 / 100);

  // ── Per-year values for the flat single-strategy layout ─────────────────
  const marketRentYr = years.map((y) => projector.getMarketRentForYear(y));
  const grossRentYr = years.map((y) => projector.getGrossRentForYear(y));
  const lossToLeaseYr = years.map((_, i) => marketRentYr[i] - grossRentYr[i]);
  const otherIncomeYr = incomeYr.map((s) => s.otherIncome);
  // Vacancy + credit loss % follow the sole active strategy — critical for
  // MTR-only deals where LTR vacancy (5%) would be wrong; we need MTR
  // vacancy (20%) instead. Falls back to LTR when strategy info absent.
  const vacancyPctYr = incomeYr.map((s) => soleStrategy === 'mtr' ? s.mtr.vacancyPct : s.ltr.vacancyPct);
  const creditLossPctYr = incomeYr.map((s) => soleStrategy === 'mtr' ? s.mtr.creditLossPct : s.ltr.creditLossPct);
  const vacancyYr = marketRentYr.map((mr, i) => mr * (vacancyPctYr[i] / 100));
  const creditLossYr = marketRentYr.map((mr, i) => mr * (creditLossPctYr[i] / 100));

  // Flat-layout vacancy/CL T-12 amounts must also use the correct % (same
  // reasoning as above — for MTR-only, we want MTR rates).
  const flatVacancyT12 = soleStrategy === 'mtr'
    ? marketRentT12 * ((pf.vacancyMtrPct?.stabilized ?? 20) / 100)
    : vacancyT12;
  const flatCreditLossT12 = soleStrategy === 'mtr'
    ? marketRentT12 * ((pf.creditLossMtrPct?.stabilized ?? 2) / 100)
    : creditLossT12;
  const flatVacancyPct = soleStrategy === 'mtr' ? (pf.vacancyMtrPct?.stabilized ?? 20) : pf.vacancyPct.stabilized;

  // EGI — for split-by-strategy view the projector's ltrEgi + mtrEgi + other
  // is authoritative. For the flat single-strategy layout we recompute from
  // the displayed vacancy/credit-loss rows so the Total EGI row reconciles
  // (Gross − Vacancy − CL + Other). Without this, an MTR-only deal missing
  // `leaseAnniversaryByType` would show "Vacancy (20.0%)" in its row but an
  // EGI computed with the projector's LTR-5% fallback.
  const egiT12 = splitByStrategy
    ? grossRentT12 - vacancyT12 - creditLossT12 + otherIncomeT12
    : grossRentT12 - flatVacancyT12 - flatCreditLossT12 + otherIncomeT12;
  const egiYr = splitByStrategy
    ? incomeYr.map((s) => s.totalEgi)
    : years.map((_, i) => grossRentYr[i] - vacancyYr[i] - creditLossYr[i] + otherIncomeYr[i]);

  // For single-strategy deals, filter pf.expenses so cross-strategy items
  // don't inflate the Total OpEx sum. The projector's getOpExForYear also
  // walks pf.expenses; we compute opex directly here from the visible list
  // instead so the Total row matches what's rendered above it.
  const expensesForTotal = pf.expenses.filter((e) => {
    const strat = projector.strategyForExpenseName(e.name);
    if (strat === null) return true;
    if (splitByStrategy) return true;                     // split: keep all, they're shown in sections
    if (soleStrategy === 'ltr') return strat === 'ltr';
    if (soleStrategy === 'mtr') return strat === 'mtr';
    return true;
  });

  const opexT12 = expensesForTotal.reduce((sum, e) => {
    if (e.isPercentOfEGI) return sum + egiT12 * (e.t12Value / 100);
    // t12Value stored as ANNUAL $ (same convention as stabilizedValue).
    return sum + e.t12Value;
  }, 0);

  const opexYr = years.map((y, i) => {
    const egi = egiYr[i];
    return expensesForTotal.reduce((sum, e) => {
      if (e.isPercentOfEGI) {
        let pct = e.stabilizedValue;
        for (let yr = 1; yr <= y; yr++) {
          const ov = pf.yearOverrides?.[yr]?.expenses?.[e.id];
          if (ov !== undefined) pct = ov;
        }
        // In split view, route %-of-EGI expenses to their per-strategy EGI.
        // In flat view, always use the flat total EGI so %-of-EGI expenses
        // reconcile with the displayed EGI row.
        const strat = projector.strategyForExpenseName(e.name);
        const base = splitByStrategy
          ? (strat === 'ltr' ? incomeYr[i].ltr.egi
             : strat === 'mtr' ? incomeYr[i].mtr.egi
             : egi)
          : egi;
        return sum + base * (pct / 100);
      }
      const ov = pf.yearOverrides?.[y]?.expenses?.[e.id];
      if (ov !== undefined) return sum + ov;
      let value = e.stabilizedValue;
      const growth = e.growthPct;
      for (let yr = 2; yr <= y; yr++) value = value * (1 + growth / 100);
      return sum + value;
    }, 0);
  });
  const noiYr = egiYr.map((egi, i) => egi - opexYr[i]);
  const flatCreditLossPct = soleStrategy === 'mtr' ? (pf.creditLossMtrPct?.stabilized ?? 2) : pf.creditLossPct.stabilized;

  const rows: ProFormaMatrixRow[] = [];

  if (splitByStrategy) {
    // ── LTR section ────────────────────────────────────────────────────
    // Year-1 % values used for label display; per-year $ columns respect overrides.
    const ltrVacPct = incomeYr[0].ltr.vacancyPct;
    const ltrClPct  = incomeYr[0].ltr.creditLossPct;
    const mtrVacPct = incomeYr[0].mtr.vacancyPct;
    const mtrClPct  = incomeYr[0].mtr.creditLossPct;

    // T-12 split — proportional to Year-1 market share (best approximation
    // since we only have blended T-12 values from the source data).
    const ltrShareT12 = marketRentT12 > 0
      ? incomeYr[0].ltr.marketRent / (incomeYr[0].ltr.marketRent + incomeYr[0].mtr.marketRent || 1)
      : 0;
    const mtrShareT12 = 1 - ltrShareT12;

    rows.push(
      { label: 'LTR Income', t12: 0, years: [], isHeader: true },
      { label: 'LTR Market Rent (GPR)', t12: marketRentT12 * ltrShareT12, years: incomeYr.map((s) => s.ltr.marketRent) },
      { label: 'LTR Loss to Lease', t12: -(pf.lossToLeaseT12 ?? 0) * ltrShareT12, years: incomeYr.map((s) => -s.ltr.lossToLease) },
      { label: 'LTR Gross Rent', t12: grossRentT12 * ltrShareT12, years: incomeYr.map((s) => s.ltr.grossRent), isBold: true },
      { label: `LTR Vacancy (${fmtPct(ltrVacPct)})`, t12: -vacancyT12 * ltrShareT12, years: incomeYr.map((s) => -s.ltr.vacancyAmt) },
      { label: `LTR Credit Loss (${fmtPct(ltrClPct)})`, t12: -creditLossT12 * ltrShareT12, years: incomeYr.map((s) => -s.ltr.creditLossAmt) },
      { label: 'LTR EGI', t12: (grossRentT12 - vacancyT12 - creditLossT12) * ltrShareT12, years: incomeYr.map((s) => s.ltr.egi), isBold: true },

      // ── MTR section ─────────────────────────────────────────────────
      { label: 'MTR / STR Income', t12: 0, years: [], isHeader: true },
      { label: 'MTR Market Rent (GPR)', t12: marketRentT12 * mtrShareT12, years: incomeYr.map((s) => s.mtr.marketRent) },
      { label: 'MTR Loss to Lease', t12: -(pf.lossToLeaseT12 ?? 0) * mtrShareT12, years: incomeYr.map((s) => -s.mtr.lossToLease) },
      { label: 'MTR Gross Rent', t12: grossRentT12 * mtrShareT12, years: incomeYr.map((s) => s.mtr.grossRent), isBold: true },
      { label: `MTR Vacancy (${fmtPct(mtrVacPct)})`, t12: -vacancyT12 * mtrShareT12, years: incomeYr.map((s) => -s.mtr.vacancyAmt) },
      { label: `MTR Credit Loss (${fmtPct(mtrClPct)})`, t12: -creditLossT12 * mtrShareT12, years: incomeYr.map((s) => -s.mtr.creditLossAmt) },
      { label: 'MTR EGI', t12: (grossRentT12 - vacancyT12 - creditLossT12) * mtrShareT12, years: incomeYr.map((s) => s.mtr.egi), isBold: true },

      // ── Combined ────────────────────────────────────────────────────
      { label: 'Other Income', t12: otherIncomeT12, years: otherIncomeYr },
      { label: 'Total Effective Gross Income (EGI)', t12: egiT12, years: egiYr, isBold: true },
    );
  } else {
    // Flat single-strategy layout — labels drop the strategy tag (no
    // ambiguity when only one strategy exists) but the vacancy/CL % pick up
    // the correct strategy's rate via flatVacancyPct/flatCreditLossPct.
    rows.push(
      { label: 'Market Rent (GPR)', t12: marketRentT12, years: marketRentYr },
      { label: 'Loss to Lease', t12: -(pf.lossToLeaseT12 ?? 0), years: lossToLeaseYr.map((v) => -v) },
      { label: 'Gross Rent', t12: grossRentT12, years: grossRentYr, isBold: true },
      { label: `Vacancy (${fmtPct(flatVacancyPct)})`, t12: -flatVacancyT12, years: vacancyYr.map((v) => -v) },
      { label: `Credit Loss (${fmtPct(flatCreditLossPct)})`, t12: -flatCreditLossT12, years: creditLossYr.map((v) => -v) },
      { label: 'Other Income', t12: otherIncomeT12, years: otherIncomeYr },
      { label: 'Effective Gross Income (EGI)', t12: egiT12, years: egiYr, isBold: true },
    );
  }

  // ── Operating Expenses ────────────────────────────────────────────────
  rows.push({ label: 'Operating Expenses', t12: 0, years: [], isHeader: true });

  // Group expenses by strategy suffix so the expense side mirrors the income split.
  const commonExp: typeof pf.expenses = [];
  const ltrExp:    typeof pf.expenses = [];
  const mtrExp:    typeof pf.expenses = [];
  pf.expenses.forEach((e) => {
    const strat = projector.strategyForExpenseName(e.name);
    if (strat === 'ltr') ltrExp.push(e);
    else if (strat === 'mtr') mtrExp.push(e);
    else commonExp.push(e);
  });

  // Strip strategy suffix from names when there's no ambiguity (single or
  // no strategy). "Property Management (MTR)" → "Property Management",
  // "Insurance Rider (MTR/STR)" → "Insurance Rider", etc.
  const stripSuffix = (name: string): string =>
    name.replace(/\s*\((LTR|MTR|MTR\/STR|STR)\)\s*$/i, '').trim();

  const renderExpense = (e: (typeof pf.expenses)[number]): ProFormaMatrixRow => {
    // Fixed-$ expenses: t12Value stored as ANNUAL $ (same convention as
    // stabilizedValue). Previously multiplied by 12 assuming monthly — that
    // made AI-synced entries render as 12× too big in the T-12 column.
    const t12Val = e.isPercentOfEGI ? egiT12 * (e.t12Value / 100) : e.t12Value;
    const yearsVals = years.map((y) => {
      const egi = egiYr[years.indexOf(y)];
      if (e.isPercentOfEGI) {
        let pct = e.stabilizedValue;
        for (let yr = 1; yr <= y; yr++) {
          const ov = pf.yearOverrides?.[yr]?.expenses?.[e.id];
          if (ov !== undefined) pct = ov;
        }
        // In split view, route %-of-EGI expenses to their per-strategy EGI.
        // In flat view, always use the flat total EGI — otherwise MTR-only
        // deals missing `leaseAnniversaryByType` (where the projector
        // buckets everything as LTR and mtr.egi = 0) would render each
        // MTR-labeled row as $0 for Yr 1+.
        const strat = projector.strategyForExpenseName(e.name);
        const strategyEgi = incomeYr[years.indexOf(y)];
        const base = splitByStrategy
          ? (strat === 'ltr' ? strategyEgi.ltr.egi
             : strat === 'mtr' ? strategyEgi.mtr.egi
             : egi)
          : egi;
        return base * (pct / 100);
      }
      const ov = pf.yearOverrides?.[y]?.expenses?.[e.id];
      if (ov !== undefined) return ov;
      // Fixed-$ expenses are stored as ANNUAL $
      let value = e.stabilizedValue;
      const growth = e.growthPct;
      for (let yr = 2; yr <= y; yr++) {
        value = value * (1 + growth / 100);
      }
      return value;
    });
    // In split-strategy view, keep suffixes so the reader can tell them apart.
    // Otherwise drop them for a cleaner read.
    const displayName = splitByStrategy ? e.name : stripSuffix(e.name);
    return {
      label: e.isPercentOfEGI ? `${displayName} (${e.stabilizedValue}% EGI)` : displayName,
      t12: -t12Val,
      years: yearsVals.map((v) => -v),
    };
  };

  // Sum helper — rows already carry negative $ values (they're OpEx deductions).
  const sumRows = (r: ProFormaMatrixRow[]): { t12: number; years: number[] } => ({
    t12: r.reduce((s, x) => s + x.t12, 0),
    years: years.map((_, i) => r.reduce((s, x) => s + (x.years[i] ?? 0), 0)),
  });

  if (splitByStrategy) {
    if (commonExp.length > 0) {
      const commonRows = commonExp.map(renderExpense);
      commonRows.forEach((r) => rows.push(r));
      const commonSub = sumRows(commonRows);
      rows.push({ label: 'Subtotal Common Expenses', t12: commonSub.t12, years: commonSub.years, isBold: true });
    }

    if (ltrExp.length > 0) {
      rows.push({ label: 'LTR Expenses', t12: 0, years: [], isHeader: true });
      const ltrRows = ltrExp.map(renderExpense);
      ltrRows.forEach((r) => rows.push(r));
      const ltrSub = sumRows(ltrRows);
      rows.push({ label: 'Subtotal LTR Expenses', t12: ltrSub.t12, years: ltrSub.years, isBold: true });
    }
    if (mtrExp.length > 0) {
      rows.push({ label: 'MTR / STR Expenses', t12: 0, years: [], isHeader: true });
      const mtrRows = mtrExp.map(renderExpense);
      mtrRows.forEach((r) => rows.push(r));
      const mtrSub = sumRows(mtrRows);
      rows.push({ label: 'Subtotal MTR Expenses', t12: mtrSub.t12, years: mtrSub.years, isBold: true });
    }
  } else {
    // Flat single-strategy layout — filter out cross-strategy expenses so an
    // MTR-only deal doesn't show "Marketing (LTR)" and vice versa. Common
    // expenses always render regardless of strategy.
    const filtered = pf.expenses.filter((e) => {
      const strat = projector.strategyForExpenseName(e.name);
      if (strat === null) return true;                    // common — always show
      if (soleStrategy === 'ltr') return strat === 'ltr'; // LTR-only: hide MTR
      if (soleStrategy === 'mtr') return strat === 'mtr'; // MTR-only: hide LTR
      return true;                                        // no strategy info — show all
    });
    filtered.forEach((e) => rows.push(renderExpense(e)));
  }

  rows.push(
    { label: 'Total Operating Expenses', t12: -opexT12, years: opexYr.map((v) => -v), isBold: true },
    { label: 'Net Operating Income (NOI)', t12: egiT12 - opexT12, years: noiYr, isBold: true, isPositive: true },
  );

  return rows;
}

function fmtPct(v: number): string {
  return `${(Math.round(v * 10) / 10).toFixed(1)}%`;
}
