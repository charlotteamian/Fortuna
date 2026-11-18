import { dateInChina, sortDividendStocks, type DividendStock } from '../lib/dividendWorkbench';
import { buildClassicStockPlan, type ClassicStockPlan, type ClassicTaxRateBps } from '../lib/dividendClassicStrategy';
import { getClassicAdviceFacts } from '../lib/dividendClassicAdvice';
import { loadDividendWorkbenchReadOnly } from './dividendService';
import { loadDividendGridBases, type DividendGridBasisResult } from './dividendGridBasisService';
import { loadDividendPricingMethod } from './dividendAdvisorActionsService';

/** One dividend stock with its classic four-buy/four-sell grid and today's trigger facts. */
export interface DividendStockBoardRow {
  stock: DividendStock;
  plan: ClassicStockPlan;
  facts: ReturnType<typeof getClassicAdviceFacts>;
}

export interface DividendPlanBoard {
  stocks: DividendStockBoardRow[];
  taxBps: ClassicTaxRateBps;
  asOf: string;
  budgetMinor: number;
  budgetConfigured: boolean;
}

/** Read-only overview of the dividend stock plan for the allocation plan page.
 * Shares the same saved grids, bases and pricing method as the workbench. */
export async function loadDividendPlanBoard(): Promise<DividendPlanBoard> {
  const workbench = await loadDividendWorkbenchReadOnly();
  const asOf = dateInChina();
  const [pricingMethod, bases] = await Promise.all([
    loadDividendPricingMethod().catch(() => null),
    loadDividendGridBases(workbench.stocks.map(stock => stock.code), asOf)
      .catch(() => ({}) as Record<string, DividendGridBasisResult>),
  ]);
  const taxBps: ClassicTaxRateBps = !pricingMethod
    ? 1000
    : pricingMethod.holdingPeriod === 'over_year'
      ? 0
      : pricingMethod.holdingPeriod === 'up_to_month'
        ? 2000
        : 1000;
  const sharesFor = (stock: DividendStock) =>
    stock.shareMode === 'manual' ? stock.manualShares : workbench.positions.get(stock.code)?.shares ?? 0;
  const stocks = sortDividendStocks(workbench.stocks, sharesFor).map(stock => {
    const plan = buildClassicStockPlan(stock, {
      totalBudgetMinor: workbench.budgetConfigured ? workbench.budgetMinor : undefined,
      shares: sharesFor(stock),
      taxBps,
      asOf,
      basis: bases[stock.code],
      buyYieldBps: pricingMethod?.buyYieldBps,
      sellYieldBps: pricingMethod?.sellYieldBps,
    });
    return { stock, plan, facts: getClassicAdviceFacts(plan, asOf) };
  });
  return { stocks, taxBps, asOf, budgetMinor: workbench.budgetMinor, budgetConfigured: workbench.budgetConfigured };
}
