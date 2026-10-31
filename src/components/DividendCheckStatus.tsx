import { useTranslation } from 'react-i18next';
import type { DividendCheckRisk, DividendCheckSummary } from '../lib/dividendCheckSummary';
import './DividendCheckStatus.css';

const reasonAliases: Record<string, string> = {
  SOURCE_CONFLICT: 'dividend_source_conflict', SOURCE_PAGES_INCOMPLETE: 'source_pages_incomplete', SOURCE_COVERAGE_INCOMPLETE: 'source_pages_incomplete',
  CAPITAL_OR_CASH_UNVERIFIED: 'dividend_base_unverified', ANNOUNCEMENT_UNVERIFIED: 'announcement_fields_unverified',
  CAPITAL_ACTIONS_UNVERIFIED: 'capital_actions_unverified', CROSSCHECK_MISSING: 'crosscheck_missing',
  DIVIDEND_LEDGER_CODE_MISMATCH: 'dividend_ledger_code_mismatch', DIVIDEND_LEDGER_READ_FAILED: 'dividend_ledger_read_failed',
  DIVIDEND_RESEARCH_CACHE_UNAVAILABLE: 'research_cache_unavailable', INVALID_RESEARCH_CACHE: 'research_cache_unavailable',
  DIVIDEND_CHECK_ITEM_INVALID: 'dividend_check_item_invalid',
};
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
const normalReason = (reason: string) => reasonAliases[reason] ?? (reason.startsWith('CNINFO_') ? 'announcement_refresh_failed' : reason.toLowerCase());

