/**
 * Unit tests for the WizardEditSession component (Stage 1).
 *
 * This stage is scaffolding only — the component holds a draft of the four
 * deal slices + isValueAdd/calcState, exposes scoped setters via a render
 * prop, and emits onCommit/onCancel. No side-effects migrated yet.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import type { CoCAcquisition, CoCOperations, CoCRefinance, ProFormaData } from '@/types';
import {
  WizardEditSession,
  type WizardEditSessionDraft,
  type WizardEditSessionSetters,
} from '@/components/DealAnalyzer/WizardEditSession';

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makeAcquisition(overrides: Partial<CoCAcquisition> = {}): CoCAcquisition {
  return {
    propertyAddress: '123 Main St',
    propertyType: 'sfr',
    units: 1,
    sfrBeds: 3, sfrBaths: 2,
    sfrInPlaceRent: 0, sfrPreStabRent: 1_800, sfrTargetRent: 2_000,
    unitMix: [],
    purchasePrice: 200_000,
    arv: 240_000,
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
    exitCapRate: 6,
    exitMethod: 'capRate' as const,
    exitClosingCostPct: 3,
    ...overrides,
  };
}

function makeOps(): CoCOperations {
  return { grossRentMonthly: 2_000, vacancyRatePct: 5, opexPct: 30, propertyMgmtPct: 8, annualRentGrowthPct: 3 };
}

function makeRefinance(): CoCRefinance {
  return { enabled: false, refiYear: 3, refiMarketValue: 0, newLTV: 75, newInterestRate: 6.5, newLoanTermYears: 30, refiCostPct: 2 };
}

function makeProForma(): ProFormaData {
  return {
    grossRent:     { t12: 24_000, stab: null, stabilized: 24_000, growthPct: 3 },
    otherIncome:   { t12: 0,      stab: null, stabilized: 0,      growthPct: 2 },
    vacancyPct:    { t12: 5,      stab: null, stabilized: 5 },
    creditLossPct: { t12: 0,      stab: null, stabilized: 0 },
    expenses: [],
    yearOverrides: {},
  };
}

function makeDraft(overrides: Partial<WizardEditSessionDraft> = {}): WizardEditSessionDraft {
  return {
    acquisition: makeAcquisition(),
    proForma:    makeProForma(),
    refinance:   makeRefinance(),
    operations:  makeOps(),
    isValueAdd:  null,
    calcState:   null,
    ...overrides,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Test harness that captures the latest `setters` passed to the render prop
 * so tests can invoke them from outside the React tree.
 */
const DEFAULT_DEFAULTS = { propertyMgmtPct: 8, capExPerUnit: 300, maintenancePct: 5 };

