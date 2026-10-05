import { v4 as uuidv4 } from 'uuid';
import { db, type Holding, type HoldingTxn } from '../db';
import { addRecord } from './assetService';
import { getDefaultHoldingModeForCategory, getHoldingMode, usesBalanceHoldings } from '../lib/productPortfolio';
import {
  computeBalanceHoldingPosition,
  computeHoldingPnl,
  computeHoldingPosition,
  type HoldingPnl,
  type HoldingPosition,
} from '../lib/holdingPosition';
import { requestPortableSnapshot } from './portableSnapshotEvents';
import { getHoldingContractMultiplier } from '../lib/usOption';
import { formatLocalDate } from '../lib/localDate';
import { normalizeHoldingIdentity } from '../lib/holdingImportIdentity';

export { computeBalanceHoldingPosition, computeHoldingPnl, computeHoldingPosition } from '../lib/holdingPosition';
export type { HoldingPnl, HoldingPosition } from '../lib/holdingPosition';

// ---- Holding CRUD ----
export async function getHoldings(accountId: string): Promise<Holding[]> {
  const list = await db.holdings.where('accountId').equals(accountId).toArray();
  return list.sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt - b.createdAt);
}

export async function createHolding(accountId: string, data: Pick<Holding,
  'name' | 'symbol' | 'market' | 'instrumentType' | 'optionUnderlying' | 'optionExpiration'
  | 'optionRight' | 'optionStrikeMilli' | 'contractMultiplier' | 'mode' | 'productData'
  | 'lastPrice' | 'priceDate'
>): Promise<string> {
  const count = await db.holdings.where('accountId').equals(accountId).count();
  const id = uuidv4();
  await db.holdings.add({ ...data, id, accountId, sortOrder: count, createdAt: Date.now() });
  requestPortableSnapshot('holding-created');
  return id;
}

export async function updateHolding(id: string, updates: Partial<Holding>): Promise<void> {
  const existing = await db.holdings.get(id);
  if (!existing) return;
  await db.holdings.update(id, updates);
  // Metadata can change valuation semantics (for example a 1x security becoming a
  // 100x option contract), so the account snapshot must be recalculated even when
  // the displayed price itself did not change.
  await syncPortfolioSnapshot(existing.accountId);
  requestPortableSnapshot('holding-updated');
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

export interface HoldingTxnInput {
  date: string;
  kind: 'buy' | 'sell';
  shares: number;
  price: number;
  balanceSnapshot?: number;
  note?: string;
}

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
  if (input.balanceSnapshot != null) return;
  const h = await db.holdings.get(holdingId);
  if (!h || input.price <= 0) return;
  if (!h.priceDate || input.date >= h.priceDate) {
    await db.holdings.update(holdingId, { lastPrice: input.price, priceDate: input.date });
  }
}

export interface HoldingWithPosition extends Holding, HoldingPnl {
  position: HoldingPosition;
  marketValue: number;     // position.shares * lastPrice
}

