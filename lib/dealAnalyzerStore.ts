'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { api } from '@/lib/api';
import type { CoCScenario, CoCResult, CoCAcquisition, CoCOperations, CoCRefinance, CoCScenarioType, ProFormaData, SavedDeal, CalcPersistedState } from '@/types';

// Use crypto.randomUUID() for stable UUIDs that work as backend keys
const generateId = () => crypto.randomUUID();

const now = () => new Date().toISOString();

export interface DealAnalyzerDraft {
  acquisition: CoCAcquisition;
  operations: CoCOperations;
  proForma: ProFormaData;
  refinance: CoCRefinance;
  currentStep: number;
  visitedSteps: number[];
  activeType: CoCScenarioType;
  calcState?: CalcPersistedState;
  stepNotes?: Record<number, string>;
}

// Session-scoped sync tracking. Not persisted — resets on reload. If a save
// failed in a prior session, the failure is re-detected on the next
// syncDealsFromBackend by comparing local savedDeals against the server.
export interface DealSyncState {
  /** Number of in-flight backend requests. > 0 means UI should show "Saving…". */
  pendingCount: number;
  /** Human-readable error message from the most recent failed op, or null. */
  lastError: string | null;
  /** ISO timestamp of the most recent successful save/update/delete. */
  lastSuccessAt: string | null;
  /** IDs of deals whose last save/update did not confirm on the backend. */
  failedDealIds: string[];
}

const INITIAL_SYNC_STATE: DealSyncState = {
  pendingCount: 0,
  lastError: null,
  lastSuccessAt: null,
  failedDealIds: [],
};

interface CoCStore {
  scenarios: CoCScenario[];
  activeScenarioId: string | null;
  draft: DealAnalyzerDraft | null;
  savedDeals: SavedDeal[];
  syncState: DealSyncState;

  addScenario: (s: Omit<CoCScenario, 'id' | 'createdAt' | 'updatedAt'>) => string;
  updateScenario: (id: string, updates: Partial<CoCScenario>) => void;
  deleteScenario: (id: string) => void;
  setActiveScenario: (id: string | null) => void;
  duplicateScenario: (id: string) => string;
  saveDraft: (draft: DealAnalyzerDraft) => void;
  clearDraft: () => void;
  saveDeal: (name: string, draft: DealAnalyzerDraft, results: Partial<Record<CoCScenarioType, CoCResult>>, mcRanges?: SavedDeal['mcRanges'], mcResults?: SavedDeal['mcResults'], mcRangesReviewedAt?: string | null) => string;
  updateSavedDeal: (id: string, name: string, results: Partial<Record<CoCScenarioType, CoCResult>>, draft?: DealAnalyzerDraft, mcRanges?: SavedDeal['mcRanges'], mcResults?: SavedDeal['mcResults'], mcRangesReviewedAt?: string | null) => void;
  deleteSavedDeal: (id: string) => void;
  updateMCData: (id: string, mcRanges?: SavedDeal['mcRanges'], mcResults?: SavedDeal['mcResults'], mcRangesReviewedAt?: string | null) => void;
  updateCurrentStep: (id: string, step: number) => void;
  /**
   * Fetch deals from backend and MERGE (non-destructive) with local. Any local
   * deal not present on the server is treated as an unsynced save and marked
   * as failed so it can be retried, rather than being silently deleted.
   */
  syncDealsFromBackend: () => Promise<void>;
  /** Retry the last save for a specific deal. */
  retrySave: (dealId: string) => Promise<void>;
  /** Clear the global lastError (e.g., after user acknowledges an error toast). */
  clearSyncError: () => void;
}

