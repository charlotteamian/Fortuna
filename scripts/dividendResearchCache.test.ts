import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import test, { after, beforeEach } from 'node:test';
import Dexie from 'dexie';
import { calculateDividendPricing, defaultDividendPricingMethod } from '../src/lib/dividendPricing.ts';
import { dividendPricingPlan } from '../src/lib/dividendPricingPlan.ts';
import { defaultDividendSelectionPrinciples, type DividendResearchSnapshot, type DividendStockResearch } from '../src/lib/dividendResearch.ts';
import { closeDividendResearchCache, dividendResearchScopeStocks, dividendResearchSnapshotForStock, loadDividendResearchCache,
  saveDividendResearchCache, saveDividendResearchCollapse } from '../src/services/dividendResearchCacheService.ts';

const stored = new Dexie('FortunaDividendResearchCache');
stored.version(1).stores({ results: 'id' });
let closeReopened: (() => void) | undefined;
beforeEach(async () => { await stored.table('results').clear(); });
after(async () => { closeDividendResearchCache(); closeReopened?.(); stored.close(); await Dexie.delete('FortunaDividendResearchCache'); });

const stock = (code: string, name = code): DividendStockResearch => ({ code, name, status: 'unknown', checks: [], sources: [],
  issues: [{ kind: 'technical', reason: 'request_failed' }] });
const snapshot = (generatedAt: number, stocks: DividendStockResearch[]): DividendResearchSnapshot => ({ generatedAt,
  principles: defaultDividendSelectionPrinciples(), indices: [], stocks });
const save = (value: DividendResearchSnapshot) => saveDividendResearchCache({ snapshot: value, scope: 'candidates', candidateInput: '招商银行' });

test('an upgrade retires persisted pricing arithmetic without deleting evidence or changing the saved stock context', async () => {
  const pricing=calculateDividendPricing({code:'600036',name:'招商银行',financialSector:true,method:defaultDividendPricingMethod(),asOf:'2026-10-23',
    annuals:Array.from({length:5},(_,i)=>({year:2025-i,reportDate:`${2025-i}-12-31`,noticeDate:`${2026-i}-03-20`,
      adjustedEpsMicros:1000000,dividendMicros:500000,payoutBps:5000})),
    treasury:{yieldBps:200,asOf:'2026-10-23',fetchedAt:1,history:[],sourceUrl:'https://example.com/treasury'}});
  assert.ok(dividendPricingPlan(pricing));
  const historical={...pricing,calculationVersion:undefined};
  const old=snapshot(1000,[{...stock('600036'),pricing:historical}]);
  await stored.table('results').put({id:'latest',snapshot:old,scope:'plan',candidateInput:'',collapsedCodes:['600036']});
  const restored=(await loadDividendResearchCache())!, retired=restored.snapshot.stocks[0].pricing!;
  assert.equal(retired.canApply,false);assert.equal(dividendPricingPlan(retired),null);
  assert.ok(retired.blockers.includes('pricing_calculation_stale'));
  assert.deepEqual(retired.grid,JSON.parse(JSON.stringify(historical.grid)));assert.deepEqual(retired.annuals,JSON.parse(JSON.stringify(historical.annuals)));
  assert.deepEqual(restored.collapsedCodes,['600036']);assert.equal(restored.snapshot.generatedAt,1000);
  const updated=await save(snapshot(2000,[{...stock('600036'),pricing}]));
  assert.equal(updated.snapshot.stocks[0].pricing?.canApply,true);
  assert.ok(dividendPricingPlan(updated.snapshot.stocks[0].pricing!));
});