export async function getHoldingsWithPositions(accountId: string): Promise<HoldingWithPosition[]> {
  const [account, holdings, txns] = await Promise.all([db.accounts.get(accountId), getHoldings(accountId), getAccountTxns(accountId)]);
  return holdings.map(h => {
    const mode = getHoldingMode(account?.category ?? '', h);
    const multiplier = getHoldingContractMultiplier(h);
    const holdingTxns = txns.filter(tx => tx.holdingId === h.id);
    const position = mode === 'balance'
      ? computeBalanceHoldingPosition(holdingTxns)
      : computeHoldingPosition(holdingTxns, multiplier);
    const marketValue = mode === 'balance' ? position.shares : position.shares * multiplier * (h.lastPrice || 0);
    return { ...h, position, marketValue, ...computeHoldingPnl(position, marketValue) };
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

export interface HoldingPositionUpdate {
  holdingId: string;
  shares: number;
  price: number;
  /** Average buy cost per share, in the account currency; omitted retains the current average. */
  costPrice?: number;
}

export interface HoldingPositionImportRow {
  name: string;
  symbol: string;
  market?: string;
  shares: number;
  price: number;
  costPrice?: number;
}

export interface HoldingTradeImportRow {
  name?: string;
  symbol: string;
  market?: string;
  date: string;
  kind: 'buy' | 'sell';
  shares: number;
  price: number;
  brokerRef?: string;
}

export interface HoldingScreenshotImport {
  holdings: HoldingPositionImportRow[];
  trades: HoldingTradeImportRow[];
}

export interface HoldingScreenshotImportResult {
  created: number;
  updated: number;
  insertedTrades: number;
  skippedTrades: number;
}

function validatePositionValues(row: Pick<HoldingPositionUpdate, 'shares' | 'price' | 'costPrice'>): void {
  if (!Number.isFinite(row.shares) || row.shares < 0
    || !Number.isFinite(row.price) || row.price < 0 || (row.shares > 0 && row.price === 0)
    || (row.costPrice !== undefined && (!Number.isFinite(row.costPrice) || row.costPrice < 0))
    || !Number.isFinite(row.shares * row.price)
    || (row.costPrice !== undefined && !Number.isFinite(row.shares * row.costPrice))) {
    throw new Error('HOLDING_POSITION_VALUES_INVALID');
  }
}

function validatePositionDate(date: string): void {
  const parsed = new Date(`${date}T12:00:00`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsed.getTime())
    || formatLocalDate(parsed) !== date || date > formatLocalDate()) {
    throw new Error('HOLDING_POSITION_DATE_INVALID');
  }
}

async function requireStockPortfolio(accountId: string) {
  const account = await db.accounts.get(accountId);
  if (!account || !account.portfolio || account.type !== 'asset' || account.archivedAt
    || !['股票/ETF', '股票'].includes(account.category)) {
    throw new Error('HOLDING_POSITION_ACCOUNT_INVALID');
  }
  return account;
}

function requireSupportedHolding(holding: Holding, allowOptions = false): void {
  if (holding.mode === 'balance' || (!allowOptions && holding.instrumentType === 'us_option')) {
    throw new Error('HOLDING_POSITION_HOLDING_UNSUPPORTED');
  }
}

function requireCurrentPositionDate(holding: Holding, txns: HoldingTxn[], date: string): void {
  if ((holding.priceDate && holding.priceDate > date) || txns.some(txn => txn.date > date)) {
    throw new Error('HOLDING_POSITION_DATE_STALE');
  }
}

async function applyPositionUpdate(holding: Holding, txns: HoldingTxn[], update: HoldingPositionUpdate, date: string): Promise<boolean> {
  const multiplier = getHoldingContractMultiplier(holding);
  const position = computeHoldingPosition(txns, multiplier);
  if (update.shares > 0 && position.shares === 0 && update.costPrice === undefined) {
    throw new Error('HOLDING_POSITION_COST_REQUIRED');
  }
  const costPrice = update.costPrice ?? position.avgCost;
  if (!Number.isFinite(update.shares * update.price * multiplier)
    || !Number.isFinite(update.shares * costPrice * multiplier)) throw new Error('HOLDING_POSITION_VALUES_INVALID');
  const quantityChanged = Math.abs(position.shares - update.shares) > 1e-9;
  const costChanged = update.shares > 0 && Math.abs(position.avgCost - costPrice) > 1e-9;
  if (quantityChanged || costChanged) {
    await db.holdingTxns.add({
      id: uuidv4(), accountId: holding.accountId, holdingId: holding.id,
      date, kind: 'buy', shares: 0, price: 0,
      quantitySnapshot: update.shares,
      costPriceSnapshot: costPrice,
      createdAt: Math.max(Date.now(), ...txns.map(txn => txn.createdAt)) + 1,
    });
  }
  const priceChanged = holding.lastPrice !== update.price || holding.priceDate !== date;
  if (priceChanged) await db.holdings.update(holding.id, { lastPrice: update.price, priceDate: date });
  return quantityChanged || costChanged || priceChanged;
}

/** Correct current quantities and quotes together, without manufacturing trades or changing cash. */
export async function updateHoldingPositions(accountId: string, updates: HoldingPositionUpdate[], date: string): Promise<void> {
  validatePositionDate(date);
  if (!updates.length) throw new Error('HOLDING_POSITION_EMPTY');
  if (new Set(updates.map(update => update.holdingId)).size !== updates.length) throw new Error('HOLDING_POSITION_DUPLICATE');
  updates.forEach(validatePositionValues);
  await db.transaction('rw', [db.accounts, db.holdings, db.holdingTxns, db.records], async () => {
    await requireStockPortfolio(accountId);
    const prepared = await Promise.all(updates.map(async update => {
      const holding = await db.holdings.get(update.holdingId);
      if (!holding || holding.accountId !== accountId) throw new Error('HOLDING_POSITION_HOLDING_SCOPE');
      requireSupportedHolding(holding, true);
      const txns = await db.holdingTxns.where('holdingId').equals(holding.id).toArray();
      if (txns.some(txn => txn.accountId !== accountId)) throw new Error('HOLDING_POSITION_HOLDING_SCOPE');
      requireCurrentPositionDate(holding, txns, date);
      return { holding, txns, update };
    }));
    for (const { holding, txns, update } of prepared) await applyPositionUpdate(holding, txns, update, date);
    await syncPortfolioSnapshot(accountId, false);
  });
  requestPortableSnapshot('holding-positions-updated');
}

/** Merge only this stock account by code + market. Omitted holdings and other assets stay intact. */
export async function importHoldingPositions(accountId: string, rows: HoldingPositionImportRow[], date: string): Promise<{ created: number; updated: number }> {
  const { created, updated } = await importHoldingScreenshot(accountId, { holdings: rows, trades: [] }, date);
  return { created, updated };
}

function tradeFingerprint(trade: Pick<HoldingTxn, 'date' | 'kind' | 'shares' | 'price'>): string {
  return JSON.stringify([trade.date, trade.kind, trade.shares, trade.price]);
}

function validateTradeTimeline(txns: HoldingTxn[]): void {
  let shares = 0;
  for (const txn of [...txns].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt)) {
    if (txn.quantitySnapshot !== undefined) shares = txn.quantitySnapshot;
    else if (txn.kind === 'buy') shares += txn.shares;
    else {
      if (txn.shares > shares + 1e-9) throw new Error('HOLDING_POSITION_TRADE_UNDERFLOW');
      shares = Math.max(0, shares - txn.shares);
    }
  }
}

/** Import confirmed screenshot rows atomically; actual dated fills precede the final position reconciliation. */
export async function importHoldingScreenshot(accountId: string, input: HoldingScreenshotImport, date: string): Promise<HoldingScreenshotImportResult> {
  validatePositionDate(date);
  if (!input.holdings.length && !input.trades.length) throw new Error('HOLDING_POSITION_EMPTY');
  input.holdings.forEach(row => {
    validatePositionValues(row);
  });
  input.trades.forEach(trade => {
    validatePositionDate(trade.date);
    validatePositionValues(trade);
    if (!['buy', 'sell'].includes(trade.kind) || trade.shares <= 0 || trade.price <= 0
      || (trade.brokerRef !== undefined && !trade.brokerRef.trim())) throw new Error('HOLDING_POSITION_VALUES_INVALID');
  });
  const result = await db.transaction('rw', [db.accounts, db.holdings, db.holdingTxns, db.records], async () => {
    const account = await requireStockPortfolio(accountId);
    const holdings = await getHoldings(accountId);
    const byIdentity = new Map<string, Holding[]>();
    for (const holding of holdings) {
      if (!holding.symbol?.trim()) continue;
      try {
        const { key } = normalizeHoldingIdentity(holding.symbol, holding.market, account.currency);
        byIdentity.set(key, [...(byIdentity.get(key) ?? []), holding]);
      } catch {
        // Legacy holdings with an unsupported code remain untouched by this importer.
      }
    }
    let sortOrder = Math.max(-1, ...holdings.map(holding => holding.sortOrder)) + 1;
    const prepared = new Map<string, {
      holding: Holding;
      isNew: boolean;
      txns: HoldingTxn[];
      snapshot?: HoldingPositionImportRow;
      trades: HoldingTradeImportRow[];
      added: HoldingTxn[];
      adoptedRefs: { txnId: string; brokerRef: string }[];
    }>();
    async function prepare(row: { name?: string; symbol: string; market?: string }) {
      const identity = normalizeHoldingIdentity(row.symbol, row.market, account.currency);
      const cached = prepared.get(identity.key);
      if (cached) return cached;
      const matches = byIdentity.get(identity.key) ?? [];
      if (matches.length > 1) throw new Error('HOLDING_POSITION_AMBIGUOUS_MATCH');
      let holding = matches[0];
      const isNew = !holding;
      if (isNew) {
        if (!row.name?.trim()) throw new Error('HOLDING_POSITION_VALUES_INVALID');
        holding = {
          id: uuidv4(), accountId, name: row.name.trim(),
          symbol: identity.symbol, market: identity.market, mode: 'unit',
          lastPrice: 0, sortOrder: sortOrder++, createdAt: Date.now(),
        };
      }
      requireSupportedHolding(holding);
      const txns = isNew ? [] : await db.holdingTxns.where('holdingId').equals(holding.id).toArray();
      if (txns.some(txn => txn.accountId !== accountId)) throw new Error('HOLDING_POSITION_HOLDING_SCOPE');
      const item = { holding, isNew, txns, trades: [] as HoldingTradeImportRow[], added: [] as HoldingTxn[], adoptedRefs: [] as { txnId: string; brokerRef: string }[], snapshot: undefined as HoldingPositionImportRow | undefined };
      prepared.set(identity.key, item);
      return item;
    }
    for (const row of input.holdings) {
      const item = await prepare(row);
      if (item.snapshot) throw new Error('HOLDING_POSITION_DUPLICATE');
      if (item.isNew && row.shares > 0 && row.costPrice === undefined) throw new Error('HOLDING_POSITION_COST_REQUIRED');
      item.snapshot = row;
    }
    for (const trade of input.trades) (await prepare(trade)).trades.push(trade);

    let insertedTrades = 0, skippedTrades = 0;
    for (const item of prepared.values()) {
      const counts = new Map<string, number>();
      const anonymousCounts = new Map<string, number>();
      const anonymousTxns = new Map<string, HoldingTxn[]>();
      const refs = new Map<string, string>();
      const refTxns = new Map<string, HoldingTxn>();
      const fingerprintTxns = new Map<string, HoldingTxn[]>();
      for (const txn of item.txns) {
        if (txn.quantitySnapshot !== undefined || txn.balanceSnapshot !== undefined) continue;
        const fingerprint = tradeFingerprint(txn);
        counts.set(fingerprint, (counts.get(fingerprint) ?? 0) + 1);
        fingerprintTxns.set(fingerprint, [...(fingerprintTxns.get(fingerprint) ?? []), txn]);
        if (txn.brokerRef) {
          refs.set(txn.brokerRef, fingerprint);
          refTxns.set(txn.brokerRef, txn);
        }
        else {
          anonymousCounts.set(fingerprint, (anonymousCounts.get(fingerprint) ?? 0) + 1);
          anonymousTxns.set(fingerprint, [...(anonymousTxns.get(fingerprint) ?? []), txn]);
        }
      }
      const occurrences = new Map<string, number>();
      const anonymousOccurrences = new Map<string, number>();
      const incomingRefs = new Map<string, string>();
      const newFillDates = new Set<string>();
      const matchedByDate = new Map<string, Set<string>>();
      const matchExisting = (txn: HoldingTxn) => {
        if (newFillDates.has(txn.date)) throw new Error('HOLDING_POSITION_TRADE_ORDER_AMBIGUOUS');
        const matched = matchedByDate.get(txn.date) ?? new Set<string>();
        matched.add(txn.id);
        matchedByDate.set(txn.date, matched);
      };
      let createdAt = Math.max(Date.now(), ...item.txns.map(txn => txn.createdAt));
      for (const trade of [...item.trades].sort((a, b) => a.date.localeCompare(b.date))) {
        const fingerprint = tradeFingerprint(trade);
        const brokerRef = trade.brokerRef?.trim();
        if (brokerRef && (refs.has(brokerRef) || incomingRefs.has(brokerRef))) {
          if ((refs.get(brokerRef) ?? incomingRefs.get(brokerRef)) !== fingerprint) throw new Error('HOLDING_POSITION_TRADE_REFERENCE_CONFLICT');
          if (incomingRefs.has(brokerRef)) {
            const matched = refTxns.get(brokerRef);
            if (matched) matchExisting(matched);
            skippedTrades++;
            continue;
          }
        }
        if (brokerRef) incomingRefs.set(brokerRef, fingerprint);
        if (brokerRef && refs.has(brokerRef)) {
          matchExisting(refTxns.get(brokerRef)!);
          skippedTrades++;
          continue;
        }
        const sourceOccurrences = brokerRef ? anonymousOccurrences : occurrences;
        const occurrence = (sourceOccurrences.get(fingerprint) ?? 0) + 1;
        sourceOccurrences.set(fingerprint, occurrence);
        const availableMatches = brokerRef ? anonymousCounts.get(fingerprint) ?? 0 : counts.get(fingerprint) ?? 0;
        if (occurrence <= availableMatches) {
          const matched = (brokerRef ? anonymousTxns : fingerprintTxns).get(fingerprint)![occurrence - 1];
          matchExisting(matched);
          if (brokerRef) {
            // Preserve the existing fill and remember its newly recognized reference,
            // so a later distinct reference cannot reuse the same anonymous match.
            item.adoptedRefs.push({ txnId: matched.id, brokerRef });
            refs.set(brokerRef, fingerprint);
            refTxns.set(brokerRef, matched);
          }
          skippedTrades++;
          continue;
        }
        newFillDates.add(trade.date);
        item.added.push({
          id: uuidv4(), accountId, holdingId: item.holding.id,
          date: trade.date, kind: trade.kind, shares: trade.shares, price: trade.price,
          ...(brokerRef ? { brokerRef } : {}), createdAt: ++createdAt,
        });
        insertedTrades++;
      }
      for (const txn of item.txns) {
        if (!newFillDates.has(txn.date)) continue;
        if (txn.quantitySnapshot !== undefined) {
          if (!item.snapshot || item.snapshot.costPrice === undefined
            || item.added.some(trade => trade.date === txn.date && trade.kind === 'sell')) {
            throw new Error('HOLDING_POSITION_TRADE_ORDER_AMBIGUOUS');
          }
          continue;
        }
        if (txn.balanceSnapshot !== undefined) continue;
        if (!matchedByDate.get(txn.date)?.has(txn.id)) throw new Error('HOLDING_POSITION_TRADE_ORDER_AMBIGUOUS');
      }
      const combined = [...item.txns, ...item.added];
      if (item.added.length) validateTradeTimeline(combined);
      if (item.snapshot) requireCurrentPositionDate(item.holding, combined, date);
    }

    let created = 0, updated = 0;
    for (const item of prepared.values()) {
      const holding = item.holding;
      if (item.isNew) {
        const latestTrade = [...item.trades].sort((a, b) => a.date.localeCompare(b.date)).at(-1);
        holding.lastPrice = item.snapshot?.price ?? latestTrade?.price ?? 0;
        holding.priceDate = item.snapshot ? date : latestTrade?.date;
        await db.holdings.add(holding);
        created++;
      }
      for (const { txnId, brokerRef } of item.adoptedRefs) await db.holdingTxns.update(txnId, { brokerRef });
      if (item.added.length) await db.holdingTxns.bulkAdd(item.added);
      let changed = item.added.length > 0 || item.adoptedRefs.length > 0;
      if (item.snapshot) {
        changed = await applyPositionUpdate(holding, [...item.txns, ...item.added], { ...item.snapshot, holdingId: holding.id }, date) || changed;
      } else if (!item.isNew) {
        const latestTrade = item.added.at(-1);
        if (latestTrade && (!holding.priceDate || latestTrade.date >= holding.priceDate)) {
          await db.holdings.update(holding.id, { lastPrice: latestTrade.price, priceDate: latestTrade.date });
        }
      }
      if (!item.isNew && changed) updated++;
    }
    await syncPortfolioSnapshot(accountId, false);
    return { created, updated, insertedTrades, skippedTrades };
  });
  requestPortableSnapshot('holding-screenshot-imported');
  return result;
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
  const current = computeBalanceHoldingPosition(txns).shares;
  if (Math.abs(safeTarget - current) < 0.005) {
    await syncPortfolioSnapshot(accountId);
    return;
  }

  await addHoldingTxn(accountId, holdingId, {
    date,
    kind: 'buy',
    shares: 0,
    price: 1,
    balanceSnapshot: Math.round(safeTarget * 100) / 100,
    note,
  });
}

export async function updateHoldingBalanceSnapshot(
  txnId: string,
  targetBalance: number,
  date: string,
  note?: string,
): Promise<void> {
  const txn = await db.holdingTxns.get(txnId);
  if (!txn) return;
  await db.holdingTxns.update(txnId, {
    date,
    kind: 'buy',
    shares: 0,
    price: 1,
    balanceSnapshot: Math.round(Math.max(0, targetBalance) * 100) / 100,
    note,
  });
  await syncPortfolioSnapshot(txn.accountId);
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
  const today = formatLocalDate();
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
  requestPortableSnapshot('portfolio-mode-disabled');
}

/**
 * Portfolio accounts keep the regular records pipeline working by writing the current
 * total value (cash + Σ shares × lastPrice) as today's snapshot record — at most one per day.
 * Charts, totals and exports then need no special-casing.
 */
export async function syncPortfolioSnapshot(accountId: string, notify = true): Promise<void> {
  const account = await db.accounts.get(accountId);
  if (!account?.portfolio) return;
  const withPos = await getHoldingsWithPositions(accountId);
  const total = (account.cashBalance || 0) + withPos.reduce((s, h) => s + h.marketValue, 0);
  const rounded = Math.round(total * 100) / 100;
  const today = formatLocalDate();
  const todayRecs = (await db.records.where('accountId').equals(accountId).toArray())
    .filter(r => r.date === today)
    .sort((a, b) => b.createdAt - a.createdAt);
  if (todayRecs.length > 0) await db.records.update(todayRecs[0].id, { amount: rounded });
  else await db.records.add({ id: uuidv4(), accountId, date: today, amount: rounded, createdAt: Date.now() });
  if (notify) requestPortableSnapshot('portfolio-changed');
}
