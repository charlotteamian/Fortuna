import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { dividendPricingMarketComparison, invalidateOutdatedDividendPricing, isDividendPricingMethod, type DividendPricingMethod, type DividendPricingResult, type DividendOpportunityResearch, type DividendPricingBlocker } from '../lib/dividendPricing';
import type { DividendPlanProposal } from '../lib/dividendAdvisorActions';
import type { DividendFinancialSectorReview } from '../lib/dividendResearch';
import type { DividendStock } from '../lib/dividendWorkbench';
import DividendAdvisorPlanActions from './DividendAdvisorPlanActions';
import { dividendPricingPlan, dividendPricingProvenance } from '../lib/dividendPricingPlan';
import { validateDividendPricingProposal } from '../services/dividendAdvisorActionsService';
import './DividendReviewAlerts.css';
import DividendLedgerView from './DividendLedgerView';

const GAP_HELP: Record<DividendPricingBlocker, string> = {
  dividend_ledger_missing: 'dividend', dividend_base_unverified: 'dividend', dividend_base_incomplete: 'dividend',
  dividend_source_conflict: 'dividend', dividend_frequency_unknown: 'dividend', dividend_crosscheck_mismatch: 'dividend',
  trailing_dividend_missing: 'dividend', trailing_dividend_invalid: 'dividend', trailing_dividend_stale: 'dividend',
  trailing_dividend_zero: 'dividend', cash_distributions_incomplete: 'dividend',
  annual_eps_missing: 'financials', annual_payout_missing: 'financials', non_positive_earnings: 'risk',
  payout_above_100: 'risk', fcf_missing: 'cashflow', fcf_below_150: 'cashflow', fcf_non_positive: 'cashflow', fcf_dividend_capped: 'cashflow', financial_sector_review: 'sector',
  treasury_missing: 'macro', treasury_stale: 'macro', yield_history_missing: 'history', capital_actions_unverified: 'history',
  opportunity_cost_missing: 'opportunity', opportunity_cost_stale: 'opportunity', anchors_conflict: 'anchors', anchors_missing: 'anchors', growth_return_conflict: 'method',
  quote_missing: 'price', roe_bps_missing: 'financials', cyclical_normalisation_required: 'normalisation', annual_stale: 'financials',
  dividend_continuity_missing: 'financials', implausible_yield: 'risk', pricing_calculation_stale: 'financials',
};

