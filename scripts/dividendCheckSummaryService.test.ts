import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import test, { after, beforeEach } from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import Dexie from 'dexie';
import type { DividendStock } from '../src/lib/dividendWorkbench.ts';
import { defaultDividendPricingMethod } from '../src/lib/dividendPricing.ts';
import { defaultDividendFundPlan } from '../src/lib/dividendFundPlan.ts';
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
const { db, initializeSettings, exportData } = await import('../src/db.ts');
const { loadDividendCheckSummaries } = await import('../src/services/dividendCheckSummaryService.ts');
const { closeDividendLedgerEvidence } = await import('../src/services/dividendLedgerEvidenceService.ts');
const { closeDividendResearchCache } = await import('../src/services/dividendResearchCacheService.ts');
const ledgerStore = new Dexie('FortunaDividendLedger'); ledgerStore.version(1).stores({ documents: 'url', ledgers: 'code' });
const cacheStore = new Dexie('FortunaDividendResearchCache'); cacheStore.version(1).stores({ results: 'id' });
const asOf = '2026-10-30', now = Date.parse(`${asOf}T14:01:00+08:00`);
const savedStock = (code = '000001'): DividendStock => ({ code, name: `Synthetic ${code}`, group: 'core', weightBps: 5000,
  shareMode: 'manual', manualShares: 200, lotSize: 100, manualDpsMicros: 609000, buyPaused: true,
  quote: { priceMinor: 800, date: `${asOf} 14:00:00`, fetchedAt: now },
  buyLevels: [996, 953, 913, 843].map((priceMinor, index) => ({ priceMinor, yieldBps: [550, 575, 600, 650][index], portionBps: 2500 })),
  sellLevels: [1142, 1218, 1305, 1371].map((priceMinor, index) => ({ priceMinor, yieldBps: [480, 450, 420, 400][index], portionBps: 2500 })),
  gridProvenance: { generatedAt: now - 3600000, grossDpsMicros: 609000, taxBps: 1000, parameterVersion: 5, basisKind: 'recent_batches' },
});
const workbench = async () => ({ stocks: await db.dividendStocks.toArray(), budgetMinor: 4000000, budgetConfigured: true,
  positions: new Map(), fundPlan: defaultDividendFundPlan() });
beforeEach(async () => {
  await db.transaction('rw', db.tables, async () => { for (const table of db.tables) await table.clear(); });
  await ledgerStore.table('ledgers').clear(); await ledgerStore.table('documents').clear(); await cacheStore.table('results').clear();
  await initializeSettings();
  await db.settings.update('main', { dividendPricingMethod: defaultDividendPricingMethod(), dividendBudgetMinor: 4000000, dividendWorkbenchInitialized: true });
  await db.dividendStocks.put(savedStock());
  await db.accounts.put({ id: 'synthetic-account', name: 'Synthetic account', category: '股票/ETF', type: 'asset', currency: 'CNY', portfolio: true, cashBalance: 12345, sortOrder: 0, createdAt: 1 });
  await db.holdings.put({ id: 'synthetic-holding', accountId: 'synthetic-account', name: 'Synthetic bank', symbol: '000001', lastPrice: 8, sortOrder: 0, createdAt: 1 });
  await db.holdingTxns.put({ id: 'synthetic-buy', accountId: 'synthetic-account', holdingId: 'synthetic-holding', date: '2026-09-01', kind: 'buy', shares: 200, price: 9, createdAt: 1 });
});
after(() => { db.close(); ledgerStore.close(); cacheStore.close(); closeDividendLedgerEvidence(); closeDividendResearchCache(); });

test('summary reads preserve the complete exported ledger and original source verification dates byte for byte', async t => {
  t.mock.method(Date, 'now', () => now);
  const ledger = pingAnOfficialLedger(asOf); await ledgerStore.table('ledgers').put(ledger);
  const before = await exportData(), sourceBefore = await ledgerStore.table('ledgers').get('000001');
  const result = await loadDividendCheckSummaries(await workbench(), { asOf, now });
  assert.equal(result.stocks['000001'].grid.status, 'verified');
  assert.deepEqual(result.stocks['000001'].grid.buyLevels.map(level => level.priceMinor), [996, 953, 913, 843]);
  assert.equal(result.stocks['000001'].actionCheck.buy.status, 'blocked');
  assert.ok(result.stocks['000001'].actionCheck.buy.reasons.includes('manual_pause'));
  assert.deepEqual(await ledgerStore.table('ledgers').get('000001'), sourceBefore);
  assert.equal(await exportData(), before, 'all accounts, holdings, transactions, settings, budget, pause and saved levels are unchanged');
  assert.ok(result.stocks['000001'].freshness.evidenceVerifiedDates.every(date => date === '2026-10-29'));
});

