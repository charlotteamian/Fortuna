import test, { beforeEach, after } from 'node:test';
import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
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

const { db, initializeSettings, exportData, importData, exportToExcel, importFromExcel } = await import('../src/db.ts');
const { updateHoldingPositions, importHoldingPositions, importHoldingScreenshot, getHoldingsWithPositions, deleteHoldingTxn } = await import('../src/services/holdingService.ts');
const { holdingRealizedEvents } = await import('../src/services/pnlService.ts');
const { formatLocalDate } = await import('../src/lib/localDate.ts');
const { normalizeHoldingIdentity } = await import('../src/lib/holdingImportIdentity.ts');
const today = formatLocalDate();

beforeEach(async () => {
  await db.transaction('rw', db.tables, async () => { for (const table of db.tables) await table.clear(); });
  await initializeSettings();
  await db.accounts.bulkAdd([
    { id: 'stocks', name: 'Broker', category: '股票/ETF', type: 'asset', currency: 'CNY', portfolio: true, cashBalance: 123.45, institution: 'Original broker', productData: { custom: 'keep' }, sortOrder: 0, createdAt: 1 },
    { id: 'other-stocks', name: 'Other broker', category: '股票/ETF', type: 'asset', currency: 'CNY', portfolio: true, cashBalance: 500, sortOrder: 1, createdAt: 1 },
    { id: 'bank', name: 'Deposit', category: '银行存款', type: 'asset', currency: 'CNY', portfolio: true, cashBalance: 300, sortOrder: 2, createdAt: 1 },
    { id: 'fund', name: 'Fund', category: '场外基金', type: 'asset', currency: 'CNY', portfolio: true, sortOrder: 3, createdAt: 1 },
  ]);
  await db.holdings.bulkAdd([
    { id: 'h', accountId: 'stocks', name: 'Original ETF name', symbol: '510300', market: 'A股', mode: 'unit', lastPrice: 11, priceDate: '2000-02-01', productData: { memo: 'keep' }, sortOrder: 3, createdAt: 1 },
    { id: 'omitted', accountId: 'stocks', name: 'Omitted ETF', symbol: '159915', market: 'A股', lastPrice: 2, sortOrder: 5, createdAt: 2 },
    { id: 'other-h', accountId: 'other-stocks', name: 'Same code elsewhere', symbol: '510300', market: 'A股', lastPrice: 22, sortOrder: 0, createdAt: 1 },
    { id: 'bank-h', accountId: 'bank', name: 'Bank product', symbol: '510300', mode: 'balance', lastPrice: 1, sortOrder: 0, createdAt: 1 },
    { id: 'fund-h', accountId: 'fund', name: 'OTC fund', symbol: '510300', lastPrice: 3, sortOrder: 0, createdAt: 1 },
  ]);
  await db.holdingTxns.bulkAdd([
    { id: 'buy', accountId: 'stocks', holdingId: 'h', date: '2000-01-01', kind: 'buy', shares: 100, price: 10, createdAt: 1 },
    { id: 'sell', accountId: 'stocks', holdingId: 'h', date: '2000-02-01', kind: 'sell', shares: 20, price: 15, createdAt: 2 },
    { id: 'omitted-buy', accountId: 'stocks', holdingId: 'omitted', date: '2000-01-01', kind: 'buy', shares: 10, price: 2, createdAt: 1 },
    { id: 'other-buy', accountId: 'other-stocks', holdingId: 'other-h', date: '2000-01-01', kind: 'buy', shares: 10, price: 20, createdAt: 1 },
  ]);
  await db.records.bulkAdd([
    { id: 'other-record', accountId: 'other-stocks', date: today, amount: 720, createdAt: 1 },
    { id: 'bank-record', accountId: 'bank', date: today, amount: 300, createdAt: 1 },
  ]);
  await db.planItems.add({ id: 'plan', name: 'Stocks plan', categories: ['hold:h'], sortOrder: 0, createdAt: 1, targetPercent: 50 });
  await db.planTargets.add({ id: 'target', planItemId: 'plan', label: 'ETF', refKeys: ['h:h'], sortOrder: 0, createdAt: 1 });
});
after(() => db.close());

