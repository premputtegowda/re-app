import type { CoCScenario, CoCResult, CoCYearlyProjection } from '@/types';

/**
 * Effective Gross Income (EGI).
 * Vacancy & credit loss apply to gross rent only; other income passes through in full.
 */
export function computeEGI(
  grossRent: number,
  otherIncome: number,
  vacancyPct: number,
  creditLossPct: number
): number {
  return grossRent * (1 - (vacancyPct + creditLossPct) / 100) + otherIncome;
}

export function calculateMonthlyPayment(
  principal: number,
  annualRatePct: number,
  termMonths: number
): number {
  if (annualRatePct === 0) return principal / termMonths;
  const r = annualRatePct / 100 / 12;
  return (principal * r) / (1 - Math.pow(1 + r, -termMonths));
}

export function calculateIOPayment(principal: number, annualRatePct: number): number {
  return principal * (annualRatePct / 100 / 12);
}

export function calculateLoanBalance(
  principal: number,
  annualRatePct: number,
  termMonths: number,
  paymentsMade: number
): number {
  if (annualRatePct === 0) {
    return Math.max(0, principal - (principal / termMonths) * paymentsMade);
  }
  const r = annualRatePct / 100 / 12;
  const payment = calculateMonthlyPayment(principal, annualRatePct, termMonths);
  return principal * Math.pow(1 + r, paymentsMade) - payment * ((Math.pow(1 + r, paymentsMade) - 1) / r);
}

export function calculateNPV(rate: number, cashFlows: number[]): number {
  return cashFlows.reduce((npv, cf, i) => npv + cf / Math.pow(1 + rate, i), 0);
}

function newtonRaphson(cashFlows: number[], initialRate: number): number | null {
  const maxIterations = 200;
  const tolerance = 1e-8;
  let rate = initialRate;

  for (let i = 0; i < maxIterations; i++) {
    const npv = calculateNPV(rate, cashFlows);
    const dnpv = cashFlows.reduce(
      (sum, cf, t) => sum - (t * cf) / Math.pow(1 + rate, t + 1),
      0
    );
    if (Math.abs(dnpv) < 1e-12) break;
    const newRate = rate - npv / dnpv;
    if (newRate <= -1) break;
    if (Math.abs(newRate - rate) < tolerance) {
      // Verify NPV is actually ≈ 0 (not just rate-change stagnation / false convergence)
      const scale = Math.max(1, Math.abs(cashFlows[0]));
      if (Math.abs(calculateNPV(newRate, cashFlows)) / scale < 1e-6) return newRate;
      return null; // false convergence — let bisection handle it
    }
    rate = newRate;
  }
  return null;
}

function bisectionIRR(cashFlows: number[]): number | null {
  const tolerance = 1e-8;
  const maxIterations = 200;

  // Scan upward from ~0% to find the FIRST (smallest) positive root.
  // When multiple IRRs exist this returns the economically meaningful one.
  let lo = 0.0001;
  let hi: number | null = null;
  const npvLo = calculateNPV(lo, cashFlows);

  for (let h = 0.005; h <= 20; h += 0.005) {
    if (npvLo * calculateNPV(h, cashFlows) <= 0) { hi = h; break; }
  }

  // No positive root found — try negative rates (loss-making scenario)
  if (hi === null) {
    lo = -0.99;
    const npvNeg = calculateNPV(lo, cashFlows);
    for (let h = -0.98; h <= 0; h += 0.005) {
      if (npvNeg * calculateNPV(h, cashFlows) <= 0) { hi = h; break; }
    }
    if (hi === null) return null;
  }

  let hi2 = hi; // hi is non-null past this point
  for (let i = 0; i < maxIterations; i++) {
    const mid: number = (lo + hi2) / 2;
    const npvMid = calculateNPV(mid, cashFlows);
    if (Math.abs(npvMid) < tolerance || (hi2 - lo) < tolerance) return mid;
    if (calculateNPV(lo, cashFlows) * npvMid < 0) hi2 = mid; else lo = mid;
  }
  return null;
}

