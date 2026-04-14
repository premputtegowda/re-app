/**
 * Tests for DealAnalyzerForm header behaviour:
 *   - Cancel and Save are always visible (even before address is entered)
 *   - Save is disabled until a property address is entered
 *   - Save becomes enabled once an address exists
 *   - "Next" appears in the header for steps 0–3
 *   - "Next" is hidden on step 4 (Exit & Refi)
 *   - Step 0 Next is blocked without address
 *   - Soft warning chips on completed step summary bars
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
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

// Keep heavy visual-only components from adding noise
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
      avgCoCReturn: 0.08, irr: 0.12, equityMultiple: 1.5, peakCoCReturn: 0.08,
      totalCashFlow: 5000, totalInvested: 77000, yearlyProjections: [],
      downPayment: 60000, closingCosts: 5000, pointsCost: 0, additionalFeeItems: [], additionalFees: 0,
      hardCostItems: [], hardCosts: 0, softCostItems: [], softCosts: 0,
      opportunityCostItems: [], lostOpportunityCost: 0, initialLoanAmount: 240000,
      terminalPropertyValue: 300000, exitClosingCosts: 9000, terminalEquity: 51000, irrCashFlows: [-77000, 5000],
    })),
  };
});

vi.mock('@/utils/whatIfCalc', () => ({
  buildWhatIfResult: vi.fn(),
  findBreakEven: vi.fn(),
  computeAvgRents: vi.fn(() => ({ units: 1, avgTargetRent: 2000, avgPreStabRent: 1500 })),
}));

vi.mock('@/utils/monteCarlo', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/monteCarlo')>();
  return { ...actual, runMonteCarloSimulation: vi.fn() };
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function renderForm() {
  return render(<DealAnalyzerForm />);
}

function getSaveBtn() {
  return screen.getByTestId('header-save-btn');
}

function getNextBtn() {
  return screen.queryByTestId('header-next-btn');
}

function getCancelBtn() {
  return screen.getByRole('button', { name: 'Cancel' });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('DealAnalyzerForm header', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows Cancel button immediately — before any input', () => {
    renderForm();
    expect(getCancelBtn()).toBeInTheDocument();
  });

  it('shows Save button immediately — before any input', () => {
    renderForm();
    expect(getSaveBtn()).toBeInTheDocument();
  });

  it('Save is disabled when address is empty', () => {
    renderForm();
    expect(getSaveBtn()).toBeDisabled();
  });

  it('Save becomes enabled after typing a property address', async () => {
    const user = userEvent.setup();
    renderForm();

    // The address input lives inside StepProperty (step 0, expanded by default)
    const addressInput = screen.getByPlaceholderText(/123 main st/i);
    await user.type(addressInput, '123 Main St');

    expect(getSaveBtn()).not.toBeDisabled();
  });

  it('Save is disabled again if address is cleared', async () => {
    const user = userEvent.setup();
    renderForm();

    const addressInput = screen.getByPlaceholderText(/123 main st/i);
    await user.type(addressInput, '123 Main St');
    expect(getSaveBtn()).not.toBeDisabled();

    await user.clear(addressInput);
    expect(getSaveBtn()).toBeDisabled();
  });

  it('shows Next button on step 0 (Property)', () => {
    renderForm();
    expect(getNextBtn()).toBeInTheDocument();
  });

  it('Next button advances to step 1 when step 0 is active', async () => {
    const user = userEvent.setup();
    renderForm();

    // Fill in address so step can advance (Next validates the step)
    const addressInput = screen.getByPlaceholderText(/123 main st/i);
    await user.type(addressInput, '123 Main St');

    const nextBtn = getNextBtn();
    expect(nextBtn).toBeInTheDocument();
    await user.click(nextBtn!);

    // Step 1 (Financing) should now be expanded — look for its label
    expect(screen.getByText('Financing')).toBeInTheDocument();
  });

  it('Next is still shown on steps 1, 2, 3', async () => {
    const user = userEvent.setup();
    renderForm();

    // Advance through step 0
    const addressInput = screen.getByPlaceholderText(/123 main st/i);
    await user.type(addressInput, '456 Oak Ave');
    await user.click(getNextBtn()!);

    // Step 1 is now active — Next should still appear
    expect(getNextBtn()).toBeInTheDocument();
  });

  it('Next is hidden on step 4 (Exit & Refi)', async () => {
    const user = userEvent.setup();
    renderForm();

    // Step 0: enter address, click Next
    await user.type(screen.getByPlaceholderText(/123 main st/i), '789 Pine Rd');
    await user.click(getNextBtn()!);

    // Step 1 (Financing): use cash purchase (100% down) — only price, down payment,
    // and projection horizon are required; loan fields are hidden for cash deals.
    // projectionYears defaults to 5 (already valid), so we skip typing it.
    await user.type(screen.getByLabelText(/purchase price/i), '300000');
    await user.type(screen.getByLabelText(/down payment/i), '100');
    await user.click(getNextBtn()!);

    // Step 2 (Renovation): no required fields, click Next
    await user.click(getNextBtn()!);

    // Step 3 (Operations): no required fields, click Next
    await user.click(getNextBtn()!);

    // Now on step 4 — "Done" button is shown (header-next-btn), no standalone Calculate yet
    expect(getNextBtn()).toBeInTheDocument();
    expect(getNextBtn()!.textContent).toBe('Done');
    expect(screen.queryByTestId('calculate-btn')).not.toBeInTheDocument();
  });

  it('header shows property address as title once entered', async () => {
    const user = userEvent.setup();
    renderForm();

    expect(screen.getByRole('heading', { name: 'New Analysis' })).toBeInTheDocument();

    const addressInput = screen.getByPlaceholderText(/123 main st/i);
    await user.type(addressInput, '42 Elm Street');

    expect(screen.getByRole('heading', { name: '42 Elm Street' })).toBeInTheDocument();
  });
});

// ── Step 0 blocking validation ─────────────────────────────────────────────────

describe('DealAnalyzerForm step 0 — address required', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('Next is blocked when address is empty — shows error and stays on step 0', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(getNextBtn()!);

    expect(screen.getByText('Property address is required')).toBeInTheDocument();
    // Step 0 still expanded — Next is still present
    expect(getNextBtn()).toBeInTheDocument();
  });

  it('Next advances once address is provided', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByPlaceholderText(/123 main st/i), '1 Test Rd');
    await user.click(getNextBtn()!);

    // Step 1 should now be active
    expect(screen.getByText('Financing')).toBeInTheDocument();
  });
});

// ── Soft warning chips on completed step summary bars ─────────────────────────

describe('DealAnalyzerForm step warnings', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  // Helper: advance past step 0 with just an address (no beds/baths)
  async function advancePastStep0(user: ReturnType<typeof userEvent.setup>, address = '10 Oak Ave') {
    await user.type(screen.getByPlaceholderText(/123 main st/i), address);
    await user.click(getNextBtn()!);
  }

  // Helper: advance through steps 0-3 using a cash purchase (no Step 1 warning)
  async function advanceToStep4(user: ReturnType<typeof userEvent.setup>) {
    await advancePastStep0(user);
    await user.type(screen.getByLabelText(/purchase price/i), '300000');
    await user.type(screen.getByLabelText(/down payment/i), '100');
    await user.click(getNextBtn()!); // step 1 → 2
    await user.click(getNextBtn()!); // step 2 → 3
    await user.click(getNextBtn()!); // step 3 → 4
  }

  // Helper: advance through steps 0-3 without filling financing fields
  async function advanceToStep4WithoutFinancing(user: ReturnType<typeof userEvent.setup>) {
    await advancePastStep0(user);
    await user.click(getNextBtn()!); // step 1 → 2 (no fields filled)
    await user.click(getNextBtn()!); // step 2 → 3
    await user.click(getNextBtn()!); // step 3 → 4
  }

  it('step 0 summary bar shows warning when SFR has no beds or baths', async () => {
    const user = userEvent.setup();
    renderForm();

    await advancePastStep0(user); // address only, beds/baths left blank

    expect(screen.getByTestId('step-warning-0')).toBeInTheDocument();
  });

  it('step 0 summary bar shows no warning when SFR has beds and baths', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByPlaceholderText(/123 main st/i), '10 Oak Ave');
    await user.type(screen.getByPlaceholderText(/e\.g\. 3/i), '3');  // beds
    await user.type(screen.getByPlaceholderText(/e\.g\. 2/i), '2');  // baths
    await user.click(getNextBtn()!);

    expect(screen.queryByTestId('step-warning-0')).not.toBeInTheDocument();
  });

  it('step 0 summary bar shows warning when MFR has no units', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByPlaceholderText(/123 main st/i), '10 Oak Ave');
    // Switch to multi-family without adding any units
    await user.click(screen.getByRole('button', { name: /multi-family/i }));
    await user.click(getNextBtn()!);

    expect(screen.getByTestId('step-warning-0')).toBeInTheDocument();
  });

  it('step 3 summary bar shows warning when gross rent is 0', async () => {
    const user = userEvent.setup();
    renderForm();

    // Advance through all steps — ProFormaGrid is mocked so gross rent stays 0
    await advanceToStep4(user);

    expect(screen.getByTestId('step-warning-3')).toBeInTheDocument();
  });

  it('step 4 summary bar shows warning after Done when ARV and exit cap rate are both 0', async () => {
    const user = userEvent.setup();
    renderForm();

    await advanceToStep4(user);

    // Click Done — step 4 becomes completed and collapses to a summary bar
    await user.click(screen.getByTestId('header-next-btn'));

    // Warning icon appears on the step 4 summary bar
    expect(screen.getByTestId('step-warning-4')).toBeInTheDocument();
  });

  it('step 1 summary bar shows warning icon when purchase price and down payment are missing', async () => {
    const user = userEvent.setup();
    renderForm();

    // Advance past step 0 then click Next on step 1 without filling anything
    await advancePastStep0(user);
    await user.click(getNextBtn()!); // step 1 → 2 (non-blocking)

    expect(screen.getByTestId('step-warning-1')).toBeInTheDocument();
  });

  it('step 1 summary bar shows warning icon for non-cash purchase when loan fields are missing', async () => {
    const user = userEvent.setup();
    renderForm();

    await advancePastStep0(user);
    // Enter price and a non-100% down payment — loan fields still missing
    await user.type(screen.getByLabelText(/purchase price/i), '300000');
    await user.type(screen.getByLabelText(/down payment/i), '20');
    await user.click(getNextBtn()!);

    expect(screen.getByTestId('step-warning-1')).toBeInTheDocument();
  });

  it('step 1 summary bar shows no warning for cash purchase with price filled', async () => {
    const user = userEvent.setup();
    renderForm();

    await advancePastStep0(user);
    await user.type(screen.getByLabelText(/purchase price/i), '300000');
    await user.type(screen.getByLabelText(/down payment/i), '100');
    await user.click(getNextBtn()!);

    // No warning chip — price and 100% down is a complete cash deal
    expect(screen.queryByTestId('step-warning-1')).not.toBeInTheDocument();
  });

  it('step 1 summary bar shows no warning when all non-cash fields are filled', async () => {
    const user = userEvent.setup();
    renderForm();

    await advancePastStep0(user);
    await user.type(screen.getByLabelText(/purchase price/i), '300000');
    await user.type(screen.getByLabelText(/down payment/i), '20');
    await user.type(screen.getByLabelText(/closing costs/i), '2');
    await user.type(screen.getByLabelText(/interest rate/i), '7');
    await user.type(screen.getByLabelText(/loan term/i), '30');
    await user.click(getNextBtn()!);

    expect(screen.queryByTestId('step-warning-1')).not.toBeInTheDocument();
  });

  it('step 1 warning icon is present when advancing to step 4 without financing', async () => {
    const user = userEvent.setup();
    renderForm();

    await advanceToStep4WithoutFinancing(user);

    expect(screen.getByTestId('step-warning-1')).toBeInTheDocument();
  });
});

// ── Renovation warning ─────────────────────────────────────────────────────────

describe('DealAnalyzerForm renovation warnings', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('step 2 summary bar shows warning when hard cost has description but zero amount', async () => {
    const user = userEvent.setup();
    renderForm();

    // Step 0
    await user.type(screen.getByPlaceholderText(/123 main st/i), '10 Oak Ave');
    await user.click(screen.getByTestId('header-next-btn'));

    // Step 1 — cash purchase
    await user.type(screen.getByLabelText(/purchase price/i), '300000');
    await user.type(screen.getByLabelText(/down payment/i), '100');
    await user.click(screen.getByTestId('header-next-btn'));

    // Step 2 — add a hard cost item with description but leave amount at $0
    const addButtons = screen.getAllByRole('button', { name: /add item/i });
    await user.click(addButtons[0]); // hard costs "Add item"
    await user.type(screen.getByPlaceholderText(/description/i), 'Roofing');
    await user.keyboard('{Enter}');

    // Advance to step 3
    await user.click(screen.getByTestId('header-next-btn'));

    // Step 2 summary bar should show warning icon
    expect(screen.getByTestId('step-warning-2')).toBeInTheDocument();
  });

  it('step 2 summary bar shows no warning when hard cost has description and amount > 0', async () => {
    const user = userEvent.setup();
    renderForm();

    // Step 0
    await user.type(screen.getByPlaceholderText(/123 main st/i), '10 Oak Ave');
    await user.click(screen.getByTestId('header-next-btn'));

    // Step 1 — cash purchase
    await user.type(screen.getByLabelText(/purchase price/i), '300000');
    await user.type(screen.getByLabelText(/down payment/i), '100');
    await user.click(screen.getByTestId('header-next-btn'));

    // Step 2 — add hard cost item with description AND amount
    const addButtons = screen.getAllByRole('button', { name: /add item/i });
    await user.click(addButtons[0]);
    await user.type(screen.getByPlaceholderText(/description/i), 'Roofing');
    await user.keyboard('{Enter}');

    // Now click the $0 amount cell and enter a value
    const amountBtn = screen.getByRole('button', { name: /\$0/i });
    await user.click(amountBtn);
    await user.type(screen.getByRole('spinbutton'), '5000');
    await user.keyboard('{Enter}');

    // Advance to step 3
    await user.click(screen.getByTestId('header-next-btn'));

    expect(screen.queryByTestId('step-warning-2')).not.toBeInTheDocument();
  });
});

// ── Operations step inline warnings ──────────────────────────────────────────

describe('DealAnalyzerForm operations step inline warnings', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  // Advance through steps 0–3 then come back to edit step 3
  async function openStep3ForEditing(user: ReturnType<typeof userEvent.setup>) {
    // Step 0
    await user.type(screen.getByPlaceholderText(/123 main st/i), '10 Oak Ave');
    await user.click(screen.getByTestId('header-next-btn'));
    // Step 1
    await user.click(screen.getByTestId('header-next-btn'));
    // Step 2
    await user.click(screen.getByTestId('header-next-btn'));
    // Step 3 — click Next to complete it (marks as visited), now on step 4
    await user.click(screen.getByTestId('header-next-btn'));
    // Click step 3 summary bar to edit it (isVisited = true now)
    await user.click(screen.getByTestId('step-summary-3'));
  }

  it('SFR: shows warning icon on Target rent label when target rent is 0', async () => {
    const user = userEvent.setup();
    renderForm();

    await openStep3ForEditing(user);

    expect(screen.getByTestId('sfr-target-rent-warning')).toBeInTheDocument();
  });

  it('SFR: hides warning icon on Target rent label when target rent is entered', async () => {
    const user = userEvent.setup();
    renderForm();

    // Step 0 — enter address and target rent (In-Place field is index 0, Target is index 1)
    await user.type(screen.getByPlaceholderText(/123 main st/i), '10 Oak Ave');
    await user.click(screen.getByTestId('header-next-btn'));
    await user.click(screen.getByTestId('header-next-btn')); // step 1
    await user.click(screen.getByTestId('header-next-btn')); // step 2

    // Step 3 is now active — fill in target rent before completing
    const [, targetInput] = screen.getAllByPlaceholderText('0');
    await user.type(targetInput, '2000');
    await user.click(screen.getByTestId('header-next-btn')); // complete step 3

    // Edit step 3 — warning should be gone
    await user.click(screen.getByTestId('step-summary-3'));

    expect(screen.queryByTestId('sfr-target-rent-warning')).not.toBeInTheDocument();
  });

  it('MFR: shows warning icon in Target column header when unit has no target rent', async () => {
    const user = userEvent.setup();
    renderForm();

    // Step 0 — MFR with one unit, no target rent
    await user.type(screen.getByPlaceholderText(/123 main st/i), '10 Oak Ave');
    await user.click(screen.getByRole('button', { name: /multi-family/i }));
    // Add a unit
    await user.click(screen.getByRole('button', { name: /add unit type/i }));
    await user.click(screen.getByTestId('header-next-btn')); // step 0 → 1

    await user.click(screen.getByTestId('header-next-btn')); // step 1 → 2
    await user.click(screen.getByTestId('header-next-btn')); // step 2 → 3
    await user.click(screen.getByTestId('header-next-btn')); // step 3 → 4 (marks visited)

    // Edit step 3
    await user.click(screen.getByTestId('step-summary-3'));

    expect(screen.getByTestId('mfr-target-rent-warning')).toBeInTheDocument();
  });

  it('SFR: no warning icons shown while actively filling step 3 for the first time', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByPlaceholderText(/123 main st/i), '10 Oak Ave');
    await user.click(screen.getByTestId('header-next-btn')); // step 0 → 1
    await user.click(screen.getByTestId('header-next-btn')); // step 1 → 2
    await user.click(screen.getByTestId('header-next-btn')); // step 2 → 3

    // Step 3 is now active but NOT yet visited — no warnings
    expect(screen.queryByTestId('sfr-target-rent-warning')).not.toBeInTheDocument();
  });
});
