import { v4 as uuidv4 } from 'uuid';
import { db, type Holding, type HoldingTxn } from '../db';
import { addRecord } from './assetService';
import { getDefaultHoldingModeForCategory, getHoldingMode, usesBalanceHoldings } from '../lib/productPortfolio';

// ---- Holding CRUD ----
export async function getHoldings(accountId: string): Promise<Holding[]> {
  const list = await db.holdings.where('accountId').equals(accountId).toArray();
  return list.sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt - b.createdAt);
}

export async function createHolding(accountId: string, data: Pick<Holding, 'name' | 'symbol' | 'market' | 'mode' | 'productData' | 'lastPrice' | 'priceDate'>): Promise<string> {
  const count = await db.holdings.where('accountId').equals(accountId).count();
  const id = uuidv4();
  await db.holdings.add({ ...data, id, accountId, sortOrder: count, createdAt: Date.now() });
  return id;
}

export async function updateHolding(id: string, updates: Partial<Holding>): Promise<void> {
  await db.holdings.update(id, updates);
}

export async function deleteHolding(id: string): Promise<void> {
  const h = await db.holdings.get(id);
  await db.holdingTxns.where('holdingId').equals(id).delete();
  await db.holdings.delete(id);
  if (h) await syncPortfolioSnapshot(h.accountId);
}

// ---- Transactions ----
export async function getAccountTxns(accountId: string): Promise<HoldingTxn[]> {
  const list = await db.holdingTxns.where('accountId').equals(accountId).toArray();
  return list.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
}

export interface HoldingTxnInput { date: string; kind: 'buy' | 'sell'; shares: number; price: number; note?: string; }

export async function addHoldingTxn(accountId: string, holdingId: string, input: HoldingTxnInput): Promise<string> {
  const id = uuidv4();
  await db.holdingTxns.add({ id, accountId, holdingId, createdAt: Date.now(), ...input });
  await touchPriceFromTxn(holdingId, input);
  await syncPortfolioSnapshot(accountId);
  return id;
}

export async function updateHoldingTxn(txnId: string, input: HoldingTxnInput): Promise<void> {
  const txn = await db.holdingTxns.get(txnId);
  if (!txn) return;
  await db.holdingTxns.update(txnId, { ...input });
  await touchPriceFromTxn(txn.holdingId, input);
  await syncPortfolioSnapshot(txn.accountId);
}

export async function deleteHoldingTxn(txnId: string): Promise<void> {
  const txn = await db.holdingTxns.get(txnId);
  await db.holdingTxns.delete(txnId);
  if (txn) await syncPortfolioSnapshot(txn.accountId);
}

/** A transaction at or after the holding's quote date is the freshest price we know — adopt it. */
async function touchPriceFromTxn(holdingId: string, input: HoldingTxnInput): Promise<void> {
  const h = await db.holdings.get(holdingId);
  if (!h || input.price <= 0) return;
  if (!h.priceDate || input.date >= h.priceDate) {
    await db.holdings.update(holdingId, { lastPrice: input.price, priceDate: input.date });
  }
}

// ---- Position math (moving average cost, same convention as metals) ----
export interface HoldingPosition {
  shares: number;
  avgCost: number;       // weighted average cost per share of the current position
  costBasis: number;     // shares * avgCost
  realizedPnl: number;   // accumulated realized P&L from sells
}

export function computeHoldingPosition(txns: HoldingTxn[]): HoldingPosition {
  const chron = [...txns].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt);
  let shares = 0, costBasis = 0, realizedPnl = 0;
  for (const tx of chron) {
    if (tx.kind === 'sell') {
      const avg = shares > 0 ? costBasis / shares : 0;
      const sold = Math.min(tx.shares, shares);
      realizedPnl += sold * (tx.price - avg);
      costBasis -= sold * avg;
      shares -= sold;
    } else {
      shares += tx.shares;
      costBasis += tx.shares * tx.price;
    }
    if (shares < 1e-9) { shares = 0; costBasis = 0; }
  }
  return { shares, avgCost: shares > 0 ? costBasis / shares : 0, costBasis, realizedPnl };
}

export interface HoldingWithPosition extends Holding {
  position: HoldingPosition;
  marketValue: number;     // position.shares * lastPrice
  unrealizedPnl: number;
}

export async function getHoldingsWithPositions(accountId: string): Promise<HoldingWithPosition[]> {
  const [account, holdings, txns] = await Promise.all([db.accounts.get(accountId), getHoldings(accountId), getAccountTxns(accountId)]);
  return holdings.map(h => {
    const position = computeHoldingPosition(txns.filter(tx => tx.holdingId === h.id));
    const mode = getHoldingMode(account?.category ?? '', h);
    const marketValue = mode === 'balance' ? position.shares : position.shares * (h.lastPrice || 0);
    return { ...h, position, marketValue, unrealizedPnl: marketValue - position.costBasis };
  });
}

// ---- Account-level value ----
export async function setCashBalance(accountId: string, cash: number): Promise<void> {
  await db.accounts.update(accountId, { cashBalance: cash });
  await syncPortfolioSnapshot(accountId);
}

