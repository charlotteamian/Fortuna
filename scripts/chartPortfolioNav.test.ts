import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAccountNavPoints, getEligibleNavAccounts, normalizeNavAccountIds, summarizeAccountNav } from '../src/lib/chartPortfolioNav.ts';

const near = (actual: number, expected: number, message?: string) =>
  assert.ok(Math.abs(actual - expected) < 1e-9, message ?? `expected ${expected}, got ${actual}`);
const navs = (points: readonly { nav: number }[]) => points.map(point => Math.round(point.nav * 1e8) / 1e8);

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

test('a sell redeems units at the execution-price NAV and leaves the NAV unchanged', () => {
  // 100 @ 10 -> 1,000 units at 1.0000. Price 15 -> NAV 1.5; redeeming 750 leaves 500 units worth 750.
  const holdings = [{ id: 'h1', accountId: 'a', lastPrice: 15 }];
  const txns = [
    { id: 't1', accountId: 'a', holdingId: 'h1', date: '2026-01-01', kind: 'buy' as const, shares: 100, price: 10, createdAt: 1 },
    { id: 't2', accountId: 'a', holdingId: 'h1', date: '2026-02-01', kind: 'sell' as const, shares: 50, price: 15, createdAt: 2 },
  ];
  const points = buildAccountNavPoints('a', holdings, txns);
  assert.deepEqual(navs(points), [1, 1.5]);
  const summary = summarizeAccountNav(points);
  assert.equal(summary.latestNav, 1.5);
  assert.equal(summary.cumulativeReturnPercent, 50);
  assert.equal(summary.maxDrawdownPercent, 0);
});

test('adding capital after a 20% gain keeps NAV at 1.2000 and records no drawdown', () => {
  // 10,000 in at 10.00 -> 10,000 units. Price 12.00 -> NAV 1.2. A further 10,000 buys
  // 8,333.33 units at 1.2; total 22,000 / 18,333.33 units = 1.2.
  const holdings = [{ id: 'h1', accountId: 'a', lastPrice: 12 }];
  const txns = [
    { id: 't1', accountId: 'a', holdingId: 'h1', date: '2026-01-05', kind: 'buy' as const, shares: 1000, price: 10, createdAt: 1 },
    { id: 't2', accountId: 'a', holdingId: 'h1', date: '2026-02-05', kind: 'buy' as const, shares: 10000 / 12, price: 12, createdAt: 2 },
  ];
  const points = buildAccountNavPoints('a', holdings, txns);
  near(points[0].nav, 1);
  near(points[1].nav, 1.2);
  const summary = summarizeAccountNav(points);
  assert.equal(summary.latestNav, 1.2);
  assert.equal(summary.cumulativeReturnPercent, 20);
  assert.equal(summary.maxDrawdownPercent, 0);
});

test('ten same-day round trips on 10,000 principal, each earning 100, compound to about 1.10', () => {
  const holdings = [{ id: 'h1', accountId: 'a', lastPrice: 10.1 }];
  const txns = Array.from({ length: 10 }, (_, index) => {
    const date = `2026-03-${String(index + 1).padStart(2, '0')}`;
    return [
      { id: `b${index}`, accountId: 'a', holdingId: 'h1', date, kind: 'buy' as const, shares: 1000, price: 10, createdAt: index * 2 + 1 },
      { id: `s${index}`, accountId: 'a', holdingId: 'h1', date, kind: 'sell' as const, shares: 1000, price: 10.1, createdAt: index * 2 + 2 },
    ];
  }).flat();
  const points = buildAccountNavPoints('a', holdings, txns);
  assert.equal(points.length, 10);
  near(points[0].nav, 1.01);
  near(points[9].nav, 1.01 ** 10);
  const summary = summarizeAccountNav(points);
  assert.equal(summary.latestNav, 1.1046);
  assert.equal(summary.cumulativeReturnPercent, 10.46);
  assert.equal(summary.maxDrawdownPercent, 0);
});

