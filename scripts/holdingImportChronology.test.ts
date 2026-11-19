import test, { beforeEach, after } from 'node:test';
import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';

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

const { db, initializeSettings, exportData, importData, exportToExcel, importFromExcel } = await import('../src/db.ts');
const { importHoldingScreenshot, getHoldingsWithPositions, updateHoldingPositions } = await import('../src/services/holdingService.ts');
const { holdingRealizedEvents } = await import('../src/services/pnlService.ts');
const { formatLocalDate, parseLocalDateTimeMs } = await import('../src/lib/localDate.ts');

beforeEach(async () => {
  await db.transaction('rw', db.tables, async () => { for (const table of db.tables) await table.clear(); });
  await initializeSettings();
  await db.accounts.add({ id: 'stocks', name: 'Broker', category: '股票/ETF', type: 'asset', currency: 'CNY', portfolio: true, cashBalance: 100, sortOrder: 0, createdAt: 1 });
});
after(() => db.close());

test('confirmed same-day execution order sets moving-average cost and realised profit before later buys', async () => {
  const trade = { name: 'Stock', symbol: '000001', market: 'A股', date: '2000-03-01' };
  const trades = [
    { ...trade, kind: 'buy' as const, shares: 100, price: 10, brokerRef: 'AM-BUY' },
    { ...trade, kind: 'sell' as const, shares: 50, price: 12, brokerRef: 'NOON-SELL' },
    { ...trade, kind: 'buy' as const, shares: 100, price: 20, brokerRef: 'PM-BUY' },
  ];
  await importHoldingScreenshot('stocks', { holdings: [], trades }, formatLocalDate());
  const holding = (await getHoldingsWithPositions('stocks'))[0];
  assert.equal(holding.position.shares, 150);
  assert.equal(holding.position.costBasis, 2500);
  assert.equal(holding.position.avgCost, 2500 / 150);
  assert.equal(holding.position.realizedPnl, 100);
  assert.equal(holding.totalPnl, 600);
  const stored = await db.holdingTxns.where('holdingId').equals(holding.id).sortBy('createdAt');
  assert.deepEqual(stored.map(row => row.brokerRef), ['AM-BUY', 'NOON-SELL', 'PM-BUY']);
  assert.deepEqual(holdingRealizedEvents(stored, 'CNY'), [{ date: '2000-03-01', amount: 100, currency: 'CNY' }]);
  assert.equal((await db.accounts.get('stocks'))?.cashBalance, 100);
  assert.deepEqual(await importHoldingScreenshot('stocks', { holdings: [], trades }, formatLocalDate()), { created: 0, updated: 0, insertedTrades: 0, skippedTrades: 3 });
});

test('a newest-first same-day roundtrip rejects atomically until the user confirms chronological order', async () => {
  const trade = { name: 'Stock', symbol: '000001', market: 'A股', date: '2000-03-01', shares: 100 };
  const buy = { ...trade, kind: 'buy' as const, price: 10, brokerRef: 'BUY' };
  const sell = { ...trade, kind: 'sell' as const, price: 12, brokerRef: 'SELL' };
  await assert.rejects(importHoldingScreenshot('stocks', { holdings: [], trades: [sell, buy] }, formatLocalDate()), /HOLDING_POSITION_TRADE_UNDERFLOW/);
  assert.equal(await db.holdings.count(), 0);
  assert.equal(await db.holdingTxns.count(), 0);
  assert.equal(await db.records.count(), 0);
  await importHoldingScreenshot('stocks', { holdings: [], trades: [buy, sell] }, formatLocalDate());
  const holding = (await getHoldingsWithPositions('stocks'))[0];
  assert.equal(holding.position.shares, 0);
  assert.equal(holding.position.realizedPnl, 200);
  assert.equal(holding.totalPnlRate, 20);
});

