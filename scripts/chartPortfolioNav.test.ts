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

test('account snapshots remain isolated, use latest daily value and explicit flows without inventing deposits', () => {
  const points = buildAccountNavPoints('strategy', [
    { id: 'a1', accountId: 'strategy', date: '2026-01-01', amount: 1000, createdAt: 1 },
    { id: 'a2', accountId: 'strategy', date: '2026-02-01', amount: 1650, createdAt: 2, deltaAmount: 550, kind: 'buy' },
    { id: 'a3', accountId: 'strategy', date: '2026-02-01', amount: 1650, createdAt: 3 },
    { id: 'a4', accountId: 'strategy', date: '2026-03-01', amount: 1485, createdAt: 4 },
    { id: 'other', accountId: 'bank', date: '2026-04-01', amount: 999999, createdAt: 5 },
  ]);
  assert.deepEqual(points, [
    { date: '2026-01-01', totalValue: 100000, netFlow: 0 },
    { date: '2026-02-01', totalValue: 165000, netFlow: 55000 },
    { date: '2026-03-01', totalValue: 148500, netFlow: 0 },
  ]);
  const summary = summarizeAccountNav(points);
  assert.deepEqual(summary.series.map(point => point.nav), [1, 1.1, 0.99]);
  assert.equal(summary.maxDrawdownPercent, 10);
  assert.deepEqual(summarizeAccountNav(points, '2026-02-01').series.map(point => point.nav), [1, 0.9]);
});

test('direct balance adjustments are valuations, not synthetic principal flows', () => {
  const points = buildAccountNavPoints('a', [
    { id: 'start', accountId: 'a', date: '2026-01-01', amount: 100, createdAt: 1 },
    { id: 'adjust', accountId: 'a', date: '2026-01-02', amount: 120, createdAt: 2, deltaAmount: 20, kind: 'buy', balanceAdjustment: true },
    { id: 'bad', accountId: 'a', date: '2026-01-03', amount: Number.NaN, createdAt: 3 },
  ]);
  assert.equal(points.length, 2);
  assert.equal(points[1].netFlow, 0);
  assert.equal(summarizeAccountNav(points).latestNav, 1.2);
});

test('a recorded complete loss has zero NAV and 100 percent drawdown', () => {
  const summary = summarizeAccountNav([
    { date: '2026-01-01', totalValue: 10000 },
    { date: '2026-02-01', totalValue: 0 },
  ]);
  assert.equal(summary.latestNav, 0);
  assert.equal(summary.cumulativeReturnPercent, -100);
  assert.equal(summary.maxDrawdownPercent, 100);
});
