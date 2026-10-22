import { v4 as uuidv4 } from 'uuid';
import { db } from '../db';
import { evaluatePriceMonitor, isPriceMonitorInput, type PriceMonitor, type PriceMonitorInput, type PriceMonitorQuote } from '../lib/priceMonitor';
import { requestPortableSnapshot } from './portableSnapshotEvents';

export const PRICE_MONITORS_CHANGED_EVENT = 'price-monitors-changed';

function notifyChanged() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(PRICE_MONITORS_CHANGED_EVENT));
  requestPortableSnapshot('price-monitors');
}

export async function listPriceMonitors(): Promise<PriceMonitor[]> {
  return (await db.priceMonitors.toArray()).sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
}

export async function savePriceMonitor(input: PriceMonitorInput): Promise<PriceMonitor> {
  const clean: PriceMonitorInput = { id: input.id, name: input.name.trim(), kind: input.kind,
    currency: input.currency.trim().toUpperCase(), symbol: input.symbol?.trim() || undefined,
    market: input.market?.trim() || undefined, accountId: input.accountId, holdingId: input.holdingId,
    metalType: input.kind === 'gold' ? input.metalType : undefined, targetPriceMicros: input.targetPriceMicros,
    toleranceBps: input.toleranceBps, direction: input.direction };
  if (!isPriceMonitorInput(clean)) throw new Error('INVALID_PRICE_MONITOR');
  const saved = await db.transaction('rw', db.priceMonitors, async () => {
    const existing = clean.id ? await db.priceMonitors.get(clean.id) : undefined;
    if (clean.id && !existing) throw new Error('PRICE_MONITOR_NOT_FOUND');
    const now = Date.now();
    const sameQuoteTarget = existing?.kind === clean.kind && existing.symbol === clean.symbol
      && existing.market === clean.market && existing.currency === clean.currency && existing.metalType === clean.metalType;
    const plan: PriceMonitor = { ...clean, id: existing?.id ?? uuidv4(), status: 'active',
      createdAt: existing?.createdAt ?? now, updatedAt: Math.max(now, (existing?.updatedAt ?? -1) + 1),
      lastQuote: sameQuoteTarget ? existing?.lastQuote : undefined };
    await db.priceMonitors.put(plan);
    return plan;
  });
  notifyChanged();
  return saved;
}

export async function stopPriceMonitor(id: string): Promise<void> {
  await db.transaction('rw', db.priceMonitors, async () => {
    const current = await db.priceMonitors.get(id);
    if (current) await db.priceMonitors.put({ ...current, status: 'stopped', updatedAt: Math.max(Date.now(), current.updatedAt + 1), alert: undefined });
  });
  notifyChanged();
}

export async function restartPriceMonitor(id: string): Promise<void> {
  await db.transaction('rw', db.priceMonitors, async () => {
    const current = await db.priceMonitors.get(id);
    if (current) await db.priceMonitors.put({ ...current, status: 'active', updatedAt: Math.max(Date.now(), current.updatedAt + 1), alert: undefined, lastCheckedAt: undefined, lastErrorAt: undefined });
  });
  notifyChanged();
}

export async function deletePriceMonitor(id: string): Promise<void> {
  await db.priceMonitors.delete(id);
  notifyChanged();
}

export async function dismissPriceMonitorAlert(id: string): Promise<void> {
  await db.transaction('rw', db.priceMonitors, async () => {
    const current = await db.priceMonitors.get(id);
    if (current?.alert && current.alert.dismissedAt === undefined) await db.priceMonitors.update(id, {
      alert: { ...current.alert, dismissedAt: Date.now() },
    });
  });
  notifyChanged();
}

export interface ObservedPriceMonitorQuote extends PriceMonitorQuote {
  /** Version of the plan read before starting this request. */
  planUpdatedAt?: number;
}

export async function evaluatePriceMonitorQuotes(quotes: Record<string, ObservedPriceMonitorQuote>, now = Date.now()) {
  const result = { checked: 0, near: 0, reached: 0 };
  await db.transaction('rw', db.priceMonitors, async () => {
    for (const [id, observed] of Object.entries(quotes)) {
      const current = await db.priceMonitors.get(id);
      if (!current || (observed.planUpdatedAt !== undefined && current.updatedAt !== observed.planUpdatedAt)) continue;
      const quote: PriceMonitorQuote = { priceMicros: observed.priceMicros, date: observed.date, fetchedAt: observed.fetchedAt };
      const next = evaluatePriceMonitor(current, quote, now);
      if (next === current) continue;
      await db.priceMonitors.put(next);
      result.checked += 1;
      if (next.alert !== current.alert) result[next.alert!.kind] += 1;
    }
  });
  if (result.checked) notifyChanged();
  return result;
}

export async function markPriceMonitorQuoteFailures(ids: (string | { id: string; planUpdatedAt: number })[], now = Date.now()): Promise<void> {
  let changed = false;
  await db.transaction('rw', db.priceMonitors, async () => {
    for (const requested of ids) {
      const id = typeof requested === 'string' ? requested : requested.id;
      const current = await db.priceMonitors.get(id);
      if (current?.status === 'active' && (typeof requested === 'string' || current.updatedAt === requested.planUpdatedAt) && (current.lastCheckedAt ?? 0) <= now) {
        await db.priceMonitors.update(id, { lastErrorAt: now });
        changed = true;
      }
    }
  });
  if (changed) notifyChanged();
}
