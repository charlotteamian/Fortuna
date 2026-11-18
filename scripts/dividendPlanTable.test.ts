import assert from 'node:assert/strict';
import test from 'node:test';
import { buildClassicStockPlan, type ClassicVerifiedBasis } from '../src/lib/dividendClassicStrategy.ts';
import {
  buildDividendStockTableModel,
  createEditableStockGridDraft,
  parseEditableStockGridDraft,
  updateEditableStockGridYield,
} from '../src/lib/dividendPlanTable.ts';

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

test('buildDividendStockTableModel marks sub-lot sell tiers as belowLot instead of 0.00', () => {
  const held200Plan = buildClassicStockPlan({
    code: '000001',
    name: '平安银行',
    group: 'core',
    weightBps: 3000,
    lotSize: 100,
    shareMode: 'manual',
    manualShares: 200,
    quote: { priceMinor: 1215, date: '2026-11-18 15:00' },
  }, {
    totalBudgetMinor: 10_000_000,
    shares: 200,
    taxBps: 1000,
    asOf: '2026-11-18',
    basis: basis(),
  });

  const model = buildDividendStockTableModel(held200Plan, 'waiting');
  assert.equal(model.hasHolding, true);
  assert.equal(model.sellRows[0].belowLot, true);
  assert.equal(model.sellRows[0].amountMajor, undefined);
  assert.equal(model.sellRows[1].belowLot, false);
  assert.equal(model.sellRows[1].sellShares, 100);
  assert.equal(model.sellRows[1].amountMajor, 4000);
});

test('inline stock grid draft updates price from yield when not manually overridden and validates sums', () => {
  const plan = buildClassicStockPlan({
    code: '600036',
    name: '招商银行',
    group: 'core',
    weightBps: 2500,
    lotSize: 100,
    shareMode: 'manual',
    manualShares: 0,
  }, {
    totalBudgetMinor: 10_000_000,
    shares: 0,
    taxBps: 1000,
    asOf: '2026-11-18',
    basis: basis(), // net DPS = 1.80
  });

  const draft = createEditableStockGridDraft(plan);
  assert.equal(draft.buy[0].yieldText, '5.5');
  assert.equal(draft.buy[0].priceText, '32.72');

  // Auto-recomputes price when yield changes and price was still at the formula value
  const updatedBuy0 = updateEditableStockGridYield(draft.buy[0], 'buy', '6', plan.base.netDpsMicros);
  assert.equal(updatedBuy0.priceText, '30.00');

  // Preserves manual custom price when yield changes
  const manualRow = { ...draft.buy[1], priceText: '30.50' };
  const updatedManual = updateEditableStockGridYield(manualRow, 'buy', '6', plan.base.netDpsMicros);
  assert.equal(updatedManual.priceText, '30.50');

  const parsed = parseEditableStockGridDraft({
    buy: [updatedBuy0, updatedManual, draft.buy[2], draft.buy[3]],
    sell: draft.sell,
  }, plan.base.netDpsMicros);
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.buyLevels[0].yieldBps, 600);
    assert.equal(parsed.buyLevels[0].priceMinor, 3000);
    assert.equal(parsed.buyLevels[1].priceMinor, 3050);
  }

  const overSum = parseEditableStockGridDraft({
    buy: draft.buy.map(r => ({ ...r, portionText: '30' })),
    sell: draft.sell,
  }, plan.base.netDpsMicros);
  assert.deepEqual(overSum, { ok: false, errorKey: 'plan_grid_portion_over' });

  const missingBasisNoPrice = parseEditableStockGridDraft({
    buy: [{ key: 'b1', yieldText: '5.5', priceText: '', portionText: '100' }],
    sell: [{ key: 's1', yieldText: '4.5', priceText: '40', portionText: '100' }],
  });
  assert.deepEqual(missingBasisNoPrice, { ok: false, errorKey: 'plan_grid_price_required' });
});
