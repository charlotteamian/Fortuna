import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import test, { after, beforeEach } from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import Dexie from 'dexie';
import { Capacitor } from '@capacitor/core';
import { dividendCheckSummary, dividendFundCheckSummary } from '../src/lib/dividendCheckSummary.ts';
import { dividendDailyCheckedKeys, dividendDailyCheckIsStale, dividendDailyCoverage, dividendDailyItem, dividendDailySemanticFingerprint, sortDividendDailyItems, type DividendDailyCheck, type DividendDailyItem, type DividendDailySource } from '../src/lib/dividendDailyCheck.ts';
import { defaultDividendFundPlan } from '../src/lib/dividendFundPlan.ts';
import { verifiedDividendBase, pingAnOfficialLedger } from './helpers/dividendPricingFixture.ts';
import { awaitDividendRequest, assertDividendRequestCurrent } from '../src/services/dividendRequestControl.ts';

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
const { createDividendDailyCheckRunner, loadDividendDailyCheckSnapshot, dividendDailyCheckRunner } = await import('../src/services/dividendDailyCheckService.ts');
const { db, initializeSettings } = await import('../src/db.ts');
const { refreshDividendMarketQuotes } = await import('../src/services/dividendQuoteService.ts');
const { refreshDividendStock } = await import('../src/services/dividendService.ts');
const { loadDividendDailyCheckInputKey } = await import('../src/services/dividendDailyAdviceScopeService.ts');
const { claimDividendDailyCheckBatch, loadDividendDailyCheckOwner, loadDividendDailyChecks, saveDividendDailyCheck, saveDividendDailyAdvice, loadDividendDailyAdvice, closeDividendDailyAdvice } = await import('../src/services/dividendDailyAdviceService.ts');
const { researchDividendLedger, closeDividendLedgerEvidence } = await import('../src/services/dividendLedgerEvidenceService.ts');
const { fetchDividendResearch } = await import('../src/services/dividendResearchService.ts');
const { saveDividendResearchCache, loadDividendResearchCache, closeDividendResearchCache } = await import('../src/services/dividendResearchCacheService.ts');
const asOf = '2026-11-01', now = Date.parse(`${asOf}T03:00:00Z`);
const stock = { code: '000001', name: 'Synthetic bank', group: 'core' as const, weightBps: 10000, shareMode: 'manual' as const, manualShares: 200, lotSize: 100,
  buyPaused: true, buyLevels: [{ yieldBps: 550, portionBps: 10000, priceMinor: 996 }], sellLevels: [{ yieldBps: 480, portionBps: 10000, priceMinor: 1142 }],
  quote: { priceMinor: 900, date: `${asOf} 10:00`, fetchedAt: now } };
const summary = () => dividendCheckSummary({ stock, asOf, now, shares: 200, totalBudgetMinor: 1000000,
  basis: verifiedDividendBase(609000, asOf), researchGeneratedAt: now,
  research: { code: stock.code, name: stock.name, checks: [{ rule: 'roe', status: 'risk' }], status: 'risk', sources: [], issues: [] } });
const items = () => [dividendDailyItem(summary()), { ...dividendDailyItem(summary()), key: 'stock:600036', id: '600036', code: '600036', name: 'Other synthetic stock' }];
const stored = new Dexie('FortunaDividendDailyAdvice'); stored.version(1).stores({ advice: 'id' });
const ledgers = new Dexie('FortunaDividendLedger'); ledgers.version(1).stores({ documents: 'url', ledgers: 'code' });
const research = new Dexie('FortunaDividendResearchCache'); research.version(1).stores({ results: 'id' });
beforeEach(async () => {
  await db.transaction('rw', db.tables, async () => { for (const table of db.tables) await table.clear(); });
  await stored.table('advice').clear(); await ledgers.table('documents').clear(); await ledgers.table('ledgers').clear(); await research.table('results').clear();
});
after(() => { db.close(); stored.close(); ledgers.close(); research.close(); closeDividendDailyAdvice(); closeDividendLedgerEvidence(); closeDividendResearchCache(); });
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
const sourcesFor = (key: string): DividendDailySource[] => ['quote', 'disclosure', 'schedule', 'research', 'official', 'plan'].map(kind => ({ id: `${key}:${kind}`, itemKey: key,
  stage: kind === 'quote' ? 'quotes' : kind === 'plan' ? 'plans' : 'evidence', provider: 'synthetic', status: 'success' }));
const saveClaimedCheck = async (value: DividendDailyCheck) => {
  assert.equal(await claimDividendDailyCheckBatch(value.batchId, value.startedAt), true);
  return saveDividendDailyCheck(value, { claim: true });
};
function harness() {
  let inputKey = 'user-input-v1', planKey = 'semantic-v1', rows = items(), saved: DividendDailyCheck | undefined;
  let refreshCalls = 0;
  let operation: Parameters<typeof createDividendDailyCheckRunner>[0]['refresh'] = async (_progress, options = {}) => {
    refreshCalls++;
    const targets = options.itemKeys ?? rows.map(item => item.key);
    for (const stage of ['quotes', 'evidence', 'plans', 'result'] as const) {
      await options.onEvent?.({ stage });
      for (const key of targets) for (const source of sourcesFor(key).filter(source => source.stage === stage)) await options.onEvent?.({ stage, source });
      if (stage === 'plans') await options.onEvent?.({ stage, checkedKeys: targets });
    }
    return {} as never;
  };
  const updates: DividendDailyCheck[] = [];
  const runner = createDividendDailyCheckRunner({ load: async () => ({ inputKey, planKey, items: structuredClone(rows) }), inputKey: async () => inputKey,
    refresh: (...args) => operation(...args), save: async value => { saved = structuredClone(value); return true; } });
  return { runner, updates, options: { onUpdate: (value: DividendDailyCheck) => updates.push(value) },
    get saved() { return saved; }, get refreshCalls() { return refreshCalls; },
    set operation(value: typeof operation) { operation = value; }, set inputKey(value: string) { inputKey = value; },
    set planKey(value: string) { planKey = value; }, set rows(value: DividendDailyItem[]) { rows = value; } };
}

