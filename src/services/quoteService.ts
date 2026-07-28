import { Capacitor, CapacitorHttp } from '@capacitor/core';
import {
  resolveUsOptionContract,
  toUsOptionSymbol,
  type UsOptionContract,
  type UsOptionFields,
} from '../lib/usOption';
import { httpResponseDataToText } from '../lib/httpResponse';

// Free, key-less quote sources:
//  - Tencent (qt.gtimg.cn): A-share / HK / US equities, batched in one request. Response is
//    GBK-encoded `v_<code>="f0~f1~f2~price~..."` lines — names may garble but the
//    numeric fields are plain ASCII, which is all we need.
//  - Sina (hq.sinajs.cn): international index futures (`hf_*` codes, e.g. hf_NQ Nasdaq,
//    hf_ES S&P 500, hf_YM Dow). Response is `hq_str_<code>="price,change,..."` — comma
//    separated, price first. Requires a Referer header (added by the proxy / native call).
//  - Cboe delayed options (cdn.cboe.com): US equity-option chains keyed by underlying;
//    contracts use compact OSI symbols such as NOK280121C00007000.
//  - 天天基金 (fundgz.1234567.com.cn): OTC fund estimated NAV (gsz), fallback to last NAV (dwjz).
// None send CORS headers: on device we use Capacitor's native HTTP; in the dev
// browser we go through the vite proxies configured in vite.config.ts.
const isWeb = Capacitor.getPlatform() === 'web';
const TENCENT_BASE = isWeb ? '/qt-api/q=' : 'https://qt.gtimg.cn/q=';
const FUND_BASE = isWeb ? '/fund-api/js/' : 'https://fundgz.1234567.com.cn/js/';
const SINA_BASE = isWeb ? '/sina-api/list=' : 'https://hq.sinajs.cn/list=';
const CBOE_OPTION_BASE = isWeb ? '/cboe-option-api/' : 'https://cdn.cboe.com/api/global/delayed_quotes/options/';
const SINA_HEADERS = { Referer: 'https://finance.sina.com.cn' };

async function httpGetText(url: string, headers?: Record<string, string>): Promise<string> {
  if (isWeb) {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`quote api ${resp.status}`);
    return resp.text();
  }
  const resp = await CapacitorHttp.get({ url, responseType: 'text', headers });
  if (resp.status < 200 || resp.status >= 300) throw new Error(`quote api ${resp.status}`);
  return httpResponseDataToText(resp.data);
}

export interface QuoteTarget extends UsOptionFields { id: string; market?: string; }
export interface QuoteResult {
  prices: Record<string, number>;  // target id → latest price
  ok: number;                      // targets successfully quoted
  total: number;                   // targets that had a symbol to look up
}

const isUs = (market?: string) => !!market && /美|US/i.test(market);
const isHk = (market?: string) => !!market && /港|HK/i.test(market);

// Index futures the user may hold as "美股期货" / 股指期货. Keys are matched case-insensitively
// against the holding symbol; values are Sina `hf_*` codes. Users can also enter an explicit
// `hf_XX` or `qhXX` code for any Sina international future (incl. commodities like hf_GC / hf_CL).
const FUTURES_ALIASES: Record<string, string> = {
  // US index futures — the "美股期货" this targets
  NQ: 'hf_NQ', 纳斯达克: 'hf_NQ', 纳指: 'hf_NQ', 纳指期货: 'hf_NQ', 纳斯达克期货: 'hf_NQ', 小纳指: 'hf_NQ',
  ES: 'hf_ES', 标普: 'hf_ES', 标普500: 'hf_ES', 标普期货: 'hf_ES', 标普500期货: 'hf_ES', 小标普: 'hf_ES',
  YM: 'hf_YM', 道琼斯: 'hf_YM', 道指: 'hf_YM', 道指期货: 'hf_YM', 道琼斯期货: 'hf_YM', 小道指: 'hf_YM',
  // Other index futures — bonus, same mechanism
  NK: 'hf_NK', 日经: 'hf_NK', 日经225: 'hf_NK', 日经期货: 'hf_NK',
  HSI: 'hf_HSI', 恒指: 'hf_HSI', 恒生: 'hf_HSI', 恒生指数: 'hf_HSI', 恒指期货: 'hf_HSI',
  A50: 'hf_CHA50CFD', 富时A50: 'hf_CHA50CFD', 中国A50: 'hf_CHA50CFD', A50期货: 'hf_CHA50CFD',
};

