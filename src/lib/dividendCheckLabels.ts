import type { TFunction } from 'i18next';
import type { DividendCheckSummary } from './dividendCheckSummary';

const reasonAliases: Record<string, string> = {
  SOURCE_CONFLICT: 'dividend_source_conflict', SOURCE_PAGES_INCOMPLETE: 'source_pages_incomplete', SOURCE_COVERAGE_INCOMPLETE: 'source_pages_incomplete',
  CURRENT_ANNOUNCEMENT_UNVERIFIED: 'announcement_fields_unverified', HISTORICAL_ANNOUNCEMENT_GAPS: 'historical_announcement_gaps',
  CAPITAL_OR_CASH_UNVERIFIED: 'dividend_base_unverified', ANNOUNCEMENT_UNVERIFIED: 'announcement_fields_unverified',
  CAPITAL_ACTIONS_UNVERIFIED: 'capital_actions_unverified', CROSSCHECK_MISSING: 'crosscheck_missing',
  DIVIDEND_LEDGER_CODE_MISMATCH: 'dividend_ledger_code_mismatch', DIVIDEND_LEDGER_READ_FAILED: 'dividend_ledger_read_failed',
  DIVIDEND_RESEARCH_CACHE_UNAVAILABLE: 'research_cache_unavailable', INVALID_RESEARCH_CACHE: 'research_cache_unavailable',
  DIVIDEND_CHECK_ITEM_INVALID: 'dividend_check_item_invalid',
};
export const dividendCheckReasonCode = (reason: string) => reasonAliases[reason] ?? (reason.startsWith('CNINFO_') ? 'announcement_refresh_failed' : reason.toLowerCase());

export function dividendCheckReasonLabel(reason: string, eligibility: DividendCheckSummary['eligibility'], t: TFunction, exists: (key: string) => boolean) {
  if (reason.startsWith('rule_')) {
    const rule = reason.slice(5), check = eligibility.checks.find(item => item.rule === rule);
    const key = `div_ai_rule_label_${rule}`;
    return t(`div_check_rule_${check?.status === 'risk' ? 'failed' : check?.status === 'unknown' ? 'unknown' : 'review'}`, { rule: t(exists(key) ? key : 'div_check_reason_unknown') });
  }
  const code = dividendCheckReasonCode(reason);
  for (const key of [`div_check_reason_${code}`, `div_v2_pricing_gap_${code}`, `div_batch_stale_${code}`, `div_v4_topic_${code}`]) if (exists(key)) return t(key);
  return t('div_check_reason_unknown');
}
