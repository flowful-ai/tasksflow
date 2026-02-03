/**
 * Date utilities for common operations.
 */

/**
 * Check if a date is in the past.
 */
export function isPast(date: Date): boolean {
  return date.getTime() < Date.now();
}

/**
 * Check if a date is in the future.
 */
export function isFuture(date: Date): boolean {
  return date.getTime() > Date.now();
}

/**
 * Check if a date is today.
 */
export function isToday(date: Date): boolean {
  const today = new Date();
  return (
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate()
  );
}

/**
 * Check if a date is within the next N days.
 */
export function isWithinDays(date: Date, days: number): boolean {
  const now = new Date();
  const future = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  return date >= now && date <= future;
}

/**
 * Check if a date is overdue (in the past and not today).
 */
export function isOverdue(date: Date): boolean {
  return isPast(date) && !isToday(date);
}

/**
 * Get the start of today.
 */
export function startOfToday(): Date {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

/**
 * Get the end of today.
 */
export function endOfToday(): Date {
  const date = new Date();
  date.setHours(23, 59, 59, 999);
  return date;
}

/**
 * Add days to a date.
 */
export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

/**
 * Format a date relative to now (e.g., "2 days ago", "in 3 hours").
 */
export function formatRelative(date: Date): string {
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  const diffSecs = Math.round(diffMs / 1000);
  const diffMins = Math.round(diffSecs / 60);
  const diffHours = Math.round(diffMins / 60);
  const diffDays = Math.round(diffHours / 24);

  if (Math.abs(diffSecs) < 60) {
    return 'just now';
  }

  if (Math.abs(diffMins) < 60) {
    const mins = Math.abs(diffMins);
    const label = mins === 1 ? 'minute' : 'minutes';
    return diffMins > 0 ? `in ${mins} ${label}` : `${mins} ${label} ago`;
  }

  if (Math.abs(diffHours) < 24) {
    const hours = Math.abs(diffHours);
    const label = hours === 1 ? 'hour' : 'hours';
    return diffHours > 0 ? `in ${hours} ${label}` : `${hours} ${label} ago`;
  }

  const days = Math.abs(diffDays);
  const label = days === 1 ? 'day' : 'days';
  return diffDays > 0 ? `in ${days} ${label}` : `${days} ${label} ago`;
}
