import test from 'node:test';
import assert from 'node:assert/strict';
import { BUY_LEVELS, buildGrid, dateInChina, defaultDividendStocks, dividendEstimateMinor, effectiveDps, isDividendStock, linkedDividendPositions, mainlandCode, parseDividendQuote, parseDividendResponse, redistributeDividendWeights, stockBudgetMinor, trailingYearStart } from '../src/lib/dividendWorkbench.ts';
import { repairPlanReferences } from '../src/lib/planReferences.ts';
import type { Account, Holding, HoldingTxn, PlanItem, PlanTarget } from '../src/db.ts';
const row = (date: string, bonus: number, extra = {}) => ({ SECURITY_CODE: '601398', EX_DIVIDEND_DATE: date, REPORT_DATE: date, PRETAX_BONUS_RMB: bonus, ASSIGN_PROGRESS: '实施分配', ...extra });
const response = (data: unknown[], pages = 1) => ({ success: true, result: { data, pages } });

test('TTM uses a complete calendar year, excludes proposals/future/cancelled and deduplicates per period', () => {
  const data = parseDividendResponse(response([
    row('2026-05-13', 1.689), row('2025-12-15', 1.414), row('2025-10-01', 0.5),
    row('2026-05-13', 1.689), row('2025-09-25', 9), row('2025-07-14', 1.646),
    row('2026-10-01', 8), row('2026-09-02', 5, { ASSIGN_PROGRESS: '预案' }), row('2026-09-01', 3, { ASSIGN_PROGRESS: '取消' }),
  ]), '601398', '2026-09-25', 100);
  assert.equal(data.dpsMicros, 360300);
  assert.equal(data.payments.length, 3);
  assert.equal(data.pending?.dpsMicros, 800000);
  assert.equal(dividendEstimateMinor(1000, data.dpsMicros), 36030);
});
test('missing/broken/truncated source data is not a fabricated zero; genuine empty window is zero', () => {
  assert.throws(() => parseDividendResponse({ success: false }, '601398'));
  assert.throws(() => parseDividendResponse(response([row('2026-01-01', 1)], 2), '601398'));
  assert.throws(() => parseDividendResponse(response([row('2026-01-01', 1, { SECURITY_CODE: '000001' })]), '601398'));
  assert.equal(parseDividendResponse(response([row('2020-01-01', 1)]), '601398', '2026-09-25').dpsMicros, 0);
  assert.equal(parseDividendResponse(response([]), '601398', '2026-09-25').dpsMicros, 0);
  assert.equal(trailingYearStart('2024-02-29'), '2023-02-28');
  assert.equal(dateInChina(new Date('2026-09-24T20:00:00Z')), '2026-09-25');
});
test('quote parser validates symbol, timestamp and nonzero price', () => {
  const fields = Array(50).fill(''); fields[2] = '601398'; fields[3] = '7.25'; fields[30] = '20260925153000'; fields[32] = '-0.5';
  const text = `v_sh601398="${fields.join('~')}";`;
  assert.equal(parseDividendQuote(text, '601398', 100).priceMinor, 725);
  assert.equal(parseDividendQuote(text, '601398', 100).date, '2026-09-25 15:30');
  assert.throws(() => parseDividendQuote(text, '600036'));
  fields[3] = '0'; assert.throws(() => parseDividendQuote(`v_sh601398="${fields.join('~')}"`, '601398'));
});
test('budgets scale, grid shares round down, no sell signal without holdings, manual DPS wins', () => {
  const stock = defaultDividendStocks()[0];
  assert.equal(defaultDividendStocks().reduce((sum,s) => sum+s.weightBps, 0), 10000);
  assert.ok(defaultDividendStocks().every(isDividendStock));
  stock.manualDpsMicros = 500000;
  stock.dividend = { asOf: '2026-09-25', windowStart: '2025-09-25', dpsMicros: 200000, payments: [], fetchedAt: 1 };
  stock.quote = { priceMinor: 900, date: '2026-09-25 15:00', fetchedAt: 1 };
  assert.equal(effectiveDps(stock), 500000);
  assert.equal(stockBudgetMinor(10000000, stock.weightBps), 500000);
  const buy = buildGrid(stock, 500000, 0, 'buy');
  assert.equal(buy[0].priceMinor, 1000); assert.equal(buy[0].targetShares, 200);
  assert.equal(buy.at(-1)?.targetShares, 600);
  assert.equal(buy[0].touched, true); assert.equal(buy.at(-1)?.cumulative, 10000);
  assert.ok(buildGrid(stock, 500000, 0, 'sell').every(r => !r.touched));
  assert.equal(buildGrid(stock, 500000, 350, 'sell').at(-1)?.sellShares, 350);
  stock.buyLevels = [{ ...BUY_LEVELS[0], priceMinor: 1234 }];
  assert.equal(buildGrid(stock, 500000, 0, 'buy')[0].priceMinor, 1234);
  assert.equal(buildGrid(stock, 500000, 0, 'buy')[0].displayYieldBps, 500000 / 1234);
  stock.buyLevels = [{ yieldBps: 500, portionBps: 11000 }]; assert.equal(isDividendStock(stock), false);
});

