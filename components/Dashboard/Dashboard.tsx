'use client';

import { motion } from 'framer-motion';
import { Clock, Calendar, TrendingUp, PlusCircle } from 'lucide-react';
import { useStore } from '@/lib/store';
import { SummaryCard } from './SummaryCard';
import { CategoryChart, PropertyChart, MonthlyTrendChart, TypeComparisonChart } from './HoursChart';
import { Card } from '@/components/UI/Card';
import { Button } from '@/components/UI/Button';
import { HoursListItem } from '@/components/HoursList/HoursListItem';
import {
  calculateSummary,
  calculateCategorySummaries,
  calculatePropertySummaries,
  calculateMonthlyData,
  formatDuration,
} from '@/utils/calculations';
import { useRecentEntries } from '@/hooks/useHoursData';
import type { ViewMode } from '@/types';

interface DashboardProps {
  onViewChange: (view: ViewMode) => void;
}

export function Dashboard({ onViewChange }: DashboardProps) {
  const entries = useStore((s) => s.entries);
  const categories = useStore((s) => s.categories);
  const properties = useStore((s) => s.properties);
  const recentEntries = useRecentEntries(entries, 5);

  const summary = calculateSummary(entries);
  const categorySummaries = calculateCategorySummaries(entries, categories);
  const propertySummaries = calculatePropertySummaries(entries, properties);
  const monthlyData = calculateMonthlyData(entries);

  const topCategory = categorySummaries[0];

  return (
    <div className="space-y-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-between"
      >
        <div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">Dashboard</h2>
          <p className="text-slate-600 dark:text-slate-400">Overview of your REPS hours tracking</p>
        </div>
        <Button onClick={() => onViewChange('entry')} className="flex items-center gap-2">
          <PlusCircle size={20} />
          Add Hours
        </Button>
      </motion.div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[
          { title: "Total Hours", value: formatDuration(summary.totalMinutes), subtitle: `${summary.entriesCount} entries`, icon: Clock, iconColor: "text-primary-600" },
          { title: "This Month", value: formatDuration(summary.monthHours * 60), subtitle: "Current month", icon: Calendar, iconColor: "text-secondary-600" },
          { title: "This Week", value: formatDuration(summary.weekHours * 60), subtitle: "Last 7 days", icon: TrendingUp, iconColor: "text-accent-600" },
        ].map((card, index) => (
          <motion.div
            key={card.title}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.1 }}
          >
            <SummaryCard {...card} />
          </motion.div>
        ))}
      </div>

      {/* Material vs Non-Material */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4 }}
        className="grid grid-cols-1 lg:grid-cols-2 gap-6"
      >
        <TypeComparisonChart
          materialHours={summary.materialHours}
          nonMaterialHours={summary.nonMaterialHours}
        />

        {/* Quick Stats */}
        <Card>
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">Quick Stats</h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-slate-600 dark:text-slate-400">Total Entries</span>
              <span className="text-lg font-semibold text-slate-900 dark:text-white">{summary.entriesCount}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-600 dark:text-slate-400">Categories Used</span>
              <span className="text-lg font-semibold text-slate-900 dark:text-white">{categorySummaries.length}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-600 dark:text-slate-400">Properties Tracked</span>
              <span className="text-lg font-semibold text-slate-900 dark:text-white">{propertySummaries.length}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-600 dark:text-slate-400">Avg Hours/Entry</span>
              <span className="text-lg font-semibold text-slate-900 dark:text-white">
                {summary.entriesCount > 0
                  ? formatDuration(Math.floor(summary.totalMinutes / summary.entriesCount))
                  : '0h'}
              </span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-slate-600 dark:text-slate-400 shrink-0">Top Category</span>
              <span className="text-lg font-semibold text-slate-900 dark:text-white truncate text-right" title={topCategory?.categoryName}>
                {topCategory ? topCategory.categoryName : 'N/A'}
              </span>
            </div>
          </div>
        </Card>
      </motion.div>

      {/* Charts */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5 }}
        className="grid grid-cols-1 lg:grid-cols-2 gap-6"
      >
        <CategoryChart data={categorySummaries} />
        <PropertyChart data={propertySummaries} />
      </motion.div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.6 }}
      >
        <MonthlyTrendChart data={monthlyData} />
      </motion.div>

      {/* Recent Entries */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.7 }}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Recent Entries</h3>
          {recentEntries.length > 0 && (
            <Button variant="ghost" onClick={() => onViewChange('list')} size="sm">
              View All
            </Button>
          )}
        </div>

        {recentEntries.length === 0 ? (
          <Card>
            <div className="text-center py-12">
              <Clock className="mx-auto text-slate-300 dark:text-slate-600 mb-4" size={64} />
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">No entries yet</h3>
              <p className="text-slate-600 dark:text-slate-400 mb-4">Start tracking your REPS hours by adding your first entry.</p>
              <Button onClick={() => onViewChange('entry')}>Add First Entry</Button>
            </div>
          </Card>
        ) : (
          <div className="space-y-3">
            {recentEntries.map((entry, index) => (
              <motion.div
                key={entry.id}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.7 + index * 0.05 }}
              >
                <HoursListItem entry={entry} />
              </motion.div>
            ))}
          </div>
        )}
      </motion.div>
    </div>
  );
}
