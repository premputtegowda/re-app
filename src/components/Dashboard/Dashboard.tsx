import { Clock, Calendar, TrendingUp, Activity, PlusCircle } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { SummaryCard } from './SummaryCard';
import { CategoryChart, PropertyChart, MonthlyTrendChart, TypeComparisonChart } from './HoursChart';
import { Card } from '../UI/Card';
import { Button } from '../UI/Button';
import { HoursListItem } from '../HoursList/HoursListItem';
import {
  calculateSummary,
  calculateCategorySummaries,
  calculatePropertySummaries,
  calculateMonthlyData,
  formatDuration,
} from '../../utils/calculations';
import { useRecentEntries } from '../../hooks/useHoursData';
import type { ViewMode } from '../../types';

interface DashboardProps {
  onViewChange: (view: ViewMode) => void;
}

export function Dashboard({ onViewChange }: DashboardProps) {
  const { state } = useApp();
  const recentEntries = useRecentEntries(state.entries, 5);

  const summary = calculateSummary(state.entries);
  const categorySummaries = calculateCategorySummaries(state.entries, state.categories);
  const propertySummaries = calculatePropertySummaries(state.entries, state.properties);
  const monthlyData = calculateMonthlyData(state.entries);

  const topCategory = categorySummaries[0];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 mb-2">Dashboard</h2>
          <p className="text-slate-600">Overview of your REPS hours tracking</p>
        </div>
        <Button onClick={() => onViewChange('entry')} className="flex items-center gap-2">
          <PlusCircle size={20} />
          Add Hours
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <SummaryCard
          title="Total Hours"
          value={formatDuration(summary.totalMinutes)}
          subtitle={`${summary.entriesCount} entries`}
          icon={Clock}
          iconColor="text-primary-600"
        />
        <SummaryCard
          title="This Month"
          value={formatDuration(summary.monthHours * 60)}
          subtitle="Current month"
          icon={Calendar}
          iconColor="text-secondary-600"
        />
        <SummaryCard
          title="This Week"
          value={formatDuration(summary.weekHours * 60)}
          subtitle="Last 7 days"
          icon={TrendingUp}
          iconColor="text-accent-600"
        />
        <SummaryCard
          title="Top Category"
          value={topCategory ? topCategory.categoryName : 'N/A'}
          subtitle={topCategory ? formatDuration(topCategory.totalMinutes) : 'No data'}
          icon={Activity}
          iconColor="text-purple-600"
        />
      </div>

      {/* Material vs Non-Material */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <TypeComparisonChart
          materialHours={summary.materialHours}
          nonMaterialHours={summary.nonMaterialHours}
        />

        {/* Quick Stats */}
        <Card>
          <h3 className="text-lg font-semibold text-slate-900 mb-4">Quick Stats</h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-slate-600">Total Entries</span>
              <span className="text-lg font-semibold text-slate-900">{summary.entriesCount}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-600">Categories Used</span>
              <span className="text-lg font-semibold text-slate-900">{categorySummaries.length}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-600">Properties Tracked</span>
              <span className="text-lg font-semibold text-slate-900">{propertySummaries.length}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-600">Avg Hours/Entry</span>
              <span className="text-lg font-semibold text-slate-900">
                {summary.entriesCount > 0
                  ? formatDuration(Math.floor(summary.totalMinutes / summary.entriesCount))
                  : '0h'}
              </span>
            </div>
          </div>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <CategoryChart data={categorySummaries} />
        <PropertyChart data={propertySummaries} />
      </div>

      <MonthlyTrendChart data={monthlyData} />

      {/* Recent Entries */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-slate-900">Recent Entries</h3>
          {recentEntries.length > 0 && (
            <Button variant="ghost" onClick={() => onViewChange('list')} size="sm">
              View All
            </Button>
          )}
        </div>

        {recentEntries.length === 0 ? (
          <Card>
            <div className="text-center py-12">
              <Clock className="mx-auto text-slate-300 mb-4" size={64} />
              <h3 className="text-lg font-semibold text-slate-900 mb-2">No entries yet</h3>
              <p className="text-slate-600 mb-4">Start tracking your REPS hours by adding your first entry.</p>
              <Button onClick={() => onViewChange('entry')}>Add First Entry</Button>
            </div>
          </Card>
        ) : (
          <div className="space-y-3">
            {recentEntries.map((entry) => (
              <HoursListItem key={entry.id} entry={entry} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
