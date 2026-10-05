import { parseTencentDividendTrend } from '../lib/dividendTrend';
import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { db, initializeSettings, updateSettings } from '../db';
import { defaultDividendStocks, isDividendStock, linkedDividendPositions, mainlandCode, parseDividendQuote, parseDividendResponse, quoteSymbol, redistributeDividendWeights, scaleDividendWeights, type DividendStock } from '../lib/dividendWorkbench';
import type { DividendImportRow } from '../lib/dividendImport';
import { httpResponseDataToText } from '../lib/httpResponse';
import { requestPortableSnapshot } from './portableSnapshotEvents';

export async function loadDividendWorkbench() {
  await initializeSettings();
  await db.transaction('rw', db.settings, db.dividendStocks, async () => {
    const settings = await db.settings.get('main');
    if (!settings?.dividendWorkbenchInitialized) {
      if (await db.dividendStocks.count() === 0) await db.dividendStocks.bulkAdd(defaultDividendStocks());
      await db.settings.update('main', { dividendWorkbenchInitialized: true });
    }
  });
  const [stocks, settings, accounts, holdings, txns] = await Promise.all([
    db.dividendStocks.toArray(), db.settings.get('main'), db.accounts.toArray(), db.holdings.toArray(), db.holdingTxns.toArray(),
  ]);
  return { stocks, budgetMinor: settings?.dividendBudgetMinor ?? 0, budgetConfigured: settings?.dividendBudgetMinor !== undefined, positions: linkedDividendPositions(accounts, holdings, txns) };
}
export async function saveDividendBudget(budgetMinor: number) {
  if (!Number.isSafeInteger(budgetMinor) || budgetMinor < 0 || budgetMinor > 1e14) throw new Error('INVALID_BUDGET');
  await updateSettings({ dividendBudgetMinor: budgetMinor });
  requestPortableSnapshot('dividend-budget');
}
export async function saveDividendStock(stock: DividendStock) {
  if (!isDividendStock(stock)) throw new Error('INVALID_DIVIDEND_STOCK');
  await db.dividendStocks.put(stock);
  requestPortableSnapshot('dividend-stock');
}
export async function deleteDividendStock(code: string, redistribute = true) {
  await db.transaction('rw', db.dividendStocks, async () => {
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
export async function allocateDividendBudget(): Promise<void> {
  await db.transaction('rw', db.dividendStocks, async () => {
    const stocks = await db.dividendStocks.toArray();
    const total = stocks.reduce((sum, stock) => sum + stock.weightBps, 0);
    if (total > 10000) throw new Error('DIVIDEND_IMPORT_OVER_BUDGET');
    if (total <= 0) throw new Error('NO_DIVIDEND_WEIGHTS');
    for (const stock of scaleDividendWeights(stocks, 10000)) {
      if (stock.weightBps !== stocks.find(original => original.code === stock.code)?.weightBps) await db.dividendStocks.update(stock.code, { weightBps: stock.weightBps });
    }
  });
  requestPortableSnapshot('dividend-budget-allocated');
}

/** Apply only selected rows; spreadsheet inputs cannot overwrite holdings or existing trading plans. */
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
    if ([...current.values()].reduce((sum, stock) => sum + stock.weightBps, 0) > 10000) throw new Error('DIVIDEND_IMPORT_OVER_BUDGET');
    for (const change of changes) {
      if (change.existing) await db.dividendStocks.update(change.stock.code, change.fields);
      else await db.dividendStocks.add(change.stock);
    }
    await db.settings.update('main', { dividendWorkbenchInitialized: true });
    const added = changes.filter(change => !change.existing).length;
    return { added, updated: changes.length - added };
  });
  requestPortableSnapshot('dividend-stocks-imported');
  return result;
}

export async function addLinkedDividendStocks(codes: string[]): Promise<number> {
  const count = await db.transaction('rw', db.dividendStocks, db.accounts, db.holdings, db.holdingTxns, async () => {
    const [stocks, accounts, holdings, txns] = await Promise.all([
      db.dividendStocks.toArray(), db.accounts.toArray(), db.holdings.toArray(), db.holdingTxns.toArray(),
    ]);
    const existing = new Set(stocks.map(stock => stock.code));
    const positions = linkedDividendPositions(accounts, holdings, txns);
    const additions: DividendStock[] = [...new Set(codes)].flatMap(code => {
      const position = positions.get(code);
      return !existing.has(code) && position ? [{
        code, name: position.name, group: 'watch', weightBps: 0, shareMode: 'linked', manualShares: 0,
        lotSize: code.startsWith('68') ? 200 : 100,
      }] : [];
    });
    if (additions.length) await db.dividendStocks.bulkAdd(additions);
    return additions.length;
  });
  if (count) requestPortableSnapshot('dividend-linked-stocks-added');
  return count;
}

async function readSource(url: string, proxy: string): Promise<string> {
  if (Capacitor.isNativePlatform()) {
    const res = await CapacitorHttp.get({ url, responseType: 'text', connectTimeout: 10000, readTimeout: 10000 });
    if (res.status < 200 || res.status >= 300) throw new Error(`HTTP_${res.status}`);
    return httpResponseDataToText(res.data);
  }
  const res = await fetch(proxy, { signal: AbortSignal.timeout(12000) });
  if (!res.ok) throw new Error(`HTTP_${res.status}`);
  return res.text();
}
export function dividendSourceUrl(code: string): string {
  const query = new URLSearchParams({ type: 'RPT_SHAREBONUS_DET', sty: 'ALL', filter: `(SECURITY_CODE="${code}")`, p: '1', ps: '500', sr: '-1', st: 'EX_DIVIDEND_DATE', source: 'HSF10', client: 'PC' });
  return `https://datacenter.eastmoney.com/securities/api/data/get?${query}`;
}

/** Independent failures keep their dated cache; manual DPS and user edits are never overwritten. */
export async function refreshDividendStock(code: string): Promise<boolean> {
  const url = dividendSourceUrl(code);
  const [quote, dividend] = await Promise.allSettled([
    readSource(`https://qt.gtimg.cn/q=${quoteSymbol(code)}`, `/qt-api/q=${quoteSymbol(code)}`).then(text => parseDividendQuote(text, code)),
    readSource(url, url.replace('https://datacenter.eastmoney.com', '/dividend-api')).then(text => parseDividendResponse(JSON.parse(text), code)),
  ]);
  const update: Partial<DividendStock> = {};
  if (quote.status === 'fulfilled') { update.quote = quote.value; update.quoteFailedAt = undefined; }
  else update.quoteFailedAt = Date.now();
  if (dividend.status === 'fulfilled') { update.dividend = dividend.value; update.dividendFailedAt = undefined; }
  else update.dividendFailedAt = Date.now();
  await db.dividendStocks.update(code, update);
  return quote.status === 'fulfilled' && dividend.status === 'fulfilled';
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
