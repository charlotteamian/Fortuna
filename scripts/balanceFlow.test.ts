import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computePortfolioUnitNav,
  deriveBalanceTimeline,
  getBalanceFlowActionKey,
  getBalanceFlowConfig,
  usesDerivedBalanceRecords,
} from '../src/lib/balanceFlow.ts';

test('principal and debt categories use derived transaction balances', () => {
  const receivable = getBalanceFlowConfig('债权', 'asset');
  assert.equal(receivable.transactionOnly, true);
  assert.equal(getBalanceFlowActionKey(receivable, 'sell'), 'debt_repayment_received');

  assert.equal(usesDerivedBalanceRecords('信用卡', 'liability'), true);
  assert.equal(usesDerivedBalanceRecords('房贷', 'liability'), true);
  assert.equal(usesDerivedBalanceRecords('银行存款', 'asset'), false);
  assert.equal(usesDerivedBalanceRecords('理财产品', 'asset'), false);
});

test('balance deltas derive the remaining amount while legacy snapshots stay as anchors', () => {
  const timeline = deriveBalanceTimeline([
    { id: 'legacy', date: '2026-01-01', createdAt: 1, amount: 1000 },
    { id: 'repay-1', date: '2026-02-01', createdAt: 2, amount: 0, kind: 'sell', deltaAmount: 200 },
    { id: 'lend-more', date: '2026-03-01', createdAt: 3, amount: 0, kind: 'buy', deltaAmount: 50 },
    { id: 'repay-2', date: '2026-04-01', createdAt: 4, amount: 0, kind: 'sell', deltaAmount: 100 },
  ]);

  assert.deepEqual(timeline.map(entry => entry.amount), [1000, 800, 850, 750]);
  assert.equal(timeline.some(entry => entry.underflow), false);
});

test('a direct balance adjustment resets the anchor and later principal flows continue from it', () => {
  const timeline = deriveBalanceTimeline([
    { id: 'initial', date: '2026-01-01', createdAt: 1, amount: 0, kind: 'buy', deltaAmount: 1000 },
    { id: 'repay-1', date: '2026-02-01', createdAt: 2, amount: 0, kind: 'sell', deltaAmount: 200 },
    { id: 'adjust', date: '2026-03-01', createdAt: 3, amount: 650, balanceAdjustment: true },
    { id: 'repay-2', date: '2026-04-01', createdAt: 4, amount: 0, kind: 'sell', deltaAmount: 50 },
  ]);

  assert.deepEqual(timeline.map(entry => entry.amount), [1000, 800, 650, 600]);
});

test('balance timeline flags repayments that exceed the available principal', () => {
  const timeline = deriveBalanceTimeline([
    { id: 'initial', date: '2026-01-01', createdAt: 1, amount: 0, kind: 'buy', deltaAmount: 100 },
    { id: 'too-much', date: '2026-02-01', createdAt: 2, amount: 0, kind: 'sell', deltaAmount: 120 },
  ]);

  assert.equal(timeline[1].underflow, true);
  assert.equal(timeline[1].amount, 0);
});

test('computePortfolioUnitNav eliminates principal deposit/withdrawal distortion and tracks max drawdown', () => {
  const summary = computePortfolioUnitNav([
    { date: '2026-01-01', totalValue: 100_000, netFlow: 0 },
    // +10% investment gain -> 110,000, plus 55,000 external deposit -> total 165,000 (NAV should be 1.1000, not 1.65)
    { date: '2026-02-01', totalValue: 165_000, netFlow: 55_000 },
    // -10% investment drawdown -> 148,500 (NAV should be 0.9900, drawdown 10%)
    { date: '2026-03-01', totalValue: 148_500, netFlow: 0 },
  ]);

  assert.deepEqual(summary.series.map(p => p.nav), [1.0, 1.1, 0.99]);
  assert.equal(summary.latestNav, 0.99);
  assert.equal(summary.cumulativeReturnPercent, -1);
  assert.equal(summary.maxDrawdownPercent, 10);
});
