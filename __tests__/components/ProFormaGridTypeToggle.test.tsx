/**
 * Tests for ProFormaGrid expense type toggle ($ ↔ % of EGI):
 *
 * Non-toggleable (always fixed $):
 *   - Insurance has no toggle button
 *   - Property Taxes has no toggle button
 *
 * Toggleable:
 *   - Property Management (% by default) shows "→ $" toggle
 *   - Maintenance & Repairs (% by default) shows "→ $" toggle
 *   - CapEx Reserves ($ by default) shows "→ %" toggle
 *   - User-added expenses show "→ %" toggle
 *
 * Toggle conversion behaviour:
 *   - $ → %: existing dollar values auto-converted to % of EGI (value / EGI * 100)
 *   - % → $: existing % values auto-converted to $ (value / 100 * EGI)
 *   - When EGI = 0, converted value falls back to 0 (can't divide/multiply by zero)
 *   - "% of Eff. Gross Income" label appears after toggling $ → %
 *   - "% of Eff. Gross Income" label disappears after toggling % → $
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProFormaGrid, defaultProForma } from '@/components/DealAnalyzer/ProFormaGrid';
import type { ProFormaData } from '@/types';

// ── Helpers ───────────────────────────────────────────────────────────────────

function renderGrid(data?: ProFormaData, onChange = vi.fn()) {
  const gridData = data ?? defaultProForma('sfr');
  return { onChange, ...render(<ProFormaGrid data={gridData} onChange={onChange} projectionYears={5} />) };
}

function rowFor(name: string) {
  return screen.getByText(name).closest('tr')!;
}

/** Build ProFormaData with a known EGI for predictable conversion math.
 *  EGI = grossRent * (1 - (vacancy + creditLoss) / 100) + otherIncome
 *  With vacancy=0, creditLoss=0, otherIncome=0: EGI = grossRent.
 */
function dataWithKnownEGI(grossRentStabilized: number, grossRentT12 = grossRentStabilized): ProFormaData {
  const base = defaultProForma('sfr');
  return {
    ...base,
    grossRent:     { t12: grossRentT12, stab: null, stabilized: grossRentStabilized, growthPct: 3 },
    otherIncome:   { t12: 0, stab: null, stabilized: 0, growthPct: 2 },
    vacancyPct:    { t12: 0, stab: null, stabilized: 0 },
    creditLossPct: { t12: 0, stab: null, stabilized: 0 },
  };
}

// ── Non-toggleable rows ───────────────────────────────────────────────────────

describe('ProFormaGrid non-toggleable expenses', () => {
  it('Insurance has no toggle button', () => {
    renderGrid();
    const row = rowFor('Insurance');
    expect(within(row).queryByRole('button', { name: /convert to percent/i })).not.toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: /convert to fixed/i })).not.toBeInTheDocument();
  });

  it('Property Taxes has no toggle button', () => {
    renderGrid();
    const row = rowFor('Property Taxes');
    expect(within(row).queryByRole('button', { name: /convert to percent/i })).not.toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: /convert to fixed/i })).not.toBeInTheDocument();
  });
});

// ── Toggleable rows present ────────────────────────────────────────────────────

describe('ProFormaGrid toggleable expenses show correct button', () => {
  it('Property Management (% default) shows "→ $" toggle button', () => {
    renderGrid();
    expect(within(rowFor('Property Management')).getByRole('button', { name: /convert to fixed/i })).toBeInTheDocument();
  });

  it('Maintenance & Repairs (% default) shows "→ $" toggle button', () => {
    renderGrid();
    expect(within(rowFor('Maintenance & Repairs')).getByRole('button', { name: /convert to fixed/i })).toBeInTheDocument();
  });

  it('CapEx Reserves ($ default) shows "→ %" toggle button', () => {
    renderGrid();
    expect(within(rowFor('CapEx Reserves')).getByRole('button', { name: /convert to percent/i })).toBeInTheDocument();
  });

  it('user-added expense ($ default) shows "→ %" toggle button', () => {
    const base = defaultProForma('sfr');
    const data: ProFormaData = {
      ...base,
      expenses: [...base.expenses, { id: 'user-x1', name: 'Custom Expense', isPercentOfEGI: false, t12Value: 0, stabValue: null, stabilizedValue: 0, growthPct: 2 }],
    };
    renderGrid(data);
    expect(within(rowFor('Custom Expense')).getByRole('button', { name: /convert to percent/i })).toBeInTheDocument();
  });
});

