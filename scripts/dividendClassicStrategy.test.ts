import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildClassicStockPlan,
  resolveClassicDividendBase,
  type ClassicVerifiedBasis,
} from '../src/lib/dividendClassicStrategy.ts';
import type { DividendStock } from '../src/lib/dividendWorkbench.ts';

function makeStock(overrides: Partial<DividendStock> = {}): DividendStock {
  return {
    code: '601088',
    name: '中国神华',
    group: 'core',
    weightBps: 1000,
    lotSize: 100,
    shareMode: 'manual',
    manualShares: 0,
    ...overrides,
  };
}

function verifiedBasis(overrides: Partial<ClassicVerifiedBasis> = {}): ClassicVerifiedBasis {
  return {
    dpsMicros: 2_260_000,
    implementedDpsMicros: 2_260_000,
    verified: true,
    frequency: 'annual',
    reportPeriods: ['2024-12-31'],
    latestExDate: '2025-07-10',
    ...overrides,
  };
}

test('resolveClassicDividendBase: verified recent batches become the pricing base, capped at earnings when flagged', () => {
  const base = resolveClassicDividendBase({ taxBps: 1000, basis: verifiedBasis() });
  assert.equal(base.tier, 'recent_batches');
  assert.equal(base.grossDpsMicros, 2_260_000);
  assert.equal(base.netDpsMicros, 2_034_000);
  assert.equal(base.cappedAtEarnings, false);
  assert.equal(base.earningsUnchecked, false);
  assert.equal(base.frequency, 'annual');
  assert.equal(base.periodLabel, '2024年报');

  const capped = resolveClassicDividendBase({
    taxBps: 1000,
    basis: verifiedBasis({
      dpsMicros: 2_000_000,
      implementedDpsMicros: 2_306_800,
      earningsCap: { epsMicros: 2_000_000, reportDate: '2025-03-28' },
      flags: ['CAPPED_AT_EARNINGS'],
    }),
  });
  assert.equal(capped.tier, 'recent_batches');
  assert.equal(capped.grossDpsMicros, 2_000_000);
  assert.equal(capped.implementedDpsMicros, 2_306_800);
  assert.equal(capped.cappedAtEarnings, true);
  assert.match(capped.strategyNoteZh, /封顶/);
});

test('resolveClassicDividendBase: missing annual EPS leaves the base unchecked but still usable', () => {
  const base = resolveClassicDividendBase({
    taxBps: 1000,
    basis: verifiedBasis({ dpsMicros: 1_000_000, implementedDpsMicros: 1_000_000, flags: ['EARNINGS_CAP_UNCHECKED'] }),
  });
  assert.equal(base.tier, 'recent_batches');
  assert.equal(base.grossDpsMicros, 1_000_000);
  assert.equal(base.earningsUnchecked, true);
  assert.equal(base.cappedAtEarnings, false);
});

test('resolveClassicDividendBase: no verified basis is unavailable and a manual DPS never generates prices', () => {
  const missing = resolveClassicDividendBase({ taxBps: 1000 });
  assert.equal(missing.tier, 'unavailable');
  assert.equal(missing.grossDpsMicros, undefined);

  const loss = resolveClassicDividendBase({
    taxBps: 1000,
    basis: verifiedBasis({ dpsMicros: 0, implementedDpsMicros: 0, flags: ['EARNINGS_NON_POSITIVE'] }),
  });
  assert.equal(loss.tier, 'unavailable');
  assert.match(loss.strategyNoteZh, /盈利/);

  const stock = makeStock({ manualDpsMicros: 2_500_000, quote: { priceMinor: 2500, date: '2025-07-01' } });
  const plan = buildClassicStockPlan(stock, { taxBps: 1000, asOf: '2025-07-01' });
  assert.equal(plan.base.tier, 'unavailable');
  assert.deepEqual(plan.classicBuyLevels, []);
  assert.equal(plan.todayAction.type, 'unavailable');
});

test('buildClassicStockPlan: verified basis drives the 4-buy/4-sell grid, triggers and lot sizes', () => {
  const stock = makeStock({
    code: '601088',
    name: '中国神华',
    weightBps: 10000,
    manualShares: 200,
    quote: { priceMinor: 3500, date: '2025-07-01' },
  });
  // Tax 10% -> net DPS = 2.26 * 0.9 = 2.034 (2,034,000 micros)
  // Buy 1 5.50%: floor(2034000/550)=3698; Buy 2 5.75%: 3537; Buy 3 6.00%: 3390; Buy 4 6.50%: 3129
  const plan = buildClassicStockPlan(stock, {
    totalBudgetMinor: 4_000_000,
    shares: 200,
    taxBps: 1000,
    asOf: '2025-07-01',
    basis: verifiedBasis(),
  });

  assert.equal(plan.base.netDpsMicros, 2_034_000);
  assert.equal(plan.gridOrigin, 'classic_auto');
  assert.deepEqual(plan.buyRows.map(row => row.priceMinor), [3698, 3537, 3390, 3129]);
  assert.deepEqual(plan.buyRows.map(row => row.grossPriceMinor), [
    Math.floor(2_260_000 / 550),
    Math.floor(2_260_000 / 575),
    Math.floor(2_260_000 / 600),
    Math.floor(2_260_000 / 650),
  ]);
  // At ¥35.00 Buy 1 (<=36.98) and Buy 2 (<=35.37) are triggered.
  assert.equal(plan.todayAction.type, 'buy');
  assert.equal(plan.todayAction.triggeredBuyLevel, 2);
  assert.equal(plan.buyRows[0].touched, true);
  assert.equal(plan.buyRows[1].touched, true);
  assert.equal(plan.buyRows[2].touched, false);
  assert.ok(plan.todayAction.suggestedShares > 0);
  assert.equal(plan.healthChecks.length, 3);
});

test('buildClassicStockPlan: uses the configured buy/sell ladder and caps an earnings-limited base', () => {
  const stock = makeStock({ quote: { priceMinor: 5000, date: '2025-07-01' } });
  const plan = buildClassicStockPlan(stock, {
    taxBps: 0,
    asOf: '2025-07-01',
    basis: verifiedBasis({ dpsMicros: 2_000_000, implementedDpsMicros: 2_306_800, earningsCap: { epsMicros: 2_000_000, reportDate: '2025-03-28' }, flags: ['CAPPED_AT_EARNINGS'] }),
    buyYieldBps: [400],
    sellYieldBps: [300],
  });
  assert.equal(plan.buyRows.length, 1);
  assert.equal(plan.buyRows[0].priceMinor, Math.floor(2_000_000 / 400));
  assert.equal(plan.sellRows[0].priceMinor, Math.ceil(2_000_000 / 300));
  assert.equal(plan.base.cappedAtEarnings, true);
  assert.equal(plan.base.implementedDpsMicros, 2_306_800);
});

test('buildClassicStockPlan: without a basis a saved manual grid still shows its own prices and trigger', () => {
  const stock = makeStock({
    buyLevels: [{ yieldBps: 550, portionBps: 3000, priceMinor: 3000 }],
    sellLevels: [{ yieldBps: 480, portionBps: 3000, priceMinor: 4200 }],
    quote: { priceMinor: 2900, date: '2025-07-01' },
  });
  const plan = buildClassicStockPlan(stock, { taxBps: 1000, asOf: '2025-07-01' });
  assert.equal(plan.base.tier, 'unavailable');
  assert.equal(plan.gridOrigin, 'custom_saved');
  assert.equal(plan.buyRows.length, 1);
  assert.equal(plan.buyRows[0].touched, true);
  assert.equal(plan.todayAction.type, 'buy');
});
