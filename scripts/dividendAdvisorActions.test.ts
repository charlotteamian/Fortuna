import 'fake-indexeddb/auto';
import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import * as XLSX from 'xlsx';
import type { Account, Holding, HoldingTxn } from '../src/db.ts';
import type { DividendStock, GridLevel } from '../src/lib/dividendWorkbench.ts';
import type { DividendPlanProposal } from '../src/lib/dividendAdvisorActions.ts';
import type { DividendSelectionPrinciples } from '../src/lib/dividendResearch.ts';
import { defaultDividendPricingMethod, type DividendPricingMethod } from '../src/lib/dividendPricing.ts';

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
const { isDividendPlanProposal, parseDividendAdvisorActions } = await import('../src/lib/dividendAdvisorActions.ts');
const { defaultDividendSelectionPrinciples } = await import('../src/lib/dividendResearch.ts');
const { previewDividendPlanChange, applyDividendPlanChange, previewDividendRiskRemoval, removeDividendRiskStocks,
  loadDividendSelectionPrinciples, saveDividendSelectionPrinciples, loadDividendPricingMethod, saveDividendPricingMethod } = await import('../src/services/dividendAdvisorActionsService.ts');

function stock(code = '601398', updates: Partial<DividendStock> = {}): DividendStock {
  return { code, name: `Stock ${code}`, group: 'watch', weightBps: 2500, shareMode: 'linked', manualShares: 0, lotSize: 100,
    manualDpsMicros: 300000, note: 'Preserve my review', ...updates };
}
function proposal(updates: Partial<DividendPlanProposal> = {}): DividendPlanProposal {
  return { id: 'review-1', code: '601398', reason: 'Observe the downtrend and lower the planned price levels.',
    buyLevels: [{ yieldBps: 650, portionBps: 3000, priceMinor: 450 }, { yieldBps: 750, portionBps: 4000, priceMinor: 400 }],
    ...updates };
}
function account(id: string, updates: Partial<Account> = {}): Account {
  return { id, name: id, category: '股票/ETF', type: 'asset', currency: 'CNY', portfolio: true, cashBalance: 12345,
    createdAt: 1, sortOrder: 0, ...updates };
}
function holding(code: string, accountId = 'broker', updates: Partial<Holding> = {}): Holding {
  return { id: `holding-${code}`, accountId, name: code, symbol: code, market: 'A股', lastPrice: 10,
    createdAt: 1, sortOrder: 0, ...updates };
}
function trade(held: Holding, updates: Partial<HoldingTxn> = {}): HoldingTxn {
  return { id: `buy-${held.id}`, accountId: held.accountId, holdingId: held.id, date: '2000-01-01', kind: 'buy', shares: 100,
    price: 10, createdAt: 1, ...updates };
}
async function state() {
  return Object.fromEntries(await Promise.all(db.tables.map(async table => [table.name, await table.toArray()])));
}

beforeEach(async () => {
  await db.transaction('rw', db.tables, async () => { for (const table of db.tables) await table.clear(); });
  await initializeSettings();
  await updateSettings({ dividendBudgetMinor: 40000000, dividendStrategy: 'stocks' });
  await db.dividendStocks.bulkAdd([stock(), stock('600036', { weightBps: 1500 }), stock('600900', { group: 'hidden', weightBps: 0 })]);
});
after(() => db.close());

test('action parsing only admits saved stocks once and rebuilds the grid contract without arbitrary model fields', () => {
  const draft = { ...proposal(), weightBps: 10000, manualShares: 99999,
    buyLevels: proposal().buyLevels!.map(level => ({ ...level, accountId: 'untrusted', manualShares: 99999 })) };
  const raw = `Review the falling trend first.\n\n\`\`\`fortuna-actions\n${JSON.stringify([draft, proposal({ id: 'duplicate' }), proposal({ code: '000001' })])}\n\`\`\``;
  const parsed = parseDividendAdvisorActions(raw, ['601398']);
  assert.equal(parsed.answer, 'Review the falling trend first.');
  assert.deepEqual(parsed.actions, [proposal()]);
  assert.doesNotMatch(JSON.stringify(parsed.actions), /accountId|manualShares|weightBps|untrusted/);
  assert.deepEqual(parseDividendAdvisorActions('Readable answer\n```fortuna-actions\n{invalid}\n```', ['601398']), { answer: 'Readable answer', actions: [] });
});

