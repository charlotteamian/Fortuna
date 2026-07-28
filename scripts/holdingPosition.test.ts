import test from 'node:test';
import assert from 'node:assert/strict';
import type { HoldingTxn } from '../src/db.ts';
import {
  computeBalanceHoldingPosition,
  computeHoldingPnl,
  computeHoldingPosition,
  deriveBalanceHoldingTimeline,
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
