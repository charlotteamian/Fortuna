import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { httpResponseDataToText } from '../lib/httpResponse';
import { defaultDividendStocks, mainlandCode, quoteSymbol, type DividendStock } from '../lib/dividendWorkbench';
import {
  evaluateDividendResearch, isDividendSelectionPrinciples, parseDividendDistributionResearch,
  parseDividendFinancialResearch, parseDividendTechnicalResearch,
  type DividendIndexResearch, type DividendResearchIssue, type DividendResearchSnapshot,
  type DividendResearchSource, type DividendSelectionPrinciples, type DividendStockResearch,
} from '../lib/dividendResearch';

export function defaultDividendResearchCandidates(): Pick<DividendStock, 'code' | 'name'>[] {
  return defaultDividendStocks().map(({ code, name }) => ({ code, name }));
}

export function dividendFinancialSourceUrl(code: string): string {
  if (mainlandCode(code) !== code) throw new Error('INVALID_RESEARCH_CODE');
  const query = new URLSearchParams({ reportName: 'RPT_F10_FINANCE_MAINFINADATA', columns: 'ALL',
    filter: `(SECURITY_CODE="${code}")`, pageNumber: '1', pageSize: '48', sortColumns: 'REPORT_DATE', sortTypes: '-1' });
  return `https://datacenter.eastmoney.com/api/data/v1/get?${query}`;
}
export function dividendResearchDistributionUrl(code: string): string {
  if (mainlandCode(code) !== code) throw new Error('INVALID_RESEARCH_CODE');
  const query = new URLSearchParams({ type: 'RPT_SHAREBONUS_DET', sty: 'ALL', filter: `(SECURITY_CODE="${code}")`,
    p: '1', ps: '500', sr: '-1', st: 'EX_DIVIDEND_DATE', source: 'HSF10', client: 'PC' });
  return `https://datacenter.eastmoney.com/securities/api/data/get?${query}`;
}
function technicalUrl(symbol: string) {
  return `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${symbol},day,,,250,qfq`;
}

async function readJson(url: string): Promise<unknown> {
  let text: string;
  if (Capacitor.isNativePlatform()) {
    const response = await CapacitorHttp.get({ url, responseType: 'text', connectTimeout: 8000, readTimeout: 8000 });
    if (response.status < 200 || response.status >= 300) throw new Error('RESEARCH_REQUEST_FAILED');
    text = httpResponseDataToText(response.data);
  } else {
    const proxy = url.replace('https://web.ifzq.gtimg.cn', '/dividend-trend-api').replace('https://datacenter.eastmoney.com', '/dividend-api');
    const response = await fetch(proxy, { cache: 'no-store', signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error('RESEARCH_REQUEST_FAILED');
    text = await response.text();
  }
  try { return JSON.parse(text); }
  catch { throw new Error('RESEARCH_INVALID_DATA'); }
}

async function download<T>(kind: DividendResearchSource['kind'], url: string, parser: (raw: unknown) => T) {
  try {
    const raw = await readJson(url);
    try {
      const data = parser(raw);
      const source: DividendResearchSource = { kind, provider: kind === 'technical' ? 'Tencent' : 'Eastmoney', url, fetchedAt: Date.now() };
      return { data, source };
    } catch {
      return { issue: { kind, reason: 'invalid_data' } as DividendResearchIssue };
    }
  } catch (error) {
    return { issue: { kind, reason: error instanceof Error && error.message === 'RESEARCH_INVALID_DATA' ? 'invalid_data' : 'request_failed' } as DividendResearchIssue };
  }
}

async function fetchStock(stock: Pick<DividendStock, 'code' | 'name'>, principles: DividendSelectionPrinciples): Promise<DividendStockResearch> {
  const symbol = quoteSymbol(stock.code);
  const [technical, financial, distributions] = await Promise.all([
    download('technical', technicalUrl(symbol), raw => parseDividendTechnicalResearch(raw, stock.code, symbol)),
    download('financial', dividendFinancialSourceUrl(stock.code), raw => parseDividendFinancialResearch(raw, stock.code)),
    download('dividend', dividendResearchDistributionUrl(stock.code), raw => parseDividendDistributionResearch(raw, stock.code)),
  ]);
  if (technical.source) technical.source.asOf = technical.data!.asOf;
  if (financial.source) financial.source.asOf = financial.data!.latest.reportDate;
  if (distributions.source) distributions.source.asOf = distributions.data!.asOf;
  return evaluateDividendResearch({ code: stock.code, name: financial.data?.name || stock.name,
    technical: technical.data, financial: financial.data, distributions: distributions.data,
    yieldBps: technical.data && distributions.data ? Math.round(distributions.data.dpsMicros / technical.data.lastCloseMinor) : undefined,
    checks: [], status: 'unknown', sources: [technical.source, financial.source, distributions.source].filter((value): value is DividendResearchSource => !!value),
    issues: [technical.issue, financial.issue, distributions.issue].filter((value): value is DividendResearchIssue => !!value),
  }, principles);
}

const INDICES: Pick<DividendIndexResearch, 'code' | 'name'>[] = [
  { code: 'sh000001', name: '上证指数' }, { code: 'sh000300', name: '沪深300' }, { code: 'sz399006', name: '创业板指' },
];

/** Each explicit request is bounded. Failed/deferred downloads remain unknown, never a synthetic pass. */
export async function fetchDividendResearch(
  stocks: Pick<DividendStock, 'code' | 'name'>[],
  principles: DividendSelectionPrinciples,
  options: { maxStocks?: number; timeBudgetMs?: number } = {},
): Promise<DividendResearchSnapshot> {
  if (!isDividendSelectionPrinciples(principles)) throw new Error('INVALID_DIVIDEND_PRINCIPLES');
  if (!Array.isArray(stocks) || stocks.some(stock => !stock || mainlandCode(stock.code) !== stock.code)) throw new Error('INVALID_RESEARCH_CODES');
  const unique = [...new Map(stocks.map(stock => [stock.code, stock])).values()];
  const maximum = Math.max(1, Math.min(100, options.maxStocks ?? 40));
  const deadline = Date.now() + Math.max(1000, Math.min(60000, options.timeBudgetMs ?? 20000));
  const results = new Map<string, DividendStockResearch>();
  let cursor = 0;
  const stockTasks = Promise.all(Array.from({ length: Math.min(4, maximum, unique.length) }, async () => {
    while (cursor < Math.min(unique.length, maximum) && Date.now() < deadline) {
      const stock = unique[cursor++];
      results.set(stock.code, await fetchStock(stock, principles));
    }
  }));
  const indexTasks = Promise.all(INDICES.map(async index => {
    const result = await download('technical', technicalUrl(index.code), raw => parseDividendTechnicalResearch(raw, index.code.slice(2), index.code));
    if (result.source) result.source.asOf = result.data!.asOf;
    return { ...index, technical: result.data, sources: result.source ? [result.source] : [], issues: result.issue ? [result.issue] : [] };
  }));
  const [, indices] = await Promise.all([stockTasks, indexTasks]);
  return { generatedAt: Date.now(), principles: { ...principles }, indices,
    stocks: unique.map(stock => results.get(stock.code) ?? evaluateDividendResearch({ ...stock, checks: [], status: 'unknown', sources: [],
      issues: (['technical', 'financial', 'dividend'] as const).map(kind => ({ kind, reason: 'deferred' })) }, principles)) };
}
