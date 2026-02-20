'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { CoCScenario } from '@/types';

const generateId = () =>
  `coc-${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 9)}`;

const now = () => new Date().toISOString();

interface CoCStore {
  scenarios: CoCScenario[];
  activeScenarioId: string | null;
  addScenario: (s: Omit<CoCScenario, 'id' | 'createdAt' | 'updatedAt'>) => string;
  updateScenario: (id: string, updates: Partial<CoCScenario>) => void;
  deleteScenario: (id: string) => void;
  setActiveScenario: (id: string | null) => void;
  duplicateScenario: (id: string) => string;
}

export const useCoCStore = create<CoCStore>()(
  persist(
    (set, get) => ({
      scenarios: [],
      activeScenarioId: null,

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
    }),
    {
      name: 'coc-storage',
    }
  )
);
