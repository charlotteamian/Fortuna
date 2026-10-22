import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { httpResponseDataToText } from '../lib/httpResponse';
import { defaultDividendStocks, mainlandCode, quoteSymbol, type DividendStock } from '../lib/dividendWorkbench';
import {
  evaluateDividendResearch, isDividendSelectionPrinciples, parseDividendDistributionResearch,
  parseDividendFinancialResearch, parseDividendTechnicalResearch,
  type DividendIndexResearch, type DividendResearchIssue, type DividendResearchSnapshot,
  type DividendResearchSource, type DividendSelectionPrinciples, type DividendStockResearch,
} from '../lib/dividendResearch';
import { calculateDividendPricing, defaultDividendPricingMethod, isDividendPricingMethod, parseDividendTreasury, dividendPricingAnnuals,
  dividendPricingPriceHistory, dividendPricingYieldHistory, dividendPricingHistoryCoverage, parseDividendOpportunityRows, DIVIDEND_OPPORTUNITY_URL,
  type DividendPricingMethod, type DividendTreasuryResearch, type DividendOpportunityResearch } from '../lib/dividendPricing';
import { dateInChina } from '../lib/dividendWorkbench';

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
export function dividendTechnicalSourceUrl(symbol: string) {
  return `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${symbol},day,,,250,qfq`;
}
export function dividendCashFlowSourceUrl(code: string) {
  if (mainlandCode(code) !== code) throw new Error('INVALID_RESEARCH_CODE');
  const query = new URLSearchParams({ reportName: 'RPT_DMSK_FN_CASHFLOW', columns: 'ALL', filter: `(SECURITY_CODE="${code}")`, pageNumber: '1', pageSize: '48', sortColumns: 'REPORT_DATE', sortTypes: '-1' });
  return `https://datacenter.eastmoney.com/api/data/v1/get?${query}`;
}
export function dividendTreasurySourceUrl(page=1) {
  return `https://datacenter.eastmoney.com/api/data/v1/get?${new URLSearchParams({ reportName:'RPTA_WEB_TREASURYYIELD', columns:'SOLAR_DATE,EMM00166466', pageNumber:String(page), pageSize:'500', sortColumns:'SOLAR_DATE', sortTypes:'-1' })}`;
}
async function fetchMacro(asOf: string): Promise<DividendTreasuryResearch | undefined> {
  const responses = await Promise.allSettled(Array.from({length:6},(_,i) => readJson(dividendTreasurySourceUrl(i+1))));
  const data = responses.flatMap(r => { if (r.status !== 'fulfilled') return []; const p=r.value as {success?:boolean;result?:{data?:unknown[]}}; return p?.success && Array.isArray(p.result?.data) ? p.result.data : []; });
  try { return parseDividendTreasury({success:true,result:{data}},asOf); } catch { return undefined; }
}
async function fetchOpportunity(asOf: string): Promise<DividendOpportunityResearch | undefined> {
  try {
    let bytes: ArrayBuffer | Uint8Array;
    if (Capacitor.isNativePlatform()) {
      const r = await CapacitorHttp.get({ url:DIVIDEND_OPPORTUNITY_URL, responseType:'arraybuffer', connectTimeout:8000, readTimeout:8000 });
      if (r.status !== 200 || typeof r.data !== 'string' || r.data.length > 1000000) return undefined;
      bytes = Uint8Array.from(atob(r.data), ch => ch.charCodeAt(0));
    } else {
      const r = await fetch(DIVIDEND_OPPORTUNITY_URL.replace('https://oss-ch.csindex.com.cn','/dividend-index-api'), {cache:'no-store',signal:AbortSignal.timeout(10000)});
      if (!r.ok) return undefined;
      bytes = await r.arrayBuffer(); if (bytes.byteLength > 1000000) return undefined;
    }
    const module = await import('xlsx'), XLSX = module.default ?? module;
    const workbook = XLSX.read(bytes,{type:'array'});
    return parseDividendOpportunityRows(XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[workbook.SheetNames[0]],{header:1}), asOf);
  } catch { return undefined; }
}