test('daily projection reuses failed principle, manual pause, price touch, original tier and action constraints without changing the summary', () => {
  const check = summary(), before = JSON.stringify(check), row = dividendDailyItem(check);
  assert.equal(row.bucket, 'review'); assert.equal(row.trigger, 'triggered');
  assert.equal(row.actions.buy.status, 'blocked'); assert.equal(row.reasons[0], 'manual_pause'); assert.ok(row.reasons.length <= 3);
  assert.deepEqual(row.nextBuy, check.grid.nextBuy); assert.deepEqual(row.actions.sell, check.actionCheck.sell);
  assert.equal(JSON.stringify(check), before);
});

test('fund waiting, manual price, unknown holding and confirmed zero are projected from the original fund summary', () => {
  const plan = { ...defaultDividendFundPlan(), budgetMinor: 1000000, mode: 'swing' as const, entryRule: 'both' as const,
    funds: [{ id: 'fund', code: '512890', name: 'Synthetic ETF', indexKind: 'other' as const, weightBps: 10000,
      quote: { code: '512890', priceMicros: 1200000, date: `${asOf} 10:00`, fetchedAt: now }, reference: { asOf, highMicros: 1200000, indexYieldBps: 400 } }] };
  const fund = plan.funds[0];
  assert.equal(dividendDailyItem(dividendFundCheckSummary({ plan, fund, shares: 0, asOf, now })).bucket, 'wait');
  const unknown = dividendDailyItem(dividendFundCheckSummary({ plan, fund, asOf, now }));
  assert.equal(unknown.bucket, 'unknown'); assert.deepEqual(unknown.actions.sell.reasons, ['holding_unknown']);
  const manual = dividendDailyItem(dividendFundCheckSummary({ plan, fund: { ...fund, quote: undefined, reference: { ...fund.reference, priceMicros: 1200000 } }, shares: 0, asOf, now }));
  assert.equal(manual.quote.status, 'unknown'); assert.equal(manual.trigger, 'unknown');
});

test('cross-kind sorting deduplicates by original plan key, orders review then unknown then wait, and never scores risk counts', () => {
  const one = items()[0], wait = { ...one, key: 'fund:wait', kind: 'fund' as const, bucket: 'wait' as const };
  const unknown = { ...one, key: 'fund:unknown', kind: 'fund' as const, bucket: 'unknown' as const };
  assert.deepEqual(sortDividendDailyItems([wait, one, unknown, one]).map(item => item.key), [one.key, unknown.key, wait.key]);
  assert.equal(dividendDailyCoverage([{ id: 'x', itemKey: 'x', stage: 'quotes', status: 'failed', provider: 'stub' }]).failed, 1);
});

test('unconfigured deterministic runner completes every real stage and publishes local results before refreshing', async () => {
  const h = harness(), result = await h.runner.run(h.options);
  assert.equal(h.updates[0].status, 'running'); assert.equal(h.updates[0].items.length, 2); assert.deepEqual(h.updates[0].checkedKeys, []);
  assert.equal(result.status, 'completed'); assert.equal(result.checkedKeys.length, 2);
  assert.deepEqual([...new Set(h.updates.map(value => value.stage))], ['quotes', 'evidence', 'plans', 'result']);
  assert.equal(h.saved?.batchId, result.batchId); assert.equal(result.errors.length, 0);
});

test('repeated clicks join the same active check and do not duplicate requests', async () => {
  const h = harness(), hold = deferred<void>(); h.operation = async () => { await hold.promise; return {} as never; };
  const first = h.runner.run(h.options), second = h.runner.run(); assert.equal(first, second);
  hold.resolve(); await first; assert.equal(h.updates.filter(value => value.stage === 'quotes' && value.status === 'running').length, 1);
});

test('cancel during a non-cancellable call settles promptly and late events cannot replace partial or newer results', async () => {
  const h = harness(), started = deferred<void>(), late = deferred<void>(); let lateEvent: Promise<void> | undefined;
  h.operation = async (_progress, options = {}) => {
    await options.onEvent?.({ stage: 'quotes', source: sourcesFor(items()[0].key)[0] }); started.resolve();
    await late.promise;
    lateEvent = Promise.resolve(options.onEvent?.({ stage: 'result', checkedKeys: items().map(item => item.key) }));
    await lateEvent; return {} as never;
  };
  const task = h.runner.run(h.options); await started.promise; h.runner.cancel(); const stopped = await task;
  assert.equal(stopped.status, 'cancelled'); assert.equal(stopped.items.length, 2); assert.ok(stopped.sources.some(source => source.status === 'success'));
  assert.equal(stopped.checkedKeys.length, 0); assert.ok(stopped.sources.some(source => source.status === 'deferred'));
  late.resolve(); await tick(); await lateEvent?.catch(() => undefined);
  assert.equal(h.saved?.status, 'cancelled'); assert.equal(h.saved?.batchId, stopped.batchId);
});

test('whole-flow timeout covers the initial local read and stops an uncooperative refresh', async () => {
  const h = harness(); h.operation = async () => new Promise(() => undefined);
  const started = performance.now(), result = await h.runner.run({ timeoutMs: 15 });
  assert.equal(result.status, 'timed_out'); assert.ok(performance.now() - started < 500); assert.equal(h.runner.isRunning(), false);
  const runner = createDividendDailyCheckRunner({ load: async () => new Promise(() => undefined), inputKey: async () => '', refresh: async () => ({} as never), save: async () => true });
  assert.equal((await runner.run({ timeoutMs: 10 })).status, 'timed_out');
});