export function calculateIRR(cashFlows: number[]): number | null {
  // Must have at least one sign change to have a real IRR
  const hasNeg = cashFlows.some(cf => cf < 0);
  const hasPos = cashFlows.some(cf => cf > 0);
  if (!hasNeg || !hasPos) return null;

  // Bisection is primary: scans from 0% upward, always returns the smallest
  // positive root (economically meaningful when multiple IRRs exist).
  const bisResult = bisectionIRR(cashFlows);
  if (bisResult !== null) return bisResult;

  // Fallback: Newton-Raphson (faster but can land on wrong root)
  for (const guess of [0.1, 0.25, 0.5, 0.01, -0.05]) {
    const r = newtonRaphson(cashFlows, guess);
    if (r !== null && r > -1) return r;
  }
  return null;
}

export function projectScenario(scenario: CoCScenario): CoCResult {
  const { acquisition, operations, refinance } = scenario;
  const pf = scenario.proForma;

  const downPayment = acquisition.purchasePrice * (acquisition.downPaymentPct / 100);
  const closingCosts = acquisition.purchasePrice * (acquisition.closingCostsPct / 100);
  const initialLoanAmount = acquisition.purchasePrice * (1 - acquisition.downPaymentPct / 100);
  const pointsCost = (acquisition.points / 100) * initialLoanAmount;
  const additionalFees = (acquisition.additionalFeeItems ?? []).reduce((sum, item) => sum + item.amount, 0);
  const hardCosts = acquisition.hardCostItems.reduce((sum, item) => sum + item.amount, 0);
  const softCosts = acquisition.softCostItems.reduce((sum, item) => sum + item.amount, 0);

  // Equity deployed upfront before the property generates income
  const equityDeployed = downPayment + closingCosts + pointsCost + additionalFees + hardCosts + softCosts;

  // Lost opportunity cost: explicit line items (lost rent, utilities, insurance, taxes, etc.)
  const lostOpportunityCost = acquisition.opportunityCostItems.reduce(
    (sum, item) => sum + item.amount,
    0
  );

  const totalInvested = equityDeployed + lostOpportunityCost;

  const hasUnitMix = acquisition.unitMix.length > 0;
  // effectiveUnits retained for potential future use
  const _effectiveUnits = hasUnitMix
    ? acquisition.unitMix.reduce((sum, e) => sum + e.count, 0)
    : acquisition.units;

  // If proForma data exists, derive base rent from it; otherwise fall back to operations
  const baseMonthlyRent = pf ? pf.grossRent.stabilized : operations.grossRentMonthly;

  const ioPeriodYears = Math.floor(acquisition.ioPeriodMonths / 12);
  const loanTermMonths = acquisition.loanTermYears * 12;
  const amortTermMonths = loanTermMonths - acquisition.ioPeriodMonths;

  let monthlyPayment = calculateMonthlyPayment(
    initialLoanAmount,
    acquisition.interestRate,
    amortTermMonths > 0 ? amortTermMonths : loanTermMonths
  );
  const ioMonthlyPayment = calculateIOPayment(initialLoanAmount, acquisition.interestRate);

  let currentLoanAmount = initialLoanAmount;
  let currentInterestRate = acquisition.interestRate;
  let currentLoanTermMonths = amortTermMonths > 0 ? amortTermMonths : loanTermMonths;
  let refiHappened = false;
  let paymentsMadeBeforeRefi = 0;

  const yearlyProjections: CoCYearlyProjection[] = [];
  let cumulativeCashFlow = 0;

  // Per-year chaining — track previous values and last-set growth rates
  let prevRentValue: number | undefined;
  let prevOtherValue: number | undefined;
  const prevExpenseValues: Record<string, number> = {};
  let lastRentGrowthPct = pf ? pf.grossRent.growthPct : 0;
  let lastOtherGrowthPct = pf ? pf.otherIncome.growthPct : 0;
  const lastExpenseGrowthPcts: Record<string, number> = {};
  const lastExpensePcts: Record<string, number> = {}; // for isPercentOfEGI cascading

  for (let year = 1; year <= (acquisition.projectionYears || 5); year++) {
    let grossRent: number;   // rent-only (matches ProFormaGrid "Gross Rent" row)
    let effectiveRent: number; // EGI = rent*(1-vac%) + otherIncome
    let opex: number;

    if (pf) {
      const override = pf.yearOverrides?.[year];

      // ── Income: Year 1 = stabilized base; Year 2+ chains from previous year ──
      let yearRent: number;
      let yearOther: number;

      if (override?.grossRentGrowthPct !== undefined) lastRentGrowthPct = override.grossRentGrowthPct;
      if (override?.otherIncomeGrowthPct !== undefined) lastOtherGrowthPct = override.otherIncomeGrowthPct;

      if (override?.grossRent !== undefined) {
        yearRent = override.grossRent;
      } else if (year === 1) {
        yearRent = pf.grossRent.stabilized;
      } else {
        yearRent = (prevRentValue ?? pf.grossRent.stabilized) * (1 + lastRentGrowthPct / 100);
      }

      if (override?.otherIncome !== undefined) {
        yearOther = override.otherIncome;
      } else if (year === 1) {
        yearOther = pf.otherIncome.stabilized;
      } else {
        yearOther = (prevOtherValue ?? pf.otherIncome.stabilized) * (1 + lastOtherGrowthPct / 100);
      }

      // grossRent stored as rent-only so Results "Gross Rent" matches ProFormaGrid row
      grossRent = yearRent;

      prevRentValue  = yearRent;
      prevOtherValue = yearOther;

      const vacPct = override?.vacancyPct    ?? pf.vacancyPct.stabilized;
      const clPct  = override?.creditLossPct ?? (pf.creditLossPct?.stabilized ?? 0);
      effectiveRent = computeEGI(yearRent, yearOther, vacPct, clPct);

      // ── Expenses: Year 1 = stabilized base; Year 2+ chains ──
      opex = pf.expenses.reduce((sum, e) => {
        const expOverride = override?.expenses?.[e.id];
        // Cascade growth rate: update last known rate if overridden this year
        if (override?.expenseGrowthPcts?.[e.id] !== undefined)
          lastExpenseGrowthPcts[e.id] = override.expenseGrowthPcts[e.id];
        const expGrowthRate = lastExpenseGrowthPcts[e.id] ?? e.growthPct;

        let annualVal: number;
        if (expOverride !== undefined) {
          annualVal = e.isPercentOfEGI ? effectiveRent * (expOverride / 100) : expOverride;
          if (e.isPercentOfEGI) lastExpensePcts[e.id] = expOverride; // cascade % forward
        } else if (e.isPercentOfEGI) {
          const pct = lastExpensePcts[e.id] ?? e.stabilizedValue;
          annualVal = effectiveRent * (pct / 100);
        } else if (year === 1) {
          annualVal = e.stabilizedValue;
        } else {
          annualVal = (prevExpenseValues[e.id] ?? e.stabilizedValue) * (1 + expGrowthRate / 100);
        }

        prevExpenseValues[e.id] = annualVal;
        return sum + annualVal;
      }, 0);
    } else {
      // Legacy: Year 1 = target rent as-is; Year 2+ = previous year × current growth rate
      if (year === 1) {
        grossRent = baseMonthlyRent * 12;
      } else {
        grossRent = (prevRentValue ?? baseMonthlyRent * 12) * (1 + operations.annualRentGrowthPct / 100);
      }
      prevRentValue = grossRent;
      effectiveRent = grossRent * (1 - operations.vacancyRatePct / 100);
      opex = effectiveRent * ((operations.opexPct + operations.propertyMgmtPct) / 100);
    }

    const noi = effectiveRent - opex;

    let debtService: number;
    let loanBalance: number;

    if (year <= ioPeriodYears) {
      debtService = ioMonthlyPayment * 12;
      loanBalance = currentLoanAmount;
    } else {
      debtService = monthlyPayment * 12;
      const amortPaymentsMade = (year - ioPeriodYears) * 12 - paymentsMadeBeforeRefi;
      loanBalance = Math.max(
        0,
        calculateLoanBalance(
          currentLoanAmount,
          currentInterestRate,
          currentLoanTermMonths,
          amortPaymentsMade
        )
      );
    }

    let cashOutProceeds = 0;
    if (refinance.enabled && year === refinance.refiYear && !refiHappened) {
      const newLoanAmount = (refinance.refiMarketValue || acquisition.arv) * (refinance.newLTV / 100);
      const refiCosts = newLoanAmount * ((refinance.refiCostPct ?? 0) / 100);
      cashOutProceeds = Math.max(0, newLoanAmount - loanBalance - refiCosts);

      currentLoanAmount = newLoanAmount;
      currentInterestRate = refinance.newInterestRate;
      currentLoanTermMonths = refinance.newLoanTermYears * 12;
      monthlyPayment = calculateMonthlyPayment(
        newLoanAmount,
        refinance.newInterestRate,
        currentLoanTermMonths
      );
      paymentsMadeBeforeRefi = 0;
      refiHappened = true;

      loanBalance = newLoanAmount;
    }

    const cashFlow = noi - debtService + cashOutProceeds;
    const coCReturn = totalInvested > 0 ? (cashFlow / totalInvested) * 100 : 0;
    const equityValue = acquisition.arv - loanBalance;
    cumulativeCashFlow += cashFlow;

    yearlyProjections.push({
      year,
      grossRent,
      effectiveRent,
      opex,
      noi,
      debtService,
      cashOutProceeds,
      cashFlow,
      coCReturn,
      loanBalance,
      equityValue,
      cumulativeCashFlow,
    });
  }

  const finalProjection = yearlyProjections[yearlyProjections.length - 1];
  const totalCashFlow = yearlyProjections.reduce((sum, p) => sum + p.cashFlow, 0);

  // Terminal value: driven by exitMethod (capRate = NOI-based, arv/marketValue = direct value)
  const exitMethod = acquisition.exitMethod ?? 'value';
  const terminalPropertyValue =
    exitMethod === 'capRate' && acquisition.exitCapRate > 0
      ? finalProjection.noi / (acquisition.exitCapRate / 100)
      : acquisition.arv;
  const exitClosingCostPct = acquisition.exitClosingCostPct ?? 3;
  const exitClosingCosts = terminalPropertyValue * (exitClosingCostPct / 100);
  const terminalEquity = Math.max(0, terminalPropertyValue - finalProjection.loanBalance - exitClosingCosts);

  const irrCashFlows = [
    -totalInvested,
    ...yearlyProjections.map((p, i) =>
      i === yearlyProjections.length - 1
        ? p.cashFlow + terminalEquity
        : p.cashFlow
    ),
  ];

  const irrDecimal = calculateIRR(irrCashFlows);
  const irr = irrDecimal !== null ? irrDecimal * 100 : null;

  // Total proceeds (cash flows + terminal equity) / total invested
  // Uses the same irrCashFlows series for consistency with IRR
  const totalProceeds = irrCashFlows.slice(1).reduce((sum, cf) => sum + cf, 0);
  const equityMultiple = totalInvested > 0 ? totalProceeds / totalInvested : 0;

  const avgCoCReturn =
    yearlyProjections.reduce((sum, p) => sum + p.coCReturn, 0) / yearlyProjections.length;

  const peakCoCReturn = Math.max(...yearlyProjections.map((p) => p.coCReturn));

  return {
    downPayment,
    closingCosts,
    pointsCost,
    additionalFeeItems: acquisition.additionalFeeItems ?? [],
    additionalFees,
    hardCostItems: acquisition.hardCostItems,
    hardCosts,
    softCostItems: acquisition.softCostItems,
    softCosts,
    opportunityCostItems: acquisition.opportunityCostItems,
    lostOpportunityCost,
    totalInvested,
    initialLoanAmount,
    yearlyProjections,
    irr,
    equityMultiple,
    avgCoCReturn,
    peakCoCReturn,
    totalCashFlow,
    terminalPropertyValue,
    exitClosingCosts,
    terminalEquity,
    irrCashFlows,
  };
}

export function formatCurrency(n: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n);
}

/** Compact: $1.2M, $450K, $950 — for tight card layouts */
export function formatCurrencyCompact(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (Math.abs(n) >= 1_000)     return `$${(n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 0)}K`;
  return `$${Math.round(n)}`;
}

export function formatPct(n: number, decimals = 2): string {
  return `${n.toFixed(decimals)}%`;
}

export function formatMultiple(n: number): string {
  return `${n.toFixed(2)}x`;
}
