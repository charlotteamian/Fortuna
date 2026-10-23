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
  const { t } = useTranslation();
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
      if (mounted.current) setReview(result);
      await onResearchUpdated?.(result.snapshot);
    } catch (cause) {
      if (mounted.current) setError(t(cause instanceof Error && cause.message === 'DIVIDEND_REVIEW_CHANGED' ? 'div_v2_review_changed' : 'div_v2_review_error'));
    } finally { lock.current = false; if (mounted.current) setBusy(false); }
  };
  const evidence = review?.snapshot.stocks.find(value => value.code === stock.code);
  const yuan = (value?: number) => value === undefined ? '—' : `¥${(value / 100).toFixed(2)}`;
  const riskChecks = evidence?.checks.filter(check => check.status === 'risk') ?? [];
  const missingChecks = evidence?.checks.filter(check => check.status === 'unknown') ?? [];
  const passChecks = evidence?.checks.filter(check => check.status === 'pass') ?? [];
  const riskCount = riskChecks.length + (review?.advice.pricingRiskReasons.length ?? 0);
  const missingCount = missingChecks.length + (review?.advice.pricingMissingReasons.length ?? 0) + (review?.advice.additionalRulesUnverified ? 1 : 0);
  const technicalItems = evidence && review ? [{ name: stock.name, technical: evidence.technical }, ...review.snapshot.indices.filter(index => index.code !== 'sz399006')] : [];
  const technicalRisks = technicalItems.filter(item => item.technical?.currentUsable && item.technical.pacing !== 'observe');
  const technicalMissing = technicalItems.filter(item => !item.technical?.currentUsable);
  return <details className="div-ai-financial-review" open={!!review || busy}><summary>{t('div_v2_review_title')}</summary>
    <p className="div-ai-muted">{t('div_v2_review_intro')}</p>
    <button type="button" className="btn btn-secondary" disabled={disabled || busy} onClick={() => void execute()}>{t(busy ? 'div_v2_review_loading' : 'div_v2_review_run')}</button>
    {error && <p className="div-warning" role="alert">{error}</p>}
    {review && evidence && <div className="div-ai-review-results"><p>{t('div_v2_review_asof', { date: new Date(review.reviewedAt).toLocaleString() })}</p>
      <h4>{t('div_v2_review_operations')}</h4>
      <p className="div-ai-muted">{t('div_v2_review_evidence_scope')}</p>
      {riskCount > 0 && <section className="div-review-alert risk"><strong>{t('div_v3_review_risks', { count: riskCount })}</strong><ul>
        {riskChecks.map(check => <li key={check.rule}>{t(`div_ai_rule_label_${check.rule}`)}{check.period && ` · ${check.period}`}</li>)}
        {review.advice.pricingRiskReasons.map(reason => <li key={reason}>{t(`div_v2_pricing_gap_${reason}`)}</li>)}
      </ul></section>}
      {missingCount > 0 && <section className="div-review-alert unknown"><strong>{t('div_v3_review_missing', { count: missingCount })}</strong><ul>
        {missingChecks.map(check => <li key={check.rule}>{t(`div_ai_rule_label_${check.rule}`)}{check.period && ` · ${check.period}`}</li>)}
        {review.advice.pricingMissingReasons.map(reason => <li key={reason}>{t(`div_v2_pricing_gap_${reason}`)}</li>)}
        {review.advice.additionalRulesUnverified && <li>{t('div_ai_conclusion_additional_rules')}</li>}
      </ul></section>}
      {!riskCount && !missingCount && <p className="div-advisor-status">{t('div_v3_review_clear')}</p>}
      {passChecks.length > 0 && <details><summary>{t('div_v3_review_passed', { count: passChecks.length })}</summary>
        <ul>{passChecks.map(check => <li key={check.rule}>{t(`div_ai_rule_label_${check.rule}`)}{check.period && ` · ${check.period}`}</li>)}</ul></details>}
      <h4>{t('div_v2_review_price')} · <span className={`div-review-price ${review.priceState}`}>{t(`div_v3_review_price_${review.priceState}`, { levels: review.triggeredBuyLevels.join('、') })}</span></h4>
      <p>{t('div_v3_review_saved_grid')}</p>
      <p>{t('div_v3_review_saved_first', { price: yuan(review.savedBuyPricesMinor[0]), current: yuan(review.advice.currentPriceMinor), date: evidence.pricing?.priceDate ?? '—' })}</p>
      <p className="div-ai-muted">{t('div_v3_review_margin_reference', { margin: yuan(review.advice.marginPriceMinor) })}</p>
      <h4>{t('div_v2_review_technical')}</h4>
      <div className="div-review-badges">
        {technicalRisks.length > 0 && <span className="div-ai-status risk">{t('div_v3_review_risks', { count: technicalRisks.length })}</span>}
        {technicalMissing.length > 0 && <span className="div-ai-status unknown">{t('div_v3_review_missing', { count: technicalMissing.length })}</span>}
      </div>
      {review.advice.marketMissing && <p className="div-review-alert unknown">{t('div_ai_conclusion_market_missing')}</p>}
      <ul>{technicalItems.map((item, index) => <li key={index}>
        {item.name} · {item.technical?.currentUsable ? t(`div_ai_trend_${item.technical.state === 'rising' ? 'up' : item.technical.state === 'range' ? 'sideways' : item.technical.state === 'falling' ? 'down' : 'accelerating_down'}`) : t('div_ai_trend_unknown')} · {item.technical?.asOf ?? '—'}
        {item.technical && <small> · {t('div_v2_review_trend_result', { change: item.technical.change5Percent.toFixed(2), slope: item.technical.ma30SlopePercent.toFixed(2) })}</small>}
      </li>)}</ul>
      <p className="div-review-policy">{t('div_v3_review_advisory')}</p>
      {review.proposal ? <><label className="div-review-acknowledgement"><input type="checkbox" checked={acknowledged} disabled={disabled || busy} onChange={event => setAcknowledged(event.target.checked)} />{t('div_v3_review_acknowledge')}</label>
        <DividendAdvisorPlanActions proposals={[{ ...review.proposal, reason: t('div_v2_review_resume_reason') }]} disabled={disabled || busy || !acknowledged} onUpdated={onUpdated}
          beforePreview={() => assertDividendResumeReviewCurrent(review)} beforeApply={() => assertDividendResumeReviewCurrent(review)} initiallyExpanded previewLabel={t('div_v2_review_preview')} /></>
        : <p className="div-advisor-status">{t('div_v3_review_active')}</p>}
    </div>}
  </details>;
}