export function DividendFinancialReviewCard({ review, code }: { review: DividendFinancialSectorReview; code: string }) {
  const { t } = useTranslation();
  const pct = (value?: number) => value === undefined ? '—' : `${(value / 100).toFixed(2)}%`;
  const risks = review.metrics.filter(metric => metric.status === 'risk');
  const missing = review.metrics.filter(metric => metric.status === 'unknown');
  const passed = review.metrics.filter(metric => metric.status === 'pass');
  return <section className={`div-ai-financial-review ${review.status}`}>
    <h4>{t('div_ai_financial_review_title', { sector: t(`div_ai_financial_sector_${review.sector}`) })}{review.reportSupplement && ` · ${t('div_ai_financial_report_extract_short')}`}</h4>
    <div className="div-review-badges">{risks.length > 0 && <span className="div-ai-status risk">{t('div_v3_review_risks', { count: risks.length })}</span>}
      {(missing.length > 0 || review.missing.length > 0) && <span className="div-ai-status unknown">{t('div_v3_review_missing', { count: missing.length || review.missing.length })}</span>}
      {!risks.length && !missing.length && !review.missing.length && <span className="div-ai-status pass">{t('div_ai_research_pass')}</span>}</div>
    <p className="div-ai-muted">{t('div_ai_financial_auto_evidence', { date: review.asOf })}</p>
    <p className="div-ai-muted">{t(review.basis === 'dividend_screen' ? 'div_ai_financial_screen_basis' : 'div_ai_financial_regulatory_basis')}</p>
    {([{ status: 'risk', metrics: risks }, { status: 'unknown', metrics: missing }, { status: 'pass', metrics: passed }] as const).filter(group => group.metrics.length > 0).map(group => <section key={group.status} className={group.status === 'pass' ? '' : `div-review-alert ${group.status}`}>
      <strong>{t(group.status === 'risk' ? 'div_v3_review_risks' : group.status === 'unknown' ? 'div_v3_review_missing' : 'div_v3_review_passed', { count: group.metrics.length })}</strong>
      <ul className="div-ai-checks">{group.metrics.map(metric => <li key={metric.key}><div><strong>{t(`div_ai_financial_metric_${metric.key}`)}</strong></div>
      <p>{metric.thresholdBps === undefined ? t('div_ai_financial_metric_value_unverified', { value: pct(metric.valueBps) })
        : t('div_ai_financial_metric_value', { value: pct(metric.valueBps), direction: t(metric.direction === 'minimum' ? 'div_ai_at_least' : 'div_ai_at_most'), threshold: pct(metric.thresholdBps) })}</p><p>{t('div_ai_research_period', { period: metric.reportDate })}</p>
      {metric.basis && <p>{t(`div_ai_financial_basis_${metric.basis}`, { period: metric.comparisonReportDate ?? '—' })}</p>}
      {metric.capitalInputs && <p>{t('div_ai_financial_capital_inputs', { roe: pct(metric.capitalInputs.roeBps), payout: pct(metric.capitalInputs.payoutBps), growth: pct(metric.capitalInputs.rwaGrowthBps) })}</p>}
      {review.reportSupplement && ['comprehensiveSolvency', 'coreSolvency'].includes(metric.key) && <p>{t('div_ai_financial_report_metric_basis')}</p>}
      {metric.changeBps !== undefined && <p>{t('div_ai_financial_yoy_change', { value: `${metric.changeBps > 0 ? '+' : ''}${(metric.changeBps / 100).toFixed(2)}` })}</p>}
      {(metric.sourceUrls ?? []).filter(url => url.startsWith('https://')).length > 0 && <div className="div-ai-help-links">{metric.sourceUrls!.filter(url => url.startsWith('https://')).map((url, index) => <a key={url} href={url} target="_blank" rel="noopener noreferrer">{t('div_ai_financial_original_report_source', { index: index + 1 })}</a>)}</div>}
    </li>)}</ul></section>)}
    {review.missing.map(item => <p className="div-ai-muted" key={item}>{t(`div_ai_financial_missing_${item}`, { defaultValue: t('div_ai_financial_missing_other') })}</p>)}
    {review.sector === 'bank' && review.missing.some(item => ['specialMentionLoans', 'overdue90DaysDeviation', 'internalCapitalCapacity'].includes(item)) && <p className="div-ai-muted">{t('div_ai_financial_bank_evidence_gap')}</p>}
    {review.status !== 'pass' && <p className="div-ai-muted">{t(`div_ai_financial_help_${review.sector}`, { code })}</p>}
    {review.reportSupplement && <div className="div-ai-auto-summary"><strong>{t('div_ai_financial_report_extract')}</strong>
      <p>{t('div_ai_financial_report_dates', { report: review.reportSupplement.reportDate, published: review.reportSupplement.publishedAt, verified: review.reportSupplement.verifiedAt, pages: review.reportSupplement.pdfPages.join('、') })}</p>
      <p>{t('div_ai_financial_insurance_rating_not_applicable')}</p>
      <a href={`${review.reportSupplement.sourceUrl}#page=${review.reportSupplement.pdfPages[0]}`} target="_blank" rel="noopener noreferrer">{t('div_ai_financial_original_pdf')}</a>
    </div>}
    <div className="div-ai-help-links"><a href={review.sourceUrl} target="_blank" rel="noopener noreferrer">{t('div_ai_financial_review_source')}</a>
      <a href="https://www.cninfo.com.cn/new/index" target="_blank" rel="noopener noreferrer">{t('div_ai_open_company_reports')}</a>
      {review.policySourceUrls.map((url, index) => <a href={url} key={url} target="_blank" rel="noopener noreferrer">{t('div_ai_financial_policy_source', { index: index + 1 })}</a>)}
    </div>
  </section>;
}

