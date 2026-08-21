import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useDealAnalyzerStore, DealAnalyzerDraft } from '@/lib/dealAnalyzerStore';
import { api } from '@/lib/api';

// ── Mock api module ────────────────────────────────────────────────────────────

vi.mock('@/lib/api', () => ({
  api: {
    saveDeal: vi.fn().mockResolvedValue({}),
    updateDeal: vi.fn().mockResolvedValue({}),
    deleteDeal: vi.fn().mockResolvedValue(undefined),
    listDeals: vi.fn().mockResolvedValue([]),
  },
}));

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Flush all pending microtasks so fire-and-forget API calls complete. */
const flushPromises = () => new Promise((r) => setTimeout(r, 0));

const makeDraft = (overrides: Partial<DealAnalyzerDraft> = {}): DealAnalyzerDraft => ({
  acquisition: { purchasePrice: 350000 } as DealAnalyzerDraft['acquisition'],
  operations: { grossRentMonthly: 2500 } as DealAnalyzerDraft['operations'],
  proForma: { grossRent: { t12: 30000, stab: 30000, stabilized: 30000, growthPct: 3 }, expenses: [], yearOverrides: {} } as DealAnalyzerDraft['proForma'],
  refinance: { enabled: false } as DealAnalyzerDraft['refinance'],
  currentStep: 4,
  visitedSteps: [0, 1, 2, 3, 4],
  activeType: 'base',
  ...overrides,
});

const SAMPLE_RESULTS = { base: { avgCoCReturn: 0.085, irr: 0.12, equityMultiple: 1.8 } } as never;

// ── Setup ──────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  useDealAnalyzerStore.setState({
    savedDeals: [],
    draft: null,
    scenarios: [],
    activeScenarioId: null,
    syncState: { pendingCount: 0, lastError: null, lastSuccessAt: null, failedDealIds: [] },
  });
  localStorage.clear();
});

// ── saveDeal ───────────────────────────────────────────────────────────────────

describe('saveDeal', () => {
  it('adds the deal to local store immediately', () => {
    const { saveDeal } = useDealAnalyzerStore.getState();
    saveDeal('My Deal', makeDraft(), SAMPLE_RESULTS);

    const { savedDeals } = useDealAnalyzerStore.getState();
    expect(savedDeals).toHaveLength(1);
    expect(savedDeals[0].name).toBe('My Deal');
  });

  it('returns a valid UUID as the deal id', () => {
    const { saveDeal } = useDealAnalyzerStore.getState();
    const id = saveDeal('Deal A', makeDraft(), SAMPLE_RESULTS);

    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
  });

  it('calls api.saveDeal in the background with matching id and data', async () => {
    const { saveDeal } = useDealAnalyzerStore.getState();
    const id = saveDeal('My Deal', makeDraft(), SAMPLE_RESULTS);
    await flushPromises();

    expect(api.saveDeal).toHaveBeenCalledOnce();
    const arg = vi.mocked(api.saveDeal).mock.calls[0][0];
    expect(arg.id).toBe(id);
    expect(arg.name).toBe('My Deal');
    expect(arg.results).toEqual(SAMPLE_RESULTS);
  });

  it('stores deal with acquisition and operations from draft', async () => {
    const draft = makeDraft();
    const { saveDeal } = useDealAnalyzerStore.getState();
    saveDeal('Draft Deal', draft, {});
    await flushPromises();

    const deal = useDealAnalyzerStore.getState().savedDeals[0];
    expect(deal.acquisition).toEqual(draft.acquisition);
    expect(deal.operations).toEqual(draft.operations);
  });

  it('saves mcRanges and mcResults when provided', async () => {
    const mcRanges = { rent: { min: 2000, mode: 2500, max: 3000 } };
    const mcResults = { p50: 0.09 };
    const { saveDeal } = useDealAnalyzerStore.getState();
    saveDeal('MC Deal', makeDraft(), SAMPLE_RESULTS, mcRanges as never, mcResults);
    await flushPromises();

    const deal = useDealAnalyzerStore.getState().savedDeals[0];
    expect(deal.mcRanges).toEqual(mcRanges);
    expect(deal.mcResults).toEqual(mcResults);

    const apiArg = vi.mocked(api.saveDeal).mock.calls[0][0];
    expect(apiArg.mcRanges).toEqual(mcRanges);
    expect(apiArg.mcResults).toEqual(mcResults);
  });

  it('does not block UI when api.saveDeal rejects', async () => {
    vi.mocked(api.saveDeal).mockRejectedValueOnce(new Error('network error'));
    const { saveDeal } = useDealAnalyzerStore.getState();
    saveDeal('Offline Deal', makeDraft(), SAMPLE_RESULTS);
    await flushPromises();

    // Deal still exists locally despite API failure
    expect(useDealAnalyzerStore.getState().savedDeals).toHaveLength(1);
  });
});

