import { parseTencentDividendTrend } from '../lib/dividendTrend';
import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { db, initializeSettings } from '../db';
import { defaultDividendStocks, isDividendStock, linkedDividendPositions, parseDividendQuote, parseDividendResponse, quoteSymbol, type DividendStock } from '../lib/dividendWorkbench';
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
  return { stocks, budgetMinor: settings?.dividendBudgetMinor ?? 0, positions: linkedDividendPositions(accounts, holdings, txns) };
}
export async function saveDividendBudget(budgetMinor: number) {
  if (!Number.isSafeInteger(budgetMinor) || budgetMinor < 0 || budgetMinor > 1e14) throw new Error('INVALID_BUDGET');
  await db.settings.update('main', { dividendBudgetMinor: budgetMinor });
  requestPortableSnapshot('dividend-budget');
}
export async function saveDividendStock(stock: DividendStock) {
  if (!isDividendStock(stock)) throw new Error('INVALID_DIVIDEND_STOCK');
  await db.dividendStocks.put(stock);
  requestPortableSnapshot('dividend-stock');
}
export async function deleteDividendStock(code: string) {
  await db.dividendStocks.delete(code);
  requestPortableSnapshot('dividend-stock-deleted');
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
