import { parseTencentDividendTrend } from '../lib/dividendTrend';
import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { db, initializeSettings } from '../db';
import { dateInChina, defaultDividendStocks, equalDividendWeights, isDividendStock, linkedDividendPositions, mainlandCode, parseDividendQuote, parseDividendResponse, previewDividendWeightChanges, quoteSymbol, redistributeDividendWeights, scaleDividendWeights, suggestedDividendStockWeight, type DividendStock } from '../lib/dividendWorkbench';
import type { DividendImportRow } from '../lib/dividendImport';
import { httpResponseDataToText } from '../lib/httpResponse';
import { requestPortableSnapshot } from './portableSnapshotEvents';
import { defaultDividendFundPlan } from '../lib/dividendFundPlan';
import { enrichDividendPaymentDates, isDividendDataV2 } from '../lib/dividendForecast';
import { previewDividendRiskRemoval } from './dividendAdvisorActionsService';
import { assertDividendRequestCurrent, awaitDividendRequest, beforeDividendCacheWrite, claimDividendRequest, dividendRequestSignal, type DividendRequestControl } from './dividendRequestControl';
import { buildClassicStockPlan, type ClassicStockPlan, type ClassicTaxRateBps } from '../lib/dividendClassicStrategy';
import { DIVIDEND_PRICING_CALCULATION_VERSION } from '../lib/dividendPricing';

export async function loadDividendWorkbench() {
  await initializeSettings();
  await db.transaction('rw', db.settings, db.dividendStocks, async () => {
    const settings = await db.settings.get('main');
    if (!settings?.dividendWorkbenchInitialized) {
      if (await db.dividendStocks.count() === 0) await db.dividendStocks.bulkAdd(defaultDividendStocks());
      await db.settings.update('main', { dividendWorkbenchInitialized: true });
    }
  });
  return loadDividendWorkbenchReadOnly();
}

/** Existing inputs only: no settings initialisation, seeding or migration. */
export async function loadDividendWorkbenchReadOnly() {
  const [stocks, settings, accounts, holdings, txns] = await Promise.all([
    db.dividendStocks.toArray(), db.settings.get('main'), db.accounts.toArray(), db.holdings.toArray(), db.holdingTxns.toArray(),
  ]);
  return { stocks, collapsedCodes: settings?.dividendHomeCollapsedCodes ?? stocks.map(stock => stock.code), strategy: settings?.dividendStrategy ?? 'stocks', fundPlan: settings?.dividendFundPlan ?? defaultDividendFundPlan(), budgetMinor: settings?.dividendBudgetMinor ?? 0, budgetConfigured: settings?.dividendBudgetMinor !== undefined, positions: linkedDividendPositions(accounts, holdings, txns) };
}
/** Persist reading preferences without touching positions, grids or other cards. */
export async function saveDividendHomeCollapse(code: string, collapsed: boolean) {
  if (typeof code !== 'string' || typeof collapsed !== 'boolean') throw new Error('INVALID_DIVIDEND_STOCK');
  await initializeSettings();
  await db.transaction('rw', db.settings, db.dividendStocks, async () => {
    const settings = await db.settings.get('main');
    const fund = code.startsWith('fund:') && settings?.dividendFundPlan?.funds.some(item => `fund:${item.id}` === code);
    if (!fund && mainlandCode(code) !== code) throw new Error('INVALID_DIVIDEND_STOCK');
    const codes = new Set(settings?.dividendHomeCollapsedCodes ?? await db.dividendStocks.toCollection().primaryKeys());
    const key = fund ? `open:${code}` : code;
    if (fund ? !collapsed : collapsed) codes.add(key); else codes.delete(key);
    await db.settings.update('main', { dividendHomeCollapsedCodes: [...codes] });
  });
}
export async function saveDividendBudget(budgetMinor: number) {
  if (!Number.isSafeInteger(budgetMinor) || budgetMinor < 0 || budgetMinor > 1e14) throw new Error('INVALID_BUDGET');
  await initializeSettings();
  const result = await db.transaction('rw', db.settings, db.dividendStocks, async () => {
    const stocks = await db.dividendStocks.toArray();
    const { requestedTotalBps, weights } = previewDividendWeightChanges(stocks);
    await updateDividendWeights(stocks, weights);
    if (!await db.settings.update('main', { dividendBudgetMinor: budgetMinor })) throw new Error('SETTINGS_NOT_FOUND');
    return { rebalanced: requestedTotalBps > 10000 };
  });
  requestPortableSnapshot('dividend-budget');
  return result;
}

