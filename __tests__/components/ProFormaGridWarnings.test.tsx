/**
 * Tests for ProFormaGrid expense behaviour:
 *   - Default preset expense items cannot be deleted
 *   - User-added expense items can be deleted
 * Tests for ProFormaGrid expense warning icons:
 *   - Warning icon appears next to non-% expenses with stabilizedValue = 0 when showWarnings = true
 *   - No warning when showWarnings = false
 *   - No warning for % EGI expenses regardless of value
 *   - Warning disappears when stabilizedValue > 0
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProFormaGrid, defaultProForma } from '@/components/DealAnalyzer/ProFormaGrid';
import type { ProFormaData } from '@/types';

// ── Helpers ───────────────────────────────────────────────────────────────────

function renderGrid(showWarnings = false, data?: ProFormaData) {
  const gridData = data ?? defaultProForma('sfr');
  return render(
    <ProFormaGrid
      data={gridData}
      onChange={vi.fn()}
      projectionYears={5}
      showWarnings={showWarnings}
    />
  );
}

// Returns a ProFormaData with one user-added expense appended
function dataWithUserExpense(): ProFormaData {
  const base = defaultProForma('sfr');
  return {
    ...base,
    expenses: [
      ...base.expenses,
      { id: 'user-abc123', name: 'Custom Fee', isPercentOfEGI: false, t12Value: 0, stabValue: null, stabilizedValue: 0, growthPct: 2 },
    ],
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ProFormaGrid expense deletion', () => {
  it('does not render a delete button for preset expense items', () => {
    renderGrid();

    const propertyTaxesRow = screen.getByText('Property Taxes').closest('tr')!;
    expect(within(propertyTaxesRow).queryByRole('button', { name: /delete expense/i })).not.toBeInTheDocument();

    const insuranceRow = screen.getByText('Insurance').closest('tr')!;
    expect(within(insuranceRow).queryByRole('button', { name: /delete expense/i })).not.toBeInTheDocument();
  });

  it('renders a delete button for user-added expense items', () => {
    renderGrid(false, dataWithUserExpense());

    const customRow = screen.getByText('Custom Fee').closest('tr')!;
    expect(within(customRow).getByRole('button', { name: /delete expense/i })).toBeInTheDocument();
  });

  it('calls onChange without the user-added item when delete is clicked', async () => {
    const user = userEvent.setup();
    const data = dataWithUserExpense();
    const onChange = vi.fn();

    render(<ProFormaGrid data={data} onChange={onChange} projectionYears={5} />);

    const customRow = screen.getByText('Custom Fee').closest('tr')!;
    const deleteBtn = within(customRow).getByRole('button', { name: /delete expense/i });
    await user.click(deleteBtn);

    expect(onChange).toHaveBeenCalledOnce();
    const updatedData: ProFormaData = onChange.mock.calls[0][0];
    expect(updatedData.expenses.find(e => e.id === 'user-abc123')).toBeUndefined();
    // Preset items remain
    expect(updatedData.expenses.some(e => e.name === 'Property Taxes')).toBe(true);
  });
});

describe('ProFormaGrid expense warnings', () => {
  it('shows warning icon on Property Taxes when showWarnings=true and value is 0', () => {
    renderGrid(true);
    expect(screen.getByTestId('expense-warning-Property Taxes')).toBeInTheDocument();
  });

  it('shows warning icon on Insurance when showWarnings=true and value is 0', () => {
    renderGrid(true);
    expect(screen.getByTestId('expense-warning-Insurance')).toBeInTheDocument();
  });

  it('shows warning icon on CapEx Reserves when showWarnings=true and value is 0', () => {
    renderGrid(true);
    expect(screen.getByTestId('expense-warning-CapEx Reserves')).toBeInTheDocument();
  });

  it('does NOT show warning on Maintenance & Repairs (% EGI) even when showWarnings=true', () => {
    renderGrid(true);
    expect(screen.queryByTestId('expense-warning-Maintenance & Repairs')).not.toBeInTheDocument();
  });

  it('does NOT show warning on Property Management (% EGI) even when showWarnings=true', () => {
    renderGrid(true);
    expect(screen.queryByTestId('expense-warning-Property Management')).not.toBeInTheDocument();
  });

  it('shows no warnings at all when showWarnings=false', () => {
    renderGrid(false);
    expect(screen.queryByTestId('expense-warning-Property Taxes')).not.toBeInTheDocument();
    expect(screen.queryByTestId('expense-warning-Insurance')).not.toBeInTheDocument();
    expect(screen.queryByTestId('expense-warning-CapEx Reserves')).not.toBeInTheDocument();
  });

  it('hides warning on Property Taxes once a value is entered', async () => {
    const user = userEvent.setup();
    const data = defaultProForma('sfr');
    const onChange = vi.fn();

    const { rerender } = render(
      <ProFormaGrid data={data} onChange={onChange} projectionYears={5} showWarnings={true} />
    );

    expect(screen.getByTestId('expense-warning-Property Taxes')).toBeInTheDocument();

    // Simulate user entering a value — update the data and rerender
    const propertyTaxExpense = data.expenses.find(e => e.name === 'Property Taxes')!;
    const updatedData = {
      ...data,
      expenses: data.expenses.map(e =>
        e.id === propertyTaxExpense.id ? { ...e, stabilizedValue: 3600 } : e
      ),
    };

    rerender(
      <ProFormaGrid data={updatedData} onChange={onChange} projectionYears={5} showWarnings={true} />
    );

    expect(screen.queryByTestId('expense-warning-Property Taxes')).not.toBeInTheDocument();
  });
});
