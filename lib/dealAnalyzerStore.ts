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

interface CoCStore {
  scenarios: CoCScenario[];
  activeScenarioId: string | null;
  draft: DealAnalyzerDraft | null;
  savedDeals: SavedDeal[];

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
  /** Fetch all deals from backend and replace local store. Called on login. */
  syncDealsFromBackend: () => Promise<void>;
}

export const useDealAnalyzerStore = create<CoCStore>()(
  persist(
    (set, get) => ({
      scenarios: [],
      activeScenarioId: null,
      draft: null,
      savedDeals: [],

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
        // Optimistic local update
        set((state) => ({ savedDeals: [deal, ...state.savedDeals] }));
        // Async backend sync — fire and forget
        api.saveDeal({
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
        }).catch((err) => console.error('[DealStore] Failed to sync new deal to backend:', err));
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
        // Async backend sync — fire and forget
        const deal = get().savedDeals.find((d) => d.id === id);
        if (deal) {
          api.updateDeal(id, {
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
          }).catch((err) => console.error('[DealStore] Failed to sync deal update to backend:', err));
        }
      },

      deleteSavedDeal: (id) => {
        set((state) => ({ savedDeals: state.savedDeals.filter((d) => d.id !== id) }));
        api.deleteDeal(id).catch((err) =>
          console.error('[DealStore] Failed to delete deal from backend:', err)
        );
      },

      updateCurrentStep: (id, step) => {
        const updatedAt = now();
        set((state) => ({
          savedDeals: state.savedDeals.map((d) =>
            d.id === id ? { ...d, currentStep: step, updatedAt } : d
          ),
        }));
        const deal = get().savedDeals.find((d) => d.id === id);
        if (deal) {
          api.updateDeal(id, {
            name: deal.name,
            acquisition: deal.acquisition,
            operations: deal.operations,
            proForma: deal.proForma,
            refinance: deal.refinance,
            results: deal.results,
            mcRanges: deal.mcRanges,
            mcRangesReviewedAt: deal.mcRangesReviewedAt ?? null,
            mcResults: deal.mcResults,
            currentStep: step,
            updatedAt,
          }).catch((err) => console.error('[DealStore] Failed to sync step update to backend:', err));
        }
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
        if (deal) {
          api.updateDeal(id, {
            name: deal.name,
            acquisition: deal.acquisition,
            operations: deal.operations,
            proForma: deal.proForma,
            refinance: deal.refinance,
            results: deal.results,
            mcRanges: mcRanges !== undefined ? mcRanges : deal.mcRanges,
            mcRangesReviewedAt: mcRangesReviewedAt !== undefined ? mcRangesReviewedAt : deal.mcRangesReviewedAt,
            mcResults: mcResults !== undefined ? mcResults : deal.mcResults,
            currentStep: deal.currentStep,
            updatedAt,
          }).catch((err) => console.error('[DealStore] Failed to sync MC data to backend:', err));
        }
      },

      syncDealsFromBackend: async () => {
        try {
          const deals = await api.listDeals();
          // Replace local store with authoritative backend data
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const mapped: SavedDeal[] = deals.map((d: any) => ({
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
          set({ savedDeals: mapped });
        } catch (err) {
          // Non-fatal: local cache remains usable if backend is unreachable
          console.error('[DealStore] Failed to sync deals from backend:', err);
        }
      },
    }),
    {
      name: 'coc-storage',
    }
  )
);