/** Apply changed weights only, inside the caller's transaction. */
async function updateDividendWeights(stocks: DividendStock[], weights: ReadonlyMap<string, number>) {
  for (const stock of stocks) {
    const weightBps = weights.get(stock.code);
    if (weightBps !== undefined && weightBps !== stock.weightBps) {
      await db.dividendStocks.update(stock.code, { weightBps });
    }
  }
}

/** Repair legacy overflow at workbench entry without assigning any unused budget. */
export async function repairOverallocatedDividendWeights() {
  const result = await db.transaction('rw', db.dividendStocks, async () => {
    const stocks = await db.dividendStocks.toArray();
    const { requestedTotalBps, weights } = previewDividendWeightChanges(stocks);
    const rebalanced = requestedTotalBps > 10000;
    if (rebalanced) await updateDividendWeights(stocks, weights);
    return { rebalanced };
  });
  if (result.rebalanced) requestPortableSnapshot('dividend-budget-rebalanced');
  return result;
}

/** Bind an editor to user-owned fields; market refreshes must not invalidate a draft. */
export function dividendStockEditFingerprint(stock: DividendStock): string {
  const levels = (value: DividendStock['buyLevels']) => value?.map(({ yieldBps, portionBps, priceMinor }) => ({ yieldBps, portionBps, priceMinor }));
  const origin = stock.gridProvenance;
  return JSON.stringify({ code: stock.code, name: stock.name, group: stock.group, weightBps: stock.weightBps,
    shareMode: stock.shareMode, manualShares: stock.manualShares, manualDpsMicros: stock.manualDpsMicros,
    lotSize: stock.lotSize, note: stock.note, buyPaused: stock.buyPaused ?? false,
    buyLevels: levels(stock.buyLevels), sellLevels: levels(stock.sellLevels),
    gridProvenance: origin && { generatedAt: origin.generatedAt, grossDpsMicros: origin.grossDpsMicros,
      taxBps: origin.taxBps, parameterVersion: origin.parameterVersion, basisKind: origin.basisKind } });
}

export interface DividendStockSaveOptions {
  expectedFingerprint?: string;
  expectNew?: boolean;
}

