import { dividendLedgerBase, type DividendLedger } from './dividendLedger.ts';

export interface DividendEvidenceStatus {
  status: 'current' | 'stale' | 'incomplete' | 'failed' | 'missing' | 'invalid';
  usable: boolean;
  reasons: string[];
}

const validDate = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

/** Source coverage, not a new cash/earnings rule. A document's first verification
 * date stays intact when a successful current list reuses that exact document.
 * Unsupported old document fields remain visible; selected-batch verification
 * decides whether those fields are needed for the current cash numerator.
 */
export function dividendEvidenceStatus(ledger: DividendLedger | undefined, asOf: string): DividendEvidenceStatus {
  if (!ledger) return { status: 'missing', usable: false, reasons: ['DIVIDEND_LEDGER_MISSING'] };
  if (!validDate(asOf) || !validDate(ledger.asOf) || ledger.asOf > asOf || !Array.isArray(ledger.events)
    || !Array.isArray(ledger.issues) || !ledger.issues.every(issue => typeof issue === 'string') || typeof ledger.complete !== 'boolean') {
    return { status: 'invalid', usable: false, reasons: ['DIVIDEND_LEDGER_INVALID'] };
  }
  const reasons = [...new Set(ledger.issues)];
  if (reasons.some(issue => issue === 'ANNOUNCEMENT_REFRESH_FAILED' || issue === 'CURRENT_ANNOUNCEMENT_UNVERIFIED' || issue.startsWith('CNINFO_'))) {
    return { status: 'failed', usable: false, reasons };
  }
  if (!ledger.complete || reasons.some(issue => ['SOURCE_PAGES_INCOMPLETE', 'ANNOUNCEMENT_LIST_PARTIAL'].includes(issue))) {
    return { status: 'incomplete', usable: false, reasons: [...new Set([...reasons, ...(!ledger.complete ? ['SOURCE_COVERAGE_INCOMPLETE'] : [])])] };
  }
  // Full current source listings and the exact required cash/share batches are
  // sufficient for today's grid. A failed old PDF remains a historical gap;
  // it cannot turn a complete feed into fictional missing source pages.
  if (reasons.some(issue => ['ANNOUNCEMENT_DOWNLOAD_FAILED', 'ANNOUNCEMENT_VERIFICATION_PARTIAL'].includes(issue))) {
    let requiredBatchesVerified = false;
    try { requiredBatchesVerified = dividendLedgerBase(ledger, ledger.asOf).verified; } catch { /* Invalid required batches stay unverified. */ }
    if (!requiredBatchesVerified || !reasons.includes('HISTORICAL_ANNOUNCEMENT_GAPS')) return { status: reasons.includes('ANNOUNCEMENT_DOWNLOAD_FAILED') ? 'failed' : 'incomplete', usable: false, reasons };
  }
  if (ledger.asOf !== asOf) return { status: 'stale', usable: false, reasons: [...reasons, 'DIVIDEND_LEDGER_STALE'] };
  return { status: 'current', usable: true, reasons };
}
