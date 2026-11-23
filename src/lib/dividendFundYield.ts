import type { DividendFund } from './dividendFundPlan.ts';

export interface DividendFundIndexYield {
  indexCode: string;
  indexNameZh?: string;
  indexNameEn?: string;
  /** Official CSIndex D/P1 (total-share dividend yield) in basis points, e.g. 449 = 4.49%. */
  yieldBps: number;
  asOf: string;
  sourceUrl: string;
}

export interface DividendFundPayoutEvent {
  exDate: string;
  payoutMicros: number;
  rawPayoutMicros: number;
}

export interface DividendFundPayoutSummary {
  status: 'paid' | 'none';
  trailing12mMicros: number;
  trailingCount: number;
  totalCount: number;
  latestExDate?: string;
  latestPayoutMicros?: number;
  asOf: string;
}

export interface DividendFundNavPoint {
  date: string;
  navMicros: number;
}

export interface DividendFundGridAnchor {
  asOf: string;
  yieldBps: number;
  anchorPriceMicros: number;
  impliedAnnualDpsMicros: number;
}

export interface DividendFundGridUpdateNotice {
  fundCode?: string;
  previousAsOf: string;
  previousYieldBps: number;
  previousAnchorPriceMicros: number;
  previousDpsMicros: number;
  currentAsOf: string;
  currentYieldBps: number;
  currentAnchorPriceMicros: number;
  currentDpsMicros: number;
  updatedAt: number;
  dismissed?: boolean;
}

export interface DividendFundMarketCacheEntry {
  key: string;
  fundCode?: string;
  indexCode?: string;
  indexName?: string;
  navMicros?: number;
  navDate?: string;
  navHistory?: DividendFundNavPoint[];
  indexYield?: DividendFundIndexYield;
  payout?: DividendFundPayoutSummary;
  anchorSnapshot?: DividendFundGridAnchor;
  updateNotice?: DividendFundGridUpdateNotice;
  fetchedAt: number;
}

export interface DividendFundBasicIndexInfo {
  code: string;
  shortName?: string;
  indexCode?: string;
  indexName?: string;
  navMicros?: number;
  navDate?: string;
}

export interface ResolvedFundYieldSnapshot {
  indexCode?: string;
  indexName?: string;
  priceMicros?: number;
  indexYield?: DividendFundIndexYield & { sourceKind: 'csindex' | 'manual' };
  anchorPriceMicros?: number;
  anchorDate?: string;
  anchorDateMatched: boolean;
  impliedAnnualDpsMicros?: number;
  liveEstimatedYieldBps?: number;
  payout?: DividendFundPayoutSummary;
  payoutYieldBps?: number;
  updateNotice?: DividendFundGridUpdateNotice;
}

const KNOWN_FUND_INDEX_MAP: Record<string, { indexCode: string; indexNameZh: string }> = {
  '512890': { indexCode: 'H30269', indexNameZh: '中证红利低波动指数' },
  '563020': { indexCode: 'H30269', indexNameZh: '中证红利低波动指数' },
  '005561': { indexCode: 'H30269', indexNameZh: '中证红利低波动指数' },
  '159547': { indexCode: 'H30269', indexNameZh: '中证红利低波动指数' },
  '560150': { indexCode: 'H30269', indexNameZh: '中证红利低波动指数' },
  '159307': { indexCode: '930955', indexNameZh: '中证红利低波动100指数' },
  '515100': { indexCode: '930955', indexNameZh: '中证红利低波动100指数' },
  '515180': { indexCode: '000922', indexNameZh: '中证红利指数' },
  '515080': { indexCode: '000922', indexNameZh: '中证红利指数' },
  '100032': { indexCode: '000922', indexNameZh: '中证红利指数' },
  '090010': { indexCode: '000922', indexNameZh: '中证红利指数' },
  '159581': { indexCode: '000922', indexNameZh: '中证红利指数' },
  '510880': { indexCode: '000015', indexNameZh: '上证红利指数' },
};

export function defaultIndexCodeForFund(fund: Pick<DividendFund, 'code' | 'indexKind'>): { indexCode?: string; indexNameZh?: string } {
  const code = fund.code?.trim();
  if (code && KNOWN_FUND_INDEX_MAP[code]) return KNOWN_FUND_INDEX_MAP[code];
  if (fund.indexKind === 'low_volatility') return { indexCode: 'H30269', indexNameZh: '中证红利低波动指数' };
  if (fund.indexKind === 'low_volatility_100') return { indexCode: '930955', indexNameZh: '中证红利低波动100指数' };
  return {};
}

