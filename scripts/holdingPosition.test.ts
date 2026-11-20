import test from 'node:test';
import assert from 'node:assert/strict';
import type { HoldingTxn } from '../src/db.ts';
import {
  analyzeHoldingPosition,
  calculateHoldingTxnFee,
  computeBalanceHoldingPosition,
  computeHoldingPnl,
  computeHoldingPosition,
  DEFAULT_COMMISSION_RATE_PERCENT,
  deriveBalanceHoldingTimeline,
  resolveHoldingCommissionRatePercent,
} from '../src/lib/holdingPosition.ts';

const txn = (
  id: string,
  date: string,
  kind: 'buy' | 'sell',
  shares: number,
  price: number,
  createdAt: number,
): HoldingTxn => ({ id, accountId: 'account', holdingId: 'holding', date, kind, shares, price, createdAt });

test('profitable partial sells lower diluted cost and total P&L includes realized gains', () => {
  const position = computeHoldingPosition([
    txn('buy', '2026-01-01', 'buy', 100, 10, 1),
    txn('sell', '2026-02-01', 'sell', 40, 15, 2),
  ]);
  const pnl = computeHoldingPnl(position, 60 * 12);

  assert.equal(position.shares, 60);
  assert.equal(position.avgCost, 10);
  assert.equal(position.costBasis, 600);
  assert.equal(position.realizedPnl, 200);
  assert.equal(position.realizedCostBasis, 400);
  assert.equal(position.netInvested, 400);
  assert.equal(position.dilutedCost, 400 / 60);
  assert.equal(pnl.unrealizedPnl, 120);
  assert.equal(pnl.totalPnl, 320);
  assert.equal(pnl.totalPnlRate, 80);
});

test('loss-making partial sells raise diluted cost', () => {
  const position = computeHoldingPosition([
    txn('buy', '2026-01-01', 'buy', 100, 10, 1),
    txn('sell', '2026-02-01', 'sell', 40, 5, 2),
  ]);

  assert.equal(position.realizedPnl, -200);
  assert.equal(position.netInvested, 800);
  assert.equal(position.dilutedCost, 800 / 60);
});

test('sold-out positions calculate return against the settled cost basis', () => {
  const position = computeHoldingPosition([
    txn('buy', '2026-01-01', 'buy', 100, 10, 1),
    txn('sell', '2026-02-01', 'sell', 100, 12, 2),
  ]);
  const pnl = computeHoldingPnl(position, 0);

  assert.equal(position.shares, 0);
  assert.equal(position.dilutedCost, 0);
  assert.equal(position.realizedPnl, 200);
  assert.equal(position.realizedCostBasis, 1000);
  assert.equal(pnl.totalPnl, 200);
  assert.equal(pnl.totalPnlRate, 20);
});

test('a loss-making sold-out position does not manufacture a -100% return', () => {
  const position = computeHoldingPosition([
    txn('buy', '2026-01-01', 'buy', 100, 10, 1),
    txn('sell', '2026-02-01', 'sell', 100, 5, 2),
  ]);
  const pnl = computeHoldingPnl(position, 0);

  assert.equal(position.realizedPnl, -500);
  assert.equal(position.realizedCostBasis, 1000);
  assert.equal(pnl.totalPnlRate, -50);
});

test('balance snapshots reset the anchor without counting as principal flow', () => {
  const transactions: HoldingTxn[] = [
    txn('initial', '2026-01-01', 'buy', 1000, 1, 1),
    { ...txn('adjust', '2026-02-01', 'buy', 0, 1, 2), balanceSnapshot: 820 },
    txn('repay', '2026-03-01', 'sell', 120, 1, 3),
    txn('borrow-more', '2026-04-01', 'buy', 50, 1, 4),
  ];

  const position = computeBalanceHoldingPosition(transactions);
  assert.equal(position.shares, 750);
  assert.equal(position.costBasis, 750);
});

test('balance timeline flags principal reductions below a snapshot anchor', () => {
  const timeline = deriveBalanceHoldingTimeline([
    { ...txn('adjust', '2026-01-01', 'buy', 0, 1, 1), balanceSnapshot: 100 },
    txn('too-much', '2026-02-01', 'sell', 120, 1, 2),
  ]);

  assert.equal(timeline[1].underflow, true);
  assert.equal(timeline[1].balance, 0);
});