test('current user tax settings reach the summary and mark a saved different-tax grid for review without rewriting prices', async () => {
  await ledgerStore.table('ledgers').put(pingAnOfficialLedger(asOf));
  await db.settings.update('main', { dividendPricingMethod: { ...defaultDividendPricingMethod(), holdingPeriod: 'up_to_month' } });
  const original = await db.dividendStocks.get('000001');
  const result = (await loadDividendCheckSummaries(await workbench(), { asOf, now })).stocks['000001'];
  assert.equal(result.grid.status, 'saved_unverified'); assert.ok(result.grid.reasons.includes('tax_changed'));
  assert.equal(result.grid.taxBps, 1000, 'the saved plan keeps its original tax basis');
  assert.deepEqual(await db.dividendStocks.get('000001'), original);
});

test('one malformed ledger cannot blank other stock summaries or bypass missing evidence', async () => {
  await db.dividendStocks.put(savedStock('600036'));
  await ledgerStore.table('ledgers').bulkPut([pingAnOfficialLedger(asOf), { code: '600036', asOf, complete: true, events: null, issues: [], sourceUrls: [] }]);
  const result = await loadDividendCheckSummaries(await workbench(), { asOf, now });
  assert.equal(result.stocks['000001'].grid.status, 'verified');
  assert.equal(result.stocks['600036'].grid.status, 'saved_unverified');
  assert.notEqual(result.stocks['600036'].actionCheck.buy.status, 'confirmation_candidate');
  assert.ok(result.stocks['600036'].risk.evidenceInsufficient.length > 0);
});

test('a malformed research cache leaves independent stock evidence and read-only ledger contents available', async t => {
  t.mock.method(Date, 'now', () => now);
  await ledgerStore.table('ledgers').put(pingAnOfficialLedger(asOf));
  await cacheStore.table('results').put({ id: 'latest', snapshot: null });
  const before = await exportData();
  const result = await loadDividendCheckSummaries(await workbench(), { asOf, now });
  assert.equal(result.stocks['000001'].grid.status, 'verified');
  assert.equal(result.stocks['000001'].eligibility.status, 'unknown');
  assert.ok(result.stocks['000001'].risk.evidenceInsufficient.length > 0);
  assert.equal(await exportData(), before);
});

test('a stock without an explicit saved grid cannot create the old seven tiers from a manual dividend assumption', async () => {
  const stock: DividendStock = { code: '000333', name: 'Synthetic without a grid', group: 'watch', weightBps: 0,
    shareMode: 'manual', manualShares: 0, lotSize: 100, manualDpsMicros: 609000, quote: { priceMinor: 800, date: `${asOf} 14:00:00`, fetchedAt: now } };
  await db.dividendStocks.put(stock);
  const result = (await loadDividendCheckSummaries(await workbench(), { asOf, now })).stocks['000333'];
  assert.equal(result.kind, 'stock');
  assert.equal(result.grid.status, 'unavailable'); assert.deepEqual(result.grid.buyLevels, []); assert.deepEqual(result.grid.sellLevels, []);
  if (result.kind === 'stock') { assert.deepEqual(result.displayPlan.buy, []); assert.deepEqual(result.displayPlan.sell, []); }
  assert.equal(result.trigger.status, 'unknown');
  assert.notEqual(result.actionCheck.buy.status, 'confirmation_candidate');
  assert.deepEqual(await db.dividendStocks.get(stock.code), stock);
});

test('inspection of an uninitialised settings row does not create or migrate settings as a side effect', async t => {
  t.mock.method(Date, 'now', () => now);
  await db.settings.clear();
  const before = await exportData();
  const result = await loadDividendCheckSummaries(await workbench(), { asOf, now });
  assert.ok(result.stocks['000001']);
  assert.equal(await exportData(), before);
  assert.equal(await db.settings.count(), 0);
});
