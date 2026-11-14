export interface DividendMarketQuote {
  priceMicros: number; // CNY per share/unit × 1,000,000; retain ETF price precision
  date: string; // quote source time in Asia/Shanghai, not the download time
  changePercent?: number;
  fetchedAt: number;
}

export function mainlandQuoteSymbol(code: string): string {
  if (!/^\d{6}$/.test(code)) throw new Error('QUOTE_SYMBOL_INVALID');
  return `${/^[56]/.test(code) ? 'sh' : /^[489]/.test(code) ? 'bj' : 'sz'}${code}`;
}

/** ETF, listed LOF and REIT code ranges; an unlisted share class will fail quote validation. */
export function isExchangeTradedFundCode(code: string | undefined): boolean {
  return typeof code === 'string' && /^(?:1[568]|5\d)\d{4}$/.test(code);
}

/**
 * A quote stamp is the mainland session's Asia/Shanghai wall-clock time
 * (YYYY-MM-DD HH:MM). Validate it with a round-trip through the +08:00 offset,
 * not UTC: parsing it as UTC would reject real morning-session stamps in the
 * 00:00–07:59 Shanghai window and mislabel a valid quote as invalid.
 */
function validQuoteDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(date)) return false;
  const parsed = Date.parse(`${date.replace(' ', 'T')}:00+08:00`);
  if (!Number.isFinite(parsed)) return false;
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(parsed).replace(',', '') === date;
}

export function isDividendMarketQuote(value: unknown): value is DividendMarketQuote {
  if (!value || typeof value !== 'object') return false;
  const quote = value as DividendMarketQuote;
  return Number.isSafeInteger(quote.priceMicros) && quote.priceMicros > 0 && quote.priceMicros <= 1e12
    && typeof quote.date === 'string' && validQuoteDate(quote.date)
    && Number.isSafeInteger(quote.fetchedAt) && quote.fetchedAt >= 0
    && (quote.changePercent === undefined || Number.isFinite(quote.changePercent));
}

export function parseDividendMarketQuote(text: string, code: string, now = Date.now()): DividendMarketQuote {
  const match = text.match(new RegExp(`v_${mainlandQuoteSymbol(code)}="([^"]*)"`));
  const fields = match?.[1].split('~');
  const stamp = fields?.[30] ?? '';
  const price = Number(fields?.[3]);
  if (!fields || fields[2] !== code || !Number.isFinite(price) || price <= 0 || !/^\d{14}$/.test(stamp)
    || Number(stamp.slice(12)) > 59) throw new Error('QUOTE_SOURCE_INVALID');
  const quote = {
    priceMicros: Math.round(price * 1e6),
    date: `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)} ${stamp.slice(8, 10)}:${stamp.slice(10, 12)}`,
    changePercent: fields[32]?.trim() && Number.isFinite(Number(fields[32])) ? Number(fields[32]) : undefined,
    fetchedAt: now,
  };
  if (!isDividendMarketQuote(quote)) throw new Error('QUOTE_SOURCE_INVALID');
  return quote;
}