async function state() {
  return {
    accounts: await db.accounts.toArray(), holdings: await db.holdings.toArray(),
    txns: await db.holdingTxns.toArray(), records: await db.records.toArray(),
  };
}

test('batch quantities and prices only change the chosen stock account and preserve cost/history/references', async () => {
  const before = await state();
  await updateHoldingPositions('stocks', [{ holdingId: 'h', shares: 50, price: 12.345 }], today);
  const afterState = await state();
  assert.deepEqual(afterState.accounts, before.accounts);
  assert.deepEqual(afterState.holdings.filter(h => h.id !== 'h'), before.holdings.filter(h => h.id !== 'h'));
  assert.deepEqual(afterState.txns.filter(tx => tx.quantitySnapshot === undefined), before.txns);
  assert.deepEqual(afterState.records.filter(r => r.accountId !== 'stocks'), before.records);
  assert.deepEqual((await db.planTargets.get('target'))?.refKeys, ['h:h']);
  assert.deepEqual((await db.planItems.get('plan'))?.categories, ['hold:h']);
  const h = (await getHoldingsWithPositions('stocks')).find(h => h.id === 'h')!;
  assert.equal(h.position.shares, 50);
  assert.equal(h.position.avgCost, 10);
  assert.equal(h.position.realizedPnl, 100);
  assert.equal(h.position.realizedCostBasis, 200);
  assert.equal(h.name, 'Original ETF name');
  assert.equal(h.sortOrder, 3);
  assert.deepEqual(h.productData, { memo: 'keep' });
  assert.equal(h.lastPrice, 12.345);
  assert.equal((await db.records.where('accountId').equals('stocks').first())?.amount, 760.7);
});

test('price-only changes and identical retries do not create correction transactions', async () => {
  await updateHoldingPositions('stocks', [{ holdingId: 'h', shares: 80, price: 12 }], today);
  assert.equal(await db.holdingTxns.count(), 4);
  await updateHoldingPositions('stocks', [{ holdingId: 'h', shares: 50, price: 12 }], today);
  const first = await state();
  await updateHoldingPositions('stocks', [{ holdingId: 'h', shares: 50, price: 12 }], today);
  assert.deepEqual(await state(), first);
});

test('zero quantity clears the current holding without inventing realized returns or removing it', async () => {
  await updateHoldingPositions('stocks', [{ holdingId: 'h', shares: 0, price: 0 }], today);
  const h = (await getHoldingsWithPositions('stocks')).find(h => h.id === 'h')!;
  assert.equal(h.position.shares, 0);
  assert.equal(h.position.costBasis, 0);
  assert.equal(h.position.realizedPnl, 100);
  assert.equal(h.position.realizedCostBasis, 200);
  assert.equal(h.marketValue, 0);
  assert.ok(await db.holdings.get('h'));
  assert.deepEqual((await db.planTargets.get('target'))?.refKeys, ['h:h']);
});

test('cost corrections anchor later trades and both realized-profit calculations agree', async () => {
  await updateHoldingPositions('stocks', [{ holdingId: 'h', shares: 50, price: 12, costPrice: 9 }], today);
  const anchor = await db.holdingTxns.where('holdingId').equals('h').toArray();
  const createdAt = Math.max(...anchor.map(tx => tx.createdAt));
  await db.holdingTxns.add({ id: 'later-sell', accountId: 'stocks', holdingId: 'h', date: today, kind: 'sell', shares: 10, price: 14, createdAt: createdAt + 1 });
  const h = (await getHoldingsWithPositions('stocks')).find(h => h.id === 'h')!;
  assert.equal(h.position.shares, 40);
  assert.equal(h.position.avgCost, 9);
  assert.equal(h.position.realizedPnl, 150);
  const events = holdingRealizedEvents(await db.holdingTxns.where('holdingId').equals('h').toArray(), 'CNY');
  assert.deepEqual(events, [
    { date: '2000-02-01', amount: 100, currency: 'CNY' },
    { date: today, amount: 50, currency: 'CNY' },
  ]);
});

test('known US options retain contract multipliers when batch quantities change', async () => {
  await db.holdings.update('h', { instrumentType: 'us_option', contractMultiplier: 100 });
  await updateHoldingPositions('stocks', [{ holdingId: 'h', shares: 2, price: 3, costPrice: 2 }], today);
  const h = (await getHoldingsWithPositions('stocks')).find(h => h.id === 'h')!;
  assert.equal(h.position.costBasis, 400);
  assert.equal(h.marketValue, 600);
  assert.equal(h.position.realizedPnl, 10000);
});

