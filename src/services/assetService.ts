import { v4 as uuidv4 } from 'uuid';
import { db, type Account, type AccountRecord, type GoldPriceSource, type Settings, initializeSettings } from '../db';
import { getCachedMetalPricePerGram, getCachedRate } from './rateService';
import { splitAccountsByArchive } from '../lib/accountArchive';
import { requestPortableSnapshot } from './portableSnapshotEvents';
import {
  deriveBalanceTimeline,
  usesDerivedBalanceRecords,
  type BalanceFlowKind,
} from '../lib/balanceFlow';

// ---- Account CRUD ----
export interface AccountQueryOptions {
  includeArchived?: boolean;
  archivedOnly?: boolean;
  settings?: Settings;
}

export async function createAccount(data: Omit<Account, 'id' | 'createdAt' | 'sortOrder' | 'archivedAt'>): Promise<string> {
  const count = await db.accounts.count();
  const id = uuidv4();
  await db.accounts.add({ ...data, id, createdAt: Date.now(), sortOrder: count });
  requestPortableSnapshot('account-created');
  return id;
}
export async function getAccounts(options: AccountQueryOptions = {}): Promise<Account[]> {
  const allAccounts = await db.accounts.orderBy('sortOrder').toArray();
  if (options.includeArchived) return allAccounts;
  const { active, archived } = splitAccountsByArchive(allAccounts);
  return options.archivedOnly ? archived : active;
}
export async function getAccount(id: string): Promise<Account | undefined> { return db.accounts.get(id); }
export async function updateAccount(id: string, updates: Partial<Account>): Promise<void> {
  await db.accounts.update(id, updates);
  requestPortableSnapshot('account-updated');
}
export async function archiveAccount(id: string): Promise<void> {
  await db.accounts.update(id, { archivedAt: Date.now() });
  requestPortableSnapshot('account-archived');
}
export async function restoreAccount(id: string): Promise<void> {
  await db.accounts.update(id, { archivedAt: undefined });
  requestPortableSnapshot('account-restored');
}
export async function deleteAccount(id: string): Promise<void> {
  await db.records.where('accountId').equals(id).delete();
  await db.holdingTxns.where('accountId').equals(id).delete();
  await db.holdings.where('accountId').equals(id).delete();
  await db.accounts.delete(id);
  requestPortableSnapshot('account-deleted');
}

// ---- Record CRUD ----
type RecordExtra = Pick<AccountRecord, 'kind' | 'deltaGrams' | 'pricePerGram' | 'deltaAmount' | 'balanceAdjustment'>;
export async function addRecord(accountId: string, date: string, amount: number, note?: string, extra?: Partial<RecordExtra>): Promise<string> {
  const id = uuidv4();
  await db.records.add({ id, accountId, date, amount, note, createdAt: Date.now(), ...extra });
  requestPortableSnapshot('account-record-added');
  return id;
}
export async function getRecords(accountId: string): Promise<AccountRecord[]> {
  return db.records.where('accountId').equals(accountId).toArray()
    .then(r => r.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt));
}
export async function getLatestRecord(accountId: string): Promise<AccountRecord | undefined> {
  const records = await db.records.where('accountId').equals(accountId).toArray();
  if (!records.length) return undefined;
  return records.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt)[0];
}
export async function updateRecord(id: string, updates: Partial<AccountRecord>): Promise<void> {
  const existing = await db.records.get(id);
  await db.records.update(id, updates);
  if (existing) {
    const account = await db.accounts.get(existing.accountId);
    if (account && usesDerivedBalanceRecords(account.category, account.type)) {
      await recomputeBalanceSnapshots(existing.accountId);
    }
  }
  requestPortableSnapshot('account-record-updated');
}
export async function deleteRecord(id: string): Promise<void> {
  const rec = await db.records.get(id);
  await db.records.delete(id);
  if (rec && (rec.deltaGrams != null || rec.pricePerGram != null)) {
    await recomputeMetalSnapshots(rec.accountId);
  }
  if (rec) {
    const account = await db.accounts.get(rec.accountId);
    if (account && usesDerivedBalanceRecords(account.category, account.type)) {
      await recomputeBalanceSnapshots(rec.accountId);
    }
  }
  requestPortableSnapshot('account-record-deleted');
}