export function isCsindexIndicatorSupported(indexCode?: string): boolean {
  if (!indexCode) return false;
  return /^(?:000\d{3}|9[35]\d{4}|H\d{5})$/i.test(indexCode.trim());
}

export function csindexIndicatorUrl(indexCode: string): string {
  return `https://oss-ch.csindex.com.cn/static/html/csindex/public/uploads/file/autofile/indicator/${indexCode.trim().toUpperCase()}indicator.xls`;
}

function validCalendarDate(raw: unknown): string | undefined {
  if (raw === undefined || raw === null) return undefined;
  const cleaned = String(raw).trim().replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) return undefined;
  const parsed = Date.parse(`${cleaned}T00:00:00Z`);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== cleaned) return undefined;
  return cleaned;
}

function oneYearBefore(asOf: string): string {
  const [y, m, d] = asOf.split('-').map(Number);
  const prevYear = y - 1;
  const maxDay = new Date(Date.UTC(prevYear, m, 0)).getUTCDate();
  return `${String(prevYear).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(Math.min(d, maxDay)).padStart(2, '0')}`;
}

/** Parses any CSIndex indicator XLS sheet (`000922`, `H30269`, `930955`, `000015`, etc.) for official D/P1 yield. */
export function parseCsindexDividendYield(table: unknown[][], indexCode: string, asOf: string): DividendFundIndexYield {
  const target = indexCode.trim().toUpperCase();
  const header = table[0]?.map(value => String(value ?? '')) ?? [];
  const dateIndex = header.findIndex(v => /日期|Date/i.test(v));
  const codeIndex = header.findIndex(v => /指数代码|Index Code/i.test(v));
  const yieldIndex = header.findIndex(v => /股息率1|D\/P1/i.test(v));
  const zhNameIndex = header.findIndex(v => /指数中文简称|Index Chinese Name/i.test(v));
  const enNameIndex = header.findIndex(v => /指数英文简称|Index English Name/i.test(v));
  if (dateIndex < 0 || codeIndex < 0 || yieldIndex < 0) throw new Error('CSINDEX_COLUMNS_INVALID');

  const rows: { date: string; yieldBps: number; indexNameZh?: string; indexNameEn?: string }[] = [];
  for (const row of table.slice(1)) {
    const rawCode = String(row?.[codeIndex] ?? '').trim().toUpperCase();
    const normalizedCode = /^\d+$/.test(rawCode) ? rawCode.padStart(6, '0') : rawCode;
    if (normalizedCode !== target) continue;
    const date = validCalendarDate(row?.[dateIndex]);
    const numericYield = typeof row?.[yieldIndex] === 'number'
      ? row[yieldIndex]
      : Number(String(row?.[yieldIndex] ?? '').trim());
    const yieldBps = Number.isFinite(numericYield) ? Math.round(numericYield * 100) : NaN;
    if (!date || date > asOf || !Number.isSafeInteger(yieldBps) || yieldBps <= 0 || yieldBps >= 3000) continue;
    const zhName = zhNameIndex >= 0 ? String(row?.[zhNameIndex] ?? '').trim() : '';
    const enName = enNameIndex >= 0 ? String(row?.[enNameIndex] ?? '').trim() : '';
    rows.push({
      date,
      yieldBps,
      ...(zhName ? { indexNameZh: zhName } : {}),
      ...(enName ? { indexNameEn: enName } : {}),
    });
  }
  rows.sort((a, b) => b.date.localeCompare(a.date));
  const latest = rows[0];
  if (!latest) throw new Error('CSINDEX_SOURCE_INVALID');
  return {
    indexCode: target,
    ...(latest.indexNameZh ? { indexNameZh: latest.indexNameZh } : {}),
    ...(latest.indexNameEn ? { indexNameEn: latest.indexNameEn } : {}),
    yieldBps: latest.yieldBps,
    asOf: latest.date,
    sourceUrl: csindexIndicatorUrl(target),
  };
}