export async function saveDividendStock(stock: DividendStock, options: DividendStockSaveOptions = {}) {
  if (!isDividendStock(stock) || !options || typeof options !== 'object'
    || (options.expectedFingerprint !== undefined && (typeof options.expectedFingerprint !== 'string' || !options.expectedFingerprint))
    || (options.expectNew !== undefined && typeof options.expectNew !== 'boolean')
    || (options.expectNew && options.expectedFingerprint !== undefined)) throw new Error('INVALID_DIVIDEND_STOCK');
  const result = await db.transaction('rw', db.dividendStocks, async () => {
    const stocks = await db.dividendStocks.toArray();
    const current = stocks.find(row => row.code === stock.code);
    // Check inside the write transaction, before constructing or persisting any update.
    if ((options.expectNew && current) || (options.expectedFingerprint !== undefined
      && (!current || dividendStockEditFingerprint(current) !== options.expectedFingerprint))) throw new Error('DIVIDEND_STOCK_CHANGED');
    const { requestedTotalBps, weights } = previewDividendWeightChanges(stocks, [stock]);
    const saved = { ...stock, weightBps: weights.get(stock.code)! };
    if (current && JSON.stringify(stock.buyLevels) === JSON.stringify(current.buyLevels)
      && JSON.stringify(stock.sellLevels) === JSON.stringify(current.sellLevels) && current.gridProvenance) saved.gridProvenance = current.gridProvenance;
    else delete saved.gridProvenance;
    for (const key of ['quote', 'quoteFailedAt', 'dividend', 'dividendFailedAt', 'trend', 'trendFailedAt'] as const) {
      // An editor cannot restore a cache field that a concurrent refresh cleared.
      if (current && options.expectedFingerprint !== undefined) delete saved[key];
      if (current && Object.hasOwn(current, key)) Object.assign(saved, { [key]: current[key] });
    }
    await db.dividendStocks.put(saved);
    await updateDividendWeights(stocks.filter(row => row.code !== stock.code), weights);
    return { rebalanced: requestedTotalBps > 10000 };
  });
  requestPortableSnapshot('dividend-stock');
  return result;
}
/** Category changes must preserve any newer grid, quote or budget edits. */
export async function saveDividendStockGroup(code: string, group: DividendStock['group']) {
  if (mainlandCode(code) !== code || !['core', 'watch', 'hidden'].includes(group)) throw new Error('INVALID_DIVIDEND_STOCK');
  const updated = await db.dividendStocks.update(code, { group });
  if (!updated) throw new Error('DIVIDEND_STOCK_MISSING');
  requestPortableSnapshot('dividend-stock-group');
}
/** Change a weight and rebalance an overcommitted portfolio without touching other stock fields. */
export async function saveDividendStockWeight(code: string, weightBps: number) {
  if (mainlandCode(code) !== code || !Number.isSafeInteger(weightBps) || weightBps < 0 || weightBps > 10000) throw new Error('INVALID_DIVIDEND_STOCK');
  const result = await db.transaction('rw', db.dividendStocks, async () => {
    const stocks = await db.dividendStocks.toArray();
    if (!stocks.some(stock => stock.code === code)) throw new Error('DIVIDEND_STOCK_MISSING');
    const { requestedTotalBps, weights } = previewDividendWeightChanges(stocks, [{ code, weightBps }]);
    await updateDividendWeights(stocks, weights);
    return { rebalanced: requestedTotalBps > 10000 };
  });
  requestPortableSnapshot('dividend-stock-weight');
  return result;
}
export async function deleteDividendStock(code: string, redistribute = true) {
  await db.transaction('rw', db.dividendStocks, db.holdings, db.holdingTxns, async () => {
    if ((await previewDividendRiskRemoval([code])).protected.length) throw new Error('DIVIDEND_STOCK_HELD');
    const stocks = await db.dividendStocks.toArray();
    const remaining = redistribute ? redistributeDividendWeights(stocks, code) : stocks.filter(stock => stock.code !== code);
    await db.dividendStocks.delete(code);
    for (const stock of remaining) {
      if (stock.weightBps !== stocks.find(original => original.code === stock.code)?.weightBps) {
        await db.dividendStocks.update(stock.code, { weightBps: stock.weightBps });
      }
    }
  });
  requestPortableSnapshot('dividend-stock-deleted');
}

/** Assign the available budget in the existing proportions, with exact basis-point rounding. */
export async function allocateDividendBudget(options?: { expectedFingerprint: string }): Promise<void> {
  if (options !== undefined && (!options || typeof options.expectedFingerprint !== 'string' || !options.expectedFingerprint)) throw new Error('INVALID_DIVIDEND_ALLOCATION');
  await db.transaction('rw', db.settings, db.dividendStocks, async () => {
    const [stocks, settings] = await Promise.all([db.dividendStocks.toArray(), db.settings.get('main')]);
    if (options && dividendBudgetAllocationFingerprint(stocks, settings?.dividendBudgetMinor ?? 0, settings?.dividendBudgetMinor !== undefined) !== options.expectedFingerprint) {
      throw new Error('DIVIDEND_BUDGET_CHANGED');
    }
    const total = stocks.reduce((sum, stock) => sum + stock.weightBps, 0);
    if (total <= 0) throw new Error('NO_DIVIDEND_WEIGHTS');
    await updateDividendWeights(stocks, new Map(scaleDividendWeights(stocks).map(stock => [stock.code, stock.weightBps])));
  });
  requestPortableSnapshot('dividend-budget-allocated');
}

/** Bind an allocation preview to user-owned budget inputs, excluding asynchronously refreshed market data. */
export function dividendBudgetAllocationFingerprint(stocks: readonly Pick<DividendStock, 'code' | 'weightBps'>[], budgetMinor: number, budgetConfigured = true): string {
  return JSON.stringify({ budgetMinor, budgetConfigured, stocks: [...stocks]
    .sort((a, b) => a.code.localeCompare(b.code)).map(({ code, weightBps }) => ({ code, weightBps })) });
}

