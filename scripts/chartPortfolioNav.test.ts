import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAccountNavPoints, getEligibleNavAccounts, normalizeNavAccountIds, summarizeAccountNav } from '../src/lib/chartPortfolioNav.ts';

test('NAV is opt-in for named active asset portfolios regardless of global-total participation', () => {
  const accounts = [
    { id: 'strategy', type: 'asset' as const, portfolio: true, includeInTotals: false },
    { id: 'bank', type: 'asset' as const },
    { id: 'debt', type: 'liability' as const, portfolio: true },
    { id: 'archive', type: 'asset' as const, portfolio: true, archivedAt: 1 },
    { id: 'hidden', type: 'asset' as const, portfolio: true, hidden: true },
  ];
  assert.deepEqual(getEligibleNavAccounts(accounts).map(account => account.id), ['strategy']);
  assert.deepEqual(normalizeNavAccountIds(undefined, accounts), []);
  assert.deepEqual(normalizeNavAccountIds(['strategy', 'bank', 'strategy', 'gone'], accounts), ['strategy']);
});

test('NAV is return on capital deployed from realised plus floating P&L, independent of cash', () => {
  const holdings = [{ id: 'h1', accountId: 'a', lastPrice: 15 }];
  const txns = [
    { id: 't1', accountId: 'a', holdingId: 'h1', date: '2026-01-01', kind: 'buy' as const, shares: 100, price: 10, createdAt: 1 },
    { id: 't2', accountId: 'a', holdingId: 'h1', date: '2026-02-01', kind: 'sell' as const, shares: 50, price: 15, createdAt: 2 },
  ];
  const points = buildAccountNavPoints('a', holdings, txns);
  assert.deepEqual(points.map(point => point.nav), [1, 1.5]);
  const summary = summarizeAccountNav(points);
  assert.equal(summary.latestNav, 1.5);
  assert.equal(summary.cumulativeReturnPercent, 50);
  assert.equal(summary.maxDrawdownPercent, 0);
});

test('all holdings carry forward across transaction dates and same-day trades contribute only their final state', () => {
  const trade = (id: string, holdingId: string, date: string, price: number) => ({ id, holdingId, accountId: 'a', date, price, shares: 100, kind: 'buy' as const, createdAt: Number(id) });
  const holdings = [{ id: 'one', accountId: 'a', lastPrice: 20 }, { id: 'two', accountId: 'a', lastPrice: 10 }];
  const points = buildAccountNavPoints('a', holdings, [trade('1', 'one', '2026-01-01', 10), trade('2', 'two', '2026-02-01', 10)]);
  assert.deepEqual(points.map(point => point.nav), [1, 1.5]);
  assert.equal(summarizeAccountNav(points).cumulativeReturnPercent, 50);
  const sameDay = buildAccountNavPoints('a', holdings, [trade('1', 'one', '2026-01-01', 10), trade('2', 'one', '2026-01-01', 20)]);
  assert.equal(sameDay.length, 1); assert.equal(sameDay[0].nav, 4 / 3);
});

test('mixed stock and option weights use the option multiplier for buys, sells and quantity snapshots', () => {
  const holdings = [{ id: 'stock', accountId: 'a', lastPrice: 10 }, { id: 'option', accountId: 'a', lastPrice: 20, instrumentType: 'us_option' as const, contractMultiplier: 100 }];
  const txns = [
    { id: '1', accountId: 'a', holdingId: 'stock', date: '2026-01-01', kind: 'buy' as const, shares: 100, price: 10, createdAt: 1 },
    { id: '2', accountId: 'a', holdingId: 'option', date: '2026-01-01', kind: 'buy' as const, shares: 1, price: 10, createdAt: 2 },
    { id: '3', accountId: 'a', holdingId: 'option', date: '2026-01-02', kind: 'sell' as const, shares: 0.5, price: 20, createdAt: 3 },
    { id: '4', accountId: 'a', holdingId: 'option', date: '2026-01-03', kind: 'buy' as const, shares: 0, price: 0, quantitySnapshot: 1, costPriceSnapshot: 10, createdAt: 4 },
  ];
  const points = buildAccountNavPoints('a', holdings, txns);
  assert.equal(points[0].nav, 1); assert.equal(points[1].nav, 1.5); assert.equal(points[2].nav, 1.6);
});

test('losing portfolio stays negative instead of rebasing day-1 losses into a fake gain', () => {
  // Reproduces a portfolio losing -469.70 (-0.70%) on 66,795.30 deployed capital,
  // where the first day's holding fell -5% and later purchases diluted the loss to -0.70%.
  const holdings = [
    { id: 'h1', accountId: 'a', lastPrice: 14.25, priceDate: '2026-11-19' },
    { id: 'h2', accountId: 'a', lastPrice: 10, priceDate: '2026-11-19' },
    { id: 'h3', accountId: 'a', lastPrice: 10.14015, priceDate: '2026-11-19' },
    { id: 'h4', accountId: 'a', lastPrice: 10, priceDate: '2026-11-19' },
    { id: 'h5', accountId: 'a', lastPrice: 10, priceDate: '2026-11-19' },
  ];
  const txns = [
    { id: '1', accountId: 'a', holdingId: 'h1', date: '2026-11-13', kind: 'buy' as const, shares: 1000, price: 15, createdAt: 1 },
    { id: '2', accountId: 'a', holdingId: 'h2', date: '2026-11-16', kind: 'buy' as const, shares: 2000, price: 10, createdAt: 2 },
    { id: '3', accountId: 'a', holdingId: 'h3', date: '2026-11-17', kind: 'buy' as const, shares: 2000, price: 10, createdAt: 3 },
    { id: '4', accountId: 'a', holdingId: 'h4', date: '2026-11-18', kind: 'buy' as const, shares: 679.53, price: 10, createdAt: 4 },
    { id: '5', accountId: 'a', holdingId: 'h5', date: '2026-11-19', kind: 'buy' as const, shares: 500, price: 10, createdAt: 5 },
  ];
  const points = buildAccountNavPoints('a', holdings, txns);
  const full = summarizeAccountNav(points);
  assert.equal(full.latestNav, 0.993);
  assert.equal(full.cumulativeReturnPercent, -0.7);
  assert.equal(full.maxDrawdownPercent, 0.7);
  // Even when a wider time filter like 3M covers the full history, returns stay -0.7%.
  const threeMonth = summarizeAccountNav(points, '2026-08-19');
  assert.equal(threeMonth.latestNav, 0.993);
  assert.equal(threeMonth.cumulativeReturnPercent, -0.7);
  // Even if day 1 already had a recorded loss before later buys diluted it, never rebase 0.95 -> 1.00.
  const preDropped = summarizeAccountNav([{ date: '2026-11-13', nav: 0.9505 }, { date: '2026-11-19', nav: 0.993 }]);
  assert.equal(preDropped.latestNav, 0.993);
  assert.equal(preDropped.cumulativeReturnPercent, -0.7);
  assert.equal(preDropped.maxDrawdownPercent, 4.95);
});

