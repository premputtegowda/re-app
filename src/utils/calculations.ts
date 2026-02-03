import type { HoursEntry, CategorySummary, PropertySummary, MonthlyData, SummaryData } from '../types';
import { getWeekStart, getMonthStart, getMonthYear } from './dateUtils';

/**
 * Convert hours and minutes to total minutes
 */
export const toTotalMinutes = (hours: number, minutes: number): number => {
  return hours * 60 + minutes;
};

/**
 * Convert total minutes to hours and minutes
 */
export const toHoursAndMinutes = (totalMinutes: number): { hours: number; minutes: number } => {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return { hours, minutes };
};

/**
 * Format total minutes as "Xh Ym" or "Xh" or "Ym"
 */
export const formatDuration = (totalMinutes: number): string => {
  const { hours, minutes } = toHoursAndMinutes(totalMinutes);

  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
};

/**
 * Format total minutes as decimal hours (e.g., 1.5 hours)
 */
export const formatDecimalHours = (totalMinutes: number): string => {
  const decimalHours = totalMinutes / 60;
  return decimalHours.toFixed(2);
};

/**
 * Calculate summary data from entries
 */
export const calculateSummary = (entries: HoursEntry[]): SummaryData => {
  const weekStart = getWeekStart();
  const monthStart = getMonthStart();

  let totalMinutes = 0;
  let weekMinutes = 0;
  let monthMinutes = 0;
  let materialMinutes = 0;
  let nonMaterialMinutes = 0;

  entries.forEach((entry) => {
    const entryDate = new Date(entry.date);
    totalMinutes += entry.totalMinutes;

    if (entryDate >= weekStart) {
      weekMinutes += entry.totalMinutes;
    }

    if (entryDate >= monthStart) {
      monthMinutes += entry.totalMinutes;
    }

    if (entry.type === 'material') {
      materialMinutes += entry.totalMinutes;
    } else {
      nonMaterialMinutes += entry.totalMinutes;
    }
  });

  return {
    totalHours: Math.floor(totalMinutes / 60),
    totalMinutes,
    monthHours: Math.floor(monthMinutes / 60),
    weekHours: Math.floor(weekMinutes / 60),
    materialHours: Math.floor(materialMinutes / 60),
    nonMaterialHours: Math.floor(nonMaterialMinutes / 60),
    entriesCount: entries.length,
  };
};

/**
 * Calculate category summaries
 */
export const calculateCategorySummaries = (
  entries: HoursEntry[],
  categories: Array<{ id: string; name: string; color: string }>
): CategorySummary[] => {
  const summaryMap = new Map<string, CategorySummary>();

  // Initialize summaries for all categories
  categories.forEach((cat) => {
    summaryMap.set(cat.id, {
      categoryId: cat.id,
      categoryName: cat.name,
      totalMinutes: 0,
      totalHours: 0,
      entryCount: 0,
      color: cat.color,
    });
  });

  // Aggregate data from entries
  entries.forEach((entry) => {
    const summary = summaryMap.get(entry.category);
    if (summary) {
      summary.totalMinutes += entry.totalMinutes;
      summary.totalHours = Math.floor(summary.totalMinutes / 60);
      summary.entryCount += 1;
    }
  });

  // Convert to array and sort by total minutes (descending)
  return Array.from(summaryMap.values())
    .filter((summary) => summary.entryCount > 0)
    .sort((a, b) => b.totalMinutes - a.totalMinutes);
};

/**
 * Calculate property summaries
 */
export const calculatePropertySummaries = (
  entries: HoursEntry[],
  properties: Array<{ id: string; name: string }>
): PropertySummary[] => {
  const summaryMap = new Map<string, PropertySummary>();

  // Initialize summaries for all properties
  properties.forEach((prop) => {
    summaryMap.set(prop.id, {
      propertyId: prop.id,
      propertyName: prop.name,
      totalMinutes: 0,
      totalHours: 0,
      entryCount: 0,
    });
  });

  // Aggregate data from entries
  entries.forEach((entry) => {
    const summary = summaryMap.get(entry.property);
    if (summary) {
      summary.totalMinutes += entry.totalMinutes;
      summary.totalHours = Math.floor(summary.totalMinutes / 60);
      summary.entryCount += 1;
    }
  });

  // Convert to array and sort by total minutes (descending)
  return Array.from(summaryMap.values())
    .filter((summary) => summary.entryCount > 0)
    .sort((a, b) => b.totalMinutes - a.totalMinutes);
};

/**
 * Calculate monthly data for trends
 */
export const calculateMonthlyData = (entries: HoursEntry[]): MonthlyData[] => {
  const monthlyMap = new Map<string, MonthlyData>();

  entries.forEach((entry) => {
    const month = getMonthYear(entry.date);
    const existing = monthlyMap.get(month);

    if (existing) {
      existing.totalMinutes += entry.totalMinutes;
      existing.totalHours = Math.floor(existing.totalMinutes / 60);
      existing.entryCount += 1;
    } else {
      monthlyMap.set(month, {
        month,
        totalMinutes: entry.totalMinutes,
        totalHours: Math.floor(entry.totalMinutes / 60),
        entryCount: 1,
      });
    }
  });

  // Convert to array and sort by month
  return Array.from(monthlyMap.values()).sort((a, b) => a.month.localeCompare(b.month));
};

/**
 * Calculate percentage
 */
export const calculatePercentage = (value: number, total: number): number => {
  if (total === 0) return 0;
  return Math.round((value / total) * 100);
};

/**
 * Get top N categories by hours
 */
export const getTopCategories = (
  summaries: CategorySummary[],
  limit: number = 5
): CategorySummary[] => {
  return summaries.slice(0, limit);
};

/**
 * Calculate average hours per entry
 */
export const calculateAverageHours = (entries: HoursEntry[]): number => {
  if (entries.length === 0) return 0;
  const totalMinutes = entries.reduce((sum, entry) => sum + entry.totalMinutes, 0);
  return totalMinutes / 60 / entries.length;
};