/** Parses Eastmoney `FundMNBasicInformation` response for tracked index code, index name, and latest NAV. */
export function parseFundBasicIndexInfo(raw: unknown, code: string, asOf: string): DividendFundBasicIndexInfo {
  const payload = raw as {
    Success?: boolean;
    Datas?: {
      FCODE?: string;
      SHORTNAME?: string;
      INDEXCODE?: string;
      INDEXNAME?: string;
      DWJZ?: string | number;
      FSRQ?: string;
    } | null;
  };
  if (!payload?.Success || !payload.Datas || payload.Datas.FCODE !== code) {
    throw new Error('FUND_BASIC_INFO_INVALID');
  }
  const d = payload.Datas;
  const clean = (value: unknown) => {
    const text = typeof value === 'string' ? value.trim() : '';
    return text && text !== '--' ? text : undefined;
  };
  const indexCode = clean(d.INDEXCODE)?.toUpperCase();
  const indexName = clean(d.INDEXNAME);
  const shortName = clean(d.SHORTNAME);
  const rawNav = Number(d.DWJZ);
  const navDate = validCalendarDate(d.FSRQ);
  const navMicros = Number.isFinite(rawNav) && rawNav > 0 && rawNav <= 1e6 && navDate && navDate <= asOf
    ? Math.round(rawNav * 1_000_000)
    : undefined;
  return {
    code,
    ...(shortName ? { shortName } : {}),
    ...(indexCode ? { indexCode } : {}),
    ...(indexName ? { indexName } : {}),
    ...(navMicros !== undefined ? { navMicros, navDate } : {}),
  };
}

/** Parses Eastmoney `FundMNHisNetList` response into date-sorted unit NAV points. */
export function parseFundNavHistory(raw: unknown, asOf: string): DividendFundNavPoint[] {
  const payload = raw as {
    Success?: boolean;
    Datas?: { FSRQ?: string; DWJZ?: string | number }[] | null;
  };
  if (!payload?.Success || !Array.isArray(payload.Datas)) {
    throw new Error('FUND_NAV_HISTORY_INVALID');
  }
  const byDate = new Map<string, number>();
  for (const row of payload.Datas) {
    const date = validCalendarDate(row?.FSRQ);
    const rawNav = Number(row?.DWJZ);
    if (!date || date > asOf || !Number.isFinite(rawNav) || rawNav <= 0 || rawNav > 1e6) continue;
    if (!byDate.has(date)) byDate.set(date, Math.round(rawNav * 1_000_000));
  }
  return [...byDate.entries()]
    .map(([date, navMicros]) => ({ date, navMicros }))
    .sort((a, b) => b.date.localeCompare(a.date));
}

/** Merges multiple NAV history lists while keeping newest points up to maxCount. */
export function mergeFundNavHistory(
  primary: readonly DividendFundNavPoint[],
  secondary: readonly DividendFundNavPoint[] = [],
  maxCount = 20,
): DividendFundNavPoint[] {
  const byDate = new Map<string, number>();
  for (const point of [...primary, ...secondary]) {
    if (point.date && Number.isSafeInteger(point.navMicros) && point.navMicros > 0 && !byDate.has(point.date)) {
      byDate.set(point.date, point.navMicros);
    }
  }
  return [...byDate.entries()]
    .map(([date, navMicros]) => ({ date, navMicros }))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, maxCount);
}

/** Computes a fixed equivalent annual DPS anchor from same-day price/NAV and index yield. */
export function computeFundGridAnchor(
  asOf: string,
  yieldBps: number,
  anchorPriceMicros: number,
): DividendFundGridAnchor {
  return {
    asOf,
    yieldBps,
    anchorPriceMicros,
    impliedAnnualDpsMicros: Math.max(1, Math.round((anchorPriceMicros * yieldBps) / 10000)),
  };
}

/** Converts a yield tier (%) into a fixed fund reference price using the anchored DPS. */
export function computeFundTierPrice(
  snapshot: Pick<ResolvedFundYieldSnapshot, 'impliedAnnualDpsMicros'>,
  tierYieldPct: number,
): number | undefined {
  if (!snapshot.impliedAnnualDpsMicros || snapshot.impliedAnnualDpsMicros <= 0 || !Number.isFinite(tierYieldPct) || tierYieldPct <= 0) {
    return undefined;
  }
  return (snapshot.impliedAnnualDpsMicros / 1_000_000) / (tierYieldPct / 100);
}

/**
 * Compares a newly resolved anchor against the previously stored anchor and produces
 * an undismissed update notice whenever the underlying index yield or reference NAV changes.
 */
