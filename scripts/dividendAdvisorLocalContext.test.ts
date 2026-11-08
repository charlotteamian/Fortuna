import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import test, { after, beforeEach } from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import Dexie from 'dexie';
import { defaultDividendFundPlan } from '../src/lib/dividendFundPlan.ts';
import { defaultDividendPricingMethod } from '../src/lib/dividendPricing.ts';
import { defaultDividendSelectionPrinciples, type DividendResearchSnapshot } from '../src/lib/dividendResearch.ts';
import { buildDividendExplanationFacts } from '../src/lib/dividendAdvisorExplanation.ts';
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
const { loadDividendAdvisorContext } = await import('../src/services/dividendAdvisorContextService.ts');
const { askDividendAdvisorWithActions } = await import('../src/services/dividendAdvisorService.ts');
const { closeDividendLedgerEvidence } = await import('../src/services/dividendLedgerEvidenceService.ts');
const { closeDividendResearchCache } = await import('../src/services/dividendResearchCacheService.ts');
const ledgerStore = new Dexie('FortunaDividendLedger'); ledgerStore.version(1).stores({ documents: 'url', ledgers: 'code' });
const researchStore = new Dexie('FortunaDividendResearchCache'); researchStore.version(1).stores({ results: 'id' });
const asOf = '2026-10-31', now = Date.parse(`${asOf}T03:00:00Z`);
const stock: DividendStock = { code: '000001', name: 'Synthetic bank', group: 'core', weightBps: 10000, shareMode: 'manual', manualShares: 200, lotSize: 100,
  buyPaused: true, buyLevels: [{ yieldBps: 550, portionBps: 10000, priceMinor: 996 }], sellLevels: [{ yieldBps: 480, portionBps: 10000, priceMinor: 1142 }],
  quote: { priceMinor: 900, date: '2026-10-30 10:00', fetchedAt: now - 86400000 } };
const state = async () => JSON.stringify({ main: await Promise.all(db.tables.map(async table => [table.name, await table.toArray()])),
  ledgers: await ledgerStore.table('ledgers').toArray(), documents: await ledgerStore.table('documents').toArray(), research: await researchStore.table('results').toArray() });
beforeEach(async () => {
  await db.transaction('rw', db.tables, async () => { for (const table of db.tables) await table.clear(); });
  for (const store of [ledgerStore, researchStore]) for (const table of store.tables) await table.clear();
});
after(() => { db.close(); ledgerStore.close(); researchStore.close(); closeDividendLedgerEvidence(); closeDividendResearchCache(); });

test('local chat context does not initialise an empty database, seed stocks or fetch any source', async t => {
  t.mock.method(Date, 'now', () => now);
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; throw new Error('UNEXPECTED_NETWORK'); });
  const before = await state(), context = await loadDividendAdvisorContext();
  assert.deepEqual(context.stockPlan.stocks, []); assert.deepEqual(context.fundPlan.funds, []);
  assert.equal(context.stockPlan.budgetMinor, null);
  assert.equal(await db.settings.count(), 0); assert.equal(await db.dividendStocks.count(), 0);
  assert.equal(await state(), before); assert.equal(calls, 0);
});

test('local chat keeps current stored constraints, original evidence dates and all ledger/cache contents unchanged', async t => {
  t.mock.method(Date, 'now', () => now);
  await initializeSettings();
  await db.settings.update('main', { dividendWorkbenchInitialized: true, dividendBudgetMinor: 1000000, dividendPricingMethod: defaultDividendPricingMethod() });
  await db.dividendStocks.put(stock);
  const ledger = pingAnOfficialLedger(asOf); await ledgerStore.table('ledgers').put(ledger);
  const before = await state(), context = await loadDividendAdvisorContext();
  const check = context.stockPlan.stocks[0].checkSummary;
  assert.equal(check.actionCheck.buy.status, 'blocked'); assert.deepEqual(check.actionCheck.buy.reasons, ['manual_pause']);
  assert.equal(check.trigger.buy, 'triggered'); assert.equal(context.stockPlan.stocks[0].quoteState.priorDate, true);
  assert.equal(context.stockPlan.stocks[0].shares, 200); assert.equal(context.stockPlan.budgetMinor, 1000000);
  assert.deepEqual(check.grid.buyLevels, stock.buyLevels); assert.deepEqual(check.grid.sellLevels, stock.sellLevels);
  assert.ok(check.freshness.evidenceVerifiedDates.every(date => date === '2026-10-29'));
  assert.equal(await state(), before);
});

