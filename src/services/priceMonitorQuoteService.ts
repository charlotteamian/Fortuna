import { db, initializeSettings } from '../db';
import { formatLocalDate } from '../lib/localDate';
import { fetchSecurityMonitorQuotes } from './quoteService';
import { fetchLatestRates, getMetalPricePerGram } from './rateService';
import { evaluatePriceMonitorQuotes, markPriceMonitorQuoteFailures, type ObservedPriceMonitorQuote } from './priceMonitorService';

let inFlight: Promise<{ checked: number; near: number; reached: number; failed: number }> | null = null;
const lastAttempts = new Map<string, number>();

/** Independent from portfolio quantities: sold-out and never-held securities remain eligible. */
export async function refreshPriceMonitorQuotes({ force = false }: { force?: boolean } = {}): Promise<{ checked: number; near: number; reached: number; failed: number }> {
  if (inFlight) {
    const result = await inFlight;
    return force ? refreshPriceMonitorQuotes({ force }) : result;
  }
  inFlight = refresh(force);
  try { return await inFlight; }
  finally { inFlight = null; }
}

async function refresh(force: boolean) {
  const now = Date.now();
  const today = formatLocalDate(new Date(now));
  const settings = await initializeSettings();
  const plans = (await db.priceMonitors.where('status').equals('active').toArray()).filter(plan => force || (
    (!plan.lastCheckedAt || formatLocalDate(new Date(plan.lastCheckedAt)) !== today)
    && now - (lastAttempts.get(plan.id) ?? 0) >= 5 * 60000
  ));
  if (!plans.length) return { checked: 0, near: 0, reached: 0, failed: 0 };
  for (const plan of plans) lastAttempts.set(plan.id, now);
  const quotes: Record<string, ObservedPriceMonitorQuote> = {};
  const securities = plans.filter(plan => plan.kind === 'security');
  const gold = plans.filter(plan => plan.kind === 'gold');
  await Promise.allSettled([
    (async () => {
      const result = await fetchSecurityMonitorQuotes(securities);
      for (const plan of securities) if (result[plan.id]) quotes[plan.id] = { ...result[plan.id], planUpdatedAt: plan.updatedAt };
    })(),
    (async () => {
      // A converted gold alert must not silently reuse an old exchange rate.
      let fxFresh = true;
      if (gold.some(plan => plan.currency !== 'USD')) {
        try { await fetchLatestRates('USD'); }
        catch { fxFresh = false; }
      }
      await Promise.allSettled(gold.map(async plan => {
        if (plan.currency !== 'USD' && !fxFresh) return;
        const startedAt = Date.now();
        const source = settings.goldPriceSource ?? 'international';
        const metalType = plan.metalType ?? 'XAU';
        const price = await getMetalPricePerGram(metalType, plan.currency, source, true);
        const cache = await db.exchangeRates.get(`metal_${source}_${metalType}_${plan.currency}`);
        // Valuation deliberately falls back offline; alerts must only use a new successful quote.
        if (!cache || cache.updatedAt < startedAt || !Number.isFinite(price) || price <= 0) return;
        quotes[plan.id] = { priceMicros: Math.round(price * 1e6), date: cache.date, fetchedAt: cache.updatedAt, planUpdatedAt: plan.updatedAt };
      }));
    })(),
  ]);
  const result = await evaluatePriceMonitorQuotes(quotes);
  const failures = plans.filter(plan => !quotes[plan.id]).map(plan => ({ id: plan.id, planUpdatedAt: plan.updatedAt }));
  if (failures.length) await markPriceMonitorQuoteFailures(failures);
  return { ...result, failed: failures.length };
}