test('scope, stale dates and invalid values reject a whole batch before any edits', async () => {
  const before = await state();
  await assert.rejects(updateHoldingPositions('stocks', [
    { holdingId: 'h', shares: 50, price: 12 }, { holdingId: 'other-h', shares: 1, price: 1 },
  ], today), /HOLDING_POSITION_HOLDING_SCOPE/);
  await assert.rejects(updateHoldingPositions('bank', [{ holdingId: 'bank-h', shares: 1, price: 1 }], today), /HOLDING_POSITION_ACCOUNT_INVALID/);
  await assert.rejects(updateHoldingPositions('fund', [{ holdingId: 'fund-h', shares: 1, price: 1 }], today), /HOLDING_POSITION_ACCOUNT_INVALID/);
  await assert.rejects(updateHoldingPositions('stocks', [{ holdingId: 'h', shares: 1, price: 1 }], '2000-01-01'), /HOLDING_POSITION_DATE_STALE/);
  await assert.rejects(updateHoldingPositions('stocks', [{ holdingId: 'h', shares: -1, price: 1 }], today), /HOLDING_POSITION_VALUES_INVALID/);
  await assert.rejects(updateHoldingPositions('stocks', [{ holdingId: 'h', shares: 1, price: Infinity }], today), /HOLDING_POSITION_VALUES_INVALID/);
  await assert.rejects(updateHoldingPositions('stocks', [{ holdingId: 'h', shares: 1, price: 1 }], '2000-02-30'), /HOLDING_POSITION_DATE_INVALID/);
  assert.deepEqual(await state(), before);
});

test('a failed write rolls back every holding, correction and account snapshot', async () => {
  const before = await state();
  const failSecond = (_key: unknown, tx: { holdingId: string; quantitySnapshot?: number }) => {
    if (tx.holdingId === 'omitted' && tx.quantitySnapshot !== undefined) throw new Error('simulated snapshot failure');
  };
  db.holdingTxns.hook('creating', failSecond);
  try {
    await assert.rejects(updateHoldingPositions('stocks', [
      { holdingId: 'h', shares: 50, price: 12 }, { holdingId: 'omitted', shares: 20, price: 3 },
    ], today), /simulated snapshot failure/);
    assert.deepEqual(await state(), before);
  } finally {
    db.holdingTxns.hook('creating').unsubscribe(failSecond);
  }
});

test('import merges canonical code and market, retains omitted holdings and is repeatable', async () => {
  const before = await state();
  const rows = [
    { name: 'Imported alias', symbol: 'SH510300', market: 'a', shares: 60, price: 13 },
    { name: 'New stock', symbol: 'sz000001', market: 'A-Share', shares: 100, price: 11, costPrice: 9.5 },
  ];
  const result = await importHoldingPositions('stocks', rows, today);
  assert.deepEqual(result, { created: 1, updated: 1 });
  const positions = await getHoldingsWithPositions('stocks');
  assert.equal(positions.length, 3);
  assert.equal(positions.find(h => h.id === 'h')?.position.shares, 60);
  assert.equal(positions.find(h => h.id === 'h')?.name, 'Original ETF name');
  const added = positions.find(h => h.symbol === '000001')!;
  assert.equal(added.position.avgCost, 9.5);
  assert.equal(added.position.realizedPnl, 0);
  assert.equal(added.sortOrder, 6);
  const first = await state();
  assert.deepEqual(await importHoldingPositions('stocks', rows, today), { created: 0, updated: 0 });
  assert.deepEqual(await state(), first);
  assert.deepEqual(first.accounts, before.accounts);
  assert.deepEqual(first.holdings.filter(h => h.accountId !== 'stocks'), before.holdings.filter(h => h.accountId !== 'stocks'));
  assert.deepEqual(first.records.filter(r => r.accountId !== 'stocks'), before.records);
});

