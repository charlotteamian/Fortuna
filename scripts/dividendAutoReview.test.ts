import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import test, { after, beforeEach } from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import Dexie from 'dexie';
import { calculateDividendPricing, defaultDividendPricingMethod, DIVIDEND_PRICING_CALCULATION_VERSION } from '../src/lib/dividendPricing.ts';
import { dividendPricingPlan, dividendPricingProvenance } from '../src/lib/dividendPricingPlan.ts';
import { defaultDividendSelectionPrinciples, type DividendResearchSnapshot, type DividendStockResearch } from '../src/lib/dividendResearch.ts';
import type { DividendStock } from '../src/lib/dividendWorkbench.ts';
import { pingAnOfficialLedger } from './helpers/dividendPricingFixture.ts';

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

const { db, initializeSettings } = await import('../src/db.ts');
const { closeDividendLedgerEvidence } = await import('../src/services/dividendLedgerEvidenceService.ts');
const { closeDividendResearchCache, saveDividendResearchCache } = await import('../src/services/dividendResearchCacheService.ts');
const {
  autoReviewPendingDividendStocks,
  classifyDividendStockReviewNeed,
  resetDividendAutoReviewSession,
} = await import('../src/services/dividendAutoReviewService.ts');

const ledgerStore = new Dexie('FortunaDividendLedger');
ledgerStore.version(1).stores({ documents: 'url', ledgers: 'code' });
const cacheStore = new Dexie('FortunaDividendResearchCache');
cacheStore.version(1).stores({ results: 'id' });

const asOf = '2026-10-30';
const priorDay = '2026-10-29';
const now = Date.parse(`${asOf}T14:05:00+08:00`);
const priorTime = Date.parse(`${priorDay}T14:05:00+08:00`);
const method = defaultDividendPricingMethod();
const principles = defaultDividendSelectionPrinciples();

function ledgerFor(code: string, day = asOf) {
  const base = pingAnOfficialLedger(day);
  return { ...base, code, events: base.events.map(event => ({ ...event, code })) };
}

function pricingFor(code: string, name: string, day = asOf, priceMinor = 1100) {
  const ledger = ledgerFor(code, day);
  return calculateDividendPricing({
    code,
    name,
    asOf: day,
    ledger,
    method,
    financialSector: false,
    annuals: [{ year: 2025, reportDate: '2025-12-31', epsMicros: 2030000, payoutBps: 3000, dividendMicros: 609000, fcfCoverageBps: 20000 }],
    priceMinor,
    priceDate: `${day} 14:00`,
  });
}

function healthyResearchRow(code: string, name: string, day = asOf): DividendStockResearch {
  const pricing = pricingFor(code, name, day);
  return {
    code,
    name,
    status: 'pass',
    financial: {
      name,
      sector: '家电',
      financialSector: false,
      latest: {
        reportDate: '2026-09-30',
        noticeDate: '2026-10-25',
        revenueGrowthBps: 500,
        profitGrowthBps: 600,
        roeBps: 1200,
        debtAssetBps: 4500,
        cashProfitBps: 11000,
        epsMicros: 1500000,
        loss: false,
      },
      annual: {
        reportDate: '2025-12-31',
        noticeDate: '2026-03-28',
        revenueGrowthBps: 600,
        profitGrowthBps: 700,
        roeBps: 1500,
        debtAssetBps: 4500,
        cashProfitBps: 11000,
        epsMicros: 2030000,
        loss: false,
      },
      periods: [],
    },
    distributions: {
      asOf: day,
      dpsMicros: 609000,
      consecutiveYears: 8,
      latestCompletedYear: 2025,
      annualDpsMicros: { '2025': 609000 },
    },
    checks: [
      { rule: 'yield', status: 'pass', value: 550, threshold: 400 },
      { rule: 'roe', status: 'pass', value: 1500, threshold: 800, period: '2025-12-31' },
      { rule: 'revenueGrowth', status: 'pass', value: 500, threshold: 0, period: '2026-09-30' },
      { rule: 'profitGrowth', status: 'pass', value: 600, threshold: 0, period: '2026-09-30' },
    ],
    sources: [{ kind: 'financial', provider: 'Eastmoney', url: `https://example.test/fin/${code}`, fetchedAt: now }],
    issues: [],
    pricing,
  };
}

