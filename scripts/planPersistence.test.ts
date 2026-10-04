import test, { beforeEach, after } from 'node:test';
import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';

// The app uses bundler-style extensionless imports and JSON modules. Teach the
// native Node test runner just enough of Vite's resolution rules for this unit.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if ((specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL) {
      const candidate = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(candidate)) return { url: candidate.href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.endsWith('.json')) {
      return {
        format: 'module',
        source: `export default ${readFileSync(new URL(url), 'utf8')}`,
        shortCircuit: true,
      };
    }
    return nextLoad(url, context);
  },
});

const { db, initializeSettings, updateSettings, exportToExcel, importFromExcel } = await import('../src/db.ts');
const { createPlanItem, createInitialPlanItems, updatePlanItem, getPlanStatus, createPlanTarget, updatePlanTarget, setPlanTargetTotal } = await import('../src/services/planService.ts');

beforeEach(async () => {
  await db.transaction('rw', db.tables, async () => {
    for (const table of db.tables) await table.clear();
  });
  await initializeSettings();
  await db.settings.update('main', { primaryCurrency: 'CNY' });
});
after(() => db.close());

async function seedAccount() {
  await db.accounts.add({ id: 'qa-account', name: 'Synthetic cash', category: '现金', type: 'asset', currency: 'CNY', createdAt: 1, sortOrder: 0 });
  await db.records.add({ id: 'qa-record', accountId: 'qa-account', date: '2026-09-22', amount: 240000, createdAt: 1 });
  await setPlanTargetTotal(1000000);
}

test('plan amount, actual progress and purchase notes survive updates and Excel restore', async () => {
  await seedAccount();
  const notes = 'Unowned ETF 001\nDeposit; compare terms';
  const id = await createPlanItem({ name: 'Cash plan', categories: ['现金'], targetPercent: 36, plannedPurchases: notes });
  const targetId = await createPlanTarget({ planItemId: id, label: 'Legacy reserve', targetPercent: 20, refKeys: ['a:qa-account'], allocations: [{ refKey: 'a:qa-account', amountMinor: 10000000 }] });
  await updatePlanItem(id, { targetPercent: 350000.01 / 1000000 * 100 });
  const before = await getPlanStatus();
  assert.ok(Math.abs(before.items[0].targetValue - 350000.01) < 0.000001);
  assert.equal(before.items[0].currentValue, 240000);
  assert.equal(before.items[0].currentPercent, 100);
  assert.equal(before.items[0].plannedPurchases, notes);
  assert.equal(before.items[0].targets[0].currentValue, 100000);
  const backup = await exportToExcel();
  await updatePlanItem(id, { plannedPurchases: 'changed' });
  assert.equal(await importFromExcel(backup), true);
  assert.equal((await db.planItems.get(id))?.plannedPurchases, notes);
  assert.deepEqual((await db.planTargets.get(targetId))?.refKeys, ['a:qa-account']);
  assert.deepEqual((await db.planTargets.get(targetId))?.allocations, [{ refKey: 'a:qa-account', amountMinor: 10000000 }]);
  await updatePlanTarget(targetId, { refKeys: [], allocations: [] });
  const after = await getPlanStatus();
  assert.equal(after.items[0].currentValue, 240000);
  assert.equal(after.items[0].targets[0].currentValue, 0);
});

test('old plans without purchase notes remain readable and gain notes without losing links', async () => {
  await seedAccount();
  const id = await createPlanItem({ name: 'Old plan', categories: ['现金'], targetPercent: 50 });
  const before = await getPlanStatus();
  assert.equal(before.items[0].plannedPurchases, undefined);
  await updatePlanItem(id, { plannedPurchases: 'Future deposit' });
  const after = await getPlanStatus();
  assert.equal(after.items[0].currentValue, 240000);
  assert.deepEqual(after.items[0].categories, ['现金']);
  assert.equal(after.items[0].plannedPurchases, 'Future deposit');
});