test('import requires new-position cost and rejects duplicate or ambiguous securities atomically', async () => {
  const before = await state();
  await assert.rejects(importHoldingPositions('stocks', [
    { name: 'Existing', symbol: '510300', shares: 60, price: 13 },
    { name: 'New', symbol: '000001', shares: 100, price: 11 },
  ], today), /HOLDING_POSITION_COST_REQUIRED/);
  await assert.rejects(importHoldingPositions('stocks', [
    { name: 'Existing', symbol: '510300', shares: 60, price: 13 },
    { name: 'Duplicate', symbol: '510300.SH', shares: 70, price: 14 },
  ], today), /HOLDING_POSITION_DUPLICATE/);
  assert.deepEqual(await state(), before);
  await db.holdings.add({ ...before.holdings.find(h => h.id === 'h')!, id: 'duplicate-h', symbol: 'sh510300' });
  const ambiguous = await state();
  await assert.rejects(importHoldingPositions('stocks', [{ name: 'ETF', symbol: '510300', shares: 60, price: 13 }], today), /HOLDING_POSITION_AMBIGUOUS_MATCH/);
  assert.deepEqual(await state(), ambiguous);
});

test('quantity and average-cost anchors survive JSON and Excel backup restore', async () => {
  await updateHoldingPositions('stocks', [{ holdingId: 'h', shares: 50, price: 12, costPrice: 9.25 }], today);
  const before = await state();
  const json = await exportData();
  const excel = await exportToExcel();
  await db.holdingTxns.clear();
  assert.equal(await importData(json), true);
  assert.deepEqual(await state(), before);
  await db.holdingTxns.clear();
  assert.equal(await importFromExcel(excel), true);
  assert.deepEqual((await db.holdingTxns.toArray()).map(tx => [tx.id, tx.quantitySnapshot, tx.costPriceSnapshot]), before.txns.map(tx => [tx.id, tx.quantitySnapshot, tx.costPriceSnapshot]));
  const h = (await getHoldingsWithPositions('stocks')).find(h => h.id === 'h')!;
  assert.equal(h.position.shares, 50);
  assert.equal(h.position.avgCost, 9.25);
  assert.equal(h.position.realizedPnl, 100);
});

test('security identities preserve leading zeros and keep US, HK and A markets separate', () => {
  assert.deepEqual(normalizeHoldingIdentity('sh510300', 'a'), { symbol: '510300', market: 'A股', key: 'A股:510300' });
  assert.deepEqual(normalizeHoldingIdentity('700', 'HK'), { symbol: '00700', market: '港股', key: '港股:00700' });
  assert.deepEqual(normalizeHoldingIdentity('00700.HK'), { symbol: '00700', market: '港股', key: '港股:00700' });
  assert.deepEqual(normalizeHoldingIdentity('usAAPL'), { symbol: 'AAPL', market: '美股', key: '美股:AAPL' });
  assert.equal(normalizeHoldingIdentity('BRK.B', 'US').symbol, 'BRK.B');
  assert.equal(normalizeHoldingIdentity('AAPL.US').symbol, 'AAPL');
  assert.throws(() => normalizeHoldingIdentity('SH510300', 'HK'), /HOLDING_POSITION_MARKET_INVALID/);
  assert.throws(() => normalizeHoldingIdentity('510300', 'unknown'), /HOLDING_POSITION_MARKET_INVALID/);
});

test('code-only existing rows keep their name while a new row requires one', async () => {
  await importHoldingPositions('stocks', [{ name: '', symbol: '510300', shares: 60, price: 13 }], today);
  assert.equal((await db.holdings.get('h'))?.name, 'Original ETF name');
  await assert.rejects(importHoldingPositions('stocks', [{ name: '', symbol: '000001', shares: 10, price: 13, costPrice: 10 }], today), /HOLDING_POSITION_VALUES_INVALID/);
});

