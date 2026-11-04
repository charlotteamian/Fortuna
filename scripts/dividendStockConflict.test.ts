import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import test, { after, beforeEach } from 'node:test';
import { dateInChina, type DividendStock } from '../src/lib/dividendWorkbench.ts';
import { buildClassicStockPlan } from '../src/lib/dividendClassicStrategy.ts';

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
const { applyClassicDividendGrid, classicDividendGridFingerprint, dividendStockEditFingerprint, saveDividendStock, saveDividendStockWeight } = await import('../src/services/dividendService.ts');
const { loadDividendWorkbench, loadDividendWorkbenchReadOnly, repairOverallocatedDividendWeights, saveDividendBudget, saveDividendHomeCollapse } = await import('../src/services/dividendService.ts');

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

test('inline allocation changes only the selected weight and preserves the entire saved ledger', async () => {
  const original = { ...stock(), weightBps: 0, quote: { priceMinor: 950, date: '2026-11-03 10:00:00', fetchedAt: 1 } };
  await db.dividendStocks.put(original);
  await db.dividendStocks.put({ ...stock(), code: '000002', weightBps: 6000 });
  const before = await state();
  await saveDividendStockWeight(original.code, 2500);
  assert.deepEqual(await state(), { ...before, dividendStocks: before.dividendStocks.map((row: DividendStock) => row.code === original.code ? { ...original, weightBps: 2500 } : row) });
});

test('inline allocation rejects invalid and missing writes without changing data', async () => {
  await db.dividendStocks.put({ ...stock(), code: '000002', weightBps: 5000 });
  const before = await state();
  for (const weight of [-1, 1.5, NaN, Infinity, 10001]) await assert.rejects(saveDividendStockWeight('000001', weight), /INVALID_DIVIDEND_STOCK/);
  await assert.rejects(saveDividendStockWeight('bad-code', 1000), /INVALID_DIVIDEND_STOCK/);
  await assert.rejects(saveDividendStockWeight('000003', 1000), /DIVIDEND_STOCK_MISSING/);
  assert.deepEqual(await state(), before);
});

test('concurrent inline allocations rebalance against the latest saved weights', async () => {
  await db.dividendStocks.put({ ...stock(), weightBps: 6000 });
  await db.dividendStocks.bulkPut(['000002', '000003'].map(code => ({ ...stock(), code, weightBps: 0 })));
  const before = await state();
  const results = await Promise.all(['000002', '000003'].map(code => saveDividendStockWeight(code, 3000)));
  assert.equal(results.filter(result => result.rebalanced).length, 1);
  assert.deepEqual(await state(), {
    ...before, dividendStocks: before.dividendStocks.map((row: DividendStock, i: number) => ({ ...row, weightBps: [5000, 2500, 2500][i] })),
  });
});

test('an editor opened before inline allocation cannot restore the previous weight', async () => {
  const original = stock(), expectedFingerprint = dividendStockEditFingerprint(original);
  await saveDividendStockWeight(original.code, 6000);
  const allocated = await state();
  await assert.rejects(saveDividendStock({ ...original, note: 'Stale draft' }, { expectedFingerprint }), /DIVIDEND_STOCK_CHANGED/);
  assert.deepEqual(await state(), allocated);
});

test('absent homepage preferences default closed without writes; explicit expanded preferences survive reload', async () => {
  const before = await state();
  assert.deepEqual((await loadDividendWorkbench()).collapsedCodes, ['000001']);
  assert.deepEqual(await state(), before);
  await updateSettings({ dividendHomeCollapsedCodes: [] });
  const expanded = await state();
  assert.deepEqual((await loadDividendWorkbench()).collapsedCodes, []);
  assert.deepEqual(await state(), expanded);
});

test('first expansion preserves other default-closed cards and writes only the existing reading preference', async () => {
  await db.dividendStocks.put({ ...stock(), code: '000002' });
  const before = await state();
  await saveDividendHomeCollapse('000001', false);
  const after = await state();
  assert.deepEqual(after, { ...before, settings: [{ ...before.settings[0], dividendHomeCollapsedCodes: ['000002'] }] });
  assert.deepEqual((await loadDividendWorkbench()).collapsedCodes, ['000002']);
});

test('fund collapse uses the existing reading field and cannot alter the saved fund plan, ledger or stock preferences', async () => {
  const { defaultDividendFundPlan } = await import('../src/lib/dividendFundPlan.ts');
  await updateSettings({ dividendHomeCollapsedCodes: ['000001'], dividendFundPlan: { ...defaultDividendFundPlan(), funds: [{ id: 'synthetic-fund', name: 'Synthetic', indexKind: 'other', weightBps: 10000 }] } });
  const before = await state();
  await saveDividendHomeCollapse('fund:synthetic-fund', false);
  assert.deepEqual(await state(), { ...before, settings: [{ ...before.settings[0], dividendHomeCollapsedCodes: ['000001', 'open:fund:synthetic-fund'] }] });
  await saveDividendHomeCollapse('fund:synthetic-fund', true);
  assert.deepEqual(await state(), before);
  await assert.rejects(saveDividendHomeCollapse('fund:not-configured', false), /INVALID_DIVIDEND_STOCK/);
  assert.deepEqual(await state(), before);
});

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

