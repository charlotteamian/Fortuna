import type { DividendCheckSummary } from './dividendCheckSummary.ts';
import { dividendCheckEn, dividendCheckZh } from '../i18n/dividendCheckTranslations.ts';

const REASON_ALIASES: Record<string, string> = {
  SOURCE_CONFLICT: 'dividend_source_conflict',
  SOURCE_PAGES_INCOMPLETE: 'source_pages_incomplete',
  SOURCE_COVERAGE_INCOMPLETE: 'source_pages_incomplete',
  CURRENT_ANNOUNCEMENT_UNVERIFIED: 'announcement_fields_unverified',
  ANNOUNCEMENT_UNVERIFIED: 'announcement_fields_unverified',
  HISTORICAL_ANNOUNCEMENT_GAPS: 'historical_announcement_gaps',
  CAPITAL_OR_CASH_UNVERIFIED: 'dividend_base_unverified',
  CAPITAL_ACTIONS_UNVERIFIED: 'capital_actions_unverified',
  CROSSCHECK_MISSING: 'crosscheck_missing',
  DIVIDEND_LEDGER_CODE_MISMATCH: 'dividend_ledger_code_mismatch',
  DIVIDEND_LEDGER_READ_FAILED: 'dividend_ledger_read_failed',
  DIVIDEND_RESEARCH_CACHE_UNAVAILABLE: 'research_cache_unavailable',
  INVALID_RESEARCH_CACHE: 'research_cache_unavailable',
  DIVIDEND_CHECK_ITEM_INVALID: 'dividend_check_item_invalid',
  additional_rules: 'additional_rules_unverified',
};

const RULE_NAMES_ZH: Record<string, string> = {
  yield: '现金股息率',
  roe: 'ROE',
  revenuegrowth: '营收增长',
  profitgrowth: '利润增长',
  debtasset: '资产负债率',
  cashprofit: '现金利润匹配',
  payout: '分红与盈利匹配',
  fiveyearpayout: '五年派息记录',
  dividendyears: '连续分红',
  financialsector: '金融专项',
  reportfreshness: '财报日期',
  fcfcoverage: '自由现金流覆盖',
};

const RULE_NAMES_EN: Record<string, string> = {
  yield: 'Cash dividend yield',
  roe: 'ROE',
  revenuegrowth: 'Revenue growth',
  profitgrowth: 'Profit growth',
  debtasset: 'Debt to assets',
  cashprofit: 'Cash and profit',
  payout: 'Dividend coverage',
  fiveyearpayout: 'Five-year payout record',
  dividendyears: 'Consecutive dividends',
  financialsector: 'Financial-sector evidence',
  reportfreshness: 'Reporting date',
  fcfcoverage: 'Free cash flow coverage',
};

function canonicalReasonCode(reason: string): string {
  return REASON_ALIASES[reason] ?? (reason.startsWith('CNINFO_') ? 'announcement_refresh_failed' : reason.toLowerCase());
}

/** Presentation of a deterministic result, never a second recommendation engine. */
export function dividendCheckReasonText(reason: string, language = 'zh'): string {
  const chinese = language.startsWith('zh');
  const dictionary: Record<string, string> = chinese ? dividendCheckZh : dividendCheckEn;
  const code = canonicalReasonCode(reason);
  if (code.startsWith('rule_')) {
    const names = chinese ? RULE_NAMES_ZH : RULE_NAMES_EN;
    const rule = names[code.slice(5)] ?? (chinese ? '已保存的选股原则' : 'Saved screening rule');
    return dictionary.div_check_rule_review.replace('{{rule}}', rule);
  }
  return dictionary[`div_check_reason_${code}`] ?? dictionary.div_check_reason_unknown;
}

export function dividendCheckSummaryText(summaries: DividendCheckSummary[], language = 'zh'): string {
  const chinese = language.startsWith('zh'), dictionary: Record<string, string> = chinese ? dividendCheckZh : dividendCheckEn;
  return summaries.map(summary => {
    const rawReasons = [...summary.actionCheck.buy.reasons, ...summary.eligibility.reasons, ...summary.actionCheck.sell.reasons];
    const availableReasons = [...new Map(rawReasons.map(reason => [canonicalReasonCode(reason), reason])).values()];
    const material = ['manual_pause', 'crosscheck_missing', 'special_dividend_review', 'saved_evidence_snapshot_missing', 'execution_session_unverified'];
    const selected = [
      ...availableReasons.filter(reason => material.includes(canonicalReasonCode(reason))),
      ...availableReasons.filter(reason => !material.includes(canonicalReasonCode(reason))).slice(0, 3),
    ];
    const renderedReasons = [...new Set(selected.map(reason => dividendCheckReasonText(reason, language)))];
    const state = (key: string) => dictionary[key];
    const identity = `${summary.name}${summary.code ? ` (${summary.code})` : ''}`;
    const rows = [identity, `${state('div_check_eligibility')}: ${state(`div_check_eligibility_${summary.eligibility.status}`)}`,
      `${state('div_check_grid')}: ${state(`div_check_grid_${summary.grid.status}`)}`,
      `${state('div_check_observation_today')}: ${state('div_check_buy')} ${state(`div_check_trigger_${summary.trigger.buy}`)}, ${state('div_check_sell')} ${state(`div_check_trigger_${summary.trigger.sell}`)}`,
      `${state('div_check_action')}: ${state('div_check_buy')} ${state(`div_check_action_${summary.actionCheck.buy.status}`)}, ${state('div_check_sell')} ${state(`div_check_action_${summary.actionCheck.sell.status}`)}`];
    if (summary.trigger.quote.date) rows.push(`${chinese ? '报价来源时间' : 'Quote source time'}: ${summary.trigger.quote.date}`);
    if (renderedReasons.length) rows.push(renderedReasons.join(chinese ? '；' : '; '));
    return rows.join('\n');
  }).join('\n\n');
}
