import { dividendLedgerBase, dividendLedgerNeedsOfficialReparse, type DividendLedger } from './dividendLedger.ts';

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
  if (dividendLedgerNeedsOfficialReparse(ledger)) {
    return { status: 'incomplete', usable: false, reasons: [...reasons, 'DIVIDEND_OFFICIAL_EXTRACTION_OUTDATED'] };
  }
  // Usability follows the key pricing inputs only: whether the required recent
  // batches normalise to a positive cash base. Pagination, announcement-fetch
  // failures and cross-day staleness stay visible as reasons but never block.
  let baseUsable = false;
  try { baseUsable = dividendLedgerBase(ledger, ledger.asOf).verified; } catch { /* Invalid required batches stay unusable. */ }
  if (!baseUsable) return { status: reasons.length ? 'incomplete' : 'missing', usable: false, reasons };
  const status = ledger.asOf === asOf ? 'current' : 'stale';
  return { status, usable: true, reasons: ledger.asOf === asOf ? reasons : [...reasons, 'DIVIDEND_LEDGER_STALE'] };
}
