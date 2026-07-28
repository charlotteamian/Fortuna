import { db, type GoldPriceSource } from '../db';
import { TROY_OZ_TO_GRAM } from '../db';
import { formatLocalDate } from '../lib/localDate';

const API_BASE = 'https://api.frankfurter.dev/v2';
// gold-api.com: free, no key, CORS-enabled. /price/XAU|XAG|XPT|XPD → { price: USD per troy ounce }
const METAL_API_BASE = 'https://api.gold-api.com/price';
const CACHE_DURATION_MS = 24 * 60 * 60 * 1000;
const METAL_CACHE_DURATION_MS = 60 * 60 * 1000; // metals move intraday → refresh hourly
const REQUEST_TIMEOUT_MS = 5000;
export const RATES_REFRESHED_EVENT = 'fortuna-rates-refreshed';

const rateRequests = new Map<string, Promise<number>>();
const metalRequests = new Map<string, Promise<number>>();
let backgroundRefresh: Promise<boolean> | null = null;

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function notifyRatesRefreshed(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(RATES_REFRESHED_EVENT));
}

export interface ParsedRateRow {
  quote: string;
  rate: number;
  date: string;
}

export function selectFreshestCachedRate(
  direct: { rate: number; updatedAt: number } | undefined,
  reverse: { rate: number; updatedAt: number } | undefined,
): number | undefined {
  const candidates = [
    direct?.rate && direct.rate > 0 ? { rate: direct.rate, updatedAt: direct.updatedAt } : null,
    reverse?.rate && reverse.rate > 0 ? { rate: 1 / reverse.rate, updatedAt: reverse.updatedAt } : null,
  ].filter((candidate): candidate is { rate: number; updatedAt: number } => Boolean(candidate));
  candidates.sort((a, b) => b.updatedAt - a.updatedAt);
  return candidates[0]?.rate;
}

/** Read-only lookup used by initial rendering. Missing cache stays explicit and never starts a network request. */
export async function getCachedRate(from: string, to: string): Promise<number | undefined> {
  if (from === to) return 1;
  const [direct, reverse] = await Promise.all([
    db.exchangeRates.get(`${from}_${to}`),
    db.exchangeRates.get(`${to}_${from}`),
  ]);
  return selectFreshestCachedRate(direct, reverse);
}

export async function convertAmountFromCache(amount: number, from: string, to: string): Promise<number | undefined> {
  const rate = await getCachedRate(from, to);
  return rate === undefined ? undefined : amount * rate;
}

/** Accept the current Frankfurter v2 row array and the former object-shaped response. */
export function parseLatestRateRows(data: unknown, fallbackDate = formatLocalDate()): ParsedRateRow[] {
  if (Array.isArray(data)) {
    return data.flatMap(value => {
      if (!value || typeof value !== 'object') return [];
      const row = value as Record<string, unknown>;
      const quote = typeof row.quote === 'string' ? row.quote : '';
      const rate = Number(row.rate);
      if (!quote || !Number.isFinite(rate) || rate <= 0) return [];
      return [{ quote, rate, date: typeof row.date === 'string' && row.date ? row.date : fallbackDate }];
    });
  }

  if (!data || typeof data !== 'object') return [];
  const response = data as Record<string, unknown>;
  const date = typeof response.date === 'string' && response.date ? response.date : fallbackDate;
  if (Array.isArray(response.rates)) return parseLatestRateRows(response.rates, date);
  if (!response.rates || typeof response.rates !== 'object') return [];
  return Object.entries(response.rates as Record<string, unknown>).flatMap(([quote, value]) => {
    const rate = Number(value);
    return quote && Number.isFinite(rate) && rate > 0 ? [{ quote, rate, date }] : [];
  });
}

export async function fetchLatestRates(base: string): Promise<Record<string, number>> {
  try {
    const resp = await fetchWithTimeout(`${API_BASE}/rates?base=${base}`);
    if (!resp.ok) throw new Error(`API error: ${resp.status}`);
    const data: unknown = await resp.json();
    const rates: Record<string, number> = {};
    const now = Date.now();
    const validRows = parseLatestRateRows(data);
    if (validRows.length === 0) throw new Error(`No valid exchange rates returned for ${base}`);
    for (const row of validRows) rates[row.quote] = row.rate;
    await db.exchangeRates.bulkPut(validRows.map(row => ({
      id: `${base}_${row.quote}`,
      base,
      quote: row.quote,
      rate: row.rate,
      date: row.date,
      updatedAt: now,
    })));
    return rates;
  } catch (err) { console.error('Failed to fetch exchange rates:', err); throw err; }
}

export async function getRate(from: string, to: string): Promise<number> {
  if (from === to) return 1;
  // Valuation is stale-while-revalidate: never block first paint when a valid prior rate exists.
  // A base-currency refresh writes the reverse pair, so prefer whichever cache direction
  // was updated most recently instead of letting an older direct pair win forever.
  const cachedRate = await getCachedRate(from, to);
  if (cachedRate !== undefined) return cachedRate;

  const requestKey = `${from}_${to}`;
  const existing = rateRequests.get(requestKey);
  if (existing) return existing;
  const request = (async () => {
    const resp = await fetchWithTimeout(`${API_BASE}/rate/${from}/${to}`);
    if (!resp.ok) throw new Error(`API error: ${resp.status}`);
    const data = await resp.json();
    const rate = Number(data.rate);
    if (!Number.isFinite(rate) || rate <= 0) throw new Error(`No valid rate for ${from}/${to}`);
    await db.exchangeRates.put({ id: requestKey, base: from, quote: to, rate, date: data.date || formatLocalDate(), updatedAt: Date.now() });
    return rate;
  })();
  rateRequests.set(requestKey, request);
  try {
    return await request;
  } finally {
    rateRequests.delete(requestKey);
  }
}