/** Apply a confirmed equal-allocation preview atomically, preserving all other plan and holding fields. */
export async function reallocateDividendBudget({ expectedFingerprint }: { expectedFingerprint: string }): Promise<void> {
  if (typeof expectedFingerprint !== 'string' || !expectedFingerprint) throw new Error('INVALID_DIVIDEND_ALLOCATION');
  await db.transaction('rw', db.settings, db.dividendStocks, async () => {
    const [stocks, settings] = await Promise.all([db.dividendStocks.toArray(), db.settings.get('main')]);
    const budgetMinor = settings?.dividendBudgetMinor ?? 0;
    if (dividendBudgetAllocationFingerprint(stocks, budgetMinor, settings?.dividendBudgetMinor !== undefined) !== expectedFingerprint) {
      throw new Error('DIVIDEND_BUDGET_CHANGED');
    }
    if (!Number.isSafeInteger(budgetMinor) || budgetMinor <= 0) throw new Error('INVALID_BUDGET');
    if (!stocks.length) throw new Error('NO_DIVIDEND_STOCKS');
    await updateDividendWeights(stocks, new Map(equalDividendWeights(stocks).map(stock => [stock.code, stock.weightBps])));
  });
  requestPortableSnapshot('dividend-budget-reallocated');
}

/** Apply selected stock fields and rebalance if needed, preserving holdings and saved grids. */
export async function importDividendStocks(rows: DividendImportRow[]): Promise<{ added: number; updated: number }> {
  await initializeSettings();
  const result = await db.transaction('rw', db.dividendStocks, db.settings, async () => {
    if (!Array.isArray(rows) || !rows.length || rows.length > 5000) throw new Error('INVALID_DIVIDEND_IMPORT');
    const stocks = await db.dividendStocks.toArray();
    const current = new Map(stocks.map(stock => [stock.code, stock]));
    const seen = new Set<string>();
    const changes: { stock: DividendStock; existing: boolean; fields: Pick<DividendStock, 'name' | 'weightBps'> & Partial<Pick<DividendStock, 'group' | 'note'>> }[] = [];
    for (const row of rows) {
      if (!row || !Number.isSafeInteger(row.line) || row.line < 1 || typeof row.code !== 'string' || mainlandCode(row.code) !== row.code || seen.has(row.code)
        || typeof row.name !== 'string' || !row.name.trim() || row.name.trim().length > 80 || !Number.isSafeInteger(row.weightBps) || row.weightBps < 0 || row.weightBps > 10000
        || (row.group !== undefined && !['core', 'watch', 'hidden'].includes(row.group)) || (row.note !== undefined && (typeof row.note !== 'string' || row.note.length > 2000))) throw new Error('INVALID_DIVIDEND_IMPORT');
      seen.add(row.code);
      const previous = current.get(row.code);
      const fields = { name: row.name.trim(), weightBps: row.weightBps, ...(row.group === undefined ? {} : { group: row.group }), ...(row.note === undefined ? {} : { note: row.note }) };
      const stock: DividendStock = { ...(previous ?? { code: row.code, group: 'watch', shareMode: 'linked', manualShares: 0, lotSize: row.code.startsWith('68') ? 200 : 100 }), ...fields };
      if (!isDividendStock(stock)) throw new Error('INVALID_DIVIDEND_IMPORT');
      changes.push({ stock, existing: !!previous, fields });
      current.set(row.code, stock);
    }
    const { weights } = previewDividendWeightChanges([...current.values()]);
    for (const change of changes) {
      const weightBps = weights.get(change.stock.code)!;
      if (change.existing) await db.dividendStocks.update(change.stock.code, { ...change.fields, weightBps });
      else await db.dividendStocks.add({ ...change.stock, weightBps });
    }
    await updateDividendWeights(stocks.filter(stock => !seen.has(stock.code)), weights);
    await db.settings.update('main', { dividendWorkbenchInitialized: true });
    const added = changes.filter(change => !change.existing).length;
    return { added, updated: changes.length - added };
  });
  requestPortableSnapshot('dividend-stocks-imported');
  return result;
}