test('valid descending buy and ascending sell grids accept explicit prices and separate yield ladders', () => {
  assert.equal(isDividendPlanProposal(proposal({ sellLevels: [{ priceMinor: 550, yieldBps: 500, portionBps: 5000 }, { priceMinor: 600, yieldBps: 450, portionBps: 5000 }] })), true);
  assert.equal(isDividendPlanProposal(proposal({ buyLevels: [{ yieldBps: 650, portionBps: 3000 }, { yieldBps: 750, portionBps: 4000 }],
    sellLevels: [{ yieldBps: 500, portionBps: 5000 }, { yieldBps: 450, portionBps: 5000 }] })), true);
});

test('malformed, overallocated, unordered, mixed-basis and crossed grids reject before any database change', async () => {
  const invalid: unknown[] = [
    null, {}, proposal({ buyLevels: undefined }), proposal({ buyLevels: [] }), proposal({ code: 'SH.601398' }), proposal({ reason: '' }),
    proposal({ buyLevels: [null as unknown as GridLevel] }),
    proposal({ buyLevels: [{ yieldBps: 650, portionBps: 6000 }, { yieldBps: 750, portionBps: 5000 }] }),
    proposal({ buyLevels: [{ yieldBps: 0, portionBps: 1000 }] }),
    proposal({ buyLevels: [{ yieldBps: 650.5, portionBps: 1000 }] }),
    proposal({ buyLevels: [{ yieldBps: 650, portionBps: 1000, priceMinor: 0 }] }),
    proposal({ buyLevels: [{ yieldBps: 650, portionBps: 1000, priceMinor: 450.5 }] }),
    proposal({ buyLevels: [{ yieldBps: 650, portionBps: 1000, priceMinor: 400 }, { yieldBps: 750, portionBps: 1000, priceMinor: 450 }] }),
    proposal({ buyLevels: [{ yieldBps: 650, portionBps: 1000 }, { yieldBps: 600, portionBps: 1000 }] }),
    proposal({ sellLevels: [{ yieldBps: 450, portionBps: 5000 }, { yieldBps: 500, portionBps: 5000 }] }),
    proposal({ buyLevels: [{ yieldBps: 650, portionBps: 1000, priceMinor: 450 }, { yieldBps: 500, portionBps: 1000 }] }),
    proposal({ sellLevels: [{ yieldBps: 500, portionBps: 5000, priceMinor: 440 }] }),
    proposal({ buyLevels: [{ yieldBps: 500, portionBps: 1000 }], sellLevels: [{ yieldBps: 550, portionBps: 1000 }] }),
  ];
  const before = await state();
  for (const [index, value] of invalid.entries()) {
    assert.equal(isDividendPlanProposal(value), false, `invalid grid ${index}`);
    await assert.rejects(previewDividendPlanChange(value as DividendPlanProposal), /INVALID_DIVIDEND_PROPOSAL/, `invalid preview ${index}`);
    await assert.rejects(applyDividendPlanChange(value as DividendPlanProposal, 'untrusted'), /INVALID_DIVIDEND_PROPOSAL/, `invalid apply ${index}`);
  }
  assert.deepEqual(await state(), before);
});

test('preview is read-only and confirmation writes only the proposed grid, preserving budgets, positions and other plans', async () => {
  const held = holding('601398');
  await db.accounts.add(account('broker'));
  await db.holdings.add(held);
  await db.holdingTxns.add(trade(held));
  const before = await state();
  const original = await db.dividendStocks.get('601398');
  const draft = { ...proposal(), weightBps: 10000, manualShares: 0, dividendBudgetMinor: 1 };
  const preview = await previewDividendPlanChange(draft);
  assert.deepEqual(await state(), before);
  assert.deepEqual(preview.after.buyLevels, draft.buyLevels);
  await applyDividendPlanChange(draft, preview.fingerprint);
  assert.deepEqual(await db.dividendStocks.get('601398'), { ...original, buyLevels: draft.buyLevels });
  assert.deepEqual(await state(), { ...before, dividendStocks: await db.dividendStocks.toArray() });
  assert.equal((await db.settings.get('main'))?.dividendBudgetMinor, 40000000);
});

