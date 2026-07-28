import test from 'node:test';
import assert from 'node:assert/strict';
import { computeHoldingPosition, computeHoldingPnl } from '../src/lib/holdingPosition.ts';
import {
  formatUsOptionLabel,
  getHoldingContractMultiplier,
  parseStrikeMilli,
  parseUsOptionSymbol,
  resolveUsOptionContract,
  toUsOptionSymbol,
} from '../src/lib/usOption.ts';

const txn = (kind: 'buy' | 'sell', shares: number, price: number, createdAt: number) => ({
  id: String(createdAt),
  accountId: 'acct',
  holdingId: 'nok-option',
  date: '2026-07-22',
  kind,
  shares,
  price,
  createdAt,
});

test('broker-style NOK option input resolves to the compact Cboe/OSI contract symbol', () => {
  const contract = parseUsOptionSymbol('NOK 280121 7.00C');

  assert.deepEqual(contract, {
    underlying: 'NOK',
    expiration: '2028-01-21',
    right: 'call',
    strikeMilli: 7000,
    multiplier: 100,
  });
  assert.equal(toUsOptionSymbol(contract!), 'NOK280121C00007000');
  assert.equal(formatUsOptionLabel(contract!), 'NOK 2028-01-21 7C');
});

test('structured option fields remain authoritative and validate strike precision', () => {
  assert.equal(parseStrikeMilli('7.125'), 7125);
  assert.equal(parseStrikeMilli('7.1234'), null);

  const contract = resolveUsOptionContract({
    instrumentType: 'us_option',
    symbol: 'WRONG',
    optionUnderlying: 'nok',
    optionExpiration: '2028-01-21',
    optionRight: 'call',
    optionStrikeMilli: 7000,
    contractMultiplier: 100,
  });
  assert.equal(toUsOptionSymbol(contract!), 'NOK280121C00007000');
});

test('option contract multiplier is applied to cost, market value, and realized P&L', () => {
  const multiplier = getHoldingContractMultiplier({ instrumentType: 'us_option', contractMultiplier: 100 });
  const position = computeHoldingPosition([
    txn('buy', 2, 4, 1),
    txn('sell', 1, 5, 2),
  ], multiplier);
  const marketValue = position.shares * multiplier * 5.01;
  const pnl = computeHoldingPnl(position, marketValue);

  assert.equal(position.shares, 1);
  assert.equal(position.avgCost, 4);
  assert.equal(position.costBasis, 400);
  assert.equal(position.realizedPnl, 100);
  assert.equal(marketValue, 501);
  assert.equal(pnl.totalPnl, 201);
});

test('legacy free-text options can fetch quotes without silently changing old valuation units', () => {
  assert.equal(toUsOptionSymbol(parseUsOptionSymbol('NOK280121C00007000')!), 'NOK280121C00007000');
  assert.equal(toUsOptionSymbol(resolveUsOptionContract({ name: 'NOK 280121 7.00C', symbol: 'NOK' })!), 'NOK280121C00007000');
  assert.equal(getHoldingContractMultiplier({ symbol: 'NOK280121C00007000' }), 1);
});