// ── updateSavedDeal ────────────────────────────────────────────────────────────

describe('updateSavedDeal', () => {
  it('updates name and results locally', async () => {
    const { saveDeal, updateSavedDeal } = useDealAnalyzerStore.getState();
    const id = saveDeal('Original', makeDraft(), SAMPLE_RESULTS);
    await flushPromises();
    vi.clearAllMocks();

    updateSavedDeal(id, 'Renamed', { base: { avgCoCReturn: 0.1 } } as never);
    await flushPromises();

    const deal = useDealAnalyzerStore.getState().savedDeals.find((d) => d.id === id)!;
    expect(deal.name).toBe('Renamed');
    expect((deal.results as never as { base: { avgCoCReturn: number } }).base.avgCoCReturn).toBe(0.1);
  });

  it('calls api.updateDeal with new values', async () => {
    const { saveDeal, updateSavedDeal } = useDealAnalyzerStore.getState();
    const id = saveDeal('Deal', makeDraft(), SAMPLE_RESULTS);
    await flushPromises();
    vi.clearAllMocks();

    updateSavedDeal(id, 'Updated', SAMPLE_RESULTS);
    await flushPromises();

    expect(api.updateDeal).toHaveBeenCalledOnce();
    const [calledId, payload] = vi.mocked(api.updateDeal).mock.calls[0];
    expect(calledId).toBe(id);
    expect(payload.name).toBe('Updated');
  });

  it('updates acquisition/operations when draft is provided', async () => {
    const { saveDeal, updateSavedDeal } = useDealAnalyzerStore.getState();
    const id = saveDeal('Deal', makeDraft(), SAMPLE_RESULTS);
    await flushPromises();
    vi.clearAllMocks();

    const newDraft = makeDraft({
      acquisition: { purchasePrice: 500000 } as DealAnalyzerDraft['acquisition'],
    });
    updateSavedDeal(id, 'Deal', SAMPLE_RESULTS, newDraft);
    await flushPromises();

    const deal = useDealAnalyzerStore.getState().savedDeals.find((d) => d.id === id)!;
    expect(deal.acquisition).toEqual(newDraft.acquisition);

    const payload = vi.mocked(api.updateDeal).mock.calls[0][1];
    expect(payload.acquisition).toEqual(newDraft.acquisition);
  });

  it('does not block UI when api.updateDeal rejects', async () => {
    vi.mocked(api.updateDeal).mockRejectedValueOnce(new Error('timeout'));
    const { saveDeal, updateSavedDeal } = useDealAnalyzerStore.getState();
    const id = saveDeal('Deal', makeDraft(), SAMPLE_RESULTS);
    await flushPromises();

    updateSavedDeal(id, 'New Name', SAMPLE_RESULTS);
    await flushPromises();

    expect(useDealAnalyzerStore.getState().savedDeals[0].name).toBe('New Name');
  });
});

// ── deleteSavedDeal ────────────────────────────────────────────────────────────

describe('deleteSavedDeal', () => {
  it('removes the deal from local store immediately', () => {
    const { saveDeal, deleteSavedDeal } = useDealAnalyzerStore.getState();
    const id = saveDeal('To Delete', makeDraft(), SAMPLE_RESULTS);

    deleteSavedDeal(id);

    expect(useDealAnalyzerStore.getState().savedDeals).toHaveLength(0);
  });

  it('calls api.deleteDeal in the background', async () => {
    const { saveDeal, deleteSavedDeal } = useDealAnalyzerStore.getState();
    const id = saveDeal('To Delete', makeDraft(), SAMPLE_RESULTS);
    await flushPromises();
    vi.clearAllMocks();

    deleteSavedDeal(id);
    await flushPromises();

    expect(api.deleteDeal).toHaveBeenCalledOnce();
    expect(vi.mocked(api.deleteDeal).mock.calls[0][0]).toBe(id);
  });

  it('restores the deal locally when api.deleteDeal rejects', async () => {
    // Behavior change (2026-08): a failed delete now rolls back the local
    // removal so users don't see a fake success. See dealAnalyzerStore.ts
    // deleteSavedDeal for the rollback path.
    vi.mocked(api.deleteDeal).mockRejectedValueOnce(new Error('gone'));
    const { saveDeal, deleteSavedDeal } = useDealAnalyzerStore.getState();
    const id = saveDeal('Deal', makeDraft(), SAMPLE_RESULTS);
    await flushPromises();

    deleteSavedDeal(id);
    await flushPromises();

    // Rolled back — deal reappears so the UI reflects reality
    expect(useDealAnalyzerStore.getState().savedDeals.find((d) => d.id === id)).toBeDefined();
  });
});

