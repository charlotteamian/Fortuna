import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isDividendPricingMethod, type DividendPricingMethod, type DividendPricingResult, type DividendPricingRiskClass, type DividendPricingStockOverride } from '../lib/dividendPricing';
import type { DividendPlanProposal } from '../lib/dividendAdvisorActions';
import DividendAdvisorPlanActions from './DividendAdvisorPlanActions';

const FIELD_KEYS = ['requiredReturnBps', 'growthBps', 'safetyMarginBps', 'historicalPercentileBps', 'opportunityCostBps'] as const;
const RISK_CLASSES = ['bondlike', 'bank', 'cyclical', 'other'] as const;

export function DividendPricingEditor({ method, disabled, onSave }: { method: DividendPricingMethod; disabled: boolean; onSave: (value: DividendPricingMethod) => Promise<void> }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<Record<string, string>>(() => Object.fromEntries([
    ...FIELD_KEYS.map(key => [key, method[key] === undefined ? '' : String(method[key]! / 100)]),
    ...RISK_CLASSES.map(key => [`risk_${key}`, String(method.riskPremiumBps[key] / 100)]),
  ]));
  const [holdingPeriod, setHoldingPeriod] = useState(method.holdingPeriod);
  const [opportunityDate, setOpportunityDate] = useState(method.opportunityCostAsOf ?? '');
  const [opportunitySource, setOpportunitySource] = useState(method.opportunityCostSource ?? '');
  const [overrides, setOverrides] = useState(method.stockOverrides);
  const [stockCode, setStockCode] = useState('');
  const [error, setError] = useState('');
  const codeValid = /^\d{6}$/.test(stockCode);
  const override = codeValid ? overrides[stockCode] ?? {} : {};
  const patchOverride = (patch: Partial<DividendPricingStockOverride>) => { if (codeValid) setOverrides(current => ({ ...current, [stockCode]: { ...current[stockCode], ...patch } })); };
  const save = async () => {
    const value = {
      requiredReturnBps: Math.round(Number(draft.requiredReturnBps) * 100), growthBps: Math.round(Number(draft.growthBps) * 100),
      safetyMarginBps: Math.round(Number(draft.safetyMarginBps) * 100), historicalPercentileBps: Math.round(Number(draft.historicalPercentileBps) * 100),
      holdingPeriod, riskPremiumBps: Object.fromEntries(RISK_CLASSES.map(key => [key, Math.round(Number(draft[`risk_${key}`]) * 100)])),
      ...(draft.opportunityCostBps === '' ? {} : { opportunityCostBps: Math.round(Number(draft.opportunityCostBps) * 100), opportunityCostAsOf: opportunityDate, opportunityCostSource: opportunitySource.trim() }),
      stockOverrides: overrides,
    };
    if (FIELD_KEYS.filter(key => key !== 'opportunityCostBps').some(key => !draft[key]?.trim()) || !isDividendPricingMethod(value)) { setError(t('div_v2_pricing_invalid')); return; }
    setError(''); await onSave(value);
  };
  return <form className="div-ai-pricing-editor" onSubmit={event => { event.preventDefault(); void save(); }}>
    <p className="div-ai-muted">{t('div_v2_pricing_intro')}</p><div className="div-ai-principles-form">
      {FIELD_KEYS.filter(key => key !== 'opportunityCostBps').map(key => <label key={key}><span>{t(`div_v2_pricing_${key}`)}</span><input className="form-input" type="number" step=".01" value={draft[key] ?? ''} disabled={disabled} onChange={event => setDraft(current => ({ ...current, [key]: event.target.value }))} /></label>)}
      <label><span>{t('div_v2_pricing_holding_period')}</span><select className="form-input" value={holdingPeriod} disabled={disabled} onChange={event => setHoldingPeriod(event.target.value as DividendPricingMethod['holdingPeriod'])}>
        {(['over_year', 'month_to_year', 'up_to_month'] as const).map(value => <option key={value} value={value}>{t(`div_v2_holding_${value}`)}</option>)}
      </select></label>
    </div>
    <details className="div-method"><summary>{t('div_v2_pricing_anchors')}</summary><p className="div-ai-muted">{t('div_v2_pricing_auto_opportunity')}</p><div className="div-ai-principles-form">
      {RISK_CLASSES.map(key => <label key={key}><span>{t('div_v2_pricing_risk_premium', { kind: t(`div_v2_risk_${key}`) })}</span><input className="form-input" type="number" step=".01" value={draft[`risk_${key}`] ?? ''} disabled={disabled} onChange={event => setDraft(current => ({ ...current, [`risk_${key}`]: event.target.value }))} /></label>)}
      <label><span>{t('div_v2_pricing_opportunityCostBps')}</span><input className="form-input" type="number" min=".01" step=".01" value={draft.opportunityCostBps ?? ''} disabled={disabled} onChange={event => setDraft(current => ({ ...current, opportunityCostBps: event.target.value }))} /></label>
      <label><span>{t('div_v2_pricing_evidence_date')}</span><input className="form-input" type="date" value={opportunityDate} disabled={disabled} onChange={event => setOpportunityDate(event.target.value)} /></label>
      <label className="div-ai-principles-notes"><span>{t('div_v2_pricing_opportunity_source')}</span><textarea className="form-input" rows={2} maxLength={2000} value={opportunitySource} disabled={disabled} onChange={event => setOpportunitySource(event.target.value)} /></label>
    </div></details>
    <details className="div-method"><summary>{t('div_v2_pricing_stock_assumptions')}</summary><p className="div-ai-muted">{t('div_v2_pricing_normalisation_note')}</p>
      <label className="div-ai-pricing-code"><span>{t('div_code')}</span><input className="form-input" inputMode="numeric" maxLength={6} value={stockCode} disabled={disabled} onChange={event => setStockCode(event.target.value.replace(/\D/g, ''))} /></label>
      {Object.keys(overrides).length > 0 && <div className="div-ai-override-codes">{Object.keys(overrides).map(code => <button type="button" className="div-advisor-text-button" key={code} onClick={() => setStockCode(code)}>{code}</button>)}</div>}
      {codeValid && <div className="div-ai-principles-form"><label><span>{t('div_v2_pricing_risk_class')}</span><select className="form-input" value={override.riskClass ?? ''} disabled={disabled} onChange={event => patchOverride({ riskClass: event.target.value ? event.target.value as DividendPricingRiskClass : undefined })}>
        <option value="">{t('div_auto')}</option>{RISK_CLASSES.map(key => <option key={key} value={key}>{t(`div_v2_risk_${key}`)}</option>)}</select></label>
        <label><span>{t('div_v2_pricing_normalised_eps')}</span><input className="form-input" type="number" min=".000001" step=".000001" value={override.normalizedEpsMicros === undefined ? '' : override.normalizedEpsMicros / 1e6} disabled={disabled} onChange={event => patchOverride({ normalizedEpsMicros: event.target.value === '' ? undefined : Math.round(Number(event.target.value) * 1e6) })} /></label>
        <label><span>{t('div_v2_pricing_evidence_date')}</span><input className="form-input" type="date" value={override.normalizationAsOf ?? ''} disabled={disabled} onChange={event => patchOverride({ normalizationAsOf: event.target.value || undefined })} /></label>
        <label className="div-ai-principles-notes"><span>{t('div_v2_pricing_normalisation_source')}</span><textarea className="form-input" rows={3} maxLength={2000} value={override.normalizationSource ?? ''} disabled={disabled} onChange={event => patchOverride({ normalizationSource: event.target.value || undefined })} /></label>
      </div>}
    </details>
    {error && <p className="div-warning" role="alert">{error}</p>}<button type="submit" className="btn btn-primary" disabled={disabled}>{t('div_v2_pricing_save')}</button>
  </form>;
}

