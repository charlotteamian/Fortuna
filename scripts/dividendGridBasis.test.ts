import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import test, { after, beforeEach } from 'node:test';
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import Dexie from 'dexie';
import { pingAnOfficialLedger } from './helpers/dividendPricingFixture.ts';
registerHooks({ resolve(specifier, context, nextResolve) {
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL) {
    const candidate = new URL(`${specifier}.ts`, context.parentURL);
    if (existsSync(candidate)) return { url: candidate.href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
} });
const { loadDividendGridBases } = await import('../src/services/dividendGridBasisService.ts');
const { closeDividendLedgerEvidence } = await import('../src/services/dividendLedgerEvidenceService.ts');
const { closeDividendResearchCache } = await import('../src/services/dividendResearchCacheService.ts');
const store = new Dexie('FortunaDividendLedger'); store.version(1).stores({ documents: 'url', ledgers: 'code' });
beforeEach(async () => { await store.table('ledgers').clear(); });
after(() => { store.close(); closeDividendLedgerEvidence(); closeDividendResearchCache(); });
test('a prior-day ledger never breaks home loading or becomes a newly verified current base', async () => {
  const ledger = pingAnOfficialLedger('2026-10-23'); await store.table('ledgers').put(ledger);
  const bases = await loadDividendGridBases(['000001', '600036'], '2026-10-30');
  assert.equal(bases['000001'].dpsMicros, 609000); assert.equal(bases['000001'].asOf, '2026-10-23');
  assert.equal(bases['000001'].verified, false); assert.equal(bases['600036'], undefined);
  assert.deepEqual(await store.table('ledgers').get('000001'), ledger);
});
test('today ledger recomputes the current batch base without fetching or changing evidence dates', async () => {
  const ledger = pingAnOfficialLedger('2026-10-30'); await store.table('ledgers').put(ledger);
  const bases = await loadDividendGridBases(['000001'], '2026-10-30');
  assert.equal(bases['000001'].dpsMicros, 609000); assert.equal(bases['000001'].verified, true);
  assert.deepEqual(await store.table('ledgers').get('000001'), ledger);
});