// ── updateCurrentStep ──────────────────────────────────────────────────────────

describe('updateCurrentStep', () => {
  it('updates currentStep locally and syncs to backend', async () => {
    const { saveDeal, updateCurrentStep } = useDealAnalyzerStore.getState();
    const id = saveDeal('Deal', makeDraft(), SAMPLE_RESULTS);
    await flushPromises();
    vi.clearAllMocks();

    updateCurrentStep(id, 2);
    await flushPromises();

    const deal = useDealAnalyzerStore.getState().savedDeals.find((d) => d.id === id)!;
    expect(deal.currentStep).toBe(2);

    expect(api.updateDeal).toHaveBeenCalledOnce();
    expect(vi.mocked(api.updateDeal).mock.calls[0][1].currentStep).toBe(2);
  });
});

// ── updateMCData ───────────────────────────────────────────────────────────────

describe('updateMCData', () => {
  it('updates mcRanges and mcResults locally and syncs to backend', async () => {
    const { saveDeal, updateMCData } = useDealAnalyzerStore.getState();
    const id = saveDeal('Deal', makeDraft(), SAMPLE_RESULTS);
    await flushPromises();
    vi.clearAllMocks();

    const mcRanges = { rent: { min: 2000, mode: 2500, max: 3000 } };
    const mcResults = { p10: 0.05, p50: 0.09, p90: 0.14 };
    updateMCData(id, mcRanges as never, mcResults);
    await flushPromises();

    const deal = useDealAnalyzerStore.getState().savedDeals.find((d) => d.id === id)!;
    expect(deal.mcRanges).toEqual(mcRanges);
    expect(deal.mcResults).toEqual(mcResults);

    const payload = vi.mocked(api.updateDeal).mock.calls[0][1];
    expect(payload.mcRanges).toEqual(mcRanges);
    expect(payload.mcResults).toEqual(mcResults);
  });
});

// ── syncDealsFromBackend ───────────────────────────────────────────────────────