test('unconfigured local chat loads known held, known zero and unlinked unknown fund positions consistently', async t => {
  t.mock.method(Date, 'now', () => now);
  await initializeSettings();
  const fundPlan = { ...defaultDividendFundPlan(), mode: 'swing' as const, budgetMinor: 1000000,
    funds: [{ id: 'held', code: '512890', name: 'Synthetic held fund', indexKind: 'low_volatility' as const, weightBps: 5000 },
      { id: 'zero', code: '515180', name: 'Synthetic zero fund', indexKind: 'low_volatility' as const, weightBps: 5000 },
      { id: 'unknown', name: 'Synthetic unlinked fund', indexKind: 'other' as const, weightBps: 0 }] };
  await db.settings.update('main', { dividendWorkbenchInitialized: true, dividendFundPlan: fundPlan });
  await db.accounts.put({ id: 'account', name: 'PRIVATE ACCOUNT', category: '股票/ETF', type: 'asset', currency: 'CNY', portfolio: true, cashBalance: 0, sortOrder: 0, createdAt: 1 });
  await db.holdings.put({ id: 'holding', accountId: 'account', name: 'PRIVATE HOLDING', symbol: '512890', sortOrder: 0, createdAt: 1 });
  await db.holdingTxns.put({ id: 'buy', accountId: 'account', holdingId: 'holding', date: '2026-09-01', kind: 'buy', shares: 500, price: 1, createdAt: 1 });
  const before = await state(), context = await loadDividendAdvisorContext();
  assert.deepEqual(context.fundPlan.funds.map(fund => fund.recordedShares), [500, 0, null]);
  assert.deepEqual(context.fundPlan.funds.map(fund => fund.checkSummary.actionCheck.shares), [500, 0, null]);
  assert.deepEqual(context.fundPlan.funds[1].checkSummary.actionCheck.sell.reasons, ['no_holding']);
  assert.deepEqual(context.fundPlan.funds[2].checkSummary.actionCheck.sell.reasons, ['holding_unknown']);
  assert.doesNotMatch(JSON.stringify(context), /PRIVATE ACCOUNT|PRIVATE HOLDING/);
  assert.equal(await state(), before);
});

test('unreadable research stays a specific local gap without repairing cache or discarding saved plans', async t => {
  t.mock.method(Date, 'now', () => now);
  await db.dividendStocks.put(stock);
  await researchStore.table('results').put({ id: 'latest', snapshot: null });
  const before = await state(), context = await loadDividendAdvisorContext();
  assert.equal(context.research, undefined);
  assert.deepEqual(context.stockPlan.stocks[0].checkSummary.grid.buyLevels, stock.buyLevels);
  assert.equal(context.stockPlan.stocks[0].checkSummary.eligibility.status, 'unknown');
  assert.equal(await state(), before); assert.equal(await db.settings.count(), 0);
});

const discussionSnapshot = (code = stock.code): DividendResearchSnapshot => ({ generatedAt: now - 86400000,
  principles: defaultDividendSelectionPrinciples(), indices: [], stocks: [{ code, name: `Discussion ${code}`, status: 'unknown',
    checks: [{ rule: 'roe', status: 'unknown', reason: 'missing', period: '2026-09-30' }],
    financial: { name: `Discussion ${code}`, sector: 'Synthetic', financialSector: false,
      latest: { reportDate: '2026-09-30', noticeDate: '2026-10-28', roeBps: 550, loss: false }, periods: [] },
    sources: [{ kind: 'financial', provider: 'Eastmoney', url: 'https://example.com/discussion-only-2026q3', fetchedAt: now - 86400000, asOf: '2026-10-30' }], issues: [] }] });

