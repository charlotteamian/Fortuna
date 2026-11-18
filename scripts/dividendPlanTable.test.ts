import assert from 'node:assert/strict';
import test from 'node:test';
import { buildClassicStockPlan, type ClassicVerifiedBasis } from '../src/lib/dividendClassicStrategy.ts';
import { buildDividendStockTableModel } from '../src/lib/dividendPlanTable.ts';

function basis(dpsMicros = 2_000_000): ClassicVerifiedBasis {
  return {
    dpsMicros,
    implementedDpsMicros: dpsMicros,
    verified: true,
    frequency: 'annual',
    reportPeriods: ['2025-12-31'],
    latestExDate: '2026-06-15',
  };
}

test('buildDividendStockTableModel shows price-only thresholds, cumulative positions, and cumulative buy amounts', () => {
  // Net DPS = 2.00 * 0.9 = 1.80 -> Buy1(5.5%)=32.72, Sell1(4.8%)=37.50, Sell2(4.5%)=40.00, Sell3(4.2%)=42.86, Sell4(4.0%)=45.00
  // At quote ¥43.45: Sell 1..3 are touched, Sell 4 is untouched, and shares = 0 (no holding).
  const plan = buildClassicStockPlan({
    code: '600036',
    name: '招商银行',
    group: 'core',
    weightBps: 2604,
    lotSize: 100,
    shareMode: 'manual',
    manualShares: 0,
    quote: { priceMinor: 4345, date: '2026-11-17 15:00' },
  }, {
    totalBudgetMinor: 9_900_000, // 9.90万
    shares: 0,
    taxBps: 1000,
    asOf: '2026-11-17',
    basis: basis(),
  });

  const model = buildDividendStockTableModel(plan, 'waiting');
  assert.equal(model.hasHolding, false);
  assert.deepEqual(model.buyRows.map(r => r.cumulativePercent), [25, 50, 75, 100]);
  assert.deepEqual(model.buyRows.map(r => r.priceText), ['≤¥32.72', '≤¥31.30', '≤¥30.00', '≤¥27.69']);
  // Cumulative amounts must increase monotonically (25%, 50%, 75%, 100% of stock budget)
  const expectedBudget = (99000 * 2604) / 10000;
  assert.deepEqual(
    model.buyRows.map(r => Number(r.amountMajor?.toFixed(2))),
    [
      Number((expectedBudget * 0.25).toFixed(2)),
      Number((expectedBudget * 0.5).toFixed(2)),
      Number((expectedBudget * 0.75).toFixed(2)),
      Number(expectedBudget.toFixed(2)),
    ],
  );
  // Sell rows have no holding -> all amounts undefined and none marked active
  assert.deepEqual(model.sellRows.map(r => r.cumulativePercent), [25, 50, 75, 100]);
  assert.deepEqual(model.sellRows.map(r => r.priceText), ['≥¥37.50', '≥¥40.00', '≥¥42.86', '≥¥45.00']);
  assert.ok(model.sellRows.every(r => r.amountMajor === undefined && r.active === false));
});

test('buildDividendStockTableModel computes sell amounts from held shares and highlights active buy/sell tiers', () => {
  const heldPlan = buildClassicStockPlan({
    code: '000858',
    name: '五粮液',
    group: 'core',
    weightBps: 2500,
    lotSize: 100,
    shareMode: 'manual',
    manualShares: 400,
    quote: { priceMinor: 4600, date: '2026-11-17 15:00' },
  }, {
    totalBudgetMinor: 10_000_000,
    shares: 400,
    taxBps: 1000,
    asOf: '2026-11-17',
    basis: basis(),
  });

  const model = buildDividendStockTableModel(heldPlan, 'sell');
  assert.equal(model.hasHolding, true);
  assert.deepEqual(
    model.sellRows.map(r => r.amountMajor),
    [100 * 37.5, 200 * 40.0, 300 * 42.86, 400 * 45.0],
  );
  assert.ok(model.sellRows.every(r => r.active === true));
  assert.ok(model.buyRows.every(r => r.active === false));
});
