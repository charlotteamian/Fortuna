import type { DividendCheckSummary } from './dividendCheckSummary.ts';

export type DividendReadFilter = 'all' | 'triggered' | 'held' | 'paused' | 'unknown';

/** Reading filters inspect the shared result; they never change qualification or action state. */
export function matchesDividendReadFilter(summary: DividendCheckSummary | undefined, filter: DividendReadFilter): boolean {
  if (filter === 'all') return true;
  if (!summary) return filter === 'unknown';
  if (filter === 'triggered') return summary.trigger.status === 'triggered';
  if (filter === 'held') return summary.actionCheck.shares !== null && summary.actionCheck.shares > 0;
  if (filter === 'paused') return summary.actionCheck.buy.reasons.includes('manual_pause');
  return summary.eligibility.status === 'unknown' || summary.trigger.status === 'unknown'
    || summary.grid.status !== 'verified' || summary.actionCheck.shares === null
    || summary.actionCheck.buy.status === 'unknown' || summary.actionCheck.sell.status === 'unknown'
    || summary.risk.evidenceInsufficient.length > 0;
}

/** Existing six-digit stock preferences retain their meaning. Fund openings use a namespaced opt-in. */
export function dividendHomeCollapsed(key: string, codes: readonly string[]): boolean {
  return key.startsWith('fund:') ? !codes.includes(`open:${key}`) : codes.includes(key);
}
