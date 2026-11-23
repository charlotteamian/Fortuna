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

const { db, initializeSettings } = await import('../src/db.ts');
const { addHoldingTxn } = await import('../src/services/holdingService.ts');
const { tencentCodes } = await import('../src/services/quoteService.ts');
const { forecastHoldingYearDividends, parseDividendResponse, defaultDividendStocks } = await import('../src/lib/dividendWorkbench.ts');
const { deleteAccount } = await import('../src/services/assetService.ts');
const { computePlanDynamicMetrics } = await import('../src/lib/allocationPlan.ts');

beforeEach(async () => {
  await db.transaction('rw', db.tables, async () => { for (const table of db.tables) await table.clear(); });
  await initializeSettings();
  await db.accounts.bulkPut([
    { id: 'stocks', name: 'Stocks', category: '股票/ETF', type: 'asset', currency: 'CNY', portfolio: true, createdAt: 1, sortOrder: 0 },
  ]);
});
after(() => db.close());

// A18: Shanghai convertible bonds (110/113) resolve to Shanghai, not Shenzhen.
test('convertible bond prefixes route to the correct exchange', () => {
  assert.deepEqual(tencentCodes('110100'), ['sh110100']);
  assert.deepEqual(tencentCodes('113500'), ['sh113500']);
  assert.deepEqual(tencentCodes('123456'), ['sz123456']);
  assert.deepEqual(tencentCodes('127000'), ['sz127000']);
  // Unchanged: ordinary equity, Beijing, and STAR market routing.
  assert.deepEqual(tencentCodes('600519'), ['sh600519']);
  assert.deepEqual(tencentCodes('000001'), ['sz000001']);
  assert.deepEqual(tencentCodes('920002'), ['bj920002']);
});

// A10: recording a same-day fill must not overwrite that day's live quote.
test('a same-day fill keeps the live quote; a strictly newer fill adopts its price', async () => {
  const holdingId = await db.holdings.add({
    id: 'h', accountId: 'stocks', name: 'H', symbol: '600000',
    lastPrice: 12.5, priceDate: '2026-03-10', sortOrder: 0, createdAt: 1,
  });
  await addHoldingTxn('stocks', holdingId, { date: '2026-03-10', kind: 'buy', shares: 100, price: 12 });
  let h = await db.holdings.get(holdingId);
  assert.equal(h!.lastPrice, 12.5, 'same-day fill must not replace the quote');
  assert.equal(h!.priceDate, '2026-03-10');

  await addHoldingTxn('stocks', holdingId, { date: '2026-03-11', kind: 'buy', shares: 100, price: 13 });
  h = await db.holdings.get(holdingId);
  assert.equal(h!.lastPrice, 13, 'a strictly newer fill is the freshest price');
  assert.equal(h!.priceDate, '2026-03-11');
});

// A5: the one-year forecast uses the split/transfer-adjusted per-share dividend.
const splitAnnual = {
  SECURITY_CODE: '601398', REPORT_DATE: '2025-12-31', PRETAX_BONUS_RMB: 5.0, BONUS_RATIO: 2,
  ASSIGN_PROGRESS: '实施分配', NOTICE_DATE: '2026-05-07', EX_DIVIDEND_DATE: '2026-05-13', EQUITY_RECORD_DATE: '2026-05-12',
};
const dividendStock = (rows: Record<string, unknown>[], asOf = '2026-10-21') => ({
  ...defaultDividendStocks()[0],
  dividend: parseDividendResponse({ success: true, result: { data: rows, pages: 1 } }, '601398', asOf, 100),
});

test('one-year forecast reflects the post-split per-share dividend', () => {
  const f = forecastHoldingYearDividends(dividendStock([splitAnnual]), '2026-10-21', 1000);
  // 10 send 2 (shareFactor 1.2): the forward dividend per current share is 5.00 / 1.2, not 5.00.
  assert.equal(f.events[0].dpsMicros, 416667);
  assert.equal(f.dpsMicros, 416667);
});

// A1: a sell the position cannot cover is rejected, not silently truncated.
test('an over-selling fill is rejected instead of silently truncated', async () => {
  const holdingId = await db.holdings.add({
    id: 'h', accountId: 'stocks', name: 'H', symbol: '600000', lastPrice: 10, sortOrder: 0, createdAt: 1,
  });
  await addHoldingTxn('stocks', holdingId, { date: '2026-03-10', kind: 'buy', shares: 100, price: 10 });
  await assert.rejects(
    () => addHoldingTxn('stocks', holdingId, { date: '2026-03-11', kind: 'sell', shares: 150, price: 10 }),
    /SELL_EXCEEDS_AVAILABLE/,
  );
  await addHoldingTxn('stocks', holdingId, { date: '2026-03-11', kind: 'sell', shares: 100, price: 10 });
  // A sell dated before the buy that built the position cannot be recorded either.
  await assert.rejects(
    () => addHoldingTxn('stocks', holdingId, { date: '2026-03-09', kind: 'sell', shares: 1, price: 10 }),
    /SELL_EXCEEDS_AVAILABLE/,
  );
});

// A17: deleting an account removes its holdings, transactions and price monitors together.
test('deleting an account clears its holdings, transactions and price monitors', async () => {
  await db.holdings.add({ id: 'h', accountId: 'stocks', name: 'H', symbol: '600000', lastPrice: 10, sortOrder: 0, createdAt: 1 });
  await db.holdingTxns.add({ id: 't', accountId: 'stocks', holdingId: 'h', date: '2026-03-10', kind: 'buy', shares: 100, price: 10, createdAt: 1 });
  await db.priceMonitors.add({
    id: 'm', name: 'H', kind: 'security', currency: 'CNY', accountId: 'stocks',
    targetPriceMicros: 9_000_000, toleranceBps: 0, direction: 'at_or_below', status: 'active', createdAt: 1, updatedAt: 1,
  });
  await deleteAccount('stocks');
  assert.equal(await db.holdings.count(), 0);
  assert.equal(await db.holdingTxns.count(), 0);
  assert.equal(await db.priceMonitors.count(), 0);
  assert.equal(await db.accounts.count(), 0);
});

// A4: without a quote no ladder tier can be placed, so no fake "buy to full" stance is shown.
test('a plan without a quote reports quoteMissing instead of a 100% buy stance', () => {
  const dyn = computePlanDynamicMetrics(
    { targetValue: 1_000_000, currentValue: 500_000, planMode: 'ladder',
      ladderConfig: { kind: 'price', symbol: '600000', currentQuote: undefined, rows: [
        { id: 'r1', triggerValue: 8, positionPercent: 100 }, { id: 'r2', triggerValue: 6, positionPercent: 60 },
      ] } },
    {},
  );
  assert.equal(dyn.quoteMissing, true);
  assert.equal(dyn.activePositionPercent, null);
  assert.equal(dyn.dynamicTargetValue, 1_000_000);
  assert.equal(dyn.reserveNeededValue, 0);
  // With a quote the tier resolves and quoteMissing is false.
  const withQuote = computePlanDynamicMetrics(
    { targetValue: 1_000_000, currentValue: 500_000, planMode: 'ladder',
      ladderConfig: { kind: 'price', symbol: '600000', currentQuote: 7, rows: [
        { id: 'r1', triggerValue: 8, positionPercent: 100 }, { id: 'r2', triggerValue: 6, positionPercent: 60 },
      ] } },
    {},
  );
  assert.equal(withQuote.quoteMissing, false);
  assert.equal(withQuote.activePositionPercent, 100);
});