test('sell-only proposals preserve the independently saved buy grid', async () => {
  const buyLevels = proposal().buyLevels!;
  await db.dividendStocks.update('601398', { buyLevels });
  const draft = proposal({ buyLevels: undefined, sellLevels: [{ yieldBps: 400, portionBps: 5000 }, { yieldBps: 350, portionBps: 5000 }] });
  const preview = await previewDividendPlanChange(draft);
  await applyDividendPlanChange(draft, preview.fingerprint);
  const saved = await db.dividendStocks.get('601398');
  assert.deepEqual(saved?.buyLevels, buyLevels);
  assert.deepEqual(saved?.sellLevels, draft.sellLevels);
});

test('partial-grid confirmation validates the final saved grid, including opposite-side prices and omitted fields', async () => {
  const buyLevels = [{ yieldBps: 400, portionBps: 5000, priceMinor: 700 }];
  const sellLevels = [{ yieldBps: 300, portionBps: 5000, priceMinor: 900 }];
  await db.dividendStocks.update('601398', { buyLevels, sellLevels });
  const draft = proposal({ buyLevels: undefined, sellLevels: [{ yieldBps: 450, portionBps: 1000, priceMinor: 650 }] });
  assert.equal(isDividendPlanProposal(draft), true);
  const before = await state();
  await assert.rejects(previewDividendPlanChange(draft), /DIVIDEND_GRID_SIDES_CROSS/);
  assert.deepEqual(await state(), before);
});

test('mixed price and yield sides are checked against the recorded DPS before becoming actionable', async () => {
  const draft = proposal({ buyLevels: [{ yieldBps: 500, portionBps: 3000 }], sellLevels: [{ yieldBps: 600, portionBps: 1000, priceMinor: 550 }] });
  assert.equal(isDividendPlanProposal(draft), true);
  const before = await state();
  await assert.rejects(previewDividendPlanChange(draft), /DIVIDEND_GRID_SIDES_CROSS/);
  assert.deepEqual(await state(), before);
});

test('pause-only advice persists the buying pause while preserving grid levels, portfolio quantities and budget', async () => {
  const original = await db.dividendStocks.get('601398');
  const before = await state();
  const draft = proposal({ buyLevels: undefined, buyPaused: true });
  assert.equal(isDividendPlanProposal(draft), true);
  const parsed = parseDividendAdvisorActions(`Pause additions.\n\`\`\`fortuna-actions\n${JSON.stringify([draft])}\n\`\`\``, ['601398']);
  assert.deepEqual(parsed.actions, [{ id: draft.id, code: draft.code, reason: draft.reason, buyPaused: true }]);
  const preview = await previewDividendPlanChange(draft);
  assert.equal(preview.before.buyPaused, false);
  assert.equal(preview.after.buyPaused, true);
  await applyDividendPlanChange(draft, preview.fingerprint);
  assert.deepEqual(await db.dividendStocks.get('601398'), { ...original, buyPaused: true });
  assert.deepEqual(await state(), { ...before, dividendStocks: await db.dividendStocks.toArray() });
  const resume = proposal({ buyLevels: undefined, buyPaused: false });
  const resumed = await previewDividendPlanChange(resume);
  await applyDividendPlanChange(resume, resumed.fingerprint);
  assert.equal((await db.dividendStocks.get('601398'))?.buyPaused, false);
});

