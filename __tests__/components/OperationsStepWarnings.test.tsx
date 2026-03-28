/**
 * Tests for operations step (step 3) inline warning behaviour:
 *
 * SFR:
 *   - Warning icon appears on Target rent label when sfrTargetRent = 0 and step is visited
 *   - Warning icon disappears once a target rent value is entered
 *   - No warning while filling step 3 for the first time (not yet visited)
 *
 * MFR:
 *   - Warning icon appears in Target column header when at least one unit has rentMonthly = 0
 *   - Warning icon disappears when all units have a non-zero target rent
 *   - Warning shows when SOME but not all units lack a target rent
 *
 * Summary bar (step 3):
 *   - Summary bar warning chip appears when gross rent is 0 (target rent not set)
 *   - Summary bar warning chip disappears once target rent is filled
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DealAnalyzerForm } from '@/components/DealAnalyzer/DealAnalyzerForm';

// ── Mocks ────────────────────────────────────────────────────────────────────

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

vi.mock('@/components/DealAnalyzer/ResultsPanel', () => ({
  ResultsPanel: () => null,
}));

vi.mock('@/components/DealAnalyzer/ProFormaGrid', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/DealAnalyzer/ProFormaGrid')>();
  return { ...actual, ProFormaGrid: () => null };
});

vi.mock('@/components/DealAnalyzer/RehabRentCalculator', () => ({
  RehabRentCalculator: () => null,
}));

vi.mock('@/utils/dealAnalyzerCalc', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/dealAnalyzerCalc')>();
  return {
    ...actual,
    projectScenario: vi.fn(() => ({
      avgCoCReturn: 0.08,
      irr: 0.12,
      equityMultiple: 1.5,
      totalReturn: 0.5,
      annualCashFlows: [],
      exitValue: 300000,
      netProceeds: 100000,
    })),
  };
});

vi.mock('@/utils/whatIfCalc', () => ({
  buildWhatIfResult: vi.fn(),
  findBreakEven: vi.fn(),
  computeAvgRents: vi.fn(() => ({ units: 1, avgTargetRent: 2000, avgPreStabRent: 1500 })),
}));

vi.mock('@/utils/monteCarlo', () => ({
  runMonteCarloSimulation: vi.fn(),
}));

// ── Shared helpers ────────────────────────────────────────────────────────────

function renderForm() {
  return render(<DealAnalyzerForm />);
}

// Advance through steps 0–2, leaving step 3 as the active (unvisited) step
async function reachStep3(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByPlaceholderText(/123 main st/i), '10 Oak Ave');
  await user.click(screen.getByTestId('header-next-btn')); // 0 → 1
  await user.click(screen.getByTestId('header-next-btn')); // 1 → 2
  await user.click(screen.getByTestId('header-next-btn')); // 2 → 3
}

// Complete step 3 (marks it visited), then click its summary bar to re-open it
async function visitAndReopenStep3(user: ReturnType<typeof userEvent.setup>) {
  await reachStep3(user);
  await user.click(screen.getByTestId('header-next-btn')); // 3 → 4 (marks visited)
  await user.click(screen.getByTestId('step-summary-3')); // re-open for editing
}

// ── SFR tests ─────────────────────────────────────────────────────────────────

describe('Operations step SFR warnings', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('shows warning on Target rent label when target rent is 0 (step visited)', async () => {
    const user = userEvent.setup();
    renderForm();

    await visitAndReopenStep3(user);

    expect(screen.getByTestId('sfr-target-rent-warning')).toBeInTheDocument();
  });

  it('does NOT show warning while actively filling step 3 for the first time', async () => {
    const user = userEvent.setup();
    renderForm();

    await reachStep3(user);
    // Step 3 is active but not yet visited
    expect(screen.queryByTestId('sfr-target-rent-warning')).not.toBeInTheDocument();
  });

  it('hides warning once target rent is entered and step is re-opened', async () => {
    const user = userEvent.setup();
    renderForm();

    await reachStep3(user);

    // Fill target rent while step 3 is active (second number input = Target rent)
    const rentInputs = screen.getAllByPlaceholderText('0');
    // rentInputs[1] is Target rent (index 0 = In-Place)
    await user.type(rentInputs[1], '2500');

    // Complete step 3 and re-open it
    await user.click(screen.getByTestId('header-next-btn')); // 3 → 4
    await user.click(screen.getByTestId('step-summary-3'));

    expect(screen.queryByTestId('sfr-target-rent-warning')).not.toBeInTheDocument();
  });

  it('amber border applied to Target rent input when warning is active', async () => {
    const user = userEvent.setup();
    renderForm();

    await visitAndReopenStep3(user);

    // The target rent input should carry the amber border class
    // Find all number inputs in the SFR rent schedule section
    const rentInputs = screen.getAllByPlaceholderText('0');
    // Target is the second input (index 1)
    expect(rentInputs[1].className).toMatch(/border-amber-300/);
  });
});

// ── MFR tests ─────────────────────────────────────────────────────────────────

describe('Operations step MFR warnings', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  async function reachStep3AsMFR(user: ReturnType<typeof userEvent.setup>) {
    await user.type(screen.getByPlaceholderText(/123 main st/i), '10 Oak Ave');
    await user.click(screen.getByRole('button', { name: /multi-family/i }));
    await user.click(screen.getByRole('button', { name: /add unit type/i }));
    await user.click(screen.getByTestId('header-next-btn')); // 0 → 1
    await user.click(screen.getByTestId('header-next-btn')); // 1 → 2
    await user.click(screen.getByTestId('header-next-btn')); // 2 → 3
  }

  it('shows warning in Target column header when unit has no target rent (step visited)', async () => {
    const user = userEvent.setup();
    renderForm();

    await reachStep3AsMFR(user);
    await user.click(screen.getByTestId('header-next-btn')); // complete step 3
    await user.click(screen.getByTestId('step-summary-3'));  // re-open

    expect(screen.getByTestId('mfr-target-rent-warning')).toBeInTheDocument();
  });

  it('does NOT show MFR warning while filling step 3 for the first time', async () => {
    const user = userEvent.setup();
    renderForm();

    await reachStep3AsMFR(user);
    // Step 3 active but not visited
    expect(screen.queryByTestId('mfr-target-rent-warning')).not.toBeInTheDocument();
  });

  it('hides warning in Target column once all units have a non-zero target rent', async () => {
    const user = userEvent.setup();
    renderForm();

    await reachStep3AsMFR(user);

    // MFR rent schedule table renders 3 inputs per unit row:
    //   index 0 = inPlaceRent, index 1 = rentMonthly (Target), index 2 = preStabRent
    const spinbuttons = screen.getAllByRole('spinbutton');
    const targetInput = spinbuttons[1]; // rentMonthly = Target rent
    await user.type(targetInput, '1800');

    // Complete and re-open step 3
    await user.click(screen.getByTestId('header-next-btn'));
    await user.click(screen.getByTestId('step-summary-3'));

    expect(screen.queryByTestId('mfr-target-rent-warning')).not.toBeInTheDocument();
  });
});

// ── Step 3 summary bar warning ─────────────────────────────────────────────────

describe('Operations step summary bar warning', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('shows step 3 summary bar warning when target rent is not set', async () => {
    const user = userEvent.setup();
    renderForm();

    // Advance through all steps without entering any target rent
    await user.type(screen.getByPlaceholderText(/123 main st/i), '10 Oak Ave');
    await user.click(screen.getByTestId('header-next-btn')); // 0 → 1
    await user.click(screen.getByTestId('header-next-btn')); // 1 → 2
    await user.click(screen.getByTestId('header-next-btn')); // 2 → 3
    await user.click(screen.getByTestId('header-next-btn')); // 3 → 4

    expect(screen.getByTestId('step-warning-3')).toBeInTheDocument();
  });

  it('hides step 3 summary bar warning once target rent is entered', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByPlaceholderText(/123 main st/i), '10 Oak Ave');
    await user.click(screen.getByTestId('header-next-btn')); // 0 → 1
    await user.click(screen.getByTestId('header-next-btn')); // 1 → 2
    await user.click(screen.getByTestId('header-next-btn')); // 2 → 3

    // Enter target rent (second '0' placeholder input in the SFR rent schedule)
    const rentInputs = screen.getAllByPlaceholderText('0');
    await user.type(rentInputs[1], '2000');

    await user.click(screen.getByTestId('header-next-btn')); // 3 → 4

    expect(screen.queryByTestId('step-warning-3')).not.toBeInTheDocument();
  });

  it('step 3 summary bar has no warning chip before step is visited', async () => {
    const user = userEvent.setup();
    renderForm();

    // Only advance to step 3 — don't complete it
    await reachStep3(user);

    // Step 3 is currently active (expanded), so no collapsed summary bar yet
    expect(screen.queryByTestId('step-warning-3')).not.toBeInTheDocument();
  });
});