/** The Sina international-futures code (`hf_*`) for a symbol, or null if it isn't a futures. */
function futuresCode(symbol: string): string | null {
  const s = symbol.trim();
  if (!s) return null;
  // Explicit Sina/Tencent-style codes carry unambiguous futures intent
  if (/^hf_[A-Za-z0-9]+$/i.test(s)) return 'hf_' + s.slice(3).toUpperCase();
  if (/^qh[A-Za-z0-9]+$/i.test(s)) return 'hf_' + s.slice(2).toUpperCase();
  return FUTURES_ALIASES[s.toUpperCase()] ?? null;
}

/** Candidate Tencent codes for one holding, best guess first. */
function tencentCodes(symbol: string, market?: string): string[] {
  const s = symbol.trim();
  if (!s) return [];
  // Already prefixed (sh510300 / sz159915 / hk00700 / usAAPL)
  if (/^(sh|sz|bj)\d{6}$/i.test(s) || /^hk\d{5}$/i.test(s)) return [s.toLowerCase()];
  if (/^us[A-Za-z.]+$/.test(s)) return ['us' + s.slice(2).toUpperCase()];
  // Pure letters → US ticker
  if (isUs(market) || /^[A-Za-z][A-Za-z.]{0,9}$/.test(s)) return ['us' + s.toUpperCase()];
  // 4-5 digits → HK
  if (isHk(market) || /^\d{4,5}$/.test(s)) return ['hk' + s.padStart(5, '0')];
  if (/^\d{6}$/.test(s)) {
    const first = s[0];
    if ('569'.includes(first)) return ['sh' + s];
    if ('0123'.includes(first)) return ['sz' + s];
    if ('48'.includes(first)) return ['bj' + s];
    return ['sh' + s, 'sz' + s];
  }
  return [];
}

/** Equity quotes (A-share / HK / US) via Tencent, one batched request → id → price. */
async function fetchTencentEquities(targets: QuoteTarget[]): Promise<Record<string, number>> {
  const codeMap = targets
    .map(t => ({ id: t.id, codes: tencentCodes(t.symbol!, t.market) }))
    .filter(x => x.codes.length > 0);
  if (codeMap.length === 0) return {};

  const allCodes = [...new Set(codeMap.flatMap(x => x.codes))];
  const text = await httpGetText(TENCENT_BASE + allCodes.join(','));

  const priceByCode: Record<string, number> = {};
  const re = /v_(\w+)="([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const price = parseFloat(m[2].split('~')[3]);
    if (isFinite(price) && price > 0) priceByCode[m[1].toLowerCase()] = price;
  }

  const prices: Record<string, number> = {};
  for (const { id, codes } of codeMap) {
    for (const code of codes) {
      const p = priceByCode[code.toLowerCase()];
      if (p) { prices[id] = p; break; }
    }
  }
  return prices;
}

/** International index/commodity futures (`hf_*`) via Sina, one batched request → id → price. */
async function fetchSinaFutures(targets: { id: string; code: string }[]): Promise<Record<string, number>> {
  if (targets.length === 0) return {};
  const codes = [...new Set(targets.map(t => t.code))];
  const text = await httpGetText(SINA_BASE + codes.join(','), SINA_HEADERS);

  const priceByCode: Record<string, number> = {};
  const re = /hq_str_(\w+)="([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const price = parseFloat(m[2].split(',')[0]);
    if (isFinite(price) && price > 0) priceByCode[m[1].toUpperCase()] = price;
  }

  const prices: Record<string, number> = {};
  for (const { id, code } of targets) {
    const p = priceByCode[code.toUpperCase()];
    if (p) prices[id] = p;
  }
  return prices;
}

interface CboeOptionQuote {
  option?: string;
  last_trade_price?: number;
  bid?: number;
  ask?: number;
  theo?: number;
}

interface CboeOptionResponse {
  data?: { options?: CboeOptionQuote[] };
}

function optionQuotePrice(quote: CboeOptionQuote): number | null {
  if (Number.isFinite(quote.last_trade_price) && (quote.last_trade_price ?? 0) > 0) {
    return quote.last_trade_price!;
  }
  if (Number.isFinite(quote.bid) && Number.isFinite(quote.ask) && (quote.ask ?? 0) > 0) {
    return Math.round((((quote.bid ?? 0) + (quote.ask ?? 0)) / 2) * 10_000) / 10_000;
  }
  return Number.isFinite(quote.theo) && (quote.theo ?? 0) > 0 ? quote.theo! : null;
}