test('a pre-cancelled check starts no refresh and produces a cancelled batch', async () => {
  const h = harness(), controller = new AbortController(); controller.abort();
  const value = await h.runner.run({ signal: controller.signal }); assert.equal(value.status, 'cancelled'); assert.equal(h.refreshCalls, 0);
});

test('user input changes while checking abort cache writes and mark the retained result as needing recheck', async () => {
  const h = harness(); let writes = 0;
  h.operation = async (_progress, options = {}) => { h.inputKey = 'edited'; await options.beforeWrite?.(); writes++; return {} as never; };
  const value = await h.runner.run(); assert.equal(value.status, 'changed'); assert.equal(writes, 0);
  assert.ok(value.items.every(item => item.stale)); assert.equal(value.checkedKeys.length, 0);
});

test('one failed source is isolated, all remaining items are checked, and local history remains visible', async () => {
  const h = harness();
  h.operation = async (_progress, options = {}) => {
    for (const item of items()) for (const source of sourcesFor(item.key)) await options.onEvent?.({ stage: source.stage,
      source: { ...source, status: item.key === items()[0].key && source.id.endsWith(':official') ? 'failed' : 'success' } });
    await options.onEvent?.({ stage: 'plans', checkedKeys: items().map(item => item.key) }); return {} as never;
  };
  const value = await h.runner.run(); assert.equal(value.status, 'partial'); assert.equal(value.checkedKeys.length, 2);
  assert.equal(dividendDailyCoverage(value.sources).failed, 1); assert.ok(value.items[0].quote.date?.startsWith(asOf));
});

test('single-item retry refreshes only the chosen failed item and preserves other results and original check times', async () => {
  const h = harness(), previous = await h.runner.run();
  previous.status = 'partial'; previous.sources[0].status = 'failed';
  const key = previous.sources[0].itemKey, other = previous.items.find(item => item.key !== key)!;
  let requested: string[] | undefined;
  h.operation = async (_progress, options = {}) => {
    requested = options.itemKeys;
    for (const source of sourcesFor(key)) await options.onEvent?.({ stage: source.stage, source });
    await options.onEvent?.({ stage: 'plans', checkedKeys: [key] }); return {} as never;
  };
  const value = await h.runner.run({ previous, retryKeys: [key] });
  assert.deepEqual(requested, [key]); assert.equal(value.status, 'completed'); assert.equal(value.retryOf, previous.batchId);
  assert.deepEqual(value.items.find(item => item.key === other.key), other);
});

test('retry rechecks current fingerprints, leaves changed unselected items stale and refuses non-failed targets', async () => {
  const h = harness(), previous = await h.runner.run(), key = previous.sources[0].itemKey;
  previous.sources[0].status = 'failed'; h.rows = items().map(item => item.key === key ? item : { ...item, fingerprint: 'material-new-evidence' });
  const value = await h.runner.run({ previous, retryKeys: [key] });
  assert.equal(value.status, 'partial'); assert.equal(value.items.find(item => item.key !== key)?.stale, true);
  const invalid = await h.runner.run({ previous: value, retryKeys: ['fund:missing'] }); assert.ok(invalid.errors.includes('invalid_retry'));
});

test('scope freshness distinguishes cross-day and semantic changes from a repeat download', () => {
  const value = { startedAt: now, planKey: 'same', items: items() } as DividendDailyCheck;
  assert.equal(dividendDailyCheckIsStale(value, 'same', now), false);
  assert.equal(dividendDailyCheckIsStale(value, 'same', now + 86400000), true);
  assert.equal(dividendDailyCheckIsStale(value, 'different', now), true);
});

test('result storage retains legacy advice and last completed result separately from cancellation, and rejects late owners', async () => {
  const h = harness(), completed = await h.runner.run();
  const legacy = { answer: 'Historical explanation', generatedAt: new Date(now).toISOString(), language: 'en', planKey: 'old', refreshLimited: false };
  await saveDividendDailyAdvice(legacy);
  await saveClaimedCheck({ ...completed, apiKey: 'PRIVATE_KEY', config: { secret: 'PRIVATE_SECRET' } } as DividendDailyCheck);
  const cancelled = { ...completed, batchId: crypto.randomUUID(), status: 'cancelled' as const };
  await saveClaimedCheck(cancelled);
  assert.equal(await saveDividendDailyCheck(completed), false);
  assert.equal((await loadDividendDailyChecks()).current?.status, 'cancelled'); assert.equal((await loadDividendDailyChecks()).completed?.batchId, completed.batchId);
  assert.deepEqual(await loadDividendDailyAdvice(), legacy); assert.doesNotMatch(JSON.stringify(await stored.table('advice').toArray()), /PRIVATE_|apiKey|config/);
  await assert.rejects(saveDividendDailyCheck({ ...completed, sources: null } as never), /INVALID_DAILY_CHECK/);
});

test('a storage failure leaves a visible deterministic result and reports persistence failure', async () => {
  const rows = items(); const runner = createDividendDailyCheckRunner({ load: async () => ({ inputKey: 'x', planKey: 'y', items: rows }), inputKey: async () => 'x',
    refresh: async () => ({} as never), save: async () => { throw new Error('storage unavailable'); } });
  const value = await runner.run(); assert.equal(value.status, 'partial'); assert.ok(value.errors.includes('storage_failed')); assert.equal(value.items.length, 2);
});

