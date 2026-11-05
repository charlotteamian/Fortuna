import { useTranslation } from 'react-i18next';
import type { DividendCheckSummary } from '../lib/dividendCheckSummary';
import type { DividendPricingResult } from '../lib/dividendPricing';
import { dividendPricingGuide } from '../lib/dividendPricingGuide';
import './DividendPricingGuide.css';

export default function DividendPricingGuide({ pricing, check, disabled = false, onRetry }: {
  pricing: DividendPricingResult; check?: DividendCheckSummary; disabled?: boolean; onRetry?: () => void;
}) {
  const { t, i18n } = useTranslation();
  const guide = dividendPricingGuide(pricing, check);
  const cash = (micros?: number) => micros === undefined ? '—' : (micros / 1e6).toLocaleString(i18n.language, { maximumFractionDigits: 6 });
  return <section className={`div-price-guide is-${guide.status}`} aria-label={t('div_price_guide_title')}>
    <strong>{t(`div_price_guide_${guide.status}`)}</strong>
    {guide.gaps.map(gap => <p className="div-price-guide-gap" key={gap.kind}>{t(`div_price_guide_gap_${gap.kind}`)}</p>)}
    {onRetry && <div className="div-price-guide-recovery"><button type="button" className="btn btn-secondary" disabled={disabled} onClick={onRetry}>{t('div_price_guide_retry')}</button>
      <p>{t('div_price_guide_retry_note')}</p></div>}
    {(guide.status !== 'ready' || guide.gaps.length > 0) && <details><summary>{t('div_price_guide_title')}</summary>
      <ol className="div-price-guide-steps"><li><strong>{t('div_price_guide_base')}</strong>
        <p>{guide.grossDpsMicros === undefined ? t('div_price_guide_base_waiting') : t('div_price_guide_base_value', { gross: cash(guide.grossDpsMicros), frequency: t(`div_price_guide_${guide.frequency}`) })}</p>
        {guide.periods.length > 0 && <small>{t('div_price_guide_periods', { periods: guide.periods.join(' / ') })}</small>}</li>
        <li><strong>{t('div_price_guide_tax')}</strong><p>{guide.netDpsMicros === undefined ? t('div_price_guide_tax_waiting', { tax: guide.taxBps / 100 })
          : t('div_price_guide_tax_value', { gross: cash(guide.grossDpsMicros), tax: guide.taxBps / 100, net: cash(guide.netDpsMicros) })}</p></li>
        <li><strong>{t('div_price_guide_formula')}</strong><p>{guide.exampleBuyPriceMinor === undefined ? t('div_price_guide_formula_waiting')
          : t('div_price_guide_formula_value', { net: cash(guide.netDpsMicros), price: `¥${(guide.exampleBuyPriceMinor / 100).toFixed(2)}` })}</p><small>{t('div_price_guide_rounding')}</small></li></ol>
      {guide.advisoryCount > 0 && <p>{t('div_price_guide_advisory', { count: guide.advisoryCount })}</p>}
      <p>{t('div_price_guide_save_note')}</p>
    </details>}
  </section>;
}
