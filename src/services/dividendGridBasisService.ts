import { hasCurrentUserDividendEvidence } from '../lib/dividendManualInputs.ts';
import { loadDividendResearchCache } from './dividendResearchCacheService';
import { loadDividendLedgerForCheck } from './dividendLedgerEvidenceService';
import { dividendLedgerBase } from '../lib/dividendLedger';
import type { DividendGridBasisCheck } from '../lib/dividendGridProvenance';
import { dividendEvidenceStatus, type DividendEvidenceStatus } from '../lib/dividendEvidenceStatus.ts';

export interface DividendGridBasisResult extends DividendGridBasisCheck {
  evidenceStatus: DividendEvidenceStatus['status'];
  evidenceIssues: string[];
  error?: string;
}

/** No downloads or date relabelling: old evidence remains provisional on the home page. */
export async function loadDividendGridBases(codes: string[], asOf: string): Promise<Record<string, DividendGridBasisResult>> {
  let cache: Awaited<ReturnType<typeof loadDividendResearchCache>>;
  let cacheError: string | undefined;
  try { cache = await loadDividendResearchCache(); }
  catch (error) { cacheError = error instanceof Error ? error.message : 'DIVIDEND_RESEARCH_CACHE_UNAVAILABLE'; }
  const rows = await Promise.all(codes.map(async code => {
    try {
      const pricing = cache?.snapshot.stocks.find(stock => stock.code === code)?.pricing;
      const ledger = await loadDividendLedgerForCheck(code) ?? pricing?.ledger;
      if (hasCurrentUserDividendEvidence(pricing, asOf, ledger)) return [code, { ...pricing!.dividendBase!, evidenceStatus: 'current', evidenceIssues: ['USER_CONFIRMED_INPUT'] } satisfies DividendGridBasisResult] as const;
      if (ledger) {
        if (ledger.code !== code) throw new Error('DIVIDEND_LEDGER_CODE_MISMATCH');
        const evidence = dividendEvidenceStatus(ledger, asOf);
        if (evidence.status === 'invalid') throw new Error('DIVIDEND_LEDGER_INVALID');
        const annual = pricing?.annuals[0];
        const base = dividendLedgerBase(ledger, ledger.asOf < asOf ? ledger.asOf : asOf, { epsMicros: annual?.epsMicros, payoutBps: annual?.payoutBps });
        return [code, { ...base, officialParserVersion: ledger.officialParserVersion, verified: base.verified && evidence.usable, evidenceStatus: evidence.status, evidenceIssues: evidence.reasons,
          ...(cacheError ? { error: cacheError } : {}) } satisfies DividendGridBasisResult] as const;
      }
      if (pricing?.dividendBase) {
        // An aggregate cached base has no independently readable source-coverage
        // record. Keep its cash/reference date but never promote it to verified.
        return [code, { ...pricing.dividendBase, verified: false,
          evidenceStatus: pricing.dividendBase.asOf === asOf ? 'missing' : 'stale', evidenceIssues: ['DIVIDEND_LEDGER_MISSING'],
          ...(cacheError ? { error: cacheError } : {}) } satisfies DividendGridBasisResult] as const;
      }
      return [code, cacheError ? { asOf, verified: false, evidenceStatus: 'missing', evidenceIssues: ['DIVIDEND_RESEARCH_CACHE_UNAVAILABLE'], error: cacheError } satisfies DividendGridBasisResult : undefined] as const;
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'DIVIDEND_LEDGER_READ_FAILED';
      return [code, { asOf, verified: false, evidenceStatus: 'invalid', evidenceIssues: [reason], error: reason } satisfies DividendGridBasisResult] as const;
    }
  }));
  const result: Record<string, DividendGridBasisResult> = {};
  for (const [code, basis] of rows) if (basis) result[code] = basis;
  return result;
}
