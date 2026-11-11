import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import test, { after, beforeEach } from 'node:test';
import Dexie from 'dexie';
import { calculateDividendPricing, defaultDividendPricingMethod } from '../src/lib/dividendPricing.ts';
import { dividendPricingPlan } from '../src/lib/dividendPricingPlan.ts';
import { pingAnOfficialLedger } from './helpers/dividendPricingFixture.ts';
import { defaultDividendSelectionPrinciples, type DividendResearchSnapshot, type DividendStockResearch } from '../src/lib/dividendResearch.ts';
import { closeDividendResearchCache, dividendPricingSnapshotForStock, dividendResearchScopeStocks, dividendResearchSnapshotForStock, loadDividendResearchCache,
  loadDividendResearchCollapsePreference, saveDividendResearchCache, saveDividendResearchCollapse } from '../src/services/dividendResearchCacheService.ts';

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
const dayStamp = (day: string) => Date.parse(`${day}T02:00:00Z`);
function cashSnapshot(day: string, dpsMicros = 609000, method = defaultDividendPricingMethod()): DividendResearchSnapshot {
  const code = '000001';
  const pricing = calculateDividendPricing({ code, name: code, financialSector: true, method, asOf: day, annuals: [],
    dividendBase: { dpsMicros, asOf: day, frequency: 'annual', requiredBatches: 1, selectedBatchIds: ['annual'], latestExDate: '2026-06-12',
      verified: true, flags: [], sourceUrls: ['https://data.eastmoney.com/yjfp/detail/000001.html'], reportPeriods: ['2025-12-31'] } });
  return { ...snapshot(dayStamp(day), [{ ...stock(code), pricing, issues: [], sources: [{ kind: 'financial', provider: 'Eastmoney',
    url: 'https://example.test/financial', fetchedAt: dayStamp('2026-10-01'), asOf: '2026-06-30' }] }]), pricingMethod: method };
}

test('a current usable cash calculation gets its own context while a partial review keeps financial evidence dates', async () => {
  const previous = cashSnapshot('2026-11-10', 500000), next = cashSnapshot('2026-11-11');
  next.stocks[0].issues = [{ kind: 'technical', reason: 'request_failed' }];
  await save(previous);
  const merged = await saveDividendResearchCache({ snapshot: next, scope: 'plan', candidateInput: '' }, { preserveFailedSources: true });
  assert.equal(dividendResearchSnapshotForStock(merged, '000001').generatedAt, previous.generatedAt);
  const price = dividendPricingSnapshotForStock(merged, '000001');
  assert.equal(price.generatedAt, next.generatedAt); assert.equal(price.stocks[0].pricing?.canApply, true);
  assert.equal(price.stocks[0].pricing?.grid[0].priceMinor, 996);
  assert.equal(price.stocks[0].sources.find(source => source.kind === 'financial')?.fetchedAt, dayStamp('2026-10-01'));
  assert.deepEqual(dividendPricingSnapshotForStock((await loadDividendResearchCache())!, '000001'), JSON.parse(JSON.stringify(price)));
});

test('an actual cash failure retains historical numbers but cannot revive them as a current price calculation', async () => {
  const previous = cashSnapshot('2026-11-10'), next = cashSnapshot('2026-11-11');
  next.stocks[0].issues = [{ kind: 'dividend', reason: 'request_failed' }]; delete next.stocks[0].pricing;
  await save(previous);
  const merged = await saveDividendResearchCache({ snapshot: next, scope: 'plan', candidateInput: '' }, { preserveFailedSources: true });
  assert.equal(merged.snapshot.stocks[0].pricing?.grid[0].priceMinor, 996, 'last dated numbers remain evidence');
  assert.equal(dividendPricingSnapshotForStock(merged, '000001').stocks[0].pricing?.canApply, false);
  assert.equal(dividendPricingPlan(dividendPricingSnapshotForStock(merged, '000001').stocks[0].pricing!), null);
  assert.equal(merged.pricingContexts?.['000001'].attemptedAt, next.generatedAt);
  const older = cashSnapshot('2026-11-10', 900000); older.generatedAt += 1000;
  await save(older);
  assert.equal(dividendPricingSnapshotForStock((await loadDividendResearchCache())!, '000001').stocks[0].pricing?.canApply, false);
});

