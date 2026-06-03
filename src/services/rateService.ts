import { db } from '../db';
import { TROY_OZ_TO_GRAM } from '../db';

const API_BASE = 'https://api.frankfurter.dev/v2';
const CACHE_DURATION_MS = 24 * 60 * 60 * 1000;

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

/**
 * Get precious metal price per gram in the given currency.
 * metalType: XAU, XAG, XPT, XPD
 */
export async function getMetalPricePerGram(metalType: string, currency: string, forceRefresh = false): Promise<number> {
  try {
    if (forceRefresh) {
      await db.exchangeRates.delete(`${metalType}_${currency}`);
      await db.exchangeRates.delete(`${currency}_${metalType}`);
    }
    // XAU/CNY gives CNY per troy ounce
    const pricePerOz = await getRate(metalType, currency);
    return pricePerOz / TROY_OZ_TO_GRAM;
  } catch (err) {
    console.error(`Failed to get metal price ${metalType}/${currency}:`, err);
    return 0;
  }
}

/**
 * Compute the currency value of a precious metal holding.
 * grams × pricePerGram
 */
export async function computeMetalValue(grams: number, metalType: string, currency: string): Promise<number> {
  const ppg = await getMetalPricePerGram(metalType, currency);
  return grams * ppg;
}

export async function refreshAllRates(base: string): Promise<void> {
  await fetchLatestRates(base);
  // Also explicitly refresh common metals to ensure they are updated
  const metals = ['XAU', 'XAG', 'XPT', 'XPD'];
  for (const m of metals) {
    try {
      await getMetalPricePerGram(m, base, true);
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
