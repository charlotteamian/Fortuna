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
