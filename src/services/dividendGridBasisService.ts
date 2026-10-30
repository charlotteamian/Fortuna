import { loadDividendResearchCache } from './dividendResearchCacheService';
import { loadSavedDividendLedger } from './dividendLedgerEvidenceService';
import { dividendLedgerBase } from '../lib/dividendLedger';
import type { DividendGridBasisCheck } from '../lib/dividendGridProvenance';

/** No downloads or date relabelling: old evidence remains provisional on the home page. */
export async function loadDividendGridBases(codes: string[], asOf: string): Promise<Record<string, DividendGridBasisCheck>> {
  const cache = await loadDividendResearchCache();
  const rows = await Promise.all(codes.map(async code => {
    const pricing = cache?.snapshot.stocks.find(stock => stock.code === code)?.pricing;
    const ledger = await loadSavedDividendLedger(code);
    if (ledger) {
      const annual = pricing?.annuals[0];
      const base = dividendLedgerBase(ledger, ledger.asOf < asOf ? ledger.asOf : asOf, { epsMicros: annual?.epsMicros, payoutBps: annual?.payoutBps });
      return [code, { ...base, verified: base.verified && ledger.asOf === asOf }] as const;
    }
    return [code, pricing?.dividendBase] as const;
  }));
  const result: Record<string, DividendGridBasisCheck> = {};
  for (const [code, basis] of rows) if (basis) result[code] = basis;
  return result;
}
