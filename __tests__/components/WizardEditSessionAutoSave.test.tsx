import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {
  CoCAcquisition,
  CoCOperations,
  CoCRefinance,
  ProFormaData,
  CalcPersistedState,
} from '@/types';
import { WizardEditSession, type WizardEditSessionDraft } from '@/components/DealAnalyzer/WizardEditSession';

// ── Test scaffolding ─────────────────────────────────────────────────────────

/**
 * Skeleton draft — only fields exercised by autosave tests need real values.
 * The rent-sync / exit-method effects inside WizardEditSession require these
 * shapes to exist even if their values are irrelevant here.
 */
function makeInitialDraft(overrides: Partial<WizardEditSessionDraft> = {}): WizardEditSessionDraft {
  return {
    acquisition: {
      propertyAddress: '',
      propertyType: 'sfr',
      unitMix: [],
      purchasePrice: 100000,
      downPaymentPct: 20,
      closingCostsPct: 3,
      interestRate: 7,
      loanTermYears: 30,
      projectionYears: 10,
      exitYear: 5,
      exitMethod: 'value',
      appreciationPct: 3,
      exitCostsPct: 6,
      sfrTargetRent: 0,
      sfrInPlaceRent: 0,
      sfrPreStabRent: 0,
      sfrBeds: 3,
      sfrBaths: 2,
      units: 1,
      renovationMonths: 0,
      stabilizedMonth: 0,
      rehabBudget: 0,
      additionalFeeItems: [],
    } as unknown as CoCAcquisition,
    proForma: {
      grossRent: { t12: 0, stab: null, stabilized: 0, growthPct: 3 },
      expenses: [],
      yearOverrides: {},
      otherIncome: 0,
      vacancyPct: 5,
      creditLossPct: 0,
    } as unknown as ProFormaData,
    refinance: { enabled: false } as unknown as CoCRefinance,
    operations: { grossRentMonthly: 0 } as unknown as CoCOperations,
    isValueAdd: false,
    calcState: undefined as CalcPersistedState | undefined,
    ...overrides,
  };
}

// Render harness — exposes an "Edit price" button that mutates the draft via
// the session's setters, plus Done/Cancel buttons. This lets tests trigger
// draft changes deterministically without mounting the full step UIs.
function Harness(props: {
  onCommit: (d: WizardEditSessionDraft) => void;
  onCancel: (ctx: { hasAutoSaved: boolean }) => void;
  onAutoSave?: (d: WizardEditSessionDraft) => Promise<void>;
  autoSaveDelayMs?: number;
}) {
  return (
    <WizardEditSession
      initial={makeInitialDraft()}
      onCommit={props.onCommit}
      onCancel={props.onCancel}
      onAutoSave={props.onAutoSave}
      autoSaveDelayMs={props.autoSaveDelayMs ?? 500}
      preStabMethod={null}
      defaults={{ propertyMgmtPct: 8, capExPerUnit: 250, maintenancePct: 5 }}
    >
      {(_draft, setters) => (
        <>
          <button
            type="button"
            onClick={() => setters.setAcquisition((a) => ({ ...a, purchasePrice: (a.purchasePrice || 0) + 1000 }))}
          >
            Bump price
          </button>
          <button type="button" onClick={() => setters.commit()}>Done</button>
          <button type="button" onClick={() => setters.cancel()}>Cancel</button>
        </>
      )}
    </WizardEditSession>
  );
}

// shouldAdvanceTime lets userEvent's internal setTimeout microdelays progress
// against fake time. The advance-per-tick default (20ms) is small enough that
// none of these tests accidentally cross the 500ms debounce threshold, but we
// avoid asserting partial-elapse timings just in case.
beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('WizardEditSession — autosave backwards compatibility', () => {
  it('does not fire any autosave when onAutoSave prop is omitted', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    render(<Harness onCommit={onCommit} onCancel={onCancel} />);

    await user.click(screen.getByText('Bump price'));
    await act(async () => { vi.advanceTimersByTime(5000); await Promise.resolve(); });

    // No side effects — parent handlers untouched, and there's no autosave
    // to observe. This is the "old behavior" contract.
    expect(onCommit).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });
});

