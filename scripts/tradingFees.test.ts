import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import test, { after, beforeEach } from 'node:test';

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

const { calculateAutoTxnFee, resolveHoldingFeeTerms, isManualTxnFee } = await import('../src/lib/holdingPosition.ts');
const { db, initializeSettings, updateSettings, materializeHoldingTxnFees, exportData, importData, exportToExcel, importFromExcel } = await import('../src/db.ts');
const { addHoldingTxn, updateHoldingTxn, getHoldingsWithPositions, recalculateAutoTxnFees, updateHolding } = await import('../src/services/holdingService.ts');
const { getChartPortfolios } = await import('../src/services/chartPortfolioService.ts');
const { getMonthlyRealizedPnl } = await import('../src/services/pnlService.ts');

const terms = (commissionRatePercent: number, minCommission = 0, stampDutyRatePercent = 0) => ({ commissionRatePercent, minCommission, stampDutyRatePercent });

test('automatic fee = commission (not below the minimum) plus stamp duty on sells only', () => {
  const buy = { kind: 'buy' as const, shares: 1000, price: 12 };
  const sell = { kind: 'sell' as const, shares: 1000, price: 12 };
  // 12,000 x 0.01% = 1.20
  assert.equal(calculateAutoTxnFee(buy, 1, terms(0.01)), 1.2);
  assert.equal(calculateAutoTxnFee(sell, 1, terms(0.01)), 1.2);
  // A 5.00 minimum replaces the 1.20 commission.
  assert.equal(calculateAutoTxnFee(buy, 1, terms(0.01, 5)), 5);
  // A minimum does not turn a commission-free holding into a charged one.
  assert.equal(calculateAutoTxnFee(buy, 1, terms(0, 5)), 0);
  // Sell: 1.20 commission + 12,000 x 0.05% = 6.00 stamp duty. Buys never pay stamp duty.
  assert.equal(calculateAutoTxnFee(sell, 1, terms(0.01, 0, 0.05)), 7.2);
  assert.equal(calculateAutoTxnFee(buy, 1, terms(0.01, 0, 0.05)), 1.2);
  assert.equal(calculateAutoTxnFee(sell, 1, terms(0.01, 5, 0.05)), 11);
  // Option contracts are charged on the multiplied notional.
  assert.equal(calculateAutoTxnFee({ kind: 'buy', shares: 2, price: 3 }, 100, terms(0.01)), 0.06);
  assert.equal(calculateAutoTxnFee({ kind: 'buy', shares: 0, price: 12 }, 1, terms(0.01, 5)), 0);
});

test('fee terms: stamp duty is per holding and optional; balance and non-unit holdings never pay', () => {
  const settings = { defaultCommissionRatePercent: 0.02, minCommission: 5, defaultStampDutyRatePercent: 0.05 };
  // The default stamp duty rate is only a fill-in value; it never applies by itself.
  assert.deepEqual(resolveHoldingFeeTerms({}, settings, '股票/ETF'), terms(0.02, 5, 0));
  assert.deepEqual(resolveHoldingFeeTerms({ stampDutyRatePercent: 0.05, commissionRatePercent: 0.01 }, settings, '股票/ETF'), terms(0.01, 5, 0.05));
  assert.deepEqual(resolveHoldingFeeTerms({ mode: 'balance', stampDutyRatePercent: 0.05 }, settings, '银行存款'), terms(0, 0, 0));
  assert.equal(isManualTxnFee({ fee: 1.5 }), true);
  assert.equal(isManualTxnFee({ fee: 1.5, feeSource: 'manual' }), true);
  assert.equal(isManualTxnFee({ fee: 1.5, feeSource: 'auto' }), false);
  assert.equal(isManualTxnFee({}), false);
});

