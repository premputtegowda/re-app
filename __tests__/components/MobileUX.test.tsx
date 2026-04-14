/**
 * Tests for mobile UX improvements:
 *
 * 1. ProFormaGrid — card-per-row layout on mobile (<640px):
 *    - Renders income/expense row labels as cards (no <table>)
 *    - Shows T12 and Yr N column headers in each card
 *    - Year navigation buttons (1..N) are present
 *    - EGI / OpEx / NOI summary rows are present
 *    - "Add expense" button is present
 *    - Exit year shows ★ indicator
 *
 * 2. ResultsPanel — tab container uses grid-cols-2 so all 4 tabs always visible
 *
 * 3. CostItemList — editable buttons have touch-manipulation class
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProFormaGrid, defaultProForma } from '@/components/DealAnalyzer/ProFormaGrid';
import { CostItemList } from '@/components/DealAnalyzer/CostItemList';
import { ResultsPanel } from '@/components/DealAnalyzer/ResultsPanel';
import type { CoCResult, CoCAcquisition, CoCOperations, CoCRefinance } from '@/types';

// ── Global mocks ───────────────────────────────────────────────────────────────

// ResizeObserver is not available in jsdom (used by Recharts)
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// ── Viewport helper ────────────────────────────────────────────────────────────

function setViewport(width: number) {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: width });
  window.dispatchEvent(new Event('resize'));
}

// ── Fixtures ───────────────────────────────────────────────────────────────────

const baseAcquisition: CoCAcquisition = {
  propertyAddress: '', propertyType: 'sfr', units: 1,
  sfrBeds: 3, sfrBaths: 2, sfrInPlaceRent: 0, sfrPreStabRent: 0, sfrTargetRent: 0,
  unitMix: [], purchasePrice: 350000, arv: 0, downPaymentPct: 20, closingCostsPct: 2,
  points: 0, additionalFeeItems: [], hardCostItems: [], softCostItems: [],
  opportunityCostItems: [], renovationMonths: 0, interestRate: 7, loanTermYears: 30,
  ioPeriodMonths: 0, stabilizedMonth: 1, projectionYears: 3,
  exitCapRate: 0, exitClosingCostPct: 3, exitMethod: 'value',
};

const baseRefinance: CoCRefinance = {
  enabled: false, refiYear: 0, refiMarketValue: 0,
  newLTV: 0, newInterestRate: 0, newLoanTermYears: 0, refiCostPct: 2,
};

const baseOperations: CoCOperations = {
  grossRentMonthly: 2000, vacancyRatePct: 5, opexPct: 30,
  propertyMgmtPct: 8, annualRentGrowthPct: 3,
};

const baseResult: CoCResult = {
  downPayment: 70000, closingCosts: 7000, pointsCost: 0, additionalFeeItems: [],
  additionalFees: 0, hardCostItems: [], hardCosts: 0, softCostItems: [], softCosts: 0,
  opportunityCostItems: [], lostOpportunityCost: 0, totalInvested: 77000,
  initialLoanAmount: 280000,
  yearlyProjections: Array.from({ length: 3 }, (_, i) => ({
    year: i + 1, grossRent: 24000, effectiveRent: 22800, opex: 6840,
    noi: 15960, debtService: 22800, cashOutProceeds: 0, cashFlow: -840, coCReturn: -0.011,
    loanBalance: 270000, equityValue: 80000, cumulativeCashFlow: -840 * (i + 1),
  })),
  irr: 0.08, equityMultiple: 1.5, avgCoCReturn: -0.011, peakCoCReturn: 0,
  totalCashFlow: -2520, terminalPropertyValue: 380000, exitClosingCosts: 11400,
  terminalEquity: 110000, irrCashFlows: [-77000, -840, -840, 109160],
};

// ── ProFormaGrid mobile card layout ───────────────────────────────────────────

describe('ProFormaGrid mobile card layout', () => {
  beforeEach(() => setViewport(375));
  afterEach(() => setViewport(1024));

  async function renderMobile(projectionYears = 3) {
    let container!: HTMLElement;
    await act(async () => {
      ({ container } = render(
        <ProFormaGrid
          data={defaultProForma('sfr')}
          onChange={vi.fn()}
          projectionYears={projectionYears}
        />
      ));
    });
    return container;
  }

  it('renders income row labels and no <table>', async () => {
    const container = await renderMobile();
    expect(screen.getByText('Gross Rent')).toBeInTheDocument();
    expect(screen.getByText('Other Income')).toBeInTheDocument();
    expect(screen.getByText('Vacancy')).toBeInTheDocument();
    expect(screen.getByText('Credit Loss')).toBeInTheDocument();
    expect(container.querySelector('table')).toBeNull();
  });

  it('shows T12 and Yr 1 column headers inside row cards', async () => {
    await renderMobile();
    // Multiple T12 labels — one per income/expense row card
    expect(screen.getAllByText('T12').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Yr 1').length).toBeGreaterThanOrEqual(1);
  });

  it('renders year navigation buttons for each projection year', async () => {
    await renderMobile(3);
    expect(screen.getByRole('button', { name: '1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '2' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '3' })).toBeInTheDocument();
  });

  it('switches displayed year when a year button is clicked', async () => {
    const user = userEvent.setup();
    await renderMobile(3);
    await user.click(screen.getByRole('button', { name: '2' }));
    expect(screen.getAllByText('Yr 2').length).toBeGreaterThanOrEqual(1);
  });

  it('shows EGI, OpEx, and NOI summary rows', async () => {
    await renderMobile();
    expect(screen.getAllByText(/EGI/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/OpEx/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/NOI/i).length).toBeGreaterThanOrEqual(1);
  });

  it('shows Income and Operating Expenses section headers', async () => {
    await renderMobile();
    expect(screen.getByText(/^Income$/i)).toBeInTheDocument();
    expect(screen.getByText(/Operating Expenses/i)).toBeInTheDocument();
  });

  it('renders preset expense rows', async () => {
    await renderMobile();
    expect(screen.getByText('Property Taxes')).toBeInTheDocument();
    expect(screen.getByText('Property Management')).toBeInTheDocument();
  });

  it('shows Add expense button', async () => {
    await renderMobile();
    expect(screen.getByText('Add expense')).toBeInTheDocument();
  });

  it('exit year navigation label shows ★ exit when on the last year', async () => {
    const user = userEvent.setup();
    await renderMobile(3);
    await user.click(screen.getByRole('button', { name: '3' }));
    expect(screen.getByText(/★ exit/i)).toBeInTheDocument();
  });
});

// ── CostItemList touch-manipulation ────────────────────────────────────────────

describe('CostItemList touch-manipulation on editable buttons', () => {
  const item = { id: '1', description: 'Flooring', amount: 5000 };

  it('EditableText button has touch-manipulation class', () => {
    const { container } = render(
      <CostItemList items={[item]} placeholder="Description"
        onAdd={vi.fn()} onUpdate={vi.fn()} onRemove={vi.fn()} />
    );
    const textBtn = Array.from(container.querySelectorAll('button'))
      .find(b => b.textContent?.includes('Flooring'));
    expect(textBtn?.className).toContain('touch-manipulation');
  });

  it('EditableAmount button has touch-manipulation class', () => {
    const { container } = render(
      <CostItemList items={[item]} placeholder="Description"
        onAdd={vi.fn()} onUpdate={vi.fn()} onRemove={vi.fn()} />
    );
    const amountBtn = Array.from(container.querySelectorAll('button'))
      .find(b => b.textContent?.includes('$5,000'));
    expect(amountBtn?.className).toContain('touch-manipulation');
  });
});

// ── ResultsPanel tab overflow fix ─────────────────────────────────────────────

describe('ResultsPanel tabs are always visible on mobile', () => {
  function renderPanel() {
    return render(
      <ResultsPanel
        result={baseResult}
        acquisition={baseAcquisition}
        operations={baseOperations}
        proForma={defaultProForma('sfr')}
        refinance={baseRefinance}
      />
    );
  }

  it('all 4 tabs are rendered', () => {
    renderPanel();
    expect(screen.getByRole('button', { name: 'Summary' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Projections' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'What If' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Monte Carlo' })).toBeInTheDocument();
  });

  it('tab container uses grid-cols-2 for 2×2 layout on mobile', () => {
    const { container } = renderPanel();
    const tabGrid = container.querySelector('.grid-cols-2');
    expect(tabGrid).not.toBeNull();
    // The grid should contain all 4 tab buttons
    expect(tabGrid?.querySelectorAll('button').length).toBe(4);
  });

  it('tab container also has sm:flex for desktop row layout', () => {
    const { container } = renderPanel();
    const tabGrid = container.querySelector('.grid-cols-2');
    expect(tabGrid?.className).toContain('sm:flex');
  });

  it('clicking a tab activates it with primary background', async () => {
    const user = userEvent.setup();
    renderPanel();
    const projBtn = screen.getByRole('button', { name: 'Projections' });
    await user.click(projBtn);
    expect(projBtn.className).toContain('bg-primary-600');
  });

  it('Summary tab is active by default', () => {
    renderPanel();
    const summaryBtn = screen.getByRole('button', { name: 'Summary' });
    expect(summaryBtn.className).toContain('bg-primary-600');
  });
});