test('a late complete review cannot replace a newer price that arrived in a partial source refresh', async () => {
  await save(cashSnapshot('2026-11-09', 500000));
  const next = cashSnapshot('2026-11-11', 700000); next.stocks[0].issues = [{ kind: 'technical', reason: 'request_failed' }];
  await saveDividendResearchCache({ snapshot: next, scope: 'plan', candidateInput: '' }, { preserveFailedSources: true });
  await save(cashSnapshot('2026-11-10', 600000));
  const restored = (await loadDividendResearchCache())!, price = dividendPricingSnapshotForStock(restored, '000001');
  assert.equal(price.generatedAt, next.generatedAt); assert.equal(price.stocks[0].pricing?.dividendBase?.dpsMicros, 700000);
});

test('a method change updates only the pricing context during an otherwise partial review', async () => {
  const previous = cashSnapshot('2026-11-10');
  const method = { ...defaultDividendPricingMethod(), holdingPeriod: 'over_year' as const, buyYieldBps: [600, 625, 650, 700] };
  const next = cashSnapshot('2026-11-11', 609000, method); next.stocks[0].issues = [{ kind: 'financial', reason: 'request_failed' }];
  await save(previous);
  const merged = await saveDividendResearchCache({ snapshot: next, scope: 'plan', candidateInput: '' }, { preserveFailedSources: true });
  assert.deepEqual(dividendResearchSnapshotForStock(merged, '000001').pricingMethod, previous.pricingMethod);
  const price = dividendPricingSnapshotForStock(merged, '000001');
  assert.deepEqual(price.pricingMethod, method); assert.equal(price.stocks[0].pricing?.taxBps, 0);
  assert.deepEqual(price.stocks[0].pricing?.buyYieldBps, method.buyYieldBps);
});

test('a newly saved calculation replaces inherited price metadata instead of keeping an earlier failed attempt', async () => {
  const old = cashSnapshot('2026-11-10');
  const cached = await save(old);
  const next = cashSnapshot('2026-11-11');
  const merged = await saveDividendResearchCache({ ...cached, snapshot: next, stockContexts: undefined });
  const price = dividendPricingSnapshotForStock(merged, '000001');
  assert.equal(price.generatedAt, next.generatedAt); assert.equal(price.stocks[0].pricing?.canApply, true);
  assert.equal(merged.pricingContexts?.['000001'].attemptedAt, next.generatedAt);
});

test('a conflicted current cash calculation cannot reuse an earlier ready price through auxiliary-source retention', async () => {
  await save(cashSnapshot('2026-11-10'));
  const next = cashSnapshot('2026-11-11');
  next.stocks[0].issues = [{ kind: 'technical', reason: 'request_failed' }];
  next.stocks[0].pricing = { ...next.stocks[0].pricing!, canApply: false, status: 'blocked', blockers: ['dividend_source_conflict'] };
  const merged = await saveDividendResearchCache({ snapshot: next, scope: 'plan', candidateInput: '' }, { preserveFailedSources: true });
  assert.equal(dividendPricingSnapshotForStock(merged, '000001').stocks[0].pricing?.canApply, false);
  assert.equal(merged.pricingContexts?.['000001'].usable, false);
});

test('legacy 8.0.8 mixed contexts recover only from fresh matching structured evidence, without redating financial research', async () => {
  const previous = cashSnapshot('2026-11-10'), latest = cashSnapshot('2026-11-11');
  const ledger = pingAnOfficialLedger('2026-11-11');
  latest.stocks[0].pricing = calculateDividendPricing({ code: '000001', name: 'Synthetic', financialSector: true, asOf: ledger.asOf,
    ledger, annuals: [], method: latest.pricingMethod! });
  latest.stocks[0].issues = [{ kind: 'technical', reason: 'request_failed' }];
  latest.stocks[0].sources.push({ kind: 'dividend', provider: 'Eastmoney', url: 'https://example.test/distributions', fetchedAt: latest.generatedAt + 1000 });
  const legacy = { id: 'latest', snapshot: latest, stockContexts: { '000001': previous }, scope: 'plan', candidateInput: '' };
  await stored.table('results').put(legacy);
  const restored = (await loadDividendResearchCache())!;
  assert.equal(dividendResearchSnapshotForStock(restored, '000001').generatedAt, previous.generatedAt);
  assert.equal(dividendPricingSnapshotForStock(restored, '000001').generatedAt, latest.generatedAt);
  assert.equal(dividendPricingSnapshotForStock(restored, '000001').stocks[0].pricing?.canApply, true);
  assert.deepEqual(await stored.table('results').get('latest'), legacy, 'migration reads do not rewrite original receipts');
  for (const corrupt of [
    (value: typeof legacy) => { value.snapshot.stocks[0].sources = value.snapshot.stocks[0].sources.filter(source => source.kind !== 'dividend'); },
    (value: typeof legacy) => { value.snapshot.pricingMethod = { ...latest.pricingMethod!, holdingPeriod: 'over_year' }; },
    (value: typeof legacy) => { value.snapshot.stocks[0].issues = [{ kind: 'dividend', reason: 'request_failed' }]; },
  ]) {
    const value = structuredClone(legacy); corrupt(value); await stored.table('results').put(value);
    assert.equal(dividendPricingSnapshotForStock((await loadDividendResearchCache())!, '000001').stocks[0].pricing?.canApply, false);
  }
});

