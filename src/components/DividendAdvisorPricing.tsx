import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { dividendPricingMarketComparison, invalidateOutdatedDividendPricing, isDividendPricingMethod, type DividendPricingMethod, type DividendPricingResult, type DividendPricingRiskClass, type DividendPricingStockOverride, type DividendOpportunityResearch, type DividendPricingBlocker } from '../lib/dividendPricing';
import type { DividendPlanProposal } from '../lib/dividendAdvisorActions';
import type { DividendFinancialSectorReview } from '../lib/dividendResearch';
import type { DividendStock } from '../lib/dividendWorkbench';
import DividendAdvisorPlanActions from './DividendAdvisorPlanActions';
import { dividendPricingPlan } from '../lib/dividendPricingPlan';
import './DividendReviewAlerts.css';

const FIELD_KEYS = ['requiredReturnBps', 'growthBps', 'safetyMarginBps', 'historicalPercentileBps', 'opportunityCostBps'] as const;
const RISK_CLASSES = ['bondlike', 'bank', 'cyclical', 'other'] as const;
const GAP_HELP: Record<DividendPricingBlocker, string> = {
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
  return <details className={`div-ai-financial-review ${review.status}`} open={review.status !== 'pass'}>
    <summary>{t('div_ai_financial_review_title', { sector: t(`div_ai_financial_sector_${review.sector}`) })}{review.reportSupplement && ` · ${t('div_ai_financial_report_extract_short')}`}</summary>
    <div className="div-review-badges">{risks.length > 0 && <span className="div-ai-status risk">{t('div_v3_review_risks', { count: risks.length })}</span>}
      {(missing.length > 0 || review.missing.length > 0) && <span className="div-ai-status unknown">{t('div_v3_review_missing', { count: missing.length || review.missing.length })}</span>}
      {!risks.length && !missing.length && !review.missing.length && <span className="div-ai-status pass">{t('div_ai_research_pass')}</span>}</div>
    <p className="div-ai-muted">{t('div_ai_financial_auto_evidence', { date: review.asOf })}</p>
    <p className="div-ai-muted">{t(review.basis === 'dividend_screen' ? 'div_ai_financial_screen_basis' : 'div_ai_financial_regulatory_basis')}</p>
    {([{ status: 'risk', metrics: risks }, { status: 'unknown', metrics: missing }, { status: 'pass', metrics: passed }] as const).filter(group => group.metrics.length > 0).map(group => <section key={group.status} className={group.status === 'pass' ? '' : `div-review-alert ${group.status}`}>
      <strong>{t(group.status === 'risk' ? 'div_v3_review_risks' : group.status === 'unknown' ? 'div_v3_review_missing' : 'div_v3_review_passed', { count: group.metrics.length })}</strong>
      <ul className="div-ai-checks">{group.metrics.map(metric => <li key={metric.key}><div><strong>{t(`div_ai_financial_metric_${metric.key}`)}</strong></div>
      <p>{t('div_ai_financial_metric_value', { value: pct(metric.valueBps), direction: t(metric.direction === 'minimum' ? 'div_ai_at_least' : 'div_ai_at_most'), threshold: pct(metric.thresholdBps) })}</p><p>{t('div_ai_research_period', { period: metric.reportDate })}</p>
      {review.reportSupplement && ['comprehensiveSolvency', 'coreSolvency'].includes(metric.key) && <p>{t('div_ai_financial_report_metric_basis')}</p>}
      {metric.changeBps !== undefined && <p>{t('div_ai_financial_yoy_change', { value: `${metric.changeBps > 0 ? '+' : ''}${(metric.changeBps / 100).toFixed(2)}` })}</p>}
    </li>)}</ul></section>)}
    {review.missing.map(item => <p className="div-ai-muted" key={item}>{t(`div_ai_financial_missing_${item}`, { defaultValue: t('div_ai_financial_missing_other') })}</p>)}
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
  </details>;
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

export function DividendPricingEditor({ method, opportunity, stocks = [], disabled, onSave }: { method: DividendPricingMethod; opportunity?: DividendOpportunityResearch; stocks?: Pick<DividendStock, 'code' | 'name'>[]; disabled: boolean; onSave: (value: DividendPricingMethod) => Promise<void> }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<Record<string, string>>(() => Object.fromEntries([
    ...FIELD_KEYS.map(key => [key, method[key] === undefined ? '' : String(method[key]! / 100)]),
    ...RISK_CLASSES.map(key => [`risk_${key}`, String(method.riskPremiumBps[key] / 100)]),
  ]));
  const [holdingPeriod, setHoldingPeriod] = useState(method.holdingPeriod);
  const [opportunityMode, setOpportunityMode] = useState<'auto' | 'manual'>(method.opportunityCostBps === undefined ? 'auto' : 'manual');
  const [opportunityDate, setOpportunityDate] = useState(method.opportunityCostAsOf ?? '');
  const [opportunitySource, setOpportunitySource] = useState(method.opportunityCostSource ?? '');
  const [overrides, setOverrides] = useState(method.stockOverrides);
  const [stockCode, setStockCode] = useState('');
  const [error, setError] = useState('');
  const codeValid = /^\d{6}$/.test(stockCode);
  const override = codeValid ? overrides[stockCode] ?? {} : {};
  const knownStocks = new Map(stocks.map(stock => [stock.code, stock.name]));
  const selectedName = knownStocks.get(stockCode);
  const patchOverride = (patch: Partial<DividendPricingStockOverride>) => {
    if (!codeValid) return;
    const editedCode = stockCode;
    setOverrides(current => {
      const next = { ...current };
      const value = Object.fromEntries(Object.entries({ ...current[editedCode], ...patch }).filter(([, field]) => field !== undefined));
      if (Object.keys(value).length) next[editedCode] = value;
      else delete next[editedCode];
      return next;
    });
  };
  const save = async (nextOverrides = overrides) => {
    const value = {
      requiredReturnBps: Math.round(Number(draft.requiredReturnBps) * 100), growthBps: Math.round(Number(draft.growthBps) * 100),
      safetyMarginBps: Math.round(Number(draft.safetyMarginBps) * 100), historicalPercentileBps: Math.round(Number(draft.historicalPercentileBps) * 100),
      holdingPeriod, riskPremiumBps: Object.fromEntries(RISK_CLASSES.map(key => [key, Math.round(Number(draft[`risk_${key}`]) * 100)])),
      ...(opportunityMode === 'auto' ? {} : { opportunityCostBps: Math.round(Number(draft.opportunityCostBps) * 100), opportunityCostAsOf: opportunityDate, opportunityCostSource: opportunitySource.trim() }),
      stockOverrides: nextOverrides,
    };
    if (opportunityMode === 'manual' && (!draft.opportunityCostBps?.trim() || !opportunityDate || !opportunitySource.trim())) { setError(t('div_v2_pricing_manual_evidence_required')); return; }
    if (Object.values(nextOverrides).some(item => item.normalizedEpsMicros !== undefined && (!item.normalizationAsOf || !item.normalizationSource?.trim()))) { setError(t('div_v2_pricing_normalisation_evidence_required')); return; }
    if (FIELD_KEYS.filter(key => key !== 'opportunityCostBps').some(key => !draft[key]?.trim()) || RISK_CLASSES.some(key => !draft[`risk_${key}`]?.trim()) || !isDividendPricingMethod(value)) { setError(t('div_v2_pricing_invalid')); return; }
    setError(''); await onSave(value);
  };
  const removeOverride = async () => {
    const nextOverrides = { ...overrides };
    delete nextOverrides[stockCode];
    setOverrides(nextOverrides);
    await save(nextOverrides);
  };
  return <form className="div-ai-pricing-editor" onSubmit={event => { event.preventDefault(); void save(); }}>
    <p className="div-ai-muted">{t('div_v2_pricing_intro')}</p><p className="div-ai-auto-summary">{t('div_v2_pricing_auto_summary')}</p><div className="div-ai-principles-form">
      {FIELD_KEYS.filter(key => key !== 'opportunityCostBps').map(key => <label key={key}><span>{t(`div_v2_pricing_${key}`)}</span><input className="form-input" type="number" step=".01" value={draft[key] ?? ''} disabled={disabled} onChange={event => setDraft(current => ({ ...current, [key]: event.target.value }))} /><small>{t(`div_v2_pricing_help_${key}`)}</small></label>)}
      <label><span>{t('div_v2_pricing_holding_period')}</span><select className="form-input" value={holdingPeriod} disabled={disabled} onChange={event => setHoldingPeriod(event.target.value as DividendPricingMethod['holdingPeriod'])}>
        {(['over_year', 'month_to_year', 'up_to_month'] as const).map(value => <option key={value} value={value}>{t(`div_v2_holding_${value}`)}</option>)}
      </select></label>
    </div>
    <details className="div-method"><summary>{t('div_v2_pricing_anchors')} · {t(opportunityMode === 'auto' ? 'div_v2_pricing_auto_mode' : 'div_v2_pricing_manual_mode')}</summary><p className="div-ai-muted">{t('div_v2_pricing_auto_opportunity')}</p><div className="div-ai-principles-form">
      {RISK_CLASSES.map(key => <label key={key}><span>{t('div_v2_pricing_risk_premium', { kind: t(`div_v2_risk_${key}`) })}</span><input className="form-input" type="number" step=".01" value={draft[`risk_${key}`] ?? ''} disabled={disabled} onChange={event => setDraft(current => ({ ...current, [`risk_${key}`]: event.target.value }))} /></label>)}
      <p className="div-ai-principles-notes div-ai-muted">{t('div_v2_pricing_risk_premium_help')}</p>
      <label className="div-ai-principles-notes"><span>{t('div_v2_pricing_opportunity_method')}</span><select className="form-input" value={opportunityMode} disabled={disabled} onChange={event => setOpportunityMode(event.target.value as 'auto' | 'manual')}>
        <option value="auto">{t('div_v2_pricing_auto_mode')}</option><option value="manual">{t('div_v2_pricing_manual_mode')}</option></select></label>
      {opportunityMode === 'auto' && <div className="div-ai-principles-notes div-ai-auto-summary"><strong>{t('div_v2_pricing_auto_no_entry')}</strong>
        <p>{opportunity ? t('div_v2_pricing_opportunity_evidence', { yield: `${(opportunity.yieldBps / 100).toFixed(2)}%`, date: opportunity.asOf }) : t('div_v2_pricing_auto_on_review')}</p>
        <a href="https://www.csindex.com.cn/#/indices/family/detail?indexCode=000922" target="_blank" rel="noopener noreferrer">{t('div_v2_pricing_open_csi')}</a></div>}
      {opportunityMode === 'manual' && <><label><span>{t('div_v2_pricing_opportunityCostBps')}</span><input className="form-input" type="number" min=".01" step=".01" value={draft.opportunityCostBps ?? ''} disabled={disabled} required onChange={event => setDraft(current => ({ ...current, opportunityCostBps: event.target.value }))} placeholder={t('div_v2_pricing_opportunity_value_placeholder')} /></label>
        <label><span>{t('div_v2_pricing_evidence_date')}</span><input className="form-input" type="date" value={opportunityDate} disabled={disabled} required onChange={event => setOpportunityDate(event.target.value)} /><small>{t('div_v2_pricing_date_help')}</small></label>
        <label className="div-ai-principles-notes"><span>{t('div_v2_pricing_opportunity_source')}</span><textarea className="form-input" rows={3} maxLength={2000} value={opportunitySource} disabled={disabled} required onChange={event => setOpportunitySource(event.target.value)} placeholder={t('div_v2_pricing_opportunity_source_placeholder')} /><small>{t('div_v2_pricing_manual_opportunity_help')}</small></label></>}
    </div></details>
    <details className="div-method"><summary>{t('div_v2_pricing_stock_assumptions')} · {t('div_v2_pricing_optional_override')}</summary><p className="div-ai-muted">{t('div_v2_pricing_stock_auto_help')}</p>
      <p className="div-ai-auto-summary">{t('div_v2_pricing_stock_independent')}</p>
      {stocks.length > 0 && <label className="div-ai-pricing-code"><span>{t('div_v2_pricing_select_stock')}</span><select className="form-input" value={knownStocks.has(stockCode) ? stockCode : ''} disabled={disabled} onChange={event => setStockCode(event.target.value)}>
        <option value="">{t('div_v2_pricing_select_stock_placeholder')}</option>{stocks.map(stock => <option key={stock.code} value={stock.code}>{stock.name} · {stock.code}</option>)}
      </select></label>}
      <label className="div-ai-pricing-code"><span>{t(stocks.length > 0 ? 'div_v2_pricing_manual_code' : 'div_code')}</span><input className="form-input" inputMode="numeric" maxLength={6} value={stockCode} disabled={disabled} placeholder={t('div_v2_pricing_code_placeholder')} onChange={event => setStockCode(event.target.value.replace(/\D/g, ''))} /></label>
      {Object.keys(overrides).length > 0 && <div className="div-ai-override-list"><strong>{t('div_v2_pricing_configured_stocks', { count: Object.keys(overrides).length })}</strong>{Object.entries(overrides).sort(([left], [right]) => left.localeCompare(right)).map(([code, item]) => <div className="div-ai-override-item" key={code}>
        <button type="button" className="div-advisor-text-button" aria-pressed={code === stockCode} disabled={disabled} onClick={() => setStockCode(code)}>{knownStocks.get(code) ?? code}{knownStocks.has(code) && ` · ${code}`}</button>
        <span>{t('div_v2_pricing_stock_override_summary', { risk: t(item.riskClass ? `div_v2_risk_${item.riskClass}` : 'div_auto'), eps: item.normalizedEpsMicros === undefined ? t('div_auto') : (item.normalizedEpsMicros / 1e6).toLocaleString(undefined, { maximumFractionDigits: 6 }) })}</span>
      </div>)}</div>}
      {codeValid && <><h4>{t('div_v2_pricing_editing_stock', { stock: selectedName ? `${selectedName} · ${stockCode}` : stockCode })}</h4><div className="div-ai-principles-form div-ai-stock-override-fields"><label><span>{t('div_v2_pricing_risk_class')}</span><select className="form-input" value={override.riskClass ?? ''} disabled={disabled} onChange={event => patchOverride({ riskClass: event.target.value ? event.target.value as DividendPricingRiskClass : undefined })}>
        <option value="">{t('div_auto')}</option>{RISK_CLASSES.map(key => <option key={key} value={key}>{t(`div_v2_risk_${key}`)}</option>)}</select></label>
        <label><span>{t('div_v2_pricing_normalised_eps')}</span><input className="form-input" type="number" min=".000001" step=".000001" value={override.normalizedEpsMicros === undefined ? '' : override.normalizedEpsMicros / 1e6} disabled={disabled} placeholder={t('div_v2_pricing_eps_placeholder')} onChange={event => patchOverride(event.target.value === '' ? { normalizedEpsMicros: undefined, normalizationAsOf: undefined, normalizationSource: undefined } : { normalizedEpsMicros: Math.round(Number(event.target.value) * 1e6) })} /><small>{t('div_v2_pricing_eps_help')}</small></label>
        <label><span>{t('div_v2_pricing_evidence_date')}</span><input className="form-input" type="date" value={override.normalizationAsOf ?? ''} disabled={disabled} required={override.normalizedEpsMicros !== undefined} onChange={event => patchOverride({ normalizationAsOf: event.target.value || undefined })} /><small>{t('div_v2_pricing_date_help')}</small></label>
        <label className="div-ai-principles-notes"><span>{t('div_v2_pricing_normalisation_source')}</span><textarea className="form-input" rows={3} maxLength={2000} value={override.normalizationSource ?? ''} disabled={disabled} required={override.normalizedEpsMicros !== undefined} placeholder={t('div_v2_pricing_eps_source_placeholder')} onChange={event => patchOverride({ normalizationSource: event.target.value || undefined })} /><small>{t('div_v2_pricing_normalisation_find_help')}</small><a href="https://www.cninfo.com.cn/new/index" target="_blank" rel="noopener noreferrer">{t('div_ai_open_company_reports')}</a></label>
      </div><div className="div-actions"><button type="submit" className="btn btn-secondary" disabled={disabled}>{t('div_v2_pricing_save_stock')}</button>
        {Object.hasOwn(overrides, stockCode) && <button type="button" className="div-advisor-text-button" disabled={disabled} onClick={() => void removeOverride()}>{t('div_v2_pricing_remove_stock')}</button>}</div><p className="div-ai-muted">{t('div_v2_pricing_stock_save_help')}</p></>}
    </details>
    {error && <p className="div-warning" role="alert">{error}</p>}<button type="submit" className="btn btn-primary" disabled={disabled}>{t('div_v2_pricing_save')}</button>
  </form>;
}

export function DividendPricingCard({ code, pricing, disabled, onUpdated }: { code: string; pricing: DividendPricingResult; disabled: boolean; onUpdated: () => Promise<unknown> }) {
  const { t } = useTranslation();
  pricing = invalidateOutdatedDividendPricing(pricing);
  const yuan = (value?: number, scale = 100) => value === undefined ? '—' : `¥${(value / scale).toLocaleString(undefined, { maximumFractionDigits: 4 })}`;
  const pct = (value?: number) => value === undefined ? '—' : `${(value / 100).toFixed(2)}%`;
  const historyCoverage = pricing.historyCoverage;
  const comparison = dividendPricingMarketComparison(pricing);
  const plan = dividendPricingPlan(pricing);
  const proposal: DividendPlanProposal | null = plan ? {
    id: `pricing-${code}`, code, reason: t('div_v2_pricing_apply_reason', { d1: yuan(pricing.d1Micros, 1e6), price: yuan(pricing.theoreticalPriceMinor) }),
    ...plan,
  } : null;
  if (pricing.blockers.includes('pricing_calculation_stale')) return <div className="div-ai-pricing-card div-ai-pricing-model-alert">
    <strong>{t('div_v2_pricing_model_stale_title')}</strong><p>{t('div_v2_pricing_model_stale')}</p>
  </div>;
  return <details className="div-ai-pricing-card" open><summary>{t('div_v2_pricing_chain')} · {t(pricing.canApply ? 'div_v2_pricing_ready' : 'div_v2_pricing_gaps')}</summary>
    {pricing.canApply && <div className="div-ai-pricing-model-summary"><p>{t('div_v2_pricing_model_formula', { d1: yuan(pricing.d1Micros, 1e6), anchor: pct(pricing.anchors.selectedBps), estimate: yuan(pricing.theoreticalPriceMinor) })}</p>
      {comparison.quoteUsable && <p>{t('div_v2_pricing_model_quote', { price: yuan(pricing.currentPriceMinor), date: pricing.priceDate, yield: pct(comparison.sustainableYieldAtQuoteBps), gap: `${comparison.estimateGapBps! >= 0 ? '+' : ''}${pct(comparison.estimateGapBps)}` })}</p>}
      {comparison.reachedBuyLevels.length > 0 && <p className="div-ai-pricing-model-alert">{t('div_v2_pricing_model_reached', { levels: comparison.reachedBuyLevels.join('、') })}</p>}
      {comparison.largeDiscount && <p className="div-ai-pricing-model-alert">{t('div_v2_pricing_model_large_discount')}</p>}
    </div>}
    {pricing.grid.length > 0 && <div className="div-ai-pricing-grid">{pricing.grid.map((grid, index) => <div key={grid.discountBps}><span>{t('div_v2_pricing_grid_level', { level: index + 1 })}</span><strong>{yuan(grid.priceMinor)}</strong><small>{t('div_v2_pricing_grid_metrics', { yield: pct(grid.yieldBps), gap: pct(grid.changeFromCurrentBps), portion: pct(grid.cumulativePortionBps) })}</small><small>{t(grid.meetsSafetyMargin ? 'div_v2_pricing_margin_met' : 'div_v2_pricing_margin_not_met')}</small></div>)}</div>}
    {plan && <div className="div-ai-pricing-step"><h4>{t('div_v2_pricing_sell_title')}</h4><p>{t('div_v2_pricing_sell_method', { d1: yuan(pricing.d1Micros, 1e6), anchor: pct(pricing.anchors.selectedBps) })}</p>
      <div className="div-ai-pricing-grid">{plan.sellLevels.map((level, index) => <div key={index}><span>{t('div_v2_pricing_sell_level', { level: index + 1 })}</span><strong>{yuan(level.priceMinor)}</strong><small>{t('div_v2_pricing_sell_metrics', { yield: pct(level.yieldBps), portion: (index + 1) * 25 })}</small></div>)}</div>
    </div>}
    <details className="div-ai-pricing-calculation"><summary>{t('div_v2_pricing_model_evidence')}</summary>
    <div className="div-ai-pricing-step"><h4>{t('div_v2_pricing_numerator')}</h4><p>{t('div_v2_pricing_d1_chain', { eps: yuan(pricing.normalizedEpsMicros, 1e6), payout: pct(pricing.sustainablePayoutBps), earnings: yuan(pricing.earningsDividendMicros, 1e6) })}</p>
      <p>{pricing.fcfDividendCapMicros === undefined ? t('div_v2_pricing_tax_chain', { tax: pct(pricing.taxBps) })
        : t('div_v2_pricing_fcf_chain', { earnings: yuan(pricing.earningsDividendMicros, 1e6), cap: yuan(pricing.fcfDividendCapMicros, 1e6), tax: pct(pricing.taxBps) })}</p>
      <strong>D₁ {yuan(pricing.d1Micros, 1e6)}</strong>
      <details><summary>{t('div_v2_pricing_payout_evidence')}</summary>
        <p>{t('div_v2_pricing_payout_method')}</p>
        <div className="div-ai-annual-evidence">{pricing.annuals.slice(0,5).map(year => <div className="div-ai-annual-record" key={year.year}>
          <div className="div-ai-annual-head"><strong>{year.year}</strong><strong>{pct(year.payoutBps)}</strong></div>
          <small>{t(year.reportEvidence?.basis === 'reported_no_dividend' ? 'div_v2_pricing_payout_zero'
            : year.reportEvidence ? 'div_v2_pricing_payout_report' : year.payoutBasis === 'reported_cash_over_profit'
              ? 'div_v2_pricing_payout_source_cash' : year.payoutBps === undefined ? 'div_v2_pricing_payout_missing' : 'div_v2_pricing_payout_source_eps')}</small>
          {year.reportEvidence && <><p className="div-ai-evidence-date">{t('div_v2_pricing_payout_verified', { date:year.reportEvidence.publishedAt, verified:year.reportEvidence.verifiedAt })}</p>
            <div className="div-ai-evidence-links">{year.reportEvidence.sources.map((source,index) => <a key={source.url} href={`${source.url}#page=${source.pdfPages[0]}`} target="_blank" rel="noopener noreferrer">{t('div_v2_pricing_payout_source', { index:index+1 })}</a>)}</div></>}
        </div>)}</div>
      </details>
      {pricing.fcfCapApplied && <p>{t('div_v2_pricing_gap_fcf_dividend_capped')}</p>}
      {!!pricing.fcfEvidence?.length && <details><summary>{t('div_v2_pricing_fcf_evidence')}</summary><ul>{pricing.fcfEvidence.map(year => <li key={year.year}>
        {t('div_v2_pricing_fcf_year', { year: year.year, cash: yuan(year.fcfPerShareMicros, 1e6), cap: yuan(year.dividendCapMicros, 1e6) })}
        <small> · {t(`div_v2_pricing_fcf_basis_${year.basis}`)}</small>
      </li>)}</ul></details>}
      <p>{t(`div_v2_pricing_normalization_${pricing.normalizationBasis}`)}</p>
      {pricing.normalizationEvidence && <p>{t('div_v2_pricing_manual_normalization_evidence', { date: pricing.normalizationEvidence.asOf })} · {pricing.normalizationEvidence.source}</p>}
    </div>
    <div className="div-ai-pricing-step"><h4>{t('div_v2_pricing_denominator')}</h4><dl className="div-ai-pricing-anchors"><div><dt>{t('div_v2_anchor_a')}</dt><dd>{pct(pricing.anchors.riskFreePlusPremiumBps)}</dd></div><div><dt>{t('div_v2_anchor_b')}</dt><dd>{pct(pricing.anchors.historicalPercentileBps)}</dd></div><div><dt>{t('div_v2_anchor_c')}</dt><dd>{pct(pricing.anchors.opportunityCostBps)}</dd></div></dl>
      {pricing.history && <p>{t('div_v2_pricing_history_evidence', { count: pricing.history.samples.length, years: ((Date.parse(pricing.history.through) - Date.parse(pricing.history.from)) / (365.25 * 86400000)).toFixed(1), from: pricing.history.from, through: pricing.history.through })}</p>}
      {historyCoverage && !historyCoverage.usable && <div className="div-ai-auto-summary"><p>{t('div_v2_history_coverage', { count: historyCoverage.sampleCount, required: historyCoverage.requiredSamples, years: historyCoverage.spanYears.toFixed(1), requiredYears: historyCoverage.requiredSpanYears, date: historyCoverage.through ?? '—' })}</p>
        <ul>{historyCoverage.reasons.map(reason => <li key={reason}>{t(`div_v2_history_${reason}`, { count: historyCoverage.requiredSamples, years: historyCoverage.requiredSpanYears, days: historyCoverage.maxAgeDays })}</li>)}</ul></div>}
      <p>{t('div_v2_pricing_final_yield', { value: pct(pricing.anchors.selectedBps) })}</p>
      <p className="div-ai-muted">{t(pricing.anchors.selection === 'median' ? 'div_v2_pricing_anchor_median'
        : pricing.anchors.selection === 'highest_available' ? 'div_v2_pricing_anchor_highest' : 'div_v2_pricing_anchor_unavailable')}</p></div>
    <div className="div-ai-pricing-step"><h4>{t('div_v2_pricing_price')}</h4><dl className="div-ai-metrics"><div><dt>{t('div_v2_theoretical_price')}</dt><dd>{yuan(pricing.theoreticalPriceMinor)}</dd></div><div><dt>{t('div_v2_margin_price')}</dt><dd>{yuan(pricing.marginPriceMinor)}</dd></div></dl><p className="div-ai-muted">{t('div_v2_pricing_conservative_rule')}</p></div>
    <details className="div-ai-pricing-validation"><summary>{t('div_v2_pricing_cross_checks')}</summary><dl className="div-ai-metrics"><div><dt>{t('div_v2_pricing_current_pb')}</dt><dd>{pricing.currentPbBps === undefined ? '—' : (pricing.currentPbBps / 10000).toFixed(2)}</dd></div><div><dt>{t('div_v2_pricing_pb_yield')}</dt><dd>{pct(pricing.pbImpliedYieldBps)}</dd></div><div><dt>{t('div_v2_pricing_reasonable_pb')}</dt><dd>{pricing.reasonablePbBps === undefined ? '—' : (pricing.reasonablePbBps / 10000).toFixed(2)}</dd></div><div><dt>{t('div_v2_pricing_spread_percentile')}</dt><dd>{pct(pricing.spreadPercentileBps)}</dd></div></dl>
      <dl className="div-ai-metrics"><div><dt>{t('div_v2_gordon_price')}</dt><dd>{yuan(pricing.gordonPriceMinor)}</dd></div><div><dt>{t('div_v2_pricing_pb_price')}</dt><dd>{yuan(pricing.pbBridgePriceMinor)}</dd></div></dl>
      <p className="div-ai-muted">{t('div_v2_pricing_quote_basis', {price:yuan(pricing.currentPriceMinor),date:pricing.priceDate ?? '—'})}</p>
      {pricing.opportunity && <p className="div-ai-muted" style={{overflowWrap:'anywhere'}}>{t('div_v2_pricing_opportunity_evidence', {yield:pct(pricing.opportunity.yieldBps),date:pricing.opportunity.asOf})} · {pricing.opportunity.sourceUrl.startsWith('https://') ? <a href={pricing.opportunity.sourceUrl} target="_blank" rel="noopener noreferrer">{t('div_v2_opportunity_reference')}</a> : pricing.opportunity.sourceUrl}</p>}
      {pricing.treasury && <p className="div-ai-muted">{t('div_v2_pricing_treasury_date', { yield: pct(pricing.treasury.yieldBps), date: pricing.treasury.asOf })}</p>}
      {pricing.history && <p className="div-ai-muted">{t('div_v2_pricing_history_dates', { from: pricing.history.from, through: pricing.history.through })}</p>}
    </details>
    </details>
    {!!pricing.pauseReasons?.length && <details className="div-ai-pricing-gap-list"><summary>{t('div_v2_pricing_pause_reasons')}</summary><p className="div-ai-muted">{t('div_v2_pricing_pause_independent')}</p><ul>{pricing.pauseReasons.map(reason => <PricingGap key={reason} blocker={reason} code={code} />)}</ul></details>}
    {pricing.blockers.length > 0 && <details className="div-ai-pricing-gap-list" open><summary>{t('div_v2_pricing_gaps')}</summary><ul>{pricing.blockers.map(blocker => <PricingGap key={blocker} blocker={blocker} code={code} />)}</ul></details>}
    {pricing.warnings?.length > 0 && <details className="div-ai-pricing-gap-list" open={pricing.fcfCapApplied || pricing.warnings.includes('anchors_conflict')}><summary>{t('div_v2_pricing_reviews')}</summary><ul>{pricing.warnings.map(warning => <li key={warning}>{t(`div_v2_pricing_gap_${warning}`)}</li>)}</ul></details>}
    {proposal && <DividendAdvisorPlanActions proposals={[proposal]} disabled={disabled} onUpdated={onUpdated} initiallyExpanded previewLabel={t('div_v2_pricing_preview')} />}
  </details>;
}