describe('syncDealsFromBackend', () => {
  it('merges backend deals with local-only deals (non-destructive)', async () => {
    // Seed a local deal that never synced to backend (e.g., original save failed)
    const { saveDeal } = useDealAnalyzerStore.getState();
    vi.mocked(api.saveDeal).mockRejectedValueOnce(new Error('offline'));
    saveDeal('Unsynced Local Deal', makeDraft(), SAMPLE_RESULTS);
    await flushPromises();

    const backendDeals = [
      {
        id: '11111111-1111-1111-1111-111111111111',
        name: 'Backend Deal',
        acquisition: { purchasePrice: 400000 },
        operations: { grossRentMonthly: 3000 },
        proForma: {},
        refinance: { enabled: false },
        results: { base: { irr: 0.1 } },
        mcRanges: null,
        mcResults: null,
        currentStep: 3,
        savedAt: '2026-03-29T10:00:00',
        updatedAt: '2026-03-29T11:00:00',
      },
    ];
    vi.mocked(api.listDeals).mockResolvedValueOnce(backendDeals);
    // The automatic retry that syncDealsFromBackend fires also fails, so the
    // deal remains local-only. This lets us assert the failed-flag stays set.
    vi.mocked(api.saveDeal).mockRejectedValueOnce(new Error('still offline'));

    await useDealAnalyzerStore.getState().syncDealsFromBackend();
    await flushPromises();

    const { savedDeals } = useDealAnalyzerStore.getState();
    // Both the backend deal AND the previously-unsynced local deal survive
    // — the destructive-replace bug that ate Neil Ave would have wiped the
    // local one.
    expect(savedDeals.map((d) => d.name)).toContain('Backend Deal');
    expect(savedDeals.map((d) => d.name)).toContain('Unsynced Local Deal');
  });

  it('maps backend fields correctly to SavedDeal shape', async () => {
    const backendDeal = {
      id: '22222222-2222-2222-2222-222222222222',
      name: 'Mapped Deal',
      acquisition: { purchasePrice: 500000 },
      operations: { grossRentMonthly: 2800 },
      proForma: { expenses: [] },
      refinance: { enabled: true, refiYear: 5 },
      results: { base: { irr: 0.13 } },
      mcRanges: { rent: { min: 2000, mode: 2500, max: 3000 } },
      mcResults: { p50: 0.09 },
      currentStep: 4,
      savedAt: '2026-03-29T09:00:00',
      updatedAt: '2026-03-29T10:00:00',
    };
    vi.mocked(api.listDeals).mockResolvedValueOnce([backendDeal]);

    await useDealAnalyzerStore.getState().syncDealsFromBackend();

    const deal = useDealAnalyzerStore.getState().savedDeals[0];
    expect(deal.mcRanges).toEqual(backendDeal.mcRanges);
    expect(deal.mcResults).toEqual(backendDeal.mcResults);
    expect(deal.currentStep).toBe(4);
    expect(deal.savedAt).toBe('2026-03-29T09:00:00');
  });

  it('sets null mcRanges/mcResults to undefined', async () => {
    vi.mocked(api.listDeals).mockResolvedValueOnce([{
      id: '33333333-3333-3333-3333-333333333333',
      name: 'No MC',
      acquisition: {}, operations: {}, proForma: {}, refinance: {},
      results: {}, mcRanges: null, mcResults: null,
      currentStep: null, savedAt: '2026-01-01T00:00:00', updatedAt: '2026-01-01T00:00:00',
    }]);

    await useDealAnalyzerStore.getState().syncDealsFromBackend();

    const deal = useDealAnalyzerStore.getState().savedDeals[0];
    expect(deal.mcRanges).toBeUndefined();
    expect(deal.mcResults).toBeUndefined();
    expect(deal.currentStep).toBeUndefined();
  });

  it('preserves local state when api.listDeals fails', async () => {
    const { saveDeal } = useDealAnalyzerStore.getState();
    saveDeal('Local Deal', makeDraft(), SAMPLE_RESULTS);
    await flushPromises();

    vi.mocked(api.listDeals).mockRejectedValueOnce(new Error('503 Service Unavailable'));

    await useDealAnalyzerStore.getState().syncDealsFromBackend();

    // Local deal untouched
    expect(useDealAnalyzerStore.getState().savedDeals).toHaveLength(1);
    expect(useDealAnalyzerStore.getState().savedDeals[0].name).toBe('Local Deal');
  });

  it('preserves local-only deals and auto-retries when server returns empty', async () => {
    // First save succeeds (deal is on server). Second save fails (local-only).
    const { saveDeal } = useDealAnalyzerStore.getState();
    saveDeal('Synced Deal', makeDraft(), SAMPLE_RESULTS);
    await flushPromises();
    vi.mocked(api.saveDeal).mockRejectedValueOnce(new Error('network'));
    const orphanId = saveDeal('Orphan', makeDraft(), SAMPLE_RESULTS);
    await flushPromises();

    // Server only knows about the first deal.
    vi.mocked(api.listDeals).mockResolvedValueOnce([]);
    // Retry for the orphan will succeed this time.
    vi.mocked(api.saveDeal).mockResolvedValueOnce({});
    await useDealAnalyzerStore.getState().syncDealsFromBackend();
    await flushPromises();

    // Both deals preserved locally — the buggy destructive-replace would
    // have wiped Orphan (this is the Neil Ave failure mode).
    const names = useDealAnalyzerStore.getState().savedDeals.map((d) => d.name);
    expect(names).toContain('Orphan');
    // After successful retry, the orphan is no longer flagged as failed.
    expect(useDealAnalyzerStore.getState().syncState.failedDealIds).not.toContain(orphanId);
  });
});

// ── Sync state tracking (pendingCount, lastError, failedDealIds) ──────────────

