import { Capacitor, CapacitorHttp } from '@capacitor/core';

// Free, key-less quote sources:
//  - Tencent (qt.gtimg.cn): A-share / HK / US, batched in one request. Response is
//    GBK-encoded `v_<code>="f0~f1~f2~price~..."` lines — names may garble but the
//    numeric fields are plain ASCII, which is all we need.
//  - 天天基金 (fundgz.1234567.com.cn): OTC fund estimated NAV (gsz), fallback to last NAV (dwjz).
// Neither sends CORS headers: on device we use Capacitor's native HTTP; in the dev
// browser we go through the vite proxies configured in vite.config.ts.
const isWeb = Capacitor.getPlatform() === 'web';
const TENCENT_BASE = isWeb ? '/qt-api/q=' : 'https://qt.gtimg.cn/q=';
const FUND_BASE = isWeb ? '/fund-api/js/' : 'https://fundgz.1234567.com.cn/js/';

async function httpGetText(url: string): Promise<string> {
  if (isWeb) {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`quote api ${resp.status}`);
    return resp.text();
  }
  const resp = await CapacitorHttp.get({ url, responseType: 'text' });
  if (resp.status < 200 || resp.status >= 300) throw new Error(`quote api ${resp.status}`);
  return typeof resp.data === 'string' ? resp.data : String(resp.data);
}

export interface QuoteTarget { id: string; symbol?: string; market?: string; }
export interface QuoteResult {
  prices: Record<string, number>;  // target id → latest price
  ok: number;                      // targets successfully quoted
  total: number;                   // targets that had a symbol to look up
}

const isUs = (market?: string) => !!market && /美|US/i.test(market);
const isHk = (market?: string) => !!market && /港|HK/i.test(market);

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

/** Exchange-traded quotes (A-share / HK / US) via Tencent, one batched request. */
export async function fetchEquityQuotes(targets: QuoteTarget[]): Promise<QuoteResult> {
  const withSymbol = targets.filter(t => (t.symbol || '').trim());
  const codeMap = withSymbol
    .map(t => ({ id: t.id, codes: tencentCodes(t.symbol!, t.market) }))
    .filter(x => x.codes.length > 0);
  if (codeMap.length === 0) return { prices: {}, ok: 0, total: withSymbol.length };

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
