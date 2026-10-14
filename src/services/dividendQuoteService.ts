import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { db, initializeSettings } from '../db';
import { httpResponseDataToText } from '../lib/httpResponse';
import { isExchangeTradedFundCode, mainlandQuoteSymbol, parseDividendMarketQuote, type DividendMarketQuote } from '../lib/dividendQuote';
import { requestPortableSnapshot } from './portableSnapshotEvents';

/** One request per batch; malformed/missing symbols fail independently. */
export async function fetchDividendMarketQuotes(codes: string[]) {
  const unique = [...new Set(codes)];
  const quotes = new Map<string, DividendMarketQuote>();
  const batches = Array.from({ length: Math.ceil(unique.length / 100) }, (_, index) => unique.slice(index * 100, (index + 1) * 100));
  await Promise.all(batches.map(async batch => {
    try {
      const path = `/q=${batch.map(mainlandQuoteSymbol).join(',')}`;
      let text: string;
      if (Capacitor.isNativePlatform()) {
        const response = await CapacitorHttp.get({ url: `https://qt.gtimg.cn${path}`, responseType: 'text', connectTimeout: 10000, readTimeout: 10000 });
        if (response.status < 200 || response.status >= 300) throw new Error(`HTTP_${response.status}`);
        text = httpResponseDataToText(response.data);
      } else {
        const response = await fetch(`/qt-api${path}`, { signal: AbortSignal.timeout(12000), cache: 'no-store' });
        if (!response.ok) throw new Error(`HTTP_${response.status}`);
        text = await response.text();
      }
      const fetchedAt = Date.now();
      for (const code of batch) {
        try { quotes.set(code, parseDividendMarketQuote(text, code, fetchedAt)); }
        catch { /* A missing symbol must not discard the other quotes. */ }
      }
    } catch { /* Keep the dated cache and mark every missing quote below. */ }
  }));
  return { quotes, failed: unique.filter(code => !quotes.has(code)) };
}

/** Quote writes merge into the current plan so edits/deletions during a request survive. */
export async function refreshDividendMarketQuotes() {
  await initializeSettings();
  const [stocks, settings] = await Promise.all([db.dividendStocks.toArray(), db.settings.get('main')]);
  const funds = settings?.dividendFundPlan?.funds.filter(fund => isExchangeTradedFundCode(fund.code)) ?? [];
  const codes = [...new Set([...stocks.map(stock => stock.code), ...funds.map(fund => fund.code!)])];
  const { quotes, failed } = await fetchDividendMarketQuotes(codes);
  const failedAt = Date.now();
  await db.transaction('rw', db.dividendStocks, db.settings, async () => {
    for (const stock of stocks) {
      const quote = quotes.get(stock.code);
      await db.dividendStocks.update(stock.code, quote
        ? { quote: { priceMinor: Math.round(quote.priceMicros / 10000), date: quote.date, changePercent: quote.changePercent, fetchedAt: quote.fetchedAt }, quoteFailedAt: undefined }
        : { quoteFailedAt: failedAt });
    }
    const current = await db.settings.get('main');
    if (current?.dividendFundPlan) {
      const requested = new Map(funds.map(fund => [fund.id, fund.code]));
      await db.settings.update('main', { dividendFundPlan: { ...current.dividendFundPlan,
        funds: current.dividendFundPlan.funds.map(fund => {
          if (!requested.has(fund.id) || requested.get(fund.id) !== fund.code) return fund;
          const quote = quotes.get(fund.code!);
          return quote ? { ...fund, quote, quoteFailedAt: undefined } : { ...fund, quoteFailedAt: failedAt };
        }),
      } });
    }
  });
  if (codes.length) requestPortableSnapshot('dividend-quotes');
  return { done: codes.length, failed: failed.length, fetchedAt: failedAt };
}
