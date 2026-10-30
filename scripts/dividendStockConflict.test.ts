import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import test, { after, beforeEach } from 'node:test';
import type { DividendStock } from '../src/lib/dividendWorkbench.ts';

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

const { db, initializeSettings, updateSettings, exportData } = await import('../src/db.ts');
const { dividendStockEditFingerprint, saveDividendStock } = await import('../src/services/dividendService.ts');

const stock = (): DividendStock => ({ code: '000001', name: 'Synthetic stock', group: 'core', weightBps: 5000,
  shareMode: 'manual', manualShares: 100, manualDpsMicros: 609000, lotSize: 100, note: 'Original note', buyPaused: false,
  buyLevels: [{ yieldBps: 550, portionBps: 10000, priceMinor: 1000 }],
  sellLevels: [{ yieldBps: 480, portionBps: 10000, priceMinor: 1200 }],
  gridProvenance: { generatedAt: 1793235600000, grossDpsMicros: 609000, taxBps: 1000, parameterVersion: 5, basisKind: 'recent_batches' } });
async function state() { const value = JSON.parse(await exportData()); delete value.timestamp; return value; }

beforeEach(async () => {
  await db.transaction('rw', db.tables, async () => { for (const table of db.tables) await table.clear(); });
  await initializeSettings();
  await updateSettings({ dividendBudgetMinor: 1234567, dividendWorkbenchInitialized: true });
  await db.dividendStocks.put(stock());
  await db.accounts.put({ id: 'synthetic-account', name: 'Synthetic account', category: '股票/ETF', type: 'asset', currency: 'CNY', portfolio: true, createdAt: 1, sortOrder: 0 });
  await db.holdings.put({ id: 'synthetic-holding', accountId: 'synthetic-account', name: 'Synthetic stock', symbol: '000001', createdAt: 1, sortOrder: 0 });
  await db.holdingTxns.put({ id: 'synthetic-buy', holdingId: 'synthetic-holding', accountId: 'synthetic-account', date: '2020-01-01', kind: 'buy', shares: 100, price: 10, createdAt: 1 });
});
after(() => db.close());

test('a stale note save cannot replace a newer grid, pause or manual position', async () => {
  const original = stock(), expectedFingerprint = dividendStockEditFingerprint(original);
  await db.dividendStocks.update(original.code, { buyLevels: [{ yieldBps: 550, portionBps: 10000, priceMinor: 900 }], buyPaused: true, manualShares: 200 });
  const latest = await state();
  await assert.rejects(saveDividendStock({ ...original, note: 'Only the note was edited' }, { expectedFingerprint }), /DIVIDEND_STOCK_CHANGED/);
  assert.deepEqual(await state(), latest, 'a rejected save must not change any ledger or plan field');
});

test('every user-editable field and saved grid provenance participates in conflict protection', async () => {
  const original = stock(), expectedFingerprint = dividendStockEditFingerprint(original);
  const changes: Partial<DividendStock>[] = [
    { name: 'New name' }, { group: 'watch' }, { weightBps: 6000 }, { shareMode: 'linked' }, { manualShares: 200 },
    { manualDpsMicros: 610000 }, { lotSize: 200 }, { note: 'New note' }, { buyPaused: true },
    { buyLevels: [{ yieldBps: 600, portionBps: 10000, priceMinor: 900 }] },
    { sellLevels: [{ yieldBps: 450, portionBps: 10000, priceMinor: 1400 }] },
    { gridProvenance: { ...original.gridProvenance!, grossDpsMicros: 610000 } }, { gridProvenance: undefined },
  ];
  for (const change of changes) {
    await db.dividendStocks.put({ ...original, ...change });
    const latest = await state();
    await assert.rejects(saveDividendStock({ ...original, note: 'Old form note' }, { expectedFingerprint }), /DIVIDEND_STOCK_CHANGED/, JSON.stringify(change));
    assert.deepEqual(await state(), latest);
  }
});

test('normal guarded edits preserve the ledger, budget, other stocks and grid provenance', async () => {
  const original = stock();
  await db.dividendStocks.put({ ...stock(), code: '000002', name: 'Other synthetic stock' });
  const before = await state();
  await saveDividendStock({ ...original, name: 'Edited name', group: 'watch', weightBps: 4000, manualShares: 300, note: 'Edited note', gridProvenance: undefined },
    { expectedFingerprint: dividendStockEditFingerprint(original) });
  const saved = (await db.dividendStocks.get(original.code))!;
  assert.deepEqual(saved, { ...original, name: 'Edited name', group: 'watch', weightBps: 4000, manualShares: 300, note: 'Edited note' });
  assert.deepEqual(await state(), { ...before, dividendStocks: before.dividendStocks.map((row: DividendStock) => row.code === original.code ? saved : row) });
});

