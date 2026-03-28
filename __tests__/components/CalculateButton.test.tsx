/**
 * Tests for the standalone Calculate button (outside Exit & Refi card):
 *
 * Visibility rules (gates are evaluated after allStepsCompleted = true):
 *   - "calc-missing-fields-msg" shown when allStepsCompleted + hasAnyWarning + !hasAnyResult
 *   - "calculate-btn" shown when allStepsCompleted + !hasAnyWarning + !hasAnyResult
 *   - After clicking Calculate: button disappears (hasAnyResult becomes true)
 *   - "calc-incomplete-warning" shown when hasAnyResult + hasAnyWarning
 *
 * Nothing in the Calculate area renders until ALL 5 steps are marked done.
 *
 * Step warnings that must be cleared for "calculate-btn" to appear:
 *   - Step 0: SFR → beds AND baths must be filled
 *   - Step 1: purchasePrice > 0, downPaymentPct > 0 (100 = cash, no interest/term needed)
 *   - Step 2: no warning when no cost items with empty amounts (default state)
 *   - Step 3: grossRent.stabilized > 0 — provided via defaultProForma override below
 *   - Step 4: arv > 0 (value method)
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

// Override defaultProForma to return non-zero grossRent.stabilized so that
// step 3 (Operations) never fires a warning in tests (ProFormaGrid is mocked
// away and there is no other way to set grossRent.stabilized via UI).
vi.mock('@/components/DealAnalyzer/ProFormaGrid', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/DealAnalyzer/ProFormaGrid')>();
  return {
    ...actual,
    ProFormaGrid: () => null,
    defaultProForma: (_type: 'sfr' | 'mfr') => ({
      ...actual.defaultProForma('sfr'),
      grossRent: { t12: 2000, stab: null, stabilized: 2000, growthPct: 3 },
    }),
  };
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
 * Complete all 5 steps with no warnings so that the Calculate button appears.
 *
 * Step 0: address + SFR beds (3) + baths (2)
 * Step 1: purchase price $300k + 100% down (cash deal — no interest/term needed)
 * Step 2: no cost items — no warning in default state
 * Step 3: grossRent.stabilized=2000 via defaultProForma mock — no warning
 * Step 4: ARV $400k + Done
 */
async function completeAllStepsNoWarnings(user: User) {
  // Step 0 — Property
  await user.type(screen.getByPlaceholderText(/123 main st/i), '10 Oak Ave');
  // Beds and baths use raw <input> without linked <label>, query by spinbutton order
  const [bedsInput, bathsInput] = screen.getAllByRole('spinbutton');
  await user.type(bedsInput, '3');
  await user.type(bathsInput, '2');
  await user.click(screen.getByTestId('header-next-btn')); // → step 1

  // Step 1 — Financing: cash deal clears all loan-field warnings
  await user.type(screen.getByLabelText(/purchase price/i), '300000');
  await user.type(screen.getByLabelText(/down payment/i), '100');
  await user.click(screen.getByTestId('header-next-btn')); // → step 2

  // Step 2 — Renovation: no items → no warning
  await user.click(screen.getByTestId('header-next-btn')); // → step 3

  // Step 3 — Operations: grossRent.stabilized=2000 via mock → no warning
  await user.click(screen.getByTestId('header-next-btn')); // → step 4

  // Step 4 — Exit & Refi: fill ARV, click Done
  await user.type(screen.getByLabelText(/exit value \/ arv/i), '400000');
  await user.click(screen.getByTestId('header-next-btn')); // Done → allStepsCompleted
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Calculate button visibility', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('calculate button not shown while any step is still active (not yet Done)', async () => {
    const user = userEvent.setup();
    render(<DealAnalyzerForm />);

    // Navigate to step 4 but do not click Done
    await user.type(screen.getByPlaceholderText(/123 main st/i), '10 Oak Ave');
    await user.click(screen.getByTestId('header-next-btn')); // → step 1
    await user.click(screen.getByTestId('header-next-btn')); // → step 2
    await user.click(screen.getByTestId('header-next-btn')); // → step 3
    await user.click(screen.getByTestId('header-next-btn')); // → step 4

    // allStepsCompleted is false → entire calculate area is hidden
    expect(screen.queryByTestId('calculate-btn')).not.toBeInTheDocument();
    expect(screen.queryByTestId('calc-missing-fields-msg')).not.toBeInTheDocument();
  });

  it('shows "fill missing fields" message when all steps done but warnings exist', async () => {
    const user = userEvent.setup();
    render(<DealAnalyzerForm />);

    // Go through all steps but leave ARV empty (step 4 warning)
    await user.type(screen.getByPlaceholderText(/123 main st/i), '10 Oak Ave');
    await user.click(screen.getByTestId('header-next-btn')); // → step 1
    await user.click(screen.getByTestId('header-next-btn')); // → step 2
    await user.click(screen.getByTestId('header-next-btn')); // → step 3
    await user.click(screen.getByTestId('header-next-btn')); // → step 4
    // Done without filling ARV → hasAnyWarning = true
    await user.click(screen.getByTestId('header-next-btn')); // Done

    expect(screen.getByTestId('calc-missing-fields-msg')).toBeInTheDocument();
    expect(screen.queryByTestId('calculate-btn')).not.toBeInTheDocument();
  });

  it('shows calculate button when all steps done with no warnings', async () => {
    const user = userEvent.setup();
    render(<DealAnalyzerForm />);

    await completeAllStepsNoWarnings(user);

    expect(screen.getByTestId('calculate-btn')).toBeInTheDocument();
    expect(screen.queryByTestId('calc-missing-fields-msg')).not.toBeInTheDocument();
  });
});

describe('Calculate button behaviour after click', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('button disappears after clicking Calculate (results now exist)', async () => {
    const user = userEvent.setup();
    render(<DealAnalyzerForm />);

    await completeAllStepsNoWarnings(user);
    expect(screen.getByTestId('calculate-btn')).toBeInTheDocument();

    await user.click(screen.getByTestId('calculate-btn'));

    expect(screen.queryByTestId('calculate-btn')).not.toBeInTheDocument();
  });

  it('shows "calc-incomplete-warning" banner when results exist but a warning is introduced', async () => {
    const user = userEvent.setup();
    render(<DealAnalyzerForm />);

    // Calculate successfully (no warnings)
    await completeAllStepsNoWarnings(user);
    await user.click(screen.getByTestId('calculate-btn'));
    expect(screen.queryByTestId('calculate-btn')).not.toBeInTheDocument();

    // Open step 4 in editing mode and clear ARV → arv=0 → step 4 warning fires
    await user.click(screen.getByTestId('step-summary-4'));
    const arvInput = screen.getByLabelText(/exit value \/ arv/i);
    await user.clear(arvInput);

    expect(screen.getByTestId('calc-incomplete-warning')).toBeInTheDocument();
    // Calculate button must NOT reappear — results already exist
    expect(screen.queryByTestId('calculate-btn')).not.toBeInTheDocument();
  });
});
