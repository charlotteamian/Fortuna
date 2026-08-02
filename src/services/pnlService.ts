import { db, initializeSettings, type AccountRecord, type Holding, type HoldingTxn } from '../db';
import { getHoldingContractMultiplier } from '../lib/usOption';
import { convertAmountFromCache } from './rateService';
import { isAccountHidden } from '../lib/accountPreferences';

export interface MonthlyPnl {
  month: string;    // 'YYYY-MM'
  realized: number; // realized P&L in primary currency
}

interface RealizedEvent { date: string; amount: number; currency: string; }

// Realized P&L events (one per sell) using moving-average cost — the same convention as
// computeHoldingPosition / computeMetalPosition. Because it walks every sell in history,
// sold-out (archived) holdings are naturally included: their sells still contribute.
export function holdingRealizedEvents(
  txns: Pick<HoldingTxn, 'date' | 'kind' | 'shares' | 'price' | 'createdAt'>[],
  currency: string,
  holding: Pick<Holding, 'instrumentType' | 'contractMultiplier'> = {},
): RealizedEvent[] {
  const multiplier = getHoldingContractMultiplier(holding);
  const chron = [...txns].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt);
  let shares = 0, costBasis = 0;
  const events: RealizedEvent[] = [];
  for (const tx of chron) {
    if (tx.kind === 'sell') {
      const avg = shares > 0 ? costBasis / (shares * multiplier) : 0;
      const sold = Math.min(tx.shares, shares);
      events.push({ date: tx.date, amount: sold * multiplier * (tx.price - avg), currency });
      costBasis -= sold * multiplier * avg;
      shares -= sold;
    } else {
      shares += tx.shares;
      costBasis += tx.shares * multiplier * tx.price;
    }
    if (shares < 1e-9) { shares = 0; costBasis = 0; }
  }
  return events;
}

// Same logic for precious-metal accounts, whose buy/sell deltas live on their records.
// Sells with no recorded price can't yield a real P&L, so they adjust the position but
// don't emit a (bogus) event.
function metalRealizedEvents(
  records: { date: string; kind?: 'buy' | 'sell'; deltaGrams?: number; amount: number; pricePerGram?: number; createdAt: number }[],
  currency: string,
): RealizedEvent[] {
  const chron = [...records].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt);
  let grams = 0, costBasis = 0;
  const events: RealizedEvent[] = [];
  for (const r of chron) {
    const g = r.deltaGrams ?? Math.abs(r.amount);
    const price = r.pricePerGram ?? 0;
    if (r.kind === 'sell') {
      const avg = grams > 0 ? costBasis / grams : 0;
      const sold = Math.min(g, grams);
      if (price > 0) events.push({ date: r.date, amount: sold * (price - avg), currency });
      costBasis -= sold * avg;
      grams -= sold;
    } else {
      grams += g;
      costBasis += g * price;
    }
    if (grams < 1e-9) { grams = 0; costBasis = 0; }
  }
  return events;
}

/**
 * Realized P&L per calendar month across every portfolio holding and precious-metal
 * account, converted to the primary currency. Includes sold-out (archived) holdings.
 */
export async function getMonthlyRealizedPnl(): Promise<MonthlyPnl[]> {
  const [settings, accounts, holdings, holdingTxns] = await Promise.all([
    initializeSettings(),
    db.accounts.toArray(),
    db.holdings.toArray(),
    db.holdingTxns.toArray(),
  ]);
  const primary = settings.primaryCurrency;
  const visibleAccounts = accounts.filter(account => !isAccountHidden(account));
  const acctById = new Map(visibleAccounts.map(a => [a.id, a]));
  const events: RealizedEvent[] = [];

  // Portfolio holdings (stocks / ETFs / funds / futures ...)
  const txnsByHolding: Record<string, typeof holdingTxns> = {};
  for (const tx of holdingTxns) (txnsByHolding[tx.holdingId] ??= []).push(tx);
  for (const h of holdings) {
    const acct = acctById.get(h.accountId);
    const txns = txnsByHolding[h.id];
    if (!acct || !txns?.length) continue;
    events.push(...holdingRealizedEvents(txns, acct.currency, h));
  }

  // Precious-metal accounts
  const metalAccounts = visibleAccounts.filter(a => a.unit === 'gram');
  if (metalAccounts.length) {
    const recByAccount: Record<string, AccountRecord[]> = {};
    for (const r of await db.records.toArray()) (recByAccount[r.accountId] ??= []).push(r);
    for (const a of metalAccounts) {
      const recs = recByAccount[a.id];
      if (recs?.length) events.push(...metalRealizedEvents(recs, a.currency));
    }
  }

  // Sum per (month, currency) first so we do at most one FX conversion per bucket.
  const rawByMonthCcy: Record<string, number> = {};
  for (const e of events) {
    if (Math.abs(e.amount) < 1e-9) continue;
    const key = `${e.date.slice(0, 7)}|${e.currency}`;
    rawByMonthCcy[key] = (rawByMonthCcy[key] || 0) + e.amount;
  }
  const byMonth: Record<string, number> = {};
  for (const [key, amount] of Object.entries(rawByMonthCcy)) {
    const [month, currency] = key.split('|');
    const converted = currency === primary ? amount : await convertAmountFromCache(amount, currency, primary);
    if (converted === undefined) continue;
    byMonth[month] = (byMonth[month] || 0) + converted;
  }

  return Object.entries(byMonth)
    .map(([month, realized]) => ({ month, realized: Math.round(realized * 100) / 100 }))
    .sort((a, b) => a.month.localeCompare(b.month));
}
