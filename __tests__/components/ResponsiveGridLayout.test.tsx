/**
 * Tests that all Deal Analyzer step components use responsive grid classes
 * (grid-cols-1 sm:grid-cols-2) instead of the hardcoded grid-cols-2,
 * so input fields stack vertically on mobile.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, container } from '@testing-library/react';
import { StepExit } from '@/components/DealAnalyzer/steps/StepExit';
import { StepFinancing } from '@/components/DealAnalyzer/steps/StepFinancing';
import { StepProperty } from '@/components/DealAnalyzer/steps/StepProperty';
import { StepRefinance } from '@/components/DealAnalyzer/steps/StepRefinance';
import { StepOperations } from '@/components/DealAnalyzer/steps/StepOperations';
import type { CoCAcquisition, CoCOperations, CoCRefinance, CoCUnitMixEntry } from '@/types';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const baseAcquisition: CoCAcquisition = {
  propertyAddress: '',
  propertyType: 'sfr',
  units: 1,
  sfrBeds: 3,
  sfrBaths: 2,
  sfrInPlaceRent: 0,
  sfrPreStabRent: 0,
  sfrTargetRent: 0,
  unitMix: [],
  purchasePrice: 350000,
  arv: 0,
  downPaymentPct: 20,
  closingCostsPct: 2,
  points: 0,
  additionalFeeItems: [],
  hardCostItems: [],
  softCostItems: [],
  opportunityCostItems: [],
  renovationMonths: 0,
  interestRate: 7,
  loanTermYears: 30,
  ioPeriodMonths: 0,
  stabilizedMonth: 1,
  projectionYears: 5,
  exitCapRate: 0,
  exitClosingCostPct: 3,
  exitMethod: 'value',
};

const baseRefinance: CoCRefinance = {
  enabled: true,
  refiYear: 3,
  refiMarketValue: 400000,
  newLTV: 75,
  newInterestRate: 6.5,
  newLoanTermYears: 30,
  refiCostPct: 2,
};

const baseOperations: CoCOperations = {
  grossRentMonthly: 2000,
  vacancyRatePct: 5,
  opexPct: 30,
  propertyMgmtPct: 8,
  annualRentGrowthPct: 3,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Returns all elements with class containing grid-cols-2 (not preceded by sm:) */
function findHardcodedGridCols2(container: HTMLElement): Element[] {
  return Array.from(container.querySelectorAll('[class*="grid-cols-2"]')).filter((el) => {
    const cls = el.getAttribute('class') ?? '';
    // A class string like "grid grid-cols-2 gap-3" has a bare grid-cols-2 (not sm:grid-cols-2)
    return /(?<![:\w])grid-cols-2/.test(cls);
  });
}

function findResponsiveGridCols(container: HTMLElement): Element[] {
  return Array.from(container.querySelectorAll('[class*="sm:grid-cols-2"]'));
}

// ── StepExit ──────────────────────────────────────────────────────────────────

describe('StepExit responsive grids', () => {
  function renderExit(refiEnabled = false) {
    const refinance = { ...baseRefinance, enabled: refiEnabled };
    const { container } = render(
      <StepExit
        acquisition={baseAcquisition}
        refinance={refinance}
        onAcquisitionChange={vi.fn()}
        onRefinanceChange={vi.fn()}
      />
    );
    return container;
  }

  it('exit assumptions grid uses sm:grid-cols-2, not bare grid-cols-2', () => {
    const c = renderExit();
    // The exit value / selling costs grid must be responsive
    const responsive = findResponsiveGridCols(c);
    expect(responsive.length).toBeGreaterThanOrEqual(1);
  });

  it('refi LTV/rate and term/costs grids are responsive when refi is enabled', () => {
    const c = renderExit(true);
    const responsive = findResponsiveGridCols(c);
    // exit grid + LTV/rate grid + term/costs grid = 3
    expect(responsive.length).toBeGreaterThanOrEqual(3);
  });

  it('has no hardcoded grid-cols-2 input grids', () => {
    const c = renderExit(true);
    const hardcoded = findHardcodedGridCols2(c);
    expect(hardcoded).toHaveLength(0);
  });
});

// ── StepFinancing ─────────────────────────────────────────────────────────────

