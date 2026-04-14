/**
 * Tests for SFR ↔ MFR data retention:
 *
 * When the user switches between Single Family and Multi-Family, any data
 * previously entered for the other type should be preserved and restored.
 *
 * → MFR → SFR → MFR: unit mix entries and counts are still there
 * → SFR → MFR → SFR: beds/baths values are still there
 * → Multiple unit entries survive the round-trip
 * → Summary bar shows correct unit count for the active type (not leaked from the other type)
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

type User = ReturnType<typeof userEvent.setup>;

function inputValue(spinbuttons: HTMLElement[], index: number): string {
  return (spinbuttons[index] as HTMLInputElement).value;
}

/** Set a spinbutton at the given index to a value. */
async function setSpinbutton(user: User, index: number, value: number) {
  const spinbuttons = screen.getAllByRole('spinbutton');
  await user.clear(spinbuttons[index]);
  await user.type(spinbuttons[index], String(value));
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Property type data retention', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('preserves MFR unit mix when switching to SFR and back', async () => {
    const user = userEvent.setup();
    render(<DealAnalyzerForm />);

    await user.type(screen.getByPlaceholderText(/123 main st/i), '10 Oak Ave');

    // Set up MFR with 1 unit entry, set count to 3
    await user.click(screen.getByRole('button', { name: /multi-family/i }));
    await user.click(screen.getByRole('button', { name: /add unit type/i }));
    await setSpinbutton(user, 2, 3); // count is spinbutton[2] (beds=0, baths=1, count=2)

    // Confirm "3 units total" is visible
    expect(screen.getByText(/3 units total/i)).toBeInTheDocument();

    // Switch to SFR — unit mix section disappears
    await user.click(screen.getByRole('button', { name: /single family/i }));
    expect(screen.queryByText(/units total/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /add unit type/i })).not.toBeInTheDocument();

    // Switch back to MFR — unit mix should be restored
    await user.click(screen.getByRole('button', { name: /multi-family/i }));

    // The unit entry row is still present
    expect(screen.getByText(/units total/i)).toBeInTheDocument();
    // The count spinbutton still shows 3
    const spinbuttons = screen.getAllByRole('spinbutton');
    expect(inputValue(spinbuttons, 2)).toBe('3');
  });

  it('preserves SFR beds/baths when switching to MFR and back', async () => {
    const user = userEvent.setup();
    render(<DealAnalyzerForm />);

    await user.type(screen.getByPlaceholderText(/123 main st/i), '10 Oak Ave');

    // SFR is the default — fill in beds and baths
    await setSpinbutton(user, 0, 4); // beds
    await setSpinbutton(user, 1, 2); // baths

    // Switch to MFR — SFR fields disappear
    await user.click(screen.getByRole('button', { name: /multi-family/i }));
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument(); // no unit entries yet

    // Switch back to SFR — beds/baths should be restored
    await user.click(screen.getByRole('button', { name: /single family/i }));

    const spinbuttons = screen.getAllByRole('spinbutton');
    expect(inputValue(spinbuttons, 0)).toBe('4'); // beds
    expect(inputValue(spinbuttons, 1)).toBe('2'); // baths
  });

  it('preserves multiple MFR unit entries on round-trip', async () => {
    const user = userEvent.setup();
    render(<DealAnalyzerForm />);

    await user.type(screen.getByPlaceholderText(/123 main st/i), '10 Oak Ave');

    // Add 3 unit-type entries under MFR
    await user.click(screen.getByRole('button', { name: /multi-family/i }));
    await user.click(screen.getByRole('button', { name: /add unit type/i }));
    await user.click(screen.getByRole('button', { name: /add unit type/i }));
    await user.click(screen.getByRole('button', { name: /add unit type/i }));

    // Each entry defaults to count=1, so total = 3
    expect(screen.getByText(/3 units total/i)).toBeInTheDocument();
    // 3 remove buttons visible (one per entry)
    expect(screen.getAllByRole('button', { name: /remove unit type/i })).toHaveLength(3);

    // Round-trip through SFR
    await user.click(screen.getByRole('button', { name: /single family/i }));
    await user.click(screen.getByRole('button', { name: /multi-family/i }));

    // All 3 entries still present
    expect(screen.getByText(/3 units total/i)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /remove unit type/i })).toHaveLength(3);
  });

  it('SFR summary shows "1 unit" not MFR unit count after switching back to SFR', async () => {
    const user = userEvent.setup();
    render(<DealAnalyzerForm />);

    await user.type(screen.getByPlaceholderText(/123 main st/i), '10 Oak Ave');

    // Set up MFR with 5 units
    await user.click(screen.getByRole('button', { name: /multi-family/i }));
    await user.click(screen.getByRole('button', { name: /add unit type/i }));
    await setSpinbutton(user, 2, 5); // count = 5

    expect(screen.getByText(/5 units total/i)).toBeInTheDocument();

    // Switch to SFR — the "5 units total" text should not appear
    await user.click(screen.getByRole('button', { name: /single family/i }));
    expect(screen.queryByText(/5 units total/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/units total/i)).not.toBeInTheDocument();

    // Advance to complete step 0 so the summary bar renders
    await user.click(screen.getByTestId('header-next-btn')); // → step 1

    // The step 0 summary bar should show "SFR" not "MFR 5 units"
    expect(screen.getByTestId('step-summary-0')).toHaveTextContent('SFR');
    expect(screen.getByTestId('step-summary-0')).not.toHaveTextContent('5');
  });
});