test('screenshot holdings reconcile after real dated trades without counting positions twice', async () => {
  const input = {
    holdings: [{ name: 'ETF screenshot', symbol: '510300', shares: 120, price: 14, costPrice: 11 }],
    trades: [
      { symbol: '510300', date: '2000-03-01', kind: 'buy' as const, shares: 100, price: 12, brokerRef: 'BUY-1' },
      { symbol: 'sh510300', date: '2000-04-01', kind: 'sell' as const, shares: 25, price: 15, brokerRef: 'SELL-1' },
    ],
  };
  assert.deepEqual(await importHoldingScreenshot('stocks', input, today), { created: 0, updated: 1, insertedTrades: 2, skippedTrades: 0 });
  const h = (await getHoldingsWithPositions('stocks')).find(h => h.id === 'h')!;
  assert.equal(h.position.shares, 120);
  assert.equal(h.position.avgCost, 11);
  assert.ok(Math.abs(h.position.realizedPnl - (100 + 25 * (15 - 2000 / 180))) < 1e-8);
  assert.equal((await db.holdingTxns.get('buy'))?.shares, 100);
  const first = await state();
  assert.deepEqual(await importHoldingScreenshot('stocks', input, today), { created: 0, updated: 0, insertedTrades: 0, skippedTrades: 2 });
  assert.deepEqual(await state(), first);
});

test('a trade-only screenshot builds a new position from actual fills, preserving other accounts and cash', async () => {
  const before = await state();
  const input = { holdings: [], trades: [
    { name: 'New stock', symbol: '000001', market: 'A股', date: '2000-03-01', kind: 'buy' as const, shares: 100, price: 10 },
    { name: 'New stock', symbol: '000001', market: 'A股', date: '2000-04-01', kind: 'sell' as const, shares: 40, price: 12 },
  ] };
  assert.deepEqual(await importHoldingScreenshot('stocks', input, today), { created: 1, updated: 0, insertedTrades: 2, skippedTrades: 0 });
  const h = (await getHoldingsWithPositions('stocks')).find(h => h.symbol === '000001')!;
  assert.equal(h.position.shares, 60);
  assert.equal(h.position.avgCost, 10);
  assert.equal(h.position.realizedPnl, 80);
  assert.equal(h.lastPrice, 12);
  assert.equal(h.priceDate, '2000-04-01');
  assert.equal(h.marketValue, 720);
  const first = await state();
  assert.deepEqual(first.accounts, before.accounts);
  assert.deepEqual(first.holdings.filter(h => h.accountId !== 'stocks'), before.holdings.filter(h => h.accountId !== 'stocks'));
  assert.deepEqual(first.records.filter(r => r.accountId !== 'stocks'), before.records);
  assert.deepEqual(await importHoldingScreenshot('stocks', input, today), { created: 0, updated: 0, insertedTrades: 0, skippedTrades: 2 });
  assert.deepEqual(await state(), first);
});

test('exact duplicate fill occurrence counts make repeated multi-screenshot imports idempotent', async () => {
  const fill = { symbol: '510300', date: '2000-03-01', kind: 'buy' as const, shares: 10, price: 12 };
  assert.equal((await importHoldingScreenshot('stocks', { holdings: [], trades: [fill, fill] }, today)).insertedTrades, 2);
  const first = await state();
  assert.deepEqual(await importHoldingScreenshot('stocks', { holdings: [], trades: [fill, fill] }, today), { created: 0, updated: 0, insertedTrades: 0, skippedTrades: 2 });
  assert.deepEqual(await state(), first);
});

test('distinct broker references keep identical fills distinct and conflicting references reject atomically', async () => {
  const fill = { symbol: '510300', date: '2000-03-01', kind: 'buy' as const, shares: 10, price: 12 };
  await importHoldingScreenshot('stocks', { holdings: [], trades: [{ ...fill, brokerRef: 'R1' }] }, today);
  assert.equal((await importHoldingScreenshot('stocks', { holdings: [], trades: [{ ...fill, brokerRef: 'R1' }, { ...fill, brokerRef: 'R2' }] }, today)).insertedTrades, 1);
  const first = await state();
  assert.equal((await importHoldingScreenshot('stocks', { holdings: [], trades: [{ ...fill, brokerRef: 'R2' }] }, today)).skippedTrades, 1);
  assert.deepEqual(await state(), first);
  await assert.rejects(importHoldingScreenshot('stocks', { holdings: [], trades: [{ ...fill, brokerRef: 'R1', price: 13 }] }, today), /HOLDING_POSITION_TRADE_REFERENCE_CONFLICT/);
  assert.deepEqual(await state(), first);
});