test('time weighting follows the price path, so a round trip on top of a base position nets out when the price returns', () => {
  // Base 1,000 @ 10. Buy 1,000 @ 10, sell 1,000 @ 10.1: all 2,000 shares gained 1% -> NAV 1.01.
  // Next day the price is back at 10 on the base position -> NAV 1.00 again.
  const holdings = [{ id: 'h1', accountId: 'a', lastPrice: 10, priceDate: '2026-03-03' }];
  const txns = [
    { id: 'base', accountId: 'a', holdingId: 'h1', date: '2026-03-01', kind: 'buy' as const, shares: 1000, price: 10, createdAt: 1 },
    { id: 'b', accountId: 'a', holdingId: 'h1', date: '2026-03-02', kind: 'buy' as const, shares: 1000, price: 10, createdAt: 2 },
    { id: 's', accountId: 'a', holdingId: 'h1', date: '2026-03-02', kind: 'sell' as const, shares: 1000, price: 10.1, createdAt: 3 },
  ];
  assert.deepEqual(navs(buildAccountNavPoints('a', holdings, txns)), [1, 1.01, 1]);
});

test('fees are a loss on the trade that paid them, and a re-entry after liquidation continues from the closing NAV', () => {
  const holdings = [{ id: 'h1', accountId: 'a', lastPrice: 11, priceDate: '2026-04-01' }];
  const txns = [
    { id: 't1', accountId: 'a', holdingId: 'h1', date: '2026-01-01', kind: 'buy' as const, shares: 100, price: 10, fee: 5, createdAt: 1 },
    { id: 't2', accountId: 'a', holdingId: 'h1', date: '2026-02-01', kind: 'sell' as const, shares: 100, price: 10, fee: 5, createdAt: 2 },
    { id: 't3', accountId: 'a', holdingId: 'h1', date: '2026-03-01', kind: 'buy' as const, shares: 100, price: 10, fee: 0, createdAt: 3 },
  ];
  const points = buildAccountNavPoints('a', holdings, txns);
  assert.deepEqual(points.map(point => point.date), ['2026-01-01', '2026-02-01', '2026-03-01', '2026-04-01']);
  // 1,005 paid for 1,000 of stock.
  near(points[0].nav, 1000 / 1005);
  // 995 received back for the 1,005 units.
  near(points[1].nav, 995 / 1005);
  // Fully liquidated: the new buy subscribes at 995/1005 instead of restarting from 1.0000.
  near(points[2].nav, 995 / 1005);
  near(points[3].nav, (995 / 1005) * 1.1);
});

test('all holdings carry forward across transaction dates and same-day trades are processed in order', () => {
  const trade = (id: string, holdingId: string, date: string, price: number) => ({ id, holdingId, accountId: 'a', date, price, shares: 100, kind: 'buy' as const, createdAt: Number(id) });
  const holdings = [{ id: 'one', accountId: 'a', lastPrice: 20 }, { id: 'two', accountId: 'a', lastPrice: 10 }];
  const points = buildAccountNavPoints('a', holdings, [trade('1', 'one', '2026-01-01', 10), trade('2', 'two', '2026-02-01', 10)]);
  assert.deepEqual(navs(points), [1, 1.5]);
  assert.equal(summarizeAccountNav(points).cumulativeReturnPercent, 50);
  // 100 @ 10, then the price is 20 when the second 100 are bought: the first lot doubled.
  const sameDay = buildAccountNavPoints('a', holdings, [trade('1', 'one', '2026-01-01', 10), trade('2', 'one', '2026-01-01', 20)]);
  assert.deepEqual(navs(sameDay), [2]);
});

