/**
 * Tests for WhatIfPanel Goal Seek mode
 *
 * - "Explore" and "Goal Seek" toggle buttons are rendered
 * - Default mode is "Explore"
 * - Switching to Goal Seek shows the banner (target input + progress bar)
 * - Break-even table is visible in Explore mode
 * - Break-even table is hidden in Goal Seek mode
 * - Goal Seek banner updates live — shows "Target met!" when current return >= target
 * - GoalMetric toggle switches between IRR and CoC
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WhatIfPanel } from '@/components/DealAnalyzer/WhatIfPanel';
import { projectScenario } from '@/utils/dealAnalyzerCalc';
import type { CoCAcquisition, CoCOperations, CoCRefinance, CoCResult, ProFormaData, CoCScenario } from '@/types';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeAcquisition(): CoCAcquisition {
  return {
    propertyAddress: '123 Main St',
    propertyType: 'sfr',
    units: 1,
    sfrBeds: 3, sfrBaths: 2,
    sfrInPlaceRent: 0, sfrPreStabRent: 1_800, sfrTargetRent: 2_000,
    unitMix: [],
    purchasePrice: 200_000,
    arv: 240_000,
    downPaymentPct: 20,
    closingCostsPct: 2,
    points: 0,
    additionalFeeItems: [],
    hardCostItems: [],
    softCostItems: [],
    opportunityCostItems: [],
    renovationMonths: 0,
    interestRate: 7,
    loanTermYears: 30,
    ioPeriodMonths: 0,
    stabilizedMonth: 1,
    projectionYears: 5,
    exitCapRate: 6,
    exitMethod: 'capRate' as const,
    exitClosingCostPct: 3,
  };
}

function makeProForma(): ProFormaData {
  return {
    grossRent:     { t12: 24_000, stab: null, stabilized: 24_000, growthPct: 3 },
    otherIncome:   { t12: 0,      stab: null, stabilized: 0,      growthPct: 2 },
    vacancyPct:    { t12: 5,      stab: null, stabilized: 5 },
    creditLossPct: { t12: 0,      stab: null, stabilized: 0 },
    expenses: [
      { id: 'mgmt', name: 'Property Management', isPercentOfEGI: true,  t12Value: 8,     stabValue: null, stabilizedValue: 8,     growthPct: 0 },
      { id: 'repr', name: 'Maintenance',          isPercentOfEGI: true,  t12Value: 5,     stabValue: null, stabilizedValue: 5,     growthPct: 0 },
      { id: 'tax',  name: 'Property Taxes',       isPercentOfEGI: false, t12Value: 3_000, stabValue: null, stabilizedValue: 3_000, growthPct: 2 },
    ],
    yearOverrides: {},
  };
}

function makeBaseResult(): CoCResult {
  const scenario: CoCScenario = {
    id: 'test', name: 'Test', scenarioType: 'base',
    acquisition: makeAcquisition(),
    operations: { grossRentMonthly: 2_000, vacancyRatePct: 5, opexPct: 30, propertyMgmtPct: 8, annualRentGrowthPct: 3 },
    proForma: makeProForma(),
    refinance: { enabled: false, refiYear: 3, refiMarketValue: 0, newLTV: 75, newInterestRate: 6.5, newLoanTermYears: 30, refiCostPct: 2 },
    createdAt: '', updatedAt: '',
  };
  return projectScenario(scenario);
}

function renderPanel(embedded = true) {
  return render(
    <WhatIfPanel
      acquisition={makeAcquisition()}
      operations={{ grossRentMonthly: 2_000, vacancyRatePct: 5, opexPct: 30, propertyMgmtPct: 8, annualRentGrowthPct: 3 }}
      proForma={makeProForma()}
      refinance={{ enabled: false, refiYear: 3, refiMarketValue: 0, newLTV: 75, newInterestRate: 6.5, newLoanTermYears: 30, refiCostPct: 2 }}
      baseResult={makeBaseResult()}
      embedded={embedded}
    />
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('WhatIfPanel — mode toggle', () => {
  it('renders both Explore and Goal Seek toggle buttons', () => {
    renderPanel();
    expect(screen.getByRole('button', { name: /explore/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /goal seek/i })).toBeInTheDocument();
  });

  it('defaults to Explore mode — break-even table is visible', () => {
    renderPanel();
    expect(screen.getByText('Break-even Analysis')).toBeInTheDocument();
  });

  it('Goal Seek mode hides the break-even table', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole('button', { name: /goal seek/i }));
    expect(screen.queryByText('Break-even Analysis')).not.toBeInTheDocument();
  });

  it('Goal Seek mode shows the target input banner', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole('button', { name: /goal seek/i }));
    expect(screen.getByText('Achieve')).toBeInTheDocument();
  });

  it('switching back to Explore mode restores the break-even table', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole('button', { name: /goal seek/i }));
    await user.click(screen.getByRole('button', { name: /explore/i }));
    expect(screen.getByText('Break-even Analysis')).toBeInTheDocument();
  });
});

describe('WhatIfPanel — Goal Seek banner', () => {
  it('shows IRR and CoC metric toggle buttons in Goal Seek mode', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole('button', { name: /goal seek/i }));
    // The banner has IRR/CoC buttons (distinct from the break-even CoC/IRR toggle)
    expect(screen.getByRole('button', { name: 'IRR' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'CoC' })).toBeInTheDocument();
  });

  it('shows "Target met!" when target is set very low (0%)', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole('button', { name: /goal seek/i }));
    // The target input defaults to 15 — clear and type 0
    const targetInput = screen.getAllByRole('spinbutton').find(
      el => (el as HTMLInputElement).value === '15'
    )!;
    await user.clear(targetInput);
    await user.type(targetInput, '0');
    // At 0% target, any positive-return deal should show "Target met!"
    expect(await screen.findByText(/target met/i)).toBeInTheDocument();
  });

  it('shows gap info when target is set very high (50%)', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole('button', { name: /goal seek/i }));
    const targetInput = screen.getAllByRole('spinbutton').find(
      el => (el as HTMLInputElement).value === '15'
    )!;
    await user.clear(targetInput);
    await user.type(targetInput, '50');
    // "Gap: X%" label appears when target is not met
    expect(await screen.findByText(/^Gap:/i)).toBeInTheDocument();
  });
});