// ---- Derived balance transactions (receivables, loans, credit cards) ----
export interface BalanceTransactionInput {
  date: string;
  kind: BalanceFlowKind;
  amount: number;
  note?: string;
}

function canApplyBalanceTimeline(records: AccountRecord[]): boolean {
  return !deriveBalanceTimeline(records).some(entry => entry.underflow);
}

/** Re-derive each delta record's resulting balance while preserving legacy snapshot records as anchors. */
export async function recomputeBalanceSnapshots(accountId: string): Promise<void> {
  const records = await db.records.where('accountId').equals(accountId).toArray();
  const timeline = deriveBalanceTimeline(records);
  for (const entry of timeline) {
    const record = records.find(item => item.id === entry.id);
    if (record && record.amount !== entry.amount) {
      await db.records.update(entry.id, { amount: entry.amount });
    }
  }
}

export async function addBalanceTransaction(accountId: string, input: BalanceTransactionInput): Promise<string | null> {
  const amount = Math.round(Math.max(0, input.amount) * 100) / 100;
  if (amount <= 0) return null;
  const existing = await db.records.where('accountId').equals(accountId).toArray();
  const candidate: AccountRecord = {
    id: '__candidate__',
    accountId,
    date: input.date,
    amount: 0,
    kind: input.kind,
    deltaAmount: amount,
    note: input.note,
    createdAt: Date.now(),
  };
  if (!canApplyBalanceTimeline([...existing, candidate])) return null;

  const id = await addRecord(accountId, input.date, 0, input.note, {
    kind: input.kind,
    deltaAmount: amount,
  });
  await recomputeBalanceSnapshots(accountId);
  requestPortableSnapshot('balance-transaction-added');
  return id;
}

export async function addBalanceAdjustment(
  accountId: string,
  date: string,
  targetBalance: number,
  note?: string,
): Promise<string> {
  const amount = Math.round(Math.max(0, targetBalance) * 100) / 100;
  const id = await addRecord(accountId, date, amount, note, { balanceAdjustment: true });
  await recomputeBalanceSnapshots(accountId);
  requestPortableSnapshot('balance-adjusted');
  return id;
}

export async function updateBalanceTransaction(recordId: string, input: BalanceTransactionInput): Promise<boolean> {
  const current = await db.records.get(recordId);
  if (!current) return false;
  const amount = Math.round(Math.max(0, input.amount) * 100) / 100;
  if (amount <= 0) return false;

  const existing = await db.records.where('accountId').equals(current.accountId).toArray();
  const candidate = existing.map(record => record.id === recordId ? {
    ...record,
    date: input.date,
    kind: input.kind,
    deltaAmount: amount,
    note: input.note,
  } : record);
  if (!canApplyBalanceTimeline(candidate)) return false;

  await db.records.update(recordId, {
    date: input.date,
    kind: input.kind,
    deltaAmount: amount,
    note: input.note,
  });
  await recomputeBalanceSnapshots(current.accountId);
  requestPortableSnapshot('balance-transaction-updated');
  return true;
}

// ---- Precious-metal transactions (buy +/ sell -) ----
export interface MetalTxnInput { date: string; kind: 'buy' | 'sell'; grams: number; pricePerGram: number; note?: string; }

/** Re-derive each metal record's `amount` (remaining grams snapshot) from its buy/sell deltas, in chronological order. */
export async function recomputeMetalSnapshots(accountId: string): Promise<void> {
  const recs = (await db.records.where('accountId').equals(accountId).toArray())
    .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt);
  let remaining = 0;
  for (const r of recs) {
    const g = r.deltaGrams ?? Math.abs(r.amount);
    remaining += (r.kind === 'sell' ? -g : g);
    if (remaining < 0) remaining = 0;
    const rounded = Math.round(remaining * 1e6) / 1e6;
    if (r.amount !== rounded) await db.records.update(r.id, { amount: rounded });
  }
}

