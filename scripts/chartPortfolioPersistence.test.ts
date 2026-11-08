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

const { db, initializeSettings, updateSettings, exportData, importData, exportToExcel, importFromExcel } = await import('../src/db.ts');
const { getChartPortfolios } = await import('../src/services/chartPortfolioService.ts');

beforeEach(async () => {
  await db.transaction('rw', db.tables, async () => { for (const table of db.tables) await table.clear(); });
  await initializeSettings();
  await db.accounts.bulkPut([
    { id: 'strategy', name: 'My strategy', category: '股票/ETF', type: 'asset', currency: 'CNY', portfolio: true, includeInTotals: false, createdAt: 1, sortOrder: 0 },
    { id: 'other', name: 'Bank', category: '银行存款', type: 'asset', currency: 'CNY', createdAt: 2, sortOrder: 1 },
  ]);
  await db.records.bulkPut([
    { id: 'a1', accountId: 'strategy', date: '2026-01-01', amount: 1000, createdAt: 1 },
    { id: 'a2', accountId: 'strategy', date: '2026-02-01', amount: 1100, createdAt: 2 },
    { id: 'b1', accountId: 'other', date: '2026-02-01', amount: 99999999, createdAt: 3 },
  ]);
  await db.holdings.bulkPut([{ id: 'h1', accountId: 'strategy', name: 'Synthetic', symbol: '000001', lastPrice: 11, sortOrder: 0, createdAt: 1 }]);
  await db.holdingTxns.bulkPut([{ id: 't1', accountId: 'strategy', holdingId: 'h1', date: '2026-01-01', kind: 'buy', shares: 100, price: 10, createdAt: 1 }]);
});
after(() => db.close());

test('portfolio chart reads named portfolios only and requires an explicit saved selection', async () => {
  assert.equal((await initializeSettings()).chartNavAccountIds, undefined);
  const portfolios = await getChartPortfolios();
  assert.deepEqual(portfolios.map(item => item.account.name), ['My strategy']);
  assert.deepEqual(portfolios[0].points.map(point => point.nav), [1.1]);
  const beforeAccounts = await db.accounts.toArray(), beforeRecords = await db.records.toArray();
  await updateSettings({ chartNavAccountIds: ['strategy'] });
  assert.deepEqual((await initializeSettings()).chartNavAccountIds, ['strategy']);
  assert.deepEqual(await db.accounts.toArray(), beforeAccounts);
  assert.deepEqual(await db.records.toArray(), beforeRecords);
});

test('portfolio statistics choice survives JSON and Excel backups and can be turned off', async () => {
  await updateSettings({ chartNavAccountIds: ['strategy'] });
  const json = await exportData(), excel = await exportToExcel();
  await updateSettings({ chartNavAccountIds: [] });
  assert.equal(await importData(json), true);
  assert.deepEqual((await initializeSettings()).chartNavAccountIds, ['strategy']);
  await updateSettings({ chartNavAccountIds: [] });
  assert.equal(await importFromExcel(excel), true);
  assert.deepEqual((await initializeSettings()).chartNavAccountIds, ['strategy']);
  await updateSettings({ chartNavAccountIds: [] });
  assert.deepEqual((await initializeSettings()).chartNavAccountIds, []);
});