test('confirmation rejects stock grid, allocation, DPS and quantity edits made after the preview', async () => {
  const edits: Partial<DividendStock>[] = [
    { buyLevels: [{ yieldBps: 850, portionBps: 10000 }] },
    { sellLevels: [{ yieldBps: 350, portionBps: 10000 }] },
    { weightBps: 3000 }, { manualDpsMicros: 250000 }, { shareMode: 'manual' }, { manualShares: 100 }, { lotSize: 200 }, { buyPaused: true },
    { dividend: { asOf: '2026-10-20', windowStart: '2025-10-20', dpsMicros: 250000, fetchedAt: 1, payments: [] } },
  ];
  for (const edit of edits) {
    await db.dividendStocks.put(stock());
    const preview = await previewDividendPlanChange(proposal());
    await db.dividendStocks.update('601398', edit);
    const changed = await state();
    await assert.rejects(applyDividendPlanChange(proposal(), preview.fingerprint), /DIVIDEND_PLAN_CHANGED/);
    assert.deepEqual(await state(), changed);
  }
});

test('confirmation binds the exact proposal and rejects a changed draft or a deleted stock', async () => {
  const draft = proposal();
  const preview = await previewDividendPlanChange(draft);
  await assert.rejects(applyDividendPlanChange(proposal({ buyLevels: [{ yieldBps: 800, portionBps: 1000, priceMinor: 350 }] }), preview.fingerprint), /DIVIDEND_PLAN_CHANGED/);
  await db.dividendStocks.delete('601398');
  await assert.rejects(applyDividendPlanChange(draft, preview.fingerprint), /DIVIDEND_PLAN_CHANGED/);
  await assert.rejects(previewDividendPlanChange(draft), /DIVIDEND_STOCK_MISSING/);
});

test('risk removal protects manual, linked, cross-account, archived, hidden and future positive holdings', async () => {
  await db.dividendStocks.clear();
  const protectedCodes = ['601398', '600036', '601088', '000651', '000333', '600900', '601939'];
  const removableCodes = ['601288', '600941'];
  await db.dividendStocks.bulkAdd([...protectedCodes, ...removableCodes].map(code => stock(code,
    code === '601398' ? { shareMode: 'manual', manualShares: 20 } : code === '000333' ? { shareMode: 'manual', manualShares: 0 }
      : code === '000651' ? { group: 'hidden' } : {})));
  await db.accounts.bulkAdd([account('broker'), account('other-broker'), account('archived-hidden', { archivedAt: 100, hidden: true, includeInTotals: false })]);
  const positions = [holding('600036'), holding('601088', 'other-broker'), holding('000651', 'archived-hidden'), holding('000333'),
    holding('600900'), holding('601939'), holding('600941')];
  await db.holdings.bulkAdd(positions);
  await db.holdingTxns.bulkAdd(positions.map(held => trade(held,
    held.symbol === '600900' ? { date: '2999-01-01' } : held.symbol === '601939' ? { date: '2999-01-02', kind: 'sell', shares: 0, quantitySnapshot: 100, costPriceSnapshot: 10 } : {})));
  await db.holdingTxns.add(trade(positions.at(-1)!, { id: 'closed-position-sale', date: '2000-01-02', kind: 'sell', createdAt: 2 }));
  const before = await state();
  const codes = [...protectedCodes, ...removableCodes];
  const preview = await previewDividendRiskRemoval(codes);
  assert.deepEqual(preview.protected.map(row => row.code).sort(), protectedCodes.sort());
  assert.deepEqual(preview.removable.map(row => row.code).sort(), removableCodes.sort());
  assert.deepEqual(await state(), before);
  const result = await removeDividendRiskStocks(codes);
  assert.deepEqual(result, preview);
  assert.deepEqual((await db.dividendStocks.toArray()).map(row => row.code).sort(), protectedCodes.sort());
  assert.deepEqual(await state(), { ...before, dividendStocks: await db.dividendStocks.toArray() });
});

test('manual mode with zero manually entered shares cannot bypass actual linked holdings', async () => {
  await db.dividendStocks.update('601398', { shareMode: 'manual', manualShares: 0 });
  const held = holding('601398', 'other-account', { symbol: 'SH.601398' });
  await db.accounts.add(account('other-account', { archivedAt: 1, hidden: true }));
  await db.holdings.add(held);
  await db.holdingTxns.add(trade(held));
  const result = await removeDividendRiskStocks(['601398']);
  assert.deepEqual(result.removable, []);
  assert.deepEqual(result.protected.map(row => row.code), ['601398']);
  assert.ok(await db.dividendStocks.get('601398'));
});

