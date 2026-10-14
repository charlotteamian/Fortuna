import test, { beforeEach, after } from 'node:test';
import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import Dexie from 'dexie';
import * as XLSX from 'xlsx';
import { readExcelBackupFile, type ExcelBackupFailure } from '../src/lib/excelBackup.ts';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if ((specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL) {
      const candidate = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(candidate)) return { url: candidate.href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.endsWith('.json')) return {
      format: 'module', source: `export default ${readFileSync(new URL(url), 'utf8')}`, shortCircuit: true,
    };
    return nextLoad(url, context);
  },
});

const { db, initializeSettings, exportToExcel, importFromExcel, exportData, hasLedgerData } = await import('../src/db.ts');
const account = { id: 'fixture-account', name: 'Backup fixture', category: '股票/ETF', type: 'asset' as const, currency: 'CNY', portfolio: true, createdAt: 1, sortOrder: 0 };
const record = { id: 'fixture-record', accountId: account.id, date: '2026-10-14', amount: 1234.56, createdAt: 2 };
beforeEach(async () => {
  await db.transaction('rw', db.tables, async () => {
    for (const table of db.tables) await table.clear();
  });
  await initializeSettings();
  await db.accounts.add(account);
  await db.records.add(record);
});
after(() => db.close());

async function ledgerSnapshot() {
  const { timestamp: _timestamp, ...data } = JSON.parse(await exportData());
  void _timestamp;
  return data;
}

test('a fresh backup restores blank optional fund settings and empty tables', async () => {
  const backup = await exportToExcel();
  const workbook = XLSX.read(backup, { type: 'base64' });
  assert.equal(XLSX.utils.sheet_to_json<{ dividendFundPlan: string }>(workbook.Sheets.Settings)[0].dividendFundPlan, '');
  await db.accounts.clear();
  await db.records.clear();
  assert.equal(await importFromExcel(backup), true);
  assert.equal((await db.accounts.get(account.id))?.name, account.name);
  assert.deepEqual(await db.records.toArray(), [record]);
  for (const name of ['products', 'planItems', 'planTargets', 'holdings', 'holdingTxns', 'dividendStocks']) {
    assert.equal(await db.table(name).count(), 0, name);
  }
});

test('binary reads with missing or generic MIME restore all ledger tables and financial precision', async () => {
  const { updateSettings } = await import('../src/db.ts');
  const { defaultDividendStocks } = await import('../src/lib/dividendWorkbench.ts');
  const { defaultDividendFundPlan } = await import('../src/lib/dividendFundPlan.ts');
  await db.accounts.update(account.id, { includeInTotals: false, hidden: true, cashBalance: 234.56, productData: { code: '000001' } });
  await db.holdings.add({ id: 'fixture-holding', accountId: account.id, name: 'Fixture security', symbol: '000001', lastPrice: 1.2345, priceDate: '2026-10-14', productData: { note: 'metadata' }, sortOrder: 0, createdAt: 3 });
  await db.holdingTxns.add({ id: 'fixture-position', accountId: account.id, holdingId: 'fixture-holding', date: '2026-10-14', kind: 'buy', shares: 0, price: 0, quantitySnapshot: 123.45, costPriceSnapshot: 1.2345, brokerRef: 'fixture-fill', createdAt: 4 });
  await db.products.add({ id: 'fixture-product', sectionId: 'bank_deposit', sortOrder: 0, createdAt: 5, updatedAt: 6, data: { code: '001234', note: 'fixture' } });
  await db.planItems.add({ id: 'fixture-plan', name: 'Fixture plan', targetPercent: 60, categories: ['现金'], allocations: [{ refKey: 'h:fixture-holding', amountMinor: 12345 }], plannedPurchases: 'purchase notes', sortOrder: 0, createdAt: 7 });
  await db.planTargets.add({ id: 'fixture-target', planItemId: 'fixture-plan', label: 'Fixture target', refKeys: ['h:fixture-holding'], allocations: [{ refKey: 'h:fixture-holding', amountMinor: 12345 }], targetPercent: 40, sortOrder: 0, createdAt: 8 });
  await db.exchangeRates.add({ id: 'CNY_USD', base: 'CNY', quote: 'USD', rate: 0.14, date: '2026-10-14', updatedAt: 9 });
  await db.dividendStocks.bulkAdd(defaultDividendStocks());
  await updateSettings({ dividendStrategy: 'funds', dividendBudgetMinor: 12345678, dividendFundPlan: { ...defaultDividendFundPlan(), budgetMinor: 12345678, funds: [{ id: 'fixture-fund', code: '512890', name: 'Fixture ETF', indexKind: 'other', weightBps: 10000, quote: { priceMicros: 1234001, date: '2026-10-14 09:00', fetchedAt: 10 } }] } });
  const original = await ledgerSnapshot();
  const bytes = Buffer.from(await exportToExcel(), 'base64');
  for (const mime of ['', 'application/octet-stream', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']) {
    const binary = await readExcelBackupFile(new Blob([bytes], { type: mime }));
    await db.accounts.update(account.id, { name: 'replacement' });
    const failures: ExcelBackupFailure[] = [];
    assert.equal(await importFromExcel(binary, failure => failures.push(failure)), true, mime);
    assert.deepEqual(failures, []);
    const restored = await ledgerSnapshot();
    for (const name of ['accounts', 'records', 'holdings', 'holdingTxns', 'products', 'planItems', 'planTargets', 'exchangeRates', 'dividendStocks']) assert.deepEqual(restored[name], original[name], name);
    const settings = (await initializeSettings());
    assert.equal(settings.dividendBudgetMinor, 12345678);
    assert.deepEqual(settings.dividendFundPlan, original.settings[0].dividendFundPlan);
  }
});

test('legacy Excel backups without metadata or settings still restore', async () => {
  const { updateSettings } = await import('../src/db.ts');
  await updateSettings({ dividendBudgetMinor: 999, colorTheme: 'violet-gold' });
  await db.settings.add({ ...await initializeSettings(), id: 'old-settings' });
  await db.exchangeRates.add({ id: 'old-rate', base: 'CNY', quote: 'USD', rate: 0.14, date: '2026-10-14', updatedAt: 1 });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([account]), 'Accounts');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([record]), 'Records');
  assert.equal(await importFromExcel(XLSX.write(workbook, { type: 'array', bookType: 'xlsx' })), true);
  assert.deepEqual(await db.records.toArray(), [record]);
  assert.equal(await db.exchangeRates.count(), 0);
  assert.equal(await db.settings.count(), 1);
  const settings = await initializeSettings();
  assert.ok(settings.categories.length > 0);
  assert.equal(settings.colorTheme, 'emerald-rose');
  assert.equal(settings.dividendBudgetMinor, undefined);
});