test('historical trade underflow and an invalid trade date reject the entire mixed import', async () => {
  const before = await state();
  const holdings = [{ name: 'ETF', symbol: '510300', shares: 50, price: 12 }];
  await assert.rejects(importHoldingScreenshot('stocks', { holdings, trades: [
    { name: 'Unseen stock', symbol: '000001', date: '2000-03-01', kind: 'sell', shares: 1, price: 10 },
  ] }, today), /HOLDING_POSITION_TRADE_UNDERFLOW/);
  await assert.rejects(importHoldingScreenshot('stocks', { holdings, trades: [
    { symbol: '510300', date: '2000-02-30', kind: 'buy', shares: 1, price: 10 },
  ] }, today), /HOLDING_POSITION_DATE_INVALID/);
  assert.deepEqual(await state(), before);
});

test('a failed account snapshot write rolls back new holdings and real screenshot trades', async () => {
  const before = await state();
  const failRecord = (_key: unknown, record: { accountId: string }) => {
    if (record.accountId === 'stocks') throw new Error('simulated record failure');
  };
  db.records.hook('creating', failRecord);
  try {
    await assert.rejects(importHoldingScreenshot('stocks', { holdings: [], trades: [
      { name: 'New stock', symbol: '000001', date: '2000-03-01', kind: 'buy', shares: 100, price: 10 },
    ] }, today), /simulated record failure/);
    assert.deepEqual(await state(), before);
  } finally {
    db.records.hook('creating').unsubscribe(failRecord);
  }
});

test('broker references survive backup restore for continued screenshot deduplication', async () => {
  const fill = { symbol: '510300', date: '2000-03-01', kind: 'buy' as const, shares: 10, price: 12, brokerRef: 'PERSISTED-REF' };
  await importHoldingScreenshot('stocks', { holdings: [], trades: [fill] }, today);
  const excel = await exportToExcel();
  await db.holdingTxns.clear();
  assert.equal(await importFromExcel(excel), true);
  assert.ok((await db.holdingTxns.toArray()).some(txn => txn.brokerRef === 'PERSISTED-REF'));
  assert.equal((await importHoldingScreenshot('stocks', { holdings: [], trades: [fill] }, today)).skippedTrades, 1);
});

test('reopening a zero holding requires cost and explicit cost reconciles real buys after a same-day anchor', async () => {
  await updateHoldingPositions('stocks', [{ holdingId: 'h', shares: 0, price: 0 }], today);
  const before = await state();
  await assert.rejects(updateHoldingPositions('stocks', [{ holdingId: 'h', shares: 10, price: 12 }], today), /HOLDING_POSITION_COST_REQUIRED/);
  await assert.rejects(importHoldingPositions('stocks', [{ name: '', symbol: '510300', shares: 10, price: 12 }], today), /HOLDING_POSITION_COST_REQUIRED/);
  assert.deepEqual(await state(), before);
  await updateHoldingPositions('stocks', [{ holdingId: 'h', shares: 10, price: 12, costPrice: 9 }], today);
  const h = (await getHoldingsWithPositions('stocks')).find(h => h.id === 'h')!;
  assert.equal(h.position.avgCost, 9);
  assert.equal(h.position.realizedPnl, 100);
  await updateHoldingPositions('stocks', [{ holdingId: 'h', shares: 0, price: 0 }], today);
  await importHoldingScreenshot('stocks', {
    holdings: [{ name: '', symbol: '510300', shares: 20, price: 12, costPrice: 8 }],
    trades: [{ symbol: '510300', date: today, kind: 'buy', shares: 10, price: 8 }],
  }, today);
  const reopened = (await getHoldingsWithPositions('stocks')).find(h => h.id === 'h')!;
  assert.equal(reopened.position.avgCost, 8);
  assert.equal(reopened.position.shares, 20);
  assert.equal(reopened.position.realizedPnl, 100);
});

