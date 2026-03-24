/**
 * Date utility functions for the REPS tracker
 */

/**
 * Format a date string to display format (MM/DD/YYYY)
 */
export const formatDate = (dateString: string): string => {
  const [year, month, day] = dateString.split('T')[0].split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString('en-US', {
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
  });
};

/**
 * Format a date string to long format (Month DD, YYYY)
 */
export const formatDateLong = (dateString: string): string => {
  const [year, month, day] = dateString.split('T')[0].split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
};

/**
 * Get today's date in YYYY-MM-DD format
 */
export const getTodayDate = (): string => {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

/**
 * Get current timestamp in ISO format
 */
export const getCurrentTimestamp = (): string => {
  return new Date().toISOString();
};

/**
 * Check if a date is in the future
 */
export const isFutureDate = (dateString: string): boolean => {
  const date = new Date(dateString + 'T00:00:00'); // Parse as local time
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return date > today;
};

/**
 * Get the start of the rolling 7-day window (today minus 6 days)
 */
export const getWeekStart = (): Date => {
  const start = new Date();
  start.setDate(start.getDate() - 6);
  start.setHours(0, 0, 0, 0);
  return start;
};

/**
 * Get the start of the current month
 */
export const getMonthStart = (): Date => {
  const today = new Date();
  return new Date(today.getFullYear(), today.getMonth(), 1);
};

/**
 * Get the start of the current year
 */
export const getYearStart = (): Date => {
  const today = new Date();
  return new Date(today.getFullYear(), 0, 1);
};

/**
 * Check if a date is within a range
 */
export const isDateInRange = (
  dateString: string,
  startDate?: string,
  endDate?: string
): boolean => {
  const date = new Date(dateString + 'T00:00:00');

  if (startDate) {
    const start = new Date(startDate + 'T00:00:00');
    if (date < start) return false;
  }

  if (endDate) {
    const end = new Date(endDate + 'T00:00:00');
    end.setHours(23, 59, 59, 999); // Include the entire end date
    if (date > end) return false;
  }

  return true;
};

/**
 * Get month and year string (YYYY-MM)
 */
export const getMonthYear = (dateString: string): string => {
  const [year, month] = dateString.split('T')[0].split('-');
  return `${year}-${month}`;
};

/**
 * Format month-year string to display format (Month YYYY)
 */
export const formatMonthYear = (monthYear: string): string => {
  const [year, month] = monthYear.split('-');
  const date = new Date(parseInt(year), parseInt(month) - 1);
  return date.toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });
};

/**
 * Get relative time string (e.g., "2 hours ago", "yesterday")
 */
export const getRelativeTime = (dateString: string): string => {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSecs < 60) return 'just now';
  if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} week${Math.floor(diffDays / 7) > 1 ? 's' : ''} ago`;

  return formatDate(dateString);
};

/**
 * Validate date string format (YYYY-MM-DD)
 */
export const isValidDateFormat = (dateString: string): boolean => {
  const regex = /^\d{4}-\d{2}-\d{2}$/;
  if (!regex.test(dateString)) return false;

  const date = new Date(dateString);
  return date instanceof Date && !isNaN(date.getTime());
};
