import type { DividendFundCheckSummary } from './dividendCheckSummary.ts';
import type { DividendFundMode } from './dividendFundPlan.ts';

export type DividendFundTodayAction = 'buy' | 'sell' | 'wait' | 'update' | 'allocate';

/** A concise view of existing fund conditions, never an order or a holding assumption. */
export function dividendFundTodayAction(check: DividendFundCheckSummary, mode: DividendFundMode): DividendFundTodayAction {
  if (mode === 'swing' && check.trigger.sell === 'triggered' && check.actionCheck.shares !== 0) return 'sell';
  if (check.trigger.buy === 'triggered') return (check.actionCheck.budgetMinor ?? 0) > 0 ? 'buy' : 'allocate';
  if (check.trigger.buy === 'not_triggered' && (mode !== 'swing' || check.trigger.sell === 'not_triggered' || check.actionCheck.shares === 0)) return 'wait';
  return 'update';
}
