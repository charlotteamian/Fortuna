import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatAmountCompact, formatAmountFull, formatPrice, formatShares } from '../src/lib/amountFormat.ts';

test('formatAmountCompact abbreviates zh amounts with 万/亿 units', () => {
  assert.equal(formatAmountCompact(12345.678, false, '万', '亿'), '1.23万');
  assert.equal(formatAmountCompact(123456789, false, '万', '亿'), '1.23亿');
  assert.equal(formatAmountCompact(123.456, false, '万', '亿'), '123.46');
});

test('formatAmountCompact abbreviates en amounts with 万/亿 units at smaller magnitudes', () => {
  assert.equal(formatAmountCompact(1234.5, true, '万', '亿'), '1.23万');
  assert.equal(formatAmountCompact(1234567, true, '万', '亿'), '1.23亿');
  assert.equal(formatAmountCompact(999.5, true, '万', '亿'), '999.50');
});

test('formatAmountCompact keeps two decimals and a leading minus for negatives', () => {
  assert.equal(formatAmountCompact(-12345.5, false, '万', '亿'), '-1.23万');
  assert.equal(formatAmountCompact(-123.456, false, '万', '亿'), '-123.46');
});

test('formatAmountFull always uses thousands separators and two decimals', () => {
  assert.equal(formatAmountFull(1234.5), '1,234.50');
  assert.equal(formatAmountFull(-9876.543), '-9,876.54');
  assert.equal(formatAmountFull(0), '0.00');
});

test('formatPrice uses JPY without forced decimals and respects precision', () => {
  assert.equal(formatPrice(1234.5, 'JPY'), '1,234.5');
  assert.equal(formatPrice(0.12345678, 'CNY', 8), '0.12345678');
  assert.equal(formatPrice(1234.5, 'CNY'), '1,234.50');
});

test('formatShares keeps up to eight fractional digits without trailing zeros', () => {
  assert.equal(formatShares(1234.5), '1,234.5');
  assert.equal(formatShares(0.123456789), '0.12345679');
  assert.equal(formatShares(1000), '1,000');
});