test('aborting a detached native-like promise ignores its later value and prevents post-response work', async () => {
  const late = deferred<number>(), controller = new AbortController(); let processed = 0;
  const task = awaitDividendRequest(late.promise, { signal: controller.signal }).then(() => { processed++; });
  controller.abort(); await assert.rejects(task); late.resolve(42); await tick(); assert.equal(processed, 0);
});

test('native quote cancellation preserves every plan and old quote, including when the call finishes after a newer refresh', async t => {
  await initializeSettings(); await db.dividendStocks.put(stock); const before = JSON.stringify(await db.dividendStocks.toArray());
  t.mock.method(Capacitor, 'isNativePlatform', () => true);
  const late = deferred<Response>(), started = deferred<void>();
  t.mock.method(globalThis, 'fetch', async () => { started.resolve(); return late.promise; });
  const controller = new AbortController(), task = refreshDividendMarketQuotes({ signal: controller.signal }); await started.promise; controller.abort(); await assert.rejects(task);
  assert.equal(JSON.stringify(await db.dividendStocks.toArray()), before);
  const newerQuote = { ...stock.quote, priceMinor: 1000 }; await db.dividendStocks.update(stock.code, { quote: newerQuote });
  const fields = Array(40).fill(''); fields[1] = 'Synthetic'; fields[2] = stock.code; fields[3] = '8'; fields[30] = '20261101100000'; fields[32] = '0';
  late.resolve(new Response(`v_sz000001="${fields.join('~')}";`)); await tick(); assert.deepEqual((await db.dividendStocks.get(stock.code))?.quote, newerQuote);
});

test('stock disclosure cancellation stops all writes, leaving dividend dates, pause, prices and holdings intact', async t => {
  await initializeSettings(); await db.dividendStocks.put(stock);
  const before = JSON.stringify(await db.dividendStocks.toArray()), late = deferred<Response>();
  t.mock.method(Capacitor, 'isNativePlatform', () => true);
  t.mock.method(globalThis, 'fetch', async () => late.promise);
  const controller = new AbortController(), task = refreshDividendStock(stock.code, { signal: controller.signal }); await tick(); controller.abort(); await assert.rejects(task);
  late.resolve(new Response('{}')); await tick(); assert.equal(JSON.stringify(await db.dividendStocks.toArray()), before);
});

test('official evidence cancellation isolates a late custom transport and does not redate the last successful ledger', async () => {
  const ledger = pingAnOfficialLedger('2026-10-31'); await ledgers.table('ledgers').put(ledger);
  const before = JSON.stringify(await ledgers.table('ledgers').toArray()), late = deferred<unknown>(), started = deferred<void>(), controller = new AbortController(); let requests = 0;
  const task = researchDividendLedger({}, stock.code, asOf, { signal: controller.signal, post: async () => { requests++; started.resolve(); return late.promise; } });
  await started.promise; controller.abort(); await assert.rejects(task); late.resolve([{ code: stock.code, orgId: 'synthetic' }]); await tick();
  assert.equal(requests, 1); assert.equal(await ledgers.table('documents').count(), 0); assert.equal(JSON.stringify(await ledgers.table('ledgers').toArray()), before);
});

test('read-only check snapshot does not initialise or migrate an empty main database', async () => {
  const value = await loadDividendDailyCheckSnapshot(); assert.equal(value.items.length, 0); assert.equal(await db.settings.count(), 0); assert.equal(await db.dividendStocks.count(), 0);
});

test('input guard ignores source and reading timestamps but detects plan, holding and tax changes', async () => {
  await initializeSettings(); await db.settings.update('main', { dividendWorkbenchInitialized: true }); await db.dividendStocks.put(stock);
  const original = await loadDividendDailyCheckInputKey();
  await db.dividendStocks.update(stock.code, { quote: { ...stock.quote, fetchedAt: now + 1 } });
  await db.settings.update('main', { dividendHomeCollapsedCodes: [] }); assert.equal(await loadDividendDailyCheckInputKey(), original);
  await db.dividendStocks.update(stock.code, { manualShares: 300 }); assert.notEqual(await loadDividendDailyCheckInputKey(), original);
});

test('all real refresh services failing retain dated evidence and user inputs while still producing a complete deterministic list without AI', async t => {
  t.mock.method(Date, 'now', () => now); t.mock.method(globalThis, 'fetch', async () => { throw new Error('SYNTHETIC_OFFLINE'); });
  await initializeSettings(); await db.settings.update('main', { dividendWorkbenchInitialized: true, dividendBudgetMinor: 1000000 }); await db.dividendStocks.put(stock);
  const ledger = pingAnOfficialLedger('2026-10-31'); await ledgers.table('ledgers').put(ledger);
  const value = await dividendDailyCheckRunner.run();
  assert.equal(value.status, 'partial'); assert.equal(value.items.length, 1); assert.equal(value.checkedKeys.length, 1); assert.ok(dividendDailyCoverage(value.sources).failed > 0);
  const saved = (await db.dividendStocks.get(stock.code))!;
  assert.equal(saved.buyPaused, true); assert.deepEqual(saved.buyLevels, stock.buyLevels); assert.equal(saved.manualShares, 200);
  assert.equal(saved.quote?.date, stock.quote.date); assert.equal(saved.quote?.priceMinor, stock.quote.priceMinor);
  assert.deepEqual(await ledgers.table('ledgers').get(stock.code), ledger);
  assert.ok(value.items[0].dates.evidenceVerifiedDates.every(date => date !== asOf));
  assert.equal((await loadDividendDailyChecks()).current?.batchId, value.batchId);
});