test('adding a weighted stock to a full portfolio scales positive weights and keeps observations unallocated', async () => {
  const existing = { ...stock(), weightBps: 6000 };
  const hidden = { ...stock(), code: '000002', group: 'hidden' as const, weightBps: 4000 };
  const observation = { ...stock(), code: '000003', group: 'watch' as const, weightBps: 0 };
  await db.dividendStocks.bulkPut([existing, hidden, observation]);
  const before = await state();
  const addition = { ...stock(), code: '000004', weightBps: 2000 };
  delete addition.gridProvenance;
  assert.deepEqual(await saveDividendStock(addition, { expectNew: true }), { rebalanced: true });
  assert.deepEqual(await state(), {
    ...before, dividendStocks: [
      { ...existing, weightBps: 5000 }, { ...hidden, weightBps: 3333 }, observation, { ...addition, weightBps: 1667 },
    ],
  });
  await assert.rejects(saveDividendStock({ ...hidden, note: 'Stale after redistribution' }, {
    expectedFingerprint: dividendStockEditFingerprint(hidden),
  }), /DIVIDEND_STOCK_CHANGED/);
});

test('a rebalance write failure rolls back the new stock and previous weights', async () => {
  await db.dividendStocks.put({ ...stock(), code: '000002', weightBps: 5000 });
  const before = await state();
  const failUpdate = (_changes: unknown, key: string) => { if (key === '000002') throw new Error('simulated rebalance failure'); };
  db.dividendStocks.hook('updating', failUpdate);
  try {
    await assert.rejects(saveDividendStock({ ...stock(), code: '000003', weightBps: 3000 }, { expectNew: true }), /simulated rebalance failure/);
    assert.deepEqual(await state(), before);
  } finally { db.dividendStocks.hook('updating').unsubscribe(failUpdate); }
});

test('budget save repairs legacy overflow in the same write while opening leaves saved weights intact', async () => {
  await db.dividendStocks.bulkPut([{ ...stock(), weightBps: 7000 }, { ...stock(), code: '000002', weightBps: 5000 }]);
  const before = await state();
  assert.deepEqual((await loadDividendWorkbench()).stocks.map(row => row.weightBps), [7000, 5000]);
  assert.deepEqual(await state(), before);
  assert.deepEqual(await saveDividendBudget(2345678), { rebalanced: true });
  assert.deepEqual(await state(), {
    ...before, settings: [{ ...before.settings[0], dividendBudgetMinor: 2345678 }],
    dividendStocks: before.dividendStocks.map((row: DividendStock, i: number) => ({ ...row, weightBps: [5833, 4167][i] })),
  });
});

test('entry repair scales only saved overflow and never fills an allocation reduced by a concurrent write', async () => {
  await db.dividendStocks.bulkPut([{ ...stock(), weightBps: 7000 }, { ...stock(), code: '000002', weightBps: 5000 }]);
  const before = await state();
  assert.deepEqual((await loadDividendWorkbenchReadOnly()).stocks.map(row => row.weightBps), [7000, 5000]);
  assert.deepEqual(await state(), before);
  assert.deepEqual(await repairOverallocatedDividendWeights(), { rebalanced: true });
  assert.deepEqual(await state(), {
    ...before, dividendStocks: before.dividendStocks.map((row: DividendStock, i: number) => ({ ...row, weightBps: [5833, 4167][i] })),
  });
  const edit = saveDividendStockWeight('000002', 2000);
  const repair = repairOverallocatedDividendWeights();
  assert.deepEqual(await edit, { rebalanced: false });
  assert.deepEqual(await repair, { rebalanced: false });
  assert.deepEqual((await loadDividendWorkbenchReadOnly()).stocks.map(row => row.weightBps), [5833, 2000]);
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


test('classic grid confirmation rejects a stale preview and stores the refreshed candidate exactly', async () => {
  const original = stock();
  const asOf = dateInChina();
  const expected = (current: DividendStock) => ({
    asOf,
    stockFingerprint: dividendStockEditFingerprint(current),
    gridFingerprint: classicDividendGridFingerprint(buildClassicStockPlan(current, { asOf, taxBps: 1000 })),
  });
  const changed = { ...original, manualDpsMicros: 888000 };
  await db.dividendStocks.put(changed);
  const before = await state();
  await assert.rejects(applyClassicDividendGrid(original.code, 1000, expected(original)), /DIVIDEND_REVIEW_CHANGED/);
  assert.deepEqual(await state(), before);
  await applyClassicDividendGrid(changed.code, 1000, expected(changed));
  const saved = await db.dividendStocks.get(changed.code);
  const candidate = buildClassicStockPlan(changed, { asOf, taxBps: 1000 });
  assert.deepEqual(saved?.buyLevels, candidate.classicBuyLevels);
  assert.deepEqual(saved?.sellLevels, candidate.classicSellLevels);
});