test('completed screening preserves its date/scope/input, ignores stale results and keeps the last result after a failure', async () => {
  assert.equal(await loadDividendResearchCache(), null);
  const value = { snapshot: snapshot(1000, [stock('600036', '招商银行')]), scope: 'candidates' as const, candidateInput: '招商银行' };
  const saved = await saveDividendResearchCache({ ...value, apiKey: 'PRIVATE_KEY' } as typeof value);
  assert.deepEqual(saved.snapshot, value.snapshot);
  assert.equal(saved.scope, value.scope);
  assert.equal(saved.candidateInput, value.candidateInput);
  assert.deepEqual(await loadDividendResearchCache(), saved);
  await saveDividendResearchCache({ ...value, snapshot: { ...value.snapshot, generatedAt: 900 }, candidateInput: 'older' });
  assert.deepEqual(await loadDividendResearchCache(), saved, 'a delayed completion must not replace a newer review');
  await assert.rejects(saveDividendResearchCache({ ...value, snapshot: { ...value.snapshot, stocks: null as never } }), /INVALID_RESEARCH_CACHE/);
  assert.deepEqual(await loadDividendResearchCache(), saved, 'a failed review must leave the completed results available');
  assert.doesNotMatch(JSON.stringify(await loadDividendResearchCache()), /PRIVATE_KEY|apiKey/);
});

test('checking one stock retains all other checked stocks with their original dates, rules and market context', async () => {
  const original = snapshot(1000, [stock('600036'), stock('000333')]);
  original.indices = [{ code: 'sh000001', name: 'original index context', sources: [], issues: [] }];
  await save(original);
  const updated = snapshot(2000, [stock('000333', 'reviewed')]);
  updated.principles = { ...updated.principles, minYieldBps: 500 };
  const saved = await save(updated);
  assert.deepEqual(saved.snapshot.stocks.map(value => value.code), ['600036', '000333']);
  assert.equal(saved.snapshot.stocks[1].name, 'reviewed');
  assert.deepEqual(dividendResearchSnapshotForStock(saved, '600036'), { ...original, stocks: [original.stocks[0]] });
  assert.deepEqual(dividendResearchSnapshotForStock(saved, '000333'), updated);
  assert.deepEqual(await loadDividendResearchCache(), saved);
});

test('plan results follow current membership while candidate results and refresh targets follow only the requested batch', async () => {
  const original = await saveDividendResearchCache({ snapshot: snapshot(1000, [stock('600036'), stock('000333')]), scope: 'plan', candidateInput: '' });
  assert.deepEqual(dividendResearchScopeStocks(original, ['000333']).map(value => value.code), ['000333'], 'deleted plan stocks must disappear immediately');
  assert.deepEqual(dividendResearchScopeStocks(original, []).map(value => value.code), [], 'an empty plan must not restore historical/default stocks');
  const plan = await saveDividendResearchCache({ snapshot: snapshot(2000, [stock('000333')]), scope: 'plan', candidateInput: '' });
  assert.equal(plan.snapshot.stocks.length, 2, 'dated evidence may be retained without rejoining the plan');
  const candidate = await saveDividendResearchCache({ snapshot: snapshot(3000, [stock('300750', '宁德时代')]), scope: 'candidates', candidateInput: '宁德时代' });
  assert.deepEqual(candidate.reviewedCodes, ['300750']);
  assert.deepEqual(dividendResearchScopeStocks(candidate, ['000333']).map(value => value.code), ['300750']);
  const resumed = await saveDividendResearchCache({ snapshot: snapshot(4000, [stock('000333', 'reviewed')]), scope: candidate.scope,
    candidateInput: candidate.candidateInput, reviewedCodes: candidate.reviewedCodes });
  assert.deepEqual(dividendResearchScopeStocks(resumed, []).map(value => value.code), ['300750'], 'a single-stock follow-up must not expand the next candidate refresh');
  const restored = (await loadDividendResearchCache())!;
  assert.deepEqual(dividendResearchScopeStocks(restored, []).map(value => value.code), ['300750']);
});

test('legacy merged candidate caches restore only the most recently checked batch', async () => {
  const old = snapshot(1000, [stock('600036')]), latest = snapshot(2000, [stock('300750')]);
  await stored.table('results').put({ id: 'latest', snapshot: { ...latest, stocks: [...old.stocks, ...latest.stocks] },
    scope: 'candidates', candidateInput: '宁德时代', stockContexts: { '600036': old, '300750': latest } });
  const restored = (await loadDividendResearchCache())!;
  assert.deepEqual(restored.reviewedCodes, ['300750']);
  assert.deepEqual(dividendResearchScopeStocks(restored, []).map(value => value.code), ['300750']);
  await assert.rejects(saveDividendResearchCache({ ...restored, reviewedCodes: ['invalid'] }), /INVALID_RESEARCH_CACHE/);
});

