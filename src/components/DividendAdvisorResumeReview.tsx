import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { DividendResearchSnapshot, DividendStockResearch } from '../lib/dividendResearch';
import { dividendReviewSummary } from '../lib/dividendReviewSummary';
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
      if (mounted.current) setReview(result);
      await onResearchUpdated?.(result.snapshot);
    } catch (cause) {
      if (mounted.current) setError(t(cause instanceof Error && cause.message === 'DIVIDEND_REVIEW_CHANGED' ? 'div_v2_review_changed' : 'div_v2_review_error'));
    } finally { lock.current = false; if (mounted.current) setBusy(false); }
  };
  const evidence = review?.snapshot.stocks.find(value => value.code === stock.code);
  const summary = review && evidence ? dividendReviewSummary(evidence, review.advice) : null;
  const yuan = (value?: number) => value === undefined ? '—' : `¥${(value / 100).toFixed(2)}`;
  const technicalItems = evidence && review ? [{ name: stock.name, technical: evidence.technical }, ...review.snapshot.indices.filter(index => index.code !== 'sz399006')] : [];
  const pricingIssues = [...new Set([...(evidence?.pricing?.blockers ?? []), ...(evidence?.pricing?.pauseReasons ?? []), ...(evidence?.pricing?.warnings ?? [])])];
  return <details className="div-ai-financial-review div-review-refresh-card" open={!!review || busy}><summary>{t('div_v2_review_title')}</summary>
    <div className="div-review-toolbar"><p className="div-review-caption">{review ? t('div_v4_review_time', { date: new Date(review.reviewedAt).toLocaleString(i18n.language) }) : t('div_v4_review_intro')}</p>
      <button type="button" className="btn btn-secondary" disabled={disabled || busy} onClick={() => void execute()}>{t(busy ? 'div_v2_review_loading' : 'div_v4_refresh')}</button></div>
    {error && <p className="div-warning" role="alert">{error}</p>}
    {review && evidence && summary && <div className="div-ai-review-results">
      <div className="div-review-result-line"><strong className={`div-review-price-state ${review.priceState}`}>{t(`div_v3_review_price_${review.priceState}`, { levels: review.triggeredBuyLevels.join('、') })}</strong>
        <span className="div-review-count risk">{t('div_v4_risk_count', { count: summary.risks.length })}</span><span className="div-review-count unknown">{t('div_v4_missing_count', { count: summary.missing.length })}</span></div>
      <details className="div-review-detail"><summary>{t('div_v4_detail_operations')}</summary>
        <div className="div-review-check-list">{evidence.checks.map(check => <div className="div-review-check-row" key={check.rule}>
          <strong>{t(`div_ai_rule_label_${check.rule}`)}</strong><span className={`div-ai-status ${check.status}`}>{t(`div_ai_research_${check.status}`)}</span>
          <small>{[check.period, check.value !== undefined && check.threshold !== undefined ? t('div_v4_rule_result', { value: check.rule === 'dividendYears' ? check.value : `${check.value / 100}%`, threshold: check.rule === 'dividendYears' ? check.threshold : `${check.threshold / 100}%` }) : '', check.reason ? t(`div_ai_reason_${check.reason}`) : ''].filter(Boolean).join(' · ')}</small>
        </div>)}</div>
        {!evidence.checks.length && <p className="div-review-caption">{t('div_v4_review_empty')}</p>}
        {pricingIssues.length > 0 && <ul className="div-review-evidence-notes">{pricingIssues.map(issue => <li key={issue}>{t(`div_v2_pricing_gap_${issue}`)}</li>)}</ul>}
        {review.advice.additionalRulesUnverified && <p className="div-review-caption">{t('div_ai_conclusion_additional_rules')}</p>}
      </details>
      <details className="div-review-detail"><summary>{t('div_v4_detail_technical')}</summary>
        <div className="div-review-check-list">{technicalItems.map((item, index) => <div className="div-review-check-row" key={index}>
          <strong>{item.name}</strong><span className={`div-ai-status ${!item.technical?.currentUsable ? 'unknown' : item.technical.pacing === 'observe' ? 'pass' : 'risk'}`}>{item.technical?.currentUsable ? t(`div_ai_trend_${item.technical.state === 'rising' ? 'up' : item.technical.state === 'range' ? 'sideways' : item.technical.state === 'falling' ? 'down' : 'accelerating_down'}`) : t('div_ai_trend_unknown')}</span>
          <small>{item.technical?.asOf ?? '—'}{item.technical && ` · ${t('div_v2_review_trend_result', { change: item.technical.change5Percent.toFixed(2), slope: item.technical.ma30SlopePercent.toFixed(2) })}`}</small>
        </div>)}</div>
        {review.advice.marketMissing && <p className="div-review-caption">{t('div_ai_conclusion_market_missing')}</p>}
      </details>
      <details className="div-review-detail"><summary>{t('div_v4_detail_method')}</summary>
        <dl className="div-review-reference"><div><dt>{t('div_v4_price_current')}</dt><dd>{yuan(review.advice.currentPriceMinor)} · {review.advice.currentPriceDate ?? '—'}</dd></div>
          <div><dt>{t('div_v4_saved_grid')}</dt><dd>{review.savedBuyPricesMinor.map(yuan).join(' / ')}</dd></div>
          <div><dt>{t('div_v4_price_margin')}</dt><dd>{yuan(review.advice.marginPriceMinor)}</dd></div></dl>
        <p className="div-review-caption">{t('div_v3_review_saved_grid')}</p><p className="div-review-caption">{t('div_v2_review_evidence_scope')}</p>
      </details>
      {review.proposal ? <><label className="div-review-acknowledgement"><input type="checkbox" checked={acknowledged} disabled={disabled || busy} onChange={event => setAcknowledged(event.target.checked)} />{t('div_v3_review_acknowledge')}</label>
        <DividendAdvisorPlanActions proposals={[{ ...review.proposal, reason: t('div_v4_resume_reason') }]} disabled={disabled || busy || !acknowledged} onUpdated={onUpdated}
          beforePreview={() => assertDividendResumeReviewCurrent(review)} beforeApply={() => assertDividendResumeReviewCurrent(review)} initiallyExpanded previewLabel={t('div_v2_review_preview')} /></>
        : <p className="div-review-active">{t('div_v3_review_active')}</p>}
    </div>}
  </details>;
}