export async function addLinkedDividendStocks(codes: string[], allocate = true): Promise<number> {
  const count = await db.transaction('rw', [db.dividendStocks, db.accounts, db.holdings, db.holdingTxns, db.settings], async () => {
    const [stocks, accounts, holdings, txns, settings] = await Promise.all([
      db.dividendStocks.toArray(), db.accounts.toArray(), db.holdings.toArray(), db.holdingTxns.toArray(), db.settings.get('main'),
    ]);
    const existing = new Set(stocks.map(stock => stock.code));
    const positions = linkedDividendPositions(accounts, holdings, txns);
    const weightBps = allocate ? suggestedDividendStockWeight(stocks, settings?.dividendBudgetMinor ?? 0) : 0;
    const additions: DividendStock[] = [...new Set(codes)].flatMap(code => {
      const position = positions.get(code);
      return !existing.has(code) && position ? [{
        code, name: position.name, group: 'watch', weightBps, shareMode: 'linked', manualShares: 0,
        lotSize: code.startsWith('68') ? 200 : 100,
      }] : [];
    });
    if (additions.length) {
      const { weights } = previewDividendWeightChanges(stocks, additions);
      await db.dividendStocks.bulkAdd(additions.map(stock => ({ ...stock, weightBps: weights.get(stock.code)! })));
      await updateDividendWeights(stocks, weights);
    }
    return additions.length;
  });
  if (count) requestPortableSnapshot('dividend-linked-stocks-added');
  return count;
}

async function readSource(url: string, proxy: string, control: DividendRequestControl = {}): Promise<string> {
  assertDividendRequestCurrent(control);
  if (Capacitor.isNativePlatform()) {
    const res = await awaitDividendRequest(CapacitorHttp.get({ url, responseType: 'text', connectTimeout: 10000, readTimeout: 10000 }), control);
    if (res.status < 200 || res.status >= 300) throw new Error(`HTTP_${res.status}`);
    return httpResponseDataToText(res.data);
  }
  const res = await fetch(proxy, { signal: dividendRequestSignal(control, 12000) });
  if (!res.ok) throw new Error(`HTTP_${res.status}`);
  return awaitDividendRequest(res.text(), control);
}
export function dividendSourceUrl(code: string): string {
  const query = new URLSearchParams({ type: 'RPT_SHAREBONUS_DET', sty: 'ALL', filter: `(SECURITY_CODE="${code}")`, p: '1', ps: '500', sr: '-1', st: 'REPORT_DATE', source: 'HSF10', client: 'PC' });
  return `https://datacenter.eastmoney.com/securities/api/data/get?${query}`;
}

/** Independent failures keep their dated cache; manual DPS and user edits are never overwritten. */
export async function refreshDividendStock(code: string, control: DividendRequestControl & { skipQuote?: boolean } = {}): Promise<boolean> {
  assertDividendRequestCurrent(control);
  const currentDividend = claimDividendRequest(`dividend:${code}`), currentQuote = control.skipQuote ? () => false : claimDividendRequest(`quote:${code}`);
  const url = dividendSourceUrl(code);
  const schedulePath = `/PC_HSF10/BonusFinancing/PageAjax?code=${quoteSymbol(code).toUpperCase()}`;
  const [quote, dividend, schedule] = await Promise.allSettled([
    control.skipQuote ? Promise.resolve(undefined) : readSource(`https://qt.gtimg.cn/q=${quoteSymbol(code)}`, `/qt-api/q=${quoteSymbol(code)}`, control).then(text => parseDividendQuote(text, code)),
    readSource(url, url.replace('https://datacenter.eastmoney.com', '/dividend-api'), control).then(text => parseDividendResponse(JSON.parse(text), code)),
    readSource(`https://emweb.eastmoney.com${schedulePath}`, `/dividend-schedule-api${schedulePath}`, control).then(text => JSON.parse(text) as unknown),
  ]);
  await beforeDividendCacheWrite(control);
  const update: Partial<DividendStock> = {};
  if (!control.skipQuote) {
    if (quote.status === 'fulfilled') { update.quote = quote.value; update.quoteFailedAt = undefined; }
    else update.quoteFailedAt = Date.now();
  }
  if (dividend.status === 'fulfilled') {
    update.dividend = dividend.value;
    if (schedule.status === 'fulfilled') {
      try { update.dividend = enrichDividendPaymentDates(dividend.value, schedule.value, code); }
      catch { update.dividend.scheduleFailedAt = Date.now(); }
    } else update.dividend.scheduleFailedAt = Date.now();
    update.dividendFailedAt = undefined;
    if (!isDividendDataV2(update.dividend) || !Number.isSafeInteger(update.dividend.dpsMicros)) { delete update.dividend; update.dividendFailedAt = Date.now(); }
  }
  else update.dividendFailedAt = Date.now();
  await db.transaction('rw', db.dividendStocks, async () => {
    assertDividendRequestCurrent(control);
    if (!currentDividend()) return;
    if (!currentQuote()) { delete update.quote; delete update.quoteFailedAt; }
    await db.dividendStocks.update(code, update);
    assertDividendRequestCurrent(control);
  });
  return (control.skipQuote || quote.status === 'fulfilled') && dividend.status === 'fulfilled' && update.dividendFailedAt === undefined;
}
export async function refreshDividendStocks(codes: string[], onProgress: (done: number, total: number) => void) {
  let cursor = 0, done = 0, failed = 0;
  await Promise.all(Array.from({ length: Math.min(3, codes.length) }, async () => {
    while (cursor < codes.length) {
      const code = codes[cursor++];
      if (!await refreshDividendStock(code)) failed++;
      onProgress(++done, codes.length);
    }
  }));
  requestPortableSnapshot('dividend-market-data');
  return { done, failed };
}