test('legacy absent research preferences are distinguishable, and first UI expansion updates only the preference', async () => {
  const legacy = { id: 'latest', snapshot: snapshot(1000, [stock('600036'), stock('000333')]), scope: 'plan', candidateInput: '' };
  await stored.table('results').put(legacy);
  assert.equal(await loadDividendResearchCollapsePreference(), undefined);
  assert.deepEqual(await stored.table('results').get('latest'), legacy);
  await saveDividendResearchCollapse('600036', false, ['600036', '000333']);
  assert.deepEqual(await stored.table('results').get('latest'), { ...legacy, collapsedCodes: ['000333'] });
  assert.deepEqual(await loadDividendResearchCollapsePreference(), ['000333']);
  await saveDividendResearchCollapse('000333', false);
  assert.deepEqual(await loadDividendResearchCollapsePreference(), []);
});

test('an upgrade retires persisted pricing arithmetic without deleting evidence or changing the saved stock context', async () => {
  const pricing=calculateDividendPricing({code:'600036',name:'招商银行',financialSector:true,method:defaultDividendPricingMethod(),asOf:'2026-10-23',
    dividendBase:{dpsMicros:500000,asOf:'2026-10-23',frequency:'annual',requiredBatches:1,selectedBatchIds:['600036:2025-12-31:2026-06-25'],latestExDate:'2026-06-25',
      verified:true,flags:[],sourceUrls:['https://static.cninfo.com.cn/synthetic-implemented-batch.pdf'],reportPeriods:['2025-12-31']},
    annuals:Array.from({length:5},(_,i)=>({year:2025-i,reportDate:`${2025-i}-12-31`,noticeDate:`${2026-i}-03-20`,
      adjustedEpsMicros:1000000,dividendMicros:500000,payoutBps:5000})),
    treasury:{yieldBps:200,asOf:'2026-10-23',fetchedAt:1,history:[],sourceUrl:'https://example.com/treasury'}});
  assert.ok(dividendPricingPlan(pricing));
  const historical={...pricing,calculationVersion:4,pricingBasis:'classic_ttm' as const,dividendBase:undefined,
    trailingDividend:{dpsMicros:500000,asOf:'2026-10-23',windowStart:'2025-10-23',capitalActionsVerified:true,cashDistributionsComplete:true,sourceUrls:['https://example.com/dividend']}};
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

test('all symbols retire drafts carrying old PDF extraction while retaining the original evidence and research dates', async () => {
  for (const code of ['000001', '300750', '600036']) {
    const ledger = pingAnOfficialLedger('2026-10-23');
    ledger.code = code; ledger.events = ledger.events.map(event => ({ ...event, code }));
    const pricing = calculateDividendPricing({ code, name: code, financialSector: false, asOf: ledger.asOf, ledger,
      annuals: [], method: defaultDividendPricingMethod(), priceMinor: 1000, priceDate: ledger.asOf });
    delete ledger.officialParserVersion;
    delete pricing.ledger!.officialParserVersion;
    const original = { id: 'latest', snapshot: snapshot(1000, [{ ...stock(code), pricing }]), scope: 'plan', candidateInput: '' };
    await stored.table('results').put(original);
    const restored = (await loadDividendResearchCache())!;
    const retired = restored.snapshot.stocks[0].pricing!;
    assert.equal(retired.canApply, false); assert.equal(dividendPricingPlan(retired), null);
    assert.equal(restored.snapshot.stocks[0].yieldBps, undefined);
    assert.equal(restored.snapshot.stocks[0].checks.find(check => check.rule === 'yield')?.status, 'unknown');
    assert.ok(retired.blockers.includes('pricing_calculation_stale'));
    assert.equal(restored.snapshot.generatedAt, 1000); assert.equal(retired.ledger!.asOf, '2026-10-23');
    assert.deepEqual(retired.ledger, JSON.parse(JSON.stringify(ledger)));
    assert.deepEqual(await stored.table('results').get('latest'), original, 'reading must not rewrite historical evidence');
  }
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