function PricingGap({ blocker, code }: { blocker: DividendPricingBlocker; code: string }) {
  const { t } = useTranslation();
  const kind = GAP_HELP[blocker];
  const url = kind === 'opportunity' ? 'https://www.csindex.com.cn/#/indices/family/detail?indexCode=000922'
    : kind === 'macro' ? 'https://data.eastmoney.com/cjsj/zmgzsyl.html'
    : kind === 'normalisation' || kind === 'sector' || kind === 'cashflow' ? 'https://www.cninfo.com.cn/new/index'
    : `https://data.eastmoney.com/stockdata/${code}.html`;
  return <li><strong>{t(`div_v2_pricing_gap_${blocker}`)}</strong><p>{t(`div_v2_pricing_help_gap_${kind}`, { code })}</p>
    <a href={url} target="_blank" rel="noopener noreferrer">{t(kind === 'opportunity' ? 'div_v2_pricing_open_csi' : kind === 'macro' ? 'div_v2_pricing_open_treasury' : kind === 'normalisation' || kind === 'sector' || kind === 'cashflow' ? 'div_ai_open_company_reports' : 'div_ai_open_financial_source')}</a></li>;
}

export function DividendPricingEditor({ method, disabled, onSave }: { method: DividendPricingMethod; opportunity?: DividendOpportunityResearch; stocks?: Pick<DividendStock, 'code' | 'name'>[]; disabled: boolean; onSave: (value: DividendPricingMethod) => Promise<void> }) {
  const { t } = useTranslation();
  const [holdingPeriod, setHoldingPeriod] = useState(method.holdingPeriod);
  const [error, setError] = useState('');
  const save = async () => {
    const value = { ...method, strategy: 'recent_batches' as const, holdingPeriod };
    if (!isDividendPricingMethod(value)) { setError(t('div_classic_invalid')); return; }
    setError('');
    await onSave(value);
  };
  return <form className="div-ai-pricing-editor" onSubmit={event => { event.preventDefault(); void save(); }}>
    <p>{t('div_classic_intro')}</p>
    <div className="div-ai-auto-summary"><strong>{t('div_classic_fixed_title')}</strong>
      <p>{t('div_classic_buy_yields')}</p><p>{t('div_classic_sell_yields')}</p>
      <p>{t('div_classic_neutral_help')}</p><p>{t('div_classic_allocation')}</p>
    </div>
    <div className="div-ai-principles-form"><label><span>{t('div_v2_pricing_holding_period')}</span>
      <select className="form-input" value={holdingPeriod} disabled={disabled} onChange={event => setHoldingPeriod(event.target.value as DividendPricingMethod['holdingPeriod'])}>
        {(['over_year', 'month_to_year', 'up_to_month'] as const).map(value => <option key={value} value={value}>{t(`div_v2_holding_${value}`)}</option>)}
      </select><small>{t('div_classic_tax_help')}</small>
    </label></div>
    <p className="div-ai-muted">{t('div_classic_refresh_help')}</p>
    {error && <p className="div-warning" role="alert">{error}</p>}
    <button type="submit" className="btn btn-primary" disabled={disabled}>{t('div_v2_pricing_save')}</button>
  </form>;
}

