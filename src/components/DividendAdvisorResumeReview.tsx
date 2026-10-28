import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { DividendResearchSnapshot, DividendStockResearch } from '../lib/dividendResearch';
import { assertDividendResumeReviewCurrent, reviewDividendResume, type DividendResumeReview } from '../services/dividendResumeReviewService';
import DividendAdvisorPlanActions from './DividendAdvisorPlanActions';
import './DividendReviewAlerts.css';

export default function DividendAdvisorResumeReview({ stock, disabled, onUpdated, onResearchUpdated }: {
  stock: Pick<DividendStockResearch, 'code' | 'name'>; disabled: boolean; onUpdated: () => Promise<unknown>;
  onResearchUpdated?: (snapshot: DividendResearchSnapshot) => Promise<unknown> | void;
}) {
  const { t, i18n } = useTranslation();
  const [review, setReview] = useState<DividendResumeReview | null>(null);
  const [busy, setBusy] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState('');
  const mounted = useRef(true), lock = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const execute = async () => {
    if (disabled || lock.current) return;
    lock.current = true; setBusy(true); setError(''); setReview(null); setAcknowledged(false);
    try {
      const result = await reviewDividendResume(stock);
      await onResearchUpdated?.(result.snapshot);
      if (mounted.current) setReview(result);
    } catch (cause) {
      if (mounted.current) { setReview(null); setError(t(cause instanceof Error && cause.message === 'DIVIDEND_REVIEW_CHANGED' ? 'div_v2_review_changed' : 'div_v2_review_error')); }
    } finally { lock.current = false; if (mounted.current) setBusy(false); }
  };
  return <section className="div-ai-financial-review div-review-refresh-card">
    <h4>{t('div_check_resume_title')}</h4>
    <div className="div-review-toolbar"><p className="div-review-caption">{review ? t('div_v4_review_time', { date: new Date(review.reviewedAt).toLocaleString(i18n.language) }) : t('div_check_resume_intro')}</p>
      <button type="button" className="btn btn-secondary" disabled={disabled || busy} onClick={() => void execute()}>{t(busy ? 'div_v2_review_loading' : 'div_v4_refresh')}</button></div>
    {error && <p className="div-warning" role="alert">{error}</p>}
    {review?.proposal && <><p className="div-ai-muted">{t('div_check_resume_updated')}</p>
      <label className="div-review-acknowledgement"><input type="checkbox" checked={acknowledged} disabled={disabled || busy} onChange={event => setAcknowledged(event.target.checked)} />{t('div_v3_review_acknowledge')}</label>
      <DividendAdvisorPlanActions proposals={[{ ...review.proposal, reason: t('div_v4_resume_reason') }]} disabled={disabled || busy || !acknowledged} onUpdated={onUpdated}
        beforePreview={() => assertDividendResumeReviewCurrent(review)} beforeApply={() => assertDividendResumeReviewCurrent(review)} embedded previewLabel={t('div_v2_review_preview')} />
    </>}
    {review && !review.proposal && <p className="div-review-active">{t('div_v3_review_active')}</p>}
  </section>;
}