test('same-day T+0 trades with execution times import cleanly alongside morning, midday, and afternoon calibrations', async () => {
  const tradeDate = formatLocalDate();
  await db.holdings.add({ id: 'etf', accountId: 'stocks', name: '创业板ETF易方达', symbol: '159915', market: 'A股', lastPrice: 2.30, priceDate: '2026-11-13', sortOrder: 0, createdAt: 1 });
  await db.holdingTxns.add({ id: 'base', accountId: 'stocks', holdingId: 'etf', date: '2026-11-13', kind: 'buy', shares: 1000, price: 2.30, createdAt: 1 });

  // 1) Morning calibration on tradeDate before 13:00:02 and 14:30:02 (newest-first input reorders by executionTime).
  const morningMs = parseLocalDateTimeMs(tradeDate, '09:30:00')!;
  await db.holdingTxns.add({
    id: 'morning-cal', accountId: 'stocks', holdingId: 'etf', date: tradeDate,
    kind: 'buy', shares: 0, price: 0, quantitySnapshot: 1000, costPriceSnapshot: 2.30, createdAt: morningMs,
  });
  const t0Trades = [
    { name: '创业板ETF易方达', symbol: '159915.SZ', market: 'A股', date: tradeDate, executionTime: '14:30:02', kind: 'buy' as const, shares: 100, price: 2.299 },
    { name: '创业板ETF易方达', symbol: '159915.SZ', market: 'A股', date: tradeDate, executionTime: '13:00:02', kind: 'sell' as const, shares: 200, price: 2.317 },
  ];
  assert.deepEqual(await importHoldingScreenshot('stocks', { holdings: [], trades: t0Trades }, tradeDate), { created: 0, updated: 1, insertedTrades: 2, skippedTrades: 0 });
  const afterMorning = (await getHoldingsWithPositions('stocks')).find(h => h.id === 'etf')!;
  assert.equal(afterMorning.position.shares, 900);
  assert.ok(Math.abs(afterMorning.position.realizedPnl - 200 * (2.317 - 2.30)) < 1e-9);
  assert.equal(afterMorning.lastPrice, 2.299);
  // Idempotent on retry.
  assert.deepEqual(await importHoldingScreenshot('stocks', { holdings: [], trades: t0Trades }, tradeDate), { created: 0, updated: 0, insertedTrades: 0, skippedTrades: 2 });

  // Verify executionTime survives JSON and Excel backup round-trips.
  const json = await exportData();
  const excel = await exportToExcel();
  await db.holdingTxns.clear();
  assert.equal(await importData(json), true);
  assert.deepEqual((await db.holdingTxns.where('holdingId').equals('etf').sortBy('createdAt')).map(t => t.executionTime ?? null), [null, null, '13:00:02', '14:30:02']);
  await db.holdingTxns.clear();
  assert.equal(await importFromExcel(excel), true);
  assert.deepEqual((await db.holdingTxns.where('holdingId').equals('etf').sortBy('createdAt')).map(t => t.executionTime ?? null), [null, null, '13:00:02', '14:30:02']);

  // 2) Afternoon calibration at 14:35:00 already reflecting the 900 shares: T+0 fills insert BEFORE it without double-counting.
  await db.holdingTxns.where('holdingId').equals('etf').and(tx => tx.id !== 'base').delete();
  const afternoonMs = parseLocalDateTimeMs(tradeDate, '14:35:00')!;
  await db.holdingTxns.add({
    id: 'afternoon-cal', accountId: 'stocks', holdingId: 'etf', date: tradeDate,
    kind: 'buy', shares: 0, price: 0, quantitySnapshot: 900, costPriceSnapshot: 2.2999, createdAt: afternoonMs,
  });
  assert.deepEqual(await importHoldingScreenshot('stocks', { holdings: [], trades: t0Trades }, tradeDate), { created: 0, updated: 1, insertedTrades: 2, skippedTrades: 0 });
  const afterAfternoon = (await getHoldingsWithPositions('stocks')).find(h => h.id === 'etf')!;
  assert.equal(afterAfternoon.position.shares, 900);
  assert.ok(Math.abs(afterAfternoon.position.realizedPnl - 200 * (2.317 - 2.30)) < 1e-9);
  const afternoonSeq = (await db.holdingTxns.where('holdingId').equals('etf').toArray())
    .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt);
  assert.deepEqual(afternoonSeq.map(t => t.executionTime ?? t.id), ['base', '13:00:02', '14:30:02', 'afternoon-cal']);

  // 3) Midday calibration at 13:30:00 between the sell and buy splits them accurately.
  await db.holdingTxns.where('holdingId').equals('etf').and(tx => tx.id !== 'base').delete();
  const middayMs = parseLocalDateTimeMs(tradeDate, '13:30:00')!;
  await db.holdingTxns.add({
    id: 'midday-cal', accountId: 'stocks', holdingId: 'etf', date: tradeDate,
    kind: 'buy', shares: 0, price: 0, quantitySnapshot: 800, costPriceSnapshot: 2.30, createdAt: middayMs,
  });
  await importHoldingScreenshot('stocks', { holdings: [], trades: t0Trades }, tradeDate);
  const afterMidday = (await getHoldingsWithPositions('stocks')).find(h => h.id === 'etf')!;
  assert.equal(afterMidday.position.shares, 900);
  const middaySeq = (await db.holdingTxns.where('holdingId').equals('etf').toArray())
    .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt);
  assert.deepEqual(middaySeq.map(t => t.executionTime ?? t.id), ['base', '13:00:02', 'midday-cal', '14:30:02']);
});

