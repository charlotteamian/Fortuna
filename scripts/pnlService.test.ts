import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';

// The app uses bundler-style extensionless imports and JSON modules. Teach the
// native Node test runner just enough of Vite's resolution rules for this unit.
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

test('monthly realized P&L applies a structured option holding multiplier', async () => {
  const { holdingRealizedEvents } = await import('../src/services/pnlService.ts');
  const transactions = [
    { date: '2026-07-01', kind: 'buy' as const, shares: 2, price: 4, createdAt: 1 },
    { date: '2026-07-22', kind: 'sell' as const, shares: 1, price: 5, createdAt: 2 },
  ];

  const events = holdingRealizedEvents(transactions, 'USD', {
    instrumentType: 'us_option',
    contractMultiplier: 100,
  });

  assert.deepEqual(events, [{ date: '2026-07-22', amount: 100, currency: 'USD' }]);
});

test('holdingRealizedEvents uses LIFO + same-day T+0 + commission rate identically to position ledger', async () => {
  const { holdingRealizedEvents } = await import('../src/services/pnlService.ts');
  const transactions = [
    { id: 'b1', date: '2026-11-16', kind: 'buy' as const, shares: 1000, price: 2.328, createdAt: 1 },
    { id: 'b2', date: '2026-11-20', kind: 'buy' as const, shares: 200, price: 2.239, createdAt: 2 },
    { id: 's1', date: '2026-11-20', kind: 'sell' as const, shares: 100, price: 2.249, createdAt: 3 },
  ];
  const events = holdingRealizedEvents(transactions, 'CNY', {}, 0.01);
  assert.equal(events.length, 1);
  assert.equal(events[0].date, '2026-11-20');
  assert.equal(events[0].currency, 'CNY');
  // 100 * (2.249 - 2.239) = +1.00, minus pro-rata buy fee (0.04 / 2 = 0.02) and sell fee (0.02) = +0.96
  assert.ok(Math.abs(events[0].amount - 0.96) < 1e-6);
});
