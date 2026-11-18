import Dexie, { type Table } from 'dexie';
import { Capacitor, CapacitorHttp } from '@capacitor/core';
import type { DividendFund } from '../lib/dividendFundPlan';
import { dateInChina } from '../lib/dividendWorkbench';
import { httpResponseDataToText } from '../lib/httpResponse';
import {
  csindexIndicatorUrl,
  defaultIndexCodeForFund,
  isCsindexIndicatorSupported,
  parseCsindexDividendYield,
  parseFundBasicIndexInfo,
  parseFundCashPayouts,
  type DividendFundBasicIndexInfo,
  type DividendFundIndexYield,
  type DividendFundMarketCacheEntry,
  type DividendFundPayoutSummary,
} from '../lib/dividendFundYield';
import { dividendBackgroundRefreshPaused } from './dividendRequestControl';

const CACHE_FRESH_MS = 15 * 60 * 1000;
const FUND_MOB_BASE = 'https://fundmobapi.eastmoney.com';
const CSINDEX_BASE = 'https://oss-ch.csindex.com.cn';

const cacheDb = new Dexie('FortunaDividendFundYieldCache');
cacheDb.version(1).stores({ entries: 'key' });
const entries: Table<DividendFundMarketCacheEntry, string> = cacheDb.table('entries');

export interface DividendFundYieldCacheSnapshot {
  byFundCode: Record<string, DividendFundMarketCacheEntry>;
  byIndexCode: Record<string, DividendFundMarketCacheEntry>;
}

export async function loadDividendFundYieldCache(): Promise<DividendFundYieldCacheSnapshot> {
  const rows = await entries.toArray().catch(() => []);
  const byFundCode: Record<string, DividendFundMarketCacheEntry> = {};
  const byIndexCode: Record<string, DividendFundMarketCacheEntry> = {};
  for (const row of rows) {
    if (!row || typeof row.key !== 'string') continue;
    if (row.key.startsWith('fund:') && row.fundCode) {
      byFundCode[row.fundCode] = row;
    } else if (row.key.startsWith('index:') && row.indexCode) {
      byIndexCode[row.indexCode] = row;
    }
  }
  return { byFundCode, byIndexCode };
}

async function fetchJson(url: string): Promise<unknown> {
  let text: string;
  if (Capacitor.isNativePlatform()) {
    const response = await CapacitorHttp.get({
      url,
      responseType: 'text',
      connectTimeout: 8000,
      readTimeout: 8000,
    });
    if (response.status < 200 || response.status >= 300) throw new Error(`HTTP_${response.status}`);
    text = httpResponseDataToText(response.data);
  } else {
    const proxyUrl = url.replace(FUND_MOB_BASE, '/fund-mob-api');
    const response = await fetch(proxyUrl, { cache: 'no-store', signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`HTTP_${response.status}`);
    text = await response.text();
  }
  return JSON.parse(text) as unknown;
}

async function fetchCsindexTable(indexCode: string): Promise<unknown[][] | undefined> {
  const url = csindexIndicatorUrl(indexCode);
  let bytes: ArrayBuffer | Uint8Array;
  if (Capacitor.isNativePlatform()) {
    const response = await CapacitorHttp.get({
      url,
      responseType: 'arraybuffer',
      connectTimeout: 8000,
      readTimeout: 8000,
    });
    if (response.status !== 200 || typeof response.data !== 'string' || response.data.length > 1_000_000) {
      return undefined;
    }
    bytes = Uint8Array.from(atob(response.data), ch => ch.charCodeAt(0));
  } else {
    const proxyUrl = url.replace(CSINDEX_BASE, '/dividend-index-api');
    const response = await fetch(proxyUrl, { cache: 'no-store', signal: AbortSignal.timeout(10000) });
    if (!response.ok) return undefined;
    bytes = await response.arrayBuffer();
    if (bytes.byteLength > 1_000_000) return undefined;
  }
  const mod = await import('xlsx');
  const XLSX = mod.default ?? mod;
  const workbook = XLSX.read(bytes, { type: 'array' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) return undefined;
  return XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 });
}

function isFreshEntry(entry: DividendFundMarketCacheEntry | undefined, today: string, now: number, needsPayout: boolean): boolean {
  if (!entry || now - entry.fetchedAt > CACHE_FRESH_MS) return false;
  if (needsPayout && !entry.payout) return false;
  if (entry.indexCode && isCsindexIndicatorSupported(entry.indexCode) && !entry.indexYield) return false;
  return dateInChina(new Date(entry.fetchedAt)) === today;
}

/**
 * Automatically fetches live fund metadata, tracked index dividend yields (from CSIndex),
 * and fund cash payout histories (from Eastmoney) for configured dividend funds.
 */