test('checking an empty plan switches away from candidates without restoring historical entries', async () => {
  await save(snapshot(1000, [stock('300750', '宁德时代')]));
  const emptyPlan = await saveDividendResearchCache({ snapshot: snapshot(2000, []), scope: 'plan', candidateInput: '宁德时代', reviewedCodes: [] });
  assert.equal(emptyPlan.scope, 'plan');
  assert.deepEqual(emptyPlan.reviewedCodes, []);
  assert.deepEqual(dividendResearchScopeStocks(emptyPlan, []), []);
  const restored = (await loadDividendResearchCache())!;
  assert.equal(restored.scope, 'plan');
  assert.deepEqual(dividendResearchScopeStocks(restored, []), []);
  assert.deepEqual(dividendResearchSnapshotForStock(restored, '300750').stocks.map(value => value.code), ['300750'], 'research evidence remains available without joining the empty plan');
});

test('out-of-order reviews merge by each stock date instead of a single global batch date', async () => {
  await save(snapshot(1000, [stock('600036'), stock('000333')]));
  await save(snapshot(3000, [stock('000333', 'newest B')]));
  await save(snapshot(2000, [stock('600036', 'newer A')]));
  const saved = (await loadDividendResearchCache())!;
  assert.equal(saved.snapshot.generatedAt, 3000);
  assert.deepEqual(saved.snapshot.stocks.map(value => value.name), ['newer A', 'newest B']);
  assert.equal(dividendResearchSnapshotForStock(saved, '600036').generatedAt, 2000);
  await save(snapshot(1500, [stock('600036', 'stale A'), stock('600900', 'new C')]));
  const final = (await loadDividendResearchCache())!;
  assert.deepEqual(final.snapshot.stocks.map(value => value.name), ['newer A', 'newest B', 'new C']);
});

test('collapse saves independently and survives a concurrent single-stock review without deleting evidence', async () => {
  await save(snapshot(1000, [stock('600036'), stock('000333')]));
  await Promise.all([saveDividendResearchCollapse('600036', true), save(snapshot(2000, [stock('000333', 'reviewed')]))]);
  const saved = (await loadDividendResearchCache())!;
  assert.deepEqual(saved.collapsedCodes, ['600036']);
  assert.deepEqual(saved.snapshot.stocks.map(value => value.code), ['600036', '000333']);
  await saveDividendResearchCollapse('600036', false);
  assert.deepEqual((await loadDividendResearchCache())?.collapsedCodes, []);
});

test('retained results are not truncated when successive batches exceed 100 stocks', async () => {
  await save(snapshot(1000, Array.from({ length: 100 }, (_, index) => stock(String(600000 + index)))));
  await save(snapshot(2000, Array.from({ length: 30 }, (_, index) => stock(String(600100 + index)))));
  const saved = (await loadDividendResearchCache())!;
  assert.equal(saved.snapshot.stocks.length, 130);
  assert.equal(saved.stockContexts?.['600000'].generatedAt, 1000);
  assert.equal(saved.stockContexts?.['600129'].generatedAt, 2000);
});

test('existing latest-only caches migrate without losing evidence and reopen with the full list and collapsed state', async () => {
  const legacy = { id: 'latest', snapshot: snapshot(1000, [stock('600036'), stock('000333')]), scope: 'plan', candidateInput: '' };
  await stored.table('results').put(legacy);
  const restored = (await loadDividendResearchCache())!;
  assert.deepEqual(restored.snapshot, legacy.snapshot);
  assert.deepEqual(restored.collapsedCodes, []);
  await save(snapshot(2000, [stock('600900')]));
  await saveDividendResearchCollapse('000333', true);
  const saved = await loadDividendResearchCache();
  closeDividendResearchCache();
  const reopened = await import('../src/services/dividendResearchCacheService.ts?reopen=1');
  closeReopened = reopened.closeDividendResearchCache;
  assert.deepEqual(await reopened.loadDividendResearchCache(), saved);
  assert.equal((await reopened.loadDividendResearchCache())?.snapshot.stocks.length, 3);
  assert.deepEqual((await reopened.loadDividendResearchCache())?.collapsedCodes, ['000333']);
});
