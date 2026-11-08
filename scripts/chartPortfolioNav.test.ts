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
  assert.deepEqual(points.map(point => point.nav), [1.5, 1.5]);
  const summary = summarizeAccountNav(points);
  assert.equal(summary.latestNav, 1);
  assert.equal(summary.cumulativeReturnPercent, 0);
  assert.equal(summary.maxDrawdownPercent, 0);
});

test('all holdings carry forward across transaction dates and same-day trades contribute only their final state', () => {
  const trade = (id: string, holdingId: string, date: string, price: number) => ({ id, holdingId, accountId: 'a', date, price, shares: 100, kind: 'buy' as const, createdAt: Number(id) });
  const holdings = [{ id: 'one', accountId: 'a', lastPrice: 20 }, { id: 'two', accountId: 'a', lastPrice: 10 }];
  assert.deepEqual(buildAccountNavPoints('a', holdings, [trade('1', 'one', '2026-01-01', 10), trade('2', 'two', '2026-02-01', 10)]).map(point => point.nav), [2, 1.5]);
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
  assert.equal(points[0].nav, 1.5); assert.equal(points[1].nav, 1.5); assert.equal(points[2].nav, 1.6);
});

test('range returns and drawdowns start at the selected positive baseline, excluding losses before it', () => {
  const points = [{ date: '2026-01-01', nav: 1 }, { date: '2026-02-01', nav: 1.5 }, { date: '2026-03-01', nav: 1.65 }];
  const summary = summarizeAccountNav(points, '2026-02-01');
  assert.deepEqual(summary.series.map(point => point.nav), [1, 1.1]); assert.equal(summary.cumulativeReturnPercent, 10);
  const lossBeforeRange = summarizeAccountNav([{ date: '2026-02-01', nav: 0.5 }, { date: '2026-03-01', nav: 0.4 }]);
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
