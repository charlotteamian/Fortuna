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
