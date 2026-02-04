'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { FileX } from 'lucide-react';
import { useStore } from '@/lib/store';
import { FilterBar } from './FilterBar';
import { HoursListItem } from './HoursListItem';
import { useFilteredHours } from '@/hooks/useHoursData';
import type { HoursFilter, SortConfig } from '@/types';

export function HoursList() {
  const entries = useStore((s) => s.entries);
  const filter = useStore((s) => s.filter);
  const setFilter = useStore((s) => s.setFilter);
  const [localFilter, setLocalFilter] = useState<HoursFilter>(filter);
  const sortConfig: SortConfig = {
    field: 'date',
    order: 'desc',
  };

  const filteredEntries = useFilteredHours(entries, localFilter, sortConfig);

  const handleFilterChange = (filter: HoursFilter) => {
    setLocalFilter(filter);
    setFilter(filter);
  };

  return (
    <div className="space-y-6">
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">View Hours</h2>
        <p className="text-slate-600 dark:text-slate-400">Review and manage your logged hours</p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.1 }}
      >
        <FilterBar filter={localFilter} onFilterChange={handleFilterChange} />
      </motion.div>

      {/* Hours list */}
      <div className="space-y-3">
        {filteredEntries.length === 0 ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center py-12"
          >
            <FileX className="mx-auto text-slate-300 dark:text-slate-600 mb-4" size={64} />
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">No entries found</h3>
            <p className="text-slate-600 dark:text-slate-400">
              {entries.length === 0
                ? "You haven't logged any hours yet. Start by adding your first entry!"
                : 'Try adjusting your filters to see more results.'}
            </p>
          </motion.div>
        ) : (
          filteredEntries.map((entry, index) => (
            <motion.div
              key={entry.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
            >
              <HoursListItem entry={entry} />
            </motion.div>
          ))
        )}
      </div>
    </div>
  );
}