async function seedLegacyLedger() {
  await db.transaction('rw', db.tables, async () => { for (const table of db.tables) await table.clear(); });
  const settings = await initializeSettings();
  // A ledger written by 3.6.0: no stored automatic fees, no fee source, no migration flag.
  await db.settings.put({ ...settings, defaultCommissionRatePercent: 0.01, txnFeesMaterialized: undefined, chartNavAccountIds: ['stocks'] });
  await db.accounts.bulkPut([
    { id: 'stocks', name: 'Stocks', category: '股票/ETF', type: 'asset', currency: 'CNY', portfolio: true, createdAt: 1, sortOrder: 0 },
    { id: 'funds', name: 'Funds', category: '场外基金', type: 'asset', currency: 'CNY', portfolio: true, createdAt: 2, sortOrder: 1 },
  ]);
  await db.holdings.bulkPut([
    { id: 'default-rate', accountId: 'stocks', name: 'Default', symbol: '600000', lastPrice: 11, priceDate: '2026-03-10', sortOrder: 0, createdAt: 1 },
    { id: 'custom-rate', accountId: 'stocks', name: 'Custom', symbol: '510300', commissionRatePercent: 0.03, lastPrice: 4.2, priceDate: '2026-03-10', sortOrder: 1, createdAt: 2 },
    { id: 'fund', accountId: 'funds', name: 'Fund', symbol: '000001', lastPrice: 1.5, sortOrder: 0, createdAt: 3 },
  ]);
  await db.holdingTxns.bulkPut([
    { id: 'b1', accountId: 'stocks', holdingId: 'default-rate', date: '2026-01-05', kind: 'buy', shares: 1000, price: 10, createdAt: 1 },
    { id: 's1', accountId: 'stocks', holdingId: 'default-rate', date: '2026-02-05', kind: 'sell', shares: 400, price: 12, fee: 3.21, createdAt: 2 },
    { id: 'b2', accountId: 'stocks', holdingId: 'custom-rate', date: '2026-01-06', kind: 'buy', shares: 5000, price: 4, createdAt: 3 },
    { id: 's2', accountId: 'stocks', holdingId: 'custom-rate', date: '2026-01-06', kind: 'sell', shares: 2000, price: 4.1, createdAt: 4 },
    { id: 'anchor', accountId: 'stocks', holdingId: 'custom-rate', date: '2026-03-01', kind: 'buy', shares: 0, price: 0, quantitySnapshot: 3500, costPriceSnapshot: 4.05, createdAt: 5 },
    { id: 'f1', accountId: 'funds', holdingId: 'fund', date: '2026-01-07', kind: 'buy', shares: 1000, price: 1.2, createdAt: 6 },
  ]);
}

async function ledgerNumbers() {
  const positions = [...await getHoldingsWithPositions('stocks'), ...await getHoldingsWithPositions('funds')].map(h => ({
    id: h.id, position: h.position, marketValue: h.marketValue, totalPnl: h.totalPnl, txnFees: h.txnFees,
  }));
  const nav = (await getChartPortfolios()).map(item => item.points);
  const monthly = await getMonthlyRealizedPnl();
  return { positions, nav, monthly };
}

beforeEach(seedLegacyLedger);
after(() => db.close());

test('the one-time migration stores every fee without changing a single derived number', async () => {
  // ledgerNumbers() reads settings through initializeSettings(), which would run the
  // migration itself. Hold the flag so materializeHoldingTxnFees() can be tested directly.
  await db.settings.update('main', { txnFeesMaterialized: true });
  const before = await ledgerNumbers();
  assert.equal(before.positions[0].txnFees.b1, 1);
  assert.equal(before.positions[1].txnFees.b2, 6);
  await db.settings.update('main', { txnFeesMaterialized: undefined });

  const changed = await materializeHoldingTxnFees();
  assert.equal(changed, 5);
  const txns = Object.fromEntries((await db.holdingTxns.toArray()).map(tx => [tx.id, tx]));
  assert.deepEqual([txns.b1.fee, txns.b1.feeSource], [1, 'auto']);
  assert.deepEqual([txns.s1.fee, txns.s1.feeSource], [3.21, 'manual']);
  assert.deepEqual([txns.b2.fee, txns.b2.feeSource], [6, 'auto']);
  assert.deepEqual([txns.s2.fee, txns.s2.feeSource], [2.46, 'auto']);
  assert.deepEqual([txns.f1.fee, txns.f1.feeSource], [0, 'auto']);
  // Calibrations carry no fee.
  assert.deepEqual([txns.anchor.fee, txns.anchor.feeSource], [undefined, undefined]);
  assert.equal((await db.settings.get('main'))?.txnFeesMaterialized, true);
  assert.deepEqual(await ledgerNumbers(), before);

  // Running it again changes nothing.
  assert.equal(await materializeHoldingTxnFees(), 0);
  assert.deepEqual(await ledgerNumbers(), before);
});

