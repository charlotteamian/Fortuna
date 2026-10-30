import { pingAnOfficialLedger } from './helpers/dividendPricingFixture.ts';
import { dividendLedgerBase } from '../src/lib/dividendLedger.ts';
import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import test, { after, beforeEach } from 'node:test';
import Dexie from 'dexie';
import type { DividendPlanProposal } from '../src/lib/dividendAdvisorActions.ts';
import type { DividendStock } from '../src/lib/dividendWorkbench.ts';
import type { DividendLedgerBase } from '../src/lib/dividendLedger.ts';
import { calculateDividendPricing, defaultDividendPricingMethod } from '../src/lib/dividendPricing.ts';
import { dividendPricingPlan, dividendPricingProvenance } from '../src/lib/dividendPricingPlan.ts';
import { dateInChina } from '../src/lib/dividendWorkbench.ts';

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
const { db, initializeSettings, updateSettings, exportData, importData, exportToExcel, importFromExcel } = await import('../src/db.ts');
const { previewDividendPlanChange, applyDividendPlanChange, validateDividendPricingProposal, loadDividendPricingMethod, saveDividendPricingMethod } = await import('../src/services/dividendAdvisorActionsService.ts');
const { saveDividendStock, saveDividendBudget } = await import('../src/services/dividendService.ts');
const { saveDividendResearchCache, closeDividendResearchCache } = await import('../src/services/dividendResearchCacheService.ts');
const { parseDividendAdvisorActions } = await import('../src/lib/dividendAdvisorActions.ts');
const { defaultDividendSelectionPrinciples } = await import('../src/lib/dividendResearch.ts');
const ledgerStore = new Dexie('FortunaDividendLedger'); ledgerStore.version(1).stores({ documents: 'url', ledgers: 'code' });
const { closeDividendLedgerEvidence } = await import('../src/services/dividendLedgerEvidenceService.ts');
const cache = new Dexie('FortunaDividendResearchCache');
cache.version(1).stores({ results: 'id' });

const oldStock = (): DividendStock => ({ code: '000001', name: 'Synthetic bank', group: 'core', weightBps: 1250,
  shareMode: 'manual', manualShares: 230, lotSize: 100, manualDpsMicros: 609000, buyPaused: true, note: 'Preserve this plan note',
  buyLevels: [1400, 1200, 1100].map((priceMinor, index) => ({ priceMinor, yieldBps: 400 + index * 100, portionBps: [3333, 3333, 3334][index] })),
  sellLevels: [1600, 1800, 2000, 2400].map((priceMinor, index) => ({ priceMinor, yieldBps: 350 - index * 50, portionBps: 2500 })),
  gridProvenance: { generatedAt: Date.now() - 86400000, grossDpsMicros: 500000, taxBps: 0, parameterVersion: 4, basisKind: 'classic_ttm' } });
const verifiedBase = (dpsMicros = 609000, selectedBatchIds = ['000001:2025-12-31:annual', '000001:2025-06-30:interim']): DividendLedgerBase => ({
  dpsMicros, asOf: dateInChina(), frequency: 'semiannual', requiredBatches: 2, selectedBatchIds, latestExDate: dateInChina(),
  verified: true, flags: [], sourceUrls: ['https://static.cninfo.com.cn/synthetic-implementation-evidence.pdf'], reportPeriods: ['2025-12-31', '2025-06-30'],
});
function pricedDraft(base = verifiedBase(), generatedAt = Date.now()) {
  const method = defaultDividendPricingMethod();
  const pricing = calculateDividendPricing({ code: '000001', name: 'Synthetic bank', financialSector: true, annuals: [], method, asOf: base.asOf, dividendBase: base });
  const plan = dividendPricingPlan(pricing); assert.ok(plan, 'a verified synthetic recent-batch fixture must produce a complete plan');
  const draft: DividendPlanProposal = { id: 'synthetic-reprice', code: '000001', reason: 'Confirmed implemented batches and explicit tax selection.',
    ...plan, gridProvenance: dividendPricingProvenance(pricing, generatedAt) };
  return { draft, evidence: { pricing, method, generatedAt } };
}
async function state() { const value = JSON.parse(await exportData()); delete value.timestamp; return value; }

