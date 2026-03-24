'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { toast } from 'sonner';
import type { HoursEntry, Category, Property, HoursFilter } from '@/types';
import { toTotalMinutes } from '@/utils/calculations';
import { getCurrentTimestamp } from '@/utils/dateUtils';
import { api } from './api';

// Generate unique ID (fallback for offline mode)
const generateId = (prefix: string) =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

// Transform backend entry to frontend format
const transformEntry = (backendEntry: any): HoursEntry => ({
  id: backendEntry.id,
  date: backendEntry.date,
  hours: backendEntry.hours,
  minutes: backendEntry.minutes,
  totalMinutes: backendEntry.total_minutes,
  category: backendEntry.category_id,
  property: backendEntry.property_id,
  description: backendEntry.description,
  raw_description: backendEntry.raw_description ?? undefined,
  refined_description: backendEntry.refined_description ?? undefined,
  ai_category_id: backendEntry.ai_category_id ?? undefined,
  ai_type: backendEntry.ai_type ?? undefined,
  notes: backendEntry.notes ?? undefined,
  type: backendEntry.type === 'non-material' ? 'non-material' : 'material',
  attachments: backendEntry.attachments ?? [],
  createdAt: backendEntry.created_at,
  updatedAt: backendEntry.updated_at,
});

// Transform backend category to frontend format
const transformCategory = (backendCategory: any): Category => ({
  id: backendCategory.id,
  name: backendCategory.name,
  color: backendCategory.color,
  createdAt: backendCategory.created_at,
});

// Transform backend property to frontend format
const transformProperty = (backendProperty: any): Property => ({
  id: backendProperty.id,
  name: backendProperty.name,
  address: backendProperty.address,
  createdAt: backendProperty.created_at,
});

// Store interface
interface AppStore {
  // State
  entries: HoursEntry[];
  categories: Category[];
  properties: Property[];
  filter: HoursFilter;
  isLoading: boolean;
  error: string | null;
  isSynced: boolean;

  // Entry actions
  addEntry: (entry: Omit<HoursEntry, 'id' | 'totalMinutes' | 'createdAt' | 'updatedAt'>) => Promise<HoursEntry>;
  updateEntry: (entry: HoursEntry) => Promise<void>;
  deleteEntry: (id: string) => Promise<void>;
  patchEntryAttachments: (entryId: string, attachments: import('@/types').Attachment[]) => void;

  // Category actions
  addCategory: (category: Omit<Category, 'id' | 'createdAt'>) => Promise<void>;
  updateCategory: (category: Category) => Promise<void>;
  deleteCategory: (id: string) => Promise<void>;

  // Property actions
  addProperty: (property: Omit<Property, 'id' | 'createdAt'>) => Promise<void>;
  updateProperty: (property: Property) => Promise<void>;
  deleteProperty: (id: string) => Promise<void>;

  // Filter actions
  setFilter: (filter: HoursFilter) => void;
  clearFilter: () => void;

  // Loading/Error actions
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;

  // Sync actions
  syncFromBackend: () => Promise<void>;
  clearData: () => void;
}