describe('StepFinancing responsive grids', () => {
  function renderFinancing() {
    const { container } = render(
      <StepFinancing data={baseAcquisition} onChange={vi.fn()} />
    );
    return container;
  }

  it('closing costs/points grid uses sm:grid-cols-2', () => {
    const c = renderFinancing();
    const responsive = findResponsiveGridCols(c);
    expect(responsive.length).toBeGreaterThanOrEqual(1);
  });

  it('interest rate/loan term grid uses sm:grid-cols-2', () => {
    const c = renderFinancing();
    const responsive = findResponsiveGridCols(c);
    // Two input grids: closing costs/points and interest rate/loan term
    expect(responsive.length).toBeGreaterThanOrEqual(2);
  });

  it('has no hardcoded grid-cols-2 input grids', () => {
    const c = renderFinancing();
    const hardcoded = findHardcodedGridCols2(c);
    expect(hardcoded).toHaveLength(0);
  });
});

// ── StepProperty ──────────────────────────────────────────────────────────────

describe('StepProperty responsive grids', () => {
  it('SFR beds/baths grid uses sm:grid-cols-2', () => {
    const { container } = render(
      <StepProperty data={{ ...baseAcquisition, propertyType: 'sfr' }} onChange={vi.fn()} />
    );
    const responsive = findResponsiveGridCols(container);
    expect(responsive.length).toBeGreaterThanOrEqual(1);
  });

  it('property type toggle keeps bare grid-cols-2 (visual toggle, not input grid)', () => {
    const { container } = render(
      <StepProperty data={baseAcquisition} onChange={vi.fn()} />
    );
    // The SFR/MFR button toggle intentionally stays as grid-cols-2
    const hardcoded = findHardcodedGridCols2(container);
    expect(hardcoded).toHaveLength(1);
    // And it should contain buttons (not inputs)
    expect(hardcoded[0].querySelectorAll('button').length).toBe(2);
  });

  it('SFR beds/baths grid has no additional hardcoded grid-cols-2 beyond the type toggle', () => {
    const { container } = render(
      <StepProperty data={{ ...baseAcquisition, propertyType: 'sfr' }} onChange={vi.fn()} />
    );
    const hardcoded = findHardcodedGridCols2(container);
    // Only 1 hardcoded grid-cols-2: the property type toggle
    expect(hardcoded).toHaveLength(1);
  });
});

// ── StepRefinance ─────────────────────────────────────────────────────────────

describe('StepRefinance responsive grids', () => {
  function renderRefinance(enabled = true) {
    const { container } = render(
      <StepRefinance
        data={{ ...baseRefinance, enabled }}
        arv={400000}
        exitCapRate={0}
        projectionYears={5}
        onChange={vi.fn()}
        onArvChange={vi.fn()}
        onExitCapRateChange={vi.fn()}
      />
    );
    return container;
  }

  it('LTV/interest rate grid uses sm:grid-cols-2 when refi enabled', () => {
    const c = renderRefinance(true);
    const responsive = findResponsiveGridCols(c);
    expect(responsive.length).toBeGreaterThanOrEqual(1);
  });

  it('has no hardcoded grid-cols-2 input grids', () => {
    const c = renderRefinance(true);
    const hardcoded = findHardcodedGridCols2(c);
    expect(hardcoded).toHaveLength(0);
  });
});

// ── StepOperations ────────────────────────────────────────────────────────────

describe('StepOperations responsive grids', () => {
  function renderOperations(unitMix: CoCUnitMixEntry[] = []) {
    const { container } = render(
      <StepOperations
        data={baseOperations}
        onChange={vi.fn()}
        propertyType="sfr"
        unitMix={unitMix}
        onUnitMixChange={vi.fn()}
      />
    );
    return container;
  }

  it('vacancy/opex grid uses sm:grid-cols-2', () => {
    const c = renderOperations();
    const responsive = findResponsiveGridCols(c);
    expect(responsive.length).toBeGreaterThanOrEqual(1);
  });

  it('property mgmt/rent growth grid uses sm:grid-cols-2', () => {
    const c = renderOperations();
    const responsive = findResponsiveGridCols(c);
    // Two 2-column input grids
    expect(responsive.length).toBeGreaterThanOrEqual(2);
  });

  it('has no hardcoded grid-cols-2 input grids', () => {
    const c = renderOperations();
    const hardcoded = findHardcodedGridCols2(c);
    expect(hardcoded).toHaveLength(0);
  });
});
