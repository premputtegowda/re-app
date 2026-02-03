'use client';

import { createContext, useContext, useReducer, useEffect, useState, ReactNode } from 'react';
import type { HoursEntry, Category, Property, HoursFilter, AppState, AppAction, Toast } from '@/types';
import { useLocalStorage } from '@/hooks/useLocalStorage';
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

// Initial state
const initialState: AppState = {
  entries: [],
  categories: DEFAULT_CATEGORIES,
  properties: DEFAULT_PROPERTIES,
  filter: {},
  isLoading: false,
  error: null,
};

// Reducer function
function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'ADD_ENTRY':
      return {
        ...state,
        entries: [...state.entries, action.payload],
      };

    case 'UPDATE_ENTRY':
      return {
        ...state,
        entries: state.entries.map((entry) =>
          entry.id === action.payload.id ? action.payload : entry
        ),
      };

    case 'DELETE_ENTRY':
      return {
        ...state,
        entries: state.entries.filter((entry) => entry.id !== action.payload),
      };

    case 'ADD_CATEGORY':
      return {
        ...state,
        categories: [...state.categories, action.payload],
      };

    case 'UPDATE_CATEGORY':
      return {
        ...state,
        categories: state.categories.map((cat) =>
          cat.id === action.payload.id ? action.payload : cat
        ),
      };

    case 'DELETE_CATEGORY':
      return {
        ...state,
        categories: state.categories.filter((cat) => cat.id !== action.payload),
      };

    case 'ADD_PROPERTY':
      return {
        ...state,
        properties: [...state.properties, action.payload],
      };

    case 'UPDATE_PROPERTY':
      return {
        ...state,
        properties: state.properties.map((prop) =>
          prop.id === action.payload.id ? action.payload : prop
        ),
      };

    case 'DELETE_PROPERTY':
      return {
        ...state,
        properties: state.properties.filter((prop) => prop.id !== action.payload),
      };

    case 'SET_FILTER':
      return {
        ...state,
        filter: action.payload,
      };

    case 'SET_LOADING':
      return {
        ...state,
        isLoading: action.payload,
      };

    case 'SET_ERROR':
      return {
        ...state,
        error: action.payload,
      };

    case 'LOAD_DATA':
      return {
        ...state,
        entries: action.payload.entries,
        categories: action.payload.categories.length > 0 ? action.payload.categories : DEFAULT_CATEGORIES,
        properties: action.payload.properties.length > 0 ? action.payload.properties : DEFAULT_PROPERTIES,
      };

    default:
      return state;
  }
}

// Context type
interface AppContextType {
  state: AppState;
  dispatch: React.Dispatch<AppAction>;
  addEntry: (entry: Omit<HoursEntry, 'id' | 'totalMinutes' | 'createdAt' | 'updatedAt'>) => void;
  updateEntry: (entry: HoursEntry) => void;
  deleteEntry: (id: string) => void;
  addCategory: (category: Omit<Category, 'id' | 'createdAt'>) => void;
  updateCategory: (category: Category) => void;
  deleteCategory: (id: string) => void;
  addProperty: (property: Omit<Property, 'id' | 'createdAt'>) => void;
  updateProperty: (property: Property) => void;
  deleteProperty: (id: string) => void;
  setFilter: (filter: HoursFilter) => void;
  clearFilter: () => void;
  toasts: Toast[];
  addToast: (message: string, type: Toast['type']) => void;
  removeToast: (id: string) => void;
}

// Create context
const AppContext = createContext<AppContextType | undefined>(undefined);

