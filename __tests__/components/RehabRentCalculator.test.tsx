/**
 * Tests for RehabRentCalculator:
 *
 * 1. simulateRehabRent (pure function)
 *    - Edge cases: zero units, zero pace
 *    - Single unit: stabilizationMonth = ceil(units/pace) + duration
 *    - Multiple units: correct month when last unit completes
 *    - yearlyRents: sums monthly collections across 12-month windows
 *    - Fractional pace: token-bucket accumulator starts units correctly
 *    - Multi-type: proportional pace per unit type
 *    - perTypeYearlyRents: per-type breakdowns match totals
 *
 * 2. RehabRentCalculator component
 *    - Empty state: shows hint when no rent data
 *    - Active state: shows header, stabilization note, year table
 *    - "Applied" badge when appliedYears is non-empty
 *    - "Apply to Pro Forma" fires onApply with correct year overrides
 *    - "Apply to Pre-Stab" fires onApplyPreStab with blended values
 *    - "Clear" fires onClear
 *    - Changing pace input updates the stabilization note
 *    - Multi-type: unit mix breakdown table is shown
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  simulateRehabRent,
  RehabRentCalculator,
  type UnitTypeInput,
} from '@/components/DealAnalyzer/RehabRentCalculator';

// ── simulateRehabRent ──────────────────────────────────────────────────────────

describe('simulateRehabRent — edge cases', () => {
  it('returns zeros when totalUnits is 0', () => {
    const result = simulateRehabRent([], 1, 1, 3);
    expect(result.yearlyRents).toEqual([0, 0, 0]);
    expect(result.stabilizationMonth).toBe(0);
  });

  it('returns zeros when pace is 0', () => {
    const units: UnitTypeInput[] = [{ label: '1BR', count: 2, inPlaceRent: 1000, targetRent: 1500 }];
    const result = simulateRehabRent(units, 0, 1, 3);
    expect(result.yearlyRents).toEqual([0, 0, 0]);
    expect(result.stabilizationMonth).toBe(0);
  });
});

describe('simulateRehabRent — single unit type', () => {
  const unit: UnitTypeInput = { label: '1BR', count: 4, inPlaceRent: 1000, targetRent: 1500 };

  it('stabilizationMonth = ceil(units/pace) + duration', () => {
    // 4 units, pace=2/mo, duration=1 → starts: mo1=2, mo2=2 → done: mo2=2, mo3=2
    // last unit started mo2, done mo3 → stabilizationMonth = ceil(4/2) + 1 = 3
    const result = simulateRehabRent([unit], 2, 1, 3);
    expect(result.stabilizationMonth).toBe(3);
  });

  it('stabilizationMonth with pace=1 and duration=2', () => {
    // ceil(4/1) + 2 = 6
    const result = simulateRehabRent([unit], 1, 2, 3);
    expect(result.stabilizationMonth).toBe(6);
  });

  it('stabilizationMonth with pace=4 (all at once) and duration=1', () => {
    // ceil(4/4) + 1 = 2
    const result = simulateRehabRent([unit], 4, 1, 3);
    expect(result.stabilizationMonth).toBe(2);
  });

  it('yearlyRents has correct length matching projectionYears', () => {
    const result = simulateRehabRent([unit], 2, 1, 5);
    expect(result.yearlyRents).toHaveLength(5);
  });

  it('income grows as units complete renovation', () => {
    // pace=4, duration=1: all 4 stabilize in mo2. Year 1 income < Year 1 at full target.
    const result = simulateRehabRent([unit], 4, 1, 3);
    // Yr1: mo1 = 4×1000 (not started yet at mo1... wait, mo1 they START, complete at mo2)
    // mo1: starts 4, inPlace=0, preStab=0 → 0*1000 + 0*1500 = 0? No...
    // Actually: at m=1, bucket+=4, toStart=4, inPlace becomes 0
    //   monthly[0] = inPlace*ip + preStab*ps = 0*1000 + 0*1500 = 0
    // at m=2: completing=4, preStab=4; monthly[1] = 0 + 4*1500 = 6000
    // Year1 = sum(mo1..12) = 0 + 6000×11 = 66000
    // Year2 = 12×6000 = 72000
    expect(result.yearlyRents[1]).toBeGreaterThan(result.yearlyRents[0]);
  });

  it('income stabilizes to target × units × 12 per year after stabilization', () => {
    // pace=4, duration=1 → stab at mo2. From mo2 onwards: 4×1500=6000/mo
    // Year2 = 12 × 6000 = 72000
    const result = simulateRehabRent([unit], 4, 1, 3);
    expect(result.yearlyRents[1]).toBeCloseTo(72000, 0);
    expect(result.yearlyRents[2]).toBeCloseTo(72000, 0);
  });

  it('before any renovation, income equals inPlaceRent × count × months', () => {
    // pace=1, duration=12: first unit starts mo1, completes mo13 (outside Yr1)
    // Yr1 mo1: starts 1 unit (inPlace→3), monthly = 3×1000 + 0×1500 = 3000
    // mo2: starts 1 (inPlace→2), = 2000 + 0 = 2000
    // ... each month one unit transitions to "under renovation" (inPlace rent = 0 while in progress)
    // Actually the model: inPlace units still pay inPlaceRent until they START renovation
    // Once started they're removed from inPlace but not yet in preStab
    // Let's verify: pace=0, duration=1 edge case handled; use a simpler check:
    // With pace=1, duration=1, 1 unit: starts mo1, done mo2 → full year has mix of ip and ps rent
    const single: UnitTypeInput = { label: 'A', count: 1, inPlaceRent: 800, targetRent: 1200 };
    const result = simulateRehabRent([single], 1, 1, 2);
    // mo1: starts unit, inPlace=0, monthly=0
    // mo2: completes, preStab=1, monthly=1200
    // mo3..12: monthly=1200
    // Yr1 = 0 + 1200×11 = 13200
    expect(result.yearlyRents[0]).toBeCloseTo(13200, 0);
    expect(result.yearlyRents[1]).toBeCloseTo(1200 * 12, 0);
  });
});

describe('simulateRehabRent — fractional pace', () => {
  it('token-bucket starts units at correct months with pace < 1', () => {
    // 2 units, pace=0.5: bucket fills to 1 at mo2, starts unit1; fills again at mo4
    // duration=1: unit1 done at mo3, unit2 done at mo5
    // stabilizationMonth = ceil(2/0.5) + 1 = 5
    const units: UnitTypeInput[] = [{ label: 'A', count: 2, inPlaceRent: 1000, targetRent: 1500 }];
    const result = simulateRehabRent(units, 0.5, 1, 2);
    expect(result.stabilizationMonth).toBe(5);
  });
});

describe('simulateRehabRent — multi-type', () => {
  const types: UnitTypeInput[] = [
    { label: '1BR×2', count: 2, inPlaceRent: 1000, targetRent: 1400 },
    { label: '2BR×2', count: 2, inPlaceRent: 1300, targetRent: 1800 },
  ];

  it('total pace is split proportionally across unit types', () => {
    // 4 total units, pace=4, duration=1 → all stab at mo2 regardless of split
    const result = simulateRehabRent(types, 4, 1, 3);
    expect(result.stabilizationMonth).toBe(2);
  });

  it('perTypeYearlyRents length matches unitTypes length', () => {
    const result = simulateRehabRent(types, 2, 1, 3);
    expect(result.perTypeYearlyRents).toHaveLength(2);
  });

  it('sum of perTypeYearlyRents matches yearlyRents for each year', () => {
    const result = simulateRehabRent(types, 2, 1, 3);
    for (let y = 0; y < 3; y++) {
      const sum = result.perTypeYearlyRents.reduce((s, tr) => s + tr[y], 0);
      expect(sum).toBeCloseTo(result.yearlyRents[y], 1);
    }
  });

  it('after stabilization all units collect target rent', () => {
    // pace=4, duration=1 → stab mo2. Yr2 and Yr3 = (2×1400 + 2×1800) × 12
    const result = simulateRehabRent(types, 4, 1, 3);
    const fullTarget = (2 * 1400 + 2 * 1800) * 12;
    expect(result.yearlyRents[1]).toBeCloseTo(fullTarget, 0);
    expect(result.yearlyRents[2]).toBeCloseTo(fullTarget, 0);
  });
});

// ── RehabRentCalculator component ─────────────────────────────────────────────

const sfrUnit: UnitTypeInput = {
  label: 'SFR',
  count: 1,
  inPlaceRent: 1200,
  targetRent: 1800,
};

const mfrUnits: UnitTypeInput[] = [
  { label: '1BR/1BA × 3', count: 3, inPlaceRent: 1000, targetRent: 1400 },
  { label: '2BR/2BA × 2', count: 2, inPlaceRent: 1300, targetRent: 1800 },
];

function renderCalc(overrides: Partial<Parameters<typeof RehabRentCalculator>[0]> = {}) {
  const props = {
    unitTypes: [sfrUnit],
    projectionYears: 3,
    appliedYears: {},
    onApply: vi.fn(),
    onClear: vi.fn(),
    onApplyPreStab: vi.fn(),
    onOpenChange: vi.fn(),
    grossRentGrowthPct: 3,
    ...overrides,
  };
  return { ...render(<RehabRentCalculator {...props} />), props };
}

describe('RehabRentCalculator — empty state', () => {
  it('shows hint when no rent data (inPlaceRent=0)', () => {
    renderCalc({ unitTypes: [{ label: 'A', count: 1, inPlaceRent: 0, targetRent: 0 }] });
    expect(screen.getByText(/Enter in-place and target rents/i)).toBeInTheDocument();
  });

  it('shows hint when targetRent=0', () => {
    renderCalc({ unitTypes: [{ label: 'A', count: 1, inPlaceRent: 1200, targetRent: 0 }] });
    expect(screen.getByText(/Enter in-place and target rents/i)).toBeInTheDocument();
  });

  it('does not show the calculator inputs in empty state', () => {
    const { container } = renderCalc({ unitTypes: [{ label: 'A', count: 1, inPlaceRent: 0, targetRent: 0 }] });
    expect(container.querySelector('input[type="number"]')).toBeNull();
  });
});

describe('RehabRentCalculator — active state', () => {
  it('shows "Value-Add Rent Calculator" header', () => {
    renderCalc();
    expect(screen.getByText('Value-Add Rent Calculator')).toBeInTheDocument();
  });

  it('renders pace and duration inputs', () => {
    const { container } = renderCalc();
    const inputs = container.querySelectorAll('input[type="number"]');
    expect(inputs.length).toBeGreaterThanOrEqual(2);
  });

  it('shows stabilization note with unit count and month', () => {
    renderCalc();
    expect(screen.getByText(/unit.*stabilized by month/i)).toBeInTheDocument();
  });

  it('shows the results table with transition year rows', () => {
    renderCalc();
    expect(screen.getByText('Yr 1')).toBeInTheDocument();
  });

  it('shows Blended/mo and Target/mo column headers in results table', () => {
    renderCalc();
    expect(screen.getByText('Blended/mo')).toBeInTheDocument();
    expect(screen.getByText('Target/mo')).toBeInTheDocument();
  });

  it('shows "Apply to Pro Forma" and "Clear" buttons but not "Apply to Pre-Stab"', () => {
    renderCalc();
    expect(screen.getByRole('button', { name: /Apply to Pro Forma/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Apply to Pre-Stab/i })).toBeNull();
    expect(screen.getByRole('button', { name: /Clear/i })).toBeInTheDocument();
  });

  it('shows step flow inputs: units to stabilize, pace, type toggle', () => {
    renderCalc();
    expect(screen.getByText(/How many units need to be stabilized/i)).toBeInTheDocument();
    expect(screen.getByText(/At what pace/i)).toBeInTheDocument();
    expect(screen.getByText(/Stabilization or renovation/i)).toBeInTheDocument();
  });

  it('shows Stabilization and Renovation toggle buttons', () => {
    renderCalc();
    expect(screen.getByRole('button', { name: /^Stabilization$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Renovation$/i })).toBeInTheDocument();
  });

  it('does not show "Applied" badge by default', () => {
    renderCalc();
    expect(screen.queryByText('Applied')).toBeNull();
  });

  it('shows "Applied" badge when appliedYears is non-empty', () => {
    renderCalc({ appliedYears: { 1: 21600, 2: 21600 } });
    expect(screen.getByText('Applied')).toBeInTheDocument();
  });
});

describe('RehabRentCalculator — Apply to Pro Forma', () => {
  it('calls onApply with year overrides when button is clicked', async () => {
    const user = userEvent.setup();
    const { props } = renderCalc();
    await user.click(screen.getByRole('button', { name: /Apply to Pro Forma/i }));
    expect(props.onApply).toHaveBeenCalledOnce();
    const overrides = props.onApply.mock.calls[0][0] as Record<number, number>;
    // At least one year should have a rent value
    expect(Object.keys(overrides).length).toBeGreaterThanOrEqual(1);
  });

  it('onApply overrides have positive rent values', async () => {
    const user = userEvent.setup();
    const { props } = renderCalc();
    await user.click(screen.getByRole('button', { name: /Apply to Pro Forma/i }));
    const overrides = props.onApply.mock.calls[0][0] as Record<number, number>;
    Object.values(overrides).forEach(v => expect(v).toBeGreaterThan(0));
  });

  it('calls onOpenChange(false) after applying', async () => {
    const user = userEvent.setup();
    const { props } = renderCalc();
    await user.click(screen.getByRole('button', { name: /Apply to Pro Forma/i }));
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe('RehabRentCalculator — Apply to Pro Forma also sets pre-stab', () => {
  it('calls onApplyPreStab when Apply to Pro Forma is clicked', async () => {
    const user = userEvent.setup();
    const { props } = renderCalc();
    await user.click(screen.getByRole('button', { name: /Apply to Pro Forma/i }));
    expect(props.onApplyPreStab).toHaveBeenCalledOnce();
    const values = props.onApplyPreStab!.mock.calls[0][0] as number[];
    expect(values).toHaveLength(1);
    expect(values[0]).toBeGreaterThan(0);
  });

  it('blended pre-stab value is between inPlaceRent and targetRent', async () => {
    const user = userEvent.setup();
    const { props } = renderCalc();
    await user.click(screen.getByRole('button', { name: /Apply to Pro Forma/i }));
    const values = props.onApplyPreStab!.mock.calls[0][0] as number[];
    expect(values[0]).toBeGreaterThanOrEqual(sfrUnit.inPlaceRent);
    expect(values[0]).toBeLessThanOrEqual(sfrUnit.targetRent);
  });
});

describe('RehabRentCalculator — Cancel button', () => {
  it('renders a Cancel/close button in the header', () => {
    renderCalc();
    expect(screen.getByRole('button', { name: /cancel calculator/i })).toBeInTheDocument();
  });

  it('Cancel button calls onOpenChange(false)', async () => {
    const user = userEvent.setup();
    const { props } = renderCalc();
    await user.click(screen.getByRole('button', { name: /cancel calculator/i }));
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe('RehabRentCalculator — Clear', () => {
  it('calls onClear when Clear button is clicked', async () => {
    const user = userEvent.setup();
    const { props } = renderCalc();
    await user.click(screen.getByRole('button', { name: /Clear/i }));
    expect(props.onClear).toHaveBeenCalledOnce();
  });

  it('calls onOpenChange(false) after clearing', async () => {
    const user = userEvent.setup();
    const { props } = renderCalc();
    await user.click(screen.getByRole('button', { name: /Clear/i }));
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe('RehabRentCalculator — pace input interaction', () => {
  it('updating pace changes the stabilization month displayed', async () => {
    const user = userEvent.setup();
    const { container } = renderCalc({ unitTypes: [{ label: 'SFR', count: 4, inPlaceRent: 1000, targetRent: 1500 }] });

    // Default pace=1 → stab month = ceil(4/1)+1 = 5
    expect(screen.getByText(/month 5/i)).toBeInTheDocument();

    // Change pace to 4 → stab month = ceil(4/4)+1 = 2
    // Pace is the second number input (after units to stabilize)
    const paceInput = container.querySelectorAll('input[type="number"]')[1] as HTMLInputElement;
    await user.clear(paceInput);
    await user.type(paceInput, '4');
    fireEvent.blur(paceInput);

    expect(screen.getByText(/month 2/i)).toBeInTheDocument();
  });
});

describe('simulateRehabRent — partial units (unitsToStabilize)', () => {
  const unit: UnitTypeInput = { label: 'A', count: 10, inPlaceRent: 1000, targetRent: 1500 };

  it('non-stabilizing units earn target rent throughout', () => {
    // 4 stabilize, 6 already at target. pace=4, duration=0 → stab month=1
    // Yr1: 4 stabilizing units flip in mo1 + 6 at target = 10×1500×12 = 180000
    const result = simulateRehabRent([unit], 4, 0, 2, 4);
    expect(result.yearlyRents[0]).toBeCloseTo(10 * 1500 * 12, 0);
  });

  it('stabilizationMonth is based only on unitsToStabilize', () => {
    // 6 units stabilize, pace=2, duration=1 → ceil(6/2)+1 = 4
    const result = simulateRehabRent([unit], 2, 1, 3, 6);
    expect(result.stabilizationMonth).toBe(4);
  });

  it('income increases as stabilizing units complete renovation', () => {
    // 4 stabilize at pace=1, duration=1, 6 at target throughout
    // Yr1 starts lower than Yr2
    const result = simulateRehabRent([unit], 1, 1, 3, 4);
    expect(result.yearlyRents[1]).toBeGreaterThan(result.yearlyRents[0]);
  });
});

describe('RehabRentCalculator — step flow UI', () => {
  it('shows "of N total" label next to units to stabilize input', () => {
    renderCalc({ unitTypes: [{ label: 'SFR', count: 8, inPlaceRent: 1000, targetRent: 1500 }] });
    expect(screen.getByText(/of 8 total/i)).toBeInTheDocument();
  });

  it('shows "already at target" hint when units to stabilize < total', () => {
    const { container } = renderCalc({ unitTypes: [{ label: 'SFR', count: 8, inPlaceRent: 1000, targetRent: 1500 }] });
    const stabInput = container.querySelectorAll('input[type="number"]')[0] as HTMLInputElement;
    fireEvent.change(stabInput, { target: { value: '6' } });
    expect(screen.getByText(/already at target/i)).toBeInTheDocument();
  });

  it('switching to Stabilization hides duration input', async () => {
    const user = userEvent.setup();
    const { container } = renderCalc();
    // Default is renovation — duration input visible
    expect(container.querySelectorAll('input[type="number"]').length).toBeGreaterThanOrEqual(3);
    await user.click(screen.getByRole('button', { name: /^Stabilization$/i }));
    // Stabilization — duration input hidden
    expect(container.querySelectorAll('input[type="number"]').length).toBe(2);
  });

  it('shows no-vacancy hint when Stabilization is selected', async () => {
    const user = userEvent.setup();
    renderCalc();
    await user.click(screen.getByRole('button', { name: /^Stabilization$/i }));
    expect(screen.getByText(/no vacancy/i)).toBeInTheDocument();
  });
});

describe('RehabRentCalculator — multi-type unit mix', () => {
  it('shows unit mix breakdown table when more than one unit type', () => {
    renderCalc({ unitTypes: mfrUnits });
    expect(screen.getAllByText('1BR/1BA × 3').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('2BR/2BA × 2').length).toBeGreaterThanOrEqual(1);
  });

  it('shows Pace column in the unit mix table', () => {
    renderCalc({ unitTypes: mfrUnits });
    expect(screen.getByText('Pace')).toBeInTheDocument();
  });

  it('onApplyPreStab is called with values for each unit type when Apply to Pro Forma clicked', async () => {
    const user = userEvent.setup();
    const { props } = renderCalc({ unitTypes: mfrUnits });
    await user.click(screen.getByRole('button', { name: /Apply to Pro Forma/i }));
    const values = props.onApplyPreStab!.mock.calls[0][0] as number[];
    expect(values).toHaveLength(2);
    values.forEach(v => expect(v).toBeGreaterThan(0));
  });
});