test('a concurrent quote, dividend or trend refresh does not reject a draft or restore old caches', async () => {
  const original = stock(), expectedFingerprint = dividendStockEditFingerprint(original);
  const marketFields: Partial<DividendStock> = {
    quote: { priceMinor: 950, date: '2026-10-30 15:00:00', fetchedAt: 1793343600000 }, quoteFailedAt: 1793343600001,
    dividend: { schemaVersion: 2, asOf: '2026-10-30', windowStart: '2025-10-30', dpsMicros: 609000, payments: [], announcements: [], fetchedAt: 1793343600000 },
    trend: { date: '2026-10-30', fetchedAt: 1793343600000, rsi6: 50, ma5Minor: 950, ma10Minor: 960, ma30Minor: 970,
      bollLowerMinor: 900, bollMiddleMinor: 960, bollUpperMinor: 1020, change5: -1, change10: -2, change30: -3 },
    dividendFailedAt: 1793343600002, trendFailedAt: 1793343600003,
  };
  await db.dividendStocks.update(original.code, marketFields);
  assert.equal(dividendStockEditFingerprint((await db.dividendStocks.get(original.code))!), expectedFingerprint);
  await saveDividendStock({ ...original, note: 'Keep latest market data' }, { expectedFingerprint });
  assert.deepEqual(await db.dividendStocks.get(original.code), { ...original, ...marketFields, note: 'Keep latest market data' });
});

test('guarded edits do not restore cache values or failed markers that were cleared after opening', async () => {
  const original = { ...stock(), quote: { priceMinor: 1000, date: '2026-10-29', fetchedAt: 1 }, quoteFailedAt: 2 };
  await db.dividendStocks.put(original);
  const expectedFingerprint = dividendStockEditFingerprint(original);
  await db.dividendStocks.put(stock());
  await saveDividendStock({ ...original, note: 'Keep caches cleared' }, { expectedFingerprint });
  assert.deepEqual(await db.dividendStocks.get(original.code), { ...stock(), note: 'Keep caches cleared' });
});

test('an editor cannot recreate a deleted stock or change a replacement with the same code', async () => {
  const original = stock(), expectedFingerprint = dividendStockEditFingerprint(original);
  await db.dividendStocks.delete(original.code);
  const deleted = await state();
  await assert.rejects(saveDividendStock({ ...original, note: 'Old form' }, { expectedFingerprint }), /DIVIDEND_STOCK_CHANGED/);
  assert.deepEqual(await state(), deleted);
  await db.dividendStocks.put({ ...original, name: 'Replacement stock', buyPaused: true });
  const replacement = await state();
  await assert.rejects(saveDividendStock({ ...original, note: 'Old form' }, { expectedFingerprint }), /DIVIDEND_STOCK_CHANGED/);
  assert.deepEqual(await state(), replacement);
});

test('new-stock saves reject any existing code inside the transaction and only create a missing code', async () => {
  const before = await state();
  await assert.rejects(saveDividendStock({ ...stock(), note: 'New form must not replace existing stock' }, { expectNew: true }), /DIVIDEND_STOCK_CHANGED/);
  assert.deepEqual(await state(), before);
  const addition = { ...stock(), code: '000002', name: 'New synthetic stock' };
  delete addition.gridProvenance;
  await saveDividendStock(addition, { expectNew: true });
  assert.deepEqual(await db.dividendStocks.get(addition.code), addition);
  const created = await state();
  await assert.rejects(saveDividendStock({ ...addition, note: 'Retry old new-form save' }, { expectNew: true }), /DIVIDEND_STOCK_CHANGED/);
  assert.deepEqual(await state(), created);
});

test('guarded manual price changes clear the old origin while preserving the opposite grid and pause', async () => {
  const original = { ...stock(), buyPaused: true };
  await db.dividendStocks.put(original);
  const edited = { ...original, buyLevels: [{ yieldBps: 550, portionBps: 10000, priceMinor: 900 }] };
  await saveDividendStock(edited, { expectedFingerprint: dividendStockEditFingerprint(original) });
  const withoutOrigin = { ...edited };
  delete withoutOrigin.gridProvenance;
  assert.deepEqual(await db.dividendStocks.get(original.code), withoutOrigin);
});