test('initial plan keeps fractional allocations and rejects a duplicate retry', async () => {
  const entries = ['现金', '银行存款', '其他资产'].map(name => ({ name, categories: [name], targetPercent: 100 / 3 }));
  await createInitialPlanItems(entries);
  const status = await getPlanStatus();
  assert.ok(Math.abs(status.targetPercentSum - 100) < 0.000001);
  await assert.rejects(createInitialPlanItems(entries), /PLAN_ALREADY_EXISTS/);
  assert.equal(await db.planItems.count(), 3);
});

test('initial plan rolls back all categories if one write fails', async () => {
  const failSecond = (_key: unknown, item: { name: string }) => {
    if (item.name === 'fail') throw new Error('simulated write failure');
  };
  db.planItems.hook('creating', failSecond);
  try {
    await assert.rejects(createInitialPlanItems([
      { name: 'first', categories: ['现金'], targetPercent: 50 },
      { name: 'fail', categories: ['银行存款'], targetPercent: 50 },
    ]), /simulated write failure/);
    assert.equal(await db.planItems.count(), 0);
  } finally {
    db.planItems.hook('creating').unsubscribe(failSecond);
  }
});


test('deleted plan links are cleaned persistently while excluded-account labels remain accurate', async () => {
  await seedAccount();
  await db.accounts.update('qa-account', { includeInTotals: false });
  const id = await createPlanItem({ name: 'Cleanup', targetPercent: 15, categories: ['acct:gone', 'acct:qa-account', 'hold:gone'], plannedPurchases: 'keep this' });
  const status = await getPlanStatus();
  assert.deepEqual(status.items[0].categories, ['acct:qa-account']);
  assert.equal(status.scopeNames?.['acct:qa-account']?.inactive, true);
  assert.equal(status.scopeNames?.['acct:qa-account']?.name, 'Synthetic cash');
  assert.deepEqual((await db.planItems.get(id))?.categories, ['acct:qa-account']);
});

test('dividend budget, overrides, grid and cache survive JSON and Excel backup with ledger preserved', async () => {
  const { exportData, importData } = await import('../src/db.ts');
  const { loadDividendWorkbench, saveDividendBudget, saveDividendStock } = await import('../src/services/dividendService.ts');
  await seedAccount();
  const initial = await loadDividendWorkbench();
  assert.equal(initial.stocks.length, 19);
  assert.equal(initial.budgetMinor, 0);
  await saveDividendBudget(32100012);
  await saveDividendStock({ ...initial.stocks[0], shareMode: 'manual', manualShares: 1234, manualDpsMicros: 310300, buyLevels: [{ yieldBps: 550, portionBps: 10000, priceMinor: 512 }], note: 'my note' });
  const json = await exportData();
  const excel = await exportToExcel();
  for (const restore of [() => importData(json), () => importFromExcel(excel)]) {
    await db.dividendStocks.clear();
    await saveDividendBudget(0);
    assert.equal(await restore(), true);
    const actual = await loadDividendWorkbench();
    assert.equal(actual.budgetMinor, 32100012);
    const stock = actual.stocks.find(s => s.code === initial.stocks[0].code)!;
    assert.equal(stock.manualShares, 1234);
    assert.equal(stock.manualDpsMicros, 310300);
    assert.equal(stock.buyLevels?.[0].priceMinor, 512);
    assert.equal(stock.note, 'my note');
    assert.equal(await db.records.count(), 1);
  }
  const bad = JSON.parse(json); bad.dividendStocks[0].weightBps = -1;
  assert.equal(await importData(JSON.stringify(bad)), false);
  assert.equal(await db.records.count(), 1);
});

