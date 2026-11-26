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

import * as XLSX from 'xlsx';

const { calculateAutoTxnFee, isEtfHolding, resolveHoldingCommissionRatePercent, resolveHoldingFeeTerms, isManualTxnFee } = await import('../src/lib/holdingPosition.ts');
const { db, initializeSettings, updateSettings, materializeHoldingTxnFees, exportData, importData, exportToExcel, importFromExcel } = await import('../src/db.ts');
const { addHoldingTxn, createHolding, updateHoldingTxn, getHoldingsWithPositions, recalculateAutoTxnFees, updateHolding } = await import('../src/services/holdingService.ts');
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

test('isEtfHolding identifies A-share ETF/LOF codes, ETF/LOF names, US options, and explicit overrides', () => {
  // A-share listed ETF/LOF codes (with and without exchange prefixes/suffixes)
  assert.equal(isEtfHolding({ symbol: '510300' }), true);
  assert.equal(isEtfHolding({ symbol: 'sh512890' }), true);
  assert.equal(isEtfHolding({ symbol: '159915.SZ' }), true);
  assert.equal(isEtfHolding({ symbol: '588000' }), true);
  assert.equal(isEtfHolding({ symbol: '161725' }), true);

  // Name matches (word boundaries)
  assert.equal(isEtfHolding({ name: '沪深300ETF' }), true);
  assert.equal(isEtfHolding({ name: 'Vanguard S&P 500 ETF', symbol: 'VOO', market: '美股' }), true);
  assert.equal(isEtfHolding({ name: '招商中证白酒LOF' }), true);

  // Negative checks
  assert.equal(isEtfHolding({ name: 'Netflix', symbol: 'NFLX', market: '美股' }), false);
  assert.equal(isEtfHolding({ name: '浦发银行', symbol: '600000' }), false);
  assert.equal(isEtfHolding({ name: '美的集团', symbol: '000333' }), false);
  assert.equal(isEtfHolding({ name: '紫金矿业', symbol: '02899', market: '港股' }), false);
  assert.equal(isEtfHolding({ symbol: '510300', market: '港股' }), false);
  assert.equal(isEtfHolding({ symbol: 'us510300' }), false);
  assert.equal(isEtfHolding({ name: 'AAPL ETF', symbol: 'AAPL', instrumentType: 'us_option', securityFeeKind: 'etf' }), false);
  assert.equal(isEtfHolding(undefined), false);

  // Explicit securityFeeKind overrides
  assert.equal(isEtfHolding({ name: '510300 ETF', symbol: '510300', securityFeeKind: 'stock' }), false);
  assert.equal(isEtfHolding({ name: '紫金矿业', symbol: '02899', market: '港股', securityFeeKind: 'etf' }), true);
});

test('stock and ETF holdings in the same account use distinct commission rates and minimums, including recalculateAutoTxnFees', async () => {
  await materializeHoldingTxnFees();
  await updateSettings({
    defaultCommissionRatePercent: 0.025,
    minCommission: 5,
    defaultEtfCommissionRatePercent: 0.005,
    etfMinCommission: 0,
  });

  const stockId = await createHolding('stocks', { name: '美的集团', symbol: '000333', market: 'A股', lastPrice: 60 });
  const etfId = await createHolding('stocks', { name: '红利低波ETF', symbol: '512890', market: 'A股', lastPrice: 1.2 });
  const forcedStockEtfId = await createHolding('stocks', { name: '300ETF', symbol: '510300', market: 'A股', securityFeeKind: 'stock', lastPrice: 4 });
  const forcedEtfStockId = await createHolding('stocks', { name: 'VOO', symbol: 'VOO', market: '美股', securityFeeKind: 'etf', lastPrice: 500 });

  assert.equal(resolveHoldingCommissionRatePercent({ symbol: '000333' }, { defaultCommissionRatePercent: 0.025, defaultEtfCommissionRatePercent: 0.005 }, '股票/ETF'), 0.025);
  assert.equal(resolveHoldingCommissionRatePercent({ symbol: '512890' }, { defaultCommissionRatePercent: 0.025, defaultEtfCommissionRatePercent: 0.005 }, '股票/ETF'), 0.005);

  // 100 x 60 = 6,000 -> 0.025% = 1.50 -> raised to stock min 5.00
  const stockBuy = await addHoldingTxn('stocks', stockId, { date: '2026-03-11', kind: 'buy', shares: 100, price: 60 });
  // 10,000 x 1.2 = 12,000 -> 0.005% = 0.60 -> etfMinCommission = 0, so 0.60 (not 5.00)
  const etfBuy = await addHoldingTxn('stocks', etfId, { date: '2026-03-11', kind: 'buy', shares: 10000, price: 1.2 });
  // Forced stock schedule on 510300: 1,000 x 4 = 4,000 -> 0.025% = 1.00 -> stock min 5.00
  const forcedStockBuy = await addHoldingTxn('stocks', forcedStockEtfId, { date: '2026-03-11', kind: 'buy', shares: 1000, price: 4 });
  // Forced ETF schedule on VOO: 10 x 500 = 5,000 -> 0.005% = 0.25 -> etfMinCommission 0 -> 0.25
  const forcedEtfBuy = await addHoldingTxn('stocks', forcedEtfStockId, { date: '2026-03-11', kind: 'buy', shares: 10, price: 500 });

  assert.equal((await db.holdingTxns.get(stockBuy))?.fee, 5);
  assert.equal((await db.holdingTxns.get(etfBuy))?.fee, 0.6);
  assert.equal((await db.holdingTxns.get(forcedStockBuy))?.fee, 5);
  assert.equal((await db.holdingTxns.get(forcedEtfBuy))?.fee, 0.25);

  // Update ETF settings and recalculate automatic fees (scoped and full ledger)
  await updateSettings({ defaultEtfCommissionRatePercent: 0.01, etfMinCommission: 1 });
  assert.equal(await recalculateAutoTxnFees({ holdingId: etfId }), 1);
  assert.equal((await db.holdingTxns.get(etfBuy))?.fee, 1.2);
  assert.equal((await db.holdingTxns.get(forcedEtfBuy))?.fee, 0.25);

  // Full recalculation updates forcedEtfBuy (0.25 -> 1.00 min) and legacy stock b1 (1.00 -> 5.00 min)
  const repricedCount = await recalculateAutoTxnFees();
  assert.equal(repricedCount, 2);
  assert.equal((await db.holdingTxns.get(etfBuy))?.fee, 1.2);
  assert.equal((await db.holdingTxns.get(forcedEtfBuy))?.fee, 1);
  assert.equal((await db.holdingTxns.get(stockBuy))?.fee, 5);
  assert.equal((await db.holdingTxns.get(forcedStockBuy))?.fee, 5);
  assert.equal((await db.holdingTxns.get('b1'))?.fee, 5);
});