export function DividendPricingCard({ code, pricing: sourcePricing, method, generatedAt, disabled, onUpdated }: { code: string; pricing: DividendPricingResult; method?: DividendPricingMethod; generatedAt: number; disabled: boolean; onUpdated: () => Promise<unknown> }) {
  const { t } = useTranslation();
  const pricing = invalidateOutdatedDividendPricing(sourcePricing);
  const plan = dividendPricingPlan(pricing);
  const yuan = (value?: number) => value === undefined ? '—' : `¥${(value / 100).toFixed(2)}`;
  const pct = (value: number) => `${Number((value / 100).toFixed(2))}%`;
  const proposal: DividendPlanProposal | null = plan ? {
    id: `pricing-${code}`, code, reason: t('div_v2_pricing_apply_reason', { d1: `¥${((pricing.d1Micros ?? 0) / 1e6).toFixed(6)}`, price: yuan(pricing.theoreticalPriceMinor) }), ...plan,
    gridProvenance: dividendPricingProvenance(pricing, generatedAt),
  } : null;
  return <section className="div-ai-pricing-card div-check-grid" aria-label={t('div_check_grid_title')}>
    <h3>{t('div_check_grid_title')}</h3>
    {pricing.blockers.includes('pricing_calculation_stale') ? <p className="div-warning">{t('div_v2_pricing_model_stale')}</p> : <>
      <p className="div-ai-muted">{t('div_check_grid_caption')}</p>
      {plan && <><p className="div-ai-muted">{t('div_batch_columns_note', { tax: pct(pricing.taxBps ?? 0) })}</p>
        {(['buy', 'sell'] as const).map(side => <table className="div-check-grid-table" key={side}><caption>{t(`div_home_${side}`)}</caption><thead><tr>
          <th scope="col">{t('div_grid_level_column')}</th><th scope="col">{t('div_batch_gross_price')}</th><th scope="col">{t('div_batch_net_price')}</th>
        </tr></thead><tbody>{plan[side === 'buy' ? 'buyLevels' : 'sellLevels'].map((level, index) => {
          const gross = BigInt(pricing.dividendBase!.dpsMicros!), divisor = BigInt(level.yieldBps);
          const grossMinor = Number(side === 'buy' ? gross / divisor : (gross + divisor - 1n) / divisor);
          return <tr key={level.yieldBps}><th scope="row">{index + 1}<small>{pct(level.yieldBps)}</small></th>
            <td>{yuan(grossMinor)}</td><td><strong>{yuan(level.priceMinor)}</strong></td></tr>;
        })}</tbody></table>)}</>}
      {!plan && <p className="div-warning">{t('div_check_grid_unavailable')}{pricing.blockers.map(issue => t(`div_v2_pricing_gap_${issue}`)).join('；')}</p>}
      {proposal && <DividendAdvisorPlanActions proposals={[proposal]} disabled={disabled} onUpdated={onUpdated} embedded previewLabel={t('div_v2_pricing_preview')}
        beforePreview={() => validateDividendPricingProposal(proposal, { pricing, method, generatedAt })}
        beforeApply={() => validateDividendPricingProposal(proposal, { pricing, method, generatedAt })} />}
    </>}
  </section>;
}

