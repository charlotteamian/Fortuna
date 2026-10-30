import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import test, { after } from 'node:test';
import { defaultDividendStocks, isDividendStock, type DividendStock } from '../src/lib/dividendWorkbench.ts';
import { isDividendGridProvenance, reviewDividendGrid, type DividendGridProvenance } from '../src/lib/dividendGridProvenance.ts';

const asOf = '2026-10-29';
const origin = (): DividendGridProvenance => ({ generatedAt: Date.parse('2026-10-01T02:00:00Z'), grossDpsMicros: 1_000_000,
  taxBps: 1000, parameterVersion: 5, basisKind: 'recent_batches' });
const stock = (): DividendStock => ({ ...defaultDividendStocks()[0], manualShares: 200, buyPaused: true,
  buyLevels: [{ priceMinor: 1000, yieldBps: 550, portionBps: 5000 }, { priceMinor: 800, yieldBps: 650, portionBps: 5000 }],
  sellLevels: [{ priceMinor: 1200, yieldBps: 480, portionBps: 5000 }, { priceMinor: 1400, yieldBps: 400, portionBps: 5000 }],
  gridProvenance: origin(), quote: { priceMinor: 900, date: asOf, fetchedAt: 1 } });
const basis = (dpsMicros = 1_000_000) => ({ dpsMicros, asOf, latestExDate: '2026-09-20', verified: true });

test('a saved grid retains its origin and can distinguish verified, old-grid and unavailable judgements', () => {
  const saved = stock(), before = structuredClone(saved);
  const current = reviewDividendGrid(saved, basis(), { asOf });
  assert.equal(current.basisState, 'verified'); assert.equal(current.hasCompleteSavedGrid, true);
  assert.equal(current.generatedDate, '2026-10-01'); assert.equal(current.buyState, 'triggered'); assert.equal(current.sellState, 'waiting');
  assert.deepEqual(current.buyTriggeredLevels, [1]); assert.deepEqual(current.staleReasons, []);
  const missing = reviewDividendGrid(saved, { asOf, verified: false }, { asOf });
  assert.equal(missing.basisState, 'saved_unverified'); assert.equal(missing.buyState, 'triggered'); assert.equal(missing.sellState, 'waiting');
  const unverifiedLegacy = reviewDividendGrid({ ...saved, gridProvenance: undefined }, basis(), { asOf });
  assert.equal(unverifiedLegacy.basisState, 'saved_unverified'); assert.equal(unverifiedLegacy.provenanceMissing, true);
  const absent = reviewDividendGrid({ ...saved, buyLevels: undefined, sellLevels: undefined }, { asOf, verified: false }, { asOf });
  assert.equal(absent.basisState, 'unavailable'); assert.equal(absent.buyState, 'unknown'); assert.equal(absent.sellState, 'unknown');
  assert.deepEqual(saved, before, 'reviewing must not change prices, holdings, weights or the manual pause');
});

test('the base-change alert uses a strict exact >10% boundary in either direction', () => {
  const saved = stock();
  assert.equal(reviewDividendGrid(saved, basis(1_100_000), { asOf }).stale, false);
  assert.equal(reviewDividendGrid(saved, basis(900_000), { asOf }).stale, false);
  const above = reviewDividendGrid(saved, basis(1_100_001), { asOf });
  assert.deepEqual(above.staleReasons, ['base_changed']); assert.equal(above.basisChangeBps, 1000);
  assert.equal(above.basisState, 'saved_unverified', 'rounded 10.00% must not hide an actual threshold breach');
  assert.deepEqual(reviewDividendGrid(saved, basis(899_999), { asOf }).staleReasons, ['base_changed']);
  const zero = reviewDividendGrid(saved, basis(0), { asOf });
  assert.deepEqual(zero.staleReasons, ['base_changed']); assert.equal(zero.basisChangeBps, 10000, 'a verified removal of all cash is a 100% change, not unknown');
});

test('an ex-date after generation retires the basis even when a complete recomputation is unavailable', () => {
  const saved = stock();
  assert.deepEqual(reviewDividendGrid(saved, { asOf, latestExDate: '2026-10-28', verified: false }, { asOf }).staleReasons, ['ex_dividend_since_generation']);
  assert.equal(reviewDividendGrid(saved, { ...basis(), latestExDate: '2026-10-01' }, { asOf }).stale, false);
  assert.equal(reviewDividendGrid(saved, { ...basis(), latestExDate: '2026-10-30' }, { asOf }).stale, false, 'a future ex-date is not an implemented event');
  assert.equal(reviewDividendGrid(saved, { ...basis(), asOf: '2026-10-28' }, { asOf }).basisState, 'saved_unverified', 'old evidence cannot be relabelled as checked today');
  const shanghai = { ...saved, gridProvenance: { ...origin(), generatedAt: Date.parse('2026-09-30T20:30:00Z') } };
  assert.equal(reviewDividendGrid(shanghai, { ...basis(), latestExDate: '2026-10-01' }, { asOf }).stale, false, 'generation date uses China time');
});