export const useDealAnalyzerStore = create<CoCStore>()(
  persist(
    (set, get) => {
      // ── Sync-tracking helpers ───────────────────────────────────────────
      // Wraps an API call so that pendingCount, lastError, lastSuccessAt,
      // and failedDealIds stay in sync automatically. If dealId is provided,
      // that id is added to failedDealIds on failure / removed on success.
      const trackSync = async <T,>(dealId: string | null, apiCall: () => Promise<T>): Promise<T> => {
        set((s) => ({
          syncState: { ...s.syncState, pendingCount: s.syncState.pendingCount + 1 },
        }));
        try {
          const result = await apiCall();
          set((s) => ({
            syncState: {
              pendingCount: Math.max(0, s.syncState.pendingCount - 1),
              lastError: null,
              lastSuccessAt: now(),
              failedDealIds: dealId
                ? s.syncState.failedDealIds.filter((id) => id !== dealId)
                : s.syncState.failedDealIds,
            },
          }));
          return result;
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          console.error('[DealStore] Sync failure:', errMsg);
          set((s) => ({
            syncState: {
              pendingCount: Math.max(0, s.syncState.pendingCount - 1),
              lastError: errMsg,
              lastSuccessAt: s.syncState.lastSuccessAt,
              failedDealIds: dealId && !s.syncState.failedDealIds.includes(dealId)
                ? [...s.syncState.failedDealIds, dealId]
                : s.syncState.failedDealIds,
            },
          }));
          throw err;
        }
      };

      // Build an updateDeal payload from a stored deal + optional overrides.
      // Used by retrySave and updateCurrentStep / updateMCData paths where we
      // need to PUT the full deal state from what we have in local.
      const buildUpdatePayload = (deal: SavedDeal, overrides?: Partial<SavedDeal>) => {
        const merged = { ...deal, ...(overrides ?? {}) };
        return {
          name: merged.name,
          acquisition: merged.acquisition,
          operations: merged.operations,
          proForma: merged.proForma,
          refinance: merged.refinance,
          results: merged.results,
          mcRanges: merged.mcRanges,
          mcRangesReviewedAt: merged.mcRangesReviewedAt ?? null,
          mcResults: merged.mcResults,
          currentStep: merged.currentStep,
          calcState: merged.calcState,
          updatedAt: merged.updatedAt,
        };
      };

      return {
        scenarios: [],
        activeScenarioId: null,
        draft: null,
        savedDeals: [],
        syncState: INITIAL_SYNC_STATE,

        addScenario: (s) => {
          const id = generateId();
          const scenario: CoCScenario = {
            ...s,
            id,
            createdAt: now(),
            updatedAt: now(),
          };
          set((state) => ({ scenarios: [...state.scenarios, scenario] }));
          return id;
        },

        updateScenario: (id, updates) => {
          set((state) => ({
            scenarios: state.scenarios.map((s) =>
              s.id === id ? { ...s, ...updates, updatedAt: now() } : s
            ),
          }));
        },

        deleteScenario: (id) => {
          set((state) => ({
            scenarios: state.scenarios.filter((s) => s.id !== id),
            activeScenarioId: state.activeScenarioId === id ? null : state.activeScenarioId,
          }));
        },

        setActiveScenario: (id) => {
          set({ activeScenarioId: id });
        },

        duplicateScenario: (id) => {
          const source = get().scenarios.find((s) => s.id === id);
          if (!source) return '';
          const newId = generateId();
          const duplicate: CoCScenario = {
            ...source,
            id: newId,
            name: `${source.name} (Copy)`,
            createdAt: now(),
            updatedAt: now(),
          };
          set((state) => ({ scenarios: [...state.scenarios, duplicate] }));
          return newId;
        },

        saveDraft: (draft) => set({ draft }),
        clearDraft: () => set({ draft: null }),

        saveDeal: (name, draft, results, mcRanges?, mcResults?, mcRangesReviewedAt?) => {
          const id = generateId();
          const savedAt = now();
          const deal: SavedDeal = {
            id,
            name,
            acquisition: draft.acquisition,
            operations: draft.operations,
            proForma: draft.proForma,
            refinance: draft.refinance,
            results,
            ...(mcRanges ? { mcRanges } : {}),
            ...(mcRangesReviewedAt !== undefined ? { mcRangesReviewedAt } : {}),
            ...(mcResults !== undefined ? { mcResults } : {}),
            ...(draft.calcState ? { calcState: draft.calcState } : {}),
            ...(draft.stepNotes && Object.keys(draft.stepNotes).length > 0 ? { stepNotes: draft.stepNotes } : {}),
            savedAt,
            updatedAt: savedAt,
          };
          // Optimistic local update — id returned synchronously so callers can
          // immediately reference the new deal.
          set((state) => ({ savedDeals: [deal, ...state.savedDeals] }));
          // Backend sync with tracked pending/error state. If this rejects,
          // the deal is marked as failed (in syncState.failedDealIds) so the
          // UI can prompt the user, and syncDealsFromBackend won't wipe it.
          trackSync(id, () => api.saveDeal({
            id,
            name,
            acquisition: draft.acquisition,
            operations: draft.operations,
            proForma: draft.proForma,
            refinance: draft.refinance,
            results,
            mcRanges,
            mcRangesReviewedAt: mcRangesReviewedAt ?? null,
            mcResults,
            calcState: draft.calcState,
            stepNotes: draft.stepNotes,
            savedAt,
            updatedAt: savedAt,
          })).catch(() => { /* error already recorded in syncState */ });
          return id;
        },

        updateSavedDeal: (id, name, results, draft?, mcRanges?, mcResults?, mcRangesReviewedAt?) => {
          const updatedAt = now();
          set((state) => ({
            savedDeals: state.savedDeals.map((d) =>
              d.id === id ? {
                ...d,
                name,
                results,
                ...(draft ? {
                  acquisition: draft.acquisition,
                  operations: draft.operations,
                  proForma: draft.proForma,
                  refinance: draft.refinance,
                  ...(draft.calcState !== undefined ? { calcState: draft.calcState } : {}),
                  ...(draft.stepNotes !== undefined ? { stepNotes: draft.stepNotes } : {}),
                } : {}),
                ...(mcRanges !== undefined ? { mcRanges } : {}),
                ...(mcRangesReviewedAt !== undefined ? { mcRangesReviewedAt } : {}),
                ...(mcResults !== undefined ? { mcResults } : {}),
                updatedAt,
              } : d
            ),
          }));
          const deal = get().savedDeals.find((d) => d.id === id);
          if (!deal) return;
          trackSync(id, () => api.updateDeal(id, {
            name,
            acquisition: draft?.acquisition ?? deal.acquisition,
            operations: draft?.operations ?? deal.operations,
            proForma: draft?.proForma ?? deal.proForma,
            refinance: draft?.refinance ?? deal.refinance,
            results,
            mcRanges: mcRanges !== undefined ? mcRanges : deal.mcRanges,
            mcRangesReviewedAt: mcRangesReviewedAt !== undefined ? mcRangesReviewedAt : deal.mcRangesReviewedAt,
            mcResults: mcResults !== undefined ? mcResults : deal.mcResults,
            currentStep: deal.currentStep,
            calcState: draft?.calcState ?? deal.calcState,
            updatedAt,
          })).catch(() => { /* error already recorded */ });
        },

        deleteSavedDeal: (id) => {
          // Snapshot for potential rollback on failure.
          const removed = get().savedDeals.find((d) => d.id === id);
          set((state) => ({ savedDeals: state.savedDeals.filter((d) => d.id !== id) }));
          trackSync(id, () => api.deleteDeal(id)).catch(() => {
            // Delete failed — restore the deal locally so the user isn't
            // left with a UI that shows deletion succeeded when it didn't.
            if (removed) {
              set((state) => ({
                savedDeals: state.savedDeals.some((d) => d.id === id)
                  ? state.savedDeals
                  : [removed, ...state.savedDeals],
              }));
            }
          });
        },

        updateCurrentStep: (id, step) => {
          const updatedAt = now();
          set((state) => ({
            savedDeals: state.savedDeals.map((d) =>
              d.id === id ? { ...d, currentStep: step, updatedAt } : d
            ),
          }));
          const deal = get().savedDeals.find((d) => d.id === id);
          if (!deal) return;
          trackSync(id, () => api.updateDeal(id, buildUpdatePayload(deal, { currentStep: step, updatedAt }))).catch(() => { /* error already recorded */ });
        },

        updateMCData: (id, mcRanges?, mcResults?, mcRangesReviewedAt?) => {
          const updatedAt = now();
          set((state) => ({
            savedDeals: state.savedDeals.map((d) =>
              d.id === id ? {
                ...d,
                ...(mcRanges !== undefined ? { mcRanges } : {}),
                ...(mcResults !== undefined ? { mcResults } : {}),
                ...(mcRangesReviewedAt !== undefined ? { mcRangesReviewedAt } : {}),
                updatedAt,
              } : d
            ),
          }));
          const deal = get().savedDeals.find((d) => d.id === id);
          if (!deal) return;
          trackSync(id, () => api.updateDeal(id, buildUpdatePayload(deal, {
            mcRanges: mcRanges !== undefined ? mcRanges : deal.mcRanges,
            mcRangesReviewedAt: mcRangesReviewedAt !== undefined ? mcRangesReviewedAt : deal.mcRangesReviewedAt,
            mcResults: mcResults !== undefined ? mcResults : deal.mcResults,
            updatedAt,
          }))).catch(() => { /* error already recorded */ });
        },

        syncDealsFromBackend: async () => {
          try {
            const serverDeals = await api.listDeals();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const serverMapped: SavedDeal[] = serverDeals.map((d: any) => ({
              id: d.id,
              name: d.name,
              acquisition: d.acquisition,
              operations: d.operations,
              proForma: d.proForma,
              refinance: d.refinance,
              results: d.results,
              mcRanges: d.mcRanges ?? undefined,
              mcRangesReviewedAt: d.mcRangesReviewedAt ?? null,
              mcResults: d.mcResults ?? undefined,
              currentStep: d.currentStep ?? undefined,
              calcState: d.calcState ?? undefined,
              savedAt: d.savedAt,
              updatedAt: d.updatedAt,
            }));
            const serverIds = new Set(serverMapped.map((d) => d.id));
            const localDeals = get().savedDeals;
            // Merge: server is authoritative for deals it knows about, but
            // any local deal missing from the server is preserved (it never
            // synced) and marked as failed for retry.
            const localOnly = localDeals.filter((d) => !serverIds.has(d.id));
            const merged = [...serverMapped, ...localOnly];

            // Reconcile failedDealIds: keep only ids that are still local-only
            // (server-confirmed deals shouldn't be in the failed set).
            const localOnlyIds = new Set(localOnly.map((d) => d.id));
            set((s) => ({
              savedDeals: merged,
              syncState: {
                ...s.syncState,
                failedDealIds: Array.from(new Set([
                  ...s.syncState.failedDealIds.filter((id) => localOnlyIds.has(id)),
                  ...localOnly.map((d) => d.id),
                ])),
              },
            }));

            // Best-effort retry of local-only deals — they never made it to
            // the server originally. Ignore errors here; failure keeps them
            // in failedDealIds for the user to retry manually.
            for (const d of localOnly) {
              trackSync(d.id, () => api.saveDeal({
                id: d.id,
                name: d.name,
                acquisition: d.acquisition,
                operations: d.operations,
                proForma: d.proForma,
                refinance: d.refinance,
                results: d.results,
                mcRanges: d.mcRanges,
                mcRangesReviewedAt: d.mcRangesReviewedAt ?? null,
                mcResults: d.mcResults,
                calcState: d.calcState,
                stepNotes: d.stepNotes,
                savedAt: d.savedAt,
                updatedAt: d.updatedAt,
              })).catch(() => { /* stays in failedDealIds */ });
            }
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            console.error('[DealStore] Failed to sync deals from backend:', errMsg);
            set((s) => ({
              syncState: { ...s.syncState, lastError: errMsg },
            }));
          }
        },

        retrySave: async (dealId: string) => {
          const deal = get().savedDeals.find((d) => d.id === dealId);
          if (!deal) return;
          // Try POST first (in case the deal was never on server); if that
          // fails with a conflict, fall back to PUT. Simpler heuristic: if
          // deal id is in failedDealIds and we don't know why, try POST.
          try {
            await trackSync(dealId, () => api.saveDeal({
              id: deal.id,
              name: deal.name,
              acquisition: deal.acquisition,
              operations: deal.operations,
              proForma: deal.proForma,
              refinance: deal.refinance,
              results: deal.results,
              mcRanges: deal.mcRanges,
              mcRangesReviewedAt: deal.mcRangesReviewedAt ?? null,
              mcResults: deal.mcResults,
              calcState: deal.calcState,
              stepNotes: deal.stepNotes,
              savedAt: deal.savedAt,
              updatedAt: deal.updatedAt,
            }));
          } catch {
            // POST failed — assume the deal already exists on server (409 or
            // similar) and try PUT.
            await trackSync(dealId, () => api.updateDeal(deal.id, buildUpdatePayload(deal))).catch(() => { /* stays failed */ });
          }
        },

        clearSyncError: () => {
          set((s) => ({ syncState: { ...s.syncState, lastError: null } }));
        },
      };
    },
    {
      name: 'coc-storage',
      // syncState is session-scoped and derived on load; never persist it.
      // Persisted state shape must match rehydration expectations.
      partialize: (state) => ({
        scenarios: state.scenarios,
        activeScenarioId: state.activeScenarioId,
        draft: state.draft,
        savedDeals: state.savedDeals,
      }),
      // On rehydrate, ensure syncState is fresh.
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.syncState = { ...INITIAL_SYNC_STATE };
        }
      },
    }
  )
);