test('a buy or manual-share edit after removal preview is rechecked inside the deletion transaction', async () => {
  assert.deepEqual((await previewDividendRiskRemoval(['601398', '600036'])).removable.map(row => row.code).sort(), ['600036', '601398']);
  const held = holding('601398');
  await db.accounts.add(account('broker'));
  await db.holdings.add(held);
  await db.holdingTxns.add(trade(held));
  await db.dividendStocks.update('600036', { shareMode: 'manual', manualShares: 100 });
  const before = await state();
  const result = await removeDividendRiskStocks(['601398', '600036']);
  assert.deepEqual(result.removable, []);
  assert.deepEqual(result.protected.map(row => row.code).sort(), ['600036', '601398']);
  assert.deepEqual(await state(), before);
});

test('risk deletion preserves remaining stock weights and the unallocated budget without redistributing', async () => {
  const remaining = await db.dividendStocks.get('600036');
  await removeDividendRiskStocks(['601398', '600900']);
  assert.deepEqual(await db.dividendStocks.toArray(), [remaining]);
  assert.equal((await db.settings.get('main'))?.dividendBudgetMinor, 40000000);
  assert.equal((await db.dividendStocks.get('600036'))?.weightBps, 1500);
});

test('invalid risk-removal requests reject without writes and already absent stocks remain harmless', async () => {
  const before = await state();
  for (const codes of [[], ['SH.601398'], ['00700'], [12345], Array(501).fill('601398')]) {
    await assert.rejects(removeDividendRiskStocks(codes as string[]), /INVALID_DIVIDEND_REMOVAL/);
  }
  assert.deepEqual(await state(), before);
  assert.deepEqual(await removeDividendRiskStocks(['000001']), { removable: [], protected: [] });
});

test('selection principles persist and survive full JSON and Excel backup replacement', async () => {
  assert.deepEqual(await loadDividendSelectionPrinciples(), defaultDividendSelectionPrinciples());
  const principles: DividendSelectionPrinciples = { ...defaultDividendSelectionPrinciples(), minYieldBps: 550, minRoeBps: 950,
    minRevenueGrowthBps: -500, minProfitGrowthBps: 100, maxDebtAssetBps: 6500, minCashProfitBps: 9500, maxPayoutBps: 9000, minDividendYears: 5 };
  await saveDividendSelectionPrinciples(principles);
  const json = await exportData();
  const excel = await exportToExcel();
  assert.deepEqual(JSON.parse(json).settings[0].dividendSelectionPrinciples, principles);
  const book = XLSX.read(excel, { type: 'base64' });
  const settingsRows = XLSX.utils.sheet_to_json<{ dividendSelectionPrinciples: string }>(book.Sheets.Settings);
  assert.deepEqual(JSON.parse(settingsRows[0].dividendSelectionPrinciples), principles);
  for (const restore of [() => importData(json), () => importFromExcel(excel)]) {
    await saveDividendSelectionPrinciples(defaultDividendSelectionPrinciples());
    await db.dividendStocks.clear();
    assert.equal(await restore(), true);
    assert.deepEqual(await loadDividendSelectionPrinciples(), principles);
    assert.equal(await db.dividendStocks.count(), 3);
    assert.equal((await db.settings.get('main'))?.dividendBudgetMinor, 40000000);
  }
});

test('invalid screening thresholds reject in settings writes and JSON or Excel restore without replacing current data', async () => {
  const defaults = defaultDividendSelectionPrinciples();
  const invalid: unknown[] = [null, [], {}, { ...defaults, minYieldBps: '500' }, { ...defaults, minYieldBps: -1 },
    { ...defaults, minRoeBps: 100.5 }, { ...defaults, maxDebtAssetBps: 10001 }, { ...defaults, minRevenueGrowthBps: -10001 },
    { ...defaults, minCashProfitBps: Number.NaN }, { ...defaults, minDividendYears: 0 }, { ...defaults, minDividendYears: 11 }];
  const json = await exportData();
  const excel = await exportToExcel();
  const before = await state();
  for (const principles of invalid) {
    await assert.rejects(saveDividendSelectionPrinciples(principles as DividendSelectionPrinciples), /INVALID_DIVIDEND_PRINCIPLES/);
    const payload = JSON.parse(json);
    payload.settings[0].dividendSelectionPrinciples = principles;
    assert.equal(await importData(JSON.stringify(payload)), false);
    const book = XLSX.read(excel, { type: 'base64' });
    const settingsRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(book.Sheets.Settings);
    settingsRows[0].dividendSelectionPrinciples = JSON.stringify(principles);
    book.Sheets.Settings = XLSX.utils.json_to_sheet(settingsRows);
    assert.equal(await importFromExcel(XLSX.write(book, { type: 'base64', bookType: 'xlsx' })), false);
    assert.deepEqual(await state(), before);
  }
});

