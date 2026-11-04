import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import test, { after, beforeEach } from 'node:test';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if ((specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL) {
      const candidate = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(candidate)) return { url: candidate.href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.endsWith('.json')) return { format: 'module', source: `export default ${readFileSync(new URL(url), 'utf8')}`, shortCircuit: true };
    return nextLoad(url, context);
  },
});

const { db, initializeSettings, exportData, importData } = await import('../src/db.ts');
const { getAccounts, saveAccountOrder } = await import('../src/services/assetService.ts');

beforeEach(async () => {
  await db.transaction('rw', db.tables, async () => { for (const table of db.tables) await table.clear(); });
  await initializeSettings();
  await db.accounts.bulkPut([
    { id: 'bank-1', name: 'Bank one', category: '银行存款', type: 'asset', currency: 'CNY', createdAt: 1, sortOrder: 0 },
    { id: 'stock', name: 'Stocks', category: '股票/ETF', type: 'asset', currency: 'CNY', createdAt: 2, sortOrder: 1 },
    { id: 'bank-2', name: 'Bank two', category: '银行存款', type: 'asset', currency: 'CNY', createdAt: 3, sortOrder: 2 },
    { id: 'hidden', name: 'Hidden', category: '银行存款', type: 'asset', currency: 'CNY', createdAt: 4, sortOrder: 3, hidden: true },
    { id: 'archived', name: 'Archived', category: '股票/ETF', type: 'asset', currency: 'CNY', createdAt: 5, sortOrder: 4, archivedAt: 5 },
  ]);
  await db.records.put({ id: 'balance', accountId: 'bank-1', date: '2026-11-04', amount: 12345.67, note: 'Keep balance', createdAt: 1 });
});
after(() => db.close());

test('homepage sorting persists category and account order and changes only sortOrder', async () => {
  const before = JSON.parse(await exportData());
  await saveAccountOrder(['stock', 'bank-2', 'bank-1']);
  assert.deepEqual((await getAccounts()).map(account => account.id), ['stock', 'bank-2', 'bank-1', 'hidden']);
  const after = JSON.parse(await exportData());
  delete before.timestamp; delete after.timestamp;
  assert.deepEqual(after, { ...before, accounts: before.accounts.map((account: { id: string }) => ({
    ...account, sortOrder: ['stock', 'bank-2', 'bank-1', 'hidden', 'archived'].indexOf(account.id),
  })) });
  const backup = await exportData();
  assert.equal(await importData(backup), true);
  assert.deepEqual((await getAccounts()).map(account => account.id), ['stock', 'bank-2', 'bank-1', 'hidden']);
});

test('duplicate or stale homepage orders are rejected atomically', async () => {
  const before = await db.accounts.toArray();
  await assert.rejects(saveAccountOrder(['bank-1', 'bank-1', 'stock']), /INVALID_ACCOUNT_ORDER/);
  await assert.rejects(saveAccountOrder(['bank-1', 'stock']), /ACCOUNT_ORDER_CHANGED/);
  await assert.rejects(saveAccountOrder(['bank-1', 'stock', 'hidden']), /ACCOUNT_ORDER_CHANGED/);
  await assert.rejects(saveAccountOrder(['bank-1', 'stock', 'missing']), /ACCOUNT_ORDER_CHANGED/);
  assert.deepEqual(await db.accounts.toArray(), before);
  await db.accounts.update('bank-2', { archivedAt: 6 });
  const archived = await db.accounts.toArray();
  await assert.rejects(saveAccountOrder(['bank-1', 'stock', 'bank-2']), /ACCOUNT_ORDER_CHANGED/);
  assert.deepEqual(await db.accounts.toArray(), archived);
});