test('recognized broker references are adopted on anonymous fills so later distinct references remain distinct', async () => {
  const original = await db.holdingTxns.get('buy');
  const fill = { symbol: '510300', date: '2000-01-01', kind: 'buy' as const, shares: 100, price: 10 };
  assert.deepEqual(await importHoldingScreenshot('stocks', { holdings: [], trades: [{ ...fill, brokerRef: 'R1' }] }, today), { created: 0, updated: 1, insertedTrades: 0, skippedTrades: 1 });
  assert.deepEqual(await db.holdingTxns.get('buy'), { ...original, brokerRef: 'R1' });
  assert.equal((await importHoldingScreenshot('stocks', { holdings: [], trades: [{ ...fill, brokerRef: 'R1' }, { ...fill, brokerRef: 'R2' }] }, today)).insertedTrades, 1);
  const fills = (await db.holdingTxns.where('holdingId').equals('h').toArray()).filter(txn => txn.brokerRef);
  assert.equal(fills.length, 2);
  assert.deepEqual(fills.map(txn => txn.brokerRef).sort(), ['R1', 'R2']);
  const first = await state();
  assert.deepEqual(await importHoldingScreenshot('stocks', { holdings: [], trades: [{ ...fill, brokerRef: 'R1' }, { ...fill, brokerRef: 'R2' }] }, today), { created: 0, updated: 0, insertedTrades: 0, skippedTrades: 2 });
  assert.deepEqual(await state(), first);
});

test('a failed snapshot rolls back reference adoption as well as inserted screenshot fills', async () => {
  const before = await state();
  const failRecord = (_key: unknown, record: { accountId: string }) => {
    if (record.accountId === 'stocks') throw new Error('simulated adoption rollback');
  };
  db.records.hook('creating', failRecord);
  try {
    await assert.rejects(importHoldingScreenshot('stocks', { holdings: [], trades: [
      { symbol: '510300', date: '2000-01-01', kind: 'buy', shares: 100, price: 10, brokerRef: 'R1' },
      { symbol: '510300', date: '2000-03-01', kind: 'buy', shares: 10, price: 12, brokerRef: 'R2' },
    ] }, today), /simulated adoption rollback/);
    assert.deepEqual(await state(), before);
  } finally {
    db.records.hook('creating').unsubscribe(failRecord);
  }
});

test('deleting a quantity correction restores the previous position and reimport adds only one replacement anchor', async () => {
  const row = { name: '', symbol: '510300', shares: 50, price: 12, costPrice: 9 };
  await importHoldingPositions('stocks', [row], today);
  const anchor = (await db.holdingTxns.where('holdingId').equals('h').toArray()).find(txn => txn.quantitySnapshot !== undefined)!;
  await deleteHoldingTxn(anchor.id);
  const restored = (await getHoldingsWithPositions('stocks')).find(h => h.id === 'h')!;
  assert.equal(restored.position.shares, 80);
  assert.equal(restored.position.avgCost, 10);
  assert.equal(restored.position.realizedPnl, 100);
  await importHoldingPositions('stocks', [row], today);
  const anchors = (await db.holdingTxns.where('holdingId').equals('h').toArray()).filter(txn => txn.quantitySnapshot !== undefined);
  assert.equal(anchors.length, 1);
  assert.notEqual(anchors[0].id, anchor.id);
  const first = await state();
  await importHoldingPositions('stocks', [row], today);
  assert.deepEqual(await state(), first);
});

test('deleting an imported real fill permits one reinsertion and subsequent retries skip it', async () => {
  const trade = { symbol: '510300', date: '2000-03-01', kind: 'buy' as const, shares: 10, price: 12, brokerRef: 'DELETE-REF' };
  await importHoldingScreenshot('stocks', { holdings: [], trades: [trade] }, today);
  const fill = (await db.holdingTxns.where('holdingId').equals('h').toArray()).find(txn => txn.brokerRef === 'DELETE-REF')!;
  await deleteHoldingTxn(fill.id);
  const restored = (await getHoldingsWithPositions('stocks')).find(h => h.id === 'h')!;
  assert.equal(restored.position.shares, 80);
  assert.equal(restored.position.realizedPnl, 100);
  assert.equal((await importHoldingScreenshot('stocks', { holdings: [], trades: [trade] }, today)).insertedTrades, 1);
  assert.equal((await db.holdingTxns.where('holdingId').equals('h').toArray()).filter(txn => txn.brokerRef === 'DELETE-REF').length, 1);
  const first = await state();
  assert.equal((await importHoldingScreenshot('stocks', { holdings: [], trades: [trade] }, today)).skippedTrades, 1);
  assert.deepEqual(await state(), first);
});