describe('WizardEditSession — autosave firing', () => {
  it('fires onAutoSave with the updated draft after the debounce delay', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onAutoSave = vi.fn().mockResolvedValue(undefined);
    // Use a long debounce so userEvent's internal microdelays can't cross it.
    render(
      <Harness onCommit={vi.fn()} onCancel={vi.fn()} onAutoSave={onAutoSave} autoSaveDelayMs={5000} />
    );

    await user.click(screen.getByText('Bump price'));
    expect(onAutoSave).not.toHaveBeenCalled();

    // Elapse the full debounce → save fires with the updated draft.
    await act(async () => { vi.advanceTimersByTime(5000); await Promise.resolve(); });
    expect(onAutoSave).toHaveBeenCalledOnce();
    const savedDraft = onAutoSave.mock.calls[0][0];
    expect(savedDraft.acquisition.purchasePrice).toBe(101000);
  });

  it('debounces rapid typing into a single save', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onAutoSave = vi.fn().mockResolvedValue(undefined);
    render(
      <Harness onCommit={vi.fn()} onCancel={vi.fn()} onAutoSave={onAutoSave} autoSaveDelayMs={500} />
    );

    // Three rapid clicks, each within 200ms — should reset the timer each
    // time so only one save fires at the end.
    await user.click(screen.getByText('Bump price'));
    await act(async () => { vi.advanceTimersByTime(200); await Promise.resolve(); });
    await user.click(screen.getByText('Bump price'));
    await act(async () => { vi.advanceTimersByTime(200); await Promise.resolve(); });
    await user.click(screen.getByText('Bump price'));

    // 500ms after the LAST click → fire.
    await act(async () => { vi.advanceTimersByTime(500); await Promise.resolve(); });

    expect(onAutoSave).toHaveBeenCalledOnce();
    expect(onAutoSave.mock.calls[0][0].acquisition.purchasePrice).toBe(103000);
  });
});

describe('WizardEditSession — commit and cancel interact with autosave', () => {
  it('Done cancels the pending debounce (no autosave fires after commit)', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onAutoSave = vi.fn().mockResolvedValue(undefined);
    const onCommit = vi.fn();

    render(
      <Harness onCommit={onCommit} onCancel={vi.fn()} onAutoSave={onAutoSave} autoSaveDelayMs={500} />
    );

    await user.click(screen.getByText('Bump price'));
    await user.click(screen.getByText('Done'));

    // Even long after the debounce would have naturally fired, autosave
    // should NOT run because commit cancelled it.
    await act(async () => { vi.advanceTimersByTime(5000); await Promise.resolve(); });

    expect(onCommit).toHaveBeenCalledOnce();
    expect(onAutoSave).not.toHaveBeenCalled();
  });

  it('Cancel provides hasAutoSaved: false when nothing was autosaved yet', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onCancel = vi.fn();
    render(
      <Harness onCommit={vi.fn()} onCancel={onCancel} onAutoSave={vi.fn().mockResolvedValue(undefined)} autoSaveDelayMs={500} />
    );

    await user.click(screen.getByText('Bump price'));
    // Cancel BEFORE the debounce fires — no autosave has run.
    await user.click(screen.getByText('Cancel'));

    expect(onCancel).toHaveBeenCalledExactlyOnceWith({ hasAutoSaved: false });
  });

  it('Cancel provides hasAutoSaved: true after at least one autosave fired', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onAutoSave = vi.fn().mockResolvedValue(undefined);
    const onCancel = vi.fn();
    render(
      <Harness onCommit={vi.fn()} onCancel={onCancel} onAutoSave={onAutoSave} autoSaveDelayMs={500} />
    );

    await user.click(screen.getByText('Bump price'));
    // Let the autosave fire and complete.
    await act(async () => { vi.advanceTimersByTime(500); await Promise.resolve(); });
    expect(onAutoSave).toHaveBeenCalledOnce();

    await user.click(screen.getByText('Cancel'));
    expect(onCancel).toHaveBeenCalledExactlyOnceWith({ hasAutoSaved: true });
  });
});

describe('WizardEditSession — unmount flushes pending autosave', () => {
  it('fires the pending autosave when the session unmounts mid-debounce', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onAutoSave = vi.fn().mockResolvedValue(undefined);

    const { unmount } = render(
      <Harness onCommit={vi.fn()} onCancel={vi.fn()} onAutoSave={onAutoSave} autoSaveDelayMs={5000} />
    );

    await user.click(screen.getByText('Bump price'));
    // Way before the debounce would fire naturally.
    unmount();
    await act(async () => { await Promise.resolve(); });

    expect(onAutoSave).toHaveBeenCalledOnce();
    expect(onAutoSave.mock.calls[0][0].acquisition.purchasePrice).toBe(101000);
  });
});

describe('WizardEditSession — status callback', () => {
  it('reports pending → saving → idle via onAutoSaveStateChange', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onAutoSave = vi.fn().mockResolvedValue(undefined);
    const onAutoSaveStateChange = vi.fn();

    render(
      <WizardEditSession
        initial={makeInitialDraft()}
        onCommit={vi.fn()}
        onCancel={vi.fn()}
        onAutoSave={onAutoSave}
        onAutoSaveStateChange={onAutoSaveStateChange}
        autoSaveDelayMs={500}
        preStabMethod={null}
        defaults={{ propertyMgmtPct: 8, capExPerUnit: 250, maintenancePct: 5 }}
      >
        {(_d, setters) => (
          <button type="button" onClick={() => setters.setAcquisition((a) => ({ ...a, purchasePrice: 999 }))}>
            Change
          </button>
        )}
      </WizardEditSession>
    );

    await user.click(screen.getByText('Change'));
    await act(async () => { vi.advanceTimersByTime(500); await Promise.resolve(); });

    const statuses = onAutoSaveStateChange.mock.calls.map((c) => c[0]);
    expect(statuses).toContain('pending');
    expect(statuses).toContain('saving');
    expect(statuses).toContain('idle');
  });
});
