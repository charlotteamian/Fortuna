import { useTranslation } from 'react-i18next';
import type { DividendStock } from '../lib/dividendWorkbench.ts';
import { reviewDividendGrid, type DividendGridBasisCheck } from '../lib/dividendGridProvenance.ts';
import { DIVIDEND_PRICING_CALCULATION_VERSION } from '../lib/dividendPricing.ts';

export default function DividendGridOrigin({ stock, basis, asOf, taxBps }: { stock: DividendStock; basis?: DividendGridBasisCheck; asOf: string; taxBps?: number }) {
  const { t } = useTranslation();
  const review = reviewDividendGrid(stock, basis, { asOf, parameterVersion: DIVIDEND_PRICING_CALCULATION_VERSION, basisKind: 'recent_batches', taxBps });
  if (!review.hasSavedGrid) return null;
  const origin = stock.gridProvenance;
  return <div className="div-grid-origin">
    {review.basisState === 'saved_unverified' && <p className="div-warning">{t('div_grid_basis_pending')}</p>}
    {review.stale && <p className="div-warning">{t('div_grid_basis_stale')} {review.staleReasons.map(reason => t(`div_batch_stale_${reason}`)).join('；')}</p>}
    {review.marketDeviation && <p className="div-warning">{t('div_grid_market_deviation')}</p>}
    {origin ? <p className="div-ai-muted">{t('div_grid_origin_generated', { date: review.generatedDate })} · {t('div_grid_origin_base', { amount: origin.grossDpsMicros / 1e6 })} · {t('div_grid_origin_tax', { percent: origin.taxBps / 100 })} · {t('div_grid_origin_version', { version: origin.parameterVersion })}</p>
      : <p className="div-ai-muted">{t('div_grid_origin_missing')}</p>}
  </div>;
}
