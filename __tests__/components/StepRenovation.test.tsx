/**
 * Tests for StepRenovation warning behaviour:
 *   - Warning icon appears next to a cost item amount when description exists but amount is $0 and showWarnings=true
 *   - No warning when showWarnings=false (default)
 *   - No warning when description is empty (even if amount is 0)
 *   - No warning when amount > 0
 *   - Warnings apply independently to hard costs and soft costs
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StepRenovation } from '@/components/DealAnalyzer/steps/StepRenovation';
import type { CoCAcquisition, CoCCostItem } from '@/types';

// ── Helpers ───────────────────────────────────────────────────────────────────

type RenovationData = Pick<CoCAcquisition, 'hardCostItems' | 'softCostItems'>;

function makeItem(overrides: Partial<CoCCostItem> = {}): CoCCostItem {
  return { id: `item-${Math.random().toString(36).slice(2)}`, description: '', amount: 0, ...overrides };
}

function renderRenovation(data: RenovationData, showWarnings = false) {
  return render(
    <StepRenovation data={data} onChange={vi.fn()} showWarnings={showWarnings} />
  );
}

function emptyData(): RenovationData {
  return { hardCostItems: [], softCostItems: [] };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('StepRenovation hard cost warnings', () => {
  it('shows warning on hard cost amount when description exists and amount is $0 with showWarnings=true', () => {
    const data: RenovationData = {
      hardCostItems: [makeItem({ description: 'Framing', amount: 0 })],
      softCostItems: [],
    };
    renderRenovation(data, true);
    // The warning icon renders inside the amount cell
    expect(screen.getByText('$0').closest('button')).toContainElement(
      document.querySelector('svg') as SVGElement
    );
  });

  it('does NOT show warning on hard cost when showWarnings=false (default)', () => {
    const data: RenovationData = {
      hardCostItems: [makeItem({ description: 'Framing', amount: 0 })],
      softCostItems: [],
    };
    renderRenovation(data, false);
    // $0 is displayed but no warning svg inside that button
    const zeroBtn = screen.getByText('$0').closest('button');
    expect(zeroBtn?.querySelector('svg')).toBeNull();
  });

  it('does NOT show warning when description is empty even if amount is 0', () => {
    const data: RenovationData = {
      hardCostItems: [makeItem({ description: '', amount: 0 })],
      softCostItems: [],
    };
    renderRenovation(data, true);
    const zeroBtn = screen.getByText('$0').closest('button');
    expect(zeroBtn?.querySelector('svg')).toBeNull();
  });

  it('does NOT show warning when amount is greater than 0', () => {
    const data: RenovationData = {
      hardCostItems: [makeItem({ description: 'Framing', amount: 5000 })],
      softCostItems: [],
    };
    renderRenovation(data, true);
    // No $0 text present at all
    expect(screen.queryByText('$0')).not.toBeInTheDocument();
  });
});

describe('StepRenovation soft cost warnings', () => {
  it('shows warning on soft cost amount when description exists and amount is $0 with showWarnings=true', () => {
    const data: RenovationData = {
      hardCostItems: [],
      softCostItems: [makeItem({ description: 'Architect fee', amount: 0 })],
    };
    renderRenovation(data, true);
    const zeroBtn = screen.getByText('$0').closest('button');
    expect(zeroBtn?.querySelector('svg')).not.toBeNull();
  });

  it('does NOT show warning on soft cost when showWarnings=false', () => {
    const data: RenovationData = {
      hardCostItems: [],
      softCostItems: [makeItem({ description: 'Architect fee', amount: 0 })],
    };
    renderRenovation(data, false);
    const zeroBtn = screen.getByText('$0').closest('button');
    expect(zeroBtn?.querySelector('svg')).toBeNull();
  });
});

describe('StepRenovation independent warnings per section', () => {
  it('shows warning only on the section that has description-with-zero-amount', () => {
    const data: RenovationData = {
      hardCostItems: [makeItem({ description: 'Framing', amount: 0 })],
      softCostItems: [makeItem({ description: 'Legal', amount: 2500 })], // non-zero — no warning
    };
    renderRenovation(data, true);

    // One $0 warning (hard cost) and one formatted currency (soft cost)
    const zeroBtns = screen.getAllByText('$0').map(el => el.closest('button'));
    expect(zeroBtns).toHaveLength(1);
    expect(zeroBtns[0]?.querySelector('svg')).not.toBeNull();
  });

  it('shows warnings on both sections when both have description-with-zero-amount', () => {
    const data: RenovationData = {
      hardCostItems: [makeItem({ description: 'Framing', amount: 0 })],
      softCostItems: [makeItem({ description: 'Architect fee', amount: 0 })],
    };
    renderRenovation(data, true);

    const zeroBtns = screen.getAllByText('$0').map(el => el.closest('button'));
    expect(zeroBtns).toHaveLength(2);
    zeroBtns.forEach(btn => expect(btn?.querySelector('svg')).not.toBeNull());
  });

  it('shows no warnings when both sections have items with empty descriptions', () => {
    const data: RenovationData = {
      hardCostItems: [makeItem({ description: '', amount: 0 })],
      softCostItems: [makeItem({ description: '', amount: 0 })],
    };
    renderRenovation(data, true);

    const zeroBtns = screen.getAllByText('$0').map(el => el.closest('button'));
    zeroBtns.forEach(btn => expect(btn?.querySelector('svg')).toBeNull());
  });
});