test('failed research preserves old successful financial fields, URLs and original per-stock verification context', async () => {
  const previous = { generatedAt: now - 86400000, principles: { minYieldBps: 0, minDividendYears: 0, minRoeBps: 0, minPayoutBps: 0, minProfitGrowthBps: 0, minRevenueGrowthBps: 0 } };
  const { defaultDividendSelectionPrinciples } = await import('../src/lib/dividendResearch.ts');
  const oldStock = { code: stock.code, name: stock.name, status: 'unknown' as const, checks: [], sources: [{ kind: 'financial' as const, provider: 'Eastmoney' as const, url: 'https://example.com/synthetic-financial', fetchedAt: now - 86400000, asOf: '2026-06-30' }], issues: [] };
  await saveDividendResearchCache({ scope: 'plan', candidateInput: '', snapshot: { generatedAt: previous.generatedAt, principles: defaultDividendSelectionPrinciples(), indices: [], stocks: [oldStock] } });
  await saveDividendResearchCache({ scope: 'plan', candidateInput: '', snapshot: { generatedAt: now, principles: defaultDividendSelectionPrinciples(), indices: [],
    stocks: [{ ...oldStock, sources: [], issues: [{ kind: 'financial', reason: 'request_failed' }] }] } }, { preserveFailedSources: true });
  const cache = (await loadDividendResearchCache())!;
  assert.deepEqual(cache.snapshot.stocks[0].sources, oldStock.sources); assert.equal(cache.stockContexts?.[stock.code].generatedAt, previous.generatedAt);
  assert.equal(cache.snapshot.stocks[0].issues[0].reason, 'request_failed');
  await saveDividendResearchCache({ scope: 'plan', candidateInput: '', snapshot: { generatedAt: now + 1, principles: defaultDividendSelectionPrinciples(), indices: [],
    stocks: [{ ...oldStock, sources: [{ kind: 'technical', provider: 'Tencent', url: 'https://example.com/synthetic-technical', fetchedAt: now + 1, asOf }],
      issues: [{ kind: 'financial', reason: 'request_failed' }] }] } }, { preserveFailedSources: true });
  const partial = (await loadDividendResearchCache())!;
  assert.equal(partial.stockContexts?.[stock.code].generatedAt, previous.generatedAt, 'a fresh technical download cannot redate the failed financial review');
  assert.ok(partial.snapshot.stocks[0].sources.some(source => source.url.endsWith('synthetic-financial') && source.fetchedAt === now - 86400000));
});

test('a source commit guard refuses a superseded request before touching any cache', async () => {
  assert.throws(() => assertDividendRequestCurrent({ isCurrent: () => false }), /Superseded/);
});

test('an identical unsaved calculation does not go stale just because its download batch time changed', () => {
  const check = summary(); check.grid.origin = 'current';
  const first = JSON.parse(check.freshness.semanticFingerprint); first.grid.origin = 'current'; first.grid.generatedAt = now;
  check.freshness.semanticFingerprint = JSON.stringify(first);
  const other = structuredClone(check), second = JSON.parse(other.freshness.semanticFingerprint); second.grid.generatedAt++;
  other.freshness.semanticFingerprint = JSON.stringify(second);
  assert.equal(dividendDailySemanticFingerprint(check), dividendDailySemanticFingerprint(other));
  second.trigger.quote.priceMinor++; other.freshness.semanticFingerprint = JSON.stringify(second);
  assert.notEqual(dividendDailySemanticFingerprint(check), dividendDailySemanticFingerprint(other));
});

test('an older progress revision cannot restore running over a terminal result in the same batch', async () => {
  const h = harness(), completed = await h.runner.run(); await saveClaimedCheck(completed);
  assert.equal(await saveDividendDailyCheck({ ...completed, status: 'running', revision: completed.revision - 1 }), false);
  assert.equal((await loadDividendDailyChecks()).current?.status, 'completed'); assert.equal(stored.verno, 1);
});

test('malformed check metadata is ignored without deleting legacy or successful records, and new invalid writes reject atomically', async () => {
  const h = harness(), completed = await h.runner.run(); await saveClaimedCheck(completed);
  const invalid = { ...completed, items: [{ ...completed.items[0], eligibility: null }] };
  await assert.rejects(saveDividendDailyCheck(invalid as never), /INVALID_DAILY_CHECK/);
  assert.equal((await loadDividendDailyChecks()).current?.status, 'completed');
  await stored.table('advice').put({ id: 'check:current', check: invalid });
  assert.equal((await loadDividendDailyChecks()).current, null); assert.equal((await loadDividendDailyChecks()).completed?.batchId, completed.batchId);
  assert.deepEqual((await stored.table('advice').get('check:current')).check, invalid);
});

test('check metadata strips nested client configuration and credentials rather than serialising extra fields', async () => {
  const h = harness(), completed = await h.runner.run();
  const supplied = { ...completed, items: completed.items.map(item => ({ ...item, apiKey: 'PRIVATE_ITEM', quote: { ...item.quote, config: { token: 'PRIVATE_QUOTE' } } })),
    sources: completed.sources.map(source => ({ ...source, credentials: 'PRIVATE_SOURCE' })) };
  await saveClaimedCheck(supplied);
  assert.doesNotMatch(JSON.stringify(await stored.table('advice').toArray()), /PRIVATE_|apiKey|config|credentials/);
  assert.deepEqual((await loadDividendDailyChecks()).current, JSON.parse(JSON.stringify(completed)));
});

test('overlapping quote requests retain the newer request even if the earlier successful response arrives last', async t => {
  await initializeSettings(); await db.dividendStocks.put(stock); const firstResponse = deferred<Response>(), started = deferred<void>(); let count = 0;
  const text = (price: number) => { const fields = Array(40).fill(''); fields[1] = 'Synthetic'; fields[2] = stock.code; fields[3] = String(price); fields[30] = '20261101100000'; fields[32] = '0'; return `v_sz000001="${fields.join('~')}";`; };
  t.mock.method(globalThis, 'fetch', async () => { if (++count === 1) { started.resolve(); return firstResponse.promise; } return new Response(text(11)); });
  const earlier = refreshDividendMarketQuotes(); await started.promise; await refreshDividendMarketQuotes(); firstResponse.resolve(new Response(text(8))); await earlier;
  assert.equal((await db.dividendStocks.get(stock.code))?.quote?.priceMinor, 1100); assert.equal(count, 2);
});