/** All supporting pricing evidence is displayed inside the stock's single disclosure. */
export function DividendPricingEvidence({ code, pricing: sourcePricing }: { code: string; pricing: DividendPricingResult }) {
  const { t } = useTranslation();
  const pricing = invalidateOutdatedDividendPricing(sourcePricing);
  const yuan = (value?: number, scale = 100) => value === undefined ? '—' : `¥${(value / scale).toLocaleString(undefined, { maximumFractionDigits: scale === 1e6 ? 6 : 2 })}`;
  const pct = (value?: number) => value === undefined ? '—' : `${(value / 100).toFixed(2)}%`;
  const base = pricing.dividendBase;
  const dividendSources = base?.sourceUrls ?? [];
  const advisory = [...new Set([...(pricing.pauseReasons ?? []), ...(pricing.warnings ?? [])])].filter(issue => !pricing.blockers.includes(issue));
  const riskKeys = new Set<DividendPricingBlocker>(['non_positive_earnings', 'payout_above_100', 'fcf_below_150', 'fcf_non_positive', 'fcf_dividend_capped', 'anchors_conflict', 'growth_return_conflict', 'implausible_yield']);
  const isRisk = (issue: DividendPricingBlocker) => issue === 'financial_sector_review' ? pricing.financialReview?.status === 'risk' : riskKeys.has(issue);
  const groups = [
    { title: 'div_classic_risks', issues: advisory.filter(isRisk) },
    { title: 'div_classic_missing', issues: advisory.filter(issue => !isRisk(issue)) },
    { title: 'div_classic_blocked', issues: pricing.blockers },
  ];
  const comparison = dividendPricingMarketComparison(pricing);
  return <section className="div-ai-pricing-evidence">
    <h4>{t('div_classic_title')}</h4>
    {pricing.ledger && <DividendLedgerView ledger={pricing.ledger} base={base} />}
    <dl className="div-ai-metrics"><div><dt>{t('div_classic_gross_dividend')}</dt><dd>{yuan(base?.dpsMicros, 1e6)}</dd></div>
      <div><dt>{t('div_classic_net_dividend')}</dt><dd>{yuan(pricing.d1Micros, 1e6)}</dd></div></dl>
    <p className="div-ai-muted">{t('div_classic_dividend_basis', { tax: pct(pricing.taxBps) })}</p>
    <p className="div-ai-muted">{t('div_classic_price_rule')}</p><p className="div-ai-muted">{t('div_classic_buy_yields')}</p><p className="div-ai-muted">{t('div_classic_sell_yields')}</p>
    {comparison.quoteUsable && <p className="div-ai-muted">{t('div_classic_quote', { price: yuan(pricing.currentPriceMinor), date: pricing.priceDate, grossYield: pct(pricing.currentCashYieldBps) })}</p>}
    {comparison.reachedBuyLevels.length > 0 && <p className="div-ai-muted">{t('div_v2_pricing_model_reached', { levels: comparison.reachedBuyLevels.join('、') })}</p>}
    {pricing.grid.some(grid => grid.changeFromCurrentBps !== undefined) && <ul className="div-ai-muted">{pricing.grid.map((grid, index) => grid.changeFromCurrentBps === undefined ? null : <li key={grid.yieldBps}>{t('div_classic_buy_level', { level: index + 1 })} · {t('div_classic_price_gap', { gap: pct(grid.changeFromCurrentBps) })}</li>)}</ul>}
    {pricing.theoreticalPriceMinor !== undefined && <p className="div-ai-muted">{t('div_classic_neutral', { price: yuan(pricing.theoreticalPriceMinor) })} · {t('div_classic_neutral_help')}</p>}
    {groups.filter(group => group.issues.length > 0).map(group => <section className="div-ai-pricing-gap-list" key={group.title}><h4>{t(group.title)}</h4><ul>{group.issues.map(issue => <PricingGap key={issue} blocker={issue} code={code} />)}</ul></section>)}
    <p className="div-ai-muted">{t('div_classic_update_rule')}</p><p className="div-ai-muted">{t('div_classic_evidence_help')}</p>
    {dividendSources.length > 0 && <div className="div-ai-help-links">{dividendSources.map((url, index) => <a href={url} key={url} target="_blank" rel="noopener noreferrer">{t('div_classic_source', { index: index + 1 })}</a>)}</div>}
    <dl className="div-ai-metrics"><div><dt>{t('div_v2_pricing_current_pb')}</dt><dd>{pricing.currentPbBps === undefined ? '—' : (pricing.currentPbBps / 10000).toFixed(2)}</dd></div>
      <div><dt>{t('div_classic_roe')}</dt><dd>{pct(pricing.meanRoeBps)}</dd></div>
      <div><dt>{t('div_classic_spread')}</dt><dd>{pct(pricing.currentSpreadBps)}</dd></div>
      <div><dt>{t('div_v2_pricing_spread_percentile')}</dt><dd>{pct(pricing.spreadPercentileBps)}</dd></div></dl>
    {pricing.treasury && <p className="div-ai-muted">{t('div_v2_pricing_treasury_date', { yield: pct(pricing.treasury.yieldBps), date: pricing.treasury.asOf })}</p>}
    {pricing.opportunity && <p className="div-ai-muted">{t('div_v2_pricing_opportunity_evidence', { yield: pct(pricing.opportunity.yieldBps), date: pricing.opportunity.asOf })} · {pricing.opportunity.sourceUrl.startsWith('https://') ? <a href={pricing.opportunity.sourceUrl} target="_blank" rel="noopener noreferrer">{t('div_v2_opportunity_reference')}</a> : pricing.opportunity.sourceUrl}</p>}
    {pricing.history && <p className="div-ai-muted">{t('div_batch_history_prices', { from: pricing.history.priceFrom ?? pricing.history.from, through: pricing.history.priceThrough ?? pricing.history.through, count: pricing.history.priceSampleCount ?? pricing.history.samples.length })}</p>}
    {pricing.historyCoverage && <><p className="div-ai-muted">{t('div_batch_history_verified', { count: pricing.historyCoverage.sampleCount, from: pricing.historyCoverage.from ?? '—', through: pricing.historyCoverage.through ?? '—' })}</p>
      <ul className="div-ai-muted">{pricing.historyCoverage.reasons.map(reason => <li key={reason}>{t(`div_batch_history_${reason}`)}</li>)}</ul></>}

  </section>;
}
