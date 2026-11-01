import { loadDividendWorkbench } from './dividendService';
import { loadDividendFundPositions } from './dividendAdvisorContextService';
import { loadDividendCheckSummaries } from './dividendCheckSummaryService';
import { db } from '../db';
import { dividendStockEditFingerprint } from './dividendService';
import { defaultDividendPricingMethod } from '../lib/dividendPricing';
import { defaultDividendSelectionPrinciples } from '../lib/dividendResearch';
import { dividendDailySemanticFingerprint } from '../lib/dividendDailyCheck';

/** User-owned inputs only; source refreshes and reading preferences do not
 * change this guard. The hash stores no account names or transaction details. */
export async function loadDividendDailyCheckInputKey(): Promise<string> {
  const [stocks, settings, accounts, holdings, txns] = await Promise.all([
    db.dividendStocks.toArray(), db.settings.get('main'), db.accounts.toArray(), db.holdings.toArray(), db.holdingTxns.toArray(),
  ]);
  const fundPlan = settings?.dividendFundPlan;
  const input = JSON.stringify({ budget: settings?.dividendBudgetMinor ?? null,
    principles: settings?.dividendSelectionPrinciples, pricingMethod: settings?.dividendPricingMethod,
    stocks: stocks.sort((a, b) => a.code.localeCompare(b.code)).map(dividendStockEditFingerprint),
    fundPlan: fundPlan && { ...fundPlan, funds: fundPlan.funds.map(fund => ({ ...fund, quote: undefined, quoteFailedAt: undefined })) },
    accounts, holdings: holdings.map(holding => ({ ...holding, lastPrice: undefined })), txns });
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input)))].map(value => value.toString(16).padStart(2, '0')).join('');
}

/** Exclude market refresh timestamps; include every saved input and recorded holding used for advice. */
export async function loadDividendDailyAdvicePlanKey(data: Awaited<ReturnType<typeof loadDividendWorkbench>>, suppliedChecks?: Awaited<ReturnType<typeof loadDividendCheckSummaries>>) {
  const [settings, fundPositions] = await Promise.all([db.settings.get('main'), loadDividendFundPositions(data.fundPlan.funds)]);
  const principles = settings?.dividendSelectionPrinciples ?? defaultDividendSelectionPrinciples();
  const stored = settings?.dividendPricingMethod;
  const pricingMethod = !stored ? defaultDividendPricingMethod() : stored.strategy === 'recent_batches' ? stored
    : { ...stored, strategy: 'recent_batches' as const, holdingPeriod: 'month_to_year' as const };
  const checks = suppliedChecks ?? await loadDividendCheckSummaries(data, { fundPositions });
  const semanticInput = JSON.stringify([...Object.entries(checks.stocks), ...Object.entries(checks.funds)]
    .sort(([a], [b]) => a.localeCompare(b)).map(([id, check]) => [id, dividendDailySemanticFingerprint(check)]));
  const semanticHash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(semanticInput)))].map(value => value.toString(16).padStart(2, '0')).join('');
  return JSON.stringify({ budget: data.budgetConfigured ? data.budgetMinor : null, principles, pricingMethod, checkState: semanticHash,
    stocks: data.stocks.map(stock => ({ code: stock.code, name: stock.name, note: stock.note, group: stock.group, weight: stock.weightBps,
      shares: stock.shareMode === 'manual' ? stock.manualShares : data.positions.get(stock.code)?.shares ?? 0, lotSize: stock.lotSize,
      buyPaused: stock.buyPaused ?? false, buy: stock.buyLevels, sell: stock.sellLevels, dividend: stock.manualDpsMicros })),
    fundPlan: { ...data.fundPlan, funds: data.fundPlan.funds.map(fund => ({ id: fund.id, name: fund.name, code: fund.code, indexKind: fund.indexKind,
      weightBps: fund.weightBps, note: fund.note, reference: fund.reference, shares: fund.code ? fundPositions.get(fund.code) ?? 0 : null })) },
  });
}
