import { useTranslation } from 'react-i18next';
import type { DividendStockCheckSummary } from '../lib/dividendCheckSummary';
import { dividendPricingPlanChange, dividendPricingPlanForCheck } from '../lib/dividendPricingPlan';
import type { DividendStock } from '../lib/dividendWorkbench';
import type { DividendPricingResult } from '../lib/dividendPricing';

export default function DividendPricingUpdate({ pricing, check, savedStock, amountVisible, outdated, disabled, onOpen, onRetry }: {
  pricing?: DividendPricingResult; check?: DividendStockCheckSummary; savedStock?: DividendStock; amountVisible: boolean; outdated: boolean; disabled: boolean;
  onOpen: () => void; onRetry: () => void;
}) {
  const { t, i18n } = useTranslation();
  if (!amountVisible) return null;
  const plan = !outdated && pricing && check ? dividendPricingPlanForCheck(pricing, check.currentPlan) : null;
  const change = plan ? dividendPricingPlanChange(plan, savedStock) : null;
  const status = change?.status === 'same' && check?.grid.status !== 'verified' ? 'basis' : change?.status ?? 'waiting';
  const price = (minor?: number) => minor === undefined ? '—' : `¥${(minor / 100).toLocaleString(i18n.language, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return <section className={`div-price-update is-${status}`} aria-label={t('div_price_update_title')}>
    <strong role="status">{t(`div_price_update_${status}`)}</strong>
    {change?.status === 'changed' && change.firstChange && <p>{t('div_price_update_difference', {
      side: t(change.firstChange.side === 'buy' ? 'div_check_buy' : 'div_check_sell'), level: change.firstChange.index,
      before: price(change.firstChange.previousPriceMinor), after: price(change.firstChange.priceMinor),
    })}</p>}
    {change?.status === 'unsaved' && <p>{t('div_price_update_first', { price: price(change.firstBuyPriceMinor) })}</p>}
    <button type="button" className={`btn ${status === 'changed' || status === 'unsaved' ? 'btn-primary' : 'btn-secondary'}`} disabled={disabled}
      onClick={plan ? onOpen : onRetry}>{t(!plan ? 'div_price_update_retry' : status === 'same' ? 'div_price_update_view' : 'div_price_update_review')}</button>
  </section>;
}