test('new fills interleaved before stored same-day sells reject rather than silently changing realized P&L', async () => {
  await db.holdings.add({ id: 'same-day', accountId: 'stocks', name: 'Same-day stock', symbol: '000001', market: 'A股', lastPrice: 12, priceDate: '2000-05-01', sortOrder: 6, createdAt: 1 });
  await db.holdingTxns.bulkAdd([
    { id: 'same-day-buy', holdingId: 'same-day', accountId: 'stocks', date: '2000-05-01', kind: 'buy', shares: 100, price: 10, createdAt: 1 },
    { id: 'same-day-sell', holdingId: 'same-day', accountId: 'stocks', date: '2000-05-01', kind: 'sell', shares: 50, price: 12, createdAt: 2 },
  ]);
  const existingBuy = { symbol: '000001', date: '2000-05-01', kind: 'buy' as const, shares: 100, price: 10 };
  const existingSell = { symbol: '000001', date: '2000-05-01', kind: 'sell' as const, shares: 50, price: 12 };
  const newBuy = { symbol: '000001', date: '2000-05-01', kind: 'buy' as const, shares: 100, price: 20 };
  const before = await state();
  await assert.rejects(importHoldingScreenshot('stocks', { holdings: [], trades: [existingBuy, newBuy, existingSell] }, today), /HOLDING_POSITION_TRADE_ORDER_AMBIGUOUS/);
  assert.deepEqual(await state(), before);
  const unchanged = (await getHoldingsWithPositions('stocks')).find(h => h.id === 'same-day')!;
  assert.equal(unchanged.position.realizedPnl, 100);
  assert.equal(unchanged.position.avgCost, 10);
  assert.equal((await importHoldingScreenshot('stocks', { holdings: [], trades: [existingBuy, existingSell, newBuy] }, today)).insertedTrades, 1);
  const appended = (await getHoldingsWithPositions('stocks')).find(h => h.id === 'same-day')!;
  assert.equal(appended.position.realizedPnl, 100);
  assert.equal(appended.position.shares, 150);
  assert.ok(Math.abs(appended.position.avgCost - 2500 / 150) < 1e-9);
});

test('omitted stored same-day executions cannot establish safe append order', async () => {
  const before = await state();
  await assert.rejects(importHoldingScreenshot('stocks', { holdings: [], trades: [
    { symbol: '510300', date: '2000-02-01', kind: 'buy', shares: 100, price: 20 },
  ] }, today), /HOLDING_POSITION_TRADE_ORDER_AMBIGUOUS/);
  assert.deepEqual(await state(), before);
});

test('same-day quantity anchors reject trade-only backfills and sells with uncertain realized cost', async () => {
  await updateHoldingPositions('stocks', [{ holdingId: 'h', shares: 100, price: 12, costPrice: 10 }], today);
  const before = await state();
  const buy = { symbol: '510300', date: today, kind: 'buy' as const, shares: 100, price: 12 };
  const sell = { symbol: '510300', date: today, kind: 'sell' as const, shares: 10, price: 14 };
  await assert.rejects(importHoldingScreenshot('stocks', { holdings: [], trades: [buy] }, today), /HOLDING_POSITION_TRADE_ORDER_AMBIGUOUS/);
  await assert.rejects(importHoldingScreenshot('stocks', { holdings: [{ name: '', symbol: '510300', shares: 90, price: 14, costPrice: 10 }], trades: [sell] }, today), /HOLDING_POSITION_TRADE_ORDER_AMBIGUOUS/);
  await assert.rejects(importHoldingScreenshot('stocks', { holdings: [{ name: '', symbol: '510300', shares: 100, price: 12 }], trades: [buy] }, today), /HOLDING_POSITION_TRADE_ORDER_AMBIGUOUS/);
  assert.deepEqual(await state(), before);
  await importHoldingScreenshot('stocks', { holdings: [{ name: '', symbol: '510300', shares: 100, price: 12, costPrice: 11 }], trades: [buy] }, today);
  const reconciled = (await getHoldingsWithPositions('stocks')).find(h => h.id === 'h')!;
  assert.equal(reconciled.position.shares, 100);
  assert.equal(reconciled.position.avgCost, 11);
  assert.equal(reconciled.position.realizedPnl, 100);
});