export function detectFundAnchorUpdate(
  previousAnchor: DividendFundGridAnchor | undefined,
  nextAnchor: DividendFundGridAnchor | undefined,
  previousNotice: DividendFundGridUpdateNotice | undefined,
  fundCode: string | undefined,
  now: number,
): DividendFundGridUpdateNotice | undefined {
  if (!nextAnchor || !previousAnchor) return previousNotice;
  const changed = previousAnchor.asOf !== nextAnchor.asOf
    || previousAnchor.yieldBps !== nextAnchor.yieldBps
    || previousAnchor.anchorPriceMicros !== nextAnchor.anchorPriceMicros;
  if (!changed) return previousNotice;
  return {
    ...(fundCode ? { fundCode } : {}),
    previousAsOf: previousAnchor.asOf,
    previousYieldBps: previousAnchor.yieldBps,
    previousAnchorPriceMicros: previousAnchor.anchorPriceMicros,
    previousDpsMicros: previousAnchor.impliedAnnualDpsMicros,
    currentAsOf: nextAnchor.asOf,
    currentYieldBps: nextAnchor.yieldBps,
    currentAnchorPriceMicros: nextAnchor.anchorPriceMicros,
    currentDpsMicros: nextAnchor.impliedAnnualDpsMicros,
    updatedAt: now,
    dismissed: false,
  };
}

/** Parses Eastmoney `FundMNBonusDetail` response into split-adjusted cash dividend summary. */
export function parseFundCashPayouts(raw: unknown, asOf: string): DividendFundPayoutSummary {
  const payload = raw as {
    Success?: boolean;
    Datas?: {
      FHINFO?: Record<string, unknown>[];
      FCINFO?: Record<string, unknown>[];
    } | null;
  };
  if (!payload || payload.Success !== true) throw new Error('FUND_BONUS_INVALID');
  if (payload.Datas === null) {
    return { status: 'none', trailing12mMicros: 0, trailingCount: 0, totalCount: 0, asOf };
  }
  if (typeof payload.Datas !== 'object' || !Array.isArray(payload.Datas.FHINFO)) {
    throw new Error('FUND_BONUS_INVALID');
  }

  const splits = (Array.isArray(payload.Datas.FCINFO) ? payload.Datas.FCINFO : []).flatMap(row => {
    const exDate = validCalendarDate(row?.FSRQ);
    const kind = String(row?.FHFCBZ ?? '');
    const label = String(row?.CFLX ?? '');
    const factor = Number(row?.FHFCZ);
    if (!exDate || exDate > asOf || (kind !== '105' && !/分拆/.test(label)) || !Number.isFinite(factor) || factor <= 0) {
      return [];
    }
    return [{ exDate, factor }];
  });

  const events: DividendFundPayoutEvent[] = [];
  for (const row of payload.Datas.FHINFO) {
    const exDate = validCalendarDate(row?.FSRQ);
    const kind = String(row?.FHFCBZ ?? '');
    const text = String(row?.FH ?? '');
    const amount = Number(row?.FHFCZ);
    const isCash = kind === '0' || /派现金/.test(text);
    if (!exDate || exDate > asOf || !isCash || !Number.isFinite(amount) || amount <= 0) continue;
    const rawPayoutMicros = Math.round(amount * 1_000_000);
    const laterFactor = splits
      .filter(split => split.exDate > exDate && split.exDate <= asOf)
      .reduce((acc, split) => acc * split.factor, 1);
    const payoutMicros = Math.round(rawPayoutMicros / laterFactor);
    events.push({ exDate, payoutMicros, rawPayoutMicros });
  }
  events.sort((a, b) => b.exDate.localeCompare(a.exDate));

  if (events.length === 0) {
    return { status: 'none', trailing12mMicros: 0, trailingCount: 0, totalCount: 0, asOf };
  }
  const cutoff = oneYearBefore(asOf);
  const trailing = events.filter(event => event.exDate > cutoff && event.exDate <= asOf);
  const trailing12mMicros = trailing.reduce((sum, event) => sum + event.payoutMicros, 0);
  return {
    status: 'paid',
    trailing12mMicros,
    trailingCount: trailing.length,
    totalCount: events.length,
    latestExDate: events[0].exDate,
    latestPayoutMicros: events[0].payoutMicros,
    asOf,
  };
}

/**
 * Resolves live/cached tracked index yield, date-aligned equivalent annual DPS anchor,
 * real-time estimated yield, and fund cash payout status for a single fund.
 * Never falls back to a plan-wide shared yield (`fundPlan.indexYieldBps`).
 */