test('opening the app runs the migration once and marks it done', async () => {
  const before = await ledgerNumbers();
  const settings = await initializeSettings();
  assert.equal(settings.txnFeesMaterialized, true);
  assert.equal((await db.holdingTxns.get('b1'))?.feeSource, 'auto');
  assert.deepEqual(await ledgerNumbers(), before);
});

test('changing rates after the migration leaves history alone and only prices new trades', async () => {
  await materializeHoldingTxnFees();
  const before = await ledgerNumbers();
  await updateSettings({ defaultCommissionRatePercent: 0.05, minCommission: 5 });
  await updateHolding('custom-rate', { commissionRatePercent: 0.1, stampDutyRatePercent: 0.05 });
  assert.deepEqual(await ledgerNumbers(), before);

  // 100 x 11 = 1,100 -> 0.55 commission, raised to the 5.00 minimum.
  const buyId = await addHoldingTxn('stocks', 'default-rate', { date: '2026-03-11', kind: 'buy', shares: 100, price: 11 });
  assert.deepEqual(await db.holdingTxns.get(buyId).then(tx => [tx?.fee, tx?.feeSource]), [5, 'auto']);
  // 1,000 x 4.2 = 4,200 -> 4.20 commission, raised to 5.00, + 2.10 stamp duty.
  const sellId = await addHoldingTxn('stocks', 'custom-rate', { date: '2026-03-11', kind: 'sell', shares: 1000, price: 4.2 });
  assert.deepEqual(await db.holdingTxns.get(sellId).then(tx => [tx?.fee, tx?.feeSource]), [7.1, 'auto']);
  const manualId = await addHoldingTxn('stocks', 'custom-rate', { date: '2026-03-11', kind: 'sell', shares: 100, price: 4.2, fee: 0.126 });
  assert.deepEqual(await db.holdingTxns.get(manualId).then(tx => [tx?.fee, tx?.feeSource]), [0.13, 'manual']);
});

test('editing a trade keeps its automatic fee unless the fill itself changed', async () => {
  await materializeHoldingTxnFees();
  await updateSettings({ defaultCommissionRatePercent: 0.05 });
  // Only the note changes: the 1.00 fee from the old 0.01% rate stays.
  await updateHoldingTxn('b1', { date: '2026-01-05', kind: 'buy', shares: 1000, price: 10, note: 'first lot' });
  assert.deepEqual(await db.holdingTxns.get('b1').then(tx => [tx?.fee, tx?.feeSource, tx?.note]), [1, 'auto', 'first lot']);
  // The price changes: 1,000 x 10.5 x 0.05% = 5.25 at the current rate.
  await updateHoldingTxn('b1', { date: '2026-01-05', kind: 'buy', shares: 1000, price: 10.5 });
  assert.deepEqual(await db.holdingTxns.get('b1').then(tx => [tx?.fee, tx?.feeSource]), [5.25, 'auto']);
  // A typed fee is manual; clearing it returns to automatic at the current rate.
  await updateHoldingTxn('b1', { date: '2026-01-05', kind: 'buy', shares: 1000, price: 10.5, fee: 2 });
  assert.deepEqual(await db.holdingTxns.get('b1').then(tx => [tx?.fee, tx?.feeSource]), [2, 'manual']);
  await updateHoldingTxn('b1', { date: '2026-01-05', kind: 'buy', shares: 1000, price: 10.5 });
  assert.deepEqual(await db.holdingTxns.get('b1').then(tx => [tx?.fee, tx?.feeSource]), [5.25, 'auto']);
});

