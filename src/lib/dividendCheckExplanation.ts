import type { DividendCheckSummary } from './dividendCheckSummary.ts';
import { dividendCheckEn, dividendCheckZh } from '../i18n/dividendCheckTranslations.ts';

/** Presentation of a deterministic result, never a second recommendation engine. */
export function dividendCheckReasonText(reason: string, language = 'zh'): string {
  const dictionary: Record<string, string> = language.startsWith('zh') ? dividendCheckZh : dividendCheckEn;
  const aliases: Record<string, string> = { SOURCE_CONFLICT: 'dividend_source_conflict', SOURCE_PAGES_INCOMPLETE: 'source_pages_incomplete',
    SOURCE_COVERAGE_INCOMPLETE: 'source_pages_incomplete', CROSSCHECK_MISSING: 'crosscheck_missing', CAPITAL_OR_CASH_UNVERIFIED: 'dividend_base_unverified' };
  const code = aliases[reason] ?? (reason.startsWith('CNINFO_') ? 'announcement_refresh_failed' : reason.toLowerCase());
  if (code.startsWith('rule_')) {
    const names: Record<string, string> = { roe: 'ROE', yield: language.startsWith('zh') ? '现金股息率' : 'Cash yield',
      revenueGrowth: language.startsWith('zh') ? '营收增长' : 'Revenue growth', profitGrowth: language.startsWith('zh') ? '利润增长' : 'Profit growth',
      financialSector: language.startsWith('zh') ? '金融专项' : 'Financial-sector evidence' };
    const rule = names[reason.slice(5)] ?? (language.startsWith('zh') ? '已保存的选股原则' : 'Saved screening rule');
    return dictionary.div_check_rule_review.replace('{{rule}}', rule);
  }
  return dictionary[`div_check_reason_${code}`] ?? dictionary.div_check_reason_unknown;
}

export function dividendCheckSummaryText(summaries: DividendCheckSummary[], language = 'zh'): string {
  const chinese = language.startsWith('zh'), dictionary: Record<string, string> = chinese ? dividendCheckZh : dividendCheckEn;
  return summaries.map(summary => {
    const availableReasons = [...new Set([...summary.actionCheck.buy.reasons, ...summary.eligibility.reasons, ...summary.actionCheck.sell.reasons])];
    const material = ['manual_pause', 'crosscheck_missing', 'special_dividend_review', 'saved_evidence_snapshot_missing', 'execution_session_unverified'];
    const reasons = [...material.filter(reason => availableReasons.includes(reason)), ...availableReasons.filter(reason => !material.includes(reason)).slice(0, 3)];
    const state = (key: string) => dictionary[key];
    const identity = `${summary.name}${summary.code ? ` (${summary.code})` : ''}`;
    const rows = [identity, `${state('div_check_eligibility')}: ${state(`div_check_eligibility_${summary.eligibility.status}`)}`,
      `${state('div_check_grid')}: ${state(`div_check_grid_${summary.grid.status}`)}`,
      `${state('div_check_observation_today')}: ${state('div_check_buy')} ${state(`div_check_trigger_${summary.trigger.buy}`)}, ${state('div_check_sell')} ${state(`div_check_trigger_${summary.trigger.sell}`)}`,
      `${state('div_check_action')}: ${state('div_check_buy')} ${state(`div_check_action_${summary.actionCheck.buy.status}`)}, ${state('div_check_sell')} ${state(`div_check_action_${summary.actionCheck.sell.status}`)}`];
    if (summary.trigger.quote.date) rows.push(`${chinese ? '报价来源时间' : 'Quote source time'}: ${summary.trigger.quote.date}`);
    if (reasons.length) rows.push(reasons.map(reason => dividendCheckReasonText(reason, language)).join(chinese ? '；' : '; '));
    return rows.join('\n');
  }).join('\n\n');
}
