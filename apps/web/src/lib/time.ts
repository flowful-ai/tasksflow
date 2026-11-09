/** Small date helpers for the inbox and the task timeline. */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "now", "5m", "2h", "3d", then "Nov 7" (compact, for list rows). */
export function shortRelativeTime(iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diff = Math.max(0, now - then);
  if (diff < MINUTE) return 'now';
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}m`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h`;
  if (diff < 7 * DAY) return `${Math.floor(diff / DAY)}d`;
  return new Date(then).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** "just now", "5m ago", "2h ago", "3d ago", then "Nov 7" (timeline lines). */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const short = shortRelativeTime(iso, now);
  if (short === 'now') return 'just now';
  return /^\d+[mhd]$/.test(short) ? `${short} ago` : short;
}

/** Tomorrow at 09:00 local time (inbox "snooze until tomorrow"). */
export function tomorrowMorning(now: Date = new Date()): Date {
  const next = new Date(now);
  next.setDate(next.getDate() + 1);
  next.setHours(9, 0, 0, 0);
  return next;
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