describe('syncState tracking', () => {
  it('marks a deal as failed when its save rejects', async () => {
    vi.mocked(api.saveDeal).mockRejectedValueOnce(new Error('boom'));
    const { saveDeal } = useDealAnalyzerStore.getState();
    const id = saveDeal('Doomed', makeDraft(), SAMPLE_RESULTS);
    await flushPromises();

    const { syncState } = useDealAnalyzerStore.getState();
    expect(syncState.failedDealIds).toContain(id);
    expect(syncState.lastError).toBe('boom');
    expect(syncState.pendingCount).toBe(0);
  });

  it('clears the failed-id flag when a subsequent update succeeds', async () => {
    vi.mocked(api.saveDeal).mockRejectedValueOnce(new Error('offline'));
    const { saveDeal, updateSavedDeal } = useDealAnalyzerStore.getState();
    const id = saveDeal('First fail', makeDraft(), SAMPLE_RESULTS);
    await flushPromises();
    expect(useDealAnalyzerStore.getState().syncState.failedDealIds).toContain(id);

    // Subsequent update succeeds — id is cleared from failed set.
    updateSavedDeal(id, 'Now good', SAMPLE_RESULTS);
    await flushPromises();

    expect(useDealAnalyzerStore.getState().syncState.failedDealIds).not.toContain(id);
    expect(useDealAnalyzerStore.getState().syncState.lastError).toBeNull();
  });

  it('increments pendingCount while a save is in flight', async () => {
    let resolveApi: (() => void) | null = null;
    vi.mocked(api.saveDeal).mockImplementationOnce(
      () => new Promise((resolve) => { resolveApi = () => resolve({}); })
    );
    const { saveDeal } = useDealAnalyzerStore.getState();
    saveDeal('Slow save', makeDraft(), SAMPLE_RESULTS);

    // Before resolving, pendingCount should be 1
    expect(useDealAnalyzerStore.getState().syncState.pendingCount).toBe(1);

    resolveApi!();
    await flushPromises();
    expect(useDealAnalyzerStore.getState().syncState.pendingCount).toBe(0);
  });

  it('records lastSuccessAt on successful save', async () => {
    const before = useDealAnalyzerStore.getState().syncState.lastSuccessAt;
    const { saveDeal } = useDealAnalyzerStore.getState();
    saveDeal('Yay', makeDraft(), SAMPLE_RESULTS);
    await flushPromises();

    const after = useDealAnalyzerStore.getState().syncState.lastSuccessAt;
    expect(after).not.toBe(before);
    expect(after).not.toBeNull();
  });

  it('rolls back local delete when api.deleteDeal fails', async () => {
    const { saveDeal, deleteSavedDeal } = useDealAnalyzerStore.getState();
    const id = saveDeal('Keeper', makeDraft(), SAMPLE_RESULTS);
    await flushPromises();
    expect(useDealAnalyzerStore.getState().savedDeals).toHaveLength(1);

    vi.mocked(api.deleteDeal).mockRejectedValueOnce(new Error('server down'));
    deleteSavedDeal(id);
    // Optimistic remove
    expect(useDealAnalyzerStore.getState().savedDeals).toHaveLength(0);

    await flushPromises();
    // Rolled back after failure — the deal reappears
    expect(useDealAnalyzerStore.getState().savedDeals.find((d) => d.id === id)).toBeDefined();
  });
});

describe('retrySave', () => {
  it('re-attempts a failed save and clears the failed flag on success', async () => {
    vi.mocked(api.saveDeal).mockRejectedValueOnce(new Error('first fail'));
    const { saveDeal, retrySave } = useDealAnalyzerStore.getState();
    const id = saveDeal('Retry me', makeDraft(), SAMPLE_RESULTS);
    await flushPromises();
    expect(useDealAnalyzerStore.getState().syncState.failedDealIds).toContain(id);

    vi.mocked(api.saveDeal).mockResolvedValueOnce({});
    await retrySave(id);
    await flushPromises();

    expect(useDealAnalyzerStore.getState().syncState.failedDealIds).not.toContain(id);
  });

  it('falls back to PUT when POST rejects (deal already exists on server)', async () => {
    // Set up a scenario where POST fails but PUT succeeds
    vi.mocked(api.saveDeal).mockRejectedValueOnce(new Error('initial fail'));
    const { saveDeal, retrySave } = useDealAnalyzerStore.getState();
    const id = saveDeal('Exists on server', makeDraft(), SAMPLE_RESULTS);
    await flushPromises();

    vi.mocked(api.saveDeal).mockRejectedValueOnce(new Error('409 conflict'));
    vi.mocked(api.updateDeal).mockResolvedValueOnce({});
    await retrySave(id);
    await flushPromises();

    expect(api.updateDeal).toHaveBeenCalled();
    expect(useDealAnalyzerStore.getState().syncState.failedDealIds).not.toContain(id);
  });
});
