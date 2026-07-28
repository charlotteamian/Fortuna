import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getTargetRefKeys,
  majorToMinor,
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
