import { useTranslation } from 'react-i18next';
import type { DividendReviewSummary as ReviewSummary } from '../lib/dividendReviewSummary';
import './DividendReviewAlerts.css';

export default function DividendReviewSummary({ summary }: { summary: ReviewSummary }) {
  const { t } = useTranslation();
  const value = (amount: number, unit: 'percent' | 'years') => unit === 'years' ? String(amount) : `${Number((amount / 100).toFixed(2))}%`;
  return <div className="div-review-summary" aria-label={t('div_v4_alert_overview')}>
    {([{ status: 'risk', items: summary.risks }, { status: 'unknown', items: summary.missing }] as const).map(group => <section className={`div-review-summary-group ${group.status}`} key={group.status}>
      <strong>{t(group.status === 'risk' ? 'div_v4_risk_count' : 'div_v4_missing_count', { count: group.items.length })}</strong>
      {group.items.length ? <ul>{group.items.map(item => <li key={item.topic}>{t(item.factKey ?? item.labelKey)}{item.comparison && <span className="div-review-comparison"> {value(item.comparison.value, item.comparison.unit)} {item.comparison.direction === 'below' ? '<' : '>'} {value(item.comparison.threshold, item.comparison.unit)}</span>}</li>)}</ul> : <span className="div-review-empty">{t(group.status === 'risk' ? 'div_v4_no_risks' : 'div_v4_no_missing')}</span>}
    </section>)}
  </div>;
}

export function DividendReviewPrice({ currentPriceMinor, firstBuyPriceMinor, priceDate, triggeredBuyLevels, priceState, saved = true }: {
  currentPriceMinor?: number; firstBuyPriceMinor?: number; priceDate?: string; triggeredBuyLevels: number[];
  priceState: 'triggered' | 'waiting' | 'unknown'; saved?: boolean;
}) {
  const { t } = useTranslation();
  const yuan = (value?: number) => value === undefined ? '—' : `¥${(value / 100).toFixed(2)}`;
  return <div className="div-review-price-overview">
    <div className="div-review-price-heading"><strong className={`div-review-price-state ${priceState}`}>{t(`div_v3_review_price_${priceState}`, { levels: triggeredBuyLevels.join('、') })}</strong>
      <span>{t(saved ? 'div_v4_price_saved' : 'div_v4_price_candidate')}</span></div>
    <dl className="div-review-price-values"><div><dt>{t('div_v4_price_current')}</dt><dd>{yuan(currentPriceMinor)}</dd></div>
      <div><dt>{t('div_v4_price_first')}</dt><dd>{yuan(firstBuyPriceMinor)}</dd></div></dl>
    {priceDate && <small className="div-review-caption">{t('div_v4_quote_date', { date: priceDate })}</small>}
  </div>;
}
