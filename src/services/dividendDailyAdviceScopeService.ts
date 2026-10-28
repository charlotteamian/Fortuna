import { loadDividendWorkbench } from './dividendService';
import { loadDividendPricingMethod, loadDividendSelectionPrinciples } from './dividendAdvisorActionsService';
import { loadDividendFundPositions } from './dividendAdvisorContextService';

/** Exclude market refresh timestamps; include every saved input and recorded holding used for advice. */
export async function loadDividendDailyAdvicePlanKey(data: Awaited<ReturnType<typeof loadDividendWorkbench>>) {
  const [principles, pricingMethod, fundPositions] = await Promise.all([
    loadDividendSelectionPrinciples(), loadDividendPricingMethod(), loadDividendFundPositions(data.fundPlan.funds),
  ]);
  return JSON.stringify({ budget: data.budgetConfigured ? data.budgetMinor : null, principles, pricingMethod,
    stocks: data.stocks.map(stock => ({ code: stock.code, name: stock.name, note: stock.note, group: stock.group, weight: stock.weightBps,
      shares: stock.shareMode === 'manual' ? stock.manualShares : data.positions.get(stock.code)?.shares ?? 0, lotSize: stock.lotSize,
      buyPaused: stock.buyPaused ?? false, buy: stock.buyLevels, sell: stock.sellLevels, dividend: stock.manualDpsMicros })),
    fundPlan: { ...data.fundPlan, funds: data.fundPlan.funds.map(fund => ({ id: fund.id, name: fund.name, code: fund.code, indexKind: fund.indexKind,
      weightBps: fund.weightBps, note: fund.note, reference: fund.reference, shares: fund.code ? fundPositions.get(fund.code) ?? 0 : null })) },
  });
}