test('mixed stock and option weights use the option multiplier for buys, sells and quantity snapshots', () => {
  const holdings = [{ id: 'stock', accountId: 'a', lastPrice: 10 }, { id: 'option', accountId: 'a', lastPrice: 20, instrumentType: 'us_option' as const, contractMultiplier: 100 }];
  const txns = [
    { id: '1', accountId: 'a', holdingId: 'stock', date: '2026-01-01', kind: 'buy' as const, shares: 100, price: 10, createdAt: 1 },
    { id: '2', accountId: 'a', holdingId: 'option', date: '2026-01-01', kind: 'buy' as const, shares: 1, price: 10, createdAt: 2 },
    { id: '3', accountId: 'a', holdingId: 'option', date: '2026-01-02', kind: 'sell' as const, shares: 0.5, price: 20, createdAt: 3 },
    { id: '4', accountId: 'a', holdingId: 'option', date: '2026-01-03', kind: 'buy' as const, shares: 0, price: 0, quantitySnapshot: 1, costPriceSnapshot: 10, createdAt: 4 },
  ];
  // Day 1: 1,000 + 1 x 100 x 10 = 2,000 units. Day 2: option 20 -> 3,000 / 2,000 = 1.5, then 1,000 redeemed.
  // Day 3: a calibration without a market price re-anchors the option at cost (1 x 100 x 10 = 1,000,
  // the same value as 0.5 x 100 x 20), then the latest quote 20 values it at 2,000: 3,000 / 2,000 x 1.5.
  assert.deepEqual(navs(buildAccountNavPoints('a', holdings, txns)), [1, 1.5, 2.25]);
});

test('later purchases at a flat price do not dilute an earlier loss into a gain', () => {
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
  // Every buy subscribes at 1.0000 (66,795.30 units); the final quotes value the book at 66,325.60.
  const points = buildAccountNavPoints('a', holdings, txns);
  const full = summarizeAccountNav(points);
  assert.equal(full.latestNav, 0.993);
  assert.equal(full.cumulativeReturnPercent, -0.7);
  assert.equal(full.maxDrawdownPercent, 0.7);
  const threeMonth = summarizeAccountNav(points, '2026-08-19');
  assert.equal(threeMonth.latestNav, 0.993);
  assert.equal(threeMonth.cumulativeReturnPercent, -0.7);
  const preDropped = summarizeAccountNav([{ date: '2026-11-13', nav: 0.9505 }, { date: '2026-11-19', nav: 0.993 }]);
  assert.equal(preDropped.latestNav, 0.993);
  assert.equal(preDropped.cumulativeReturnPercent, -0.7);
  assert.equal(preDropped.maxDrawdownPercent, 4.95);
});

test('a calibration without a market price is return-neutral, and a newer priceDate adds the latest valuation point', () => {
  const calibrated = buildAccountNavPoints(
    'a',
    [{ id: 'h1', accountId: 'a', lastPrice: 20, priceDate: '2026-11-19' }],
    [
      { id: '1', accountId: 'a', holdingId: 'h1', date: '2026-04-23', kind: 'buy', shares: 100, price: 1, createdAt: 1 },
      { id: '2', accountId: 'a', holdingId: 'h1', date: '2026-04-24', kind: 'buy', shares: 0, price: 0, quantitySnapshot: 100, costPriceSnapshot: 20, createdAt: 2 },
    ],
  );
  assert.deepEqual(calibrated.map(point => point.date), ['2026-04-23', '2026-04-24', '2026-11-19']);
  assert.deepEqual(navs(calibrated), [1, 1, 1]);

  const buyAndHold = buildAccountNavPoints(
    'a',
    [{ id: 'h1', accountId: 'a', lastPrice: 9.5, priceDate: '2026-11-19' }],
    [{ id: '1', accountId: 'a', holdingId: 'h1', date: '2026-11-13', kind: 'buy', shares: 100, price: 10, createdAt: 1 }],
  );
  assert.deepEqual(buyAndHold.map(point => point.date), ['2026-11-13', '2026-11-19']);
  assert.deepEqual(navs(buyAndHold), [1, 0.95]);
  const summary = summarizeAccountNav(buyAndHold);
  assert.equal(summary.latestNav, 0.95);
  assert.equal(summary.cumulativeReturnPercent, -5);
  assert.equal(summary.maxDrawdownPercent, 5);
});