test('deleting an allocation redistributes proportionally, including hidden stocks but preserving zero weights', () => {
  const stocks = defaultDividendStocks().slice(0, 4).map((stock, i) => ({ ...stock, weightBps: [5000, 3000, 2000, 0][i], ...(i === 1 ? { group: 'hidden' as const, note: 'keep', manualShares: 123 } : {}) }));
  const remaining = redistributeDividendWeights(stocks, stocks[2].code);
  assert.deepEqual(remaining.map(stock => stock.weightBps), [6250, 3750, 0]);
  assert.equal(remaining[1].note, 'keep');
  assert.equal(remaining[1].manualShares, 123);
  assert.ok(remaining.every(isDividendStock));
  assert.equal(stockBudgetMinor(32000000, remaining[0].weightBps), 20000000);
  assert.equal(stocks[0].weightBps, 5000);
  assert.deepEqual(redistributeDividendWeights(stocks, stocks[3].code).map(stock => stock.weightBps), [5000, 3000, 2000]);
});

test('redistribution keeps exact basis-point totals, unallocated budget and safe empty/overallocated cases', () => {
  const stocks = defaultDividendStocks().slice(0, 4).map(stock => ({ ...stock, weightBps: 1 }));
  const rounded = redistributeDividendWeights(stocks, stocks[3].code);
  assert.deepEqual(rounded.map(stock => stock.weightBps), [1, 2, 1]); // code 600036 wins the tie
  assert.equal(rounded.reduce((sum, stock) => sum + stock.weightBps, 0), 4);
  const underallocated = stocks.slice(0, 3).map((stock, i) => ({ ...stock, weightBps: [2000, 1000, 1000][i] }));
  assert.deepEqual(redistributeDividendWeights(underallocated, underallocated[0].code).map(stock => stock.weightBps), [2000, 2000]);
  assert.deepEqual(redistributeDividendWeights([{ ...stocks[0], weightBps: 10000 }, { ...stocks[1], weightBps: 0 }], stocks[0].code).map(stock => stock.weightBps), [0]);
  assert.deepEqual(redistributeDividendWeights([stocks[0]], stocks[0].code), []);
  assert.deepEqual(redistributeDividendWeights(stocks, 'missing'), stocks);
  const overallocated = stocks.map(stock => ({ ...stock, weightBps: 6000 }));
  const clamped = redistributeDividendWeights(overallocated, overallocated[0].code);
  assert.equal(clamped.reduce((sum, stock) => sum + stock.weightBps, 0), 10000);
  assert.ok(clamped.every(isDividendStock));
});
const account: Account = { id: 'a', name: 'account', category: '股票/ETF', type: 'asset', currency: 'CNY', portfolio: true, createdAt: 1, sortOrder: 0 };
const holding: Holding = { id: 'h', accountId: 'a', name: 'ICBC', symbol: '601398.SH', market: 'A股', lastPrice: 7, createdAt: 1, sortOrder: 0 };
const buy: HoldingTxn = { id: 't', accountId: 'a', holdingId: 'h', date: '2026-01-01', kind: 'buy', shares: 1000, price: 6, createdAt: 1 };
test('share linking sums active accounts after sells but excludes balances, foreign markets, options and future transactions', () => {
  const accounts = [account, { ...account, id: 'b', includeInTotals: false, hidden: true }, { ...account, id: 'c', archivedAt: 1 }, { ...account, id: 'fund-account', category: '场外基金' }];
  const holdings = [holding, { ...holding, id: 'h2', accountId: 'b' }, { ...holding, id: 'h3', accountId: 'c' }, { ...holding, id: 'fund', accountId: 'fund-account' }, { ...holding, id: 'balance', mode: 'balance' as const }, { ...holding, id: 'hk', market: '港股' }, { ...holding, id: 'option', instrumentType: 'us_option' as const }];
  const txns = holdings.map(h => ({ ...buy, id: h.id, accountId: h.accountId, holdingId: h.id }));
  txns.push({ ...buy, id: 'sell', kind: 'sell', shares: 200 }, { ...buy, id: 'future', date: '2027-01-01' });
  const linked = linkedDividendPositions(accounts, holdings, txns, '2026-09-25');
  assert.equal(linked.get('601398')?.shares, 1800);
  assert.equal(linked.get('601398')?.sources.length, 2);
  for (const code of ['SH601398', '601398.SH', 'sh.601398', '601398']) assert.equal(mainlandCode(code), '601398');
  for (const code of ['00700', '159915', '510300', 'AAPL']) assert.equal(mainlandCode(code), null);
});
test('plan cleanup removes only missing IDs, retains excluded/archived accounts and intentional notes', () => {
  const item: PlanItem = { id: 'p', name: 'plan', categories: ['acct:a', 'hold:h', 'acct:gone', 'hold:gone', '股票/ETF@a'], allocations: [{ refKey: 'a:gone' }, { refKey: 'h:h', amountMinor: 2500 }], plannedPurchases: 'future stock', targetPercent: 15, sortOrder: 0, createdAt: 1 };
  const target: PlanTarget = { id: 'pt', planItemId: 'p', label: 'notes', refKeys: ['h:gone', 'h:h'], refKey: 'a:gone', sortOrder: 0, createdAt: 1 };
  const repaired = repairPlanReferences([item], [target], [{ ...account, archivedAt: 1, includeInTotals: false }], [holding]);
  assert.deepEqual(repaired.items[0].categories, ['acct:a', 'hold:h', '股票/ETF@a']);
  assert.equal(repaired.items[0].plannedPurchases, 'future stock');
  assert.deepEqual(repaired.targets[0].refKeys, ['h:h']);
  assert.equal(repaired.targets[0].refKey, undefined);
  assert.equal(repairPlanReferences(repaired.items, repaired.targets, [account], [holding]).changedItems.length, 0);
});