export function resolveFundYieldSnapshot(
  fund: Pick<DividendFund, 'code' | 'indexKind' | 'quote' | 'reference'>,
  fundCache?: DividendFundMarketCacheEntry,
  indexCacheByCode?: Record<string, DividendFundMarketCacheEntry>,
  holdingPriceMicros?: number,
): ResolvedFundYieldSnapshot {
  const fallbackIndex = defaultIndexCodeForFund(fund);
  const indexCode = fundCache?.indexCode ?? fallbackIndex.indexCode;
  const indexName = fundCache?.indexName ?? fallbackIndex.indexNameZh;

  const priceMicros = fund.quote?.priceMicros
    ?? fundCache?.navMicros
    ?? fund.reference?.priceMicros
    ?? (holdingPriceMicros && holdingPriceMicros > 0 ? holdingPriceMicros : undefined);

  const scrapedIndexYield = fundCache?.indexYield
    ?? (indexCode ? indexCacheByCode?.[indexCode]?.indexYield : undefined);

  const indexYield: ResolvedFundYieldSnapshot['indexYield'] = scrapedIndexYield
    ? { ...scrapedIndexYield, sourceKind: 'csindex' }
    : fund.reference?.indexYieldBps !== undefined && fund.reference.indexYieldBps > 0
      ? {
          indexCode: indexCode ?? 'MANUAL',
          ...(indexName ? { indexNameZh: indexName } : {}),
          yieldBps: fund.reference.indexYieldBps,
          asOf: fund.reference.asOf,
          sourceUrl: fund.reference.source ?? '',
          sourceKind: 'manual',
        }
      : undefined;

  let anchorPriceMicros: number | undefined;
  let anchorDateMatched = false;
  const anchorDate = indexYield?.asOf;
  if (indexYield && anchorDate) {
    if (indexYield.sourceKind === 'csindex') {
      const historyMatch = fundCache?.navHistory?.find(point => point.date === anchorDate)?.navMicros;
      const latestNavMatch = fundCache?.navDate === anchorDate ? fundCache.navMicros : undefined;
      const quoteDateMatch = fund.quote?.date?.slice(0, 10) === anchorDate && fund.quote.priceMicros > 0
        ? fund.quote.priceMicros
        : undefined;
      const refDateMatch = fund.reference?.asOf === anchorDate && fund.reference.priceMicros
        ? fund.reference.priceMicros
        : undefined;
      const exactMatch = historyMatch ?? latestNavMatch ?? quoteDateMatch ?? refDateMatch;
      if (exactMatch !== undefined && exactMatch > 0) {
        anchorPriceMicros = exactMatch;
        anchorDateMatched = true;
      } else {
        // No price was observed exactly on the anchor date. Prefer the saved reference
        // anchor over the latest NAV, which belongs to a different date and would misprice
        // the tier (audit A13). A reference that does not match the anchor date is still
        // only a fallback, so it is not treated as an exact anchor match.
        anchorPriceMicros = fund.reference?.priceMicros ?? fundCache?.navMicros ?? priceMicros;
        anchorDateMatched = Boolean(fund.reference?.priceMicros && fund.reference.asOf === anchorDate);
      }
    } else {
      anchorPriceMicros = fund.reference?.priceMicros ?? priceMicros;
      anchorDateMatched = Boolean(fund.reference?.priceMicros);
    }
  }

  const impliedAnnualDpsMicros = indexYield && anchorPriceMicros && anchorPriceMicros > 0
    ? Math.max(1, Math.round((anchorPriceMicros * indexYield.yieldBps) / 10000))
    : undefined;

  const liveEstimatedYieldBps = impliedAnnualDpsMicros && priceMicros && priceMicros > 0
    ? Math.max(1, Math.round((impliedAnnualDpsMicros * 10000) / priceMicros))
    : indexYield?.yieldBps;

  const payout = fundCache?.payout;
  const payoutYieldBps = payout?.status === 'paid' && payout.trailing12mMicros > 0 && priceMicros && priceMicros > 0
    ? Math.round((payout.trailing12mMicros * 10000) / priceMicros)
    : undefined;

  return {
    ...(indexCode ? { indexCode } : {}),
    ...(indexName ? { indexName } : {}),
    ...(priceMicros !== undefined ? { priceMicros } : {}),
    ...(indexYield ? { indexYield } : {}),
    ...(anchorPriceMicros !== undefined ? { anchorPriceMicros } : {}),
    ...(anchorDate ? { anchorDate } : {}),
    anchorDateMatched,
    ...(impliedAnnualDpsMicros !== undefined ? { impliedAnnualDpsMicros } : {}),
    ...(liveEstimatedYieldBps !== undefined ? { liveEstimatedYieldBps } : {}),
    ...(payout ? { payout } : {}),
    ...(payoutYieldBps !== undefined ? { payoutYieldBps } : {}),
    ...(fundCache?.updateNotice ? { updateNotice: fundCache.updateNotice } : {}),
  };
}
