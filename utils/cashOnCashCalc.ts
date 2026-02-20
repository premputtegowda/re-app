import type { CoCScenario, CoCResult, CoCYearlyProjection } from '@/types';

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

export function calculateIRR(cashFlows: number[]): number | null {
  const maxIterations = 1000;
  const tolerance = 1e-7;
  let rate = 0.1;

  for (let i = 0; i < maxIterations; i++) {
    const npv = calculateNPV(rate, cashFlows);
    const dnpv = cashFlows.reduce(
      (sum, cf, t) => sum - (t * cf) / Math.pow(1 + rate, t + 1),
      0
    );

    if (Math.abs(dnpv) < 1e-10) return null;

    const newRate = rate - npv / dnpv;

    if (Math.abs(newRate - rate) < tolerance) {
      return newRate > -1 ? newRate : null;
    }

    rate = newRate;
  }

  return null;
}

export function projectScenario(scenario: CoCScenario): CoCResult {
  const { acquisition, operations, refinance } = scenario;

  const downPayment = acquisition.purchasePrice * (acquisition.downPaymentPct / 100);
  const closingCosts = acquisition.purchasePrice * (acquisition.closingCostsPct / 100);
  const initialLoanAmount = acquisition.purchasePrice * (1 - acquisition.downPaymentPct / 100);
  const pointsCost = (acquisition.points / 100) * initialLoanAmount;
  const hardCosts = acquisition.hardCostItems.reduce((sum, item) => sum + item.amount, 0);
  const softCosts = acquisition.softCostItems.reduce((sum, item) => sum + item.amount, 0);

  // Equity deployed upfront before the property generates income
  const equityDeployed = downPayment + closingCosts + pointsCost + hardCosts + softCosts;

  // Lost opportunity cost: explicit line items (lost rent, utilities, insurance, taxes, etc.)
  const lostOpportunityCost = acquisition.opportunityCostItems.reduce(
    (sum, item) => sum + item.amount,
    0
  );

  const totalInvested = equityDeployed + lostOpportunityCost;

  // Unit mix overrides individual units + grossRentMonthly when populated
  const hasUnitMix = acquisition.unitMix.length > 0;
  const effectiveUnits = hasUnitMix
    ? acquisition.unitMix.reduce((sum, e) => sum + e.count, 0)
    : acquisition.units;
  const baseMonthlyRent = hasUnitMix
    ? acquisition.unitMix.reduce((sum, e) => sum + e.count * e.rentMonthly, 0)
    : operations.grossRentMonthly * acquisition.units;

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

  for (let year = 1; year <= acquisition.projectionYears; year++) {
    const grossRent =
      baseMonthlyRent * 12 * Math.pow(1 + operations.annualRentGrowthPct / 100, year - 1);

    const effectiveRent = grossRent * (1 - operations.vacancyRatePct / 100);
    const opex = effectiveRent * ((operations.opexPct + operations.propertyMgmtPct) / 100);
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
      const newLoanAmount = acquisition.arv * (refinance.newLTV / 100);
      cashOutProceeds = Math.max(0, newLoanAmount - loanBalance);

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
  const irrCashFlows = [
    -totalInvested,
    ...yearlyProjections.map((p, i) =>
      i === yearlyProjections.length - 1
        ? p.cashFlow + p.equityValue
        : p.cashFlow
    ),
  ];

  const irrDecimal = calculateIRR(irrCashFlows);
  const irr = irrDecimal !== null ? irrDecimal * 100 : null;

  const equityMultiple =
    totalInvested > 0
      ? (totalCashFlow + finalProjection.equityValue) / totalInvested
      : 0;

  const avgCoCReturn =
    yearlyProjections.reduce((sum, p) => sum + p.coCReturn, 0) / yearlyProjections.length;

  const peakCoCReturn = Math.max(...yearlyProjections.map((p) => p.coCReturn));

  return {
    downPayment,
    closingCosts,
    pointsCost,
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
  };
}

export function formatCurrency(n: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n);
}

export function formatPct(n: number, decimals = 1): string {
  return `${n.toFixed(decimals)}%`;
}

export function formatMultiple(n: number): string {
  return `${n.toFixed(2)}x`;
}