test('pricing method and documented stock normalisation survive JSON and Excel replacement', async () => {
  assert.deepEqual(await loadDividendPricingMethod(), defaultDividendPricingMethod());
  const method: DividendPricingMethod = { ...defaultDividendPricingMethod(), requiredReturnBps: 900, growthBps: 100,
    safetyMarginBps: 2000, opportunityCostBps: 550, opportunityCostAsOf: '2026-10-21', opportunityCostSource: 'Dated comparable observation',
    stockOverrides: { '601398': { riskClass: 'bank', normalizedEpsMicros: 950000, normalizationAsOf: '2026-10-21', normalizationSource: 'User reviewed three annual reports' } } };
  await saveDividendPricingMethod(method);
  const json = await exportData();
  const excel = await exportToExcel();
  assert.deepEqual(JSON.parse(json).settings[0].dividendPricingMethod, method);
  for (const restore of [() => importData(json), () => importFromExcel(excel)]) {
    await saveDividendPricingMethod(defaultDividendPricingMethod());
    assert.equal(await restore(), true);
    assert.deepEqual(await loadDividendPricingMethod(), method);
    assert.equal(await db.dividendStocks.count(), 3);
  }
});

test('manual plan-management removal uses the same holding protection and leaves allocations untouched', async () => {
  const { deleteDividendStock } = await import('../src/services/dividendService.ts');
  await db.dividendStocks.update('601398', {manualShares: 100});
  const before = await state();
  await assert.rejects(deleteDividendStock('601398'), /DIVIDEND_STOCK_HELD/);
  assert.deepEqual(await state(), before);
  await db.accounts.add(account('archived-broker', {archivedAt:1}));
  const held=holding('600036','archived-broker');await db.holdings.add(held);await db.holdingTxns.add(trade(held));
  await assert.rejects(deleteDividendStock('600036',false), /DIVIDEND_STOCK_HELD/);
  assert.equal((await db.dividendStocks.get('600036'))?.weightBps,1500);
});

test('malformed pricing method never replaces saved settings through either backup path', async () => {
  const defaults = defaultDividendPricingMethod();
  const json = await exportData(), excel = await exportToExcel(), before = await state();
  const invalid: unknown[] = [null, {}, [], { ...defaults, requiredReturnBps: '800' }, { ...defaults, growthBps: 301 },
    { ...defaults, historicalPercentileBps: 6900 }, { ...defaults, safetyMarginBps: 500 },
    { ...defaults, riskPremiumBps: { bank: 225 } }, { ...defaults, stockOverrides: { '601398': { normalizedEpsMicros: -1 } } }];
  for (const method of invalid) {
    await assert.rejects(saveDividendPricingMethod(method as DividendPricingMethod), /INVALID_DIVIDEND_PRICING_METHOD/);
    const payload = JSON.parse(json);
    payload.settings[0].dividendPricingMethod = method;
    assert.equal(await importData(JSON.stringify(payload)), false);
    const book = XLSX.read(excel, { type: 'base64' });
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(book.Sheets.Settings);
    rows[0].dividendPricingMethod = JSON.stringify(method);
    book.Sheets.Settings = XLSX.utils.json_to_sheet(rows);
    assert.equal(await importFromExcel(XLSX.write(book, { type: 'base64', bookType: 'xlsx' })), false);
    assert.deepEqual(await state(), before);
  }
});