test('trend calculations distinguish flat and rising prices and reject incomplete/mismatched data', async () => {
  const { parseDividendTrend } = await import('../src/lib/dividendTrend.ts');
  const klines = Array.from({length: 31}, (_,i) => `${new Date(Date.UTC(2026,0,i+1)).toISOString().slice(0,10)},10,10,10,10,0,0`);
  const flat = parseDividendTrend({data:{code:'601398',klines}}, '601398', 1);
  assert.equal(flat.rsi6, 50); assert.equal(flat.bollLowerMinor, 1000); assert.equal(flat.change30, 0);
  const rising = klines.map((line,i) => { const fields = line.split(','); fields[2] = String(i+1); return fields.join(','); });
  const up = parseDividendTrend({data:{code:'601398',klines:rising}}, '601398', 1);
  assert.equal(up.rsi6, 100); assert.equal(up.ma5Minor, 2900); assert.equal(up.change30, 3000);
  assert.throws(() => parseDividendTrend({data:{code:'000001',klines}}, '601398'));
  assert.throws(() => parseDividendTrend({data:{code:'601398',klines:klines.slice(0,5)}}, '601398'));
});


test('Tencent adjusted-series adapter validates success and preserves source dates', async () => {
  const { parseTencentDividendTrend } = await import('../src/lib/dividendTrend.ts');
  const qfqday = Array.from({length:31}, (_,i) => [new Date(Date.UTC(2026,0,i+1)).toISOString().slice(0,10), '10', '10', '10', '10', '100']);
  const parsed = parseTencentDividendTrend({code:0,data:{sh601398:{qfqday}}}, '601398', 'sh601398', 1);
  assert.equal(parsed.date, '2026-01-31');
  assert.equal(parsed.rsi6, 50);
  assert.throws(() => parseTencentDividendTrend({code:1,data:{sh601398:{qfqday}}}, '601398', 'sh601398'));
  assert.throws(() => parseTencentDividendTrend({code:0,data:{sz000001:{qfqday}}}, '601398', 'sh601398'));
});