test('native research cancellation stops follow-ups and callbacks even when every underlying transport ignores the signal', async t => {
  t.mock.method(Capacitor, 'isNativePlatform', () => true); const gate = deferred<void>(), started = deferred<void>(); let calls = 0, callbacks = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; started.resolve(); await gate.promise; return new Response('{}'); });
  const { defaultDividendSelectionPrinciples } = await import('../src/lib/dividendResearch.ts');
  const controller = new AbortController(), task = fetchDividendResearch([stock], defaultDividendSelectionPrinciples(), { signal: controller.signal, onStock: async () => { callbacks++; } });
  await started.promise; controller.abort(); await assert.rejects(task); const stoppedCalls = calls; gate.resolve(); await tick();
  assert.equal(calls, stoppedCalls); assert.equal(callbacks, 0); assert.equal(await ledgers.table('ledgers').count(), 0); assert.equal(await research.table('results').count(), 0);
});

test('cancelling while a progress snapshot is loading does not wait for that uncooperative read', async () => {
  const started = deferred<void>(); let reads = 0;
  const runner = createDividendDailyCheckRunner({ load: async () => { if (++reads > 1) { started.resolve(); return new Promise(() => undefined); } return { inputKey: 'x', planKey: 'y', items: items() }; },
    inputKey: async () => 'x', save: async () => true, refresh: async (_progress, options = {}) => { await options.onEvent?.({ stage: 'evidence' }); return {} as never; } });
  const task = runner.run(); await started.promise; const time = performance.now(); runner.cancel(); const value = await task;
  assert.equal(value.status, 'cancelled'); assert.equal(value.items.length, 2); assert.ok(performance.now() - time < 300);
});

test('a stalled cache save cannot extend source work beyond the check deadline indefinitely', async () => {
  let refreshCalls = 0;
  const runner = createDividendDailyCheckRunner({ load: async () => ({ inputKey: 'x', planKey: 'y', items: items() }), inputKey: async () => 'x',
    refresh: async () => { refreshCalls++; return {} as never; }, save: async () => new Promise(() => undefined) });
  const start = performance.now(), value = await runner.run({ timeoutMs: 10 });
  assert.equal(value.status, 'timed_out'); assert.equal(refreshCalls, 0); assert.ok(performance.now() - start < 1500);
  assert.ok(value.errors.includes('storage_failed'));
});

for (const state of ['unchanged', 'changed', 'unknown quote', 'long missing evidence'] as const) {
  test(`cross-day retry keeps unselected ${state} results historical without counting or explaining them as checked today`, async () => {
    const h = harness();
    if (state === 'unknown quote' || state === 'long missing evidence') h.rows = items().map(item => ({ ...item, bucket: 'unknown',
      fingerprint: state, quote: { status: 'unknown', reasons: ['quote_missing'], historicalUsable: false, sessionConfirmed: false } }));
    const previous = await h.runner.run(), yesterday = Date.now() - 86400000;
    previous.startedAt = yesterday; previous.finishedAt = yesterday; previous.status = 'partial';
    previous.items = previous.items.map(item => ({ ...item, checkedAt: yesterday }));
    previous.sources = previous.sources.map(source => ({ ...source, attemptedAt: yesterday, sourceDate: '2026-10-29', verifiedDates: ['2026-10-29'] }));
    previous.sources[0].status = 'failed';
    const key = previous.sources[0].itemKey, other = previous.items.find(item => item.key !== key)!;
    if (state === 'changed') h.rows = items().map(item => item.key === key ? item : { ...item, fingerprint: 'changed-today' });
    const value = await h.runner.run({ previous, retryKeys: [key] });
    assert.equal(value.status, 'partial'); assert.deepEqual(value.checkedKeys, [key]);
    assert.equal(value.items.find(item => item.key === other.key)?.checkedAt, yesterday);
    assert.equal(value.items.find(item => item.key === other.key)?.stale, true);
    assert.equal(dividendDailyCheckIsStale(value, value.planKey), true);
    assert.ok(dividendDailyCoverage(value.sources).historical > 0);
    assert.equal(dividendDailyCoverage(value.sources).success, sourcesFor(key).length - 1);
    for (const source of value.sources.filter(source => source.itemKey === other.key)) {
      assert.equal(source.historical, true); assert.equal(source.attemptedAt, yesterday);
      assert.equal(source.sourceDate, '2026-10-29'); assert.deepEqual(source.verifiedDates, ['2026-10-29']);
    }
  });
}

for (const status of ['cancelled', 'partial', 'timed_out'] as const) test(`cross-day retry after ${status} never promotes untouched old or provisional items`, async () => {
  const h = harness(), previous = await h.runner.run(), yesterday = Date.now() - 86400000, key = previous.items[0].key;
  previous.status = status; previous.startedAt = yesterday;
  previous.items = previous.items.map((item, index) => ({ ...item, checkedAt: index ? undefined : yesterday }));
  previous.sources[0].status = 'deferred';
  const value = await h.runner.run({ previous, retryKeys: [key] });
  assert.equal(value.status, 'partial'); assert.deepEqual(value.checkedKeys, [key]);
  assert.equal(value.items.find(item => item.key !== key)?.checkedAt, undefined);
  assert.equal(dividendDailyCheckIsStale(value, value.planKey), true);
});