function Harness(props: {
  initial: WizardEditSessionDraft;
  onCommit: (d: WizardEditSessionDraft) => void;
  onCancel: () => void;
  captureSetters: (s: WizardEditSessionSetters) => void;
  captureDraft?: (d: WizardEditSessionDraft) => void;
  preStabMethod?: 'calculator' | 'manual' | null;
  defaults?: { propertyMgmtPct: number; capExPerUnit: number; maintenancePct: number };
}) {
  return (
    <WizardEditSession
      initial={props.initial}
      onCommit={props.onCommit}
      onCancel={props.onCancel}
      preStabMethod={props.preStabMethod ?? 'manual'}
      defaults={props.defaults ?? DEFAULT_DEFAULTS}
    >
      {(draft, setters) => {
        props.captureSetters(setters);
        props.captureDraft?.(draft);
        return (
          <div>
            <span data-testid="purchase-price">{draft.acquisition.purchasePrice}</span>
            <span data-testid="property-type">{draft.acquisition.propertyType}</span>
            <span data-testid="is-value-add">{String(draft.isValueAdd)}</span>
            <span data-testid="opex-pct">{draft.operations.opexPct}</span>
            <span data-testid="refi-enabled">{String(draft.refinance.enabled)}</span>
            <span data-testid="gross-rent-stab">{draft.proForma.grossRent.stabilized}</span>
            <span data-testid="exit-method">{String(draft.acquisition.exitMethod)}</span>
            <span data-testid="expense-count">{draft.proForma.expenses.length}</span>
            <span data-testid="first-expense-stab">
              {draft.proForma.expenses[0]?.stabilizedValue ?? 0}
            </span>
          </div>
        );
      }}
    </WizardEditSession>
  );
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('WizardEditSession', () => {
  it('renders children with the initial draft', () => {
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    let setters!: WizardEditSessionSetters;

    render(
      <Harness
        initial={makeDraft({ acquisition: makeAcquisition({ purchasePrice: 250_000 }) })}
        onCommit={onCommit}
        onCancel={onCancel}
        captureSetters={s => { setters = s; }}
      />,
    );

    expect(screen.getByTestId('purchase-price').textContent).toBe('250000');
    expect(setters).toBeDefined();
  });

  it('setAcquisition updates the draft visibly on next render', () => {
    let setters!: WizardEditSessionSetters;

    render(
      <Harness
        initial={makeDraft()}
        onCommit={vi.fn()}
        onCancel={vi.fn()}
        captureSetters={s => { setters = s; }}
      />,
    );

    expect(screen.getByTestId('purchase-price').textContent).toBe('200000');

    act(() => { setters.setAcquisition(a => ({ ...a, purchasePrice: 500_000 })); });

    expect(screen.getByTestId('purchase-price').textContent).toBe('500000');
  });

  it('setProForma / setRefinance / setOperations / setIsValueAdd / setCalcState all mutate draft', () => {
    let setters!: WizardEditSessionSetters;

    render(
      <Harness
        initial={makeDraft()}
        onCommit={vi.fn()}
        onCancel={vi.fn()}
        captureSetters={s => { setters = s; }}
      />,
    );

    act(() => {
      setters.setProForma(p => ({ ...p, grossRent: { ...p.grossRent, stabilized: 99_999 } }));
      setters.setRefinance(r => ({ ...r, enabled: true }));
      setters.setOperations(o => ({ ...o, opexPct: 42 }));
      setters.setIsValueAdd(true);
    });

    expect(screen.getByTestId('gross-rent-stab').textContent).toBe('99999');
    expect(screen.getByTestId('refi-enabled').textContent).toBe('true');
    expect(screen.getByTestId('opex-pct').textContent).toBe('42');
    expect(screen.getByTestId('is-value-add').textContent).toBe('true');
  });

  it('commit() emits the current draft to onCommit', () => {
    const onCommit = vi.fn();
    let setters!: WizardEditSessionSetters;

    render(
      <Harness
        initial={makeDraft()}
        onCommit={onCommit}
        onCancel={vi.fn()}
        captureSetters={s => { setters = s; }}
      />,
    );

    act(() => { setters.setAcquisition(a => ({ ...a, propertyType: 'mfr' })); });
    act(() => { setters.commit(); });

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit.mock.calls[0][0].acquisition.propertyType).toBe('mfr');
  });

  it('commit() reflects setters invoked in the same act() batch (no stale draft)', () => {
    const onCommit = vi.fn();
    let setters!: WizardEditSessionSetters;

    render(
      <Harness
        initial={makeDraft()}
        onCommit={onCommit}
        onCancel={vi.fn()}
        captureSetters={s => { setters = s; }}
      />,
    );

    // Setter then commit within the same act: draftRef must reflect the
    // just-set value even though setState hasn't fully reconciled.
    act(() => {
      setters.setAcquisition(a => ({ ...a, purchasePrice: 777_777 }));
      setters.commit();
    });

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit.mock.calls[0][0].acquisition.purchasePrice).toBe(777_777);
  });

  it('cancel() invokes onCancel and does NOT invoke onCommit', () => {
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    let setters!: WizardEditSessionSetters;

    render(
      <Harness
        initial={makeDraft()}
        onCommit={onCommit}
        onCancel={onCancel}
        captureSetters={s => { setters = s; }}
      />,
    );

    act(() => { setters.setAcquisition(a => ({ ...a, purchasePrice: 999_999 })); });
    act(() => { setters.cancel(); });

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('parent state is NEVER written to by the session itself (isolation check)', () => {
    // If this invariant held, the architectural guarantee is preserved: the
    // session is pure w.r.t. the parent until onCommit is invoked. We assert
    // it by verifying onCommit is the only way draft leaves the session.
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    let setters!: WizardEditSessionSetters;

    render(
      <Harness
        initial={makeDraft()}
        onCommit={onCommit}
        onCancel={onCancel}
        captureSetters={s => { setters = s; }}
      />,
    );

    act(() => {
      setters.setAcquisition(a => ({ ...a, purchasePrice: 111 }));
      setters.setProForma(p => ({ ...p, grossRent: { ...p.grossRent, stabilized: 222 } }));
      setters.setRefinance(r => ({ ...r, enabled: true }));
      setters.setOperations(o => ({ ...o, opexPct: 333 }));
      setters.setIsValueAdd(false);
    });

    // After many draft mutations, onCommit is still untouched
    expect(onCommit).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('setter identity is stable across re-renders (safe for useEffect deps)', () => {
    const capturedSetters: WizardEditSessionSetters[] = [];
    const { rerender } = render(
      <Harness
        initial={makeDraft()}
        onCommit={vi.fn()}
        onCancel={vi.fn()}
        captureSetters={s => { capturedSetters.push(s); }}
      />,
    );

    const initialSetAcquisition = capturedSetters[0].setAcquisition;

    act(() => { capturedSetters[0].setAcquisition(a => ({ ...a, purchasePrice: 1 })); });
    rerender(
      <Harness
        initial={makeDraft()}
        onCommit={vi.fn()}
        onCancel={vi.fn()}
        captureSetters={s => { capturedSetters.push(s); }}
      />,
    );

    const latestSetAcquisition = capturedSetters[capturedSetters.length - 1].setAcquisition;
    expect(latestSetAcquisition).toBe(initialSetAcquisition);
  });

  it('renders the render-prop children (integration with DOM)', () => {
    render(
      <Harness
        initial={makeDraft({ acquisition: makeAcquisition({ propertyType: 'mfr' }) })}
        onCommit={vi.fn()}
        onCancel={vi.fn()}
        captureSetters={vi.fn()}
      />,
    );

    expect(screen.getByTestId('property-type').textContent).toBe('mfr');
  });
});

// ── Stage 2: derived-state effects inside the session ───────────────────────

describe('WizardEditSession — derived-state effects', () => {
  it('rent-sync: MFR unit-mix rent changes update proForma.grossRent.stabilized', async () => {
    let setters!: WizardEditSessionSetters;

    render(
      <Harness
        initial={makeDraft({
          acquisition: makeAcquisition({
            propertyType: 'mfr',
            unitMix: [{ id: 'u1', beds: 2, baths: 1, count: 4, rentMonthly: 2_000, inPlaceRent: 1_500, preStabRent: 1_500, unitsToRenovate: 0, leaseUpUnits: 0 }],
          }),
        })}
        onCommit={vi.fn()}
        onCancel={vi.fn()}
        captureSetters={s => { setters = s; }}
      />,
    );

    // Initial: unitMix is 4x$2000/mo → totalTarget=$8000/mo → stabilized=$96000/yr
    await act(async () => {});
    expect(Number(screen.getByTestId('gross-rent-stab').textContent)).toBe(96_000);

    // Bump rent to $2500 — stabilized should become 4*2500*12 = $120000
    act(() => {
      setters.setAcquisition(a => ({
        ...a,
        unitMix: a.unitMix.map(u => ({ ...u, rentMonthly: 2_500 })),
      }));
    });
    await act(async () => {});
    expect(Number(screen.getByTestId('gross-rent-stab').textContent)).toBe(120_000);
  });

  it('exit-method: MFR → 5 units auto-sets exitMethod to capRate', async () => {
    let setters!: WizardEditSessionSetters;

    render(
      <Harness
        initial={makeDraft({
          acquisition: makeAcquisition({
            propertyType: 'mfr',
            unitMix: [{ id: 'u1', beds: 2, baths: 1, count: 4, rentMonthly: 2_000, inPlaceRent: 0, preStabRent: 0, unitsToRenovate: 0, leaseUpUnits: 0 }],
            exitMethod: 'value',
          }),
        })}
        onCommit={vi.fn()}
        onCancel={vi.fn()}
        captureSetters={s => { setters = s; }}
      />,
    );

    // 4 units = not large MFR, exitMethod stays 'value'
    await act(async () => {});
    expect(screen.getByTestId('exit-method').textContent).toBe('value');

    // Bump to 5 units → threshold crossed, effect flips to 'capRate'
    act(() => {
      setters.setAcquisition(a => ({
        ...a,
        unitMix: a.unitMix.map(u => ({ ...u, count: 5 })),
      }));
    });
    await act(async () => {});
    expect(screen.getByTestId('exit-method').textContent).toBe('capRate');
  });

  it('exit-method: dropping MFR back below 5 flips to value', async () => {
    let setters!: WizardEditSessionSetters;

    render(
      <Harness
        initial={makeDraft({
          acquisition: makeAcquisition({
            propertyType: 'mfr',
            unitMix: [{ id: 'u1', beds: 2, baths: 1, count: 6, rentMonthly: 2_000, inPlaceRent: 0, preStabRent: 0, unitsToRenovate: 0, leaseUpUnits: 0 }],
            exitMethod: 'capRate',
          }),
        })}
        onCommit={vi.fn()}
        onCancel={vi.fn()}
        captureSetters={s => { setters = s; }}
      />,
    );

    await act(async () => {});
    expect(screen.getByTestId('exit-method').textContent).toBe('capRate');

    act(() => {
      setters.setAcquisition(a => ({
        ...a,
        unitMix: a.unitMix.map(u => ({ ...u, count: 3 })),
      }));
    });
    await act(async () => {});
    expect(screen.getByTestId('exit-method').textContent).toBe('value');
  });

  it('proForma-reset: switching propertyType resets proForma to defaults for new type', async () => {
    let setters!: WizardEditSessionSetters;

    const customProForma = makeProForma();
    // Add a custom expense to verify it gets wiped by the type-change effect
    customProForma.expenses = [
      { id: 'custom', name: 'My Custom Line', isPercentOfEGI: false, t12Value: 999, stabValue: null, stabilizedValue: 999, growthPct: 0 },
    ];

    render(
      <Harness
        initial={makeDraft({
          acquisition: makeAcquisition({ propertyType: 'mfr', unitMix: [] }),
          proForma: customProForma,
        })}
        onCommit={vi.fn()}
        onCancel={vi.fn()}
        captureSetters={s => { setters = s; }}
      />,
    );

    await act(async () => {});
    expect(screen.getByTestId('expense-count').textContent).toBe('1');

    // Switch to SFR — proForma-reset effect fires, replaces proForma with defaults
    act(() => { setters.setAcquisition(a => ({ ...a, propertyType: 'sfr' })); });
    await act(async () => {});

    // After reset, expenses should be the SFR defaults (not the custom 'My Custom Line')
    expect(screen.getByTestId('expense-count').textContent).not.toBe('1');
    // First expense should not be the custom one
    expect(screen.getByTestId('first-expense-stab').textContent).not.toBe('999');
  });

  it('CapEx-recalc: MFR unit-count change updates CapEx Reserves stabilizedValue', async () => {
    let setters!: WizardEditSessionSetters;

    // Seed with an MFR proForma containing a CapEx Reserves line
    const pf = makeProForma();
    pf.expenses = [
      { id: 'capex', name: 'CapEx Reserves', isPercentOfEGI: false, t12Value: 600, stabValue: null, stabilizedValue: 600, growthPct: 0 },
    ];

    render(
      <Harness
        initial={makeDraft({
          acquisition: makeAcquisition({
            propertyType: 'mfr',
            unitMix: [{ id: 'u1', beds: 2, baths: 1, count: 2, rentMonthly: 2_000, inPlaceRent: 0, preStabRent: 0, unitsToRenovate: 0, leaseUpUnits: 0 }],
          }),
          proForma: pf,
        })}
        onCommit={vi.fn()}
        onCancel={vi.fn()}
        captureSetters={s => { setters = s; }}
        defaults={{ propertyMgmtPct: 8, capExPerUnit: 300, maintenancePct: 5 }}
      />,
    );

    // Unit count goes from 2 → 5, CapEx should recompute to 300 * 5 = 1500
    act(() => {
      setters.setAcquisition(a => ({
        ...a,
        unitMix: a.unitMix.map(u => ({ ...u, count: 5 })),
      }));
    });
    await act(async () => {});
    expect(Number(screen.getByTestId('first-expense-stab').textContent)).toBe(1_500);
  });

  // ── BUG REPRO — the whole reason for this refactor ────────────────────

  it('BUG REPRO: propertyType flip inside session does NOT leak to parent on Cancel', async () => {
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    let setters!: WizardEditSessionSetters;

    const customProForma = makeProForma();
    customProForma.expenses = [
      { id: 'custom', name: 'Heavily Customized Line', isPercentOfEGI: false, t12Value: 12345, stabValue: null, stabilizedValue: 12345, growthPct: 0 },
    ];
    const initial = makeDraft({
      acquisition: makeAcquisition({ propertyType: 'mfr', unitMix: [] }),
      proForma: customProForma,
    });

    render(
      <Harness
        initial={initial}
        onCommit={onCommit}
        onCancel={onCancel}
        captureSetters={s => { setters = s; }}
      />,
    );

    // Flip type — session's proForma-reset effect fires, draft.proForma wiped
    act(() => { setters.setAcquisition(a => ({ ...a, propertyType: 'sfr' })); });
    await act(async () => {});

    // Cancel — parent's state is whatever we passed in as `initial`, which the
    // session has never had write access to. onCommit is never called.
    act(() => { setters.cancel(); });
    expect(onCommit).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);

    // The `initial` object we passed in is unchanged (sanity check that the
    // session is truly draft-isolated — no in-place mutation of parent data).
    expect(initial.acquisition.propertyType).toBe('mfr');
    expect(initial.proForma.expenses).toHaveLength(1);
    expect(initial.proForma.expenses[0].name).toBe('Heavily Customized Line');
    expect(initial.proForma.expenses[0].stabilizedValue).toBe(12345);
  });

  it('BUG REPRO: unmount + remount gives fresh prev-refs (no stale-transition cascade)', async () => {
    // First session: mount, flip propertyType sfr → mfr (driving prevPropertyType
    // to 'mfr' internally). Unmount.
    let setters1!: WizardEditSessionSetters;
    const firstCommit = vi.fn();

    const { unmount } = render(
      <Harness
        initial={makeDraft({ acquisition: makeAcquisition({ propertyType: 'sfr' }) })}
        onCommit={firstCommit}
        onCancel={vi.fn()}
        captureSetters={s => { setters1 = s; }}
      />,
    );
    act(() => { setters1.setAcquisition(a => ({ ...a, propertyType: 'mfr' })); });
    await act(async () => {});
    unmount();

    // Second session: mount fresh with MFR + customized proForma. The internal
    // prevPropertyType should be 'mfr' (from the fresh initial), NOT 'mfr' from
    // the first session's mutation (refs are per-mount).
    //
    // Observable test: if prev-ref were leaking, merely mounting with
    // propertyType 'mfr' would not trigger the reset effect (because prev = mfr
    // = current). If prev-ref wasn't freshly initialized, the first render
    // would see a transition and stomp the custom proForma.
    let setters2!: WizardEditSessionSetters;
    const customProForma = makeProForma();
    customProForma.expenses = [
      { id: 'custom', name: 'Survivor', isPercentOfEGI: false, t12Value: 1, stabValue: null, stabilizedValue: 1, growthPct: 0 },
    ];

    render(
      <Harness
        initial={makeDraft({
          acquisition: makeAcquisition({ propertyType: 'mfr', unitMix: [] }),
          proForma: customProForma,
        })}
        onCommit={vi.fn()}
        onCancel={vi.fn()}
        captureSetters={s => { setters2 = s; }}
      />,
    );
    await act(async () => {});

    // Custom expense should still be there — no stale-transition reset.
    expect(screen.getByTestId('expense-count').textContent).toBe('1');
    expect(screen.getByTestId('first-expense-stab').textContent).toBe('1');

    void setters2; // silence unused-var linter
  });

  it('commit emits latest derived-effect results (rent-sync ran, draft is consistent)', async () => {
    const onCommit = vi.fn();
    let setters!: WizardEditSessionSetters;

    render(
      <Harness
        initial={makeDraft({
          acquisition: makeAcquisition({
            propertyType: 'sfr',
            sfrTargetRent: 2_000,
          }),
        })}
        onCommit={onCommit}
        onCancel={vi.fn()}
        captureSetters={s => { setters = s; }}
      />,
    );

    act(() => {
      setters.setAcquisition(a => ({ ...a, sfrTargetRent: 3_000 }));
    });
    await act(async () => {});
    act(() => { setters.commit(); });

    expect(onCommit).toHaveBeenCalledTimes(1);
    const emitted = onCommit.mock.calls[0][0];
    // Rent-sync effect should have run: stabilized = 3000 * 12 = 36000
    expect(emitted.proForma.grossRent.stabilized).toBe(36_000);
    expect(emitted.operations.grossRentMonthly).toBe(3_000);
  });
});

// Silence unused-import noise — fireEvent reserved for later stages' interaction tests.
void fireEvent;
