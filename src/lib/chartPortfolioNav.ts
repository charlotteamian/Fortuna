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
  priceDate?: string;
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
export function buildAccountNavPoints(accountId: string, holdings: readonly PnlHoldingLike[], txns: readonly PnlTxnLike[]): PnlNavPoint[] {
  const byDate = new Map<string, { pnl: number; cost: number }>();
  const txnsByHolding = new Map<string, PnlTxnLike[]>();
  for (const tx of txns) {
    if (tx.accountId !== accountId) continue;
    const list = txnsByHolding.get(tx.holdingId) ?? [];
    list.push(tx); txnsByHolding.set(tx.holdingId, list);
  }

  const prepared: {
    holding: PnlHoldingLike;
    chron: PnlTxnLike[];
    lastTxnDate: string;
    quoteDate: string | null;
  }[] = [];
  let finalDate = '';

  for (const holding of holdings) {
    if (holding.accountId !== accountId || holding.mode === 'balance') continue;
    const chron = (txnsByHolding.get(holding.id) ?? [])
      .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt || a.id.localeCompare(b.id));
    if (!chron.length) continue;
    let endShares = 0;
    for (const tx of chron) {
      if (tx.quantitySnapshot != null) endShares = Math.max(0, tx.quantitySnapshot);
      else if (tx.kind === 'sell') endShares = Math.max(0, endShares - Math.min(tx.shares, endShares));
      else endShares += tx.shares;
      if (endShares < 1e-9) endShares = 0;
    }
    const lastTxnDate = chron[chron.length - 1].date;
    const quoteDate = endShares > 1e-9 && isValidIsoDate(holding.priceDate) && holding.priceDate >= lastTxnDate
      ? holding.priceDate
      : null;
    if (lastTxnDate > finalDate) finalDate = lastTxnDate;
    if (quoteDate && quoteDate > finalDate) finalDate = quoteDate;
    prepared.push({ holding, chron, lastTxnDate, quoteDate });
  }

  if (!prepared.length) return [];

  for (const { holding, chron, lastTxnDate, quoteDate } of prepared) {
    const mark = Number.isFinite(holding.lastPrice) && holding.lastPrice > 0 ? holding.lastPrice : 0;
    const markDate = quoteDate ?? finalDate;
    const multiplier = getHoldingContractMultiplier(holding);
    let shares = 0, costBasis = 0, realizedPnl = 0, realizedCostBasis = 0;
    let knownPrice = 0;
    let previousPnl = 0, previousCost = 0;

    const recordState = (date: string, valuationPrice: number) => {
      const marketValue = shares * multiplier * valuationPrice;
      const floatingPnl = marketValue - costBasis;
      const pnl = realizedPnl + floatingPnl;
      const buyCost = costBasis + realizedCostBasis;
      const entry = byDate.get(date) ?? { pnl: 0, cost: 0 };
      // Sum changes, then carry the account's state through all valuation dates.
      entry.pnl += pnl - previousPnl;
      entry.cost += buyCost - previousCost;
      byDate.set(date, entry);
      previousPnl = pnl;
      previousCost = buyCost;
    };

    for (let i = 0; i < chron.length; i++) {
      const tx = chron[i];
      if (tx.quantitySnapshot != null) {
        const previousAvg = shares > 0 ? costBasis / (shares * multiplier) : 0;
        shares = Math.max(0, tx.quantitySnapshot);
        const nextAvg = tx.costPriceSnapshot ?? previousAvg;
        costBasis = shares * multiplier * nextAvg;
        if (tx.costPriceSnapshot != null && tx.costPriceSnapshot > 0) knownPrice = tx.costPriceSnapshot;
        else if (knownPrice === 0 && nextAvg > 0) knownPrice = nextAvg;
      } else if (tx.kind === 'sell') {
        const avg = shares > 0 ? costBasis / (shares * multiplier) : 0;
        const sold = Math.min(tx.shares, shares);
        realizedCostBasis += sold * multiplier * avg;
        realizedPnl += sold * multiplier * (tx.price - avg);
        costBasis -= sold * multiplier * avg;
        shares -= sold;
        if (tx.price > 0) knownPrice = tx.price;
      } else {
        shares += tx.shares;
        costBasis += tx.shares * multiplier * tx.price;
        if (tx.price > 0) knownPrice = tx.price;
      }
      if (shares < 1e-9) { shares = 0; costBasis = 0; }
      const isLastTxnOnDate = i === chron.length - 1 || chron[i + 1].date !== tx.date;
      if (isLastTxnOnDate) {
        const valuationPrice = tx.date >= markDate ? mark : knownPrice;
        recordState(tx.date, valuationPrice);
      }
    }

    if (shares > 1e-9 && markDate > lastTxnDate) {
      recordState(markDate, mark);
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