test('a calibration that recorded the market price values history at that price and treats the share change as a flow', () => {
  // 100 @ 10. At calibration the price is 12 (NAV 1.2) and the position becomes 200 shares:
  // the extra 100 x 12 subscribes at 1.2. A cost price of 11 never enters the valuation.
  const holdings = [{ id: 'h1', accountId: 'a', lastPrice: 15, priceDate: '2026-03-01' }];
  const txns = [
    { id: '1', accountId: 'a', holdingId: 'h1', date: '2026-01-01', kind: 'buy' as const, shares: 100, price: 10, createdAt: 1 },
    { id: '2', accountId: 'a', holdingId: 'h1', date: '2026-02-01', kind: 'buy' as const, shares: 0, price: 0, quantitySnapshot: 200, costPriceSnapshot: 11, marketPriceSnapshot: 12, createdAt: 2 },
  ];
  assert.deepEqual(navs(buildAccountNavPoints('a', holdings, txns)), [1, 1.2, 1.5]);

  // Reducing shares through a calibration is a redemption; clearing the position keeps the NAV.
  const reduced = buildAccountNavPoints('a', [{ id: 'h1', accountId: 'a', lastPrice: 12, priceDate: '2026-02-01' }], [
    txns[0],
    { id: '2', accountId: 'a', holdingId: 'h1', date: '2026-02-01', kind: 'buy' as const, shares: 0, price: 0, quantitySnapshot: 0, marketPriceSnapshot: 12, createdAt: 2 },
  ]);
  assert.deepEqual(navs(reduced), [1, 1.2]);
});

test('a sell larger than the open position only redeems the shares that exist', () => {
  const holdings = [{ id: 'h1', accountId: 'a', lastPrice: 12 }];
  const txns = [
    { id: '1', accountId: 'a', holdingId: 'h1', date: '2026-01-01', kind: 'buy' as const, shares: 100, price: 10, createdAt: 1 },
    { id: '2', accountId: 'a', holdingId: 'h1', date: '2026-01-02', kind: 'sell' as const, shares: 150, price: 12, createdAt: 2 },
  ];
  assert.deepEqual(navs(buildAccountNavPoints('a', holdings, txns)), [1, 1.2]);
});

test('a selected range is rebased on the last NAV before it and measures drawdown inside the range only', () => {
  const points = [{ date: '2026-01-01', nav: 1 }, { date: '2026-02-01', nav: 1.5 }, { date: '2026-03-01', nav: 1.65 }];
  // The range starts after the 1.5 point, so 1.5 becomes 1.0000 and is carried in as the first point.
  const summary = summarizeAccountNav(points, '2026-02-15');
  assert.deepEqual(summary.series.map(point => [point.date, point.nav]), [['2026-02-15', 1], ['2026-03-01', 1.1]]);
  assert.equal(summary.latestNav, 1.1);
  assert.equal(summary.cumulativeReturnPercent, 10);
  assert.equal(summary.maxDrawdownPercent, 0);

  // A point on the range start itself belongs to the range; the base is the point before it.
  const onStart = summarizeAccountNav(points, '2026-02-01');
  assert.deepEqual(onStart.series.map(point => point.nav), [1.5, 1.65]);
  assert.equal(onStart.cumulativeReturnPercent, 65);

  // A 50% loss before the range is not part of the range drawdown.
  const lossBeforeRange = summarizeAccountNav(
    [{ date: '2026-01-01', nav: 1 }, { date: '2026-02-01', nav: 0.5 }, { date: '2026-03-01', nav: 0.4 }],
    '2026-02-15',
  );
  assert.equal(lossBeforeRange.latestNav, 0.8);
  assert.equal(lossBeforeRange.cumulativeReturnPercent, -20);
  assert.equal(lossBeforeRange.maxDrawdownPercent, 20);

  // A range that starts before the first point is not rebased.
  const wide = summarizeAccountNav(points, '2025-01-01');
  assert.deepEqual(wide.series.map(point => point.nav), [1, 1.5, 1.65]);
});

test('a recorded complete loss has zero NAV and 100 percent drawdown', () => {
  const holdings = [{ id: 'h1', accountId: 'a', lastPrice: 0 }];
  const txns = [{ id: 't1', accountId: 'a', holdingId: 'h1', date: '2026-01-01', kind: 'buy' as const, shares: 100, price: 10, createdAt: 1 }];
  const summary = summarizeAccountNav(buildAccountNavPoints('a', holdings, txns));
  assert.equal(summary.latestNav, 0);
  assert.equal(summary.cumulativeReturnPercent, -100);
  assert.equal(summary.maxDrawdownPercent, 100);
});

test('balance-mode holdings and unrelated accounts never contribute to the NAV', () => {
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
  near(points[0].nav, 1.2);
});