export default function DividendCheckStatus({ summary, mode = 'compact' }: { summary: DividendCheckSummary; mode?: 'compact' | 'full' }) {
  const { t, i18n } = useTranslation();
  const translated = (key: string, fallback: string) => i18n.exists(key) ? t(key) : t(fallback);
  const reasonLabel = (reason: string) => {
    if (reason.startsWith('rule_')) {
      const rule = reason.slice(5), check = summary.eligibility.checks.find(item => item.rule === rule);
      const label = translated(`div_ai_rule_label_${rule}`, 'div_check_reason_unknown');
      return t(`div_check_rule_${check?.status === 'risk' ? 'failed' : check?.status === 'unknown' ? 'unknown' : 'review'}`, { rule: label });
    }
    const code = normalReason(reason);
    for (const key of [`div_check_reason_${code}`, `div_v2_pricing_gap_${code}`, `div_batch_stale_${code}`, `div_v4_topic_${code}`]) {
      if (i18n.exists(key)) return t(key);
    }
    return t('div_check_reason_unknown');
  };
  const reasonHelp = (reason: string) => {
    const code = normalReason(reason);
    const group = reason.startsWith('rule_') ? 'rule' : adviceKeys[code]
      ?? (code.startsWith('quote_') ? 'quote'
        : code.includes('history') || code === 'capital_actions_unverified' ? 'history'
          : code.startsWith('grid_') || code.endsWith('_changed') || code === 'current_grid_not_saved' || code === 'sell_price_missing' ? 'grid'
            : code.startsWith('announcement_') || code.startsWith('dividend_') || code.startsWith('source_') ? 'announcement'
              : code.startsWith('annual_') || code.startsWith('fcf_') || code.includes('earnings') || code.includes('payout') || code === 'financial_sector_review' ? 'financial' : 'unknown');
    return translated(`div_check_help_${group}`, 'div_check_help_unknown');
  };
  const allRisks = (['blocking', 'attention', 'evidenceInsufficient'] as const).flatMap(group => summary.risk[group].map(item => ({ ...item, group })));
  const reasons = [...new Map([
    ...summary.actionCheck.buy.reasons.filter(reason => reason === 'manual_pause'),
    ...summary.risk.blocking.map(item => item.reason), ...summary.eligibility.reasons,
    ...summary.risk.evidenceInsufficient.map(item => item.reason), ...summary.actionCheck.buy.reasons,
    ...summary.risk.attention.map(item => item.reason), ...summary.actionCheck.sell.reasons, ...summary.grid.reasons,
  ].map(reason => [normalReason(reason), reason])).values()];
  const primaryReasons = mode === 'compact' ? reasons.slice(0, 3) : reasons;
  const remainingReasons = mode === 'compact' ? reasons.slice(3) : [];
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
    <span>{t(`div_check_impact_${item.impact}`)} · {t(item.autoRepair && item.unresolvedAction === 'retry' ? 'div_check_repair_retry' : 'div_check_repair_review')}</span>
    <span>{item.reportPeriod ? t('div_check_report_period', { date: item.reportPeriod }) : t('div_check_date_unknown')}
      {item.publishedAt && ` · ${t('div_check_notice_date', { date: item.publishedAt })}`}{item.verifiedAt && ` · ${t('div_check_verified_date', { date: item.verifiedAt })}`}</span>
    {sourceLinks(item.sources)}
  </li>;
  const gridKey = summary.kind === 'fund' && summary.grid.status === 'saved_unverified' ? 'div_check_fund_grid_saved_unverified' : `div_check_grid_${summary.grid.status}`;
  return <section className="div-check-status" aria-label={t('div_check_status_title')}>
    <dl className="div-check-status-main"><div><dt>{t(summary.kind === 'fund' ? 'div_check_fund_eligibility' : 'div_check_eligibility')}</dt>
      <dd className={`is-${summary.eligibility.status}`}>{t(`div_check_${summary.kind === 'fund' ? 'fund_' : ''}eligibility_${summary.eligibility.status}`)}</dd></div>
      <div><dt>{t('div_check_grid')}</dt><dd>{t(gridKey)} <small>· {t(`div_check_origin_${summary.grid.origin}`)}</small></dd></div>
      <div><dt>{t(quote.status === 'current' ? 'div_check_observation_today' : 'div_check_observation_unknown')}</dt><dd>{(['buy', 'sell'] as const).map(side => <span key={side} className={`div-check-status-observation is-${summary.trigger[side]}`}>{t(`div_check_${side}`)} · {t(`div_check_trigger_${summary.trigger[side]}`)}</span>)}</dd></div>
      <div><dt>{t('div_check_action')}</dt><dd>{(['buy', 'sell'] as const).map(side => <span key={side} className="div-check-status-observation">{t(`div_check_${side}`)} · {t(`div_check_action_${summary.actionCheck[side].status}`)}</span>)}</dd></div>
    </dl>
    {primaryReasons.length > 0 && reasonItems(primaryReasons)}
    <p className="div-check-status-note">{t('div_check_observation_note')}</p>
    <details className="div-check-status-evidence"><summary>{t('div_check_evidence')}</summary>
      {remainingReasons.length > 0 && <div><h4>{t('div_check_more_reasons')}</h4>{reasonItems(remainingReasons)}</div>}
      <p>{quote.status === 'unknown' ? t('div_check_quote_unknown') : t(quote.status === 'current' ? 'div_check_current_quote' : 'div_check_last_quote', { price: publicPrice, date: dates.quoteSourceAt ?? quote.date ?? t('div_check_date_unknown') })}</p>
      {quote.status !== 'current' && summary.trigger.lastAvailable && <p>{t('div_check_last_observation', { date: summary.trigger.lastAvailable.date,
        buy: t(`div_check_trigger_${summary.trigger.lastAvailable.buy}`), sell: t(`div_check_trigger_${summary.trigger.lastAvailable.sell}`) })}</p>}
      <p>{t('div_check_check_time', { date: dateTime(dates.generatedAt) })}</p>
      {dates.researchGeneratedAt !== undefined && <p>{t('div_check_research_time', { date: dateTime(dates.researchGeneratedAt) })}</p>}
      {dates.reportPeriod && <p>{t('div_check_report_period', { date: dates.reportPeriod })}</p>}
      {dates.noticeDate && <p>{t('div_check_notice_date', { date: dates.noticeDate })}</p>}
      {dates.evidenceVerifiedDates.length > 0 && <p>{t('div_check_verified_date', { date: dates.evidenceVerifiedDates.join(' · ') })}</p>}
      {allRisks.length > 0 ? <div><h4>{t('div_check_risk_evidence')}</h4><ul className="div-check-status-reasons">{allRisks.map(evidence)}</ul></div> : sourceLinks(dates.sources)}
    </details>
  </section>;
}