function makeSavedStock(code: string, name: string, overrides: Partial<DividendStock> = {}): DividendStock {
  const pricing = pricingFor(code, name, asOf);
  const plan = dividendPricingPlan(pricing)!;
  return {
    code,
    name,
    group: 'core',
    weightBps: 5000,
    shareMode: 'manual',
    manualShares: 200,
    lotSize: 100,
    ...structuredClone(plan),
    gridProvenance: dividendPricingProvenance(pricing, now - 60_000),
    quote: { priceMinor: 1100, date: `${asOf} 14:00:00`, fetchedAt: now },
    dividend: { schemaVersion: 2, asOf, dpsMicros: 609000, events: [], fetchedAt: now } as unknown as DividendStock['dividend'],
    ...overrides,
  };
}

beforeEach(async () => {
  resetDividendAutoReviewSession();
  await db.transaction('rw', db.tables, async () => {
    for (const table of db.tables) await table.clear();
  });
  await ledgerStore.table('ledgers').clear();
  await ledgerStore.table('documents').clear();
  await cacheStore.table('results').clear();
  await initializeSettings();
  await db.settings.update('main', {
    dividendPricingMethod: method,
    dividendSelectionPrinciples: principles,
    dividendBudgetMinor: 4_000_000,
    dividendWorkbenchInitialized: true,
  });
});

after(() => {
  resetDividendAutoReviewSession();
  db.close();
  ledgerStore.close();
  cacheStore.close();
  closeDividendLedgerEvidence();
  closeDividendResearchCache();
});

test('auto-review detects pending stocks, refreshes them automatically, syncs identical provenance and clears review state', async () => {
  // Stock has stale quote, stale dividend, old parameterVersion provenance (same 8 prices), and no research cache
  const stock = makeSavedStock('000333', '美的集团', {
    quote: { priceMinor: 1100, date: `${priorDay} 15:00:00`, fetchedAt: priorTime },
    dividend: { schemaVersion: 2, asOf: priorDay, dpsMicros: 609000, events: [], fetchedAt: priorTime } as unknown as DividendStock['dividend'],
    gridProvenance: {
      generatedAt: priorTime,
      grossDpsMicros: 609000,
      taxBps: 1000,
      parameterVersion: 4, // outdated metadata even though saved prices already match
      basisKind: 'recent_batches',
    },
  });
  await db.dividendStocks.put(stock);
  const originalBuyPrices = stock.buyLevels!.map(level => level.priceMinor);

  let quoteCalls = 0;
  let stockRefreshCalls = 0;
  let researchCalls = 0;
  const phases: string[] = [];

  const result = await autoReviewPendingDividendStocks({
    now: () => now,
    onProgress: progress => phases.push(progress.phase),
    deps: {
      refreshQuotes: async ({ codes = [] }) => {
        quoteCalls++;
        for (const code of codes) {
          await db.dividendStocks.update(code, {
            quote: { priceMinor: 1100, date: `${asOf} 14:00:00`, fetchedAt: now },
            quoteFailedAt: undefined,
          });
        }
        return { done: codes.length, failed: 0, fetchedAt: now, codes, failedCodes: [], quotes: new Map() };
      },
      refreshStock: async code => {
        stockRefreshCalls++;
        await db.dividendStocks.update(code, {
          dividend: { schemaVersion: 2, asOf, dpsMicros: 609000, events: [], fetchedAt: now } as unknown as DividendStock['dividend'],
          dividendFailedAt: undefined,
        });
        await ledgerStore.table('ledgers').put(ledgerFor(code, asOf));
        return true;
      },
      fetchResearch: async (stocks, usedPrinciples, options) => {
        researchCalls++;
        const rows = stocks.map(row => healthyResearchRow(row.code, row.name, asOf));
        for (const row of rows) {
          await ledgerStore.table('ledgers').put(ledgerFor(row.code, asOf));
          const single: DividendResearchSnapshot = {
            generatedAt: now,
            principles: usedPrinciples,
            pricingMethod: options?.pricingMethod ?? method,
            indices: [],
            stocks: [row],
          };
          await options?.onStock?.(single);
        }
        return { generatedAt: now, principles: usedPrinciples, pricingMethod: options?.pricingMethod ?? method, indices: [], stocks: rows };
      },
    },
  });

  assert.equal(result.status, 'completed');
  assert.deepEqual(result.refreshedCodes, ['000333']);
  assert.deepEqual(result.resolvedCodes, ['000333']);
  assert.deepEqual(result.failed, []);
  assert.equal(quoteCalls, 1);
  assert.equal(stockRefreshCalls, 1);
  assert.equal(researchCalls, 1);
  assert.ok(phases.includes('detecting') && phases.includes('research') && phases.includes('finalizing'));

  // Grid status cleared automatically from saved_unverified -> verified, with ZERO price changes
  assert.equal(result.summaries['000333'].grid.status, 'verified');
  assert.equal(result.summaries['000333'].eligibility.status, 'pass');
  const persisted = await db.dividendStocks.get('000333');
  assert.deepEqual(persisted?.buyLevels?.map(level => level.priceMinor), originalBuyPrices);
  assert.equal(persisted?.gridProvenance?.parameterVersion, DIVIDEND_PRICING_CALCULATION_VERSION);

  // Second automatic call immediately recognizes everything is up to date (zero extra network calls)
  const second = await autoReviewPendingDividendStocks({
    now: () => now + 1000,
    deps: {
      refreshQuotes: async () => { quoteCalls++; throw new Error('should not run'); },
      refreshStock: async () => { stockRefreshCalls++; throw new Error('should not run'); },
      fetchResearch: async () => { researchCalls++; throw new Error('should not run'); },
    },
  });
  assert.equal(second.status, 'up_to_date');
  assert.deepEqual(second.refreshedCodes, []);
  assert.equal(quoteCalls, 1);
  assert.equal(researchCalls, 1);
});

