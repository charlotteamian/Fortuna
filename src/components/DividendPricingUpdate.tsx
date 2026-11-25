import { useTranslation } from 'react-i18next';
import { dividendCheckReasonLabel } from '../lib/dividendCheckLabels';
import type { DividendStockCheckSummary } from '../lib/dividendCheckSummary';
import { dividendPricingPlanChange, dividendPricingPlanForCheck } from '../lib/dividendPricingPlan';
import type { DividendStock } from '../lib/dividendWorkbench';
import type { DividendPricingResult } from '../lib/dividendPricing';

export default function DividendPricingUpdate({
  pricing,
  check,
  savedStock,
  amountVisible,
  outdated,
  disabled,
  autoReviewing = false,
  failureReasons,
  onOpen,
  onRetry,
}: {
  pricing?: DividendPricingResult;
  check?: DividendStockCheckSummary;
  savedStock?: DividendStock;
  amountVisible: boolean;
  outdated: boolean;
  disabled: boolean;
  autoReviewing?: boolean;
  failureReasons?: string[];
  onOpen: () => void;
  onRetry: () => void;
}) {
  const { t, i18n } = useTranslation();
  if (!amountVisible || savedStock?.priceMode === 'manual') return null;
  const plan = !outdated && pricing && check ? dividendPricingPlanForCheck(pricing, check.currentPlan) : null;
  const change = plan ? dividendPricingPlanChange(plan, savedStock) : null;

  // When the newly calculated verified grid matches the saved plan identically
  // (prices, yields and portions), suppress any "needs plan update" prompt.
  if (change?.status === 'same') return null;

  if (!plan && autoReviewing) {
    return (
      <section className="div-price-update is-reviewing" aria-label={t('div_price_update_title')}>
        <span role="status">{t('div_auto_review_stock_running')}</span>
      </section>
    );
  }

  const status = change?.status ?? 'waiting';
  const price = (minor?: number) => minor === undefined ? '—' : `¥${(minor / 100).toLocaleString(i18n.language, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const failureText = !plan && failureReasons?.length && check
    ? [...new Set(failureReasons.map(reason => dividendCheckReasonLabel(reason, check.eligibility, t, key => i18n.exists(key))))].join(i18n.language.startsWith('zh') ? '；' : '; ')
    : '';
  return <section className={`div-price-update is-${status}`} aria-label={t('div_price_update_title')}>
    <strong role="status">{t(`div_price_update_${status}`)}</strong>
    {failureText && <p className="div-ai-muted">{t('div_auto_review_stock_failed', { reasons: failureText })}</p>}
    {change?.status === 'changed' && change.firstChange && <p>{t('div_price_update_difference', {
      side: t(change.firstChange.side === 'buy' ? 'div_check_buy' : 'div_check_sell'), level: change.firstChange.index,
      before: price(change.firstChange.previousPriceMinor), after: price(change.firstChange.priceMinor),
    })}</p>}
    {change?.status === 'unsaved' && <p>{t('div_price_update_first', { price: price(change.firstBuyPriceMinor) })}</p>}
    <button type="button" className={`btn ${status === 'changed' || status === 'unsaved' ? 'btn-primary' : 'btn-secondary'}`} disabled={disabled}
      onClick={plan ? onOpen : onRetry}>{t(!plan ? 'div_price_update_retry' : 'div_price_update_review')}</button>
  </section>;
}
