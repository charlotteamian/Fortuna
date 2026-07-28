import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if ((specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL) {
      const candidate = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(candidate)) return { url: candidate.href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.endsWith('.json')) {
      return {
        format: 'module',
        source: `export default ${readFileSync(new URL(url), 'utf8')}`,
        shortCircuit: true,
      };
    }
    return nextLoad(url, context);
  },
});

const { parseLatestRateRows, selectFreshestCachedRate } = await import('../src/services/rateService.ts');

test('parses the current Frankfurter v2 top-level row array', () => {
  assert.deepEqual(parseLatestRateRows([
    { date: '2026-07-28', base: 'CNY', quote: 'USD', rate: 0.1392 },
    { date: '2026-07-27', base: 'CNY', quote: 'EUR', rate: 0.118 },
    { date: '2026-07-28', base: 'CNY', quote: '', rate: 1 },
  ]), [
    { date: '2026-07-28', quote: 'USD', rate: 0.1392 },
    { date: '2026-07-27', quote: 'EUR', rate: 0.118 },
  ]);
});

test('keeps compatibility with the former object-shaped rate response', () => {
  assert.deepEqual(parseLatestRateRows({
    date: '2026-07-28',
    rates: { USD: 0.1392, EUR: 0.118, BAD: 0 },
  }), [
    { date: '2026-07-28', quote: 'USD', rate: 0.1392 },
    { date: '2026-07-28', quote: 'EUR', rate: 0.118 },
  ]);
});

test('uses a newer reverse pair instead of a stale direct pair', () => {
  assert.equal(selectFreshestCachedRate(
    { rate: 7, updatedAt: 100 },
    { rate: 0.138, updatedAt: 200 },
  ), 1 / 0.138);
  assert.equal(selectFreshestCachedRate(
    { rate: 7.2, updatedAt: 300 },
    { rate: 0.138, updatedAt: 200 },
  ), 7.2);
});
