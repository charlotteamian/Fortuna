import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import test, { after, beforeEach } from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import Dexie from 'dexie';
import { pingAnOfficialLedger } from './helpers/dividendPricingFixture.ts';
import { calculateDividendPricing, defaultDividendPricingMethod } from '../src/lib/dividendPricing.ts';
import { defaultDividendSelectionPrinciples } from '../src/lib/dividendResearch.ts';
registerHooks({ resolve(specifier, context, nextResolve) {
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL) {
    const candidate = new URL(`${specifier}.ts`, context.parentURL);
    if (existsSync(candidate)) return { url: candidate.href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
} });
const { loadDividendGridBases } = await import('../src/services/dividendGridBasisService.ts');
const { closeDividendLedgerEvidence, researchDividendLedger } = await import('../src/services/dividendLedgerEvidenceService.ts');
const { closeDividendResearchCache } = await import('../src/services/dividendResearchCacheService.ts');
const store = new Dexie('FortunaDividendLedger'); store.version(1).stores({ documents: 'url', ledgers: 'code' });
const researchStore = new Dexie('FortunaDividendResearchCache'); researchStore.version(1).stores({ results: 'id' });
beforeEach(async () => { await store.table('ledgers').clear(); await researchStore.table('results').clear(); });
after(() => { store.close(); researchStore.close(); closeDividendLedgerEvidence(); closeDividendResearchCache(); });
test('a prior-day ledger stays readable as structured evidence without redating it to today', async () => {
  const ledger = pingAnOfficialLedger('2026-10-23'); await store.table('ledgers').put(ledger);
  const bases = await loadDividendGridBases(['000001', '600036'], '2026-10-30');
  assert.equal(bases['000001'].dpsMicros, 609000); assert.equal(bases['000001'].asOf, '2026-10-23');
  assert.equal(bases['000001'].verified, true); assert.equal(bases['000001'].evidenceStatus, 'stale');
  assert.equal(bases['600036'], undefined);
  assert.deepEqual(await store.table('ledgers').get('000001'), ledger);
});
test('today ledger recomputes the current batch base without fetching or changing evidence dates', async () => {
  const ledger = pingAnOfficialLedger('2026-10-30'); await store.table('ledgers').put(ledger);
  const bases = await loadDividendGridBases(['000001'], '2026-10-30');
  assert.equal(bases['000001'].dpsMicros, 609000); assert.equal(bases['000001'].verified, true);
  assert.deepEqual(await store.table('ledgers').get('000001'), ledger);
});

test('an old PDF-derived ledger remains historical evidence until current structured inputs repair its gross cash', async () => {
  const ledger = pingAnOfficialLedger('2026-10-30'); delete ledger.officialParserVersion;
  await store.table('ledgers').put(ledger);
  const basis = (await loadDividendGridBases(['000001'], '2026-10-30'))['000001'];
  assert.equal(basis.verified, false); assert.equal(basis.evidenceStatus, 'incomplete');
  assert.ok(basis.evidenceIssues.includes('DIVIDEND_OFFICIAL_EXTRACTION_OUTDATED'));
  assert.deepEqual(await store.table('ledgers').get('000001'), ledger);
  const raw = JSON.parse(readFileSync(new URL('./fixtures/dividend-pricing-pingan-2026-10-23.json', import.meta.url), 'utf8')).sources.distribution.data;
  await researchDividendLedger(raw, '000001', '2026-10-30');
  const repaired = (await loadDividendGridBases(['000001'], '2026-10-30'))['000001'];
  assert.equal(repaired.verified, true); assert.equal(repaired.dpsMicros, 609000);
});

test('one malformed ledger is an explicit per-stock failure while another stock remains readable', async () => {
  const good = pingAnOfficialLedger('2026-10-30');
  const bad = { code: '600036', asOf: 'not-a-date', complete: true, events: [], issues: [], sourceUrls: [] };
  await store.table('ledgers').bulkPut([good, bad]);
  const bases = await loadDividendGridBases(['600036', '000001'], '2026-10-30');
  assert.equal(bases['000001'].verified, true); assert.equal(bases['000001'].dpsMicros, 609000);
  assert.equal(bases['600036'].verified, false); assert.equal(bases['600036'].evidenceStatus, 'invalid');
  assert.equal(bases['600036'].error, 'DIVIDEND_LEDGER_INVALID');
  assert.deepEqual(await store.table('ledgers').get('000001'), good);
  assert.deepEqual(await store.table('ledgers').get('600036'), bad);
});

test('a failed current announcement refresh keeps the structured cash base usable', async () => {
  const ledger = { ...pingAnOfficialLedger('2026-10-30'), issues: ['CNINFO_HTTP_503'] };
  await store.table('ledgers').put(ledger);
  const result = (await loadDividendGridBases(['000001'], '2026-10-30'))['000001'];
  assert.equal(result.dpsMicros, 609000); assert.equal(result.verified, true);
  assert.equal(result.evidenceStatus, 'current'); assert.deepEqual(result.evidenceIssues, []);
  assert.deepEqual(await store.table('ledgers').get('000001'), ledger);
});

test('an invalid research cache cannot reject the whole list or make an independent ledger disappear', async () => {
  const ledger = pingAnOfficialLedger('2026-10-30'); await store.table('ledgers').put(ledger);
  await researchStore.table('results').put({ id: 'latest', snapshot: null });
  const bases = await loadDividendGridBases(['000001', '600036'], '2026-10-30');
  assert.equal(bases['000001'].verified, true); assert.equal(bases['000001'].dpsMicros, 609000);
  assert.equal(bases['000001'].error, 'INVALID_RESEARCH_CACHE');
  assert.equal(bases['600036'].verified, false); assert.equal(bases['600036'].error, 'INVALID_RESEARCH_CACHE');
});

async function cachePricing(asOf: string, includeLedger: boolean) {
  const ledger = pingAnOfficialLedger(asOf);
  const pricing = calculateDividendPricing({ code: '000001', name: 'Synthetic', asOf, ledger, annuals: [], financialSector: true, method: defaultDividendPricingMethod() });
  if (!includeLedger) delete pricing.ledger;
  await researchStore.table('results').put({ id: 'latest', scope: 'plan', candidateInput: '', snapshot: {
    generatedAt: 1, principles: defaultDividendSelectionPrinciples(), indices: [], stocks: [
      { code: '000001', name: 'Synthetic', pricing, status: 'unknown', checks: [], sources: [], issues: [] },
    ],
  } });
}

test('research fallback keeps a prior-day ledger usable but never promotes an unreadable aggregate', async () => {
  await cachePricing('2026-10-29', true);
  const stale = (await loadDividendGridBases(['000001'], '2026-10-30'))['000001'];
  assert.equal(stale.dpsMicros, 609000); assert.equal(stale.asOf, '2026-10-29');
  assert.equal(stale.verified, true); assert.equal(stale.evidenceStatus, 'stale');
  await cachePricing('2026-10-30', false);
  const unsupported = (await loadDividendGridBases(['000001'], '2026-10-30'))['000001'];
  assert.equal(unsupported.verified, false); assert.equal(unsupported.evidenceStatus, 'missing');
  assert.ok(unsupported.evidenceIssues.includes('DIVIDEND_LEDGER_MISSING'));
});

test('a retired official transport is never called and does not invalidate fresh structured evidence', async () => {
  await cachePricing('2026-10-30', true);
  const raw = JSON.parse(readFileSync(new URL('./fixtures/dividend-pricing-pingan-2026-10-23.json', import.meta.url), 'utf8')).sources.distribution.data;
  let officialRequests = 0;
  await researchDividendLedger(raw, '000001', '2026-10-30', { post: async () => { officialRequests++; throw new Error('CNINFO_HTTP_503'); } });
  const result = (await loadDividendGridBases(['000001'], '2026-10-30'))['000001'];
  assert.equal(officialRequests, 0);
  assert.equal(result.verified, true); assert.equal(result.dpsMicros, 609000); assert.equal(result.evidenceStatus, 'current');
  assert.ok(!result.evidenceIssues.includes('CNINFO_HTTP_503'));
  assert.ok(await store.table('ledgers').get('000001'));
});
