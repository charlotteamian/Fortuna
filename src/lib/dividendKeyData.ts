/** Reasons that represent genuinely missing key pricing inputs — the only "real
 * problems" worth listing individually. Everything else (screening financial
 * metrics, cross-check, historical samples, report freshness, etc.) is an
 * observation that neither blocks pricing nor warrants a per-item display. */
export const KEY_DATA_REASONS = new Set([
  'dividend_ledger_missing', 'dividend_base_unverified', 'trailing_dividend_zero',
  'quote_missing', 'quote_refresh_failed', 'quote_invalid', 'quote_stale', 'quote_future',
  'quote_before_ex', 'quote_prior_date', 'quote_time_missing',
  'research_missing', 'pricing_invalid', 'grid_unavailable',
  'dividend_extraction_changed', 'dividend_official_extraction_outdated',
]);

export function isKeyDataReason(reason: string): boolean {
  return KEY_DATA_REASONS.has(reason);
}