test('historical dates use execution prices so later calibrations never create artificial spikes, and newer priceDate adds latest valuation point', () => {
  const calibrated = buildAccountNavPoints(
    'a',
    [{ id: 'h1', accountId: 'a', lastPrice: 20, priceDate: '2026-11-19' }],
    [
      { id: '1', accountId: 'a', holdingId: 'h1', date: '2026-04-23', kind: 'buy', shares: 100, price: 1, createdAt: 1 },
      { id: '2', accountId: 'a', holdingId: 'h1', date: '2026-04-24', kind: 'buy', shares: 0, price: 0, quantitySnapshot: 100, costPriceSnapshot: 20, createdAt: 2 },
    ],
  );
  assert.deepEqual(calibrated, [
    { date: '2026-04-23', nav: 1 },
    { date: '2026-04-24', nav: 1 },
    { date: '2026-11-19', nav: 1 },
  ]);

  const buyAndHold = buildAccountNavPoints(
    'a',
    [{ id: 'h1', accountId: 'a', lastPrice: 9.5, priceDate: '2026-11-19' }],
    [{ id: '1', accountId: 'a', holdingId: 'h1', date: '2026-11-13', kind: 'buy', shares: 100, price: 10, createdAt: 1 }],
  );
  assert.deepEqual(buyAndHold, [
    { date: '2026-11-13', nav: 1 },
    { date: '2026-11-19', nav: 0.95 },
  ]);
  const summary = summarizeAccountNav(buyAndHold);
  assert.equal(summary.latestNav, 0.95);
  assert.equal(summary.cumulativeReturnPercent, -5);
  assert.equal(summary.maxDrawdownPercent, 5);
});

test('trimmed sub-ranges preserve true cumulative NAV while measuring drawdown within the selected range', () => {
  const points = [{ date: '2026-01-01', nav: 1 }, { date: '2026-02-01', nav: 1.5 }, { date: '2026-03-01', nav: 1.65 }];
  const summary = summarizeAccountNav(points, '2026-02-01');
  assert.deepEqual(summary.series.map(point => point.nav), [1.5, 1.65]);
  assert.equal(summary.cumulativeReturnPercent, 65);
  assert.equal(summary.maxDrawdownPercent, 0);
  const lossBeforeRange = summarizeAccountNav(
    [{ date: '2026-01-01', nav: 1 }, { date: '2026-02-01', nav: 0.5 }, { date: '2026-03-01', nav: 0.4 }],
    '2026-02-01',
  );
  assert.equal(lossBeforeRange.latestNav, 0.4);
  assert.equal(lossBeforeRange.cumulativeReturnPercent, -60);
  assert.equal(lossBeforeRange.maxDrawdownPercent, 20);
});

test('a recorded complete loss has zero NAV and 100 percent drawdown', () => {
  const holdings = [{ id: 'h1', accountId: 'a', lastPrice: 0 }];
  const txns = [{ id: 't1', accountId: 'a', holdingId: 'h1', date: '2026-01-01', kind: 'buy' as const, shares: 100, price: 10, createdAt: 1 }];
  const summary = summarizeAccountNav(buildAccountNavPoints('a', holdings, txns));
  assert.equal(summary.latestNav, 0);
  assert.equal(summary.cumulativeReturnPercent, -100);
  assert.equal(summary.maxDrawdownPercent, 100);
});

test('balance-mode holdings and unrelated accounts never contribute to the P&L NAV', () => {
  const holdings = [
    { id: 'h1', accountId: 'a', lastPrice: 12 },
    { id: 'h2', accountId: 'a', mode: 'balance', lastPrice: 12 },
    { id: 'h3', accountId: 'b', lastPrice: 12 },
  ];
  const txns = [
    { id: 't1', accountId: 'a', holdingId: 'h1', date: '2026-01-01', kind: 'buy' as const, shares: 100, price: 10, createdAt: 1 },
    { id: 't2', accountId: 'a', holdingId: 'h2', date: '2026-01-01', kind: 'buy' as const, shares: 999, price: 1, createdAt: 2 },
    { id: 't3', accountId: 'b', holdingId: 'h3', date: '2026-01-01', kind: 'buy' as const, shares: 999, price: 1, createdAt: 3 },
  ];
  const points = buildAccountNavPoints('a', holdings, txns);
  assert.equal(points.length, 1);
  assert.equal(points[0].nav, 1.2);
});
