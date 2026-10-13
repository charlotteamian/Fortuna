import type { HoldingTxn } from '../db';

export interface HoldingTradeSideSummary {
  count: number;
  shares: number;
  amountMinor: number;
  averagePrice: number | null;
}

/** Recorded fills only: calibration anchors are not purchases or sales. */
export function summarizeHoldingTrades(txns: HoldingTxn[], multiplier = 1) {
  const safeMultiplier = Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1;
  const buys: HoldingTradeSideSummary = { count: 0, shares: 0, amountMinor: 0, averagePrice: null };
  const sells: HoldingTradeSideSummary = { count: 0, shares: 0, amountMinor: 0, averagePrice: null };
  let adjustmentCount = 0;
  let firstDate: string | null = null;
  let lastDate: string | null = null;
  let buyValue = 0;
  let sellValue = 0;

  for (const tx of txns) {
    if (tx.quantitySnapshot != null || tx.balanceSnapshot != null) {
      adjustmentCount += 1;
      continue;
    }
    const side = tx.kind === 'buy' ? buys : sells;
    const value = tx.shares * tx.price;
    side.count += 1;
    side.shares += tx.shares;
    // Round each recorded fill to cents before summing, matching the detail rows.
    side.amountMinor += Math.round(value * safeMultiplier * 100);
    if (tx.kind === 'buy') buyValue += value;
    else sellValue += value;
    if (firstDate == null || tx.date < firstDate) firstDate = tx.date;
    if (lastDate == null || tx.date > lastDate) lastDate = tx.date;
  }
  buys.averagePrice = buys.shares > 0 ? buyValue / buys.shares : null;
  sells.averagePrice = sells.shares > 0 ? sellValue / sells.shares : null;
  return { buys, sells, firstDate, lastDate, adjustmentCount };
}
