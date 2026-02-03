import { useMemo } from 'react';
import type { HoursEntry, Category, Property, HoursFilter, SortConfig } from '../types';
import { isDateInRange } from '../utils/dateUtils';

/**
 * Custom hook for filtering and sorting hours data
 */
export function useFilteredHours(
  entries: HoursEntry[],
  filter: HoursFilter,
  sortConfig?: SortConfig
): HoursEntry[] {
  return useMemo(() => {
    let filtered = [...entries];

    // Filter by date range
    if (filter.dateFrom || filter.dateTo) {
      filtered = filtered.filter((entry) =>
        isDateInRange(entry.date, filter.dateFrom, filter.dateTo)
      );
    }

    // Filter by categories
    if (filter.categories && filter.categories.length > 0) {
      filtered = filtered.filter((entry) => filter.categories!.includes(entry.category));
    }

    // Filter by properties
    if (filter.properties && filter.properties.length > 0) {
      filtered = filtered.filter((entry) => filter.properties!.includes(entry.property));
    }

    // Filter by types
    if (filter.types && filter.types.length > 0) {
      filtered = filtered.filter((entry) => filter.types!.includes(entry.type));
    }

    // Filter by search query (searches in description)
    if (filter.searchQuery && filter.searchQuery.trim() !== '') {
      const query = filter.searchQuery.toLowerCase();
      filtered = filtered.filter((entry) =>
        entry.description.toLowerCase().includes(query)
      );
    }

    // Sort
    if (sortConfig) {
      filtered.sort((a, b) => {
        let aValue: any;
        let bValue: any;

        switch (sortConfig.field) {
          case 'date':
            aValue = new Date(a.date).getTime();
            bValue = new Date(b.date).getTime();
            break;
          case 'hours':
            aValue = a.totalMinutes;
            bValue = b.totalMinutes;
            break;
          case 'category':
            aValue = a.category;
            bValue = b.category;
            break;
          case 'property':
            aValue = a.property;
            bValue = b.property;
            break;
          case 'type':
            aValue = a.type;
            bValue = b.type;
            break;
          default:
            return 0;
        }

        if (aValue < bValue) {
          return sortConfig.order === 'asc' ? -1 : 1;
        }
        if (aValue > bValue) {
          return sortConfig.order === 'asc' ? 1 : -1;
        }
        return 0;
      });
    } else {
      // Default sort by date (newest first)
      filtered.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    }

    return filtered;
  }, [entries, filter, sortConfig]);
}

/**
 * Hook to get category by ID
 */
export function useCategory(categories: Category[], categoryId: string): Category | undefined {
  return useMemo(
    () => categories.find((c) => c.id === categoryId),
    [categories, categoryId]
  );
}

/**
 * Hook to get property by ID
 */
export function useProperty(properties: Property[], propertyId: string): Property | undefined {
  return useMemo(
    () => properties.find((p) => p.id === propertyId),
    [properties, propertyId]
  );
}

/**
 * Hook to check if category is in use
 */
export function useCategoryInUse(entries: HoursEntry[], categoryId: string): boolean {
  return useMemo(
    () => entries.some((e) => e.category === categoryId),
    [entries, categoryId]
  );
}

/**
 * Hook to check if property is in use
 */
export function usePropertyInUse(entries: HoursEntry[], propertyId: string): boolean {
  return useMemo(
    () => entries.some((e) => e.property === propertyId),
    [entries, propertyId]
  );
}

/**
 * Hook to get recent entries (last N entries)
 */
export function useRecentEntries(entries: HoursEntry[], limit: number = 5): HoursEntry[] {
  return useMemo(() => {
    return [...entries]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, limit);
  }, [entries, limit]);
}

/**
 * Hook to search entries
 */
export function useSearchEntries(
  entries: HoursEntry[],
  searchQuery: string,
  categories: Category[],
  properties: Property[]
): HoursEntry[] {
  return useMemo(() => {
    if (!searchQuery || searchQuery.trim() === '') {
      return entries;
    }

    const query = searchQuery.toLowerCase();

    // Create lookup maps
    const categoryMap = new Map(categories.map((c) => [c.id, c.name.toLowerCase()]));
    const propertyMap = new Map(properties.map((p) => [p.id, p.name.toLowerCase()]));

    return entries.filter((entry) => {
      const categoryName = categoryMap.get(entry.category) || '';
      const propertyName = propertyMap.get(entry.property) || '';

      return (
        entry.description.toLowerCase().includes(query) ||
        categoryName.includes(query) ||
        propertyName.includes(query) ||
        entry.type.includes(query) ||
        entry.date.includes(query)
      );
    });
  }, [entries, searchQuery, categories, properties]);
}
