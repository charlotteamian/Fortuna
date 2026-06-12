import { v4 as uuidv4 } from 'uuid';
import { db, type Account, type AccountRecord, type GoldPriceSource, initializeSettings } from '../db';
import { convertAmount, computeMetalValue } from './rateService';

// ---- Account CRUD ----
export async function createAccount(data: Omit<Account, 'id' | 'createdAt' | 'sortOrder'>): Promise<string> {
  const count = await db.accounts.count();
  const id = uuidv4();
  await db.accounts.add({ ...data, id, createdAt: Date.now(), sortOrder: count });
  return id;
}
export async function getAccounts(): Promise<Account[]> { return db.accounts.orderBy('sortOrder').toArray(); }
export async function getAccount(id: string): Promise<Account | undefined> { return db.accounts.get(id); }
export async function updateAccount(id: string, updates: Partial<Account>): Promise<void> { await db.accounts.update(id, updates); }
export async function deleteAccount(id: string): Promise<void> {
  await db.records.where('accountId').equals(id).delete();
  await db.holdingTxns.where('accountId').equals(id).delete();
  await db.holdings.where('accountId').equals(id).delete();
  await db.accounts.delete(id);
}

// ---- Record CRUD ----
type RecordExtra = Pick<AccountRecord, 'kind' | 'deltaGrams' | 'pricePerGram'>;
export async function addRecord(accountId: string, date: string, amount: number, note?: string, extra?: Partial<RecordExtra>): Promise<string> {
  const id = uuidv4();
  await db.records.add({ id, accountId, date, amount, note, createdAt: Date.now(), ...extra });
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
export async function updateRecord(id: string, updates: Partial<AccountRecord>): Promise<void> { await db.records.update(id, updates); }
export async function deleteRecord(id: string): Promise<void> {
  const rec = await db.records.get(id);
  await db.records.delete(id);
  if (rec?.kind) await recomputeMetalSnapshots(rec.accountId);
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
async function accountValue(acct: Account, amount: number, targetCurrency: string, goldSource: GoldPriceSource): Promise<number> {
  if (amount <= 0) return 0;
  if (acct.unit === 'gram' && acct.metalType) {
    // amount is grams; compute value in account currency, then convert to target
    const valueInAcctCurrency = await computeMetalValue(amount, acct.metalType, acct.currency, goldSource);
    return convertAmount(valueInAcctCurrency, acct.currency, targetCurrency);
  }
  return convertAmount(amount, acct.currency, targetCurrency);
}

// ---- Aggregation ----
export interface AccountWithLatest extends Account {
  latestAmount: number;
  latestDate: string;
  convertedAmount: number;
  metalValueInCurrency?: number; // for metals: value in account currency
}

export async function getAccountsWithLatest(): Promise<{
  accounts: AccountWithLatest[];
  totalAssets: number; totalLiabilities: number; netWorth: number;
}> {
  const settings = await initializeSettings();
  const goldSource = settings.goldPriceSource ?? 'international';
  const allAccounts = await getAccounts();
  const primary = settings.primaryCurrency;
  const result: AccountWithLatest[] = [];
  let totalAssets = 0, totalLiabilities = 0;

  for (const acct of allAccounts) {
    const latest = await getLatestRecord(acct.id);
    const latestAmount = latest?.amount ?? 0;
    const latestDate = latest?.date ?? '-';
    const converted = await accountValue(acct, latestAmount, primary, goldSource);
    let metalValueInCurrency: number | undefined;
    if (acct.unit === 'gram' && acct.metalType && latestAmount > 0) {
      metalValueInCurrency = await computeMetalValue(latestAmount, acct.metalType, acct.currency, goldSource);
    }
    result.push({ ...acct, latestAmount, latestDate, convertedAmount: converted, metalValueInCurrency });
    if (acct.type === 'asset') totalAssets += converted; else totalLiabilities += converted;
  }
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
      const converted = await accountValue(acct, value, primary, goldSource);
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
