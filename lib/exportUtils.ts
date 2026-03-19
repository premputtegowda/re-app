import type { HoursEntry, Category, Property } from '@/types';

const escape = (s: string) => `"${(s ?? '').replace(/"/g, '""')}"`;

/**
 * Entries sorted chronologically — stable numbering used in CSV.
 */
export function sortedEntries(entries: HoursEntry[]): HoursEntry[] {
  return [...entries].sort((a, b) => a.date.localeCompare(b.date));
}

/** Zero-padded 3-digit entry number, e.g. "042" */
export const entryNum = (idx: number) => String(idx + 1).padStart(3, '0');

export function generateCSV(
  entries: HoursEntry[],
  categories: Category[],
  properties: Property[]
): string {
  const headers = [
    'Entry #',
    'Date',
    'Property',
    'Category',
    'Type',
    'Hours',
    'Minutes',
    'Total Minutes',
    'Total Hours',
    'Description',
    'Notes / Evidence',
    'Attachment Links',
  ].join(',');

  const rows = entries.map((entry, idx) => {
    const property = properties.find((p) => p.id === entry.property)?.name ?? '';
    const category = categories.find((c) => c.id === entry.category)?.name ?? '';
    const totalMinutes = entry.hours * 60 + entry.minutes;
    const totalHours = (entry.hours + entry.minutes / 60).toFixed(2);
    const attachmentLinks = (entry.attachments ?? [])
      .filter((a) => a.attachment_url)
      .map((a) => a.attachment_url)
      .join('\n');
    return [
      entryNum(idx),
      entry.date,
      escape(property),
      escape(category),
      entry.type,
      entry.hours,
      entry.minutes,
      totalMinutes,
      totalHours,
      escape(entry.description),
      escape(entry.notes ?? ''),
      escape(attachmentLinks),
    ].join(',');
  });

  return [headers, ...rows].join('\r\n');
}
