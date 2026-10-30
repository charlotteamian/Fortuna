/** A quote can establish an observed price event without proving an executable trading session. */
export interface DividendCheckQuote {
  date: string;
  priceMinor?: number;
  priceMicros?: number;
  fetchedAt?: number;
}
export interface DividendQuoteUsability {
  status: 'current' | 'last_available' | 'unknown';
  reasons: string[];
  date?: string;
  priceMinor?: number;
  priceMicros?: number;
  fetchedAt?: number;
  historicalUsable: boolean;
  sessionConfirmed: boolean;
}

export function dividendQuoteUsability(input: {
  quote?: DividendCheckQuote; comparisonQuote?: DividendCheckQuote; failedAt?: number;
  latestExDate?: string; asOf: string; now: number; quoteSession?: 'confirmed' | 'unknown';
}): DividendQuoteUsability {
  const { quote, asOf, now } = input;
  const reasons: string[] = [];
  if (!quote) return { status: 'unknown', reasons: ['quote_missing'], historicalUsable: false, sessionConfirmed: false };
  if (typeof quote.date !== 'string') return { status: 'unknown', reasons: ['quote_invalid'], historicalUsable: false, sessionConfirmed: false };
  const full = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2})?$/.test(quote.date);
  const dayOnly = /^\d{4}-\d{2}-\d{2}$/.test(quote.date);
  const date = quote.date.slice(0, 10);
  const dayTime = Date.parse(`${date}T00:00:00Z`);
  const validDate = (full || dayOnly) && Number.isFinite(dayTime) && new Date(dayTime).toISOString().slice(0, 10) === date;
  const sourceTime = full ? Date.parse(`${quote.date.replace(' ', 'T')}${quote.date.length === 16 ? ':00' : ''}+08:00`) : NaN;
  const validTime = !full || Number.isFinite(sourceTime) && new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(sourceTime).replace(',', '') === quote.date.slice(0, 16);
  const price = quote.priceMicros ?? quote.priceMinor;
  const validPrice = Number.isSafeInteger(price) && price! > 0;
  if (!validDate || !validTime || !validPrice) reasons.push('quote_invalid');
  if (date > asOf || full && Number.isFinite(sourceTime) && sourceTime > now) reasons.push('quote_future');
  if (input.failedAt !== undefined) reasons.push('quote_refresh_failed');
  if (input.latestExDate && date < input.latestExDate) reasons.push('quote_before_ex');
  const comparison = input.comparisonQuote;
  const micros = (value: DividendCheckQuote) => value.priceMicros ?? (value.priceMinor === undefined ? undefined : value.priceMinor * 10000);
  if (comparison && comparison.date === quote.date && micros(comparison) !== undefined && micros(comparison) !== micros(quote)) reasons.push('quote_source_conflict');
  const age = (Date.parse(asOf) - dayTime) / 86400000;
  if (validDate && age > 10) reasons.push('quote_stale');
  if (validDate && date < asOf) reasons.push('quote_prior_date');
  if (dayOnly) reasons.push('quote_time_missing');
  const invalid = reasons.some(reason => ['quote_invalid', 'quote_future', 'quote_before_ex', 'quote_source_conflict', 'quote_stale'].includes(reason));
  const historicalUsable = !invalid && age >= 0 && age <= 10;
  const current = historicalUsable && full && date === asOf && input.failedAt === undefined;
  return { status: current ? 'current' : historicalUsable ? 'last_available' : 'unknown', reasons, date: quote.date,
    priceMinor: quote.priceMinor, priceMicros: quote.priceMicros, fetchedAt: quote.fetchedAt,
    historicalUsable, sessionConfirmed: current && input.quoteSession === 'confirmed' };
}