export async function addMetalTransaction(accountId: string, input: MetalTxnInput): Promise<string> {
  const id = await addRecord(accountId, input.date, 0, input.note, {
    kind: input.kind, deltaGrams: input.grams, pricePerGram: input.pricePerGram,
  });
  await recomputeMetalSnapshots(accountId);
  return id;
}

export async function updateMetalTransaction(recordId: string, accountId: string, input: MetalTxnInput): Promise<void> {
  await db.records.update(recordId, {
    date: input.date, kind: input.kind, deltaGrams: input.grams, pricePerGram: input.pricePerGram, note: input.note,
  });
  await recomputeMetalSnapshots(accountId);
  requestPortableSnapshot('metal-transaction-updated');
}

export interface MetalPosition {
  remainingGrams: number;
  avgCost: number;       // weighted average cost per gram of the current holding (account currency)
  costBasis: number;     // remainingGrams * avgCost
  realizedPnl: number;   // total realized profit/loss from sells (account currency)
}

/** Moving-average-cost position from a metal account's transaction history. */
export function computeMetalPosition(records: AccountRecord[]): MetalPosition {
  const chron = [...records].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt);
  let grams = 0, costBasis = 0, realizedPnl = 0;
  for (const r of chron) {
    const g = r.deltaGrams ?? Math.abs(r.amount);
    const price = r.pricePerGram ?? 0;
    if (r.kind === 'sell') {
      const avg = grams > 0 ? costBasis / grams : 0;
      const sold = Math.min(g, grams);
      realizedPnl += sold * (price - avg);
      costBasis -= sold * avg;
      grams -= sold;
    } else {
      grams += g;
      costBasis += g * price;
    }
    if (grams < 1e-9) { grams = 0; costBasis = 0; }
  }
  return { remainingGrams: grams, avgCost: grams > 0 ? costBasis / grams : 0, costBasis, realizedPnl };
}

// ---- Compute value for an account (handles metals) ----
interface AccountValuation {
  converted: number;
  nativeMonetaryValue: number;
  available: boolean;
}

/** Reuse cache-only lookups for an entire overview or chart calculation. Network refresh runs after first paint. */
function createAccountValuator(goldSource: GoldPriceSource) {
  const rateCache = new Map<string, Promise<number | undefined>>();
  const metalCache = new Map<string, Promise<number | undefined>>();
  const rateFor = (from: string, to: string) => {
    const key = `${from}_${to}`;
    let pending = rateCache.get(key);
    if (!pending) {
      pending = getCachedRate(from, to);
      rateCache.set(key, pending);
    }
    return pending;
  };
  const metalFor = (metalType: string, currency: string) => {
    const key = `${goldSource}_${metalType}_${currency}`;
    let pending = metalCache.get(key);
    if (!pending) {
      pending = getCachedMetalPricePerGram(metalType, currency, goldSource);
      metalCache.set(key, pending);
    }
    return pending;
  };

  return async (account: Account, amount: number, targetCurrency: string): Promise<AccountValuation> => {
    if (amount <= 0) return { converted: 0, nativeMonetaryValue: 0, available: true };
    let nativeMonetaryValue = amount;
    if (account.unit === 'gram' && account.metalType) {
      const metalPrice = await metalFor(account.metalType, account.currency);
      if (metalPrice === undefined) return { converted: 0, nativeMonetaryValue: 0, available: false };
      nativeMonetaryValue = amount * metalPrice;
    }
    const rate = await rateFor(account.currency, targetCurrency);
    if (rate === undefined) return { converted: 0, nativeMonetaryValue, available: false };
    return { converted: nativeMonetaryValue * rate, nativeMonetaryValue, available: true };
  };
}

// ---- Aggregation ----
export interface AccountWithLatest extends Account {
  latestAmount: number;
  latestDate: string;
  convertedAmount: number;
  metalValueInCurrency?: number; // for metals: value in account currency
  conversionUnavailable?: boolean; // excluded from converted totals until a real cached quote/rate exists
}

