/**
 * Tests for cash-out refi warnings and refi year default behaviour:
 *
 * Warnings (showWarnings kicks in after the first Calculate):
 *   - Section header shows AlertTriangle when refi is enabled and any field is missing
 *   - "active" badge is hidden while warnings are present
 *   - Individual fields show warning indicator: Market Value, Refinance Year, LTV,
 *     Interest Rate, Loan Term
 *   - Warnings clear field-by-field as values are entered
 *   - Step 4 summary bar carries the warning icon while refi is incomplete
 *   - No warnings when refi is disabled
 *
 * Refi year default:
 *   - No year button is pre-selected when refi is first enabled (refiYear = 0)
 *   - Selecting a year clears the Refinance Year warning
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
  return {
    ...actual,
    projectScenario: vi.fn(() => ({
      avgCoCReturn: 0.08, irr: 0.12, equityMultiple: 1.5,
      totalReturn: 0.5, annualCashFlows: [], exitValue: 300000, netProceeds: 100000,
    })),
  };
});
vi.mock('@/utils/whatIfCalc', () => ({
  buildWhatIfResult: vi.fn(),
  findBreakEven: vi.fn(),
  computeAvgRents: vi.fn(() => ({ units: 1, avgTargetRent: 2000, avgPreStabRent: 1500 })),
}));
vi.mock('@/utils/monteCarlo', () => ({ runMonteCarloSimulation: vi.fn() }));

// ── Helpers ───────────────────────────────────────────────────────────────────

type User = ReturnType<typeof userEvent.setup>;

/**
 * Navigate to step 4, entering a purchase price on step 1 so that
 * "Calculate →" is allowed (requires purchasePrice > 0).
 */
async function reachStep4(user: User) {
  await user.type(screen.getByPlaceholderText(/123 main st/i), '10 Oak Ave');
  await user.click(screen.getByTestId('header-next-btn')); // → step 1

  // Enter purchase price (first spinbutton on the financing step)
  const [priceInput] = screen.getAllByRole('spinbutton');
  await user.clear(priceInput);
  await user.type(priceInput, '300000');

  await user.click(screen.getByTestId('header-next-btn')); // → step 2
  await user.click(screen.getByTestId('header-next-btn')); // → step 3
  await user.click(screen.getByTestId('header-next-btn')); // → step 4
}

/** Open the Cash-Out Refinance collapsible (if not already open). */
async function openRefiSection(user: User) {
  await user.click(screen.getByRole('button', { name: /cash-out refinance/i }));
}

/** Enable "Model a cash-out refinance" checkbox. */
async function enableRefi(user: User) {
  await user.click(screen.getByRole('checkbox', { name: /model a cash-out refinance/i }));
}

/** Click Calculate → which marks step 4 as visited, activating showWarnings. */
async function calculate(user: User) {
  await user.click(screen.getByRole('button', { name: /calculate/i }));
}