// ── Toggle $ → % (value conversion) ──────────────────────────────────────────

describe('ProFormaGrid toggling $ → % of EGI (value conversion)', () => {
  it('sets isPercentOfEGI=true on the toggled expense', async () => {
    const user = userEvent.setup();
    const { onChange } = renderGrid(dataWithKnownEGI(24000));

    await user.click(within(rowFor('CapEx Reserves')).getByRole('button', { name: /convert to percent/i }));

    const updated: ProFormaData = onChange.mock.calls[0][0];
    expect(updated.expenses.find(e => e.name === 'CapEx Reserves')!.isPercentOfEGI).toBe(true);
  });

  it('converts stabilizedValue to % of stabilized EGI', async () => {
    const user = userEvent.setup();
    // EGI = 24000, stabilizedValue = 1200 → 1200/24000*100 = 5.00%
    const base = dataWithKnownEGI(24000);
    const data: ProFormaData = {
      ...base,
      expenses: base.expenses.map(e =>
        e.name === 'CapEx Reserves' ? { ...e, stabilizedValue: 1200 } : e
      ),
    };
    const { onChange } = renderGrid(data);

    await user.click(within(rowFor('CapEx Reserves')).getByRole('button', { name: /convert to percent/i }));

    const capEx = (onChange.mock.calls[0][0] as ProFormaData).expenses.find(e => e.name === 'CapEx Reserves')!;
    expect(capEx.stabilizedValue).toBe(5);
  });

  it('converts t12Value to % of T12 EGI', async () => {
    const user = userEvent.setup();
    // T12 EGI = 20000, t12Value = 1000 → 1000/20000*100 = 5.00%
    const base = dataWithKnownEGI(24000, 20000);
    const data: ProFormaData = {
      ...base,
      expenses: base.expenses.map(e =>
        e.name === 'CapEx Reserves' ? { ...e, t12Value: 1000 } : e
      ),
    };
    const { onChange } = renderGrid(data);

    await user.click(within(rowFor('CapEx Reserves')).getByRole('button', { name: /convert to percent/i }));

    const capEx = (onChange.mock.calls[0][0] as ProFormaData).expenses.find(e => e.name === 'CapEx Reserves')!;
    expect(capEx.t12Value).toBe(5);
  });

  it('falls back to 0 when EGI is 0 (no gross rent entered)', async () => {
    const user = userEvent.setup();
    // No gross rent set → EGI = 0, cannot divide
    const base = defaultProForma('sfr'); // grossRent.stabilized = 0
    const data: ProFormaData = {
      ...base,
      expenses: base.expenses.map(e =>
        e.name === 'CapEx Reserves' ? { ...e, stabilizedValue: 1200, t12Value: 1000 } : e
      ),
    };
    const { onChange } = renderGrid(data);

    await user.click(within(rowFor('CapEx Reserves')).getByRole('button', { name: /convert to percent/i }));

    const capEx = (onChange.mock.calls[0][0] as ProFormaData).expenses.find(e => e.name === 'CapEx Reserves')!;
    expect(capEx.stabilizedValue).toBe(0);
    expect(capEx.t12Value).toBe(0);
  });

  it('shows "% of Eff. Gross Income" sub-label after toggling', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const base = defaultProForma('sfr');
    const { rerender } = render(<ProFormaGrid data={base} onChange={onChange} projectionYears={5} />);

    await user.click(within(rowFor('CapEx Reserves')).getByRole('button', { name: /convert to percent/i }));

    const updated: ProFormaData = onChange.mock.calls[0][0];
    rerender(<ProFormaGrid data={updated} onChange={onChange} projectionYears={5} />);

    expect(within(rowFor('CapEx Reserves')).getByText('% of Eff. Gross Income')).toBeInTheDocument();
  });

  it('does NOT show "% of Eff. Gross Income" before toggling', () => {
    renderGrid();
    expect(within(rowFor('CapEx Reserves')).queryByText('% of Eff. Gross Income')).not.toBeInTheDocument();
  });
});

// ── Toggle % → $ (value conversion) ──────────────────────────────────────────

