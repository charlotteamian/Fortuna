/** Stage 0 audit only. All persistence is process-local fake IndexedDB; no browser or device DB is opened. */
import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';

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

const { db, initializeSettings, updateSettings, exportData, importData, exportToExcel, importFromExcel } = await import('../../src/db.ts');
const { saveDividendStock } = await import('../../src/services/dividendService.ts');
const { buildDividendFundHomePlan } = await import('../../src/lib/dividendFundPlan.ts');
const { dateInChina } = await import('../../src/lib/dividendWorkbench.ts');
const { closeDividendLedgerEvidence } = await import('../../src/services/dividendLedgerEvidenceService.ts');
const { closeDividendResearchCache } = await import('../../src/services/dividendResearchCacheService.ts');
const { reviewDividendGrid } = await import('../../src/lib/dividendGridProvenance.ts');
const { loadDividendGridBases } = await import('../../src/services/dividendGridBasisService.ts');
const { default: Dexie } = await import('dexie');
const ledgerStore = new Dexie('FortunaDividendLedger');
ledgerStore.version(1).stores({ documents: 'url', ledgers: 'code' });

const results: Record<string, unknown> = { dataBoundary: 'Only synthetic, process-local fake-indexeddb. No real account, quote, API or device data.', cases: [] };
const cases = results.cases as Record<string, unknown>[];
try {
  await initializeSettings();
  await updateSettings({ dividendBudgetMinor: 1234567, dividendWorkbenchInitialized: true, dividendHomeCollapsedCodes: ['000001'] });
  const original = { code: '000001', name: 'Synthetic bank', group: 'core' as const, weightBps: 10000,
    shareMode: 'manual' as const, manualShares: 100, lotSize: 100, buyPaused: false,
    buyLevels: [{ priceMinor: 1000, yieldBps: 550, portionBps: 10000 }],
    sellLevels: [{ priceMinor: 1200, yieldBps: 480, portionBps: 10000 }],
    gridProvenance: { generatedAt: 1793235600000, grossDpsMicros: 600000, taxBps: 1000 as const, parameterVersion: 5, basisKind: 'recent_batches' as const } };
  await db.dividendStocks.put(original);
  const staleEditor = structuredClone(original);
  await db.dividendStocks.update(original.code, { buyLevels: [{ priceMinor: 900, yieldBps: 550, portionBps: 10000 }], buyPaused: true, manualShares: 200 });
  const currentBeforeSave = await db.dividendStocks.get(original.code);
  await saveDividendStock({ ...staleEditor, note: 'Only a note was edited in the old form.' });
  const afterSave = await db.dividendStocks.get(original.code);
  assert.equal(afterSave!.buyLevels![0].priceMinor, 1000);
  assert.equal(afterSave!.buyPaused, false);
  assert.equal(afterSave!.manualShares, 100);
  assert.equal(afterSave!.gridProvenance, undefined);
  cases.push({ id: 'UI-DATA-02', description: 'A stale editor saving only its note restores an older grid, pause and manual position.', currentBeforeSave, afterSave, observed: true });

  const today = dateInChina();
  const fund = { id: 'synthetic-fund', name: 'Synthetic ETF', code: '515450', indexKind: 'low_volatility' as const, weightBps: 10000,
    reference: { priceMicros: 1000000, highMicros: 1200000, indexYieldBps: 550, asOf: today, source: 'Synthetic manual reference, no quote' } };
  const fundPlan = { mode: 'swing' as const, entryRule: 'both' as const, drawdownBps: 1000, indexYieldBps: 500, budgetMinor: 100000, funds: [fund] };
  const manualEntry = buildDividendFundHomePlan(fundPlan, fund, today);
  const manualExit = buildDividendFundHomePlan(fundPlan, { ...fund, reference: { ...fund.reference, priceMicros: 1200000 } }, today);
  assert.equal(manualEntry.entry.status, 'met');
  assert.equal(manualExit.exitState, 'triggered');
  cases.push({ id: 'UI-FUND-01', description: 'Same-day manual reference without a market quote produces an entry-met or exit-triggered status.', manualEntry, manualExit, observed: true });

  const taxStock = { ...original, gridProvenance: { ...original.gridProvenance, generatedAt: Date.now() - 1000 } };
  const taxBasis = { asOf: today, dpsMicros: 600000, verified: true };
  const homepageTaxCheck = reviewDividendGrid(taxStock, taxBasis, { asOf: today, parameterVersion: 5, basisKind: 'recent_batches' });
  const explicitTaxCheck = reviewDividendGrid(taxStock, taxBasis, { asOf: today, parameterVersion: 5, basisKind: 'recent_batches', taxBps: 2000 });
  assert.equal(homepageTaxCheck.basisState, 'verified');
  assert.equal(explicitTaxCheck.basisState, 'saved_unverified');
  assert.deepEqual(explicitTaxCheck.staleReasons, ['tax_changed']);
  cases.push({ id: 'UI-GRID-01', description: 'Homepage call omitting the current tax cannot flag a changed holding-period tax.', homepageTaxCheck, explicitTaxCheck, observed: true });

  const beforeBackup = JSON.parse(await exportData()); delete beforeBackup.timestamp;
  const json = await exportData(), excel = await exportToExcel();
  assert.equal(await importData(json), true);
  const afterJson = JSON.parse(await exportData()); delete afterJson.timestamp;
  assert.deepEqual(afterJson, beforeBackup);
  assert.equal(await importFromExcel(excel), true);
  const restored = await db.dividendStocks.get(original.code), restoredSettings = await db.settings.get('main');
  assert.deepEqual(restored, afterSave);
  assert.equal(restoredSettings!.dividendBudgetMinor, 1234567);
  assert.equal(restoredSettings!.dividendHomeCollapsedCodes, undefined);
  cases.push({ id: 'UI-DATA-03', description: 'JSON round trip retains the complete settings; Excel retains saved grid/budget/manual state but drops the home collapsed reading preference.', gridAndBudgetRetained: true, jsonSettingsRetained: true, excelHomeCollapseRetained: false });
  await ledgerStore.table('ledgers').put({ code: '000001', asOf: today, events: [] });
  await ledgerStore.table('ledgers').put({ code: '000002', asOf: today });
  await assert.rejects(loadDividendGridBases(['000001', '000002'], today), TypeError);
  cases.push({ id: 'UI-LOAD-01', description: 'One malformed synthetic ledger rejects the entire homepage basis load because per-item errors are not isolated.', wholeBatchRejected: true, observed: true });
  const output = new URL('./ui-data-reproduction.json', import.meta.url);
  writeFileSync(output, JSON.stringify(results, null, 2) + '\n');
  process.stdout.write(JSON.stringify({ cases: cases.map(({ id, observed }) => ({ id, observed: observed ?? true })), output: output.pathname }) + '\n');
} finally {
  db.close(); ledgerStore.close(); closeDividendLedgerEvidence(); closeDividendResearchCache();
}