/** Fill all required refi fields. */
async function fillAllRefiFields(user: User) {
  await user.type(screen.getByLabelText(/market value at refi/i), '400000');
  await user.click(screen.getByRole('button', { name: /yr 2/i }));
  await user.type(screen.getByLabelText(/new ltv/i), '75');
  await user.type(screen.getByLabelText(/new interest rate/i), '6.5');
  await user.type(screen.getByLabelText(/new loan term/i), '30');
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Cash-out refi warnings', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('shows no warnings when refi is disabled', async () => {
    const user = userEvent.setup();
    render(<DealAnalyzerForm />);
    await reachStep4(user);
    // Fill ARV so the exit assumption itself is complete
    await user.type(screen.getByLabelText(/exit value \/ arv/i), '400000');
    await calculate(user);

    // No refi warning anywhere
    expect(screen.queryByTestId('refi-section-warning')).not.toBeInTheDocument();
    expect(screen.queryByTestId('refi-year-warning')).not.toBeInTheDocument();
    expect(screen.queryByTestId('step-warning-4')).not.toBeInTheDocument();
  });

  it('shows section header warning when refi enabled with all fields empty', async () => {
    const user = userEvent.setup();
    render(<DealAnalyzerForm />);
    await reachStep4(user);
    await openRefiSection(user);
    await enableRefi(user);
    await calculate(user);

    expect(screen.getByTestId('refi-section-warning')).toBeInTheDocument();
  });

  it('hides "active" badge while refi has missing fields', async () => {
    const user = userEvent.setup();
    render(<DealAnalyzerForm />);
    await reachStep4(user);
    await openRefiSection(user);
    await enableRefi(user);
    await calculate(user);

    // "active" badge should not be shown when there are warnings
    expect(screen.queryByText('active')).not.toBeInTheDocument();
  });

  it('shows warning on Market Value at Refi when empty', async () => {
    const user = userEvent.setup();
    render(<DealAnalyzerForm />);
    await reachStep4(user);
    await openRefiSection(user);
    await enableRefi(user);
    await calculate(user);

    // The Input component renders the warning icon inside the label
    const labelEl = screen.getByLabelText(/market value at refi/i)
      .closest('div')
      ?.querySelector('label');
    expect(labelEl?.querySelector('svg')).not.toBeNull();
  });

  it('shows warning on Refinance Year when no year is selected', async () => {
    const user = userEvent.setup();
    render(<DealAnalyzerForm />);
    await reachStep4(user);
    await openRefiSection(user);
    await enableRefi(user);
    await calculate(user);

    expect(screen.getByTestId('refi-year-warning')).toBeInTheDocument();
  });

  it('shows warning on New LTV when empty', async () => {
    const user = userEvent.setup();
    render(<DealAnalyzerForm />);
    await reachStep4(user);
    await openRefiSection(user);
    await enableRefi(user);
    await calculate(user);

    const labelEl = screen.getByLabelText(/new ltv/i)
      .closest('div')
      ?.querySelector('label');
    expect(labelEl?.querySelector('svg')).not.toBeNull();
  });

  it('shows warning on New Interest Rate when empty', async () => {
    const user = userEvent.setup();
    render(<DealAnalyzerForm />);
    await reachStep4(user);
    await openRefiSection(user);
    await enableRefi(user);
    await calculate(user);

    const labelEl = screen.getByLabelText(/new interest rate/i)
      .closest('div')
      ?.querySelector('label');
    expect(labelEl?.querySelector('svg')).not.toBeNull();
  });

  it('shows warning on New Loan Term when empty', async () => {
    const user = userEvent.setup();
    render(<DealAnalyzerForm />);
    await reachStep4(user);
    await openRefiSection(user);
    await enableRefi(user);
    await calculate(user);

    const labelEl = screen.getByLabelText(/new loan term/i)
      .closest('div')
      ?.querySelector('label');
    expect(labelEl?.querySelector('svg')).not.toBeNull();
  });

  it('step 4 summary bar shows warning when refi enabled with incomplete fields', async () => {
    const user = userEvent.setup();
    render(<DealAnalyzerForm />);
    await reachStep4(user);
    await openRefiSection(user);
    await enableRefi(user);
    await calculate(user);

    // After Calculate, step 4 is completed → summary bar renders with warning icon
    expect(screen.getByTestId('step-warning-4')).toBeInTheDocument();
  });

  it('step 4 summary bar has no warning when refi is disabled', async () => {
    const user = userEvent.setup();
    render(<DealAnalyzerForm />);
    await reachStep4(user);
    // Also fill ARV so there's no exit warning either
    await user.type(screen.getByLabelText(/exit value \/ arv/i), '400000');
    await calculate(user);

    expect(screen.queryByTestId('step-warning-4')).not.toBeInTheDocument();
  });

  it('clears section header warning and field warnings when all refi fields are filled', async () => {
    const user = userEvent.setup();
    render(<DealAnalyzerForm />);
    await reachStep4(user);
    await openRefiSection(user);
    await enableRefi(user);
    await calculate(user);

    // Warnings present before filling
    expect(screen.getByTestId('refi-section-warning')).toBeInTheDocument();

    // Fill all required fields
    await fillAllRefiFields(user);

    // All warnings gone
    expect(screen.queryByTestId('refi-section-warning')).not.toBeInTheDocument();
    expect(screen.queryByTestId('refi-year-warning')).not.toBeInTheDocument();
  });

  it('step 4 summary bar warning clears when all refi fields are filled', async () => {
    const user = userEvent.setup();
    render(<DealAnalyzerForm />);
    await reachStep4(user);
    await user.type(screen.getByLabelText(/exit value \/ arv/i), '400000');
    await openRefiSection(user);
    await enableRefi(user);
    await calculate(user);

    expect(screen.getByTestId('step-warning-4')).toBeInTheDocument();

    await fillAllRefiFields(user);

    expect(screen.queryByTestId('step-warning-4')).not.toBeInTheDocument();
  });
});

describe('Refi year default', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('no year is pre-selected when refi is first enabled (refiYear defaults to 0)', async () => {
    const user = userEvent.setup();
    render(<DealAnalyzerForm />);
    await reachStep4(user);
    await openRefiSection(user);
    await enableRefi(user);
    await calculate(user);

    // refiYear=0 means no year selected — the year warning appears
    expect(screen.getByTestId('refi-year-warning')).toBeInTheDocument();
  });

  it('year warning clears after selecting a refi year', async () => {
    const user = userEvent.setup();
    render(<DealAnalyzerForm />);
    await reachStep4(user);
    await openRefiSection(user);
    await enableRefi(user);
    await calculate(user);

    expect(screen.getByTestId('refi-year-warning')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /yr 3/i }));

    expect(screen.queryByTestId('refi-year-warning')).not.toBeInTheDocument();
  });
});
