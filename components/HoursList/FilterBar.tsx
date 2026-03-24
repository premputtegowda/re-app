'use client';

import { useState, useEffect } from 'react';
import { Search, Filter, X, Download } from 'lucide-react';
import { useStore } from '@/lib/store';
import { Button } from '@/components/UI/Button';
import { Input } from '@/components/UI/Input';
import { Card } from '@/components/UI/Card';
import type { HoursFilter } from '@/types';
import { downloadCSV } from '@/utils/exportUtils';
import { useFilteredHours } from '@/hooks/useHoursData';

interface FilterBarProps {
  filter: HoursFilter;
  onFilterChange: (filter: HoursFilter) => void;
}

export function FilterBar({ filter, onFilterChange }: FilterBarProps) {
  const entries = useStore((s) => s.entries);
  const allCategories = useStore((s) => s.categories);
  const allProperties = useStore((s) => s.properties);
  const [showFilters, setShowFilters] = useState(false);
  const filteredEntries = useFilteredHours(entries, filter);

  // Only show filter chips for categories/properties that exist in actual entries
  const usedCategoryIds = new Set(entries.map((e) => e.category));
  const usedPropertyIds = new Set(entries.map((e) => e.property));
  const categories = allCategories.filter((c) => usedCategoryIds.has(c.id));
  const properties = allProperties.filter((p) => usedPropertyIds.has(p.id));

  // Drop any selected filter IDs that are no longer in the derived lists
  useEffect(() => {
    const validCategoryIds = new Set(categories.map((c) => c.id));
    const validPropertyIds = new Set(properties.map((p) => p.id));
    const cleanedCategories = (filter.categories ?? []).filter((id) => validCategoryIds.has(id));
    const cleanedProperties = (filter.properties ?? []).filter((id) => validPropertyIds.has(id));
    const categoriesChanged = cleanedCategories.length !== (filter.categories ?? []).length;
    const propertiesChanged = cleanedProperties.length !== (filter.properties ?? []).length;
    if (categoriesChanged || propertiesChanged) {
      onFilterChange({
        ...filter,
        categories: cleanedCategories,
        properties: cleanedProperties,
      });
    }
  }, [categories, properties]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSearchChange = (value: string) => {
    onFilterChange({ ...filter, searchQuery: value });
  };

  const handleDateFromChange = (value: string) => {
    onFilterChange({ ...filter, dateFrom: value });
  };

  const handleDateToChange = (value: string) => {
    onFilterChange({ ...filter, dateTo: value });
  };

  const handleCategoryToggle = (categoryId: string) => {
    const categories = filter.categories || [];
    const newCategories = categories.includes(categoryId)
      ? categories.filter((c) => c !== categoryId)
      : [...categories, categoryId];
    onFilterChange({ ...filter, categories: newCategories });
  };

  const handlePropertyToggle = (propertyId: string) => {
    const properties = filter.properties || [];
    const newProperties = properties.includes(propertyId)
      ? properties.filter((p) => p !== propertyId)
      : [...properties, propertyId];
    onFilterChange({ ...filter, properties: newProperties });
  };

  const handleTypeToggle = (type: 'material' | 'non-material') => {
    const types = filter.types || [];
    const newTypes = types.includes(type)
      ? types.filter((t) => t !== type)
      : [...types, type];
    onFilterChange({ ...filter, types: newTypes });
  };

  const handleClearFilters = () => {
    onFilterChange({});
  };

  const handleExport = () => {
    downloadCSV(filteredEntries, categories, properties);
  };

  const hasActiveFilters =
    filter.dateFrom ||
    filter.dateTo ||
    (filter.categories && filter.categories.length > 0) ||
    (filter.properties && filter.properties.length > 0) ||
    (filter.types && filter.types.length > 0);

  return (
    <div className="space-y-4">
      {/* Search and main actions */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400" size={20} />
          <input
            type="text"
            placeholder="Search descriptions..."
            value={filter.searchQuery || ''}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="input pl-10"
          />
        </div>
        <Button
          variant="secondary"
          onClick={() => setShowFilters(!showFilters)}
          className="flex items-center gap-2"
        >
          <Filter size={20} />
          Filters
          {hasActiveFilters && (
            <span className="bg-primary-600 text-white text-xs px-2 py-0.5 rounded-full">
              Active
            </span>
          )}
        </Button>
        <Button
          variant="secondary"
          onClick={handleExport}
          className="flex items-center gap-2"
        >
          <Download size={20} />
          Export
        </Button>
      </div>

      {/* Advanced filters */}
      {showFilters && (
        <Card>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-slate-900 dark:text-white">Filters</h3>
              {hasActiveFilters && (
                <button
                  onClick={handleClearFilters}
                  className="text-sm text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 flex items-center gap-1"
                >
                  <X size={16} />
                  Clear all
                </button>
              )}
            </div>

            {/* Date range */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input
                type="date"
                label="From Date"
                value={filter.dateFrom || ''}
                onChange={(e) => handleDateFromChange(e.target.value)}
                fullWidth
              />
              <Input
                type="date"
                label="To Date"
                value={filter.dateTo || ''}
                onChange={(e) => handleDateToChange(e.target.value)}
                fullWidth
              />
            </div>

            {/* Categories */}
            <div>
              <p className="label">Categories:</p>
              <div className="flex flex-wrap gap-2 mt-2">
                {categories.map((category) => (
                  <button
                    key={category.id}
                    onClick={() => handleCategoryToggle(category.id)}
                    className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all ${
                      filter.categories?.includes(category.id)
                        ? 'bg-primary-600 text-white'
                        : 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
                    }`}
                  >
                    {category.name}
                  </button>
                ))}
              </div>
            </div>

            {/* Properties */}
            <div>
              <p className="label">Properties:</p>
              <div className="flex flex-wrap gap-2 mt-2">
                {properties.map((property) => (
                  <button
                    key={property.id}
                    onClick={() => handlePropertyToggle(property.id)}
                    className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all ${
                      filter.properties?.includes(property.id)
                        ? 'bg-primary-600 text-white'
                        : 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
                    }`}
                  >
                    {property.name}
                  </button>
                ))}
              </div>
            </div>

            {/* Type */}
            <div>
              <p className="label">Type:</p>
              <div className="flex flex-wrap gap-2 mt-2">
                <button
                  onClick={() => handleTypeToggle('material')}
                  className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all ${
                    filter.types?.includes('material')
                      ? 'bg-primary-600 text-white'
                      : 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
                  }`}
                >
                  Material
                </button>
                <button
                  onClick={() => handleTypeToggle('non-material')}
                  className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all ${
                    filter.types?.includes('non-material')
                      ? 'bg-primary-600 text-white'
                      : 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
                  }`}
                >
                  Non-Material
                </button>
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Results count */}
      <div className="text-sm text-slate-600 dark:text-slate-400">
        Showing {filteredEntries.length} {filteredEntries.length === 1 ? 'entry' : 'entries'}
      </div>
    </div>
  );
}
