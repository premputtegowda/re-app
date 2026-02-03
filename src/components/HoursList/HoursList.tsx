import { useState } from 'react';
import { FileX } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { FilterBar } from './FilterBar';
import { HoursListItem } from './HoursListItem';
import { useFilteredHours } from '../../hooks/useHoursData';
import type { HoursFilter, SortConfig } from '../../types';

export function HoursList() {
  const { state, setFilter } = useApp();
  const [localFilter, setLocalFilter] = useState<HoursFilter>(state.filter);
  const sortConfig: SortConfig = {
    field: 'date',
    order: 'desc',
  };

  const filteredEntries = useFilteredHours(state.entries, localFilter, sortConfig);

  const handleFilterChange = (filter: HoursFilter) => {
    setLocalFilter(filter);
    setFilter(filter);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-900 mb-2">View Hours</h2>
        <p className="text-slate-600">Review and manage your logged hours</p>
      </div>

      <FilterBar filter={localFilter} onFilterChange={handleFilterChange} />

      {/* Hours list */}
      <div className="space-y-3">
        {filteredEntries.length === 0 ? (
          <div className="text-center py-12">
            <FileX className="mx-auto text-slate-300 mb-4" size={64} />
            <h3 className="text-lg font-semibold text-slate-900 mb-2">No entries found</h3>
            <p className="text-slate-600">
              {state.entries.length === 0
                ? "You haven't logged any hours yet. Start by adding your first entry!"
                : 'Try adjusting your filters to see more results.'}
            </p>
          </div>
        ) : (
          filteredEntries.map((entry) => <HoursListItem key={entry.id} entry={entry} />)
        )}
      </div>
    </div>
  );
}