// Provider component
export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(appReducer, initialState);
  const [storedEntries, setStoredEntries] = useLocalStorage<HoursEntry[]>('reps-hours', []);
  const [storedCategories, setStoredCategories] = useLocalStorage<Category[]>('reps-categories', DEFAULT_CATEGORIES);
  const [storedProperties, setStoredProperties] = useLocalStorage<Property[]>('reps-properties', DEFAULT_PROPERTIES);
  const [toasts, setToasts] = useState<Toast[]>([]);

  // Load data from localStorage on mount
  useEffect(() => {
    dispatch({
      type: 'LOAD_DATA',
      payload: {
        entries: storedEntries,
        categories: storedCategories,
        properties: storedProperties,
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync entries to localStorage
  useEffect(() => {
    setStoredEntries(state.entries);
  }, [state.entries, setStoredEntries]);

  // Sync categories to localStorage
  useEffect(() => {
    setStoredCategories(state.categories);
  }, [state.categories, setStoredCategories]);

  // Sync properties to localStorage
  useEffect(() => {
    setStoredProperties(state.properties);
  }, [state.properties, setStoredProperties]);

  // Helper functions
  const addEntry = (entry: Omit<HoursEntry, 'id' | 'totalMinutes' | 'createdAt' | 'updatedAt'>) => {
    try {
      console.log('Adding entry:', entry);
      const newEntry: HoursEntry = {
        ...entry,
        id: `entry-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        totalMinutes: toTotalMinutes(entry.hours, entry.minutes),
        createdAt: getCurrentTimestamp(),
        updatedAt: getCurrentTimestamp(),
      };
      console.log('New entry created:', newEntry);
      dispatch({ type: 'ADD_ENTRY', payload: newEntry });
      addToast('Hours entry added successfully', 'success');
      console.log('Entry added successfully');
    } catch (error) {
      console.error('Error adding entry:', error);
      addToast('Failed to add entry', 'error');
    }
  };

  const updateEntry = (entry: HoursEntry) => {
    const updatedEntry: HoursEntry = {
      ...entry,
      totalMinutes: toTotalMinutes(entry.hours, entry.minutes),
      updatedAt: getCurrentTimestamp(),
    };
    dispatch({ type: 'UPDATE_ENTRY', payload: updatedEntry });
    addToast('Hours entry updated successfully', 'success');
  };

  const deleteEntry = (id: string) => {
    dispatch({ type: 'DELETE_ENTRY', payload: id });
    addToast('Hours entry deleted', 'info');
  };

  const addCategory = (category: Omit<Category, 'id' | 'createdAt'>) => {
    const newCategory: Category = {
      ...category,
      id: `cat-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      createdAt: getCurrentTimestamp(),
    };
    dispatch({ type: 'ADD_CATEGORY', payload: newCategory });
    addToast('Category added successfully', 'success');
  };

  const updateCategory = (category: Category) => {
    dispatch({ type: 'UPDATE_CATEGORY', payload: category });
    addToast('Category updated successfully', 'success');
  };

  const deleteCategory = (id: string) => {
    dispatch({ type: 'DELETE_CATEGORY', payload: id });
    addToast('Category deleted', 'info');
  };

  const addProperty = (property: Omit<Property, 'id' | 'createdAt'>) => {
    const newProperty: Property = {
      ...property,
      id: `prop-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      createdAt: getCurrentTimestamp(),
    };
    dispatch({ type: 'ADD_PROPERTY', payload: newProperty });
    addToast('Property added successfully', 'success');
  };

  const updateProperty = (property: Property) => {
    dispatch({ type: 'UPDATE_PROPERTY', payload: property });
    addToast('Property updated successfully', 'success');
  };

  const deleteProperty = (id: string) => {
    dispatch({ type: 'DELETE_PROPERTY', payload: id });
    addToast('Property deleted', 'info');
  };

  const setFilter = (filter: HoursFilter) => {
    dispatch({ type: 'SET_FILTER', payload: filter });
  };

  const clearFilter = () => {
    dispatch({ type: 'SET_FILTER', payload: {} });
  };

  const addToast = (message: string, type: Toast['type'] = 'info') => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const toast: Toast = { id, message, type, duration: 3000 };
    setToasts((prev) => [...prev, toast]);

    // Auto remove after duration
    setTimeout(() => {
      removeToast(id);
    }, toast.duration);
  };

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  const value: AppContextType = {
    state,
    dispatch,
    addEntry,
    updateEntry,
    deleteEntry,
    addCategory,
    updateCategory,
    deleteCategory,
    addProperty,
    updateProperty,
    deleteProperty,
    setFilter,
    clearFilter,
    toasts,
    addToast,
    removeToast,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

// Custom hook to use the context
export function useApp() {
  const context = useContext(AppContext);
  if (context === undefined) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
}