/** Apply new quotes (holdingId → price) in one pass, then refresh the snapshot once. */
export async function updatePrices(accountId: string, prices: Record<string, number>, date: string): Promise<void> {
  for (const [holdingId, price] of Object.entries(prices)) {
    if (price > 0) await db.holdings.update(holdingId, { lastPrice: price, priceDate: date });
  }
  await syncPortfolioSnapshot(accountId);
}

export async function setHoldingBalance(accountId: string, holdingId: string, targetBalance: number, date: string, note?: string): Promise<void> {
  const safeTarget = Math.max(0, targetBalance);
  const account = await db.accounts.get(accountId);
  const holding = await db.holdings.get(holdingId);
  if (!account || !holding || !usesBalanceHoldings(account.category, holding)) return;

  if (!holding.mode) {
    await db.holdings.update(holdingId, { mode: getDefaultHoldingModeForCategory(account.category), lastPrice: 1, priceDate: date });
  }

  const txns = await db.holdingTxns.where('holdingId').equals(holdingId).toArray();
  const current = computeHoldingPosition(txns).shares;
  const delta = Math.round((safeTarget - current) * 100) / 100;
  if (Math.abs(delta) < 0.005) {
    await syncPortfolioSnapshot(accountId);
    return;
  }

  await addHoldingTxn(accountId, holdingId, {
    date,
    kind: delta >= 0 ? 'buy' : 'sell',
    shares: Math.abs(delta),
    price: 1,
    note,
  });
}

export async function updateBalances(accountId: string, balances: Record<string, number>, date: string): Promise<void> {
  for (const [holdingId, balance] of Object.entries(balances)) {
    if (balance >= 0) await setHoldingBalance(accountId, holdingId, balance, date);
  }
  await syncPortfolioSnapshot(accountId);
}

async function getLatestAccountAmount(accountId: string): Promise<{ amount: number; date: string } | null> {
  const latest = (await db.records.where('accountId').equals(accountId).toArray())
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt)[0];
  return latest ? { amount: latest.amount, date: latest.date } : null;
}

async function getPortfolioTotal(accountId: string): Promise<number> {
  const account = await db.accounts.get(accountId);
  const withPos = await getHoldingsWithPositions(accountId);
  const total = (account?.cashBalance || 0) + withPos.reduce((s, h) => s + h.marketValue, 0);
  return Math.round(total * 100) / 100;
}

async function upsertTodayAccountRecord(accountId: string, amount: number): Promise<void> {
  const today = new Date().toISOString().split('T')[0];
  const todayRecs = (await db.records.where('accountId').equals(accountId).toArray())
    .filter(r => r.date === today)
    .sort((a, b) => b.createdAt - a.createdAt);
  if (todayRecs.length > 0) await db.records.update(todayRecs[0].id, { amount });
  else await addRecord(accountId, today, amount);
}

export async function setAccountPortfolioMode(accountId: string, portfolio: boolean): Promise<void> {
  const account = await db.accounts.get(accountId);
  if (!account) return;

  if (portfolio) {
    if (account.portfolio) {
      await syncPortfolioSnapshot(accountId);
      return;
    }
    await db.accounts.update(accountId, { portfolio: true });

    const holdingCount = await db.holdings.where('accountId').equals(accountId).count();
    if (holdingCount > 0) {
      await syncPortfolioSnapshot(accountId);
      return;
    }

    const latest = await getLatestAccountAmount(accountId);
    if (!latest || latest.amount <= 0) {
      await syncPortfolioSnapshot(accountId);
      return;
    }

    const mode = getDefaultHoldingModeForCategory(account.category);
    const id = await createHolding(accountId, {
      name: account.name,
      symbol: mode === 'unit' ? account.productData?.code : undefined,
      market: mode === 'unit' ? account.productData?.market : undefined,
      mode,
      productData: mode === 'balance' ? account.productData : undefined,
      lastPrice: 1,
      priceDate: latest.date,
    });
    await addHoldingTxn(accountId, id, { date: latest.date, kind: 'buy', shares: latest.amount, price: 1 });
    return;
  }

  if (!account.portfolio) return;
  const total = await getPortfolioTotal(accountId);
  await db.accounts.update(accountId, { portfolio: undefined, cashBalance: undefined });
  await upsertTodayAccountRecord(accountId, total);
}

/**
 * Portfolio accounts keep the regular records pipeline working by writing the current
 * total value (cash + Σ shares × lastPrice) as today's snapshot record — at most one per day.
 * Charts, totals and exports then need no special-casing.
 */
export async function syncPortfolioSnapshot(accountId: string): Promise<void> {
  const account = await db.accounts.get(accountId);
  if (!account?.portfolio) return;
  const withPos = await getHoldingsWithPositions(accountId);
  const total = (account.cashBalance || 0) + withPos.reduce((s, h) => s + h.marketValue, 0);
  const rounded = Math.round(total * 100) / 100;
  const today = new Date().toISOString().split('T')[0];
  const todayRecs = (await db.records.where('accountId').equals(accountId).toArray())
    .filter(r => r.date === today)
    .sort((a, b) => b.createdAt - a.createdAt);
  if (todayRecs.length > 0) await db.records.update(todayRecs[0].id, { amount: rounded });
  else await addRecord(accountId, today, rounded);
}
