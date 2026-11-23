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

test('portfolio chart reads named portfolios only, applies default 0.01% commission, and requires an explicit saved selection', async () => {
  const initialSettings = await initializeSettings();
  assert.equal(initialSettings.chartNavAccountIds, undefined);
  assert.equal(initialSettings.defaultCommissionRatePercent, 0.01);
  const portfoliosWithFee = await getChartPortfolios();
  assert.deepEqual(portfoliosWithFee.map(item => item.account.name), ['My strategy']);
  assert.ok(Math.abs(portfoliosWithFee[0].points[0].nav - (1100 / 1000.1)) < 1e-9);

  await updateSettings({ defaultCommissionRatePercent: 0 });
  const portfoliosZeroFee = await getChartPortfolios();
  assert.deepEqual(portfoliosZeroFee[0].points.map(point => point.nav), [1.1]);
  const beforeAccounts = await db.accounts.toArray(), beforeRecords = await db.records.toArray();
  await updateSettings({ chartNavAccountIds: ['strategy'] });
  assert.deepEqual((await initializeSettings()).chartNavAccountIds, ['strategy']);
  assert.deepEqual(await db.accounts.toArray(), beforeAccounts);
  assert.deepEqual(await db.records.toArray(), beforeRecords);
});

test('portfolio statistics choice and commission settings survive JSON and Excel backups and can be turned off', async () => {
  await updateSettings({ chartNavAccountIds: ['strategy'], defaultCommissionRatePercent: 0.025 });
  await db.holdings.update('h1', { commissionRatePercent: 0.03 });
  await db.holdingTxns.update('t1', { fee: 1.5 });
  await db.holdingTxns.add({ id: 'anchor', accountId: 'strategy', holdingId: 'h1', date: '2026-01-15', kind: 'buy', shares: 0, price: 0, quantitySnapshot: 120, costPriceSnapshot: 10.2, marketPriceSnapshot: 10.8, createdAt: 5 });
  const json = await exportData(), excel = await exportToExcel();
  await updateSettings({ chartNavAccountIds: [], defaultCommissionRatePercent: 0 });
  assert.equal(await importData(json), true);
  assert.deepEqual((await initializeSettings()).chartNavAccountIds, ['strategy']);
  assert.equal((await initializeSettings()).defaultCommissionRatePercent, 0.025);
  assert.equal((await db.holdings.get('h1'))?.commissionRatePercent, 0.03);
  assert.equal((await db.holdingTxns.get('t1'))?.fee, 1.5);
  assert.equal((await db.holdingTxns.get('anchor'))?.marketPriceSnapshot, 10.8);
  await db.holdingTxns.update('anchor', { marketPriceSnapshot: 1 });
  await updateSettings({ chartNavAccountIds: [], defaultCommissionRatePercent: 0 });
  assert.equal(await importFromExcel(excel), true);
  assert.equal((await db.holdingTxns.get('anchor'))?.marketPriceSnapshot, 10.8);
  assert.deepEqual((await initializeSettings()).chartNavAccountIds, ['strategy']);
  assert.equal((await initializeSettings()).defaultCommissionRatePercent, 0.025);
  assert.equal((await db.holdings.get('h1'))?.commissionRatePercent, 0.03);
  assert.equal((await db.holdingTxns.get('t1'))?.fee, 1.5);
  await updateSettings({ chartNavAccountIds: [] });
  assert.deepEqual((await initializeSettings()).chartNavAccountIds, []);
});