test('a dated discussion card keeps its own facts without replacing the saved plan research or execution checks', async t => {
  t.mock.method(Date, 'now', () => now);
  await initializeSettings(); await db.dividendStocks.put(stock);
  const annual = { reportDate: '2025-12-31', noticeDate: '2026-03-20', roeBps: 1000, roeBasis: 'annual' as const, roePeriodMonths: 12 as const, loss: false };
  const current: DividendResearchSnapshot = { generatedAt: now, principles: defaultDividendSelectionPrinciples(), indices: [],
    stocks: [{ code: stock.code, name: stock.name, status: 'pass',
      checks: [{ rule: 'roe', status: 'pass', value: 1000, threshold: 800, period: annual.reportDate }],
      financial: { name: stock.name, sector: 'Synthetic', financialSector: false, annual, latest: annual, periods: [annual] },
      sources: [{ kind: 'financial', provider: 'Eastmoney', url: 'https://example.com/current-annual', fetchedAt: now }], issues: [] }] };
  await researchStore.table('results').put({ id: 'latest', scope: 'plan', candidateInput: '', snapshot: current });
  const context = await loadDividendAdvisorContext(), contextBefore = structuredClone(context), before = await state();
  const card = discussionSnapshot(), facts = buildDividendExplanationFacts(context, 'zh', card);
  const currentFact = buildDividendExplanationFacts(context, 'zh').find(fact => fact.id === `stock:${stock.code}:financial:roe_basis`)!;
  const discussionFact = facts.find(fact => fact.id === `discussion:${stock.code}:financial:roe_basis`)!;
  assert.match(currentFact.text, /2025-12-31/); assert.match(currentFact.text, /10%/);
  assert.match(discussionFact.text, /2026-09-30/); assert.match(discussionFact.text, /5\.5%/);
  assert.doesNotMatch(discussionFact.text, /2025-12-31|10%/);
  assert.ok(!facts.some(fact => fact.id.startsWith(`stock:${stock.code}:`)), 'the discussion manifest must not merge another snapshot into its own facts');
  assert.match(facts.find(fact => fact.id === `discussion:${stock.code}:check:roe`)!.text, /2026-09-30/);
  assert.match(facts.find(fact => fact.id === `discussion:${stock.code}:snapshot`)!.text, /2026-10-30/);
  assert.match(facts.find(fact => fact.id === `discussion:${stock.code}:source:0`)!.text, /discussion-only-2026q3/);
  const result = await askDividendAdvisorWithActions(null, context, '根据讨论资料解释ROE为什么待核实', [], { explanationResearch: card });
  assert.deepEqual(result.actions, []); assert.equal(result.explanationStatus, 'unconfigured');
  assert.deepEqual(context, contextBefore); assert.equal(await state(), before);
  assert.equal(context.stockPlan.stocks[0].checkSummary.actionCheck.buy.status, 'blocked');
});

test('candidate discussion facts do not add holdings, saved plans or confirmable actions', async t => {
  t.mock.method(Date, 'now', () => now);
  await db.dividendStocks.put(stock);
  const context = await loadDividendAdvisorContext(), contextBefore = structuredClone(context), before = await state();
  const card = discussionSnapshot('600036'), facts = buildDividendExplanationFacts(context, 'zh', card);
  assert.ok(facts.some(fact => fact.id === 'discussion:600036:check:roe'));
  assert.ok(facts.some(fact => fact.id === 'discussion:600036:financial:roe_basis' && /2026-09-30/.test(fact.text)));
  assert.ok(!facts.some(fact => fact.id === 'stock:600036:state'));
  const result = await askDividendAdvisorWithActions(null, context, '重新生成600036的价格计划并解释ROE', [], { explanationResearch: card });
  assert.deepEqual(result.actions, []);
  assert.equal(context.stockPlan.stocks.some(row => row.code === '600036'), false);
  assert.deepEqual(context, contextBefore); assert.equal(await state(), before);
  assert.equal(await db.dividendStocks.get('600036'), undefined);
});
