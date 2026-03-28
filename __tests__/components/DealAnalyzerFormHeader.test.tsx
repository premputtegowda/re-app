/**
 * Tests for DealAnalyzerForm header behaviour:
 *   - Cancel and Save are always visible (even before address is entered)
 *   - Save is disabled until a property address is entered
 *   - Save becomes enabled once an address exists
 *   - "Next" appears in the header for steps 0–3
 *   - "Next" is hidden on step 4 (Exit & Refi)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DealAnalyzerForm } from '@/components/DealAnalyzer/DealAnalyzerForm';

// ── Mocks ────────────────────────────────────────────────────────────────────

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

    // Step 1 (Financing): enter purchase price so validation passes, click Next
    await user.type(screen.getByPlaceholderText(/350,000/i), '300000');
    await user.click(getNextBtn()!);

    // Step 2 (Renovation): no required fields, click Next
    await user.click(getNextBtn()!);

    // Step 3 (Operations): no required fields, click Next
    await user.click(getNextBtn()!);

    // Now on step 4 — Next should be gone, Calculate should be present
    expect(getNextBtn()).toBeNull();
    expect(screen.getByRole('button', { name: /calculate/i })).toBeInTheDocument();
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