test('saved dividend budgets survive stale-page preference edits, simultaneous plan edits and database reopen', async () => {
  const { loadDividendWorkbench, saveDividendBudget } = await import('../src/services/dividendService.ts');
  const stalePageSettings = await initializeSettings();
  await loadDividendWorkbench();
  await saveDividendBudget(12345678);
  await updateSettings({ showArchivedAccounts: !stalePageSettings.showArchivedAccounts });
  assert.equal((await loadDividendWorkbench()).budgetMinor, 12345678);
  assert.equal((await initializeSettings()).dividendWorkbenchInitialized, true);
  await Promise.all([
    saveDividendBudget(32100012),
    setPlanTargetTotal(1000000),
    updateSettings({ language: 'en', fontSize: 'large' }),
  ]);
  db.close();
  await db.open();
  const reopened = await loadDividendWorkbench();
  assert.equal(reopened.budgetMinor, 32100012);
  assert.equal(reopened.budgetConfigured, true);
  const settings = await initializeSettings();
  assert.equal(settings.planTargetTotal, 1000000);
  assert.equal(settings.fontSize, 'large');
  await saveDividendBudget(0);
  assert.equal((await loadDividendWorkbench()).budgetConfigured, true);
  await assert.rejects(saveDividendBudget(0.5), /INVALID_BUDGET/);
  await assert.rejects(saveDividendBudget(-1), /INVALID_BUDGET/);
  await db.settings.delete('main');
  await saveDividendBudget(123);
  assert.equal((await loadDividendWorkbench()).budgetMinor, 123);
});

async function seedLinkedStocks() {
  await db.accounts.add({ id: 'stocks', name: 'Synthetic broker', category: '股票/ETF', type: 'asset', currency: 'CNY', portfolio: true, createdAt: 1, sortOrder: 0 });
  for (const [i, code] of ['600519', '688981', '002594'].entries()) {
    await db.holdings.add({ id: code, accountId: 'stocks', name: `Fixture ${code}`, symbol: code, market: 'A股', lastPrice: 10, createdAt: 1, sortOrder: i });
    await db.holdingTxns.add({ id: `buy-${code}`, holdingId: code, accountId: 'stocks', kind: 'buy', shares: 200, price: 10, date: '2020-01-01', createdAt: 1 });
  }
}

test('held-stock import adds only selected, still-held codes and preserves existing edits and ledgers', async () => {
  const { addLinkedDividendStocks, loadDividendWorkbench, saveDividendStock } = await import('../src/services/dividendService.ts');
  await seedLinkedStocks();
  const initial = await loadDividendWorkbench();
  const existing = { ...initial.stocks[0], shareMode: 'manual' as const, manualShares: 345, note: 'retain override' };
  await saveDividendStock(existing);
  await db.holdingTxns.add({ id: 'sell-002594', holdingId: '002594', accountId: 'stocks', kind: 'sell', shares: 200, price: 10, date: '2020-01-02', createdAt: 2 });
  assert.equal(await addLinkedDividendStocks(['600519', '600519', existing.code, '002594', 'missing']), 1);
  const added = await db.dividendStocks.get('600519');
  assert.equal(added?.shareMode, 'linked');
  assert.equal(added?.weightBps, 0);
  assert.equal(added?.lotSize, 100);
  assert.equal(await db.dividendStocks.get('688981'), undefined);
  assert.equal(await db.dividendStocks.get('002594'), undefined);
  assert.deepEqual(await db.dividendStocks.get(existing.code), existing);
  assert.equal(await addLinkedDividendStocks(['600519']), 0);
  assert.equal(await addLinkedDividendStocks(['688981']), 1);
  assert.equal((await db.dividendStocks.get('688981'))?.lotSize, 200);
  assert.equal((await loadDividendWorkbench()).positions.get('600519')?.shares, 200);
  assert.equal(await db.holdings.count(), 3);
  assert.equal(await db.holdingTxns.count(), 4);
});