export const useStore = create<AppStore>()(
  persist(
    (set, get) => ({
      // Initial state
      entries: [],
      categories: [],
      properties: [],
      filter: {},
      isLoading: false,
      error: null,
      isSynced: false,

      // Entry actions
      addEntry: async (entry) => {
        set({ isLoading: true });
        try {
          const response = await api.createEntry({
            date: entry.date,
            hours: entry.hours,
            minutes: entry.minutes,
            category_id: entry.category,
            property_id: entry.property,
            type: entry.type,
            description: entry.description,
            raw_description: entry.raw_description,
            refined_description: entry.refined_description,
            ai_category_id: entry.ai_category_id,
            ai_type: entry.ai_type,
            notes: entry.notes,
          });

          const newEntry = transformEntry(response);
          set((state) => ({
            entries: [...state.entries, newEntry],
            isLoading: false,
          }));
          toast.success('Hours entry added successfully');
          return newEntry;
        } catch (error) {
          set({ isLoading: false });
          const message = error instanceof Error ? error.message : 'Failed to add entry';
          toast.error(message);
          throw error;
        }
      },

      updateEntry: async (entry) => {
        set({ isLoading: true });
        try {
          const updateData = {
            date: entry.date,
            hours: entry.hours,
            minutes: entry.minutes,
            category_id: entry.category,
            property_id: entry.property,
            type: entry.type,
            description: entry.description,
            raw_description: entry.raw_description,
            refined_description: entry.refined_description,
            ai_category_id: entry.ai_category_id,
            ai_type: entry.ai_type,
            notes: entry.notes,
          };
          const response = await api.updateEntry(entry.id, updateData);

          const updatedEntry = transformEntry(response);
          set((state) => ({
            entries: state.entries.map((e) => (e.id === entry.id ? updatedEntry : e)),
            isLoading: false,
          }));
          toast.success('Hours entry updated successfully');
        } catch (error) {
          set({ isLoading: false });
          const message = error instanceof Error ? error.message : 'Failed to update entry';
          toast.error(message);
          throw error;
        }
      },

      deleteEntry: async (id) => {
        set({ isLoading: true });
        try {
          await api.deleteEntry(id);
          set((state) => ({
            entries: state.entries.filter((e) => e.id !== id),
            isLoading: false,
          }));
          toast.info('Hours entry deleted');
        } catch (error) {
          set({ isLoading: false });
          const message = error instanceof Error ? error.message : 'Failed to delete entry';
          toast.error(message);
          throw error;
        }
      },

      patchEntryAttachments: (entryId, attachments) => {
        set((state) => ({
          entries: state.entries.map((e) =>
            e.id === entryId ? { ...e, attachments } : e
          ),
        }));
      },

      // Category actions
      addCategory: async (category) => {
        set({ isLoading: true });
        try {
          const response = await api.createCategory({
            name: category.name,
            color: category.color,
          });

          const newCategory = transformCategory(response);
          set((state) => ({
            categories: [...state.categories, newCategory],
            isLoading: false,
          }));
          toast.success('Category added successfully');
        } catch (error) {
          set({ isLoading: false });
          const message = error instanceof Error ? error.message : 'Failed to add category';
          toast.error(message);
          throw error;
        }
      },

      updateCategory: async (category) => {
        set({ isLoading: true });
        try {
          const response = await api.updateCategory(category.id, {
            name: category.name,
            color: category.color,
          });

          const updatedCategory = transformCategory(response);
          set((state) => ({
            categories: state.categories.map((c) => (c.id === category.id ? updatedCategory : c)),
            isLoading: false,
          }));
          toast.success('Category updated successfully');
        } catch (error) {
          set({ isLoading: false });
          const message = error instanceof Error ? error.message : 'Failed to update category';
          toast.error(message);
          throw error;
        }
      },

      deleteCategory: async (id) => {
        set({ isLoading: true });
        try {
          await api.deleteCategory(id);
          set((state) => ({
            categories: state.categories.filter((c) => c.id !== id),
            isLoading: false,
          }));
          toast.info('Category deleted');
        } catch (error) {
          set({ isLoading: false });
          const message = error instanceof Error ? error.message : 'Failed to delete category';
          toast.error(message);
          throw error;
        }
      },

      // Property actions
      addProperty: async (property) => {
        set({ isLoading: true });
        try {
          const response = await api.createProperty({
            name: property.name,
            address: property.address,
          });

          const newProperty = transformProperty(response);
          set((state) => ({
            properties: [...state.properties, newProperty],
            isLoading: false,
          }));
          toast.success('Property added successfully');
        } catch (error) {
          set({ isLoading: false });
          const message = error instanceof Error ? error.message : 'Failed to add property';
          toast.error(message);
          throw error;
        }
      },

      updateProperty: async (property) => {
        set({ isLoading: true });
        try {
          const response = await api.updateProperty(property.id, {
            name: property.name,
            address: property.address,
          });

          const updatedProperty = transformProperty(response);
          set((state) => ({
            properties: state.properties.map((p) => (p.id === property.id ? updatedProperty : p)),
            isLoading: false,
          }));
          toast.success('Property updated successfully');
        } catch (error) {
          set({ isLoading: false });
          const message = error instanceof Error ? error.message : 'Failed to update property';
          toast.error(message);
          throw error;
        }
      },

      deleteProperty: async (id) => {
        set({ isLoading: true });
        try {
          await api.deleteProperty(id);
          set((state) => ({
            properties: state.properties.filter((p) => p.id !== id),
            isLoading: false,
          }));
          toast.info('Property deleted');
        } catch (error) {
          set({ isLoading: false });
          const message = error instanceof Error ? error.message : 'Failed to delete property';
          toast.error(message);
          throw error;
        }
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

      // Sync from backend
      syncFromBackend: async () => {
        set({ isLoading: true, error: null });
        try {
          const [categoriesRes, propertiesRes, entriesRes] = await Promise.all([
            api.getCategories(),
            api.getProperties(),
            api.getEntries(),
          ]);

          set({
            categories: categoriesRes.map(transformCategory),
            properties: propertiesRes.map(transformProperty),
            entries: entriesRes.map(transformEntry),
            isLoading: false,
            isSynced: true,
          });
        } catch (error) {
          set({
            isLoading: false,
            error: error instanceof Error ? error.message : 'Failed to sync data',
          });
          throw error;
        }
      },

      // Clear all data (on logout)
      clearData: () => {
        set({
          entries: [],
          categories: [],
          properties: [],
          filter: {},
          isLoading: false,
          error: null,
          isSynced: false,
        });
      },
    }),
    {
      name: 'reps-storage',
      // Only persist these fields
      partialize: (state) => ({
        entries: state.entries,
        categories: state.categories,
        properties: state.properties,
        isSynced: state.isSynced,
      }),
    }
  )
);