export async function refreshDividendTrend(code: string): Promise<boolean> {
  const path = `/appstock/app/fqkline/get?param=${quoteSymbol(code)},day,,,250,qfq`;
  try {
    const text = await readSource(`https://web.ifzq.gtimg.cn${path}`, `/dividend-trend-api${path}`);
    await db.dividendStocks.update(code, { trend: parseTencentDividendTrend(JSON.parse(text), code, quoteSymbol(code)), trendFailedAt: undefined });
    requestPortableSnapshot('dividend-trend');
    return true;
  } catch {
    await db.dividendStocks.update(code, { trendFailedAt: Date.now() });
    return false;
  }
}

export function classicDividendGridFingerprint(plan: ClassicStockPlan): string {
  return JSON.stringify([plan.base, plan.classicBuyLevels, plan.classicSellLevels]);
}

export async function applyClassicDividendGrid(code: string, taxBps: ClassicTaxRateBps = 1000, expected?: {
  asOf: string;
  stockFingerprint: string;
  gridFingerprint: string;
}): Promise<void> {
  if (mainlandCode(code) !== code) throw new Error('INVALID_DIVIDEND_STOCK');
  await db.transaction('rw', db.dividendStocks, db.settings, async () => {
    const current = await db.dividendStocks.get(code);
    if (!current) throw new Error('DIVIDEND_STOCK_MISSING');
    const asOf = expected ? dateInChina() : undefined;
    const plan = buildClassicStockPlan(current, { taxBps, asOf });
    if (expected) {
      const method = (await db.settings.get('main'))?.dividendPricingMethod;
      const period = method?.strategy === 'recent_batches' ? method.holdingPeriod : 'month_to_year';
      const currentTax = period === 'over_year' ? 0 : period === 'up_to_month' ? 2000 : 1000;
      if (asOf !== expected.asOf || taxBps !== currentTax
        || dividendStockEditFingerprint(current) !== expected.stockFingerprint
        || classicDividendGridFingerprint(plan) !== expected.gridFingerprint) throw new Error('DIVIDEND_REVIEW_CHANGED');
    }
    await db.dividendStocks.update(code, {
      buyLevels: plan.classicBuyLevels,
      sellLevels: plan.classicSellLevels,
      gridProvenance: {
        generatedAt: Date.now(),
        grossDpsMicros: plan.base.grossDpsMicros,
        taxBps,
        parameterVersion: DIVIDEND_PRICING_CALCULATION_VERSION,
        basisKind: 'recent_batches',
      },
    });
  });
  requestPortableSnapshot('dividend-classic-grid-applied');
}

export async function applyAllClassicDividendGrids(taxBps: ClassicTaxRateBps = 1000): Promise<number> {
  let updatedCount = 0;
  await db.transaction('rw', db.dividendStocks, async () => {
    const stocks = await db.dividendStocks.toArray();
    const generatedAt = Date.now();
    for (const stock of stocks) {
      const plan = buildClassicStockPlan(stock, { taxBps });
      await db.dividendStocks.update(stock.code, {
        buyLevels: plan.classicBuyLevels,
        sellLevels: plan.classicSellLevels,
        gridProvenance: {
          generatedAt,
          grossDpsMicros: plan.base.grossDpsMicros,
          taxBps,
          parameterVersion: DIVIDEND_PRICING_CALCULATION_VERSION,
          basisKind: 'recent_batches',
        },
      });
      updatedCount++;
    }
  });
  if (updatedCount) requestPortableSnapshot('dividend-classic-grids-batch');
  return updatedCount;
}