export function DividendPricingCard({ code, pricing, disabled, onUpdated }: { code: string; pricing: DividendPricingResult; disabled: boolean; onUpdated: () => Promise<unknown> }) {
  const { t } = useTranslation();
  const yuan = (value?: number, scale = 100) => value === undefined ? '—' : `¥${(value / scale).toLocaleString(undefined, { maximumFractionDigits: 4 })}`;
  const pct = (value?: number) => value === undefined ? '—' : `${(value / 100).toFixed(2)}%`;
  const proposal: DividendPlanProposal | null = pricing.canApply && pricing.grid.length === 3 ? {
    id: `pricing-${code}`, code, reason: t('div_v2_pricing_apply_reason', { d1: yuan(pricing.d1Micros, 1e6), yield: pct(pricing.anchors.medianBps) }),
    buyLevels: pricing.grid.map((grid, index) => ({ priceMinor: grid.priceMinor, yieldBps: grid.yieldBps, portionBps: index === 2 ? 3334 : 3333 })),
  } : null;
  return <details className="div-ai-pricing-card" open><summary>{t('div_v2_pricing_chain')} · {t(pricing.canApply ? 'div_v2_pricing_ready' : 'div_v2_pricing_gaps')}</summary>
    <div className="div-ai-pricing-step"><h4>{t('div_v2_pricing_numerator')}</h4><p>{t('div_v2_pricing_d1_chain', { eps: yuan(pricing.normalizedEpsMicros, 1e6), payout: pct(pricing.sustainablePayoutBps), tax: pct(pricing.taxBps) })}</p><strong>D₁ {yuan(pricing.d1Micros, 1e6)}</strong></div>
    <div className="div-ai-pricing-step"><h4>{t('div_v2_pricing_denominator')}</h4><dl className="div-ai-pricing-anchors"><div><dt>{t('div_v2_anchor_a')}</dt><dd>{pct(pricing.anchors.riskFreePlusPremiumBps)}</dd></div><div><dt>{t('div_v2_anchor_b')}</dt><dd>{pct(pricing.anchors.historicalPercentileBps)}</dd></div><div><dt>{t('div_v2_anchor_c')}</dt><dd>{pct(pricing.anchors.opportunityCostBps)}</dd></div></dl><p>{t('div_v2_pricing_final_yield', { value: pct(pricing.anchors.medianBps) })}</p></div>
    <div className="div-ai-pricing-step"><h4>{t('div_v2_pricing_price')}</h4><dl className="div-ai-metrics"><div><dt>{t('div_v2_gordon_price')}</dt><dd>{yuan(pricing.gordonPriceMinor)}</dd></div><div><dt>{t('div_v2_pricing_anchor_price')}</dt><dd>{yuan(pricing.anchorPriceMinor)}</dd></div><div><dt>{t('div_v2_pricing_pb_price')}</dt><dd>{yuan(pricing.pbBridgePriceMinor)}</dd></div><div><dt>{t('div_v2_theoretical_price')}</dt><dd>{yuan(pricing.theoreticalPriceMinor)}</dd></div><div><dt>{t('div_v2_margin_price')}</dt><dd>{yuan(pricing.marginPriceMinor)}</dd></div></dl></div>
    <details className="div-ai-pricing-validation"><summary>{t('div_v2_pricing_cross_checks')}</summary><dl className="div-ai-metrics"><div><dt>{t('div_v2_pricing_current_pb')}</dt><dd>{pricing.currentPbBps === undefined ? '—' : (pricing.currentPbBps / 10000).toFixed(2)}</dd></div><div><dt>{t('div_v2_pricing_pb_yield')}</dt><dd>{pct(pricing.pbImpliedYieldBps)}</dd></div><div><dt>{t('div_v2_pricing_reasonable_pb')}</dt><dd>{pricing.reasonablePbBps === undefined ? '—' : (pricing.reasonablePbBps / 10000).toFixed(2)}</dd></div><div><dt>{t('div_v2_pricing_spread_percentile')}</dt><dd>{pct(pricing.spreadPercentileBps)}</dd></div></dl>
      <p className="div-ai-muted">{t('div_v2_pricing_quote_basis', {price:yuan(pricing.currentPriceMinor),date:pricing.priceDate ?? '—'})}</p>
      {pricing.opportunity && <p className="div-ai-muted" style={{overflowWrap:'anywhere'}}>{t('div_v2_pricing_opportunity_evidence', {yield:pct(pricing.opportunity.yieldBps),date:pricing.opportunity.asOf})} · {pricing.opportunity.sourceUrl.startsWith('https://') ? <a href={pricing.opportunity.sourceUrl} target="_blank" rel="noopener noreferrer">{t('div_v2_opportunity_reference')}</a> : pricing.opportunity.sourceUrl}</p>}
      {pricing.treasury && <p className="div-ai-muted">{t('div_v2_pricing_treasury_date', { yield: pct(pricing.treasury.yieldBps), date: pricing.treasury.asOf })}</p>}
      {pricing.history && <p className="div-ai-muted">{t('div_v2_pricing_history_dates', { from: pricing.history.from, through: pricing.history.through })}</p>}
    </details>
    {pricing.grid.length > 0 && <div className="div-ai-pricing-grid">{pricing.grid.map((grid, index) => <div key={grid.discountBps}><span>{t('div_v2_pricing_grid_level', { level: index + 1 })}</span><strong>{yuan(grid.priceMinor)}</strong><small>{t('div_v2_pricing_grid_metrics', { yield: pct(grid.yieldBps), gap: pct(grid.changeFromCurrentBps), portion: pct(grid.cumulativePortionBps) })}</small><small>{t(grid.meetsSafetyMargin ? 'div_v2_pricing_margin_met' : 'div_v2_pricing_margin_not_met')}</small></div>)}</div>}
    {pricing.blockers.length > 0 && <details className="div-ai-pricing-gap-list" open><summary>{t('div_v2_pricing_gaps')}</summary><ul>{pricing.blockers.map(blocker => <li key={blocker}>{t(`div_v2_pricing_gap_${blocker}`)}</li>)}</ul></details>}
    {pricing.warnings?.length > 0 && <details className="div-ai-pricing-gap-list"><summary>{t('div_v2_pricing_reviews')}</summary><ul>{pricing.warnings.map(warning => <li key={warning}>{t(`div_v2_pricing_gap_${warning}`)}</li>)}</ul></details>}
    {proposal && <DividendAdvisorPlanActions proposals={[proposal]} disabled={disabled} onUpdated={onUpdated} initiallyExpanded previewLabel={t('div_v2_pricing_preview')} />}
  </details>;
}
