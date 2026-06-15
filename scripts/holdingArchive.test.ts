import test from 'node:test';
import assert from 'node:assert/strict';
import { splitHoldingsByArchive } from '../src/lib/holdingArchive';

type HoldingLike = {
  id: string;
  sortOrder: number;
  position: {
    shares: number;
  };
};

test('splitHoldingsByArchive treats zero-share holdings as archived', () => {
  const holdings: HoldingLike[] = [
    { id: 'active-aapl', sortOrder: 0, position: { shares: 12 } },
    { id: 'sold-out-tsla', sortOrder: 1, position: { shares: 0 } },
    { id: 'dust-msft', sortOrder: 2, position: { shares: 0.0000000001 } },
  ];

  const result = splitHoldingsByArchive(holdings);

  assert.deepEqual(result.active.map(holding => holding.id), ['active-aapl']);
  assert.deepEqual(result.archived.map(holding => holding.id), ['sold-out-tsla', 'dust-msft']);
});

test('splitHoldingsByArchive preserves display order within each group', () => {
  const holdings: HoldingLike[] = [
    { id: 'active-first', sortOrder: 2, position: { shares: 5 } },
    { id: 'archived-first', sortOrder: 0, position: { shares: 0 } },
    { id: 'active-second', sortOrder: 1, position: { shares: 7 } },
    { id: 'archived-second', sortOrder: 3, position: { shares: 0 } },
  ];

  const result = splitHoldingsByArchive(holdings);

  assert.deepEqual(result.active.map(holding => holding.id), ['active-first', 'active-second']);
  assert.deepEqual(result.archived.map(holding => holding.id), ['archived-first', 'archived-second']);
});
