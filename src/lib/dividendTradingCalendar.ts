/** SSE/SZSE closures, not the government's adjusted working-week calendar.
 * https://www.sse.com.cn/disclosure/announcement/general/c/c_20241223_10767108.shtml
 * https://www.sse.com.cn/disclosure/announcement/general/c/c_20251222_10802507.shtml
 * Unlisted years conservatively treat weekdays as trading days, so an unknown
 * holiday never promotes an older quote through the non-trading-day exception.
 */
const CLOSURES: readonly (readonly [string, string])[] = [
  ['2025-01-01', '2025-01-01'], ['2025-01-28', '2025-02-04'],
  ['2025-04-04', '2025-04-06'], ['2025-05-01', '2025-05-05'],
  ['2025-05-31', '2025-06-02'], ['2025-10-01', '2025-10-08'],
  ['2026-01-01', '2026-01-03'], ['2026-02-15', '2026-02-23'],
  ['2026-04-04', '2026-04-06'], ['2026-05-01', '2026-05-05'],
  ['2026-06-19', '2026-06-21'], ['2026-09-25', '2026-09-27'],
  ['2026-10-01', '2026-10-07'],
];

export function isDividendTradingDay(date: string): boolean {
  const time = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== date) return false;
  const weekday = new Date(time).getUTCDay();
  return weekday !== 0 && weekday !== 6 && !CLOSURES.some(([start, end]) => date >= start && date <= end);
}

export function latestTradingDayOnOrBefore(asOf: string): string {
  let time = Date.parse(`${asOf}T00:00:00Z`);
  if (!Number.isFinite(time)) return asOf;
  for (let steps = 0; steps < 32; steps++, time -= 86400000) {
    const date = new Date(time).toISOString().slice(0, 10);
    if (isDividendTradingDay(date)) return date;
  }
  return asOf;
}
