import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { DividendCheckSummary } from '../lib/dividendCheckSummary';
import DividendCheckStatus from './DividendCheckStatus';

/** Presents the next price tier separately from the quantity allowed by the budget. */
export default function DividendCompactPlan({ summary, amountVisible, source, children }: {
  summary: DividendCheckSummary; amountVisible: boolean; source?: string; children?: ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const number = (value: number) => value.toLocaleString(i18n.language, { maximumFractionDigits: 4 });
  const quantity = (value: number) => amountVisible ? number(value) : '••••';
  const quote = summary.trigger.quote;
  const manualFundPrice = summary.kind === 'fund' && quote.priceMicros === undefined ? summary.fundPlan.priceMicros : undefined;
  const price = (minor?: number, micros?: number) => {
    if (summary.kind === 'fund' && !amountVisible && (minor !== undefined || micros !== undefined)) return '••••';
    return micros !== undefined ? `¥${(micros / 1e6).toLocaleString(i18n.language, { maximumFractionDigits: 6 })}`
      : minor !== undefined ? `¥${(minor / 100).toLocaleString(i18n.language, { maximumFractionDigits: 2 })}` : '—';
  };
  const target = (side: 'buy' | 'sell') => {
    const tier = summary.grid[side === 'buy' ? 'nextBuy' : 'nextSell'];
    const state = summary.grid[side === 'buy' ? 'nextBuyState' : 'nextSellState'] ?? 'unknown';
    const tierTrigger = summary.trigger[side] === 'unknown' ? 'unknown'
      : tier && summary.trigger[`${side}Levels`].includes(tier.index) ? 'triggered' : 'not_triggered';
    if (summary.kind === 'fund') return <>{price(undefined, side === 'buy' ? summary.grid.entryPriceMicros : summary.grid.exitPriceMicros)}</>;
    return <>{tier && <span>{t('div_read_original_tier', { level: tier.index })} · {price(tier.priceMinor, tier.priceMicros)}</span>}
      {tier?.basis === 'price_reference' ? <small>{t('div_read_price_reference')}</small> : <>
        {tier?.basis === 'cumulative_target' && !(side === 'buy' && tier.targetShares === 0) && <small>{t(side === 'buy' ? 'div_read_target_shares' : 'div_read_sell_shares', { shares: (side === 'buy' ? tier.targetShares : tier.sellShares) === undefined ? '—' : quantity((side === 'buy' ? tier.targetShares : tier.sellShares)!) })}</small>}
        {state !== 'pending' && <small>{t(side === 'buy' && tier?.targetShares === 0 && state === 'below_lot' ? 'div_read_tier_budget_below_lot' : `div_read_next_${state}`)}</small>}
        {tier && <small>{t(`div_check_trigger_${tierTrigger}`)}</small>}
      </>}</>;
  };
  return <div className="div-compact-plan">
    <div className="div-compact-quote"><strong>{price(quote.priceMinor, quote.priceMicros ?? manualFundPrice)}</strong><span>{t(manualFundPrice !== undefined ? 'div_check_manual_price_label' : quote.status === 'current' ? 'div_read_quote_current' : 'div_read_quote_reference')}
      <small>{source ?? t(quote.date ? 'div_read_market_source' : 'div_check_quote_unknown')}</small></span></div>
    <div className="div-home-plan-budget"><span>{t(summary.kind === 'fund' ? 'df_target_amount' : 'div_stock_budget')} <strong>{summary.actionCheck.budgetMinor === undefined ? '—' : amountVisible ? price(summary.actionCheck.budgetMinor) : '••••'}</strong></span>
      <span>{summary.actionCheck.shares === null ? t('div_check_reason_holding_unknown') : t('div_home_held_shares', { shares: quantity(summary.actionCheck.shares) })}</span></div>
    <dl className="div-compact-targets">{(['buy', 'sell'] as const).map(side => <div key={side}><dt>{t(summary.kind === 'fund' ? side === 'buy' ? 'div_read_fund_entry' : 'div_read_fund_exit' : `div_read_next_${side}`)}</dt>
      <dd>{target(side)}</dd></div>)}</dl>
    <DividendCheckStatus summary={summary} mode="row">{children}</DividendCheckStatus>
  </div>;
}