test('auto-review never overwrites saved prices when the newly calculated grid differs', async () => {
  const stock = makeSavedStock('600900', '长江电力');
  // Intentionally set a different saved buy price and outdated provenance
  stock.buyLevels![0].priceMinor = 900;
  stock.gridProvenance = { ...stock.gridProvenance!, parameterVersion: 4 };
  await db.dividendStocks.put(stock);

  const result = await autoReviewPendingDividendStocks({
    now: () => now,
    deps: {
      refreshQuotes: async ({ codes = [] }) => ({ done: codes.length, failed: 0, fetchedAt: now, codes, failedCodes: [], quotes: new Map() }),
      refreshStock: async () => true,
      fetchResearch: async (stocks, usedPrinciples, options) => {
        const rows = stocks.map(row => healthyResearchRow(row.code, row.name, asOf));
        await ledgerStore.table('ledgers').put(ledgerFor('600900', asOf));
        return { generatedAt: now, principles: usedPrinciples, pricingMethod: options?.pricingMethod ?? method, indices: [], stocks: rows };
      },
    },
  });

  const persisted = await db.dividendStocks.get('600900');
  assert.equal(persisted?.buyLevels?.[0].priceMinor, 900, 'user saved price must never be silently modified');
  assert.equal(persisted?.gridProvenance?.parameterVersion, 4, 'provenance must not be synced when prices differ');
  assert.equal(result.summaries['600900'].grid.status, 'saved_unverified');
});