describe('ProFormaGrid toggling % → $ fixed amount (value conversion)', () => {
  it('sets isPercentOfEGI=false on the toggled expense', async () => {
    const user = userEvent.setup();
    const { onChange } = renderGrid(dataWithKnownEGI(24000));

    await user.click(within(rowFor('Property Management')).getByRole('button', { name: /convert to fixed/i }));

    const updated: ProFormaData = onChange.mock.calls[0][0];
    expect(updated.expenses.find(e => e.name === 'Property Management')!.isPercentOfEGI).toBe(false);
  });

  it('converts stabilizedValue % to dollar amount using stabilized EGI', async () => {
    const user = userEvent.setup();
    // EGI = 24000, stabilizedValue = 8% → 8/100 * 24000 = $1920
    const { onChange } = renderGrid(dataWithKnownEGI(24000));

    await user.click(within(rowFor('Property Management')).getByRole('button', { name: /convert to fixed/i }));

    const pm = (onChange.mock.calls[0][0] as ProFormaData).expenses.find(e => e.name === 'Property Management')!;
    expect(pm.stabilizedValue).toBe(1920); // 8% of 24000
  });

  it('converts t12Value % to dollar amount using T12 EGI', async () => {
    const user = userEvent.setup();
    // T12 EGI = 20000, t12Value = 8% → 8/100 * 20000 = $1600
    const { onChange } = renderGrid(dataWithKnownEGI(24000, 20000));

    await user.click(within(rowFor('Property Management')).getByRole('button', { name: /convert to fixed/i }));

    const pm = (onChange.mock.calls[0][0] as ProFormaData).expenses.find(e => e.name === 'Property Management')!;
    expect(pm.t12Value).toBe(1600); // 8% of 20000
  });

  it('falls back to 0 when EGI is 0', async () => {
    const user = userEvent.setup();
    const { onChange } = renderGrid(defaultProForma('sfr')); // grossRent = 0 → EGI = 0

    await user.click(within(rowFor('Property Management')).getByRole('button', { name: /convert to fixed/i }));

    const pm = (onChange.mock.calls[0][0] as ProFormaData).expenses.find(e => e.name === 'Property Management')!;
    expect(pm.stabilizedValue).toBe(0);
    expect(pm.t12Value).toBe(0);
  });

  it('"% of Eff. Gross Income" label disappears after toggling % → $', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const base = defaultProForma('sfr');
    const { rerender } = render(<ProFormaGrid data={base} onChange={onChange} projectionYears={5} />);

    expect(within(rowFor('Property Management')).getByText('% of Eff. Gross Income')).toBeInTheDocument();

    await user.click(within(rowFor('Property Management')).getByRole('button', { name: /convert to fixed/i }));

    rerender(<ProFormaGrid data={onChange.mock.calls[0][0]} onChange={onChange} projectionYears={5} />);

    expect(within(rowFor('Property Management')).queryByText('% of Eff. Gross Income')).not.toBeInTheDocument();
  });

  it('shows "→ %" toggle button after switching to $ (can toggle back)', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const base = defaultProForma('sfr');
    const { rerender } = render(<ProFormaGrid data={base} onChange={onChange} projectionYears={5} />);

    await user.click(within(rowFor('Property Management')).getByRole('button', { name: /convert to fixed/i }));
    rerender(<ProFormaGrid data={onChange.mock.calls[0][0]} onChange={onChange} projectionYears={5} />);

    expect(within(rowFor('Property Management')).getByRole('button', { name: /convert to percent/i })).toBeInTheDocument();
  });
});

// ── Other expenses unaffected ─────────────────────────────────────────────────

describe('ProFormaGrid toggle isolation', () => {
  it('toggling CapEx Reserves does not change Insurance or Property Taxes', async () => {
    const user = userEvent.setup();
    const { onChange } = renderGrid();

    await user.click(within(rowFor('CapEx Reserves')).getByRole('button', { name: /convert to percent/i }));

    const updated: ProFormaData = onChange.mock.calls[0][0];
    expect(updated.expenses.find(e => e.name === 'Insurance')!.isPercentOfEGI).toBe(false);
    expect(updated.expenses.find(e => e.name === 'Property Taxes')!.isPercentOfEGI).toBe(false);
  });

  it('toggling Property Management does not affect other expenses', async () => {
    const user = userEvent.setup();
    const { onChange } = renderGrid();

    await user.click(within(rowFor('Property Management')).getByRole('button', { name: /convert to fixed/i }));

    const updated: ProFormaData = onChange.mock.calls[0][0];
    expect(updated.expenses.find(e => e.name === 'Maintenance & Repairs')!.isPercentOfEGI).toBe(true);
    expect(updated.expenses.find(e => e.name === 'CapEx Reserves')!.isPercentOfEGI).toBe(false);
  });
});
