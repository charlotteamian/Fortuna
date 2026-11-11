import { useTranslation } from 'react-i18next';
import type { DividendCheckSummary } from '../lib/dividendCheckSummary';
import type { DividendPricingResult } from '../lib/dividendPricing';
import { dividendPricingGuide } from '../lib/dividendPricingGuide';
import './DividendPricingGuide.css';

export default function DividendPricingGuide({ pricing, check, disabled = false, onRetry, onFill }: {
  pricing: DividendPricingResult; check?: DividendCheckSummary; disabled?: boolean; onRetry?: () => void; onFill?: () => void;
}) {
  const { t } = useTranslation();
  const guide = dividendPricingGuide(pricing, check);
  if (guide.status === 'ready') return null;
  const canFill = guide.gaps.some(gap => ['cash', 'frequency', 'conflict'].includes(gap.kind));
  return <section className={`div-price-guide is-${guide.status}`} aria-label={t('div_price_guide_title')}>
    <strong>{t(`div_price_guide_${guide.status}`)}</strong>
    {guide.gaps.map(gap => <p className="div-price-guide-gap" key={gap.kind}>{t(`div_price_guide_gap_${gap.kind}`)}</p>)}
    {onRetry && <button type="button" className="btn btn-primary" disabled={disabled} onClick={onRetry}>{t('div_price_guide_retry')}</button>}
    {canFill && onFill && <button type="button" className="btn btn-secondary" disabled={disabled} onClick={onFill}>{t('div_manual_open')}</button>}
  </section>;
}
