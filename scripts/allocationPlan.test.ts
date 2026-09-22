import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getTargetRefKeys,
  majorToMinor,
  parsePlannedPurchases,
  planPercentFromInput,
  planProgress,
  remainingTargetPercent,
  resolveResourceClaims,
  sumLinkedProductValues,
  sumTargetPercents,
  targetAmountFromPercent,
  targetPercentFromAmount,
} from '../src/lib/allocationPlan.ts';

const assertClose = (actual: number, expected: number) => {
  assert.ok(Math.abs(actual - expected) < 0.000001, `${actual} should be close to ${expected}`);
};

test('amount entry preserves cents without rounding its derived percentage', () => {
  const percent = planPercentFromInput('12345.67', 'amount', 987654.32);
  assertClose(targetAmountFromPercent(987654.32, percent), 12345.67);
  assert.equal(planPercentFromInput('20.5', 'percent', 0), 20.5);
  assertClose(targetAmountFromPercent(500000, planPercentFromInput('100000', 'amount', 500000)), 100000);
});

test('amount entry needs a positive base and rejects malformed or negative input', () => {
  for (const raw of ['', ' ', '20abc', '-5', 'Infinity']) {
    assert.ok(Number.isNaN(planPercentFromInput(raw, 'amount', 1000)));
    assert.ok(Number.isNaN(planPercentFromInput(raw, 'percent', 1000)));
  }
  assert.ok(Number.isNaN(planPercentFromInput('200', 'amount', 0)));
  assert.ok(Number.isNaN(planPercentFromInput('200', 'amount', NaN)));
});

test('progress distinguishes absent targets, no holdings and amounts above plan', () => {
  assert.equal(planProgress(0, 0), undefined);
  assert.equal(planProgress(500, 0), undefined);
  assert.equal(planProgress(NaN, 100), undefined);
  assert.equal(planProgress(0, 100), 0);
  assert.equal(planProgress(50, 100), 50);
  assert.equal(planProgress(120, 100), 120);
});

test('target amounts follow the plan base instead of staying fixed', () => {
  assert.equal(targetAmountFromPercent(1_000_000, 12.5), 125_000);
  assert.equal(targetAmountFromPercent(1_200_000, 12.5), 150_000);
  assertClose(targetAmountFromPercent(1_000_000, 10, 0.14), 14_000);
});

test('legacy fixed amounts are normalized to portfolio percentages', () => {
  const percent = targetPercentFromAmount(1_000_000, 14_000, 0.14);
  assert.equal(percent, 10);
  assertClose(targetAmountFromPercent(1_000_000, percent, 0.14), 14_000);
});

test('remaining target percentage excludes the target currently being edited', () => {
  const targets = [
    { id: 'a', targetPercent: 8 },
    { id: 'b', targetPercent: 7 },
  ];

  assert.equal(sumTargetPercents(targets), 15);
  assert.equal(remainingTargetPercent(20, targets), 5);
  assert.equal(remainingTargetPercent(20, targets, 'b'), 12);
});

test('multi-product links preserve legacy single links until the new array becomes authoritative', () => {
  assert.deepEqual(getTargetRefKeys({ refKey: 'h:legacy' }), ['h:legacy']);
  assert.deepEqual(
    getTargetRefKeys({ refKey: 'h:legacy', refKeys: ['a:cash', 'a:cash'] }),
    ['a:cash'],
  );
});

test('a subcategory current amount aggregates all linked products in primary currency', () => {
  assert.equal(sumLinkedProductValues([
    { primaryValue: 56_050 },
    { primaryValue: 95_800 },
    { primaryValue: 12_800 * 7.1 },
  ]), 242_730);
});

test('explicit claims share one asset pool and the legacy blank claim receives the remainder', () => {
  const resolved = resolveResourceClaims(1_000, [
    { ownerId: 'legacy' },
    { ownerId: 'education', amountMinor: majorToMinor(300) },
    { ownerId: 'travel', amountMinor: majorToMinor(200) },
  ]);

  assert.equal(resolved.values.get('legacy'), 500);
  assert.equal(resolved.values.get('education'), 300);
  assert.equal(resolved.values.get('travel'), 200);
  assert.equal(resolved.unallocatedValue, 0);
  assert.equal(resolved.overAllocated, false);
});

test('claims are reduced proportionally when the real asset balance falls short', () => {
  const resolved = resolveResourceClaims(400, [
    { ownerId: 'a', amountMinor: majorToMinor(300) },
    { ownerId: 'b', amountMinor: majorToMinor(200) },
  ]);

  assert.equal(resolved.values.get('a'), 240);
  assert.equal(resolved.values.get('b'), 160);
  assert.equal(resolved.unallocatedValue, 0);
  assert.equal(resolved.overAllocated, true);
});

test('unclaimed value falls back to the broader allocation owner', () => {
  const resolved = resolveResourceClaims(1_000, [
    { ownerId: 'satellite', amountMinor: majorToMinor(250) },
  ], 'core');

  assert.equal(resolved.values.get('satellite'), 250);
  assert.equal(resolved.values.get('core'), 750);
  assert.equal(resolved.unallocatedValue, 0);
});

test('parsePlannedPurchases extracts discrete target items from various delimiters', () => {
  assert.deepEqual(parsePlannedPurchases(undefined), []);
  assert.deepEqual(parsePlannedPurchases(''), []);
  assert.deepEqual(parsePlannedPurchases('   \n  '), []);
  assert.deepEqual(
    parsePlannedPurchases('沪深300 ETF\n标普500 (VOO)\n纳指100'),
    ['沪深300 ETF', '标普500 (VOO)', '纳指100'],
  );
  assert.deepEqual(
    parsePlannedPurchases('黄金ETF; 银行定期；中短债基金, 美元定存、海外REITs'),
    ['黄金ETF', '银行定期', '中短债基金', '美元定存', '海外REITs'],
  );
});
