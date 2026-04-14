/**
 * Tests for exit method auto-switching behaviour:
 *
 * → Cap Rate (MFR > 4 units):
 *   - MFR with > 4 units auto-sets exit method to "Cap Rate"
 *   - Triggered by unit count field as well as multiple unit entries
 *   - Boundary: exactly 4 units does NOT trigger
 *
 * → ARV / Market Value (condition no longer met):
 *   - Switching from MFR > 4 units back to SFR resets to "ARV / Market Value"
 *   - Reducing MFR units to ≤ 4 resets to "ARV / Market Value"
 *
 * User override:
 *   - User can manually switch while on step 4
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DealAnalyzerForm } from '@/components/DealAnalyzer/DealAnalyzerForm';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement> & { children?: React.ReactNode }) =>
      <div {...props}>{children}</div>,
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
  usePathname: () => '/deal-analyzer/new',
}));

vi.mock('@/lib/dealAnalyzerStore', () => ({
  useDealAnalyzerStore: () => ({
    addScenario: vi.fn(),
    saveDeal: vi.fn(() => 'deal-test-id'),
    updateSavedDeal: vi.fn(),
    updateMCData: vi.fn(),
    updateCurrentStep: vi.fn(),
  }),
}));

vi.mock('@/components/DealAnalyzer/ResultsPanel', () => ({ ResultsPanel: () => null }));
vi.mock('@/components/DealAnalyzer/ProFormaGrid', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/DealAnalyzer/ProFormaGrid')>();
  return { ...actual, ProFormaGrid: () => null };
});
vi.mock('@/components/DealAnalyzer/RehabRentCalculator', () => ({ RehabRentCalculator: () => null }));
vi.mock('@/utils/dealAnalyzerCalc', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/dealAnalyzerCalc')>();
  return { ...actual, projectScenario: vi.fn(() => ({ avgCoCReturn: 0.08, irr: 0.12, equityMultiple: 1.5, peakCoCReturn: 0.08, totalCashFlow: 5000, totalInvested: 77000, yearlyProjections: [], downPayment: 60000, closingCosts: 5000, pointsCost: 0, additionalFeeItems: [], additionalFees: 0, hardCostItems: [], hardCosts: 0, softCostItems: [], softCosts: 0, opportunityCostItems: [], lostOpportunityCost: 0, initialLoanAmount: 240000, terminalPropertyValue: 300000, exitClosingCosts: 9000, terminalEquity: 51000, irrCashFlows: [-77000, 5000] })) };
});
vi.mock('@/utils/whatIfCalc', () => ({ buildWhatIfResult: vi.fn(), findBreakEven: vi.fn(), computeAvgRents: vi.fn(() => ({ units: 1, avgTargetRent: 2000, avgPreStabRent: 1500 })) }));
vi.mock('@/utils/monteCarlo', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/monteCarlo')>();
  return { ...actual, runMonteCarloSimulation: vi.fn() };
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Navigate to step 4 (Exit & Refi) from the current active step. */
async function reachStep4(user: ReturnType<typeof userEvent.setup>) {
  // Step 0 — enter address
  await user.type(screen.getByPlaceholderText(/123 main st/i), '10 Oak Ave');
  await user.click(screen.getByTestId('header-next-btn')); // → 1
  await user.click(screen.getByTestId('header-next-btn')); // → 2
  await user.click(screen.getByTestId('header-next-btn')); // → 3
  await user.click(screen.getByTestId('header-next-btn')); // → 4
}

/** Switch to MFR on step 0 and add `count` unit type entries (each with 1 unit by default). */
async function switchToMFRWithUnits(user: ReturnType<typeof userEvent.setup>, unitEntries: number) {
  await user.click(screen.getByRole('button', { name: /multi-family/i }));
  for (let i = 0; i < unitEntries; i++) {
    await user.click(screen.getByRole('button', { name: /add unit type/i }));
  }
}