test('cancelling a cross-day retry retains the old check time and never restores yesterday to today coverage', async () => {
  const h = harness(), previous = await h.runner.run(), yesterday = Date.now() - 86400000, key = previous.items[0].key;
  previous.startedAt = yesterday; previous.items.forEach(item => { item.checkedAt = yesterday; }); previous.sources[0].status = 'failed';
  h.operation = async (_progress, options = {}) => { await options.onEvent?.({ stage: 'plans', checkedKeys: [key] }); h.runner.cancel(); return {} as never; };
  const value = await h.runner.run({ previous, retryKeys: [key] });
  assert.equal(value.status, 'cancelled'); assert.deepEqual(value.checkedKeys, [key]);
  assert.equal(value.items.find(item => item.key !== key)?.checkedAt, yesterday);
  assert.equal(dividendDailyCheckIsStale(value, value.planKey), true);
});

test('source attempt freshness is independent of its historical publication and verified dates', async () => {
  const h = harness(), value = await h.runner.run(), source = { ...value.sources[0], attemptedAt: Date.now() - 86400000 };
  assert.equal(dividendDailyCoverage([source]).success, 0); assert.equal(dividendDailyCoverage([source]).historical, 1);
  assert.equal(dividendDailyCheckIsStale({ ...value, sources: [source] }, value.planKey), true);
  const today = { ...source, attemptedAt: Date.now(), sourceDate: '2020-01-01', verifiedDates: ['2020-01-02'] };
  assert.equal(dividendDailyCoverage([today]).success, 1); assert.equal(dividendDailyCoverage([today]).historical, 0);
});

test('loading a legacy mixed-day completed cache fixes its view and counters without rewriting the saved evidence', async () => {
  const h = harness(), value = await h.runner.run(); value.items[1].checkedAt = Date.now() - 86400000;
  const raw = JSON.parse(JSON.stringify(value)); await stored.table('advice').put({ id: 'check:current', check: raw });
  const loaded = (await loadDividendDailyChecks()).current!;
  assert.deepEqual(loaded.checkedKeys, [value.items[0].key]); assert.equal(loaded.items[1].stale, true);
  assert.equal(dividendDailyCheckIsStale(loaded, loaded.planKey), true);
  assert.deepEqual((await stored.table('advice').get('check:current')).check, raw);
});

function persistentRunner(overrides: Partial<Parameters<typeof createDividendDailyCheckRunner>[0]> = {}) {
  return createDividendDailyCheckRunner({ load: async () => ({ inputKey: 'input', planKey: 'plan', items: items() }), inputKey: async () => 'input',
    claim: claimDividendDailyCheckBatch, owner: loadDividendDailyCheckOwner, save: saveDividendDailyCheck,
    refresh: async (_progress, options = {}) => {
      for (const key of options.itemKeys ?? items().map(item => item.key)) {
        for (const source of sourcesFor(key)) await options.onEvent?.({ stage: source.stage, source: { ...source, attemptedAt: Date.now() } });
        await options.onEvent?.({ stage: 'plans', checkedKeys: [key] });
      }
      return {} as never;
    }, ...overrides });
}

const assertStoredBatch = async (batchId: string) => {
  const saved = await loadDividendDailyChecks(); assert.equal(saved.current?.batchId, batchId); assert.equal(saved.completed?.batchId, batchId);
  assert.equal(await loadDividendDailyCheckOwner(), batchId);
};

for (const sameMillisecond of [false, true]) test(`two actual-storage runners reject an old delayed initial read${sameMillisecond ? ' with identical start milliseconds' : ''}`, async t => {
  if (sameMillisecond) { const fixed = Date.now(); t.mock.method(Date, 'now', () => fixed); }
  const entered = deferred<void>(), release = deferred<void>(); let oldRefreshes = 0;
  const old = persistentRunner({ load: async () => { entered.resolve(); await release.promise; return { inputKey: 'input', planKey: 'plan', items: items() }; },
    refresh: async () => { oldRefreshes++; return {} as never; } });
  const oldTask = old.run(); await entered.promise;
  const newer = await persistentRunner().run(); assert.equal(newer.status, 'completed'); await assertStoredBatch(newer.batchId);
  release.resolve(); assert.equal((await oldTask).status, 'cancelled'); assert.equal(oldRefreshes, 0); await assertStoredBatch(newer.batchId);
  assert.equal((await stored.table('advice').get('check:owner')).sequence, 2);
});

test('an old terminal save released after a newer completion cannot replace either durable result', async () => {
  const entered = deferred<void>(), release = deferred<void>();
  const old = persistentRunner({ save: async (value, options) => { if (value.status === 'completed') { entered.resolve(); await release.promise; } return saveDividendDailyCheck(value, options); } });
  const oldTask = old.run(); await entered.promise; const newer = await persistentRunner().run(); await assertStoredBatch(newer.batchId);
  release.resolve(); assert.equal((await oldTask).status, 'cancelled'); await assertStoredBatch(newer.batchId);
});

test('an old runner cancelling after a newer completion cannot reclaim or emit late source writes', async () => {
  const entered = deferred<void>(), release = deferred<void>(); let writes = 0;
  const old = persistentRunner({ refresh: async (_progress, options = {}) => {
    entered.resolve(); await release.promise;
    await options.beforeWrite?.(); writes++; return {} as never;
  } });
  const task = old.run(); await entered.promise; const newer = await persistentRunner().run(); old.cancel();
  assert.equal((await task).status, 'cancelled'); release.resolve(); await tick(); assert.equal(writes, 0); await assertStoredBatch(newer.batchId);
});