/** Cboe delayed US option chains, de-duplicated so each underlying is fetched once. */
async function fetchCboeOptions(targets: { id: string; contract: UsOptionContract }[]): Promise<Record<string, number>> {
  if (targets.length === 0) return {};
  const byUnderlying = new Map<string, { id: string; contract: UsOptionContract }[]>();
  for (const target of targets) {
    const list = byUnderlying.get(target.contract.underlying) ?? [];
    list.push(target);
    byUnderlying.set(target.contract.underlying, list);
  }

  const jobs = [...byUnderlying.entries()].map(async ([underlying, groupedTargets]) => {
    const text = await httpGetText(`${CBOE_OPTION_BASE}${encodeURIComponent(underlying)}.json`);
    const payload = JSON.parse(text) as CboeOptionResponse;
    const quotes = new Map((payload.data?.options ?? [])
      .filter((quote): quote is CboeOptionQuote & { option: string } => typeof quote.option === 'string')
      .map(quote => [quote.option.toUpperCase(), quote]));
    const prices: Record<string, number> = {};
    for (const target of groupedTargets) {
      const quote = quotes.get(toUsOptionSymbol(target.contract));
      const price = quote ? optionQuotePrice(quote) : null;
      if (price != null && price > 0) prices[target.id] = price;
    }
    return prices;
  });

  const settled = await Promise.allSettled(jobs);
  const prices: Record<string, number> = {};
  let anyFulfilled = false;
  for (const result of settled) {
    if (result.status === 'fulfilled') {
      Object.assign(prices, result.value);
      anyFulfilled = true;
    }
  }
  if (!anyFulfilled) throw (settled[0] as PromiseRejectedResult).reason;
  return prices;
}

/** Exchange-traded quotes: equities via Tencent, index futures via Sina, merged. */
export async function fetchEquityQuotes(targets: QuoteTarget[]): Promise<QuoteResult> {
  const withSymbol = targets.filter(t => (t.symbol || '').trim() || resolveUsOptionContract(t));
  const equities: QuoteTarget[] = [];
  const futures: { id: string; code: string }[] = [];
  const options: { id: string; contract: UsOptionContract }[] = [];
  for (const t of withSymbol) {
    const optionContract = resolveUsOptionContract(t);
    if (optionContract) {
      options.push({ id: t.id, contract: optionContract });
      continue;
    }
    if (!(t.symbol || '').trim()) continue;
    const code = futuresCode(t.symbol!);
    if (code) futures.push({ id: t.id, code });
    else equities.push(t);
  }

  // Only hit sources that have targets; if every source we hit fails, surface the error.
  const jobs: Promise<Record<string, number>>[] = [];
  if (equities.length) jobs.push(fetchTencentEquities(equities));
  if (futures.length) jobs.push(fetchSinaFutures(futures));
  if (options.length) jobs.push(fetchCboeOptions(options));
  if (jobs.length === 0) return { prices: {}, ok: 0, total: withSymbol.length };

  const settled = await Promise.allSettled(jobs);
  const prices: Record<string, number> = {};
  let anyFulfilled = false;
  for (const r of settled) {
    if (r.status === 'fulfilled') { Object.assign(prices, r.value); anyFulfilled = true; }
  }
  if (!anyFulfilled) throw (settled[0] as PromiseRejectedResult).reason;
  return { prices, ok: Object.keys(prices).length, total: withSymbol.length };
}

/** OTC fund quotes via 天天基金: intraday estimated NAV, falling back to the latest published NAV. */
export async function fetchFundQuotes(targets: QuoteTarget[]): Promise<QuoteResult> {
  const withSymbol = targets.filter(t => (t.symbol || '').trim());
  const valid = withSymbol.filter(t => /^\d{6}$/.test(t.symbol!.trim()));
  const prices: Record<string, number> = {};
  await Promise.all(valid.map(async t => {
    try {
      const text = await httpGetText(FUND_BASE + t.symbol!.trim() + '.js');
      const gsz = text.match(/"gsz"\s*:\s*"([\d.]+)"/);
      const dwjz = text.match(/"dwjz"\s*:\s*"([\d.]+)"/);
      const p = parseFloat(gsz?.[1] ?? dwjz?.[1] ?? '');
      if (isFinite(p) && p > 0) prices[t.id] = p;
    } catch { /* this fund failed; others may still succeed */ }
  }));
  return { prices, ok: Object.keys(prices).length, total: withSymbol.length };
}

export async function fetchQuotes(targets: QuoteTarget[], fundAccount: boolean): Promise<QuoteResult> {
  return fundAccount ? fetchFundQuotes(targets) : fetchEquityQuotes(targets);
}