/** Set the unit count on the nth unit-mix row (0-indexed). */
async function setUnitCount(user: ReturnType<typeof userEvent.setup>, rowIndex: number, count: number) {
  // Each unit row has spinbuttons: beds, baths, count, inPlaceRent, preStabRent, rentMonthly
  // "count" is the 3rd spinbutton (index 2) in each row, so global index = rowIndex * 6 + 2
  const spinbuttons = screen.getAllByRole('spinbutton');
  const countInput = spinbuttons[rowIndex * 6 + 2];
  await user.clear(countInput);
  await user.type(countInput, String(count));
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Exit method auto-default', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('defaults to "ARV / Market Value" for SFR', async () => {
    const user = userEvent.setup();
    render(<DealAnalyzerForm />);
    await reachStep4(user);

    // The "ARV / Market Value" button should be the active (selected) toggle
    const arvBtn = screen.getByRole('button', { name: /arv \/ market value/i });
    expect(arvBtn.className).toMatch(/bg-white|bg-slate-800/);

    // The ARV input should be visible, not the cap rate input
    expect(screen.getByLabelText(/exit value \/ arv/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/exit cap rate/i)).not.toBeInTheDocument();
  });

  it('stays on "ARV / Market Value" for MFR with exactly 4 units', async () => {
    const user = userEvent.setup();
    render(<DealAnalyzerForm />);

    await user.type(screen.getByPlaceholderText(/123 main st/i), '10 Oak Ave');
    await switchToMFRWithUnits(user, 1); // 1 entry, default count = 1 unit
    await setUnitCount(user, 0, 4);     // set count to 4

    await user.click(screen.getByTestId('header-next-btn')); // → 1
    await user.click(screen.getByTestId('header-next-btn')); // → 2
    await user.click(screen.getByTestId('header-next-btn')); // → 3
    await user.click(screen.getByTestId('header-next-btn')); // → 4

    expect(screen.getByLabelText(/exit value \/ arv/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/exit cap rate/i)).not.toBeInTheDocument();
  });

  it('auto-switches to "Cap Rate" when MFR has 5 units (1 entry, count=5)', async () => {
    const user = userEvent.setup();
    render(<DealAnalyzerForm />);

    await user.type(screen.getByPlaceholderText(/123 main st/i), '10 Oak Ave');
    await switchToMFRWithUnits(user, 1);
    await setUnitCount(user, 0, 5);

    await user.click(screen.getByTestId('header-next-btn')); // → 1
    await user.click(screen.getByTestId('header-next-btn')); // → 2
    await user.click(screen.getByTestId('header-next-btn')); // → 3
    await user.click(screen.getByTestId('header-next-btn')); // → 4

    expect(screen.getByLabelText(/exit cap rate/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/exit value \/ arv/i)).not.toBeInTheDocument();
  });

  it('auto-switches to "Cap Rate" when MFR unit count crosses 4 via multiple entries', async () => {
    const user = userEvent.setup();
    render(<DealAnalyzerForm />);

    await user.type(screen.getByPlaceholderText(/123 main st/i), '10 Oak Ave');
    // Add 5 unit-type entries, each with default count of 1 → total = 5
    await switchToMFRWithUnits(user, 5);

    await user.click(screen.getByTestId('header-next-btn')); // → 1
    await user.click(screen.getByTestId('header-next-btn')); // → 2
    await user.click(screen.getByTestId('header-next-btn')); // → 3
    await user.click(screen.getByTestId('header-next-btn')); // → 4

    expect(screen.getByLabelText(/exit cap rate/i)).toBeInTheDocument();
  });

  it('user can manually switch back to "ARV / Market Value" after auto-default', async () => {
    const user = userEvent.setup();
    render(<DealAnalyzerForm />);

    await user.type(screen.getByPlaceholderText(/123 main st/i), '10 Oak Ave');
    await switchToMFRWithUnits(user, 1);
    await setUnitCount(user, 0, 5);

    await user.click(screen.getByTestId('header-next-btn')); // → 1
    await user.click(screen.getByTestId('header-next-btn')); // → 2
    await user.click(screen.getByTestId('header-next-btn')); // → 3
    await user.click(screen.getByTestId('header-next-btn')); // → 4

    // Cap Rate is active after auto-default
    expect(screen.getByLabelText(/exit cap rate/i)).toBeInTheDocument();

    // User manually switches back to ARV / Market Value
    await user.click(screen.getByRole('button', { name: /arv \/ market value/i }));

    expect(screen.getByLabelText(/exit value \/ arv/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/exit cap rate/i)).not.toBeInTheDocument();
  });

  it('resets to "ARV / Market Value" when switching from MFR > 4 units to SFR', async () => {
    const user = userEvent.setup();
    render(<DealAnalyzerForm />);

    await user.type(screen.getByPlaceholderText(/123 main st/i), '10 Oak Ave');
    await switchToMFRWithUnits(user, 1);
    await setUnitCount(user, 0, 5); // large MFR → capRate

    await user.click(screen.getByTestId('header-next-btn')); // → 1
    await user.click(screen.getByTestId('header-next-btn')); // → 2
    await user.click(screen.getByTestId('header-next-btn')); // → 3
    await user.click(screen.getByTestId('header-next-btn')); // → 4

    expect(screen.getByLabelText(/exit cap rate/i)).toBeInTheDocument();

    // Open step 0 in editing mode, switch to SFR, then Done (returns to step 4)
    await user.click(screen.getByTestId('step-summary-0'));
    await user.click(screen.getByRole('button', { name: /single family/i }));
    await user.click(screen.getByRole('button', { name: /^done$/i }));

    // Step 4 is still the active step — exit method should now be ARV / Market Value
    expect(screen.getByLabelText(/exit value \/ arv/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/exit cap rate/i)).not.toBeInTheDocument();
  });

  it('resets to "ARV / Market Value" when MFR unit count drops to ≤ 4', async () => {
    const user = userEvent.setup();
    render(<DealAnalyzerForm />);

    await user.type(screen.getByPlaceholderText(/123 main st/i), '10 Oak Ave');
    await switchToMFRWithUnits(user, 1);
    await setUnitCount(user, 0, 5); // 5 units → capRate

    await user.click(screen.getByTestId('header-next-btn')); // → 1
    await user.click(screen.getByTestId('header-next-btn')); // → 2
    await user.click(screen.getByTestId('header-next-btn')); // → 3
    await user.click(screen.getByTestId('header-next-btn')); // → 4

    expect(screen.getByLabelText(/exit cap rate/i)).toBeInTheDocument();

    // Open step 0 in editing mode, reduce unit count to 4, then Done (returns to step 4)
    await user.click(screen.getByTestId('step-summary-0'));
    await setUnitCount(user, 0, 4); // drop to 4 → no longer large MFR
    await user.click(screen.getByRole('button', { name: /^done$/i }));

    // Step 4 is still the active step — exit method should now be ARV / Market Value
    expect(screen.getByLabelText(/exit value \/ arv/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/exit cap rate/i)).not.toBeInTheDocument();
  });

  it('auto-switches to "Cap Rate" when unit count is set to 5 via the count field', async () => {
    const user = userEvent.setup();
    render(<DealAnalyzerForm />);

    await user.type(screen.getByPlaceholderText(/123 main st/i), '10 Oak Ave');
    // Add 1 unit entry with default count of 1, then increase count to 5
    await switchToMFRWithUnits(user, 1);
    await setUnitCount(user, 0, 5);

    await user.click(screen.getByTestId('header-next-btn')); // → 1
    await user.click(screen.getByTestId('header-next-btn')); // → 2
    await user.click(screen.getByTestId('header-next-btn')); // → 3
    await user.click(screen.getByTestId('header-next-btn')); // → 4

    // 1 entry × 5 units = 5 total → auto-default fires
    expect(screen.getByLabelText(/exit cap rate/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/exit value \/ arv/i)).not.toBeInTheDocument();
  });
});