test('ETF fee settings and securityFeeKind survive JSON and Excel backups and reject invalid values', async () => {
  await materializeHoldingTxnFees();
  await updateSettings({
    defaultCommissionRatePercent: 0.025,
    minCommission: 5,
    defaultEtfCommissionRatePercent: 0.005,
    etfMinCommission: 0,
  });
  await updateHolding('default-rate', { securityFeeKind: 'etf' });
  await updateHolding('custom-rate', { securityFeeKind: 'stock' });

  const expected = async () => ({
    defaultRate: (await db.settings.get('main'))?.defaultCommissionRatePercent,
    min: (await db.settings.get('main'))?.minCommission,
    etfRate: (await db.settings.get('main'))?.defaultEtfCommissionRatePercent,
    etfMin: (await db.settings.get('main'))?.etfMinCommission,
    stockKind: (await db.holdings.get('default-rate'))?.securityFeeKind,
    etfKind: (await db.holdings.get('custom-rate'))?.securityFeeKind,
  });
  const original = await expected();
  assert.deepEqual(original, {
    defaultRate: 0.025,
    min: 5,
    etfRate: 0.005,
    etfMin: 0,
    stockKind: 'etf',
    etfKind: 'stock',
  });

  const json = await exportData();
  const excel = await exportToExcel();
  for (const restore of [() => importData(json), () => importFromExcel(excel)]) {
    await updateSettings({ defaultEtfCommissionRatePercent: 0.1, etfMinCommission: 10 });
    await updateHolding('default-rate', { securityFeeKind: 'stock' });
    await updateHolding('custom-rate', { securityFeeKind: undefined });
    assert.equal(await restore(), true);
    assert.deepEqual(await expected(), original);
  }

  // JSON invalid rejections
  const parsedJson = JSON.parse(json);
  for (const mutate of [
    (data: typeof parsedJson) => { data.settings[0].defaultEtfCommissionRatePercent = -0.01; },
    (data: typeof parsedJson) => { data.settings[0].defaultEtfCommissionRatePercent = 15; },
    (data: typeof parsedJson) => { data.settings[0].etfMinCommission = -1; },
    (data: typeof parsedJson) => { data.holdings[0].securityFeeKind = 'bond'; },
  ]) {
    const copy = structuredClone(parsedJson);
    mutate(copy);
    assert.equal(await importData(JSON.stringify(copy)), false);
  }

  // Excel invalid rejections
  const mutateExcel = async (mutateWb: (wb: XLSX.WorkBook) => void) => {
    const wb = XLSX.read(excel, { type: 'base64' });
    mutateWb(wb);
    return importFromExcel(XLSX.write(wb, { bookType: 'xlsx', type: 'base64' }));
  };
  assert.equal(await mutateExcel(wb => {
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets.Settings);
    rows[0].defaultEtfCommissionRatePercent = 20;
    wb.Sheets.Settings = XLSX.utils.json_to_sheet(rows);
  }), false);
  assert.equal(await mutateExcel(wb => {
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets.Settings);
    rows[0].etfMinCommission = -5;
    wb.Sheets.Settings = XLSX.utils.json_to_sheet(rows);
  }), false);
  assert.equal(await mutateExcel(wb => {
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets.Holdings);
    rows[0].securityFeeKind = 'bond';
    wb.Sheets.Holdings = XLSX.utils.json_to_sheet(rows);
  }), false);
});
