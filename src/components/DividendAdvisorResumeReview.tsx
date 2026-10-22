import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { DividendResearchSnapshot, DividendStockResearch } from '../lib/dividendResearch';
import { assertDividendResumeReviewCurrent, reviewDividendResume, type DividendResumeReview } from '../services/dividendResumeReviewService';
import DividendAdvisorPlanActions from './DividendAdvisorPlanActions';

export default function DividendAdvisorResumeReview({ stock, disabled, onUpdated, onResearchUpdated }: {
  stock: Pick<DividendStockResearch, 'code' | 'name'>; disabled: boolean; onUpdated: () => Promise<unknown>;
  onResearchUpdated?: (snapshot: DividendResearchSnapshot) => Promise<unknown> | void;
}) {
  const { t } = useTranslation();
  const [review, setReview] = useState<DividendResumeReview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const mounted = useRef(true), lock = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const execute = async () => {
    if (disabled || lock.current) return;
    lock.current = true; setBusy(true); setError(''); setReview(null);
    try {
      const result = await reviewDividendResume(stock);
      if (mounted.current) setReview(result);
      await onResearchUpdated?.(result.snapshot);
    } catch (cause) {
      if (mounted.current) setError(t(cause instanceof Error && cause.message === 'DIVIDEND_REVIEW_CHANGED' ? 'div_v2_review_changed' : 'div_v2_review_error'));
    } finally { lock.current = false; if (mounted.current) setBusy(false); }
  };
  const evidence = review?.snapshot.stocks.find(value => value.code === stock.code);
  const yuan = (value?: number) => value === undefined ? '—' : `¥${(value / 100).toFixed(2)}`;
  return <details className="div-ai-financial-review" open={!!review || busy}><summary>{t('div_v2_review_title')}</summary>
    <p className="div-ai-muted">{t('div_v2_review_intro')}</p>
    <button type="button" className="btn btn-secondary" disabled={disabled || busy} onClick={() => void execute()}>{t(busy ? 'div_v2_review_loading' : 'div_v2_review_run')}</button>
    {error && <p className="div-warning" role="alert">{error}</p>}
    {review && evidence && <div className="div-ai-review-results"><p>{t('div_v2_review_asof', { date: new Date(review.reviewedAt).toLocaleString() })}</p>
      <h4>{t('div_v2_review_operations')} · {t(review.operationsPass ? 'div_ai_research_pass' : 'div_v2_review_blocked')}</h4>
      <p>{t('div_v2_review_operations_method')}</p><p className="div-ai-muted">{t('div_v2_review_evidence_scope')}</p>
      <ul>{evidence.checks.map(check => <li key={check.rule}>{t(`div_ai_rule_label_${check.rule}`)} · {t(`div_ai_research_${check.status}`)}{check.period && ` · ${check.period}`}</li>)}</ul>
      {review.advice.additionalRulesUnverified && <p className="div-warning">{t('div_ai_conclusion_additional_rules')}</p>}
      {[...review.advice.pricingBlockers, ...review.advice.pricingPauseReasons].map(reason => <p className="div-warning" key={reason}>{t(`div_v2_pricing_gap_${reason}`)}</p>)}
      <h4>{t('div_v2_review_price')} · {t(review.pricePass ? 'div_ai_research_pass' : 'div_v2_review_blocked')}</h4><p>{t('div_v2_review_price_method')}</p>
      <p>{t('div_v2_review_price_result', { price: yuan(review.advice.currentPriceMinor), margin: yuan(review.advice.marginPriceMinor), date: evidence.pricing?.priceDate ?? '—' })}</p>
      <h4>{t('div_v2_review_technical')} · {t(review.technicalPass ? 'div_ai_research_pass' : 'div_v2_review_blocked')}</h4><p>{t('div_v2_review_technical_method')}</p>
      <ul>{[{ name: stock.name, technical: evidence.technical }, ...review.snapshot.indices.filter(index => index.code !== 'sz399006')].map((item, index) => <li key={index}>
        {item.name} · {item.technical?.currentUsable ? t(`div_ai_trend_${item.technical.state === 'rising' ? 'up' : item.technical.state === 'range' ? 'sideways' : item.technical.state === 'falling' ? 'down' : 'accelerating_down'}`) : t('div_ai_trend_unknown')} · {item.technical?.asOf ?? '—'}
        {item.technical && <small> · {t('div_v2_review_trend_result', { change: item.technical.change5Percent.toFixed(2), slope: item.technical.ma30SlopePercent.toFixed(2) })}</small>}
      </li>)}</ul>
      <p className={review.proposal ? 'div-advisor-status' : 'div-warning'}>{t(review.proposal ? 'div_v2_review_ready' : 'div_v2_review_keep_paused')}</p>
      {review.proposal && <DividendAdvisorPlanActions proposals={[{ ...review.proposal, reason: t('div_v2_review_resume_reason') }]} disabled={disabled || busy} onUpdated={onUpdated}
        beforePreview={() => assertDividendResumeReviewCurrent(review)} beforeApply={() => assertDividendResumeReviewCurrent(review)} initiallyExpanded previewLabel={t('div_v2_review_preview')} />}
    </div>}
  </details>;
}
