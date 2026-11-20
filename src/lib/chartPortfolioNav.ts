import type { PortfolioNavSeriesPoint, PortfolioNavSummary } from './balanceFlow.ts';
import {
  analyzeHoldingPosition,
  isValidCommissionRatePercent,
  normalizeCommissionRatePercent,
  type HoldingDailyState,
} from './holdingPosition.ts';
import { getHoldingContractMultiplier } from './usOption.ts';

interface PortfolioAccountLike {
  id: string;
  type: 'asset' | 'liability';
  portfolio?: boolean;
  hidden?: boolean;
  archivedAt?: number;
}

interface PnlHoldingLike {
  id: string;
  accountId: string;
  mode?: string;
  lastPrice: number;
  priceDate?: string;
  commissionRatePercent?: number;
  instrumentType?: 'us_option';
  contractMultiplier?: number;
}

interface PnlTxnLike {
  id: string;
  accountId: string;
  holdingId: string;
  date: string;
  kind: 'buy' | 'sell';
  shares: number;
  price: number;
  fee?: number;
  quantitySnapshot?: number;
  costPriceSnapshot?: number;
  createdAt: number;
}

export interface PnlNavPoint {
  date: string;
  /** 1 + totalPnl / totalBuyCost, i.e. return on total capital deployed. */
  nav: number;
}

/** Statistics are an explicit opt-in for actual portfolio accounts, independent of global totals. */
export function getEligibleNavAccounts<T extends PortfolioAccountLike>(accounts: readonly T[]): T[] {
  return accounts.filter(account => account.type === 'asset' && account.portfolio === true && !account.hidden && !account.archivedAt);
}

export function normalizeNavAccountIds(ids: readonly string[] | undefined, accounts: readonly PortfolioAccountLike[]): string[] {
  const eligible = new Set(getEligibleNavAccounts(accounts).map(account => account.id));
  return [...new Set(Array.isArray(ids) ? ids : [])].filter(id => eligible.has(id));
}

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isValidIsoDate(value?: string): value is string {
  return typeof value === 'string' && ISO_DATE_PATTERN.test(value);
}

/**
 * Unit NAV from holdings P&L only (realised + floating), anchored to 1.0000 on
 * deployed capital so cash balances and deposits/withdrawals never distort the return.
 * Historical dates value open positions at each holding's latest known execution/cost
 * price as of that date, and adopt current `lastPrice` on the holding's valuation date.
 */
