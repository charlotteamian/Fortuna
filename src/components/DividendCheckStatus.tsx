import { useTranslation } from 'react-i18next';
import type { ReactNode } from 'react';
import type { DividendCheckRisk, DividendCheckSummary } from '../lib/dividendCheckSummary';
import './DividendCheckStatus.css';
import { dividendCheckReasonCode, dividendCheckReasonLabel } from '../lib/dividendCheckLabels';

const adviceKeys: Record<string, string> = {
  research_missing: 'research', research_not_current: 'research', additional_rules_unverified: 'additional_rules',
  crosscheck_missing: 'crosscheck', special_dividend_review: 'special', saved_evidence_snapshot_missing: 'saved_evidence',
  manual_pause: 'pause', eligibility_fail: 'eligibility', eligibility_unknown: 'eligibility', execution_session_unverified: 'session',
  budget_missing: 'budget', budget_empty: 'budget', no_holding: 'holding', holding_unknown: 'holding', below_lot: 'lot', covered: 'lot',
  cash_fees_liquidity_unverified: 'execution', fees_liquidity_unverified: 'execution',
  fund_manual_price: 'fund_reference', fund_manual_reference: 'fund_reference', fund_mode_hold: 'fund_mode', fund_mode_rebalance: 'fund_mode',
  price_missing: 'fund_reference', price_prior_date: 'fund_reference', high_missing: 'fund_reference', index_yield_missing: 'fund_reference', index_yield_prior_date: 'fund_reference',
  quote_source_conflict: 'quote_conflict', dividend_source_conflict: 'source_conflict', dividend_crosscheck_mismatch: 'crosscheck_mismatch',
  stock_trend: 'trend', market_trend: 'trend', yield_history: 'history', financial_sector: 'financial', cashflow: 'financial',
  pricing_basis_changed: 'grid', pricing_invalid: 'announcement', research_cache_unavailable: 'announcement',
};


