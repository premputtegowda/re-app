'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { CoCScenario, CoCResult, CoCAcquisition, CoCOperations, CoCRefinance, CoCScenarioType, ProFormaData, SavedDeal } from '@/types';

const generateId = () =>
  `coc-${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 9)}`;

const now = () => new Date().toISOString();

export interface DealAnalyzerDraft {
  acquisition: CoCAcquisition;
  operations: CoCOperations;
  proForma: ProFormaData;
  refinance: CoCRefinance;
  currentStep: number;
  visitedSteps: number[];
  activeType: CoCScenarioType;
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
  saveDeal: (name: string, draft: DealAnalyzerDraft, results: Partial<Record<CoCScenarioType, CoCResult>>, mcRanges?: SavedDeal['mcRanges'], mcResults?: SavedDeal['mcResults']) => string;
  updateSavedDeal: (id: string, name: string, results: Partial<Record<CoCScenarioType, CoCResult>>, draft?: DealAnalyzerDraft, mcRanges?: SavedDeal['mcRanges'], mcResults?: SavedDeal['mcResults']) => void;
  deleteSavedDeal: (id: string) => void;
  updateMCData: (id: string, mcRanges?: SavedDeal['mcRanges'], mcResults?: SavedDeal['mcResults']) => void;
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

      saveDeal: (name, draft, results, mcRanges?, mcResults?) => {
        const id = generateId();
        const deal: SavedDeal = {
          id,
          name,
          acquisition: draft.acquisition,
          operations: draft.operations,
          proForma: draft.proForma,
          refinance: draft.refinance,
          results,
          ...(mcRanges ? { mcRanges } : {}),
          ...(mcResults !== undefined ? { mcResults } : {}),
          savedAt: now(),
          updatedAt: now(),
        };
        set((state) => ({ savedDeals: [deal, ...state.savedDeals] }));
        return id;
      },

      updateSavedDeal: (id, name, results, draft?, mcRanges?, mcResults?) => {
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
              } : {}),
              ...(mcRanges !== undefined ? { mcRanges } : {}),
              ...(mcResults !== undefined ? { mcResults } : {}),
              updatedAt: now(),
            } : d
          ),
        }));
      },

      deleteSavedDeal: (id) => {
        set((state) => ({ savedDeals: state.savedDeals.filter((d) => d.id !== id) }));
      },

      updateMCData: (id, mcRanges?, mcResults?) => {
        set((state) => ({
          savedDeals: state.savedDeals.map((d) =>
            d.id === id ? {
              ...d,
              ...(mcRanges !== undefined ? { mcRanges } : {}),
              ...(mcResults !== undefined ? { mcResults } : {}),
              updatedAt: now(),
            } : d
          ),
        }));
      },
    }),
    {
      name: 'coc-storage',
    }
  )
);