export function buildAccountNavPoints(
  accountId: string,
  holdings: readonly PnlHoldingLike[],
  txns: readonly PnlTxnLike[],
  defaultCommissionRatePercent = 0,
  accountCategory?: string,
): PnlNavPoint[] {
  const byDate = new Map<string, { pnl: number; cost: number }>();
  const txnsByHolding = new Map<string, PnlTxnLike[]>();
  for (const tx of txns) {
    if (tx.accountId !== accountId) continue;
    const list = txnsByHolding.get(tx.holdingId) ?? [];
    list.push(tx);
    txnsByHolding.set(tx.holdingId, list);
  }

  const prepared: {
    holding: PnlHoldingLike;
    dailyStates: HoldingDailyState[];
    lastTxnDate: string;
    quoteDate: string | null;
  }[] = [];
  let finalDate = '';

  const fallbackRate = accountCategory && !['股票/ETF', '股票'].includes(accountCategory)
    ? 0
    : normalizeCommissionRatePercent(defaultCommissionRatePercent, 0);

  for (const holding of holdings) {
    if (holding.accountId !== accountId || holding.mode === 'balance') continue;
    const holdingTxns = txnsByHolding.get(holding.id) ?? [];
    if (!holdingTxns.length) continue;
    const multiplier = getHoldingContractMultiplier(holding);
    const commissionRatePercent = isValidCommissionRatePercent(holding.commissionRatePercent)
      ? holding.commissionRatePercent
      : fallbackRate;
    const analysis = analyzeHoldingPosition(holdingTxns, multiplier, { commissionRatePercent });
    if (!analysis.dailyStates.length) continue;
    const lastState = analysis.dailyStates[analysis.dailyStates.length - 1];
    const lastTxnDate = lastState.date;
    const quoteDate = lastState.shares > 1e-9 && isValidIsoDate(holding.priceDate) && holding.priceDate >= lastTxnDate
      ? holding.priceDate
      : null;
    if (lastTxnDate > finalDate) finalDate = lastTxnDate;
    if (quoteDate && quoteDate > finalDate) finalDate = quoteDate;
    prepared.push({ holding, dailyStates: analysis.dailyStates, lastTxnDate, quoteDate });
  }

  if (!prepared.length) return [];

  for (const { holding, dailyStates, lastTxnDate, quoteDate } of prepared) {
    const mark = Number.isFinite(holding.lastPrice) && holding.lastPrice > 0 ? holding.lastPrice : 0;
    const markDate = quoteDate ?? finalDate;
    const multiplier = getHoldingContractMultiplier(holding);
    let previousPnl = 0, previousCost = 0;

    const recordState = (state: HoldingDailyState, date: string, valuationPrice: number) => {
      const marketValue = state.shares * multiplier * valuationPrice;
      const floatingPnl = marketValue - state.costBasis;
      const pnl = state.realizedPnl + floatingPnl;
      const buyCost = state.costBasis + state.realizedCostBasis;
      const entry = byDate.get(date) ?? { pnl: 0, cost: 0 };
      // Sum changes, then carry the account's state through all valuation dates.
      entry.pnl += pnl - previousPnl;
      entry.cost += buyCost - previousCost;
      byDate.set(date, entry);
      previousPnl = pnl;
      previousCost = buyCost;
    };

    for (const state of dailyStates) {
      const valuationPrice = state.date >= markDate ? mark : state.knownPrice;
      recordState(state, state.date, valuationPrice);
    }

    const lastState = dailyStates[dailyStates.length - 1];
    if (lastState.shares > 1e-9 && markDate > lastTxnDate) {
      recordState(lastState, markDate, mark);
    }
  }

  let totalPnl = 0, totalCost = 0;
  return [...byDate.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, { pnl, cost }]) => {
      totalPnl += pnl; totalCost += cost;
      return { date, nav: totalCost > 0 ? Math.max(0, 1 + totalPnl / totalCost) : 1 };
    });
}

export function summarizeAccountNav(points: readonly PnlNavPoint[], fromDate?: string): PortfolioNavSummary {
  const ordered = [...points].sort((a, b) => a.date.localeCompare(b.date));
  const filtered = fromDate ? ordered.filter(point => point.date >= fromDate) : ordered;
  const trimmed = Boolean(fromDate) && filtered.length < ordered.length;
  const series: PortfolioNavSeriesPoint[] = [];
  // Each point.nav is already anchored to 1.0000 on deployed capital. Do not re-divide
  // by filtered[0].nav: doing so discards day-1 P&L and can turn a losing portfolio whose
  // earlier purchases fell more than later buys into an artificial positive return.
  let peak = trimmed ? Math.max(0, filtered[0]?.nav ?? 1) : 1;
  let maxDrawdown = 0;
  for (const point of filtered) {
    const nav = Math.round(Math.max(0, point.nav) * 10000) / 10000;
    if (nav > peak) peak = nav;
    const drawdown = (peak > 0 ? Math.round(((peak - nav) / peak) * 10000) / 100 : 0) || 0;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;
    const cumulativeReturnPercent = Math.round((nav - 1) * 10000) / 100 || 0;
    series.push({ date: point.date, nav, cumulativeReturnPercent, drawdownPercent: drawdown });
  }
  const latest = series.at(-1);
  return { series, latestNav: latest?.nav ?? 1, cumulativeReturnPercent: latest?.cumulativeReturnPercent ?? 0, maxDrawdownPercent: maxDrawdown };
}