async function readJson(url: string): Promise<unknown> {
  let text: string;
  if (Capacitor.isNativePlatform()) {
    const response = await CapacitorHttp.get({ url, responseType: 'text', connectTimeout: 8000, readTimeout: 8000 });
    if (response.status < 200 || response.status >= 300) throw new Error(`RESEARCH_HTTP_${response.status}`);
    text = httpResponseDataToText(response.data);
  } else {
    const proxy = url.replace('https://web.ifzq.gtimg.cn', '/dividend-trend-api')
      .replace('https://proxy.finance.qq.com', '/dividend-tencent-api').replace('https://datacenter.eastmoney.com', '/dividend-api');
    const response = await fetch(proxy, { cache: 'no-store', signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`RESEARCH_HTTP_${response.status}`);
    text = await response.text();
  }
  try { return JSON.parse(text); }
  catch { throw new Error('RESEARCH_INVALID_DATA'); }
}

async function download<T>(kind: DividendResearchSource['kind'], url: string, parser: (raw: unknown) => T,
  options: { retryUrl?: string; validate?: (data: T) => Promise<string | undefined>; preferPartial?: (candidate:T, previous:T) => boolean } = {}):
  Promise<{ data?:T; source?:DividendResearchSource; issue?:DividendResearchIssue }> {
  // The two Tencent hosts expose the same dated payload. Retry a failed or invalid
  // response once through Tencent's public proxy, preserving the successful URL.
  const urls = url.startsWith('https://web.ifzq.gtimg.cn/')
    ? [url, options.retryUrl ?? url.replace('https://web.ifzq.gtimg.cn', 'https://proxy.finance.qq.com/ifzqgtimg')] : [url];
  let reason: DividendResearchIssue['reason'] = 'request_failed';
  const failures: string[] = [];
  let partial: { data: T; source: DividendResearchSource } | undefined;
  for (const sourceUrl of urls) {
    try {
      const raw = await readJson(sourceUrl);
      let data: T;
      try { data = parser(raw); }
      catch (error) {
        reason = 'invalid_data';
        failures.push(error instanceof Error ? error.message : 'RESEARCH_PARSE_FAILED');
        continue;
      }
      const source: DividendResearchSource = { kind, provider: kind === 'technical' ? 'Tencent' : 'Eastmoney', url:sourceUrl, fetchedAt: Date.now() };
      const gap = await options.validate?.(data);
      if (gap) {
        reason = 'invalid_data'; failures.push(gap);
        // Keep a real partial series/current price if every attempt is short.
        if (!partial || options.preferPartial?.(data, partial.data)) partial = { data, source };
        continue;
      }
      return { data, source };
    } catch (error) {
      reason = error instanceof Error && error.message === 'RESEARCH_INVALID_DATA' ? 'invalid_data' : 'request_failed';
      failures.push(error instanceof Error ? error.message : 'RESEARCH_REQUEST_FAILED');
    }
  }
  return { ...partial, issue: { kind, reason, url, detail:failures.join(' → ').slice(0,300), attempts:urls.length } as DividendResearchIssue };
}

async function fetchStock(stock: Pick<DividendStock, 'code' | 'name'>, principles: DividendSelectionPrinciples, method: DividendPricingMethod,
  macro: Promise<DividendTreasuryResearch | undefined>, opportunityTask: Promise<DividendOpportunityResearch | undefined>): Promise<DividendStockResearch> {
  const symbol = quoteSymbol(stock.code);
  const asOf = dateInChina(), cashUrl = dividendCashFlowSourceUrl(stock.code), monthUrl = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${symbol},month,,,120,`;
  const distributionTask = download('dividend', dividendResearchDistributionUrl(stock.code), raw => ({...parseDividendDistributionResearch(raw, stock.code), pricingRaw:raw}));
  const [technical, financial, distributions, cash, monthly, treasury, opportunity] = await Promise.all([
    download('technical', dividendTechnicalSourceUrl(symbol), raw => parseDividendTechnicalResearch(raw, stock.code, symbol)),
    download('financial', dividendFinancialSourceUrl(stock.code), raw => ({...parseDividendFinancialResearch(raw, stock.code), pricingRaw:raw})),
    distributionTask,
    download('financial', cashUrl, raw => { const p=raw as {success?:boolean;result?:{data?:Record<string,unknown>[]}}; if (!p?.success || !Array.isArray(p.result?.data) || p.result.data.some(r=>r.SECURITY_CODE!==stock.code)) throw new Error('CASH_INVALID'); return raw; }),
    download('technical', monthUrl, raw => dividendPricingPriceHistory(raw,symbol,asOf), {
      retryUrl:`https://proxy.finance.qq.com/ifzqgtimg/appstock/app/fqkline/get?param=${symbol},month,,,320,`,
      preferPartial:(candidate, previous) => candidate.at(-1)!.date > previous.at(-1)!.date
        || candidate.at(-1)!.date === previous.at(-1)!.date && candidate.length > previous.length,
      validate:async prices => {
        const distribution = await distributionTask;
        if (!distribution.data) return undefined;
        const history = dividendPricingYieldHistory(prices.filter(p => p.date.slice(0,7) < asOf.slice(0,7)), distribution.data.pricingRaw, stock.code);
        const coverage = dividendPricingHistoryCoverage(history, asOf);
        const gaps = coverage.reasons.filter(reason => reason !== 'capital_actions_unverified');
        return gaps.length ? `PRICE_HISTORY_INCOMPLETE:${coverage.sampleCount}/60:${coverage.from ?? '-'}:${coverage.through ?? '-'}:${gaps.join(',')}` : undefined;
      },
    }), macro, opportunityTask,
  ]);
  if (technical.source) technical.source.asOf = technical.data!.asOf;
  if (financial.source) financial.source.asOf = financial.data!.latest.reportDate;
  if (distributions.source) distributions.source.asOf = distributions.data!.asOf;
  if (monthly.source) monthly.source.asOf = monthly.data!.at(-1)?.date;
  if (cash.source) cash.source.asOf = String((cash.data as {result:{data:Record<string,unknown>[]}}).result.data[0]?.REPORT_DATE ?? '').slice(0,10) || undefined;
  const unadjusted = monthly.data?.at(-1);
  let pricing;
  if (financial.data && distributions.data) {
    const industry=(cash.data as {result?:{data?:Record<string,unknown>[]}} | undefined)?.result?.data?.[0]?.INDUSTRY_NAME;
    if (typeof industry==='string' && industry.trim()) financial.data.sector=industry;
    const raw = financial.data.pricingRaw as {result:{data:Record<string,unknown>[]}};
    const last = raw.result.data.filter(r => String(r.REPORT_DATE).slice(0,10) <= asOf && String(r.NOTICE_DATE).slice(0,10) <= asOf).sort((a,b)=>String(b.REPORT_DATE).localeCompare(String(a.REPORT_DATE)))[0];
    const bvps = typeof last?.BPS === 'number' && last.BPS > 0 ? Math.round(last.BPS*1e6) : undefined;
    pricing = calculateDividendPricing({code:stock.code,name:stock.name,financialSector:financial.data.financialSector,sector:financial.data.sector, financialReview:financial.data.sectorReview, method,
      annuals:dividendPricingAnnuals(financial.data.pricingRaw,cash.data,distributions.data.pricingRaw,stock.code,asOf), treasury,
      history:monthly.data ? dividendPricingYieldHistory(monthly.data.filter(p => p.date.slice(0,7) < asOf.slice(0,7)),distributions.data.pricingRaw,stock.code,treasury) : undefined,
      opportunity, priceMinor:unadjusted?.priceMinor,priceDate:unadjusted?.date,bvpsMicros:bvps,asOf,
      currentCashYieldBps:unadjusted ? Math.round(distributions.data.dpsMicros/unadjusted.priceMinor) : undefined,
      sourceUrls:[dividendFinancialSourceUrl(stock.code),cashUrl,dividendResearchDistributionUrl(stock.code),monthly.source?.url ?? monthUrl,...(treasury?[treasury.sourceUrl]:[]),...(opportunity?[opportunity.sourceUrl]:[])] });
  }
  return evaluateDividendResearch({ code: stock.code, name: financial.data?.name || stock.name, pricing,
    technical: technical.data, financial: financial.data, distributions: distributions.data,
    yieldBps: unadjusted && distributions.data ? Math.round(distributions.data.dpsMicros / unadjusted.priceMinor) : undefined,
    checks: [], status: 'unknown', sources: [technical.source, financial.source, distributions.source, cash.source, monthly.source].filter((value): value is DividendResearchSource => !!value),
    issues: [technical.issue, financial.issue, distributions.issue, cash.issue, monthly.issue].filter((value): value is DividendResearchIssue => !!value),
  }, principles);
}