test('throttling prevents infinite retry loops on source failures while force retry re-attempts immediately', async () => {
  await db.dividendStocks.put(makeSavedStock('600036', '招商银行', {
    quote: undefined,
    dividend: undefined,
  }));

  let researchAttempts = 0;
  let shouldFail = true;
  const makeDeps = () => ({
    refreshQuotes: async ({ codes = [] }: { codes?: string[] }) => {
      if (shouldFail) return { done: codes.length, failed: codes.length, fetchedAt: now, codes, failedCodes: codes, quotes: new Map() };
      for (const code of codes) {
        await db.dividendStocks.update(code, { quote: { priceMinor: 1100, date: `${asOf} 14:00:00`, fetchedAt: now }, quoteFailedAt: undefined });
      }
      return { done: codes.length, failed: 0, fetchedAt: now, codes, failedCodes: [], quotes: new Map() };
    },
    refreshStock: async (code: string) => {
      if (shouldFail) return false;
      await db.dividendStocks.update(code, {
        dividend: { schemaVersion: 2, asOf, dpsMicros: 609000, events: [], fetchedAt: now } as unknown as DividendStock['dividend'],
        dividendFailedAt: undefined,
      });
      await ledgerStore.table('ledgers').put(ledgerFor(code, asOf));
      return true;
    },
    fetchResearch: async (stocks: Pick<DividendStock, 'code' | 'name'>[], usedPrinciples: typeof principles, options?: { pricingMethod?: typeof method }) => {
      researchAttempts++;
      if (shouldFail) {
        return {
          generatedAt: now,
          principles: usedPrinciples,
          pricingMethod: options?.pricingMethod ?? method,
          indices: [],
          stocks: stocks.map(row => ({
            code: row.code,
            name: row.name,
            status: 'unknown' as const,
            checks: [],
            sources: [],
            issues: [{ kind: 'dividend' as const, reason: 'request_failed' as const }],
          })),
        };
      }
      await ledgerStore.table('ledgers').put(ledgerFor('600036', asOf));
      return {
        generatedAt: now,
        principles: usedPrinciples,
        pricingMethod: options?.pricingMethod ?? method,
        indices: [],
        stocks: stocks.map(row => healthyResearchRow(row.code, row.name, asOf)),
      };
    },
  });

  // First run fails cleanly and surfaces concise deduplicated reasons
  const first = await autoReviewPendingDividendStocks({ now: () => now, failureCooldownMs: 60_000, deps: makeDeps() });
  assert.equal(first.status, 'partial');
  assert.equal(first.failed.length, 1);
  assert.equal(first.failed[0].code, '600036');
  assert.ok(first.failed[0].reasons.length > 0);
  assert.equal(researchAttempts, 1);

  // Second automatic run within cooldown MUST NOT re-fetch (no retry loop!)
  const throttled = await autoReviewPendingDividendStocks({ now: () => now + 10_000, failureCooldownMs: 60_000, deps: makeDeps() });
  assert.equal(throttled.status, 'partial');
  assert.deepEqual(throttled.refreshedCodes, []);
  assert.equal(throttled.failed.length, 1);
  assert.equal(researchAttempts, 1);

  // Explicit manual retry (force: true) bypasses cooldown and succeeds once network recovers
  shouldFail = false;
  const retried = await autoReviewPendingDividendStocks({ force: true, now: () => now + 15_000, failureCooldownMs: 60_000, deps: makeDeps() });
  assert.equal(retried.status, 'completed');
  assert.deepEqual(retried.resolvedCodes, ['600036']);
  assert.deepEqual(retried.failed, []);
  assert.equal(researchAttempts, 2);
});