export async function refreshDividendFundMarketData(
  funds: readonly DividendFund[],
  options: { force?: boolean; asOf?: string } = {},
): Promise<{ updated: number; failed: number }> {
  if (!funds.length || (!options.force && dividendBackgroundRefreshPaused())) {
    return { updated: 0, failed: 0 };
  }
  const asOf = options.asOf ?? dateInChina();
  const now = Date.now();
  const snapshot = await loadDividendFundYieldCache();

  const codedFunds = [...new Map(
    funds
      .filter(fund => typeof fund.code === 'string' && /^\d{6}$/.test(fund.code.trim()))
      .map(fund => [fund.code!.trim(), fund]),
  ).entries()];

  const uncodedFallbackIndices = new Set(
    funds
      .filter(fund => !fund.code || !/^\d{6}$/.test(fund.code.trim()))
      .map(fund => defaultIndexCodeForFund(fund).indexCode)
      .filter((code): code is string => Boolean(code && isCsindexIndicatorSupported(code))),
  );

  const staleCodedFunds = codedFunds.filter(([code]) => (
    options.force || !isFreshEntry(snapshot.byFundCode[code], asOf, now, true)
  ));

  const staleUncodedIndices = [...uncodedFallbackIndices].filter(indexCode => (
    options.force || !isFreshEntry(snapshot.byIndexCode[indexCode], asOf, now, false)
  ));

  if (staleCodedFunds.length === 0 && staleUncodedIndices.length === 0) {
    return { updated: 0, failed: 0 };
  }

  let failed = 0;
  const fundInfos = new Map<string, { basic?: DividendFundBasicIndexInfo; payout?: DividendFundPayoutSummary }>();

  await Promise.all(staleCodedFunds.map(async ([code]) => {
    const basicUrl = `${FUND_MOB_BASE}/FundMNewApi/FundMNBasicInformation?plat=Android&appType=ttjj&product=EFund&Version=6.5.5&deviceid=1&FCODE=${code}`;
    const bonusUrl = `${FUND_MOB_BASE}/FundMNewApi/FundMNBonusDetail?plat=Android&appType=ttjj&product=EFund&Version=6.5.5&deviceid=1&FCODE=${code}`;
    const [basicRes, bonusRes] = await Promise.allSettled([fetchJson(basicUrl), fetchJson(bonusUrl)]);
    let basic: DividendFundBasicIndexInfo | undefined;
    let payout: DividendFundPayoutSummary | undefined;
    if (basicRes.status === 'fulfilled') {
      try { basic = parseFundBasicIndexInfo(basicRes.value, code, asOf); } catch { /* ignore invalid payload */ }
    }
    if (bonusRes.status === 'fulfilled') {
      try { payout = parseFundCashPayouts(bonusRes.value, asOf); } catch { /* ignore invalid payload */ }
    }
    if (!basic && !payout) failed += 1;
    fundInfos.set(code, { basic, payout });
  }));

  // Collect all CSIndex codes needed across stale funds + uncoded fallback indices
  const indexCodesToFetch = new Set<string>(staleUncodedIndices);
  for (const [code, fund] of staleCodedFunds) {
    const previous = snapshot.byFundCode[code];
    const resolvedIndexCode = fundInfos.get(code)?.basic?.indexCode
      ?? previous?.indexCode
      ?? defaultIndexCodeForFund(fund).indexCode;
    if (resolvedIndexCode && isCsindexIndicatorSupported(resolvedIndexCode)) {
      indexCodesToFetch.add(resolvedIndexCode.toUpperCase());
    }
  }

  const indexYields = new Map<string, DividendFundIndexYield>();
  await Promise.all([...indexCodesToFetch].map(async indexCode => {
    try {
      const table = await fetchCsindexTable(indexCode);
      if (!table) {
        failed += 1;
        return;
      }
      indexYields.set(indexCode, parseCsindexDividendYield(table, indexCode, asOf));
    } catch {
      failed += 1;
    }
  }));

  const writes: DividendFundMarketCacheEntry[] = [];
  for (const [code, fund] of staleCodedFunds) {
    const previous = snapshot.byFundCode[code];
    const info = fundInfos.get(code);
    const defaultIndex = defaultIndexCodeForFund(fund);
    const indexCode = info?.basic?.indexCode ?? previous?.indexCode ?? defaultIndex.indexCode;
    const indexName = info?.basic?.indexName ?? previous?.indexName ?? defaultIndex.indexNameZh;
    const indexYield = (indexCode ? indexYields.get(indexCode) : undefined) ?? previous?.indexYield;
    const payout = info?.payout ?? previous?.payout;
    const navMicros = info?.basic?.navMicros ?? previous?.navMicros;
    const navDate = info?.basic?.navDate ?? previous?.navDate;

    if (!info?.basic && !info?.payout && !indexYield) continue;
    writes.push({
      key: `fund:${code}`,
      fundCode: code,
      ...(indexCode ? { indexCode } : {}),
      ...(indexName ? { indexName } : {}),
      ...(navMicros !== undefined ? { navMicros, navDate } : {}),
      ...(indexYield ? { indexYield } : {}),
      ...(payout ? { payout } : {}),
      fetchedAt: now,
    });
  }

  for (const [indexCode, indexYield] of indexYields) {
    writes.push({
      key: `index:${indexCode}`,
      indexCode,
      ...(indexYield.indexNameZh ? { indexName: indexYield.indexNameZh } : {}),
      indexYield,
      fetchedAt: now,
    });
  }

  if (writes.length > 0) {
    await entries.bulkPut(writes);
  }
  return { updated: writes.length, failed };
}

export function closeDividendFundYieldCache() {
  cacheDb.close();
}