test('existing data including matching IDs is fully replaced, and repeat imports never append rows', async () => {
  const backup = await exportToExcel();
  await db.accounts.update(account.id, { name: 'Current changed account' });
  await db.records.update(record.id, { amount: 999999 });
  await db.accounts.add({ ...account, id: 'extra-account' });
  await db.records.add({ ...record, id: 'extra-record', accountId: 'extra-account' });
  await db.holdings.add({ id: 'extra-holding', accountId: 'extra-account', name: 'Extra security', lastPrice: 1, sortOrder: 0, createdAt: 1 });
  await db.holdingTxns.add({ id: 'extra-trade', accountId: 'extra-account', holdingId: 'extra-holding', date: '2026-10-14', kind: 'buy', shares: 1, price: 1, createdAt: 1 });
  await db.products.add({ id: 'extra-product', sectionId: 'bank_deposit', data: {}, sortOrder: 0, createdAt: 1, updatedAt: 1 });
  await db.planItems.add({ id: 'extra-plan', name: 'Extra plan', categories: [], targetPercent: 100, sortOrder: 0, createdAt: 1 });
  await db.planTargets.add({ id: 'extra-target', planItemId: 'extra-plan', label: 'Extra target', sortOrder: 0, createdAt: 1 });
  await db.exchangeRates.add({ id: 'extra-rate', base: 'CNY', quote: 'USD', rate: 0.14, date: '2026-10-14', updatedAt: 1 });
  await db.settings.add({ ...await initializeSettings(), id: 'extra-settings' });
  const { defaultDividendStocks } = await import('../src/lib/dividendWorkbench.ts');
  await db.dividendStocks.bulkAdd(defaultDividendStocks());
  for (let attempt = 0; attempt < 3; attempt++) {
    assert.equal(await importFromExcel(backup), true);
    assert.equal(await db.accounts.count(), 1);
    assert.equal((await db.accounts.get(account.id))?.name, account.name);
    assert.deepEqual(await db.records.toArray(), [record]);
    assert.equal(await db.settings.count(), 1);
    for (const table of [db.products, db.planItems, db.planTargets, db.holdings, db.holdingTxns, db.dividendStocks, db.exchangeRates]) assert.equal(await table.count(), 0, table.name);
  }
});

