import type { PortfolioNavSeriesPoint, PortfolioNavSummary } from './balanceFlow.ts';
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

/**
 * Unit NAV from holdings P&L only (realised + floating), so a manually adjusted
 * cash balance / deposits never distort the return. Positions are marked to the
 * current `lastPrice`; the ladder shows how buy/sell timing performed, not a
 * full historical mark-to-market.
 */
export function buildAccountNavPoints(accountId: string, holdings: readonly PnlHoldingLike[], txns: readonly PnlTxnLike[]): PnlNavPoint[] {
  const byDate = new Map<string, { pnl: number; cost: number }>();
  const txnsByHolding = new Map<string, PnlTxnLike[]>();
  for (const tx of txns) {
    if (tx.accountId !== accountId) continue;
    const list = txnsByHolding.get(tx.holdingId) ?? [];
    list.push(tx); txnsByHolding.set(tx.holdingId, list);
  }
  for (const holding of holdings) {
    if (holding.accountId !== accountId || holding.mode === 'balance') continue;
    const chron = (txnsByHolding.get(holding.id) ?? [])
      .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt || a.id.localeCompare(b.id));
    if (!chron.length) continue;
    const mark = Number.isFinite(holding.lastPrice) && holding.lastPrice > 0 ? holding.lastPrice : 0;
    const multiplier = getHoldingContractMultiplier(holding);
    let shares = 0, costBasis = 0, realizedPnl = 0, realizedCostBasis = 0;
    let previousPnl = 0, previousCost = 0;
    for (const tx of chron) {
      if (tx.quantitySnapshot != null) {
        const previousAvg = shares > 0 ? costBasis / (shares * multiplier) : 0;
        shares = Math.max(0, tx.quantitySnapshot);
        costBasis = shares * multiplier * (tx.costPriceSnapshot ?? previousAvg);
      } else if (tx.kind === 'sell') {
        const avg = shares > 0 ? costBasis / (shares * multiplier) : 0;
        const sold = Math.min(tx.shares, shares);
        realizedCostBasis += sold * multiplier * avg;
        realizedPnl += sold * multiplier * (tx.price - avg);
        costBasis -= sold * multiplier * avg;
        shares -= sold;
      } else {
        shares += tx.shares;
        costBasis += tx.shares * multiplier * tx.price;
      }
      if (shares < 1e-9) { shares = 0; costBasis = 0; }
      const marketValue = shares * multiplier * mark;
      const floatingPnl = marketValue - costBasis;
      const pnl = realizedPnl + floatingPnl;
      const buyCost = costBasis + realizedCostBasis;
      const entry = byDate.get(tx.date) ?? { pnl: 0, cost: 0 };
      // Sum changes, then carry the account's state through all transaction
      // dates. Multiple trades on one day collapse to each holding's final state.
      entry.pnl += pnl - previousPnl; entry.cost += buyCost - previousCost;
      byDate.set(tx.date, entry);
      previousPnl = pnl; previousCost = buyCost;
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
  const filtered = [...points].filter(point => !fromDate || point.date >= fromDate).sort((a, b) => a.date.localeCompare(b.date));
  const series: PortfolioNavSeriesPoint[] = [];
  // A zero starting value cannot be divided into a relative NAV. Retain the
  // recorded total loss rather than inventing a recovery or a non-finite value.
  const startingNav = filtered[0]?.nav ?? 1;
  const base = startingNav > 0 ? startingNav : 1;
  let peak = 1, maxDrawdown = 0;
  for (const point of filtered) {
    const nav = Math.round(point.nav / base * 10000) / 10000;
    if (nav > peak) peak = nav;
    const drawdown = peak > 0 ? Math.round(((peak - nav) / peak) * 10000) / 100 : 0;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;
    series.push({ date: point.date, nav, cumulativeReturnPercent: Math.round((nav - 1) * 10000) / 100, drawdownPercent: drawdown });
  }
  const latest = series.at(-1);
  return { series, latestNav: latest?.nav ?? 1, cumulativeReturnPercent: latest?.cumulativeReturnPercent ?? 0, maxDrawdownPercent: maxDrawdown };
}
