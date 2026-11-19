/**
 * Format a Date as a local calendar key (YYYY-MM-DD).
 *
 * `toISOString()` represents UTC, so slicing its date portion can return the
 * previous calendar day for users east of UTC shortly after local midnight.
 */
export function formatLocalDate(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Parse a persisted YYYY-MM-DD key as local midnight instead of UTC midnight. */
export function parseLocalDate(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return new Date(value);
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

/** Format a Date's wall-clock local time as HH:MM:SS without UTC conversion. */
export function formatLocalTime(date: Date = new Date()): string {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

/** Normalize a visible local execution time (HH:MM or HH:MM:SS) into canonical HH:MM:SS, or "" if invalid. */
export function normalizeLocalTime(value: unknown): string {
  if (typeof value !== 'string') return '';
  const text = value.normalize('NFKC').trim();
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(text);
  if (!match) return '';
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = match[3] === undefined ? 0 : Number(match[3]);
  if (hours > 23 || minutes > 59 || seconds > 59) return '';
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/** Convert a local calendar date (YYYY-MM-DD) and wall-clock time (HH:MM:SS) to epoch milliseconds. */
export function parseLocalDateTimeMs(date: string, time: string): number | null {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const normalizedTime = normalizeLocalTime(time);
  if (!dateMatch || !normalizedTime) return null;
  const [hours, minutes, seconds] = normalizedTime.split(':').map(Number);
  const parsed = new Date(Number(dateMatch[1]), Number(dateMatch[2]) - 1, Number(dateMatch[3]), hours, minutes, seconds);
  if (!Number.isFinite(parsed.getTime()) || formatLocalDate(parsed) !== date) return null;
  return parsed.getTime();
}
