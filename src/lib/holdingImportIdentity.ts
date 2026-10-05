export type HoldingImportMarket = 'A股' | '美股' | '港股';

export interface HoldingImportIdentity {
  symbol: string;
  market: HoldingImportMarket;
  key: string;
}

export function canonicalImportMarket(value?: string): HoldingImportMarket | undefined {
  if (!value?.trim()) return undefined;
  const label = value.trim().replace(/\s+/g, '').toUpperCase();
  if (['A', 'A股', 'ASHARE', 'A-SHARE', 'A-SHARES', 'CN', '中国', '沪深', '沪深京', '沪深A股', '沪A', '深A', 'SSE', 'SZSE', 'BSE', 'SH', 'SZ', 'BJ', '上海', '深圳', '北京', '上交所', '深交所', '北交所', 'CNY'].includes(label)) return 'A股';
  if (['US', 'USA', '美股', '美国', 'USSTOCK', 'USSTOCKS', 'USD', 'NASDAQ', 'NYSE', 'AMEX'].includes(label)) return '美股';
  if (['HK', 'HKG', '港股', '香港', 'HKSTOCK', 'HKSTOCKS', 'HKEX', 'SEHK', 'HKD', '港交所', '港币'].includes(label)) return '港股';
  throw new Error('HOLDING_POSITION_MARKET_INVALID');
}

/** Matching uses a security code and market together; names are never a merge key. */
export function normalizeHoldingIdentity(symbol: string, market?: string, fallbackCurrency?: string): HoldingImportIdentity {
  const prefixedUs = /^us([A-Za-z][A-Za-z0-9.-]*)$/.exec(symbol.trim());
  const raw = (prefixedUs ? `US:${prefixedUs[1]}` : symbol.trim()).toUpperCase();
  if (!raw) throw new Error('HOLDING_POSITION_SYMBOL_INVALID');
  const mainland = /^(?:(?:SH|SZ|BJ)[.:]?)?(\d{1,6})(?:\.(?:SH|SZ|BJ|SS))?$/.exec(raw);
  const hk = /^(?:HK[.:]?)?(\d{1,5})(?:\.HK)?$/.exec(raw);
  const us = /^(?:US[.:])?([A-Z][A-Z0-9]*(?:[.-][A-Z0-9]+)?)$/.exec(raw.replace(/\.US$/, ''));
  const explicitMarket = canonicalImportMarket(market);
  const symbolMarket = /^(?:SH|SZ|BJ)[.:]?\d{1,6}$|^\d{1,6}\.(?:SH|SZ|BJ|SS)$/.test(raw)
    ? 'A股'
    : /^HK[.:]?\d{1,5}$|^\d{1,5}\.HK$/.test(raw) ? '港股'
    : /^US[.:]/.test(raw) || /\.US$/.test(raw) ? '美股' : undefined;
  if (explicitMarket && symbolMarket && explicitMarket !== symbolMarket) throw new Error('HOLDING_POSITION_MARKET_INVALID');
  const resolvedMarket = explicitMarket ?? symbolMarket
    ?? (mainland?.[1].length === 6 ? 'A股' : hk ? (fallbackCurrency === 'CNY' ? 'A股' : '港股') : us ? '美股' : undefined)
    ?? (fallbackCurrency === 'USD' ? '美股' : fallbackCurrency === 'HKD' ? '港股' : fallbackCurrency === 'CNY' ? 'A股' : undefined);
  const code = resolvedMarket === 'A股' ? mainland?.[1]?.padStart(6, '0')
    : resolvedMarket === '港股' ? hk?.[1]?.padStart(5, '0')
    : resolvedMarket === '美股' ? us?.[1] : undefined;
  if (!resolvedMarket || !code) throw new Error('HOLDING_POSITION_SYMBOL_INVALID');
  return { symbol: code, market: resolvedMarket, key: `${resolvedMarket}:${code}` };
}