beforeEach(async () => {
  await db.transaction('rw', db.tables, async () => { for (const table of db.tables) await table.clear(); });
  await cache.table('results').clear();
  await ledgerStore.table('ledgers').clear();
  await initializeSettings();
  await updateSettings({ dividendBudgetMinor: 40000000, dividendWorkbenchInitialized: true });
  await saveDividendPricingMethod(defaultDividendPricingMethod());
  await db.dividendStocks.put(oldStock());
  await db.accounts.put({ id: 'synthetic-account', name: 'Synthetic account', category: '股票/ETF', type: 'asset', currency: 'CNY', portfolio: true, cashBalance: 12345, sortOrder: 0, createdAt: 1 });
  await db.holdings.put({ id: 'synthetic-holding', accountId: 'synthetic-account', name: 'Synthetic bank', symbol: '000001', lastPrice: 11.2, sortOrder: 0, createdAt: 1 });
  await db.holdingTxns.put({ id: 'synthetic-buy', accountId: 'synthetic-account', holdingId: 'synthetic-holding', date: '2000-01-01', kind: 'buy', shares: 100, price: 10, createdAt: 1 });
});
after(() => { db.close(); closeDividendResearchCache(); cache.close(); ledgerStore.close(); closeDividendLedgerEvidence(); });

test('preview stays read-only and confirmation saves both rounded ladders and deterministic origin without changing the ledger', async () => {
  const { draft, evidence } = pricedDraft(), original = await db.dividendStocks.get('000001');
  const before = await state();
  assert.deepEqual(draft.buyLevels!.map(level => level.priceMinor), [996, 953, 913, 843]);
  assert.deepEqual(draft.sellLevels!.map(level => level.priceMinor), [1142, 1218, 1305, 1371]);
  assert.equal(evidence.pricing.taxBps, 1000);
  await validateDividendPricingProposal(draft, evidence);
  const preview = await previewDividendPlanChange(draft);
  assert.deepEqual(await state(), before);
  await validateDividendPricingProposal(draft, evidence);
  await applyDividendPlanChange(draft, preview.fingerprint);
  const confirmed = await db.dividendStocks.get('000001');
  assert.deepEqual(confirmed, { ...original, buyLevels: draft.buyLevels, sellLevels: draft.sellLevels, gridProvenance: draft.gridProvenance });
  assert.deepEqual(confirmed!.gridProvenance, { generatedAt: evidence.generatedAt, grossDpsMicros: 609000, taxBps: 1000, parameterVersion: 5, basisKind: 'recent_batches' });
  assert.deepEqual(await state(), { ...before, dividendStocks: [confirmed] });
  const json = await exportData(), excel = await exportToExcel();
  for (const restore of [() => importData(json), () => importFromExcel(excel)]) {
    await db.dividendStocks.clear(); assert.equal(await restore(), true);
    assert.deepEqual(await db.dividendStocks.get('000001'), confirmed, 'confirmed birth must survive both backup formats');
    assert.equal((await db.holdingTxns.get('synthetic-buy'))?.shares, 100);
  }
});

test('a model-provided origin is stripped and only the exact deterministic origin can validate', async () => {
  const { draft, evidence } = pricedDraft();
  const model = { ...draft, gridProvenance: { ...draft.gridProvenance!, grossDpsMicros: 999000, taxBps: 2000 } };
  const parsed = parseDividendAdvisorActions(`Readable advice.\n\`\`\`fortuna-actions\n${JSON.stringify([model])}\n\`\`\``, ['000001']);
  assert.equal(parsed.actions.length, 1); assert.equal(parsed.actions[0].gridProvenance, undefined);
  const before = await state();
  await assert.rejects(validateDividendPricingProposal(parsed.actions[0], evidence), /DIVIDEND_REVIEW_CHANGED/);
  await assert.rejects(validateDividendPricingProposal(model, evidence), /DIVIDEND_REVIEW_CHANGED/);
  // The deterministic service rebuilds both ladders before adding its own origin.
  await validateDividendPricingProposal({ ...parsed.actions[0], ...dividendPricingPlan(evidence.pricing),
    gridProvenance: dividendPricingProvenance(evidence.pricing, evidence.generatedAt) }, evidence);
  assert.deepEqual(await state(), before);
});

test('confirmation fingerprints bind both the saved origin and the origin shown in the preview', async () => {
  const { draft } = pricedDraft();
  const preview = await previewDividendPlanChange(draft);
  const saved = (await db.dividendStocks.get('000001'))!;
  await db.dividendStocks.update(saved.code, { gridProvenance: { ...saved.gridProvenance!, grossDpsMicros: 500001 } });
  const changed = await state();
  await assert.rejects(applyDividendPlanChange(draft, preview.fingerprint), /DIVIDEND_PLAN_CHANGED/);
  assert.deepEqual(await state(), changed);
  await db.dividendStocks.put(saved);
  const next = await previewDividendPlanChange(draft);
  await assert.rejects(applyDividendPlanChange({ ...draft, gridProvenance: { ...draft.gridProvenance!, generatedAt: draft.gridProvenance!.generatedAt - 1 } }, next.fingerprint), /DIVIDEND_PLAN_CHANGED/);
  assert.deepEqual(await db.dividendStocks.get(saved.code), saved);
});