export async function getAccountsWithLatest(options: AccountQueryOptions = {}): Promise<{
  accounts: AccountWithLatest[];
  totalAssets: number; totalLiabilities: number; netWorth: number;
}> {
  const settings = options.settings ?? await initializeSettings();
  const goldSource = settings.goldPriceSource ?? 'international';
  const allAccounts = await getAccounts(options);
  const primary = settings.primaryCurrency;
  const valuate = createAccountValuator(goldSource);
  const allRecords = await db.records.toArray();
  const latestByAccount = new Map<string, AccountRecord>();
  for (const record of allRecords) {
    const current = latestByAccount.get(record.accountId);
    if (!current || record.date > current.date || (record.date === current.date && record.createdAt > current.createdAt)) {
      latestByAccount.set(record.accountId, record);
    }
  }
  let totalAssets = 0, totalLiabilities = 0;
  const result = await Promise.all(allAccounts.map(async acct => {
    const latest = latestByAccount.get(acct.id);
    const latestAmount = latest?.amount ?? 0;
    const latestDate = latest?.date ?? '-';
    const valuation = await valuate(acct, latestAmount, primary);
    if (acct.type === 'asset') totalAssets += valuation.converted; else totalLiabilities += valuation.converted;
    return {
      ...acct,
      latestAmount,
      latestDate,
      convertedAmount: valuation.converted,
      metalValueInCurrency: acct.unit === 'gram' ? valuation.nativeMonetaryValue : undefined,
      conversionUnavailable: !valuation.available,
    };
  }));
  return { accounts: result, totalAssets, totalLiabilities, netWorth: totalAssets - totalLiabilities };
}

// ---- Chart Data ----
export async function getChartData(): Promise<{
  dates: string[];
  accountSeries: Record<string, { name: string; category: string; type: string; values: Record<string, number> }>;
  categorySeries: Record<string, { type: string; values: Record<string, number> }>;
  totalSeries: { totalAssets: Record<string, number>; totalLiabilities: Record<string, number>; netWorth: Record<string, number> };
}> {
  const settings = await initializeSettings();
  const goldSource = settings.goldPriceSource ?? 'international';
  const primary = settings.primaryCurrency;
  const allAccounts = await getAccounts();
  const valuate = createAccountValuator(goldSource);
  const allRecords = await db.records.toArray();
  const recordsByAccount: Record<string, AccountRecord[]> = {};
  for (const r of allRecords) {
    if (!recordsByAccount[r.accountId]) recordsByAccount[r.accountId] = [];
    recordsByAccount[r.accountId].push(r);
  }
  const dates = Array.from(new Set(allRecords.map(r => r.date))).sort();
  const accountSeries: Record<string, { name: string; category: string; type: string; values: Record<string, number> }> = {};
  const categorySeries: Record<string, { type: string; values: Record<string, number> }> = {};
  const totalSeries = { totalAssets: {} as Record<string, number>, totalLiabilities: {} as Record<string, number>, netWorth: {} as Record<string, number> };

  for (const date of dates) {
    let dayAssets = 0, dayLiabilities = 0;
    for (const acct of allAccounts) {
      const acctRecords = (recordsByAccount[acct.id] || []).sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt);
      let value = 0;
      for (const r of acctRecords) { if (r.date <= date) value = r.amount; else break; }
      const { converted } = await valuate(acct, value, primary);
      if (!accountSeries[acct.id]) accountSeries[acct.id] = { name: acct.name, category: acct.category, type: acct.type, values: {} };
      accountSeries[acct.id].values[date] = Math.round(converted);
      if (!categorySeries[acct.category]) categorySeries[acct.category] = { type: acct.type, values: {} };
      categorySeries[acct.category].values[date] = (categorySeries[acct.category].values[date] || 0) + Math.round(converted);
      if (acct.type === 'asset') dayAssets += converted; else dayLiabilities += converted;
    }
    totalSeries.totalAssets[date] = Math.round(dayAssets);
    totalSeries.totalLiabilities[date] = Math.round(dayLiabilities);
    totalSeries.netWorth[date] = Math.round(dayAssets - dayLiabilities);
  }
  return { dates, accountSeries, categorySeries, totalSeries };
}
