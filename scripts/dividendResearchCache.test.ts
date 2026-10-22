import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import Dexie from 'dexie';
import { defaultDividendSelectionPrinciples, type DividendResearchSnapshot } from '../src/lib/dividendResearch.ts';
import { closeDividendResearchCache, loadDividendResearchCache, saveDividendResearchCache } from '../src/services/dividendResearchCacheService.ts';

let closeReopened: (() => void) | undefined;
after(async () => { closeDividendResearchCache(); closeReopened?.(); await Dexie.delete('FortunaDividendResearchCache'); });

test('last completed screening survives navigation/reopening, preserves its date/scope/input and rejects late older results', async () => {
  assert.equal(await loadDividendResearchCache(), null);
  const snapshot: DividendResearchSnapshot = { generatedAt: 1000, principles: defaultDividendSelectionPrinciples(), indices: [],
    stocks: [{ code: '600036', name: '招商银行', status: 'unknown', checks: [], sources: [], issues: [{ kind: 'technical', reason: 'request_failed' }] }] };
  const value = { snapshot, scope: 'candidates' as const, candidateInput: '招商银行' };
  await saveDividendResearchCache({ ...value, apiKey: 'PRIVATE_KEY' } as typeof value);
  assert.deepEqual(await loadDividendResearchCache(), value);
  await saveDividendResearchCache({ ...value, snapshot: { ...snapshot, generatedAt: 900 }, candidateInput: 'older' });
  assert.deepEqual(await loadDividendResearchCache(), value, 'a delayed completion must not replace a newer review');
  await assert.rejects(saveDividendResearchCache({ ...value, snapshot: { ...snapshot, stocks: null as never } }), /INVALID_RESEARCH_CACHE/);
  assert.deepEqual(await loadDividendResearchCache(), value, 'a failed review must leave the last completed result available');
  closeDividendResearchCache();
  const reopened = await import('../src/services/dividendResearchCacheService.ts?reopen=1');
  closeReopened = reopened.closeDividendResearchCache;
  assert.deepEqual(await reopened.loadDividendResearchCache(), value);
  assert.doesNotMatch(JSON.stringify(await reopened.loadDividendResearchCache()), /PRIVATE_KEY|apiKey/);
});
