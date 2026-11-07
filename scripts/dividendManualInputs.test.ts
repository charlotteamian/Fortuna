import 'fake-indexeddb/auto';
import * as XLSX from 'xlsx';
import Dexie from 'dexie';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { buildDividendManualBase, dividendAutomaticSignature, hasCurrentUserDividendEvidence, type DividendManualInputs } from '../src/lib/dividendManualInputs.ts';
import { calculateDividendPricing, defaultDividendPricingMethod } from '../src/lib/dividendPricing.ts';
import { dividendResearchCashYield, defaultDividendSelectionPrinciples, evaluateDividendResearch } from '../src/lib/dividendResearch.ts';
import { dateInChina } from '../src/lib/dividendWorkbench.ts';
import { dividendPricingPlan, dividendPricingProvenance } from '../src/lib/dividendPricingPlan.ts';
import { dividendCheckSummary } from '../src/lib/dividendCheckSummary.ts';
import type { DividendLedger } from '../src/lib/dividendLedger.ts';
registerHooks({ resolve(specifier, context, nextResolve) {
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL) {
    const candidate = new URL(`${specifier}.ts`, context.parentURL);
    if (existsSync(candidate)) return { url: candidate.href, shortCircuit: true };
  } return nextResolve(specifier, context);
}, load(url, context, nextLoad) {
  if (url.endsWith('.json')) return { format: 'module', source: `export default ${readFileSync(new URL(url), 'utf8')}`, shortCircuit: true };
  return nextLoad(url, context);
} });
const { db, initializeSettings, updateSettings, exportData, importData, exportToExcel, importFromExcel } = await import('../src/db.ts');
const { applyDividendManualInputs, saveDividendManualInputs, loadDividendManualInputs, reuseDividendManualInputs, closeDividendManualInputs } = await import('../src/services/dividendManualInputsService.ts');
const { saveDividendResearchCache, loadDividendResearchCache, closeDividendResearchCache } = await import('../src/services/dividendResearchCacheService.ts');
const { validateDividendPricingProposal, previewDividendPlanChange, applyDividendPlanChange } = await import('../src/services/dividendAdvisorActionsService.ts');
const method = defaultDividendPricingMethod(), asOf = dateInChina(), year = Number(asOf.slice(0, 4)) - 2;
const expiresOn = new Date(Date.parse(asOf) + 30 * 86400000).toISOString().slice(0, 10);
const stock = { code: '000858', name: 'Input fixture', group: 'watch' as const, weightBps: 10000, shareMode: 'manual' as const, manualShares: 0, lotSize: 100 };
const source = () => calculateDividendPricing({ code: stock.code, name: stock.name, financialSector: false, method, asOf, annuals: [], priceMinor: 10000, priceDate: asOf });
function entered(): DividendManualInputs { return { code: stock.code, frequency: 'annual', confirmedAt: asOf, expiresOn,
  coverageConfirmed: true, conflictAcknowledged: false, automaticSignature: '[]', batches: [{ reportDate: `${year}-12-31`, announcementDate: `${year + 1}-01-10`,
    recordDate: `${year + 1}-01-20`, exDate: `${year + 1}-01-21`, cashPer10Micros: 50000000, bonusPer10Bps: 0, transferPer10Bps: 0,
    sourceUrl: 'https://static.cninfo.com.cn/finalpage/fixture-implementation.PDF' }] }; }
after(() => { db.close(); closeDividendResearchCache(); closeDividendManualInputs(); });

test('manual basis requests only cash pricing essentials and retains its user-confirmed provenance', () => {
  const pricing = applyDividendManualInputs(source(), entered(), stock, method, asOf);
  assert.equal(pricing.canApply, true, 'missing annual EPS, FCF and cyclical normalisation are advisory');
  assert.equal(pricing.dividendBase?.dpsMicros, 5000000);
  assert.equal(pricing.d1Micros, 4500000);
  assert.equal(pricing.userConfirmedEvidence?.confirmedAt, asOf);
  assert.equal(dividendPricingProvenance(pricing, Date.now())?.userConfirmedAt, asOf);
  assert.equal(pricing.ledger, undefined, 'manual inputs never impersonate an automatically verified ledger');
  assert.ok(pricing.dividendBase?.flags.includes('USER_CONFIRMED_INPUT'));
  assert.equal(hasCurrentUserDividendEvidence(pricing, asOf), true);
  assert.equal(hasCurrentUserDividendEvidence(pricing, new Date(Date.parse(expiresOn) + 86400000).toISOString().slice(0, 10)), false);
  assert.throws(() => buildDividendManualBase({ ...entered(), coverageConfirmed: false }, asOf), /INVALID/);
  assert.throws(() => buildDividendManualBase({ ...entered(), batches: [{ ...entered().batches[0], bonusPer10Bps: NaN }] }, asOf), /INVALID/);
  assert.throws(() => buildDividendManualBase({ ...entered(), batches: [{ ...entered().batches[0], sourceUrl: 'https://example.org/guess.pdf' }] }, asOf), /INVALID/);
});

