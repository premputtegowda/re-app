/**
 * Tests for cash-out refi warnings and refi year default behaviour:
 *
 * Warnings (showWarnings kicks in after step 4 is completed via "Done"):
 *   - Section header shows AlertTriangle when refi enabled and any field is missing
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
 *
 * Calculate button and results area:
 *   - "Fill missing fields" message shown when all steps done but warnings exist
 *   - Calculate button shown only when all steps done with no warnings
 *   - "Incomplete" banner shown in results area when results exist but warnings present
 *
 * Flow: showWarnings = completedSteps.has(4), true after "Done" on step 4.
 * Field-level warnings visible when step 4 is open in editing mode.
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

/** Navigate to step 4, entering a purchase price so the form is not entirely empty. */
async function reachStep4(user: User) {
  await user.type(screen.getByPlaceholderText(/123 main st/i), '10 Oak Ave');
  await user.click(screen.getByTestId('header-next-btn')); // → step 1
  const [priceInput] = screen.getAllByRole('spinbutton');
  await user.clear(priceInput);
  await user.type(priceInput, '300000');
  await user.click(screen.getByTestId('header-next-btn')); // → step 2
  await user.click(screen.getByTestId('header-next-btn')); // → step 3
  await user.click(screen.getByTestId('header-next-btn')); // → step 4
}

/** Complete step 4 ("Done") — marks it visited so showWarnings becomes true. */
async function doneStep4(user: User) {
  await user.click(screen.getByTestId('header-next-btn'));
}

/**
 * Open step 4 in editing mode so field-level warnings are visible.
 * Must be called after doneStep4 (step 4 must be in the summary bar).
 */
async function openStep4Editing(user: User) {
  await user.click(screen.getByTestId('step-summary-4'));
}

/** Open the Cash-Out Refinance collapsible. */
async function openRefiSection(user: User) {
  await user.click(screen.getByRole('button', { name: /cash-out refinance/i }));
}

/** Enable "Model a cash-out refinance" checkbox. */
async function enableRefi(user: User) {
  await user.click(screen.getByRole('checkbox', { name: /model a cash-out refinance/i }));
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

  it('shows no step-4 warning when refi is disabled and exit value is filled', async () => {
    const user = userEvent.setup();
    render(<DealAnalyzerForm />);
    await reachStep4(user);
    await user.type(screen.getByLabelText(/exit value \/ arv/i), '400000');
    await doneStep4(user);

    expect(screen.queryByTestId('step-warning-4')).not.toBeInTheDocument();
  });

  it('step 4 summary bar shows warning when refi enabled with missing fields', async () => {
    const user = userEvent.setup();
    render(<DealAnalyzerForm />);
    await reachStep4(user);
    await openRefiSection(user);
    await enableRefi(user);
    await doneStep4(user);

    expect(screen.getByTestId('step-warning-4')).toBeInTheDocument();
  });

  it('shows section header warning in editing mode when refi enabled with all fields empty', async () => {
    const user = userEvent.setup();
    render(<DealAnalyzerForm />);
    await reachStep4(user);
    await openRefiSection(user);
    await enableRefi(user);
    await doneStep4(user);
    await openStep4Editing(user);

    expect(screen.getByTestId('refi-section-warning')).toBeInTheDocument();
  });

  it('hides "active" badge while refi has missing fields', async () => {
    const user = userEvent.setup();
    render(<DealAnalyzerForm />);
    await reachStep4(user);
    await openRefiSection(user);
    await enableRefi(user);
    await doneStep4(user);
    await openStep4Editing(user);

    expect(screen.queryByText('active')).not.toBeInTheDocument();
  });

  it('shows warning on Market Value at Refi when empty', async () => {
    const user = userEvent.setup();
    render(<DealAnalyzerForm />);
    await reachStep4(user);
    await openRefiSection(user);
    await enableRefi(user);
    await doneStep4(user);
    await openStep4Editing(user);

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
    await doneStep4(user);
    await openStep4Editing(user);

    expect(screen.getByTestId('refi-year-warning')).toBeInTheDocument();
  });

  it('shows warning on New LTV when empty', async () => {
    const user = userEvent.setup();
    render(<DealAnalyzerForm />);
    await reachStep4(user);
    await openRefiSection(user);
    await enableRefi(user);
    await doneStep4(user);
    await openStep4Editing(user);

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
    await doneStep4(user);
    await openStep4Editing(user);

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
    await doneStep4(user);
    await openStep4Editing(user);

    const labelEl = screen.getByLabelText(/new loan term/i)
      .closest('div')
      ?.querySelector('label');
    expect(labelEl?.querySelector('svg')).not.toBeNull();
  });

  it('clears section header warning and field warnings when all refi fields are filled', async () => {
    const user = userEvent.setup();
    render(<DealAnalyzerForm />);
    await reachStep4(user);
    await openRefiSection(user);
    await enableRefi(user);
    await doneStep4(user);
    await openStep4Editing(user);

    expect(screen.getByTestId('refi-section-warning')).toBeInTheDocument();

    await fillAllRefiFields(user);

    expect(screen.queryByTestId('refi-section-warning')).not.toBeInTheDocument();
    expect(screen.queryByTestId('refi-year-warning')).not.toBeInTheDocument();
  });

  it('step 4 summary bar warning clears after filling all refi fields and clicking Done', async () => {
    const user = userEvent.setup();
    render(<DealAnalyzerForm />);
    await reachStep4(user);
    await user.type(screen.getByLabelText(/exit value \/ arv/i), '400000');
    await openRefiSection(user);
    await enableRefi(user);
    await doneStep4(user);

    expect(screen.getByTestId('step-warning-4')).toBeInTheDocument();

    await openStep4Editing(user);
    await fillAllRefiFields(user);
    await user.click(screen.getByRole('button', { name: /^done$/i }));

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
    await doneStep4(user);
    await openStep4Editing(user);

    // refiYear=0 means no year selected — year warning fires
    expect(screen.getByTestId('refi-year-warning')).toBeInTheDocument();
  });

  it('year warning clears after selecting a refi year', async () => {
    const user = userEvent.setup();
    render(<DealAnalyzerForm />);
    await reachStep4(user);
    await openRefiSection(user);
    await enableRefi(user);
    await doneStep4(user);
    await openStep4Editing(user);

    expect(screen.getByTestId('refi-year-warning')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /yr 3/i }));

    expect(screen.queryByTestId('refi-year-warning')).not.toBeInTheDocument();
  });
});

describe('Calculate button and results area messages', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('shows "fill missing fields" message when all steps done but warnings exist', async () => {
    const user = userEvent.setup();
    render(<DealAnalyzerForm />);
    await reachStep4(user);
    // Skip ARV → step 4 warning exists
    await doneStep4(user);

    expect(screen.getByTestId('calc-missing-fields-msg')).toBeInTheDocument();
    expect(screen.queryByTestId('calculate-btn')).not.toBeInTheDocument();
  });

  it('Calculate button not shown until all 5 steps are completed', async () => {
    const user = userEvent.setup();
    render(<DealAnalyzerForm />);
    await reachStep4(user);
    // Step 4 active but not yet Done — no calculate area at all
    expect(screen.queryByTestId('calculate-btn')).not.toBeInTheDocument();
    expect(screen.queryByTestId('calc-missing-fields-msg')).not.toBeInTheDocument();
  });
});