test('budget and share edits retain birth, while a manual price edit clears unverifiable birth', async () => {
  const saved = (await db.dividendStocks.get('000001'))!, originalBirth = structuredClone(saved.gridProvenance);
  await saveDividendBudget(41000000);
  await saveDividendStock({ ...saved, manualShares: 330, weightBps: 1500, gridProvenance: undefined });
  const changedShares = (await db.dividendStocks.get(saved.code))!;
  assert.deepEqual(changedShares.gridProvenance, originalBirth); assert.equal(changedShares.manualShares, 330); assert.equal(changedShares.weightBps, 1500);
  await saveDividendStock({ ...changedShares, gridProvenance: { ...originalBirth!, grossDpsMicros: 999000 } });
  assert.deepEqual((await db.dividendStocks.get(saved.code))!.gridProvenance, originalBirth, 'a stale editor cannot invent a newer birth for unchanged prices');
  await saveDividendStock({ ...changedShares, buyLevels: changedShares.buyLevels!.map((level, index) => index ? level : { ...level, priceMinor: level.priceMinor! + 1 }) });
  const manual = (await db.dividendStocks.get(saved.code))!;
  assert.equal(manual.gridProvenance, undefined); assert.equal(manual.manualShares, 330); assert.equal(manual.buyPaused, true);
  assert.deepEqual(manual.sellLevels, saved.sellLevels); assert.equal((await db.settings.get('main'))!.dividendBudgetMinor, 41000000);
  assert.equal((await db.holdingTxns.get('synthetic-buy'))!.shares, 100);
});

test('reading a legacy pricing method upgrades only the executor defaults, preserving saved grids and stored settings', async () => {
  const oldMethod = { ...defaultDividendPricingMethod(), strategy: 'classic_ttm' as const, holdingPeriod: 'over_year' as const };
  await updateSettings({ dividendPricingMethod: oldMethod });
  const before = await state();
  const loaded = await loadDividendPricingMethod();
  assert.equal(loaded.strategy, 'recent_batches'); assert.equal(loaded.holdingPeriod, 'month_to_year');
  assert.deepEqual(await state(), before, 'migration must not rewrite a saved method or confirmed price grid');
});

test('a newer batch selection retires an old draft even when its total cash and prices are unchanged', async () => {
  const { draft, evidence } = pricedDraft(verifiedBase(), Date.now() - 1000);
  await validateDividendPricingProposal(draft, evidence);
  const updated = pricedDraft(verifiedBase(609000, ['000001:2026-06-30:interim', '000001:2025-12-31:annual']), Date.now());
  assert.deepEqual(updated.draft.buyLevels, draft.buyLevels); assert.deepEqual(updated.draft.sellLevels, draft.sellLevels);
  await saveDividendResearchCache({ scope: 'plan', candidateInput: '', snapshot: { generatedAt: updated.evidence.generatedAt, pricingMethod: updated.evidence.method,
    principles: defaultDividendSelectionPrinciples(), indices: [], stocks: [{ code: '000001', name: 'Synthetic bank', pricing: updated.evidence.pricing, checks: [], status: 'unknown', sources: [], issues: [] }] } });
  const before = await state();
  await assert.rejects(validateDividendPricingProposal(draft, evidence), /DIVIDEND_REVIEW_CHANGED/);
  await validateDividendPricingProposal(updated.draft, updated.evidence);
  assert.deepEqual(await state(), before);
});


test('a newer independent ledger retires old UI drafts even when the research cache has not changed', async () => {
  const ledger = pingAnOfficialLedger(dateInChina());
  await ledgerStore.table('ledgers').put(ledger);
  const { draft, evidence } = pricedDraft(dividendLedgerBase(ledger, ledger.asOf));
  evidence.pricing.ledger = ledger;
  await validateDividendPricingProposal(draft, evidence);
  const before = await state();
  const changed = structuredClone(ledger);
  changed.events[0].cashPer10Micros! += 1000000;
  await ledgerStore.table('ledgers').put(changed);
  await assert.rejects(validateDividendPricingProposal(draft, evidence), /DIVIDEND_REVIEW_CHANGED/);
  changed.events[0].verification = 'conflict';
  await ledgerStore.table('ledgers').put(changed);
  await assert.rejects(validateDividendPricingProposal(draft, evidence), /DIVIDEND_REVIEW_CHANGED/);
  await ledgerStore.table('ledgers').put({ ...ledger, asOf: '2026-10-20' });
  await assert.rejects(validateDividendPricingProposal(draft, evidence), /DIVIDEND_REVIEW_CHANGED/);
  await ledgerStore.table('ledgers').clear();
  await assert.rejects(validateDividendPricingProposal(draft, evidence), /DIVIDEND_REVIEW_CHANGED/);
  assert.deepEqual(await state(), before, 'all rejected previews preserve saved plans and holdings');
});