test('manual crosscheck mismatch and source conflicts cannot be bypassed by filling an amount', () => {
  const conflict = source(); conflict.blockers.push('dividend_source_conflict');
  assert.throws(() => buildDividendManualBase(entered(), asOf, conflict), /CONFLICT/);
  assert.doesNotThrow(() => buildDividendManualBase({ ...entered(), conflictAcknowledged: true }, asOf, conflict));
  assert.throws(() => buildDividendManualBase({ ...entered(), crosscheck: { epsMicros: 1000000, payoutBps: 5000,
    reportDate: `${year}-12-31`, sourceUrl: entered().batches[0].sourceUrl } }, asOf), /CROSSCHECK/);
  const exact = buildDividendManualBase({ ...entered(), crosscheck: { epsMicros: 10000000, payoutBps: 5000,
    reportDate: `${year}-12-31`, sourceUrl: entered().batches[0].sourceUrl } }, asOf);
  assert.equal(exact.crosscheckDeviationBps, 0);
});

test('cash yield reconstructs missing cached values from its own unadjusted quote even with stale technical data', () => {
  const pricing = applyDividendManualInputs(source(), entered(), stock, method, asOf);
  const research = { code: stock.code, name: stock.name, checks: [], status: 'unknown' as const, sources: [], issues: [], pricing,
    technical: { currentUsable: false } as never };
  const evaluated = evaluateDividendResearch(research, defaultDividendSelectionPrinciples());
  assert.equal(evaluated.yieldBps, 500);
  assert.equal(evaluated.checks.find(check => check.rule === 'yield')?.status, 'pass');
  pricing.priceDate = new Date(Date.parse(asOf) - 11 * 86400000).toISOString().slice(0, 10);
  assert.equal(dividendResearchCashYield(research).yieldBps, undefined);
});

test('changed independent automatic evidence invalidates the manually confirmed home basis', () => {
  const pricing = applyDividendManualInputs(source(), entered(), stock, method, asOf);
  const ledger: DividendLedger = { code: stock.code, asOf, complete: true, issues: [], sourceUrls: [], events: [{ code: stock.code, id: 'new', batchId: 'new',
    reportDate: `${year + 1}-12-31`, period: 'annual', exDate: asOf, announcementDate: asOf, cashPer10Micros: 60000000,
    implemented: true, verification: 'unverified', sources: [], issues: [] }] };
  assert.equal(hasCurrentUserDividendEvidence(pricing, asOf, ledger), false);
  assert.notEqual(dividendAutomaticSignature(ledger), entered().automaticSignature);
  const summary = dividendCheckSummary({ stock, research: { code: stock.code, name: stock.name, status: 'unknown', checks: [], sources: [], issues: [], pricing },
    basis: { asOf, verified: false, evidenceStatus: 'current' }, ledger, pricingMethod: method, asOf });
  assert.equal(summary.currentPlan, null);
  assert.doesNotThrow(() => dividendAutomaticSignature({ ...ledger, events: [null] as never }));
});

test('manual submit persists, restores cash yield, previews and confirms exact prices; altered input rejects stale preview', async () => {
  await initializeSettings(); await updateSettings({ dividendPricingMethod: method });
  await db.dividendStocks.put(stock);
  await saveDividendResearchCache({ snapshot: { generatedAt: Date.now() - 1000, principles: defaultDividendSelectionPrinciples(), pricingMethod: method,
    stocks: [{ code: stock.code, name: stock.name, checks: [], status: 'unknown', sources: [], issues: [], pricing: source() }], indices: [] }, scope: 'plan', candidateInput: '' });
  const snapshot = await saveDividendManualInputs(entered()), pricing = snapshot.stocks[0].pricing!;
  const restored = await loadDividendResearchCache();
  assert.equal(restored?.snapshot.stocks.find(row => row.code === stock.code)?.yieldBps, 500);
  assert.deepEqual(await loadDividendManualInputs(stock.code), entered());
  const proposal = { id: 'manual-preview', code: stock.code, reason: 'User confirmed exact cash fields', ...dividendPricingPlan(pricing)!,
    gridProvenance: dividendPricingProvenance(pricing, snapshot.generatedAt) };
  await validateDividendPricingProposal(proposal, { pricing, method, generatedAt: snapshot.generatedAt });
  const preview = await previewDividendPlanChange(proposal);
  await applyDividendPlanChange(proposal, preview.fingerprint);
  const saved = await db.dividendStocks.get(stock.code);
  assert.equal(saved?.gridProvenance?.userConfirmedAt, asOf);
  assert.deepEqual(saved?.buyLevels, proposal.buyLevels);
  await saveDividendManualInputs({ ...entered(), batches: [{ ...entered().batches[0], cashPer10Micros: 60000000 }] });
  await assert.rejects(validateDividendPricingProposal(proposal, { pricing, method, generatedAt: snapshot.generatedAt }), /DIVIDEND_REVIEW_CHANGED/);
});