test('same-day T+0 matching and LIFO with 0.01% commission match the 11-fill ETF ledger', () => {
  const txns: HoldingTxn[] = [
    txn('t1', '2026-11-16', 'buy', 4000, 2.328, 1),
    txn('t2', '2026-11-17', 'buy', 18800, 2.30, 2),
    txn('t3', '2026-11-18', 'buy', 3000, 2.287, 3),
    txn('t4', '2026-11-19', 'buy', 100, 2.307, 4),
    txn('t5', '2026-11-19', 'buy', 1000, 2.294, 5),
    txn('t6', '2026-11-19', 'sell', 200, 2.317, 6),
    txn('t7', '2026-11-19', 'buy', 100, 2.299, 7),
    txn('t8', '2026-11-20', 'buy', 500, 2.26, 8),
    txn('t9', '2026-11-20', 'buy', 100, 2.253, 9),
    txn('t10', '2026-11-20', 'buy', 200, 2.239, 10),
    txn('t11', '2026-11-20', 'sell', 100, 2.249, 11),
  ];

  const analysis = analyzeHoldingPosition(txns, 1, { commissionRatePercent: DEFAULT_COMMISSION_RATE_PERCENT });
  const { position, dayTrades, txnDayTrades, txnFees } = analysis;
  const pnl = computeHoldingPnl(position, position.shares * 2.261);

  assert.equal(DEFAULT_COMMISSION_RATE_PERCENT, 0.01);
  assert.equal(position.shares, 27500);
  assert.equal(position.totalFees, 6.45);
  assert.equal(txnFees.t1, 0.93);
  assert.equal(txnFees.t2, 4.32);
  assert.equal(txnFees.t6, 0.05);
  assert.equal(txnFees.t11, 0.02);

  assert.equal(dayTrades.length, 2);
  assert.equal(position.dayTradeCount, 2);
  assert.equal(dayTrades[0].buyTxnId, 't5');
  assert.equal(dayTrades[0].sellTxnId, 't6');
  assert.equal(dayTrades[0].direction, 'buy_then_sell');
  assert.equal(dayTrades[0].shares, 200);
  assert.ok(Math.abs(dayTrades[0].pnl - 4.504) < 1e-6);

  assert.equal(dayTrades[1].buyTxnId, 't10');
  assert.equal(dayTrades[1].sellTxnId, 't11');
  assert.equal(dayTrades[1].direction, 'buy_then_sell');
  assert.equal(dayTrades[1].shares, 100);
  assert.ok(Math.abs(dayTrades[1].pnl - 0.96) < 1e-6);

  // Only matched legs carry the T badge summary.
  assert.deepEqual(Object.keys(txnDayTrades).sort(), ['t10', 't11', 't5', 't6']);
  assert.equal(txnDayTrades.t5.matchedShares, 200);
  assert.equal(txnDayTrades.t5.totalShares, 1000);
  assert.equal(txnDayTrades.t10.matchedShares, 100);
  assert.equal(txnDayTrades.t10.totalShares, 200);

  assert.ok(Math.abs(position.realizedPnl - 5.464) < 1e-6);
  assert.ok(Math.abs(position.dayTradePnl - 5.464) < 1e-6);
  assert.ok(Math.abs(pnl.totalPnl - (-1111.35)) < 1e-6);
  assert.ok(Math.abs(position.dilutedCost - 63288.85 / 27500) < 1e-6);
});

test('same-day reverse T (sell then buy back) pairs intraday before settling leftover sells via cross-day LIFO', () => {
  const analysis = analyzeHoldingPosition([
    txn('old1', '2026-11-01', 'buy', 1000, 2.0, 1),
    txn('old2', '2026-11-02', 'buy', 500, 2.2, 2),
    txn('sell-am', '2026-11-05', 'sell', 300, 2.5, 3),
    txn('buy-pm', '2026-11-05', 'buy', 200, 2.3, 4),
  ]);

  assert.equal(analysis.dayTrades.length, 1);
  assert.equal(analysis.dayTrades[0].direction, 'sell_then_buy');
  assert.equal(analysis.dayTrades[0].buyTxnId, 'buy-pm');
  assert.equal(analysis.dayTrades[0].sellTxnId, 'sell-am');
  assert.equal(analysis.dayTrades[0].shares, 200);
  assert.ok(Math.abs(analysis.dayTrades[0].pnl - 40) < 1e-9);
  assert.deepEqual(Object.keys(analysis.txnDayTrades).sort(), ['buy-pm', 'sell-am']);

  // Remaining 100 shares sold on 11-05 settle LIFO against old2 (2.2), not old1 (2.0): +30.
  assert.equal(analysis.position.shares, 1400);
  assert.ok(Math.abs(analysis.position.realizedPnl - 70) < 1e-9);
  assert.ok(Math.abs(analysis.position.dayTradePnl - 40) < 1e-9);
  assert.ok(Math.abs(analysis.position.costBasis - (1000 * 2.0 + 400 * 2.2)) < 1e-9);
  assert.equal(analysis.realizedEvents.length, 1);
  assert.ok(Math.abs(analysis.realizedEvents[0].amount - 70) < 1e-9);
});

test('per-holding commission rate override, zero rate, and explicit per-trade fee work as expected', () => {
  assert.equal(resolveHoldingCommissionRatePercent({ mode: 'unit' }, 0.01, '股票/ETF'), 0.01);
  assert.equal(resolveHoldingCommissionRatePercent({ mode: 'unit', commissionRatePercent: 0 }, 0.01, '股票/ETF'), 0);
  assert.equal(resolveHoldingCommissionRatePercent({ mode: 'unit', commissionRatePercent: 0.03 }, 0.01, '股票/ETF'), 0.03);
  assert.equal(resolveHoldingCommissionRatePercent({ mode: 'unit' }, 0.01, '场外基金'), 0);
  assert.equal(resolveHoldingCommissionRatePercent({ mode: 'unit', commissionRatePercent: 0.15 }, 0.01, '场外基金'), 0.15);
  assert.equal(resolveHoldingCommissionRatePercent({ mode: 'balance', commissionRatePercent: 0.05 }, 0.01, '银行存款'), 0);

  assert.equal(calculateHoldingTxnFee({ shares: 1000, price: 10 }, 1, 0.01), 1);
  assert.equal(calculateHoldingTxnFee({ shares: 1000, price: 10, fee: 5 }, 1, 0.01), 5);
  assert.equal(calculateHoldingTxnFee({ shares: 1000, price: 10, fee: 0 }, 1, 0.01), 0);
  assert.equal(calculateHoldingTxnFee({ shares: 0, price: 0, quantitySnapshot: 100 }, 1, 0.01), 0);

  const customFeePos = computeHoldingPosition([
    { ...txn('b1', '2026-11-01', 'buy', 100, 10, 1), fee: 5 },
    txn('s1', '2026-11-02', 'sell', 100, 11, 2),
  ], 1, { commissionRatePercent: 0.05 }); // sell fee = round(1100 * 0.0005, 2) = 0.55
  assert.equal(customFeePos.totalFees, 5.55);
  assert.ok(Math.abs(customFeePos.realizedPnl - (100 - 5.55)) < 1e-9);
});
