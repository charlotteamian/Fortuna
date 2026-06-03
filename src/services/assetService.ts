import { v4 as uuidv4 } from 'uuid';
import { db, type Account, type AccountRecord, initializeSettings } from '../db';
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
  await db.accounts.delete(id);
}

// ---- Record CRUD ----
export async function addRecord(accountId: string, date: string, amount: number, note?: string): Promise<string> {
  const id = uuidv4();
  await db.records.add({ id, accountId, date, amount, note, createdAt: Date.now() });
  return id;
}
export async function getRecords(accountId: string): Promise<AccountRecord[]> {
  return db.records.where('accountId').equals(accountId).toArray().then(r => r.sort((a, b) => b.date.localeCompare(a.date)));
}
export async function getLatestRecord(accountId: string): Promise<AccountRecord | undefined> {
  const records = await db.records.where('accountId').equals(accountId).toArray();
  if (!records.length) return undefined;
  return records.sort((a, b) => b.date.localeCompare(a.date))[0];
}
export async function updateRecord(id: string, updates: Partial<AccountRecord>): Promise<void> { await db.records.update(id, updates); }
export async function deleteRecord(id: string): Promise<void> { await db.records.delete(id); }

// ---- Compute value for an account (handles metals) ----
async function accountValue(acct: Account, amount: number, targetCurrency: string): Promise<number> {
  if (amount <= 0) return 0;
  if (acct.unit === 'gram' && acct.metalType) {
    // amount is grams; compute value in account currency, then convert to target
    const valueInAcctCurrency = await computeMetalValue(amount, acct.metalType, acct.currency);
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
  const allAccounts = await getAccounts();
  const primary = settings.primaryCurrency;
  const result: AccountWithLatest[] = [];
  let totalAssets = 0, totalLiabilities = 0;

  for (const acct of allAccounts) {
    const latest = await getLatestRecord(acct.id);
    const latestAmount = latest?.amount ?? 0;
    const latestDate = latest?.date ?? '-';
    const converted = await accountValue(acct, latestAmount, primary);
    let metalValueInCurrency: number | undefined;
    if (acct.unit === 'gram' && acct.metalType && latestAmount > 0) {
      metalValueInCurrency = await computeMetalValue(latestAmount, acct.metalType, acct.currency);
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
      const acctRecords = (recordsByAccount[acct.id] || []).sort((a, b) => a.date.localeCompare(b.date));
      let value = 0;
      for (const r of acctRecords) { if (r.date <= date) value = r.amount; else break; }
      const converted = await accountValue(acct, value, primary);
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
