/**
 * Tests for ProFormaGrid "Revert row to formula" behaviour
 *
 * The revert button clears year overrides for a field so the chain
 * flows from Year 1 forward. The fix in this session changed non-grossRent
 * fields to KEEP Year 1's override (it's the chain anchor) and only clear
 * Year 2+ overrides.
 *
 * grossRent:               clears ALL year overrides; promotes Yr1 value to
 *                          `grossRent.stabilized` as new chain anchor
 * otherIncome/vacancyPct/creditLossPct:
 *                          keeps Yr1 override; clears Yr2+ overrides so
 *                          flow resumes from the Yr1 value
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProFormaGrid, defaultProForma } from '@/components/DealAnalyzer/ProFormaGrid';
import type { ProFormaData } from '@/types';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeDataWithOtherIncomeOverrides(): ProFormaData {
  const base = defaultProForma('sfr');
  return {
    ...base,
    grossRent: { ...base.grossRent, stabilized: 24_000 },
    otherIncome: { ...base.otherIncome, stabilized: 1_000 },
    yearOverrides: {
      1: { otherIncome: 500 },
      2: { otherIncome: 1_200 },
      3: { otherIncome: 1_400 },
    },
  };
}

function makeDataWithGrossRentOverrides(): ProFormaData {
  const base = defaultProForma('sfr');
  return {
    ...base,
    grossRent: { ...base.grossRent, stabilized: 24_000 },
    yearOverrides: {
      1: { grossRent: 20_000, grossRentSystem: false },
      2: { grossRent: 22_000, grossRentSystem: false },
      3: { grossRent: 24_500, grossRentSystem: false },
    },
  };
}

function makeDataWithVacancyOverrides(): ProFormaData {
  const base = defaultProForma('sfr');
  return {
    ...base,
    vacancyPct: { ...base.vacancyPct, stabilized: 5 },
    yearOverrides: {
      1: { vacancyPct: 8 },
      2: { vacancyPct: 10 },
      3: { vacancyPct: 12 },
    },
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Revert row — otherIncome', () => {
  it('keeps Year 1 override and clears Years 2+ when reverting otherIncome', async () => {
    const user = userEvent.setup();
    const data = makeDataWithOtherIncomeOverrides();
    const onChange = vi.fn();

    render(
      <ProFormaGrid data={data} onChange={onChange} projectionYears={5} showWarnings={false} />
    );

    // Hover the Other Income row to reveal the revert button
    const otherIncomeRow = screen.getByText('Other Income').closest('tr')!;
    await user.hover(within(otherIncomeRow).getByText('Other Income'));

    // Click the revert (RotateCcw) button on the row label
    const revertBtn = within(otherIncomeRow).getByTitle('Revert row to formula');
    await user.click(revertBtn);

    expect(onChange).toHaveBeenCalledOnce();
    const updated: ProFormaData = onChange.mock.calls[0][0];

    // Year 1 override MUST be preserved — it's the chain anchor
    expect(updated.yearOverrides?.[1]?.otherIncome).toBe(500);

    // Year 2 and Year 3 overrides MUST be cleared
    expect(updated.yearOverrides?.[2]?.otherIncome).toBeUndefined();
    expect(updated.yearOverrides?.[3]?.otherIncome).toBeUndefined();
  });
});

describe('Revert row — vacancyPct', () => {
  it('keeps Year 1 override and clears Years 2+ when reverting vacancyPct', async () => {
    const user = userEvent.setup();
    const data = makeDataWithVacancyOverrides();
    const onChange = vi.fn();

    render(
      <ProFormaGrid data={data} onChange={onChange} projectionYears={5} showWarnings={false} />
    );

    const vacancyRow = screen.getByText('Vacancy').closest('tr')!;
    await user.hover(within(vacancyRow).getByText('Vacancy'));
    const revertBtn = within(vacancyRow).getByTitle('Revert row to formula');
    await user.click(revertBtn);

    expect(onChange).toHaveBeenCalledOnce();
    const updated: ProFormaData = onChange.mock.calls[0][0];

    // Year 1 override preserved
    expect(updated.yearOverrides?.[1]?.vacancyPct).toBe(8);
    // Years 2+ cleared
    expect(updated.yearOverrides?.[2]?.vacancyPct).toBeUndefined();
    expect(updated.yearOverrides?.[3]?.vacancyPct).toBeUndefined();
  });
});

describe('Revert row — grossRent', () => {
  it('clears ALL year overrides and promotes Yr1 value to stabilized', async () => {
    const user = userEvent.setup();
    const data = makeDataWithGrossRentOverrides();
    const onChange = vi.fn();

    render(
      <ProFormaGrid data={data} onChange={onChange} projectionYears={5} showWarnings={false} />
    );

    const grossRentRow = screen.getByText('Gross Rent').closest('tr')!;
    await user.hover(within(grossRentRow).getByText('Gross Rent'));
    const revertBtn = within(grossRentRow).getByTitle('Revert row to formula');
    await user.click(revertBtn);

    expect(onChange).toHaveBeenCalledOnce();
    const updated: ProFormaData = onChange.mock.calls[0][0];

    // All year overrides for grossRent cleared
    expect(updated.yearOverrides?.[1]?.grossRent).toBeUndefined();
    expect(updated.yearOverrides?.[2]?.grossRent).toBeUndefined();
    expect(updated.yearOverrides?.[3]?.grossRent).toBeUndefined();

    // Yr1 value (20_000) promoted to grossRent.stabilized
    expect(updated.grossRent.stabilized).toBe(20_000);
  });
});
