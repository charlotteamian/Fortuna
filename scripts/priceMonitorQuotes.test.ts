import test, { beforeEach, after } from 'node:test';
import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
registerHooks({
  resolve(specifier, context, nextResolve) {
    if ((specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL) {
      const file = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(file)) return { url: file.href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.endsWith('.json')) return { format: 'module', source: `export default ${readFileSync(new URL(url), 'utf8')}`, shortCircuit: true };
    return nextLoad(url, context);
  },
});
const { db, initializeSettings } = await import('../src/db.ts');
const { parseSecurityMonitorQuotes } = await import('../src/services/quoteService.ts');
const { savePriceMonitor, stopPriceMonitor } = await import('../src/services/priceMonitorService.ts');
const { refreshPriceMonitorQuotes } = await import('../src/services/priceMonitorQuoteService.ts');
const now = new Date('2026-10-22T12:00:00Z').getTime();
function quote(symbol: string, price: string, stamp: string) {
  const fields = Array.from({ length: 31 }, () => ''); fields[3] = price; fields[30] = stamp;
  return `v_${symbol}="${fields.join('~')}";`;
}
const target = { id: 'equity', symbol: '510300', market: 'A股', currency: 'CNY' };
beforeEach(async () => {
  await db.transaction('rw', db.tables, async () => { for (const table of db.tables) await table.clear(); });
  await initializeSettings();
});
after(() => db.close());

test('source timestamps and ETF precision survive A/HK/US parsing, with failed symbols isolated', () => {
  const targets = [target, { id: 'hk', symbol: '00700', market: '港股', currency: 'HKD' }, { id: 'us', symbol: 'AAPL', market: '美股', currency: 'USD' }, { id: 'missing', symbol: '600036', currency: 'CNY' }];
  const result = parseSecurityMonitorQuotes(quote('sh510300', '1.234567', '20261022150000') + quote('hk00700', '382.4', '2026/10/22 16:08:40') + quote('usAAPL', '344.23', '2026-10-22 10:56:19'), targets, now);
  assert.equal(result.equity.priceMicros, 1234567);
  assert.equal(result.hk.date, '2026-10-22 16:08');
  assert.equal(result.us.priceMicros, 344230000);
  assert.equal(result.missing, undefined);
});

test('undated, invalid, stale, future, zero and wrong-currency quotes cannot trigger monitoring', () => {
  for (const [price, stamp] of [['1', ''], ['1', '20260230150000'], ['1', '20261001150000'], ['1', '20261025150000'], ['0', '20261022150000'], ['NaN', '20261022150000']]) {
    assert.deepEqual(parseSecurityMonitorQuotes(quote('sh510300', price, stamp), [target], now), {});
  }
  assert.deepEqual(parseSecurityMonitorQuotes(quote('sh510300', '1', '20261022150000'), [{ ...target, currency: 'USD' }], now), {});
});

test('Beijing 920 securities and dotted US tickers resolve to their actual quote symbols', () => {
  const result = parseSecurityMonitorQuotes(quote('bj920002', '48.99', '20261022150000') + quote('usBRK.B', '546.15', '2026-10-22 11:03:20'), [
    { id: 'bj', symbol: '920002', market: 'A股', currency: 'CNY' },
    { id: 'brk', symbol: 'BRK.B', market: '美股', currency: 'USD' },
  ], now);
  assert.equal(result.bj.priceMicros, 48990000);
  assert.equal(result.brk.priceMicros, 546150000);
});

test('never-held security is fetched independently and daily refresh is coalesced; reaching supersedes near', async context => {
  let price = '10.2'; let calls = 0;
  const stamp = new Date().toISOString().slice(0, 10).replaceAll('-', '') + '100000';
  context.mock.method(globalThis, 'fetch', async () => { calls++; return new Response(quote('sh510300', price, stamp)); });
  const plan = await savePriceMonitor({ kind: 'security', name: 'Sold-out ETF', symbol: '510300', market: 'A股', currency: 'CNY', targetPriceMicros: 10000000, toleranceBps: 300, direction: 'at_or_below' });
  assert.equal(await db.holdings.count(), 0);
  assert.deepEqual(await refreshPriceMonitorQuotes({ force: true }), { checked: 1, near: 1, reached: 0, failed: 0 });
  assert.equal((await db.priceMonitors.get(plan.id))!.alert!.kind, 'near');
  assert.deepEqual(await refreshPriceMonitorQuotes(), { checked: 0, near: 0, reached: 0, failed: 0 });
  assert.equal(calls, 1);
  assert.equal((await refreshPriceMonitorQuotes({ force: true })).near, 0);
  price = '9.9';
  assert.equal((await refreshPriceMonitorQuotes({ force: true })).reached, 1);
  assert.equal((await db.priceMonitors.get(plan.id))!.status, 'reached');
  const reachedCalls = calls;
  await refreshPriceMonitorQuotes({ force: true }); assert.equal(calls, reachedCalls);
});

test('stopping during an outstanding response prevents a late alert', async context => {
  let release: (() => void) | undefined;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let requested: (() => void) | undefined;
  const started = new Promise<void>(resolve => { requested = resolve; });
  const stamp = new Date().toISOString().slice(0, 10).replaceAll('-', '') + '100000';
  context.mock.method(globalThis, 'fetch', async () => { requested!(); await gate; return new Response(quote('sh510300', '9', stamp)); });
  const plan = await savePriceMonitor({ kind: 'security', name: 'Stop while loading', symbol: '510300', market: 'A股', currency: 'CNY', targetPriceMicros: 10000000, toleranceBps: 300, direction: 'at_or_below' });
  const request = refreshPriceMonitorQuotes({ force: true });
  await started; await stopPriceMonitor(plan.id); release!(); await request;
  const saved = (await db.priceMonitors.get(plan.id))!;
  assert.equal(saved.status, 'stopped'); assert.equal(saved.alert, undefined);
});

test('gold network failure does not turn stale valuation fallback into a new alert', async context => {
  context.mock.method(globalThis, 'fetch', async input => String(input).includes('frankfurter')
    ? new Response(JSON.stringify([{ quote: 'CNY', rate: 7.1, date: '2026-10-22' }]), { headers: { 'Content-Type': 'application/json' } })
    : new Response('', { status: 503 }));
  await db.exchangeRates.put({ id: 'metal_domestic_XAU_CNY', base: 'XAU', quote: 'CNY', rate: 600, date: '2026-10-01', updatedAt: 1 });
  const plan = await savePriceMonitor({ kind: 'gold', name: 'Gold', metalType: 'XAU', currency: 'CNY', targetPriceMicros: 700000000, toleranceBps: 300, direction: 'at_or_below' });
  const result = await refreshPriceMonitorQuotes({ force: true });
  assert.equal(result.failed, 1); assert.equal(result.checked, 0);
  const saved = (await db.priceMonitors.get(plan.id))!;
  assert.equal(saved.alert, undefined); assert.ok(saved.lastErrorAt); assert.equal(saved.lastQuote, undefined);
});

test('FX failure only blocks converted gold plans while USD gold still refreshes', async context => {
  context.mock.method(globalThis, 'fetch', async input => String(input).includes('frankfurter')
    ? new Response('', { status: 503 })
    : new Response(JSON.stringify({ price: 4000 }), { headers: { 'Content-Type': 'application/json' } }));
  context.mock.method(console, 'error', () => {});
  const { updateSettings } = await import('../src/db.ts'); await updateSettings({ goldPriceSource: 'international' });
  const input = { kind: 'gold' as const, name: 'Gold', metalType: 'XAU', currency: 'USD', targetPriceMicros: 200000000, toleranceBps: 300, direction: 'at_or_below' as const };
  const dollar = await savePriceMonitor(input);
  const converted = await savePriceMonitor({ ...input, currency: 'CNY' });
  const result = await refreshPriceMonitorQuotes({ force: true });
  assert.equal(result.reached, 1); assert.equal(result.failed, 1);
  assert.equal((await db.priceMonitors.get(dollar.id))!.status, 'reached');
  assert.equal((await db.priceMonitors.get(converted.id))!.status, 'active');
});