test('overwrite confirmation detects ledger data but ignores default settings and cached rates', async () => {
  assert.equal(await hasLedgerData(), true);
  await db.accounts.clear();
  await db.records.clear();
  await db.exchangeRates.add({ id: 'cached-rate', base: 'CNY', quote: 'USD', rate: 0.14, date: '2026-10-14', updatedAt: 1 });
  assert.equal(await hasLedgerData(), false);
  await db.planItems.add({ id: 'plan-only', name: 'Plan only', targetPercent: 100, categories: [], sortOrder: 0, createdAt: 1 });
  assert.equal(await hasLedgerData(), true);
});

test('reports and invalid/newer backups report a specific cause without replacing data', async t => {
  t.mock.method(console, 'error', () => {});
  const original = await ledgerSnapshot();
  const backup = await exportToExcel();
  for (const kind of ['report', 'invalid-account', 'invalid-json', 'newer-version']) {
    const workbook = kind === 'report' ? XLSX.utils.book_new() : XLSX.read(backup, { type: 'base64' });
    if (kind === 'report') XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([{ total: 100 }]), 'Report');
    if (kind === 'invalid-account') workbook.Sheets.Accounts = XLSX.utils.json_to_sheet([{ ...account, name: '' }]);
    if (kind === 'invalid-json') {
      const settings = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets.Settings);
      settings[0].dividendFundPlan = '{';
      workbook.Sheets.Settings = XLSX.utils.json_to_sheet(settings);
    }
    if (kind === 'newer-version') workbook.Sheets.BackupInfo = XLSX.utils.json_to_sheet([{ format: 'Fortuna Excel Backup', version: 999 }]);
    const failures: ExcelBackupFailure[] = [];
    assert.equal(await importFromExcel(XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }), failure => failures.push(failure)), false, kind);
    assert.equal(failures.length, 1);
    assert.equal(failures[0].code, kind === 'report' ? 'not_backup' : kind === 'newer-version' ? 'unsupported_version' : 'invalid_data');
    if (kind === 'invalid-account') assert.equal(failures[0].sheet, 'Accounts');
    if (kind === 'invalid-json') assert.equal(failures[0].sheet, 'Settings');
    assert.deepEqual(await ledgerSnapshot(), original, kind);
  }
});

test('a database write failure rolls back the complete restore and reports a write error', async t => {
  t.mock.method(console, 'error', () => {});
  const backup = await exportToExcel();
  await db.accounts.update(account.id, { name: 'Keep current data' });
  const original = await ledgerSnapshot();
  const failWrite = () => { throw new DOMException('Fixture storage failure', 'QuotaExceededError'); };
  db.records.hook('creating', failWrite);
  try {
    const failures: ExcelBackupFailure[] = [];
    assert.equal(await importFromExcel(backup, failure => failures.push(failure)), false);
    assert.equal(failures[0].code, 'restore_failed');
    assert.match(failures[0].detail ?? '', /storage failure/);
    assert.deepEqual(await ledgerSnapshot(), original);
  } finally {
    db.records.hook('creating').unsubscribe(failWrite);
  }
});

test('empty and incomplete file reads cannot enter the restore transaction', async () => {
  await assert.rejects(readExcelBackupFile(new Blob()), /BACKUP_FILE_INCOMPLETE/);
  await assert.rejects(readExcelBackupFile({ size: 100, arrayBuffer: async () => new ArrayBuffer(10) } as Blob), /BACKUP_FILE_INCOMPLETE/);
});

for (const format of ['Excel', 'JSON']) test(`${format} export takes one consistent snapshot when another account is being created`, async () => {
  const originalRead = db.accounts.toArray.bind(db.accounts);
  let mutation: Promise<unknown> | undefined;
  db.accounts.toArray = async () => {
    const rows = await originalRead();
    mutation ??= Dexie.ignoreTransaction(() => db.transaction('rw', db.accounts, db.records, async () => {
      await db.accounts.add({ ...account, id: 'concurrent-account' });
      await db.records.add({ ...record, id: 'concurrent-record', accountId: 'concurrent-account' });
    }));
    return rows;
  };
  let backup: string;
  try {
    backup = await (format === 'Excel' ? exportToExcel() : exportData());
    await mutation;
  } finally {
    db.accounts.toArray = originalRead;
  }
  assert.equal(await db.accounts.count(), 2, 'the concurrent write actually committed');
  if (format === 'JSON') {
    const { importData } = await import('../src/db.ts');
    assert.equal(JSON.parse(backup).records.length, 1);
    assert.equal(await importData(backup), true);
  } else assert.equal(await importFromExcel(backup), true, 'an export must be restorable even during a concurrent write');
  assert.equal(await db.accounts.count(), 1);
  assert.equal(await db.records.count(), 1);
});