export default function DividendCheckStatus({ summary, mode = 'compact', children }: { summary: DividendCheckSummary; mode?: 'compact' | 'full' | 'row'; children?: ReactNode }) {
  const { t, i18n } = useTranslation();
  const translated = (key: string, fallback: string) => i18n.exists(key) ? t(key) : t(fallback);
  const reasonLabel = (reason: string) => {
    const label = dividendCheckReasonLabel(reason, summary.eligibility, t, key => i18n.exists(key));
    const rule = reason.startsWith('rule_') ? summary.eligibility.checks.find(check => check.rule === reason.slice(5)) : undefined;
    if (rule?.value === undefined || rule.threshold === undefined) return label;
    const format = (value: number) => rule.rule === 'dividendYears' ? String(value) : `${value / 100}%`;
    return `${label} · ${t('div_ai_research_value', { value: format(rule.value), threshold: format(rule.threshold) })}`;
  };
  const reasonHelp = (reason: string) => {
    const code = dividendCheckReasonCode(reason);
    const group = reason.startsWith('rule_') ? 'rule' : adviceKeys[code]
      ?? (code.startsWith('quote_') ? 'quote'
        : code.includes('history') || code === 'capital_actions_unverified' ? 'history'
          : code.startsWith('grid_') || code.endsWith('_changed') || code === 'current_grid_not_saved' || code === 'sell_price_missing' ? 'grid'
            : code.startsWith('announcement_') || code.startsWith('dividend_') || code.startsWith('source_') ? 'announcement'
              : code.startsWith('annual_') || code.startsWith('fcf_') || code.includes('earnings') || code.includes('payout') || code === 'financial_sector_review' ? 'financial' : 'unknown');
    return translated(`div_check_help_${group}`, 'div_check_help_unknown');
  };
  const allRisks = (['blocking', 'evidenceInsufficient', 'attention'] as const)
    .flatMap(group => summary.risk[group].map(item => ({ ...item, group })));
  const reasons = [...new Map([
    ...summary.actionCheck.buy.reasons.filter(reason => reason === 'manual_pause'),
    ...summary.risk.blocking.map(item => item.reason), ...summary.eligibility.reasons,
    ...summary.risk.evidenceInsufficient.map(item => item.reason), ...summary.actionCheck.buy.reasons,
    ...summary.risk.attention.map(item => item.reason), ...summary.actionCheck.sell.reasons, ...summary.grid.reasons,
  ].map(reason => [dividendCheckReasonCode(reason), reason])).values()];
  const routine = new Set(['no_holding', 'cash_fees_liquidity_unverified', 'fees_liquidity_unverified', 'execution_session_unverified', 'covered', 'below_lot']);
  const failedRule = summary.eligibility.reasons.find(reason => reason.startsWith('rule_') && summary.eligibility.checks.some(check => check.rule === reason.slice(5) && check.status === 'risk'));
  const rankedReasons = summary.eligibility.status === 'fail'
    ? [failedRule ?? summary.eligibility.reasons[0], ...reasons.filter(reason => reason === 'manual_pause'), ...summary.eligibility.reasons, ...reasons].filter((reason): reason is string => !!reason)
    : reasons;
  const focusReasons = [...new Set(rankedReasons)].filter(reason => !routine.has(dividendCheckReasonCode(reason)));
  const primaryReasons = mode === 'full' ? reasons : mode === 'row' ? focusReasons.filter(reason => reason === 'manual_pause' || summary.eligibility.checks.some(check => `rule_${check.rule}` === reason && check.status === 'risk')).slice(0, 1) : reasons.slice(0, 3);
  const riskReasons = new Set(allRisks.map(item => dividendCheckReasonCode(item.reason)));
  const remainingReasons = (mode === 'row' ? reasons : mode === 'compact' ? reasons.slice(3) : [])
    .filter(reason => !riskReasons.has(dividendCheckReasonCode(reason)) && !primaryReasons.includes(reason) && !routine.has(dividendCheckReasonCode(reason)));
  const dates = summary.freshness;
  const dateTime = (timestamp: number) => new Date(timestamp).toLocaleString(i18n.language);
  const quote = summary.trigger.quote;
  const publicPrice = quote.priceMicros !== undefined ? `¥${(quote.priceMicros / 1e6).toLocaleString(i18n.language, { maximumFractionDigits: 6 })}`
    : quote.priceMinor !== undefined ? `¥${(quote.priceMinor / 100).toFixed(2)}` : '—';
  const sourceLinks = (sources: string[]) => sources.length ? <ul className="div-check-status-sources">{[...new Set(sources)].map((source, index) => <li key={source}>
    {source.startsWith('https://') ? <a href={source} target="_blank" rel="noopener noreferrer">{t('div_check_source', { index: index + 1 })}</a> : <span>{source}</span>}
  </li>)}</ul> : <p>{t('div_check_sources_unknown')}</p>;
  const reasonItems = (items: string[]) => <ul className="div-check-status-reasons">{items.map(reason => <li key={reason}><strong>{reasonLabel(reason)}</strong><span>{reasonHelp(reason)}</span></li>)}</ul>;
  const evidence = (item: DividendCheckRisk & { group: keyof DividendCheckSummary['risk'] }) => <li key={`${item.group}:${item.id}`}>
    <strong>{t(`div_check_risk_${item.group}`)} · {reasonLabel(item.reason)}</strong>
    <span>{t(dividendCheckReasonCode(item.reason) === 'saved_evidence_snapshot_missing' ? 'div_experience_evidence_history'
      : item.group === 'attention' || item.impact === 'information' ? 'div_experience_evidence_advisory'
        : item.autoRepair && item.unresolvedAction === 'retry' ? 'div_experience_evidence_auto'
        : item.impact === 'new_price' ? 'div_experience_evidence_blocked'
          : item.impact === 'new_buy' ? 'div_experience_evidence_operation' : 'div_experience_evidence_advisory')}</span>
    <span>{item.reportPeriod ? t('div_check_report_period', { date: item.reportPeriod }) : t('div_check_date_unknown')}
      {item.publishedAt && ` · ${t('div_check_notice_date', { date: item.publishedAt })}`}{item.verifiedAt && ` · ${t('div_check_verified_date', { date: item.verifiedAt })}`}</span>
  </li>;
  const gridKey = summary.grid.userConfirmedAt && summary.grid.status === 'verified' ? 'div_manual_grid_confirmed' : summary.kind === 'fund' && summary.grid.status === 'saved_unverified' ? 'div_check_fund_grid_saved_unverified' : `div_check_grid_${summary.grid.status}`;
  return <section className={`div-check-status${mode === 'row' ? ' div-check-status-row' : ''}`} aria-label={t('div_check_status_title')}>
    {mode === 'row' && <p className={`div-focus-check-title is-${summary.eligibility.status}`}>{t(`div_focus_eligibility_${summary.eligibility.status}`)}</p>}
    {mode !== 'row' && <dl className="div-check-status-main"><div><dt>{t(summary.kind === 'fund' ? 'div_check_fund_eligibility' : 'div_check_eligibility')}</dt>
      <dd className={`is-${summary.eligibility.status}`}>{t(`div_check_${summary.kind === 'fund' ? 'fund_' : ''}eligibility_${summary.eligibility.status}`)}</dd></div>
      <div><dt>{t('div_check_grid')}</dt><dd>{t(gridKey)} <small>· {t(`div_check_origin_${summary.grid.origin}`)}</small></dd></div>
      <div><dt>{t(quote.status === 'current' ? 'div_check_observation_today' : 'div_check_observation_unknown')}</dt><dd>{(['buy', 'sell'] as const).map(side => <span key={side} className={`div-check-status-observation is-${summary.trigger[side]}`}>{t(`div_check_${side}`)} · {t(`div_check_trigger_${summary.trigger[side]}`)}</span>)}</dd></div>
      <div><dt>{t('div_check_action')}</dt><dd>{(['buy', 'sell'] as const).map(side => <span key={side} className="div-check-status-observation">{t(`div_check_${side}`)} · {t(`div_check_action_${summary.actionCheck[side].status}`)}</span>)}</dd></div>
    </dl>}
    {primaryReasons.length > 0 && (mode === 'row' ? <ul className="div-check-primary-reasons">{primaryReasons.map(reason => <li key={reason}><strong>{reasonLabel(reason)}</strong></li>)}</ul> : reasonItems(primaryReasons))}
    {mode !== 'row' && <p className="div-check-status-note">{t('div_check_observation_note')}</p>}
    <details className="div-check-status-evidence"><summary>{t(mode === 'row' ? 'div_read_evidence' : 'div_check_evidence')}</summary>
      {mode === 'row' && <dl className="div-check-status-main"><div><dt>{t('div_check_grid')}</dt><dd>{t(gridKey)}</dd></div>
        <div><dt>{t(quote.status === 'current' ? 'div_check_observation_today' : 'div_check_observation_unknown')}</dt><dd>{(['buy', 'sell'] as const).map(side => <span key={side}>{t(`div_check_${side}`)} · {t(`div_check_trigger_${summary.trigger[side]}`)}</span>)}</dd></div>
        <div><dt>{t('div_check_action')}</dt><dd>{(['buy', 'sell'] as const).map(side => <span key={side}>{t(`div_check_${side}`)} · {t(`div_check_action_${summary.actionCheck[side].status}`)}</span>)}</dd></div></dl>}
      {remainingReasons.length > 0 && <div><h4>{t('div_check_more_reasons')}</h4>{reasonItems(remainingReasons)}</div>}
      <p>{quote.status === 'unknown' ? t('div_check_quote_unknown') : t(quote.status === 'current' ? 'div_check_current_quote' : 'div_check_last_quote', { price: publicPrice, date: dates.quoteSourceAt ?? quote.date ?? t('div_check_date_unknown') })}</p>
      {quote.status !== 'current' && summary.trigger.lastAvailable && <p>{t('div_check_last_observation', { date: summary.trigger.lastAvailable.date,
        buy: t(`div_check_trigger_${summary.trigger.lastAvailable.buy}`), sell: t(`div_check_trigger_${summary.trigger.lastAvailable.sell}`) })}</p>}
      <p>{t('div_check_check_time', { date: dateTime(dates.generatedAt) })}</p>
      {dates.researchGeneratedAt !== undefined && <p>{t('div_check_research_time', { date: dateTime(dates.researchGeneratedAt) })}</p>}
      {dates.reportPeriod && <p>{t('div_check_report_period', { date: dates.reportPeriod })}</p>}
      {dates.noticeDate && <p>{t('div_check_notice_date', { date: dates.noticeDate })}</p>}
      {dates.evidenceVerifiedDates.length > 0 && <p>{t('div_check_verified_date', { date: dates.evidenceVerifiedDates.join(' · ') })}</p>}
      {allRisks.length > 0 && <details><summary>{t('div_experience_observations_details', { count: allRisks.length })}</summary><ul className="div-check-status-reasons">{allRisks.map(evidence)}</ul></details>}
      <details><summary>{t('div_experience_sources')}</summary>{sourceLinks([...dates.sources, ...allRisks.flatMap(item => item.sources)])}</details>
      <details><summary>{t('div_manual_more_analysis')}</summary>{children}</details>
    </details>
  </section>;
}
