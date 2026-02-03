import type { HoursEntry, Category, Property } from '../types';
import { formatDate } from './dateUtils';
import { formatDuration } from './calculations';

/**
 * Convert entries to CSV format
 */
export const exportToCSV = (
  entries: HoursEntry[],
  categories: Category[],
  properties: Property[]
): string => {
  // Create category and property lookup maps
  const categoryMap = new Map(categories.map((c) => [c.id, c.name]));
  const propertyMap = new Map(properties.map((p) => [p.id, p.name]));

  // CSV headers
  const headers = [
    'Date',
    'Hours',
    'Minutes',
    'Total Duration',
    'Category',
    'Property',
    'Type',
    'Description',
  ];

  // Create CSV rows
  const rows = entries.map((entry) => {
    const categoryName = categoryMap.get(entry.category) || 'Unknown';
    const propertyName = propertyMap.get(entry.property) || 'Unknown';

    return [
      formatDate(entry.date),
      entry.hours.toString(),
      entry.minutes.toString(),
      formatDuration(entry.totalMinutes),
      categoryName,
      propertyName,
      entry.type === 'material' ? 'Material' : 'Non-Material',
      `"${entry.description.replace(/"/g, '""')}"`, // Escape quotes in description
    ];
  });

  // Combine headers and rows
  const csvContent = [
    headers.join(','),
    ...rows.map((row) => row.join(',')),
  ].join('\n');

  return csvContent;
};

/**
 * Download CSV file
 */
export const downloadCSV = (
  entries: HoursEntry[],
  categories: Category[],
  properties: Property[],
  filename: string = 'reps-hours-export'
): void => {
  const csv = exportToCSV(entries, categories, properties);

  // Create blob and download
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);

  // Add timestamp to filename
  const timestamp = new Date().toISOString().split('T')[0];
  const fullFilename = `${filename}-${timestamp}.csv`;

  link.setAttribute('href', url);
  link.setAttribute('download', fullFilename);
  link.style.visibility = 'hidden';

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  // Clean up
  URL.revokeObjectURL(url);
};

/**
 * Export summary report as text
 */
export const exportSummaryText = (
  entries: HoursEntry[],
  categories: Category[],
  properties: Property[]
): string => {
  const categoryMap = new Map(categories.map((c) => [c.id, c.name]));
  const propertyMap = new Map(properties.map((p) => [p.id, p.name]));

  // Calculate totals
  const totalMinutes = entries.reduce((sum, e) => sum + e.totalMinutes, 0);
  const materialMinutes = entries
    .filter((e) => e.type === 'material')
    .reduce((sum, e) => sum + e.totalMinutes, 0);
  const nonMaterialMinutes = entries
    .filter((e) => e.type === 'non-material')
    .reduce((sum, e) => sum + e.totalMinutes, 0);

  // Group by category
  const byCategory = new Map<string, number>();
  entries.forEach((entry) => {
    const categoryName = categoryMap.get(entry.category) || 'Unknown';
    byCategory.set(categoryName, (byCategory.get(categoryName) || 0) + entry.totalMinutes);
  });

  // Group by property
  const byProperty = new Map<string, number>();
  entries.forEach((entry) => {
    const propertyName = propertyMap.get(entry.property) || 'Unknown';
    byProperty.set(propertyName, (byProperty.get(propertyName) || 0) + entry.totalMinutes);
  });

  // Build report
  let report = 'REPS HOURS TRACKING REPORT\n';
  report += '='.repeat(50) + '\n\n';

  report += 'SUMMARY\n';
  report += '-'.repeat(50) + '\n';
  report += `Total Entries: ${entries.length}\n`;
  report += `Total Hours: ${formatDuration(totalMinutes)}\n`;
  report += `Material Hours: ${formatDuration(materialMinutes)}\n`;
  report += `Non-Material Hours: ${formatDuration(nonMaterialMinutes)}\n\n`;

  report += 'BY CATEGORY\n';
  report += '-'.repeat(50) + '\n';
  Array.from(byCategory.entries())
    .sort((a, b) => b[1] - a[1])
    .forEach(([category, minutes]) => {
      report += `${category}: ${formatDuration(minutes)}\n`;
    });

  report += '\nBY PROPERTY\n';
  report += '-'.repeat(50) + '\n';
  Array.from(byProperty.entries())
    .sort((a, b) => b[1] - a[1])
    .forEach(([property, minutes]) => {
      report += `${property}: ${formatDuration(minutes)}\n`;
    });

  report += '\n' + '='.repeat(50) + '\n';
  report += `Generated: ${new Date().toLocaleString()}\n`;

  return report;
};

/**
 * Copy text to clipboard
 */
export const copyToClipboard = (text: string): Promise<void> => {
  return navigator.clipboard.writeText(text);
};
