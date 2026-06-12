import { db, type GoldPriceSource } from '../db';
import { TROY_OZ_TO_GRAM } from '../db';

const API_BASE = 'https://api.frankfurter.dev/v2';
// gold-api.com: free, no key, CORS-enabled. /price/XAU|XAG|XPT|XPD → { price: USD per troy ounce }
const METAL_API_BASE = 'https://api.gold-api.com/price';
const CACHE_DURATION_MS = 24 * 60 * 60 * 1000;
const METAL_CACHE_DURATION_MS = 60 * 60 * 1000; // metals move intraday → refresh hourly

export async function fetchLatestRates(base: string): Promise<Record<string, number>> {
  try {
    const resp = await fetch(`${API_BASE}/rates?base=${base}`);
    if (!resp.ok) throw new Error(`API error: ${resp.status}`);
    const data = await resp.json();
    const rates: Record<string, number> = {};
    const now = Date.now();
    const date = data.date || new Date().toISOString().split('T')[0];
    if (Array.isArray(data.rates)) {
      for (const r of data.rates) {
        rates[r.quote] = r.rate;
        await db.exchangeRates.put({ id: `${base}_${r.quote}`, base, quote: r.quote, rate: r.rate, date, updatedAt: now });
      }
    } else if (data.rates && typeof data.rates === 'object') {
      for (const [quote, rate] of Object.entries(data.rates)) {
        rates[quote] = rate as number;
        await db.exchangeRates.put({ id: `${base}_${quote}`, base, quote, rate: rate as number, date, updatedAt: now });
      }
    }
    return rates;
  } catch (err) { console.error('Failed to fetch exchange rates:', err); throw err; }
}

export async function getRate(from: string, to: string): Promise<number> {
  if (from === to) return 1;
  const cached = await db.exchangeRates.get(`${from}_${to}`);
  if (cached && (Date.now() - cached.updatedAt) < CACHE_DURATION_MS) return cached.rate;
  const cachedReverse = await db.exchangeRates.get(`${to}_${from}`);
  if (cachedReverse && (Date.now() - cachedReverse.updatedAt) < CACHE_DURATION_MS) return 1 / cachedReverse.rate;
  try {
    const resp = await fetch(`${API_BASE}/rate/${from}/${to}`);
    if (!resp.ok) throw new Error(`API error: ${resp.status}`);
    const data = await resp.json();
    await db.exchangeRates.put({ id: `${from}_${to}`, base: from, quote: to, rate: data.rate, date: data.date || new Date().toISOString().split('T')[0], updatedAt: Date.now() });
    return data.rate;
  } catch {
    if (cached) return cached.rate;
    if (cachedReverse) return 1 / cachedReverse.rate;
    return 1;
  }
}

export async function convertAmount(amount: number, from: string, to: string): Promise<number> {
  const rate = await getRate(from, to);
  return amount * rate;
}

/** Spot price in USD per troy ounce from gold-api.com. */
async function fetchSpotUsdPerOz(metalType: string): Promise<number> {
  const resp = await fetch(`${METAL_API_BASE}/${metalType}`);
  if (!resp.ok) throw new Error(`gold-api error: ${resp.status}`);
  const data = await resp.json();
  const price = Number(data?.price);
  if (!isFinite(price) || price <= 0) throw new Error('gold-api returned no price');
  return price;
}

/**
 * Get precious metal price per gram in the given currency.
 * metalType: XAU, XAG, XPT, XPD
 * source: 'international' values per global spot (USD/oz); 'domestic' uses the Shanghai-gold
 *   convention (priced in CNY/gram) which tracks local buying prices for CNY users.
 */
export async function getMetalPricePerGram(
  metalType: string,
  currency: string,
  source: GoldPriceSource = 'international',
  forceRefresh = false,
): Promise<number> {
  const cacheId = `metal_${source}_${metalType}_${currency}`;
  try {
    if (!forceRefresh) {
      const cached = await db.exchangeRates.get(cacheId);
      if (cached && (Date.now() - cached.updatedAt) < METAL_CACHE_DURATION_MS) return cached.rate;
    }
    const usdPerGram = (await fetchSpotUsdPerOz(metalType)) / TROY_OZ_TO_GRAM;
    let pricePerGram: number;
    if (source === 'domestic') {
      // Express in CNY/gram first (the 上海金 convention), then convert to the account currency
      const cnyPerGram = usdPerGram * await getRate('USD', 'CNY');
      pricePerGram = currency === 'CNY' ? cnyPerGram : cnyPerGram * await getRate('CNY', currency);
    } else {
      pricePerGram = currency === 'USD' ? usdPerGram : usdPerGram * await getRate('USD', currency);
    }
    await db.exchangeRates.put({ id: cacheId, base: metalType, quote: currency, rate: pricePerGram, date: new Date().toISOString().split('T')[0], updatedAt: Date.now() });
    return pricePerGram;
  } catch (err) {
    console.error(`Failed to get metal price ${metalType}/${currency} (${source}):`, err);
    const cached = await db.exchangeRates.get(cacheId);
    return cached?.rate ?? 0;
  }
}

/**
 * Compute the currency value of a precious metal holding.
 * grams × pricePerGram
 */
export async function computeMetalValue(grams: number, metalType: string, currency: string, source: GoldPriceSource = 'international'): Promise<number> {
  const ppg = await getMetalPricePerGram(metalType, currency, source);
  return grams * ppg;
}

export async function refreshAllRates(base: string, source: GoldPriceSource = 'international'): Promise<void> {
  await fetchLatestRates(base);
  // Also explicitly refresh common metals to ensure they are updated
  const metals = ['XAU', 'XAG', 'XPT', 'XPD'];
  for (const m of metals) {
    try {
      await getMetalPricePerGram(m, base, source, true);
    } catch (e) {
      console.warn(`Failed to refresh metal ${m}:`, e);
    }
  }
}

export async function getLastUpdateTime(): Promise<number | null> {
  const rates = await db.exchangeRates.toArray();
  if (rates.length === 0) return null;
  return Math.max(...rates.map(r => r.updatedAt));
}