test('tax, method version and basis kind changes alert without rewriting a saved grid', () => {
  const saved = stock(), original = structuredClone(saved);
  const review = reviewDividendGrid(saved, basis(), { asOf, taxBps: 0, parameterVersion: 6, basisKind: 'classic_ttm' });
  assert.deepEqual(review.staleReasons, ['parameters_changed', 'tax_changed', 'basis_kind_changed']);
  assert.deepEqual(saved, original);
});

test('market deviation checks need a usable quote and actual saved explicit levels', () => {
  const saved = stock();
  assert.equal(reviewDividendGrid({ ...saved, quote: { ...saved.quote!, priceMinor: 1401 } }, basis(), { asOf }).marketDeviation, 'above_sell_grid');
  assert.equal(reviewDividendGrid({ ...saved, quote: { ...saved.quote!, priceMinor: 640 } }, basis(), { asOf }).marketDeviation, 'below_buy_grid');
  assert.equal(reviewDividendGrid({ ...saved, quote: { ...saved.quote!, priceMinor: 641 } }, basis(), { asOf }).marketDeviation, null);
  for (const quoteChange of [{ quoteFailedAt: 3 }, { quote: { ...saved.quote!, date: '2026-10-01' } }, { quote: { ...saved.quote!, date: '2026-10-30' } }, { quote: undefined }]) {
    const review = reviewDividendGrid({ ...saved, ...quoteChange }, basis(), { asOf });
    assert.equal(review.quoteUsable, false); assert.equal(review.marketDeviation, null);
    assert.deepEqual(review.buyTriggeredLevels, []); assert.equal(review.buyState, 'unknown');
  }
  const partial = reviewDividendGrid({ ...saved, buyLevels: [{ yieldBps: 550, portionBps: 10000 }] }, basis(), { asOf });
  assert.equal(partial.hasCompleteSavedGrid, false); assert.equal(partial.buyState, 'unknown');
});

test('provenance validation keeps legacy stocks readable and rejects corrupt origin metadata', () => {
  assert.ok(isDividendStock(stock())); assert.ok(isDividendStock({ ...stock(), gridProvenance: undefined }));
  for (const change of [{ generatedAt: 0 }, { generatedAt: Number.MAX_SAFE_INTEGER }, { grossDpsMicros: 0 }, { grossDpsMicros: 1.5 }, { taxBps: 500 }, { parameterVersion: 0 }, { basisKind: 'invented' }]) {
    const invalid = { ...origin(), ...change };
    assert.equal(isDividendGridProvenance(invalid), false, JSON.stringify(change));
    assert.equal(isDividendStock({ ...stock(), gridProvenance: invalid }), false, JSON.stringify(change));
  }
});

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
const { db, initializeSettings, exportData, importData, exportToExcel, importFromExcel } = await import('../src/db.ts');
after(() => db.close());

test('JSON and Excel backups round-trip grid origin with holdings and saved prices intact', async () => {
  await initializeSettings();
  const saved = stock(); await db.dividendStocks.put(saved);
  const account = { id: 'provenance-account', name: 'Synthetic account', category: '股票/ETF', type: 'asset' as const, currency: 'CNY', portfolio: true, sortOrder: 0, createdAt: 1 };
  const holding = { id: 'provenance-holding', accountId: account.id, name: 'Synthetic holding', symbol: saved.code, lastPrice: 9, sortOrder: 0, createdAt: 1 };
  const txn = { id: 'provenance-txn', accountId: account.id, holdingId: holding.id, date: asOf, kind: 'buy' as const, shares: 200, price: 9, createdAt: 1 };
  await db.accounts.put(account); await db.holdings.put(holding); await db.holdingTxns.put(txn);
  const json = await exportData(), excel = await exportToExcel();
  for (const [backup, restore] of [[json, importData], [excel, importFromExcel]] as const) {
    await db.dividendStocks.update(saved.code, { gridProvenance: undefined, manualShares: 999 });
    const failures: unknown[] = [];
    const restored = restore === importFromExcel ? await importFromExcel(backup, failure => failures.push(failure)) : await importData(backup);
    assert.equal(restored, true, JSON.stringify(failures));
    assert.deepEqual(await db.dividendStocks.get(saved.code), saved);
    assert.deepEqual(await db.holdingTxns.get(txn.id), txn);
  }
  const legacy = JSON.parse(json); delete legacy.dividendStocks[0].gridProvenance;
  assert.equal(await importData(JSON.stringify(legacy)), true);
  assert.equal((await db.dividendStocks.get(saved.code))?.gridProvenance, undefined);
  assert.equal((await db.dividendStocks.get(saved.code))?.manualShares, 200);
});

test('invalid imported provenance fails before replacing existing prices or holding records', async () => {
  const saved = stock(); await db.dividendStocks.put(saved);
  const invalid = JSON.parse(await exportData()); invalid.dividendStocks[0].gridProvenance.grossDpsMicros = -1;
  const before = await db.holdingTxns.toArray();
  assert.equal(await importData(JSON.stringify(invalid)), false);
  assert.deepEqual(await db.dividendStocks.get(saved.code), saved);
  assert.deepEqual(await db.holdingTxns.toArray(), before);
});