export async function convertAmount(amount: number, from: string, to: string): Promise<number> {
  const rate = await getRate(from, to);
  return amount * rate;
}

/** Spot price in USD per troy ounce from gold-api.com. */
async function fetchSpotUsdPerOz(metalType: string): Promise<number> {
  const resp = await fetchWithTimeout(`${METAL_API_BASE}/${metalType}`);
  if (!resp.ok) throw new Error(`gold-api error: ${resp.status}`);
  const data = await resp.json();
  const price = Number(data?.price);
  if (!isFinite(price) || price <= 0) throw new Error('gold-api returned no price');
  return price;
}

/**
 * Get precious metal price per gram in the given currency.
 * metalType: XAU, XAG, XPT, XPD
 * source: both modes use global spot (USD/oz). The legacy 'domestic' value displays the
 *   same source converted through CNY/gram for compatibility with existing settings.
 */
export async function getMetalPricePerGram(
  metalType: string,
  currency: string,
  source: GoldPriceSource = 'international',
  forceRefresh = false,
): Promise<number> {
  const cacheId = `metal_${source}_${metalType}_${currency}`;
  const cached = await db.exchangeRates.get(cacheId);
  if (!forceRefresh && cached?.rate && cached.rate > 0) return cached.rate;
  const existing = metalRequests.get(cacheId);
  if (existing) return existing;
  const request = (async () => {
    const usdPerGram = (await fetchSpotUsdPerOz(metalType)) / TROY_OZ_TO_GRAM;
    let pricePerGram: number;
    if (source === 'domestic') {
      // Express global spot through CNY/gram first, then convert to the account currency.
      const cnyPerGram = usdPerGram * await getRate('USD', 'CNY');
      pricePerGram = currency === 'CNY' ? cnyPerGram : cnyPerGram * await getRate('CNY', currency);
    } else {
      pricePerGram = currency === 'USD' ? usdPerGram : usdPerGram * await getRate('USD', currency);
    }
    await db.exchangeRates.put({ id: cacheId, base: metalType, quote: currency, rate: pricePerGram, date: formatLocalDate(), updatedAt: Date.now() });
    return pricePerGram;
  })();
  metalRequests.set(cacheId, request);
  try {
    return await request;
  } catch (err) {
    if (cached?.rate && cached.rate > 0) return cached.rate;
    throw err;
  } finally {
    metalRequests.delete(cacheId);
  }
}

/** Cache-only metal lookup for first paint; background refresh fills it later when online. */
export async function getCachedMetalPricePerGram(
  metalType: string,
  currency: string,
  source: GoldPriceSource = 'international',
): Promise<number | undefined> {
  const cached = await db.exchangeRates.get(`metal_${source}_${metalType}_${currency}`);
  return cached?.rate && cached.rate > 0 ? cached.rate : undefined;
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
  await Promise.allSettled(metals.map(m => getMetalPricePerGram(m, base, source, true)));
  notifyRatesRefreshed();
}

/** Refresh only expired data after the first screen is visible. Existing values remain usable offline. */
export async function refreshRatesInBackground(base: string, source: GoldPriceSource = 'international'): Promise<boolean> {
  if (backgroundRefresh) return backgroundRefresh;
  backgroundRefresh = (async () => {
    const now = Date.now();
    const [baseRates, metalAccounts] = await Promise.all([
      db.exchangeRates.where('base').equals(base).toArray(),
      db.accounts.filter(account => account.unit === 'gram' && Boolean(account.metalType) && !account.archivedAt).toArray(),
    ]);
    const ordinaryRates = baseRates.filter(rate => !rate.id.startsWith('metal_'));
    const fxDue = ordinaryRates.length === 0 || ordinaryRates.every(rate => now - rate.updatedAt >= CACHE_DURATION_MS);
    const tasks: Promise<unknown>[] = [];
    if (fxDue) tasks.push(fetchLatestRates(base));

    const metalKeys = new Set(metalAccounts.map(account => `${account.metalType!}|${account.currency}`));
    for (const key of metalKeys) {
      const [metalType, currency] = key.split('|');
      const cache = await db.exchangeRates.get(`metal_${source}_${metalType}_${currency}`);
      if (!cache || now - cache.updatedAt >= METAL_CACHE_DURATION_MS) {
        tasks.push(getMetalPricePerGram(metalType, currency, source, true));
      }
    }
    if (tasks.length === 0) return false;
    const settled = await Promise.allSettled(tasks);
    const updated = settled.some(result => result.status === 'fulfilled');
    if (updated) notifyRatesRefreshed();
    return updated;
  })();
  try {
    return await backgroundRefresh;
  } finally {
    backgroundRefresh = null;
  }
}

export async function getLastUpdateTime(): Promise<number | null> {
  const rates = await db.exchangeRates.toArray();
  if (rates.length === 0) return null;
  return Math.max(...rates.map(r => r.updatedAt));
}
