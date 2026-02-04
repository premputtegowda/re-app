'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { toast } from 'sonner';
import type { HoursEntry, Category, Property, HoursFilter } from '@/types';
import { toTotalMinutes } from '@/utils/calculations';
import { getCurrentTimestamp } from '@/utils/dateUtils';

// Default categories
const DEFAULT_CATEGORIES: Category[] = [
  { id: 'cat-1', name: 'Property Management', color: '#3B82F6', createdAt: getCurrentTimestamp() },
  { id: 'cat-2', name: 'Maintenance & Repairs', color: '#10B981', createdAt: getCurrentTimestamp() },
  { id: 'cat-3', name: 'Tenant Relations', color: '#F59E0B', createdAt: getCurrentTimestamp() },
  { id: 'cat-4', name: 'Financial Records', color: '#8B5CF6', createdAt: getCurrentTimestamp() },
  { id: 'cat-5', name: 'Property Inspections', color: '#EC4899', createdAt: getCurrentTimestamp() },
];

// Default properties
const DEFAULT_PROPERTIES: Property[] = [
  { id: 'prop-1', name: 'Property 1', address: '123 Main St', createdAt: getCurrentTimestamp() },
];

// Generate unique ID
const generateId = (prefix: string) =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

// Store interface
interface AppStore {
  // State
  entries: HoursEntry[];
  categories: Category[];
  properties: Property[];
  filter: HoursFilter;
  isLoading: boolean;
  error: string | null;

  // Entry actions
  addEntry: (entry: Omit<HoursEntry, 'id' | 'totalMinutes' | 'createdAt' | 'updatedAt'>) => void;
  updateEntry: (entry: HoursEntry) => void;
  deleteEntry: (id: string) => void;

  // Category actions
  addCategory: (category: Omit<Category, 'id' | 'createdAt'>) => void;
  updateCategory: (category: Category) => void;
  deleteCategory: (id: string) => void;

  // Property actions
  addProperty: (property: Omit<Property, 'id' | 'createdAt'>) => void;
  updateProperty: (property: Property) => void;
  deleteProperty: (id: string) => void;

  // Filter actions
  setFilter: (filter: HoursFilter) => void;
  clearFilter: () => void;

  // Loading/Error actions
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
}

export const useStore = create<AppStore>()(
  persist(
    (set, get) => ({
      // Initial state
      entries: [],
      categories: DEFAULT_CATEGORIES,
      properties: DEFAULT_PROPERTIES,
      filter: {},
      isLoading: false,
      error: null,

      // Entry actions
      addEntry: (entry) => {
        try {
          const newEntry: HoursEntry = {
            ...entry,
            id: generateId('entry'),
            totalMinutes: toTotalMinutes(entry.hours, entry.minutes),
            createdAt: getCurrentTimestamp(),
            updatedAt: getCurrentTimestamp(),
          };
          set((state) => ({ entries: [...state.entries, newEntry] }));
          toast.success('Hours entry added successfully');
        } catch (error) {
          console.error('Error adding entry:', error);
          toast.error('Failed to add entry');
        }
      },

      updateEntry: (entry) => {
        const updatedEntry: HoursEntry = {
          ...entry,
          totalMinutes: toTotalMinutes(entry.hours, entry.minutes),
          updatedAt: getCurrentTimestamp(),
        };
        set((state) => ({
          entries: state.entries.map((e) => (e.id === entry.id ? updatedEntry : e)),
        }));
        toast.success('Hours entry updated successfully');
      },

      deleteEntry: (id) => {
        set((state) => ({
          entries: state.entries.filter((e) => e.id !== id),
        }));
        toast.info('Hours entry deleted');
      },

      // Category actions
      addCategory: (category) => {
        const newCategory: Category = {
          ...category,
          id: generateId('cat'),
          createdAt: getCurrentTimestamp(),
        };
        set((state) => ({ categories: [...state.categories, newCategory] }));
        toast.success('Category added successfully');
      },

      updateCategory: (category) => {
        set((state) => ({
          categories: state.categories.map((c) => (c.id === category.id ? category : c)),
        }));
        toast.success('Category updated successfully');
      },

      deleteCategory: (id) => {
        set((state) => ({
          categories: state.categories.filter((c) => c.id !== id),
        }));
        toast.info('Category deleted');
      },

      // Property actions
      addProperty: (property) => {
        const newProperty: Property = {
          ...property,
          id: generateId('prop'),
          createdAt: getCurrentTimestamp(),
        };
        set((state) => ({ properties: [...state.properties, newProperty] }));
        toast.success('Property added successfully');
      },

      updateProperty: (property) => {
        set((state) => ({
          properties: state.properties.map((p) => (p.id === property.id ? property : p)),
        }));
        toast.success('Property updated successfully');
      },

      deleteProperty: (id) => {
        set((state) => ({
          properties: state.properties.filter((p) => p.id !== id),
        }));
        toast.info('Property deleted');
      },

      // Filter actions
      setFilter: (filter) => {
        set({ filter });
      },

      clearFilter: () => {
        set({ filter: {} });
      },

      // Loading/Error actions
      setLoading: (isLoading) => {
        set({ isLoading });
      },

      setError: (error) => {
        set({ error });
      },
    }),
    {
      name: 'reps-storage',
      // Only persist these fields
      partialize: (state) => ({
        entries: state.entries,
        categories: state.categories,
        properties: state.properties,
      }),
    }
  )
);
