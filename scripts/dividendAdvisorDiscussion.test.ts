import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import test from 'node:test';
import { defaultDividendSelectionPrinciples, type DividendResearchSnapshot, type DividendStockResearch } from '../src/lib/dividendResearch.ts';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if ((specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL) {
      const candidate = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(candidate)) return { url: candidate.href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.endsWith('.json')) return { format: 'module', source: `export default ${readFileSync(new URL(url), 'utf8')}`, shortCircuit: true };
    return nextLoad(url, context);
  },
});
const { prepareDividendDiscussionResearch } = await import('../src/services/dividendAdvisorDiscussionService.ts');
const stock = (code: string, name: string): DividendStockResearch => ({ code, name, checks: [], status: 'unknown', sources: [], issues: [] });
const current: DividendResearchSnapshot = { generatedAt: Date.now(), principles: { ...defaultDividendSelectionPrinciples(), minYieldBps: 600, notes: 'Current rules' },
  stocks: [stock('601398', 'Fresh company')], indices: [{ code: 'sh000300', name: 'Fresh index', sources: [], issues: [] }] };

test('discussing an existing plan stock reuses newly prepared research and ignores the cached card name', async () => {
  const value = await prepareDividendDiscussionResearch(current, [{ code: '601398', name: 'Cached company' }], {
    fetchResearch: async () => { throw new Error('An existing fresh stock must not be fetched twice'); },
    loadPrinciples: async () => { throw new Error('Current snapshot already supplies the current rules'); },
  });
  assert.equal(value.stocks[0].name, 'Fresh company');
  assert.deepEqual(value.principles, current.principles);
  assert.deepEqual(value.indices, current.indices);
});

test('candidate and deferred-stock discussions fetch evidence again under current rules and retain the newly prepared index context', async () => {
  const deferred = { ...stock('600900', 'Deferred company'), issues: [{ kind: 'technical', reason: 'deferred' }] } as DividendStockResearch;
  const value = await prepareDividendDiscussionResearch({ ...current, stocks: [...current.stocks, deferred] }, [
    { code: '600900', name: 'Cached deferred card' }, { code: '600036', name: 'Cached candidate card' },
  ], {
    fetchResearch: async (targets, principles) => {
      assert.deepEqual(targets.map(item => item.code), ['600900', '600036']);
      assert.deepEqual(principles, current.principles);
      return { generatedAt: Date.now(), principles, stocks: targets.map(item => stock(item.code, 'Refetched evidence')), indices: [] };
    },
    loadPrinciples: async () => current.principles,
  });
  assert.equal(value.stocks.length, 2);
  assert.ok(value.stocks.every(item => item.name === 'Refetched evidence'));
  assert.deepEqual(value.indices, current.indices, 'a candidate lookup must not replace recent index data with a failed/empty lookup');
});