test('recalculating rewrites automatic fees at the current terms and never touches manual fees', async () => {
  await materializeHoldingTxnFees();
  await updateHolding('custom-rate', { stampDutyRatePercent: 0.05 });
  await updateSettings({ defaultCommissionRatePercent: 0.02 });

  // Scoped to one holding: s2 gains 8,200 x 0.05% = 4.10 stamp duty on top of 2.46.
  assert.equal(await recalculateAutoTxnFees({ holdingId: 'custom-rate' }), 1);
  assert.equal((await db.holdingTxns.get('s2'))?.fee, 6.56);
  assert.equal((await db.holdingTxns.get('b2'))?.fee, 6);
  assert.equal((await db.holdingTxns.get('b1'))?.fee, 1);

  // Everything: b1 moves to 10,000 x 0.02% = 2.00; the manual 3.21 stays.
  assert.equal(await recalculateAutoTxnFees(), 1);
  assert.equal((await db.holdingTxns.get('b1'))?.fee, 2);
  assert.deepEqual(await db.holdingTxns.get('s1').then(tx => [tx?.fee, tx?.feeSource]), [3.21, 'manual']);
  const holding = (await getHoldingsWithPositions('stocks')).find(h => h.id === 'default-rate')!;
  assert.equal(holding.txnFees.b1, 2);
});

test('fee sources, stamp duty and fee settings survive JSON and Excel backups', async () => {
  await materializeHoldingTxnFees();
  await updateSettings({ minCommission: 5, defaultStampDutyRatePercent: 0.1 });
  await updateHolding('custom-rate', { stampDutyRatePercent: 0.05 });
  const expected = async () => ({
    txns: (await db.holdingTxns.toArray()).map(tx => [tx.id, tx.fee, tx.feeSource]).sort(),
    stamp: (await db.holdings.get('custom-rate'))?.stampDutyRatePercent,
    noStamp: (await db.holdings.get('default-rate'))?.stampDutyRatePercent,
    min: (await db.settings.get('main'))?.minCommission,
    defaultStamp: (await db.settings.get('main'))?.defaultStampDutyRatePercent,
  });
  const original = await expected();
  assert.equal(original.stamp, 0.05);
  assert.equal(original.noStamp, undefined);
  const json = await exportData(), excel = await exportToExcel();
  for (const restore of [() => importData(json), () => importFromExcel(excel)]) {
    await db.holdingTxns.update('b1', { fee: 99, feeSource: 'manual' });
    await db.holdings.update('custom-rate', { stampDutyRatePercent: 1 });
    await updateSettings({ minCommission: 0, defaultStampDutyRatePercent: 0.05 });
    assert.equal(await restore(), true);
    assert.deepEqual(await expected(), original);
  }
});

test('restoring a backup written before stored fees materialises them on import', async () => {
  const before = await ledgerNumbers();
  const legacyJson = await exportData(), legacyExcel = await exportToExcel();
  for (const restore of [() => importData(legacyJson), () => importFromExcel(legacyExcel)]) {
    await materializeHoldingTxnFees();
    await db.holdingTxns.update('b1', { fee: 99, feeSource: 'manual' });
    assert.equal(await restore(), true);
    assert.deepEqual(await db.holdingTxns.get('b1').then(tx => [tx?.fee, tx?.feeSource]), [1, 'auto']);
    assert.deepEqual(await db.holdingTxns.get('s1').then(tx => [tx?.fee, tx?.feeSource]), [3.21, 'manual']);
    assert.deepEqual(await ledgerNumbers(), before);
  }
});

test('invalid fee fields are rejected by both restore paths', async () => {
  await materializeHoldingTxnFees();
  const json = JSON.parse(await exportData());
  for (const mutate of [
    (data: typeof json) => { data.holdingTxns[0].feeSource = 'guess'; },
    (data: typeof json) => { data.holdings[0].stampDutyRatePercent = 50; },
    (data: typeof json) => { data.settings[0].minCommission = -1; },
  ]) {
    const copy = structuredClone(json);
    mutate(copy);
    assert.equal(await importData(JSON.stringify(copy)), false);
  }
  assert.equal(await importData(JSON.stringify(json)), true);
});