test('timed same-day fills merge with existing untimed or timed fills, adopt executionTime, and keep distinct times separate', async () => {
  const tradeDate = formatLocalDate();
  await db.holdings.add({ id: 'etf', accountId: 'stocks', name: '创业板ETF易方达', symbol: '159915', market: 'A股', lastPrice: 2.30, priceDate: '2026-11-13', sortOrder: 0, createdAt: 1 });
  await db.holdingTxns.bulkAdd([
    { id: 'base', accountId: 'stocks', holdingId: 'etf', date: '2026-11-13', kind: 'buy', shares: 1000, price: 2.30, createdAt: 1 },
    // Existing untimed afternoon buy already entered earlier today:
    { id: 'existing-buy', accountId: 'stocks', holdingId: 'etf', date: tradeDate, kind: 'buy', shares: 100, price: 2.299, createdAt: 2 },
  ]);
  const res = await importHoldingScreenshot('stocks', {
    holdings: [],
    trades: [
      { symbol: '159915.SZ', market: 'A股', date: tradeDate, executionTime: '14:30:02', kind: 'buy', shares: 100, price: 2.299 },
      { symbol: '159915.SZ', market: 'A股', date: tradeDate, executionTime: '13:00:02', kind: 'sell', shares: 200, price: 2.317 },
    ],
  }, tradeDate);
  assert.deepEqual(res, { created: 0, updated: 1, insertedTrades: 1, skippedTrades: 1 });
  const seq = (await db.holdingTxns.where('holdingId').equals('etf').toArray())
    .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt);
  assert.deepEqual(seq.map(t => [t.kind, t.executionTime ?? null]), [['buy', null], ['sell', '13:00:02'], ['buy', '14:30:02']]);
  const holding = (await getHoldingsWithPositions('stocks')).find(h => h.id === 'etf')!;
  assert.equal(holding.position.shares, 900);
  // Realized P&L used pre-13:00 cost (2.30), NOT the 14:30 buy price!
  assert.ok(Math.abs(holding.position.realizedPnl - 200 * (2.317 - 2.30)) < 1e-9);
  // Identical buy at a DIFFERENT executionTime (14:55:00) is kept as a distinct execution rather than deduplicated.
  assert.equal((await importHoldingScreenshot('stocks', {
    holdings: [],
    trades: [{ symbol: '159915.SZ', market: 'A股', date: tradeDate, executionTime: '14:55:00', kind: 'buy', shares: 100, price: 2.299 }],
  }, tradeDate)).insertedTrades, 1);
  assert.equal((await getHoldingsWithPositions('stocks')).find(h => h.id === 'etf')!.position.shares, 1000);
  // Keep unused import check satisfied by confirming untimed calibration still guards against untimed buys.
  await updateHoldingPositions('stocks', [{ holdingId: 'etf', shares: 1000, price: 2.31, costPrice: 2.30 }], tradeDate);
  await assert.rejects(
    importHoldingScreenshot('stocks', { holdings: [], trades: [{ symbol: '159915.SZ', date: tradeDate, kind: 'buy', shares: 100, price: 2.31 }] }, tradeDate),
    /HOLDING_POSITION_TRADE_ORDER_AMBIGUOUS/,
  );
});

test('untimed same-day T+0 imports succeed after an initial same-day buy when pre-day holdings could not cover the sell', async () => {
  const tradeDate = formatLocalDate();
  await db.holdings.add({ id: 'new-today', accountId: 'stocks', name: 'ETF', symbol: '159915', market: 'A股', lastPrice: 2.30, priceDate: tradeDate, sortOrder: 0, createdAt: 1 });
  await db.holdingTxns.add({ id: 'init-today', accountId: 'stocks', holdingId: 'new-today', date: tradeDate, kind: 'buy', shares: 1000, price: 2.30, createdAt: 1 });
  const res = await importHoldingScreenshot('stocks', {
    holdings: [],
    trades: [
      { symbol: '159915', market: 'A股', date: tradeDate, kind: 'sell', shares: 200, price: 2.317 },
      { symbol: '159915', market: 'A股', date: tradeDate, kind: 'buy', shares: 100, price: 2.299 },
    ],
  }, tradeDate);
  assert.equal(res.insertedTrades, 2);
  const holding = (await getHoldingsWithPositions('stocks')).find(h => h.id === 'new-today')!;
  assert.equal(holding.position.shares, 900);
  assert.ok(Math.abs(holding.position.realizedPnl - 200 * (2.317 - 2.30)) < 1e-9);
});
