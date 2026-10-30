import { dividendCheckSummary, dividendFundCheckSummary, type DividendStockCheckSummary } from '../lib/dividendCheckSummary';
import { dateInChina, type DividendStock, type LinkedDividendPosition } from '../lib/dividendWorkbench';
import type { DividendFundPlan } from '../lib/dividendFundPlan';
import { defaultDividendPricingMethod } from '../lib/dividendPricing';
import { defaultDividendSelectionPrinciples } from '../lib/dividendResearch';
import { db } from '../db';
import { loadDividendGridBases } from './dividendGridBasisService';
import { loadDividendLedgerForCheck } from './dividendLedgerEvidenceService';
import { dividendResearchSnapshotForStock, loadDividendResearchCache, type SavedDividendResearch } from './dividendResearchCacheService';

interface CheckWorkbench {
  stocks: DividendStock[];
  budgetMinor: number;
  budgetConfigured: boolean;
  positions: Map<string, LinkedDividendPosition>;
  fundPlan: DividendFundPlan;
}

/** Read existing evidence only. No downloads, plan changes, cache repairs or new storage. */
export async function loadDividendCheckSummaries(workbench: CheckWorkbench, options: {
  asOf?: string; now?: number; researchCache?: SavedDividendResearch; fundPositions?: Map<string, number>;
} = {}) {
  const now = options.now ?? Date.now(), asOf = options.asOf ?? dateInChina(new Date(now));
  const [cache, settings, bases] = await Promise.all([
    options.researchCache ?? loadDividendResearchCache().catch(() => null),
    db.settings.get('main'),
    loadDividendGridBases(workbench.stocks.map(stock => stock.code), asOf),
  ]);
  // Match the existing executor's legacy-method view without initializing or
  // migrating settings during this read-only inspection.
  const stored = settings?.dividendPricingMethod;
  const pricingMethod = !stored ? defaultDividendPricingMethod() : stored.strategy === 'recent_batches' ? stored
    : { ...stored, strategy: 'recent_batches' as const, holdingPeriod: 'month_to_year' as const };
  const principles = settings?.dividendSelectionPrinciples ?? defaultDividendSelectionPrinciples();
  const stocks: Record<string, DividendStockCheckSummary> = {};
  await Promise.all(workbench.stocks.map(async stock => {
    const snapshot = cache ? dividendResearchSnapshotForStock(cache, stock.code) : undefined;
    const research = snapshot?.stocks[0];
    let ledger;
    try { ledger = await loadDividendLedgerForCheck(stock.code); }
    catch { /* The basis loader already exposes the item-specific evidence failure. */ }
    const shared = { stock, pricingMethod, principles,
      totalBudgetMinor: workbench.budgetConfigured ? workbench.budgetMinor : undefined,
      shares: stock.shareMode === 'manual' ? stock.manualShares : workbench.positions.get(stock.code)?.shares ?? 0,
      asOf, now };
    try {
      stocks[stock.code] = dividendCheckSummary({ ...shared, research, basis: bases[stock.code], ledger,
        indices: snapshot?.indices, researchGeneratedAt: snapshot?.generatedAt });
    } catch {
      // Keep the saved stock and its explicit prices visible. A malformed item
      // must neither erase evidence nor stop other stocks from being checked.
      stocks[stock.code] = dividendCheckSummary({ ...shared, stock: { ...stock, quote: undefined },
        basis: { asOf, verified: false, evidenceStatus: 'invalid', evidenceIssues: ['DIVIDEND_CHECK_ITEM_INVALID'] } });
    }
  }));
  const funds = Object.fromEntries(workbench.fundPlan.funds.map(fund => [fund.id, dividendFundCheckSummary({
    plan: workbench.fundPlan, fund, shares: fund.code ? options.fundPositions?.get(fund.code) : undefined, asOf, now,
  })]));
  return { stocks, funds };
}
