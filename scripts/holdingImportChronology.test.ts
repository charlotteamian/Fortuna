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

const { db, initializeSettings } = await import('../src/db.ts');
const { importHoldingScreenshot, getHoldingsWithPositions } = await import('../src/services/holdingService.ts');
const { holdingRealizedEvents } = await import('../src/services/pnlService.ts');
const { formatLocalDate } = await import('../src/lib/localDate.ts');

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