test('user corrections survive JSON and Excel backup restore with original confirmation dates', async () => {
  const expected = entered();
  await updateSettings({ dividendManualInputs: { [stock.code]: expected } });
  const json = await exportData(), excel = await exportToExcel();
  await updateSettings({ dividendManualInputs: undefined });
  assert.equal(await importData(json), true);
  assert.deepEqual((await db.settings.get('main'))?.dividendManualInputs, { [stock.code]: expected });
  await updateSettings({ dividendManualInputs: undefined });
  assert.equal(await importFromExcel(excel), true);
  assert.deepEqual((await db.settings.get('main'))?.dividendManualInputs, { [stock.code]: expected });
  const book = XLSX.read(excel, { type: 'base64' });
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(book.Sheets.Settings);
  rows[0].dividendManualInputs = JSON.stringify({ [stock.code]: { ...expected, batches: [{ ...expected.batches[0], sourceUrl: 'https://example.org/guess.pdf' }] } });
  book.Sheets.Settings = XLSX.utils.json_to_sheet(rows);
  assert.equal(await importFromExcel(XLSX.write(book, { type: 'array', bookType: 'xlsx' })), false);
});

test('ready automatic prices outrank saved inputs and expired or changed source corrections cannot revive a blocked result', () => {
  const blocked = source(), value = entered();
  const ready = applyDividendManualInputs(blocked, value, stock, method, asOf);
  assert.equal(reuseDividendManualInputs(ready, value, stock, method, asOf), ready);
  assert.equal(reuseDividendManualInputs(blocked, { ...value, expiresOn: new Date(Date.parse(asOf) - 86400000).toISOString().slice(0, 10) }, stock, method, asOf), blocked);
  assert.equal(reuseDividendManualInputs(blocked, { ...value, automaticSignature: 'changed' }, stock, method, asOf), blocked);
});

test('cash-yield review refuses legacy, failed, mismatched, stale and expired evidence', async () => {
  const { pingAnOfficialLedger } = await import('./helpers/dividendPricingFixture.ts');
  const ledger = pingAnOfficialLedger(asOf);
  const valid = calculateDividendPricing({ code: '000001', name: 'Yield fixture', financialSector: true, method, asOf, annuals: [], ledger, priceMinor: 1000, priceDate: asOf });
  const research = (pricing = valid) => ({ code: '000001', name: 'Yield fixture', status: 'unknown' as const, checks: [], sources: [], issues: [], pricing });
  assert.equal(dividendResearchCashYield(research()).yieldBps, 609);
  assert.equal(evaluateDividendResearch({ code: '000001', name: 'Legacy', status: 'unknown', checks: [], sources: [], issues: [], yieldBps: 900 }, defaultDividendSelectionPrinciples()).checks.find(check => check.rule === 'yield')?.status, 'unknown');
  assert.equal(dividendResearchCashYield({ ...research(), issues: [{ kind: 'dividend', reason: 'request_failed' }] }).yieldBps, undefined);
  assert.equal(dividendResearchCashYield(research({ ...valid, ledger: { ...ledger, issues: ['ANNOUNCEMENT_REFRESH_FAILED'] } })).yieldBps, undefined);
  assert.equal(dividendResearchCashYield(research({ ...valid, ledger: { ...ledger, asOf: `${year}-01-01` } })).yieldBps, undefined);
  const mismatch = calculateDividendPricing({ code: '000001', name: 'Mismatch', financialSector: true, method, asOf, ledger, priceMinor: 1000, priceDate: asOf,
    annuals: [{ year: 2025, reportDate: '2025-12-31', noticeDate: '2026-03-20', epsMicros: 100000, payoutBps: 1000 }] });
  assert.ok(mismatch.dividendBase!.flags.includes('CROSSCHECK_MISMATCH'));
  assert.equal(dividendResearchCashYield(research(mismatch)).yieldBps, undefined);
  const manual = applyDividendManualInputs(source(), entered(), stock, method, asOf);
  assert.equal(dividendResearchCashYield(research({ ...manual, userConfirmedEvidence: { ...manual.userConfirmedEvidence!, expiresOn: `${year}-01-01` } })).yieldBps, undefined);
});


