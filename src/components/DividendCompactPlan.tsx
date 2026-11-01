import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { DividendCheckSummary } from '../lib/dividendCheckSummary';
import DividendCheckStatus from './DividendCheckStatus';

/** Only presents stage 1.1's original tier, cumulative target and independent price observation. */
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
    if (summary.kind === 'fund') return <>{price(undefined, side === 'buy' ? summary.grid.entryPriceMicros : summary.grid.exitPriceMicros)}</>;
    return <>{tier && <span>{t('div_read_original_tier', { level: tier.index })} · {price(tier.priceMinor, tier.priceMicros)}</span>}
      {tier?.basis === 'price_reference' ? <small>{t('div_read_price_reference')}</small> : <>
        {tier?.basis === 'cumulative_target' && <small>{t(side === 'buy' ? 'div_read_target_shares' : 'div_read_sell_shares', { shares: (side === 'buy' ? tier.targetShares : tier.sellShares) === undefined ? '—' : quantity((side === 'buy' ? tier.targetShares : tier.sellShares)!) })}</small>}
        {state !== 'pending' && <small>{t(`div_read_next_${state}`)}</small>}
      </>}</>;
  };
  return <div className="div-compact-plan">
    <div className="div-compact-quote"><strong>{price(quote.priceMinor, quote.priceMicros ?? manualFundPrice)}</strong><span>{t(manualFundPrice !== undefined ? 'div_check_manual_price_label' : quote.status === 'current' ? 'div_read_quote_current' : 'div_read_quote_reference')}
      <small>{quote.date ? t('div_read_quote_source', { source: source ?? t('div_read_market_source'), date: quote.date }) : source ?? t('div_check_quote_unknown')}</small></span></div>
    <div className="div-home-plan-budget"><span>{t(summary.kind === 'fund' ? 'df_target_amount' : 'div_stock_budget')} <strong>{summary.actionCheck.budgetMinor === undefined ? '—' : amountVisible ? price(summary.actionCheck.budgetMinor) : '••••'}</strong></span>
      <span>{summary.actionCheck.shares === null ? t('div_check_reason_holding_unknown') : t('div_home_held_shares', { shares: quantity(summary.actionCheck.shares) })}</span></div>
    <dl className="div-compact-targets">{(['buy', 'sell'] as const).map(side => <div key={side}><dt>{t(summary.kind === 'fund' ? side === 'buy' ? 'div_read_fund_entry' : 'div_read_fund_exit' : `div_read_next_${side}`)}</dt>
      <dd>{target(side)}{summary.kind === 'stock' && summary.trigger[`${side}Levels`].length > 0 && <small className="div-compact-touch">{t('div_read_deepest_touch', { level: Math.max(...summary.trigger[`${side}Levels`]) })}
        {summary.grid[side === 'buy' ? 'nextBuy' : 'nextSell']?.basis !== 'price_reference' && (side === 'buy' ? summary.actionCheck.additionalBuyShares : summary.actionCheck.sellShares) !== undefined && t(side === 'buy' ? 'div_read_buy_difference' : 'div_read_sell_difference', { shares: quantity((side === 'buy' ? summary.actionCheck.additionalBuyShares : summary.actionCheck.sellShares)!) })}</small>}</dd></div>)}</dl>
    <DividendCheckStatus summary={summary} mode="row">{children}</DividendCheckStatus>
  </div>;
}