test('an old delayed initial claim save is rejected and starts no source work after the reserved owner changes', async () => {
  const entered = deferred<void>(), release = deferred<void>(); let refreshes = 0, rejected = 0;
  const old = persistentRunner({ save: async (value, options) => {
    if (options?.claim) { entered.resolve(); await release.promise; }
    const accepted = await saveDividendDailyCheck(value, options); if (!accepted) rejected++; return accepted;
  }, refresh: async () => { refreshes++; return {} as never; } });
  const task = old.run(); await entered.promise; const newer = await persistentRunner().run(); release.resolve();
  assert.equal((await task).status, 'cancelled'); assert.equal(refreshes, 0); assert.equal(rejected, 1); await assertStoredBatch(newer.batchId);
});

test('failed old progress storage still checks the durable owner before allowing any source work', async () => {
  const entered = deferred<void>(), release = deferred<void>(); let refreshes = 0;
  const old = persistentRunner({ save: async () => { entered.resolve(); await release.promise; throw new Error('storage unavailable'); },
    refresh: async () => { refreshes++; return {} as never; } });
  const task = old.run(); await entered.promise; const newer = await persistentRunner().run(); release.resolve();
  const value = await task; assert.equal(value.status, 'cancelled'); assert.ok(value.errors.includes('storage_failed'));
  assert.equal(refreshes, 0); await assertStoredBatch(newer.batchId);
});

test('an atomic reservation failure preserves a readable local list without scheduling unowned source writes', async () => {
  const newer = await persistentRunner().run(); let refreshes = 0;
  const old = persistentRunner({ claim: async () => { throw new Error('storage unavailable'); }, refresh: async () => { refreshes++; return {} as never; } });
  const value = await old.run(); assert.equal(value.status, 'partial'); assert.ok(value.errors.includes('storage_failed'));
  assert.equal(value.items.length, 2); assert.equal(refreshes, 0); await assertStoredBatch(newer.batchId);
});

test('a stalled reservation keeps local results visible while the whole-flow deadline bounds the wait', async () => {
  const updates: DividendDailyCheck[] = []; let refreshes = 0;
  const runner = persistentRunner({ claim: async () => new Promise(() => undefined), refresh: async () => { refreshes++; return {} as never; } });
  const start = performance.now(), value = await runner.run({ timeoutMs: 15, onUpdate: update => updates.push(update) });
  assert.equal(value.status, 'timed_out'); assert.equal(value.items.length, 2); assert.equal(updates[0].items.length, 2);
  assert.ok(value.errors.includes('storage_failed')); assert.equal(refreshes, 0); assert.ok(performance.now() - start < 500);
});

test('a rejected reservation aborts a blocked local read immediately and never tries a terminal claim', async () => {
  const newer = await persistentRunner().run(); let saves = 0, refreshes = 0;
  const old = persistentRunner({ claim: async () => false, load: async () => new Promise(() => undefined),
    save: async () => { saves++; return true; }, refresh: async () => { refreshes++; return {} as never; } });
  assert.equal((await old.run()).status, 'cancelled'); assert.equal(saves, 0); assert.equal(refreshes, 0); await assertStoredBatch(newer.batchId);
});

test('direct old initial and terminal claim=true writes cannot re-reserve a newer completed owner', async () => {
  const old = await persistentRunner().run(), newer = await persistentRunner().run();
  assert.equal(await saveDividendDailyCheck({ ...old, status: 'running', revision: old.revision + 1 }, { claim: true }), false);
  assert.equal(await saveDividendDailyCheck({ ...old, status: 'cancelled', revision: old.revision + 2 }, { claim: true }), false);
  assert.equal(await saveDividendDailyCheck({ ...old, revision: old.revision + 3 }, { claim: true }), false);
  await assertStoredBatch(newer.batchId);
});

test('a delayed reservation with an older start time cannot acquire a completed newer owner', async () => {
  const newer = await persistentRunner().run();
  assert.equal(await claimDividendDailyCheckBatch(crypto.randomUUID(), newer.startedAt - 1), false); await assertStoredBatch(newer.batchId);
});

test('the same runner still merges clicks when using atomic persistent reservations', async () => {
  const entered = deferred<void>(), release = deferred<void>();
  const runner = persistentRunner({ load: async () => { entered.resolve(); await release.promise; return { inputKey: 'input', planKey: 'plan', items: items() }; } });
  const first = runner.run(); await entered.promise; assert.equal(runner.run(), first); release.resolve(); const value = await first;
  assert.equal((await stored.table('advice').get('check:owner')).sequence, 1); await assertStoredBatch(value.batchId);
});

test('current-day item counts expire at the China date boundary without changing the fingerprint', async () => {
  const h = harness(), value = await h.runner.run(), tomorrow = Date.now() + 86400000;
  assert.deepEqual(dividendDailyCheckedKeys(value.items, tomorrow), []);
  assert.equal(dividendDailyCheckIsStale(value, value.planKey, tomorrow), true);
});

for (const [name, patch] of [
  ['old', { date: '2026-10-31 10:00', priceMinor: 900 }], ['future', { date: '2026-11-02 10:00', priceMinor: 900 }],
  ['before ex-date', { date: '2026-01-01 10:00', priceMinor: 900 }], ['invalid', { date: `${asOf} 10:00`, priceMinor: -1 }],
] as const) test(`daily projection retains ${name} quote facts without promoting them to a current trigger`, () => {
  const check = dividendCheckSummary({ stock: { ...stock, buyPaused: false, quote: { ...stock.quote, ...patch } }, asOf, now,
    totalBudgetMinor: 1000000, basis: verifiedDividendBase(609000, asOf, { latestExDate: '2026-09-24' }) });
  const row = dividendDailyItem(check); assert.equal(row.trigger, 'unknown'); assert.deepEqual(row.quote, check.trigger.quote);
  assert.equal(row.quote.sessionConfirmed, false); assert.equal(row.actions.buy.status, check.actionCheck.buy.status);
});
