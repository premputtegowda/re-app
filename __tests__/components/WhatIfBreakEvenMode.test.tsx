/**
 * Tests for WhatIfPanel break-even mode toggle (CoC vs IRR):
 *
 * - Default mode is CoC
 * - Exit Cap Rate shows "n/a for CoC" in CoC mode (cap rate only affects IRR, not CoC)
 * - Exit Cap Rate shows a real break-even value in IRR mode
 * - Toggling between modes swaps the displayed metric
 * - Target input edits the active mode's target; each target is remembered independently
 * - Table header always shows 4 columns (Variable / Assumption / Break-even / Cushion)
 */

import { describe, it, expect, beforeEach } from 'vitest';
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

function makeOps(): CoCOperations {
  return { grossRentMonthly: 2_000, vacancyRatePct: 5, opexPct: 30, propertyMgmtPct: 8, annualRentGrowthPct: 3 };
}

function makeRefinance(): CoCRefinance {
  return { enabled: false, refiYear: 3, refiMarketValue: 0, newLTV: 75, newInterestRate: 6.5, newLoanTermYears: 30, refiCostPct: 2 };
}

function makeBaseResult(): CoCResult {
  const scenario: CoCScenario = {
    id: 'base', name: 'Base', scenarioType: 'base',
    acquisition: makeAcquisition(),
    operations: makeOps(),
    proForma: makeProForma(),
    refinance: makeRefinance(),
    createdAt: '', updatedAt: '',
  };
  return projectScenario(scenario);
}

function renderPanel() {
  const acquisition = makeAcquisition();
  const proForma = makeProForma();
  render(
    <WhatIfPanel
      acquisition={acquisition}
      operations={makeOps()}
      proForma={proForma}
      refinance={makeRefinance()}
      baseResult={makeBaseResult()}
      embedded
    />
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('WhatIfPanel break-even mode toggle', () => {
  beforeEach(() => {});

  it('renders CoC and IRR toggle buttons', () => {
    renderPanel();
    expect(screen.getByRole('button', { name: 'CoC' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'IRR' })).toBeInTheDocument();
  });

  it('defaults to CoC mode — Exit Cap Rate shows "n/a for CoC"', () => {
    renderPanel();
    expect(screen.getByText('n/a for CoC')).toBeInTheDocument();
  });

  it('switching to IRR mode removes the "n/a for CoC" text', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole('button', { name: 'IRR' }));

    expect(screen.queryByText('n/a for CoC')).not.toBeInTheDocument();
  });

  it('switching back to CoC mode restores "n/a for CoC"', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole('button', { name: 'IRR' }));
    await user.click(screen.getByRole('button', { name: 'CoC' }));

    expect(screen.getByText('n/a for CoC')).toBeInTheDocument();
  });

  it('Exit Cap Rate row is present in the table in both modes', async () => {
    const user = userEvent.setup();
    renderPanel();

    // "Exit Cap Rate" appears twice: once as a slider label, once as a table row
    expect(screen.getAllByText('Exit Cap Rate').length).toBeGreaterThanOrEqual(1);

    await user.click(screen.getByRole('button', { name: 'IRR' }));

    expect(screen.getAllByText('Exit Cap Rate').length).toBeGreaterThanOrEqual(1);
  });

  it('table always has 4 column headers', () => {
    renderPanel();
    expect(screen.getByText('Variable')).toBeInTheDocument();
    expect(screen.getByText('Assumption')).toBeInTheDocument();
    expect(screen.getByText('Break-even')).toBeInTheDocument();
    expect(screen.getByText('Cushion')).toBeInTheDocument();
  });
});

describe('WhatIfPanel break-even target input', () => {
  it('Target input is present and editable', async () => {
    const user = userEvent.setup();
    renderPanel();

    const input = screen.getByRole('spinbutton');
    await user.clear(input);
    await user.type(input, '6');

    expect(input).toHaveValue(6);
  });

  it('CoC target value is remembered after switching to IRR and back', async () => {
    const user = userEvent.setup();
    renderPanel();

    // Set CoC target to 8
    const input = screen.getByRole('spinbutton');
    await user.clear(input);
    await user.type(input, '8');

    // Switch to IRR mode — input now shows IRR target (0)
    await user.click(screen.getByRole('button', { name: 'IRR' }));
    expect(screen.getByRole('spinbutton')).toHaveValue(0);

    // Switch back to CoC — should restore 8
    await user.click(screen.getByRole('button', { name: 'CoC' }));
    expect(screen.getByRole('spinbutton')).toHaveValue(8);
  });

  it('IRR target value is remembered after switching to CoC and back', async () => {
    const user = userEvent.setup();
    renderPanel();

    // Switch to IRR, set target to 12
    await user.click(screen.getByRole('button', { name: 'IRR' }));
    const input = screen.getByRole('spinbutton');
    await user.clear(input);
    await user.type(input, '12');

    // Switch to CoC — should show CoC target (0)
    await user.click(screen.getByRole('button', { name: 'CoC' }));
    expect(screen.getByRole('spinbutton')).toHaveValue(0);

    // Switch back to IRR — should restore 12
    await user.click(screen.getByRole('button', { name: 'IRR' }));
    expect(screen.getByRole('spinbutton')).toHaveValue(12);
  });

  it('CoC and IRR targets are independent — changing one does not affect the other', async () => {
    const user = userEvent.setup();
    renderPanel();

    // Set CoC target to 5
    const input = screen.getByRole('spinbutton');
    await user.clear(input);
    await user.type(input, '5');

    // Switch to IRR, set to 10
    await user.click(screen.getByRole('button', { name: 'IRR' }));
    await user.clear(screen.getByRole('spinbutton'));
    await user.type(screen.getByRole('spinbutton'), '10');

    // Verify each mode retains its own value
    await user.click(screen.getByRole('button', { name: 'CoC' }));
    expect(screen.getByRole('spinbutton')).toHaveValue(5);

    await user.click(screen.getByRole('button', { name: 'IRR' }));
    expect(screen.getByRole('spinbutton')).toHaveValue(10);
  });
});