test('independent source updates reject an already open completion form before saving it', async () => {
  const evidence = new Dexie('FortunaDividendLedger');
  evidence.version(1).stores({ documents: 'url', ledgers: 'code' });
  try {
    await evidence.table('ledgers').put({ code: stock.code, asOf, complete: true, issues: [], sourceUrls: [], events: [{ code: stock.code, id: 'new', batchId: 'new',
      reportDate: `${year + 1}-12-31`, period: 'annual', exDate: asOf, announcementDate: asOf, cashPer10Micros: 60000000,
      implemented: true, verification: 'unverified', sources: [], issues: [] }] });
    await assert.rejects(saveDividendManualInputs(entered()), /DIVIDEND_MANUAL_CHANGED/);
    const { loadDividendGridBases } = await import('../src/services/dividendGridBasisService.ts');
    assert.equal((await loadDividendGridBases([stock.code], asOf))[stock.code]?.verified, false);
  } finally { await evidence.table('ledgers').delete(stock.code); evidence.close(); }
});


test('a new share-only implementation changes the independent signature and invalidates a manual cash base', () => {
  const ledger: DividendLedger = { code: stock.code, asOf, complete: true, issues: [], sourceUrls: [], events: [{ id: 'cash', batchId: 'cash', code: stock.code,
    reportDate: `${year}-12-31`, period: 'annual', exDate: `${year + 1}-01-21`, cashPer10Micros: 50000000,
    bonusPer10Bps: 0, transferPer10Bps: 0, shareFactor: 1, implemented: true, verification: 'verified', sources: [], issues: [] }] };
  const value = { ...entered(), automaticSignature: dividendAutomaticSignature(ledger) };
  const original = { ...source(), ledger };
  const pricing = applyDividendManualInputs(original, value, stock, method, asOf);
  const changed = { ...ledger, events: [...ledger.events, { ...ledger.events[0], id: 'split', batchId: 'split', exDate: asOf, cashPer10Micros: 0, bonusPer10Bps: 1000, shareFactor: 1.1 }] };
  assert.notEqual(dividendAutomaticSignature(changed), value.automaticSignature);
  assert.equal(hasCurrentUserDividendEvidence(pricing, asOf, changed), false);
});

test('manual cash applies a later verified standalone share factor once and rejects its earlier price', () => {
  const action = { id: 'split', batchId: 'split', code: stock.code, reportDate: `${year + 1}-12-31`, period: 'annual' as const,
    exDate: asOf, cashPer10Micros: 0, bonusPer10Bps: 10000, transferPer10Bps: 0, shareFactor: 2,
    implemented: true, verification: 'verified' as const, sources: [{ provider: 'cninfo' as const, url: entered().batches[0].sourceUrl }], issues: [] };
  const ledger: DividendLedger = { code: stock.code, asOf, complete: true, issues: [], sourceUrls: [], events: [action] };
  const value = { ...entered(), automaticSignature: dividendAutomaticSignature(ledger) };
  const pricing = applyDividendManualInputs({ ...source(), ledger }, value, stock, method, asOf);
  assert.equal(pricing.dividendBase?.dpsMicros, 2500000);
  assert.equal(pricing.dividendBase?.latestExDate, asOf);
  assert.equal(dividendResearchCashYield({ code: stock.code, name: stock.name, status: 'unknown', checks: [], sources: [], issues: [],
    pricing: { ...pricing, priceDate: new Date(Date.parse(asOf) - 86400000).toISOString().slice(0, 10) } }).yieldBps, undefined);
  const explicit = buildDividendManualBase({ ...value, shareActions: [{ exDate: asOf, bonusPer10Bps: 10000, transferPer10Bps: 0, sourceUrl: entered().batches[0].sourceUrl }] }, asOf, { ...source(), ledger });
  assert.equal(explicit.dpsMicros, 2500000, 'the same automatic and entered action is applied once');
});

test('a known standalone action with unknown ratios requires exactly its user-entered correction', () => {
  const ledger: DividendLedger = { code: stock.code, asOf, complete: true, issues: [], sourceUrls: [], events: [{ id: 'unknown-split', batchId: 'unknown-split', code: stock.code,
    reportDate: `${year + 1}-12-31`, period: 'annual', exDate: asOf, cashPer10Micros: 0, implemented: true, verification: 'unverified', sources: [], issues: [] }] };
  assert.throws(() => buildDividendManualBase(entered(), asOf, { ...source(), ledger }), /DIVIDEND_MANUAL_SHARE_ACTION/);
  const corrected = buildDividendManualBase({ ...entered(), shareActions: [{ exDate: asOf, bonusPer10Bps: 10000, transferPer10Bps: 0, sourceUrl: entered().batches[0].sourceUrl }] }, asOf, { ...source(), ledger });
  assert.equal(corrected.dpsMicros, 2500000);
  assert.equal(corrected.latestExDate, asOf);
});
