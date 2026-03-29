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

  it('does not block UI when api.deleteDeal rejects', async () => {
    vi.mocked(api.deleteDeal).mockRejectedValueOnce(new Error('gone'));
    const { saveDeal, deleteSavedDeal } = useDealAnalyzerStore.getState();
    const id = saveDeal('Deal', makeDraft(), SAMPLE_RESULTS);
    await flushPromises();

    deleteSavedDeal(id);
    await flushPromises();

    // Still removed locally
    expect(useDealAnalyzerStore.getState().savedDeals).toHaveLength(0);
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
  it('replaces local savedDeals with data from backend', async () => {
    // Seed a local deal that should be replaced
    const { saveDeal } = useDealAnalyzerStore.getState();
    saveDeal('Stale Local Deal', makeDraft(), SAMPLE_RESULTS);
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

    await useDealAnalyzerStore.getState().syncDealsFromBackend();

    const { savedDeals } = useDealAnalyzerStore.getState();
    expect(savedDeals).toHaveLength(1);
    expect(savedDeals[0].id).toBe('11111111-1111-1111-1111-111111111111');
    expect(savedDeals[0].name).toBe('Backend Deal');
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

  it('syncs an empty list when the user has no backend deals', async () => {
    const { saveDeal } = useDealAnalyzerStore.getState();
    saveDeal('Orphan', makeDraft(), SAMPLE_RESULTS);
    await flushPromises();

    vi.mocked(api.listDeals).mockResolvedValueOnce([]);
    await useDealAnalyzerStore.getState().syncDealsFromBackend();

    expect(useDealAnalyzerStore.getState().savedDeals).toHaveLength(0);
  });
});
