/**
 * Tests for RehabRentCalculator (Option A: shared timeline, per-type columns).
 *
 * 1. simulateFromSchedule (pure function)
 *    - Zero types → empty results
 *    - Single type: offline during renovation, earns target after
 *    - Multi-type: independent schedules, results sum correctly
 *    - Already-stable units (not in schedule) earn targetRent throughout
 *    - stabilizationMonth = last schedule month + perUnitMonths for each type
 *
 * 2. RehabRentCalculator component
 *    - Empty state when no rent data
 *    - Shows header + shared inputs (duration, type toggle)
 *    - Per-type cards with inputs
 *    - Mo/unit input shown for Renovation, hidden for Stabilization
 *    - Monthly grid with per-type columns after filling duration
 *    - Auto-fill button (month 1) distributes evenly per type
 *    - Apply disabled until all active types have valid schedules
 *    - Apply fires onApply with gross rent overrides + onApplyPreStab
 *    - Clear fires onClear + onOpenChange(false)
 *    - Cancel fires onOpenChange(false)
 *    - Applied badge when appliedYears non-empty
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  simulateFromSchedule,
  RehabRentCalculator,
  type UnitTypeInput,
} from '@/components/DealAnalyzer/RehabRentCalculator';

// ── simulateFromSchedule ───────────────────────────────────────────────────────

describe('simulateFromSchedule — edge cases', () => {
  it('returns zeros when unitTypes is empty', () => {
    const result = simulateFromSchedule([], [], [], 3);
    expect(result.yearlyRents).toEqual([0, 0, 0]);
    expect(result.stabilizationMonth).toBe(0);
  });

  it('returns correct length yearlyRents matching totalYears', () => {
    const unit: UnitTypeInput = { label: 'A', count: 2, inPlaceRent: 1000, targetRent: 1500 };
    const result = simulateFromSchedule([unit], [[2]], [0], 5);
    expect(result.yearlyRents).toHaveLength(5);
  });
});

describe('simulateFromSchedule — single type, renovation', () => {
  const unit: UnitTypeInput = { label: '1BR', count: 4, inPlaceRent: 1000, targetRent: 1500 };

  it('units are offline during renovation (earn $0)', () => {
    // schedule: 4 units start month 1, perUnitMonths=2 → done month 3
    // mo1: started=4, done=0, inReno=4, inPlace=0 → rent=0
    const result = simulateFromSchedule([unit], [[4]], [2], 2);
    expect(result.yearlyRents[0]).toBeLessThan(unit.count * unit.targetRent * 12);
  });

  it('units earn targetRent after renovation completes', () => {
    // schedule: all 4 start mo1, perUnitMonths=1 → done mo2
    // Yr2: 4×1500×12=72000
    const result = simulateFromSchedule([unit], [[4]], [1], 2);
    const fullYearTarget = unit.count * unit.targetRent * 12;
    expect(result.yearlyRents[1]).toBeCloseTo(fullYearTarget, 0);
  });

  it('income in transition year is less than full target year', () => {
    const result = simulateFromSchedule([unit], [[4]], [1], 2);
    expect(result.yearlyRents[0]).toBeLessThan(result.yearlyRents[1]);
  });

  it('stabilizationMonth = last scheduled month + perUnitMonths', () => {
    // schedule over 4 months: [1,1,1,1], perUnitMonths=2 → last done = month 4 + 2 = 6
    const result = simulateFromSchedule([unit], [[1, 1, 1, 1]], [2], 3);
    expect(result.stabilizationMonth).toBe(6);
  });

  it('stabilizationMonth = 0 when schedule is empty', () => {
    const result = simulateFromSchedule([unit], [[]], [1], 2);
    expect(result.stabilizationMonth).toBe(0);
  });
});

describe('simulateFromSchedule — already-stable units', () => {
  const unit: UnitTypeInput = { label: 'A', count: 10, inPlaceRent: 1000, targetRent: 1500 };

  it('units not in schedule earn targetRent throughout', () => {
    // schedule: only 4 of 10 → 6 always earn targetRent
    // All 4 start mo1, perUnitMonths=0 → done mo1
    // Yr1 should equal 10×1500×12 = 180000
    const result = simulateFromSchedule([unit], [[4]], [0], 2);
    expect(result.yearlyRents[0]).toBeCloseTo(10 * 1500 * 12, 0);
  });

  it('with perUnitMonths=0, no vacancy — income = targetRent × count × 12 immediately', () => {
    const result = simulateFromSchedule([unit], [[10]], [0], 2);
    expect(result.yearlyRents[0]).toBeCloseTo(10 * 1500 * 12, 0);
  });
});

describe('simulateFromSchedule — multi-type', () => {
  const types: UnitTypeInput[] = [
    { label: '1BR', count: 3, inPlaceRent: 1000, targetRent: 1400 },
    { label: '2BR', count: 2, inPlaceRent: 1300, targetRent: 1800 },
  ];

  it('each type uses its own perUnitMonths independently', () => {
    // 1BR: [3] start mo1, offline 1mo → done mo2
    // 2BR: [2] start mo1, offline 3mo → done mo4
    const result = simulateFromSchedule(types, [[3], [2]], [1, 3], 2);
    // By Yr2 all should be stable: 3×1400 + 2×1800 = 7800/mo × 12 = 93600
    expect(result.yearlyRents[1]).toBeCloseTo(93600, 0);
  });

  it('stabilizationMonth is the maximum across types', () => {
    // 1BR done at mo3 (sched length=2, +1 perUnit), 2BR done at mo5 (sched length=2, +3 perUnit)
    const result = simulateFromSchedule(types, [[1, 2], [1, 1]], [1, 3], 3);
    expect(result.stabilizationMonth).toBe(5);
  });

  it('type with empty schedule contributes targetRent throughout (already stable)', () => {
    // 1BR scheduled, 2BR not scheduled → 2BR always at targetRent
    const result = simulateFromSchedule(types, [[3], []], [1, 0], 2);
    // After 1BR stabilizes: Yr2 = (3×1400 + 2×1800)×12 = 93600
    expect(result.yearlyRents[1]).toBeCloseTo(93600, 0);
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
  { label: '1BR', count: 3, inPlaceRent: 1000, targetRent: 1400 },
  { label: '2BR', count: 2, inPlaceRent: 1300, targetRent: 1800 },
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

// ── Empty state ──────────────────────────────────────────────────────────────

describe('RehabRentCalculator — empty state', () => {
  it('shows hint when inPlaceRent=0', () => {
    renderCalc({ unitTypes: [{ label: 'A', count: 1, inPlaceRent: 0, targetRent: 0 }] });
    expect(screen.getByText(/Enter in-place and target rents/i)).toBeInTheDocument();
  });

  it('shows hint when targetRent=0', () => {
    renderCalc({ unitTypes: [{ label: 'A', count: 1, inPlaceRent: 1200, targetRent: 0 }] });
    expect(screen.getByText(/Enter in-place and target rents/i)).toBeInTheDocument();
  });

  it('does not show number inputs in empty state', () => {
    const { container } = renderCalc({ unitTypes: [{ label: 'A', count: 1, inPlaceRent: 0, targetRent: 0 }] });
    expect(container.querySelector('input[type="number"]')).toBeNull();
  });
});

// ── Active state ─────────────────────────────────────────────────────────────

describe('RehabRentCalculator — active state', () => {
  it('shows "Stabilization Schedule" header', () => {
    renderCalc();
    expect(screen.getByText('Stabilization Schedule')).toBeInTheDocument();
  });

  it('shows Total duration input', () => {
    renderCalc();
    expect(screen.getByLabelText(/Total duration/i)).toBeInTheDocument();
  });

  it('shows Stab. and Reno. toggle buttons', () => {
    renderCalc();
    expect(screen.getByRole('button', { name: /Stab\./i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Reno\./i })).toBeInTheDocument();
  });

  it('shows Apply to Pro Forma and Clear buttons', () => {
    renderCalc();
    expect(screen.getByRole('button', { name: /Apply to Pro Forma/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Clear/i })).toBeInTheDocument();
  });

  it('does not show "Apply to Pre-Stab" button', () => {
    renderCalc();
    expect(screen.queryByRole('button', { name: /Apply to Pre-Stab/i })).toBeNull();
  });

  it('shows Cancel button in header', () => {
    renderCalc();
    expect(screen.getByRole('button', { name: /cancel calculator/i })).toBeInTheDocument();
  });

  it('does not show "Applied" badge by default', () => {
    renderCalc();
    expect(screen.queryByText('Applied')).toBeNull();
  });

  it('shows "Applied" badge when appliedYears is non-empty', () => {
    renderCalc({ appliedYears: { 1: 21600 } });
    expect(screen.getByText('Applied')).toBeInTheDocument();
  });

  it('shows per-unit Mo/unit input when Renovation selected (default)', () => {
    renderCalc();
    expect(screen.getByLabelText(/Months per unit SFR/i)).toBeInTheDocument();
  });

  it('hides Mo/unit inputs when Stabilization selected', async () => {
    const user = userEvent.setup();
    renderCalc();
    await user.click(screen.getByRole('button', { name: /Stab\./i }));
    expect(screen.queryAllByLabelText(/Months per unit/i)).toHaveLength(0);
  });

  it('shows no-vacancy hint when Stabilization selected', async () => {
    const user = userEvent.setup();
    renderCalc();
    await user.click(screen.getByRole('button', { name: /Stab\./i }));
    expect(screen.getByText(/no vacancy/i)).toBeInTheDocument();
  });
});

// ── Per-type cards ────────────────────────────────────────────────────────────

describe('RehabRentCalculator — per-type cards', () => {
  it('shows a card for each unit type', () => {
    renderCalc({ unitTypes: mfrUnits });
    expect(screen.getAllByText('1BR').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('2BR').length).toBeGreaterThanOrEqual(1);
  });

  it('shows Stabilize input for each unit type', () => {
    renderCalc({ unitTypes: mfrUnits });
    expect(screen.getByLabelText(/Units to stabilize 1BR/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Units to stabilize 2BR/i)).toBeInTheDocument();
  });

  it('shows Mo/unit input for each unit type in renovation mode', () => {
    renderCalc({ unitTypes: mfrUnits });
    expect(screen.getByLabelText(/Months per unit 1BR/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Months per unit 2BR/i)).toBeInTheDocument();
  });

  it('shows unit counts in type headers', () => {
    renderCalc({ unitTypes: mfrUnits });
    expect(screen.getByText(/3 units/i)).toBeInTheDocument();
    expect(screen.getByText(/2 units/i)).toBeInTheDocument();
  });
});

// ── Monthly grid ─────────────────────────────────────────────────────────────

describe('RehabRentCalculator — monthly grid', () => {
  it('shows month rows after entering duration', () => {
    renderCalc({ unitTypes: mfrUnits });
    fireEvent.change(screen.getByLabelText(/Total duration/i), { target: { value: '3' } });
    expect(screen.getByText('Year 1')).toBeInTheDocument();
  });

  it('shows Year 1 group header', () => {
    renderCalc({ unitTypes: mfrUnits });
    fireEvent.change(screen.getByLabelText(/Total duration/i), { target: { value: '6' } });
    expect(screen.getByText('Year 1')).toBeInTheDocument();
  });

  it('shows Year 2 group header when duration > 12', () => {
    renderCalc({ unitTypes: mfrUnits });
    fireEvent.change(screen.getByLabelText(/Total duration/i), { target: { value: '15' } });
    expect(screen.getByText('Year 2')).toBeInTheDocument();
  });

  it('shows per-type cell inputs in each month row', () => {
    renderCalc({ unitTypes: mfrUnits });
    fireEvent.change(screen.getByLabelText(/Total duration/i), { target: { value: '2' } });
    expect(screen.getAllByLabelText(/Mo 1 1BR/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByLabelText(/Mo 1 2BR/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByLabelText(/Mo 2 1BR/i).length).toBeGreaterThanOrEqual(1);
  });

  it('Auto-fill button appears in month 1 row', () => {
    renderCalc({ unitTypes: mfrUnits });
    fireEvent.change(screen.getByLabelText(/Total duration/i), { target: { value: '3' } });
    expect(screen.getAllByRole('button', { name: /Auto-fill schedule/i }).length).toBeGreaterThanOrEqual(1);
  });

  it('Auto-fill distributes units evenly across months', async () => {
    const user = userEvent.setup();
    renderCalc({ unitTypes: [{ label: '1BR', count: 4, inPlaceRent: 1000, targetRent: 1500 }] });

    fireEvent.change(screen.getByLabelText(/Total duration/i), { target: { value: '4' } });
    fireEvent.change(screen.getByLabelText(/Units to stabilize 1BR/i), { target: { value: '4' } });

    await user.click(screen.getAllByRole('button', { name: /Auto-fill schedule/i })[0]);

    // 4 units / 4 months = 1 per month
    const mo1Input = screen.getAllByLabelText(/Mo 1 1BR/i)[0] as HTMLInputElement;
    expect(Number(mo1Input.value)).toBe(1);
    const mo4Input = screen.getAllByLabelText(/Mo 4 1BR/i)[0] as HTMLInputElement;
    expect(Number(mo4Input.value)).toBe(1);
  });
});

// ── Schedule validation ───────────────────────────────────────────────────────

describe('RehabRentCalculator — schedule validation', () => {
  it('Apply button is disabled when schedule total does not match target', () => {
    renderCalc();
    fireEvent.change(screen.getByLabelText(/Total duration/i), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText(/Units to stabilize SFR/i), { target: { value: '1' } });
    expect(screen.getByRole('button', { name: /Apply to Pro Forma/i })).toBeDisabled();
  });

  it('shows warning when schedules are incomplete', () => {
    renderCalc({ unitTypes: mfrUnits });
    fireEvent.change(screen.getByLabelText(/Total duration/i), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText(/Units to stabilize 1BR/i), { target: { value: '3' } });
    fireEvent.change(screen.getAllByLabelText(/Mo 1 1BR/i)[0], { target: { value: '1' } });
    expect(screen.getByText(/Schedule totals must match/i)).toBeInTheDocument();
  });
});

// ── Apply ─────────────────────────────────────────────────────────────────────

describe('RehabRentCalculator — Apply to Pro Forma', () => {
  async function applyWithValidSchedule(unitTypes = [sfrUnit]) {
    const user = userEvent.setup();
    const { props } = renderCalc({ unitTypes });

    fireEvent.change(screen.getByLabelText(/Total duration/i), { target: { value: '2' } });

    for (const ut of unitTypes) {
      fireEvent.change(screen.getByLabelText(new RegExp(`Units to stabilize ${ut.label}`, 'i')), {
        target: { value: String(ut.count) },
      });
    }

    await user.click(screen.getAllByRole('button', { name: /Auto-fill schedule/i })[0]);
    await user.click(screen.getByRole('button', { name: /Apply to Pro Forma/i }));

    return props;
  }

  it('calls onApply with year overrides', async () => {
    const props = await applyWithValidSchedule();
    expect(props.onApply).toHaveBeenCalledOnce();
    const overrides = props.onApply.mock.calls[0][0] as Record<number, number>;
    expect(Object.keys(overrides).length).toBeGreaterThanOrEqual(1);
  });

  it('onApply override values are positive', async () => {
    const props = await applyWithValidSchedule();
    const overrides = props.onApply.mock.calls[0][0] as Record<number, number>;
    Object.values(overrides).forEach(v => expect(v).toBeGreaterThan(0));
  });

  it('calls onOpenChange(false) after applying', async () => {
    const props = await applyWithValidSchedule();
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
  });

  it('calls onApplyPreStab with one value per unit type', async () => {
    const props = await applyWithValidSchedule(mfrUnits);
    expect(props.onApplyPreStab).toHaveBeenCalledOnce();
    const values = props.onApplyPreStab!.mock.calls[0][0] as number[];
    expect(values).toHaveLength(mfrUnits.length);
    values.forEach(v => expect(v).toBeGreaterThan(0));
  });
});

// ── Clear & Cancel ────────────────────────────────────────────────────────────

describe('RehabRentCalculator — Clear', () => {
  it('calls onClear when Clear is clicked', async () => {
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

describe('RehabRentCalculator — Cancel', () => {
  it('calls onOpenChange(false) when Cancel is clicked', async () => {
    const user = userEvent.setup();
    const { props } = renderCalc();
    await user.click(screen.getByRole('button', { name: /cancel calculator/i }));
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
  });
});