const INDICES: Pick<DividendIndexResearch, 'code' | 'name'>[] = [
  { code: 'sh000001', name: '上证指数' }, { code: 'sh000300', name: '沪深300' }, { code: 'sz399006', name: '创业板指' },
];

/** Each explicit request is bounded. Failed/deferred downloads remain unknown, never a synthetic pass. */
export async function fetchDividendResearch(
  stocks: Pick<DividendStock, 'code' | 'name'>[],
  principles: DividendSelectionPrinciples,
  options: { maxStocks?: number; timeBudgetMs?: number; pricingMethod?: DividendPricingMethod } = {},
): Promise<DividendResearchSnapshot> {
  if (!isDividendSelectionPrinciples(principles)) throw new Error('INVALID_DIVIDEND_PRINCIPLES');
  const pricingMethod = options.pricingMethod ?? defaultDividendPricingMethod();
  if (!isDividendPricingMethod(pricingMethod)) throw new Error('INVALID_DIVIDEND_PRICING_METHOD');
  const macroTask = fetchMacro(dateInChina()), opportunityTask = fetchOpportunity(dateInChina());
  if (!Array.isArray(stocks) || stocks.some(stock => !stock || mainlandCode(stock.code) !== stock.code)) throw new Error('INVALID_RESEARCH_CODES');
  const unique = [...new Map(stocks.map(stock => [stock.code, stock])).values()];
  const maximum = Math.max(1, Math.min(100, options.maxStocks ?? 40));
  const deadline = Date.now() + Math.max(1000, Math.min(60000, options.timeBudgetMs ?? 20000));
  const results = new Map<string, DividendStockResearch>();
  let cursor = 0;
  const stockTasks = Promise.all(Array.from({ length: Math.min(4, maximum, unique.length) }, async () => {
    while (cursor < Math.min(unique.length, maximum) && Date.now() < deadline) {
      const stock = unique[cursor++];
      try { results.set(stock.code, await fetchStock(stock, principles, pricingMethod, macroTask, opportunityTask)); }
      catch (error) {
        // A computation/shape failure is different from a request never started.
        results.set(stock.code, evaluateDividendResearch({ ...stock, checks:[], status:'unknown', sources:[],
          issues:[{ kind:'financial', reason:'invalid_data', detail:error instanceof Error ? error.message.slice(0,300) : 'RESEARCH_CALCULATION_FAILED' }] }, principles));
      }
    }
  }));
  const indexTasks = Promise.all(INDICES.map(async index => {
    const result = await download('technical', dividendTechnicalSourceUrl(index.code), raw => parseDividendTechnicalResearch(raw, index.code.slice(2), index.code));
    if (result.source) result.source.asOf = result.data!.asOf;
    return { ...index, technical: result.data, sources: result.source ? [result.source] : [], issues: result.issue ? [result.issue] : [] };
  }));
  const [, indices, macro, opportunity] = await Promise.all([stockTasks, indexTasks, macroTask, opportunityTask]);
  return { generatedAt: Date.now(), principles: { ...principles }, indices, pricingMethod, macro, opportunity,
    stocks: unique.map(stock => results.get(stock.code) ?? evaluateDividendResearch({ ...stock, checks: [], status: 'unknown', sources: [],
      issues: (['technical', 'financial', 'dividend'] as const).map(kind => ({ kind, reason: 'deferred' })) }, principles)) };
}