test('stock removal and reallocation commit together, persist on re-entry and preserve the ledger', async () => {
  const { deleteDividendStock, loadDividendWorkbench, saveDividendBudget } = await import('../src/services/dividendService.ts');
  await seedLinkedStocks();
  const initial = await loadDividendWorkbench();
  await saveDividendBudget(32000000);
  await deleteDividendStock('601398');
  const reloaded = await loadDividendWorkbench();
  assert.equal(reloaded.stocks.length, initial.stocks.length - 1);
  assert.equal(reloaded.stocks.some(stock => stock.code === '601398'), false);
  assert.equal(reloaded.stocks.reduce((sum, stock) => sum + stock.weightBps, 0), 10000);
  assert.ok(reloaded.stocks.find(stock => stock.code === '600036')!.weightBps > 1000);
  assert.ok(reloaded.stocks.find(stock => stock.group === 'hidden')!.weightBps > 400);
  assert.equal(reloaded.stocks.find(stock => stock.code === '600900')!.weightBps, 0);
  assert.equal(reloaded.budgetMinor, 32000000);
  assert.equal(await db.holdings.count(), 3);
  assert.equal(await db.holdingTxns.count(), 3);
  const failReallocation = () => { throw new Error('simulated reallocation failure'); };
  db.dividendStocks.hook('updating', failReallocation);
  try {
    await assert.rejects(deleteDividendStock('600036'), /simulated reallocation failure/);
    assert.deepEqual((await loadDividendWorkbench()).stocks, reloaded.stocks);
  } finally {
    db.dividendStocks.hook('updating').unsubscribe(failReallocation);
  }
});

test('held-stock batch rolls back completely if one selected stock cannot be written', async () => {
  const { addLinkedDividendStocks, loadDividendWorkbench } = await import('../src/services/dividendService.ts');
  await seedLinkedStocks();
  const initial = await loadDividendWorkbench();
  const failSecond = (_key: unknown, stock: { code: string }) => {
    if (stock.code === '688981') throw new Error('simulated import failure');
  };
  db.dividendStocks.hook('creating', failSecond);
  try {
    await assert.rejects(addLinkedDividendStocks(['600519', '688981']), /simulated import failure/);
    assert.equal(await db.dividendStocks.get('600519'), undefined);
    assert.equal(await db.dividendStocks.count(), initial.stocks.length);
  } finally {
    db.dividendStocks.hook('creating').unsubscribe(failSecond);
  }
});

test('market refresh preserves manual edits, keeps dated cache on failure and clears failure markers on recovery', async () => {
  const { loadDividendWorkbench, refreshDividendStock, saveDividendStock } = await import('../src/services/dividendService.ts');
  const data = await loadDividendWorkbench();
  const stock = data.stocks.find(s => s.code === '601398')!;
  await saveDividendStock({ ...stock, manualDpsMicros: 500000, manualShares: 1234, quote: { priceMinor: 700, date: '2026-09-24 15:00', fetchedAt: 1 } });
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => { throw new Error('offline'); };
    assert.equal(await refreshDividendStock(stock.code), false);
    const failed = await db.dividendStocks.get(stock.code);
    assert.equal(failed?.quote?.priceMinor, 700);
    assert.ok(failed?.quoteFailedAt);
    assert.equal(failed?.dividend, undefined);
    const fields = Array(50).fill(''); fields[2] = stock.code; fields[3] = '8.13'; fields[30] = '20260924161400';
    globalThis.fetch = async input => new Response(String(input).startsWith('/qt-api') ? `v_sh601398="${fields.join('~')}"` : JSON.stringify({success: true, result: {pages: 1, data: [{ SECURITY_CODE: stock.code, PRETAX_BONUS_RMB: 1.689, EX_DIVIDEND_DATE: new Date().toISOString().slice(0,10), REPORT_DATE: '2025-12-31 00:00:00', ASSIGN_PROGRESS: '实施分配' }]}}));
    assert.equal(await refreshDividendStock(stock.code), true);
    const recovered = await db.dividendStocks.get(stock.code);
    assert.equal(recovered?.manualDpsMicros, 500000);
    assert.equal(recovered?.manualShares, 1234);
    assert.equal(recovered?.quote?.priceMinor, 813);
    assert.equal(recovered?.quoteFailedAt, undefined);
    assert.equal(recovered?.dividendFailedAt, undefined);
    assert.equal(recovered?.dividend?.payments[0].dpsMicros, 168900);
  } finally { globalThis.fetch = originalFetch; }
});
