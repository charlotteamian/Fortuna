import test from 'node:test';
import assert from 'node:assert/strict';
import type { HoldingTxn } from '../src/db.ts';
import { summarizeHoldingTrades } from '../src/lib/holdingTradeReview.ts';

const txn = (id: string, date: string, kind: 'buy' | 'sell', shares: number, price: number): HoldingTxn => ({
  id, date, kind, shares, price, accountId: 'account', holdingId: 'holding', createdAt: 1,
});

test('review summarizes multiple round trips independently of input order', () => {
  const fills = [
    txn('sell2', '2026-10-13', 'sell', 200, 8),
    txn('buy1', '2026-09-02', 'buy', 100, 10),
    txn('buy2', '2026-10-08', 'buy', 200, 9),
    txn('sell1', '2026-09-15', 'sell', 100, 12),
  ];
  const summary = summarizeHoldingTrades(fills);
  assert.equal(summary.buys.count, 2);
  assert.equal(summary.buys.shares, 300);
  assert.equal(summary.buys.amountMinor, 280000);
  assert.equal(summary.buys.averagePrice, 2800 / 300);
  assert.equal(summary.sells.count, 2);
  assert.equal(summary.sells.shares, 300);
  assert.equal(summary.sells.amountMinor, 280000);
  assert.equal(summary.sells.averagePrice, 2800 / 300);
  assert.equal(summary.firstDate, '2026-09-02');
  assert.equal(summary.lastDate, '2026-10-13');
  assert.deepEqual(summary, summarizeHoldingTrades([...fills].reverse()));
  assert.equal(fills[0].id, 'sell2');
});

test('quantity and balance calibration anchors never inflate trade amounts or date ranges', () => {
  const summary = summarizeHoldingTrades([
    { ...txn('anchor', '2026-08-01', 'buy', 999, 100), quantitySnapshot: 100, costPriceSnapshot: 8 },
    txn('sell', '2026-10-13', 'sell', 100, 9),
    { ...txn('balance', '2026-11-01', 'buy', 2000, 1), balanceSnapshot: 2000 },
  ]);
  assert.equal(summary.adjustmentCount, 2);
  assert.deepEqual(summary.buys, { count: 0, shares: 0, amountMinor: 0, averagePrice: null });
  assert.equal(summary.sells.amountMinor, 90000);
  assert.equal(summary.firstDate, '2026-10-13');
  assert.equal(summary.lastDate, '2026-10-13');
});

test('fractional quantities and prices retain precision while cash totals sum fill-level cents', () => {
  const summary = summarizeHoldingTrades([
    txn('a', '2026-10-01', 'buy', 0.125, 12.3456),
    txn('b', '2026-10-01', 'buy', 0.125, 12.3456),
  ]);
  assert.equal(summary.buys.shares, 0.25);
  assert.equal(summary.buys.amountMinor, 308);
  assert.equal(summary.buys.averagePrice, 12.3456);
});

test('option contract multiplier affects turnover but not quoted average price', () => {
  const summary = summarizeHoldingTrades([
    txn('buy', '2026-10-01', 'buy', 2, 1.25),
    txn('sell', '2026-10-02', 'sell', 2, 1.5),
  ], 100);
  assert.equal(summary.buys.amountMinor, 25000);
  assert.equal(summary.sells.amountMinor, 30000);
  assert.equal(summary.buys.averagePrice, 1.25);
  assert.equal(summary.sells.averagePrice, 1.5);
});

test('empty or calibration-only history has no invented fills, prices or dates', () => {
  const empty = summarizeHoldingTrades([]);
  assert.equal(empty.firstDate, null);
  assert.equal(empty.lastDate, null);
  assert.equal(empty.buys.averagePrice, null);
  assert.equal(empty.sells.averagePrice, null);
  const calibrated = summarizeHoldingTrades([
    { ...txn('zero', '2026-10-01', 'buy', 0, 0), quantitySnapshot: 0 },
  ]);
  assert.equal(calibrated.adjustmentCount, 1);
  assert.equal(calibrated.buys.count + calibrated.sells.count, 0);
  assert.equal(calibrated.firstDate, null);
});
