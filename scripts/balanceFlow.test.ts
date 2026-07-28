import test from 'node:test';
import assert from 'node:assert/strict';
import {
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
