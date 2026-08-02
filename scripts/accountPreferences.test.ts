import test from 'node:test';
import assert from 'node:assert/strict';
import { isAccountHidden, isAccountIncludedInTotals } from '../src/lib/accountPreferences.ts';

test('legacy accounts remain visible and included in totals', () => {
  const legacyAccount = {};
  assert.equal(isAccountIncludedInTotals(legacyAccount), true);
  assert.equal(isAccountHidden(legacyAccount), false);
});

test('hidden and total-inclusion preferences remain independent', () => {
  assert.equal(isAccountIncludedInTotals({ hidden: true }), true);
  assert.equal(isAccountHidden({ includeInTotals: false }), false);
  assert.equal(isAccountIncludedInTotals({ includeInTotals: false, hidden: true }), false);
  assert.equal(isAccountHidden({ includeInTotals: false, hidden: true }), true);
});
