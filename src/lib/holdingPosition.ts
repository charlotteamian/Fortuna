import type { HoldingTxn } from '../db';

export interface HoldingPosition {
  shares: number;
  avgCost: number;       // moving-average buy cost of the remaining position
  costBasis: number;     // shares * avgCost
  realizedPnl: number;   // accumulated realized P&L from sells
  realizedCostBasis: number; // accumulated moving-average cost of sold shares
  netInvested: number;   // costBasis - realizedPnl; remaining capital after sale proceeds
  dilutedCost: number;   // broker-style break-even cost per remaining share
}

export interface HoldingPnl {
  unrealizedPnl: number;
  totalPnl: number;
  totalPnlRate: number | null;
}

const POSITION_EPSILON = 1e-9;

export interface BalanceHoldingTimelineEntry {
  id: string;
  balance: number;
  underflow: boolean;
}

/** Balance-mode ledger: direct snapshots reset the anchor; principal flows continue from it. */
export function deriveBalanceHoldingTimeline(txns: HoldingTxn[]): BalanceHoldingTimelineEntry[] {
  const chron = [...txns].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt);
  let balance = 0;
  return chron.map(tx => {
    let underflow = false;
    if (tx.balanceSnapshot != null) {
      balance = Math.max(0, tx.balanceSnapshot);
    } else {
      const next = balance + (tx.kind === 'buy' ? tx.shares : -tx.shares);
      underflow = next < -0.005;
      balance = Math.max(0, next);
    }
    balance = Math.round(balance * 100) / 100;
    return { id: tx.id, balance, underflow };
  });
}

export function computeBalanceHoldingPosition(txns: HoldingTxn[]): HoldingPosition {
  const balance = deriveBalanceHoldingTimeline(txns).at(-1)?.balance ?? 0;
  return {
    shares: balance,
    avgCost: balance > POSITION_EPSILON ? 1 : 0,
    costBasis: balance,
    realizedPnl: 0,
    realizedCostBasis: 0,
    netInvested: balance,
    dilutedCost: balance > POSITION_EPSILON ? 1 : 0,
  };
}

/** Moving-average ledger math plus broker-style diluted cost. */
export function computeHoldingPosition(txns: HoldingTxn[], multiplier = 1): HoldingPosition {
  const safeMultiplier = Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1;
  const chron = [...txns].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt);
  let shares = 0;
  let costBasis = 0;
  let realizedPnl = 0;
  let realizedCostBasis = 0;

  for (const tx of chron) {
    if (tx.kind === 'sell') {
      const avg = shares > 0 ? costBasis / (shares * safeMultiplier) : 0;
      const sold = Math.min(tx.shares, shares);
      realizedCostBasis += sold * safeMultiplier * avg;
      realizedPnl += sold * safeMultiplier * (tx.price - avg);
      costBasis -= sold * safeMultiplier * avg;
      shares -= sold;
    } else {
      shares += tx.shares;
      costBasis += tx.shares * safeMultiplier * tx.price;
    }
    if (shares < POSITION_EPSILON) {
      shares = 0;
      costBasis = 0;
    }
  }

  const netInvested = costBasis - realizedPnl;

  return {
    shares,
    avgCost: shares > 0 ? costBasis / (shares * safeMultiplier) : 0,
    costBasis,
    realizedPnl,
    realizedCostBasis,
    netInvested,
    dilutedCost: shares > 0 ? netInvested / (shares * safeMultiplier) : 0,
  };
}

/** Cumulative P&L includes both the open position and every settled sell. */
export function computeHoldingPnl(position: HoldingPosition, marketValue: number): HoldingPnl {
  const unrealizedPnl = marketValue - position.costBasis;
  const totalPnl = unrealizedPnl + position.realizedPnl;
  // Open positions retain the broker-style diluted-capital return. Once fully sold,
  // use the historical cost of the settled shares; netInvested collapses to
  // -realizedPnl at that point and would otherwise manufacture -100% losses.
  const rateBasis = position.shares > POSITION_EPSILON
    ? position.netInvested
    : position.realizedCostBasis;
  return {
    unrealizedPnl,
    totalPnl,
    totalPnlRate: rateBasis > POSITION_EPSILON
      ? (totalPnl / rateBasis) * 100
      : null,
  };
}
