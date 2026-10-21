import type { DividendResearchSnapshot } from '../lib/dividendResearch.ts';
import type { DividendStock } from '../lib/dividendWorkbench.ts';
import { loadDividendSelectionPrinciples } from './dividendAdvisorActionsService.ts';
import { fetchDividendResearch } from './dividendResearchService.ts';
import { defaultDividendPricingMethod, type DividendPricingMethod } from '../lib/dividendPricing.ts';
import { loadDividendPricingMethod } from './dividendAdvisorActionsService.ts';

/** A cached research card supplies only identity. Every discussion uses a fresh request's evidence. */
export async function prepareDividendDiscussionResearch(current: DividendResearchSnapshot | undefined,
  targets: Pick<DividendStock, 'code' | 'name'>[],
  dependencies: { fetchResearch: typeof fetchDividendResearch; loadPrinciples: typeof loadDividendSelectionPrinciples; loadPricingMethod?: () => Promise<DividendPricingMethod> }
    = { fetchResearch: fetchDividendResearch, loadPrinciples: loadDividendSelectionPrinciples, loadPricingMethod: loadDividendPricingMethod }): Promise<DividendResearchSnapshot> {
  const principles = current?.principles ?? await dependencies.loadPrinciples();
  const pricingMethod = current?.pricingMethod ?? await dependencies.loadPricingMethod?.() ?? defaultDividendPricingMethod();
  const currentByCode = new Map(current?.stocks.map(stock => [stock.code, stock]) ?? []);
  const missing = targets.filter(target => !currentByCode.has(target.code)
    || currentByCode.get(target.code)!.issues.some(issue => issue.reason === 'deferred'));
  const refreshed = missing.length ? await dependencies.fetchResearch(missing, principles, { maxStocks: 20, timeBudgetMs: 15000, pricingMethod }) : undefined;
  const refreshedByCode = new Map(refreshed?.stocks.map(stock => [stock.code, stock]) ?? []);
  return {
    generatedAt: Date.now(), principles, pricingMethod, macro: current?.macro ?? refreshed?.macro,
    stocks: targets.flatMap(target => { const value = refreshedByCode.get(target.code) ?? currentByCode.get(target.code); return value ? [value] : []; }),
    indices: current?.indices ?? refreshed?.indices ?? [],
  };
}
