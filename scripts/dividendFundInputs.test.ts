import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import test, { after, beforeEach } from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { buildDividendAdvisorContext, dividendAdvisorReadableSnapshot } from '../src/lib/dividendAdvisor.ts';
import { defaultDividendFundPlan, type DividendFund, type DividendFundPlan } from '../src/lib/dividendFundPlan.ts';
import { dividendFundCheckSummary } from '../src/lib/dividendCheckSummary.ts';

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
const { db, initializeSettings, exportData } = await import('../src/db.ts');
const { loadDividendFundPositions } = await import('../src/services/dividendAdvisorContextService.ts');
const { loadDividendCheckSummaries } = await import('../src/services/dividendCheckSummaryService.ts');
const { closeDividendLedgerEvidence } = await import('../src/services/dividendLedgerEvidenceService.ts');
const { closeDividendResearchCache } = await import('../src/services/dividendResearchCacheService.ts');
const asOf = '2026-10-30', now = Date.parse(`${asOf}T14:01:00+08:00`);
const fund: DividendFund = { id: 'synthetic-fund', code: '512890', name: 'Synthetic ETF', indexKind: 'low_volatility', weightBps: 10000,
  reference: { highMicros: 1000000, indexYieldBps: 500, asOf },
  quote: { priceMicros: 1100000, date: `${asOf} 14:00:00`, fetchedAt: now } };
const plan: DividendFundPlan = { ...defaultDividendFundPlan(), budgetMinor: 1000000, mode: 'swing', funds: [fund] };
const workbench = (fundPlan = plan) => ({ stocks: [], budgetMinor: 0, budgetConfigured: false, positions: new Map(), fundPlan });

beforeEach(async () => {
  await db.transaction('rw', db.tables, async () => { for (const table of db.tables) await table.clear(); });
  await initializeSettings();
  await db.accounts.put({ id: 'synthetic-account', name: 'Synthetic account', category: '股票/ETF', type: 'asset', currency: 'CNY', portfolio: true,
    cashBalance: 0, sortOrder: 0, createdAt: 1 });
  await db.holdings.put({ id: 'synthetic-holding', accountId: 'synthetic-account', name: fund.name, symbol: 'SH.512890', lastPrice: 1.1, sortOrder: 0, createdAt: 1 });
});
after(() => { db.close(); closeDividendLedgerEvidence(); closeDividendResearchCache(); });

for (const shares of [500, 0]) {
  test(`loaded ${shares}-unit fund has identical shared home, management and AI action inputs without writes`, async t => {
    t.mock.method(Date, 'now', () => now);
    if (shares) await db.holdingTxns.put({ id: 'synthetic-buy', accountId: 'synthetic-account', holdingId: 'synthetic-holding',
      kind: 'buy', shares, price: 1, date: '2026-09-01', createdAt: 1 });
    const before = await exportData();
    const fundPositions = await loadDividendFundPositions(plan.funds);
    assert.equal(fundPositions.get(fund.code!), shares);
    const checks = await loadDividendCheckSummaries(workbench(), { asOf, now, fundPositions });
    // Both page components receive checks.funds; no local shares default or
    // independent recalculation is needed on the management route.
    const homeAndManagement = checks.funds[fund.id];
    const context = buildDividendAdvisorContext({ ...workbench(), strategy: 'funds', fundPositions, checkSummaries: checks }, now);
    const ai = context.fundPlan.funds[0];
    assert.equal(homeAndManagement.actionCheck.shares, shares);
    assert.equal(ai.recordedShares, shares);
    assert.deepEqual(ai.checkSummary.actionCheck, homeAndManagement.actionCheck);
    assert.deepEqual(ai.ruleCheck, homeAndManagement.fundPlan.entry);
    assert.equal(homeAndManagement.trigger.sell, 'triggered');
    assert.equal(homeAndManagement.actionCheck.sell.status, shares ? 'review' : 'blocked');
    assert.deepEqual(homeAndManagement.actionCheck.sell.reasons, [shares ? 'execution_session_unverified' : 'no_holding']);
    assert.equal(await exportData(), before);
  });
}

test('a successful full ledger read identifies absent coded holdings as known zero', async t => {
  t.mock.method(Date, 'now', () => now);
  await db.holdings.clear();
  const positions = await loadDividendFundPositions(plan.funds);
  assert.equal(positions.has(fund.code!), true);
  assert.equal(positions.get(fund.code!), 0);
  const checks = await loadDividendCheckSummaries(workbench(), { asOf, now, fundPositions: positions });
  assert.equal(checks.funds[fund.id].actionCheck.shares, 0);
  assert.equal(checks.funds[fund.id].actionCheck.sell.status, 'blocked');
  assert.deepEqual(checks.funds[fund.id].actionCheck.sell.reasons, ['no_holding']);
});

test('a failed holdings read cannot return an apparently loaded zero position', async t => {
  t.mock.method(db.holdings, 'toArray', async () => { throw new Error('SYNTHETIC_HOLDING_READ_FAILED'); });
  await assert.rejects(loadDividendFundPositions(plan.funds), /SYNTHETIC_HOLDING_READ_FAILED/);
  const check = dividendFundCheckSummary({ plan, fund, asOf, now });
  assert.equal(check.actionCheck.shares, null);
  assert.equal(check.actionCheck.sell.status, 'unknown');
  assert.deepEqual(check.actionCheck.sell.reasons, ['holding_unknown']);
});

test('unloaded or unlinked holdings stay unknown across shared checks and AI instead of becoming zero', async () => {
  for (const missingCode of [false, true]) {
    const unknownFund = { ...fund, ...(missingCode ? { code: undefined, quote: undefined } : {}) };
    const unknownPlan = { ...plan, funds: [unknownFund] };
    const input = workbench(unknownPlan);
    const checks = await loadDividendCheckSummaries(input, { asOf, now });
    const check = checks.funds[fund.id];
    assert.equal(check.actionCheck.shares, null);
    assert.equal(check.actionCheck.sell.status, 'unknown');
    assert.deepEqual(check.actionCheck.sell.reasons, ['holding_unknown']);
    assert.equal(check.actionCheck.buy.status, 'unknown');
    assert.deepEqual(check.actionCheck.buy.reasons, ['holding_unknown']);
    assert.equal(check.trigger.sell, missingCode ? 'unknown' : 'triggered', 'holding knowledge never changes the observed price event');
    const context = buildDividendAdvisorContext({ ...input, strategy: 'funds', checkSummaries: checks }, now);
    assert.equal(context.fundPlan.funds[0].recordedShares, null);
    assert.deepEqual(context.fundPlan.funds[0].checkSummary.actionCheck, check.actionCheck);
    assert.match(JSON.stringify(dividendAdvisorReadableSnapshot(context)), /"Recorded holding in units":null/);
  }
});

test('a shared fund summary remains authoritative when a separate AI positions input is absent', () => {
  const shared = dividendFundCheckSummary({ plan, fund, shares: 500, asOf, now });
  const context = buildDividendAdvisorContext({ ...workbench(), strategy: 'funds', checkSummaries: { stocks: {}, funds: { [fund.id]: shared } } }, now);
  assert.equal(context.fundPlan.funds[0].recordedShares, 500);
  assert.equal(context.fundPlan.funds[0].checkSummary.actionCheck.sell.status, 'review');
});