test('non-fetchable attention items (e.g. bank off-feed specialist checks) do not trigger repeat fetches, and free-text notes alone do not flag pending review', async () => {
  const bank = makeSavedStock('600036', '招商银行');
  await db.dividendStocks.put(bank);
  await ledgerStore.table('ledgers').put(ledgerFor('600036', asOf));

  // Verify free-text principles.notes alone does not make an up-to-date stock need refresh
  const saved = await saveDividendResearchCache({
    snapshot: { generatedAt: now, principles: { ...principles, notes: '注意净息差变化' }, pricingMethod: method, indices: [], stocks: [healthyResearchRow('600036', '招商银行', asOf)] },
    scope: 'plan',
    candidateInput: '',
  });
  const need = classifyDividendStockReviewNeed({
    stock: bank,
    summary: {
      eligibility: { status: 'unknown', reasons: ['additional_rules_unverified'], checks: healthyResearchRow('600036', '招商银行', asOf).checks },
      grid: { status: 'verified' },
      trigger: { quote: { status: 'current' } },
      risk: { blocking: [], attention: [], evidenceInsufficient: [{ id: 'additional_rules_unverified', reason: 'additional_rules_unverified', sources: [], impact: 'information', autoRepair: false, unresolvedAction: 'review' }] },
    } as never,
    basis: { asOf, verified: true, dpsMicros: 609000, evidenceStatus: 'current', evidenceIssues: [] },
    savedResearch: saved,
    pricingMethod: method,
    asOf,
  });
  assert.deepEqual(need.reasons, []);

  // Now simulate bank specialist check returning unknown even after a successful live refresh
  await cacheStore.table('results').clear();
  let calls = 0;
  const bankDeps = {
    refreshQuotes: async ({ codes = [] }: { codes?: string[] }) => ({ done: codes.length, failed: 0, fetchedAt: now, codes, failedCodes: [], quotes: new Map() }),
    refreshStock: async () => true,
    fetchResearch: async (stocks: Pick<DividendStock, 'code' | 'name'>[], usedPrinciples: typeof principles, options?: { pricingMethod?: typeof method }) => {
      calls++;
      const row = healthyResearchRow(stocks[0].code, stocks[0].name, asOf);
      row.financial = {
        ...row.financial!,
        sector: '银行',
        financialSector: true,
        sectorReview: {
          sector: 'bank',
          status: 'unknown',
          asOf: '2026-09-30',
          metrics: [],
          missing: ['specialMentionLoans'],
          basis: 'dividend_screen',
          sourceUrl: 'https://example.test/bank',
          policySourceUrls: [],
        },
      };
      return { generatedAt: now, principles: usedPrinciples, pricingMethod: options?.pricingMethod ?? method, indices: [], stocks: [row] };
    },
  };
  const first = await autoReviewPendingDividendStocks({ now: () => now, deps: bankDeps });
  assert.equal(first.status, 'completed');
  assert.deepEqual(first.failed, []);
  assert.equal(first.attention.length, 1);
  assert.equal(calls, 1);

  // Re-entering on the same day with unchanged settings skips re-fetching
  const second = await autoReviewPendingDividendStocks({ now: () => now + 5000, deps: bankDeps });
  assert.equal(second.status, 'up_to_date');
  assert.equal(calls, 1);

  // Changing pricing method invalidates settings fingerprint and automatically refreshes once
  await db.settings.update('main', { dividendPricingMethod: { ...method, holdingPeriod: 'over_year' } });
  const afterMethodChange = await autoReviewPendingDividendStocks({ now: () => now + 10_000, deps: bankDeps });
  assert.deepEqual(afterMethodChange.refreshedCodes, ['600036']);
  assert.equal(calls, 2);
});

test('concurrent calls coalesce into one in-flight run and AbortSignal cancels cleanly', async () => {
  await db.dividendStocks.put(makeSavedStock('000858', '五粮液', { quote: undefined }));
  let releaseResearch!: () => void;
  let fetchCount = 0;

  const deps = {
    refreshQuotes: async ({ codes = [] }: { codes?: string[] }) => {
      for (const code of codes) {
        await db.dividendStocks.update(code, { quote: { priceMinor: 1100, date: `${asOf} 14:00:00`, fetchedAt: now }, quoteFailedAt: undefined });
      }
      return { done: codes.length, failed: 0, fetchedAt: now, codes, failedCodes: [], quotes: new Map() };
    },
    refreshStock: async () => true,
    fetchResearch: async (stocks: Pick<DividendStock, 'code' | 'name'>[], usedPrinciples: typeof principles, options?: { pricingMethod?: typeof method }) => {
      fetchCount++;
      await new Promise<void>(resolve => { releaseResearch = resolve; });
      await ledgerStore.table('ledgers').put(ledgerFor('000858', asOf));
      return {
        generatedAt: now,
        principles: usedPrinciples,
        pricingMethod: options?.pricingMethod ?? method,
        indices: [],
        stocks: stocks.map(row => healthyResearchRow(row.code, row.name, asOf)),
      };
    },
  };

  const first = autoReviewPendingDividendStocks({ now: () => now, deps });
  const second = autoReviewPendingDividendStocks({ now: () => now, deps });
  // Let detection & quote phase settle into fetchResearch
  for (let i = 0; i < 10 && !releaseResearch; i++) {
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.ok(releaseResearch, 'expected shared fetchResearch to start');
  releaseResearch();
  const [res1, res2] = await Promise.all([first, second]);
  assert.equal(fetchCount, 1, 'concurrent callers must share one network run');
  assert.equal(res1.status, 'completed');
  assert.equal(res2.status, 'completed');

  // Pre-aborted signal resolves immediately to aborted
  const controller = new AbortController();
  controller.abort();
  const aborted = await autoReviewPendingDividendStocks({ signal: controller.signal, now: () => now });
  assert.equal(aborted.status, 'aborted');
});
