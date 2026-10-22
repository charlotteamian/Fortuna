import { formatLocalDate } from './localDate.ts';

export interface PriceMonitorQuote {
  priceMicros: number;
  date: string;
  fetchedAt: number;
  /** Request fingerprint; excluded from persisted lastQuote by the service. */
  planUpdatedAt?: number;
}

export interface PriceMonitorAlert {
  kind: 'near' | 'reached';
  date: string;
  priceMicros: number;
  createdAt: number;
  dismissedAt?: number;
}

export interface PriceMonitor {
  id: string;
  name: string;
  kind: 'security' | 'gold';
  symbol?: string;
  market?: string;
  currency: string;
  accountId?: string;
  holdingId?: string;
  metalType?: string;
  targetPriceMicros: number;
  toleranceBps: number;
  direction: 'at_or_below' | 'at_or_above';
  status: 'active' | 'stopped' | 'reached';
  createdAt: number;
  updatedAt: number;
  lastQuote?: PriceMonitorQuote;
  lastCheckedAt?: number;
  lastErrorAt?: number;
  alert?: PriceMonitorAlert;
}

export type PriceMonitorInput = Pick<PriceMonitor,
  'name' | 'kind' | 'symbol' | 'market' | 'currency' | 'accountId' | 'holdingId' | 'metalType'
  | 'targetPriceMicros' | 'toleranceBps' | 'direction'> & { id?: string };

const isText = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const positiveInteger = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;
const timestamp = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const optionalText = (value: unknown) => value === undefined || isText(value);
const optionalTimestamp = (value: unknown) => value === undefined || timestamp(value);
const isDate = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00`);
  return Number.isFinite(parsed.getTime()) && formatLocalDate(parsed) === value;
};

export function isPriceMonitorQuote(value: unknown): value is PriceMonitorQuote {
  if (!value || typeof value !== 'object') return false;
  const quote = value as PriceMonitorQuote;
  const clock = typeof quote.date === 'string' ? quote.date.slice(11) : '';
  return positiveInteger(quote.priceMicros) && typeof quote.date === 'string'
    && /^\d{4}-\d{2}-\d{2}(?: (?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?)?$/.test(quote.date)
    && isDate(quote.date.slice(0, 10))
    && (!clock || (Number(clock.slice(0, 2)) <= 23 && Number(clock.slice(3, 5)) <= 59 && (!clock.slice(6) || Number(clock.slice(6)) <= 59)))
    && timestamp(quote.fetchedAt);
}

export function isPriceMonitorInput(value: unknown): value is PriceMonitorInput {
  if (!value || typeof value !== 'object') return false;
  const input = value as PriceMonitorInput;
  return optionalText(input.id) && isText(input.name) && input.name.length <= 200
    && ['security', 'gold'].includes(input.kind)
    && (input.kind === 'gold' ? input.metalType === 'XAU' : isText(input.symbol))
    && isText(input.currency) && /^[A-Z]{3}$/.test(input.currency)
    && [input.symbol, input.market, input.accountId, input.holdingId].every(optionalText)
    && positiveInteger(input.targetPriceMicros)
    && Number.isSafeInteger(input.toleranceBps) && input.toleranceBps >= 0 && input.toleranceBps <= 10000
    && ['at_or_below', 'at_or_above'].includes(input.direction);
}

export function isPriceMonitor(value: unknown): value is PriceMonitor {
  if (!isPriceMonitorInput(value)) return false;
  const plan = value as PriceMonitor;
  if (!isText(plan.id) || !['active', 'stopped', 'reached'].includes(plan.status)
    || !timestamp(plan.createdAt) || !timestamp(plan.updatedAt)
    || !optionalTimestamp(plan.lastCheckedAt) || !optionalTimestamp(plan.lastErrorAt)
    || (plan.lastQuote !== undefined && !isPriceMonitorQuote(plan.lastQuote))) return false;
  const alert = plan.alert;
  return alert === undefined || (Boolean(alert) && typeof alert === 'object'
    && ['near', 'reached'].includes(alert.kind) && isDate(alert.date)
    && positiveInteger(alert.priceMicros) && timestamp(alert.createdAt) && optionalTimestamp(alert.dismissedAt));
}

/** Compare integer price units, including boundaries, without floating-point amount storage. */
export function getPriceMonitorSignal(plan: Pick<PriceMonitor, 'direction' | 'targetPriceMicros' | 'toleranceBps'>, priceMicros: number): 'near' | 'reached' | null {
  if (!positiveInteger(priceMicros) || !positiveInteger(plan.targetPriceMicros)
    || !['at_or_below', 'at_or_above'].includes(plan.direction)
    || !Number.isSafeInteger(plan.toleranceBps) || plan.toleranceBps < 0 || plan.toleranceBps > 10000) return null;
  if (plan.direction === 'at_or_below' && priceMicros <= plan.targetPriceMicros) return 'reached';
  if (plan.direction === 'at_or_above' && priceMicros >= plan.targetPriceMicros) return 'reached';
  const distance = BigInt(Math.abs(priceMicros - plan.targetPriceMicros));
  return distance * 10000n <= BigInt(plan.targetPriceMicros) * BigInt(plan.toleranceBps) ? 'near' : null;
}

/** New successful observations only; old cache and out-of-order requests cannot create alerts. */
export function evaluatePriceMonitor(plan: PriceMonitor, quote: PriceMonitorQuote, now = Date.now()): PriceMonitor {
  if (plan.status !== 'active' || !isPriceMonitorQuote(quote)
    || quote.date.slice(0, 10) > formatLocalDate(new Date(now))
    || new Date(`${quote.date.slice(0, 10)}T00:00:00`).getTime() < now - 11 * 24 * 60 * 60_000
    || quote.fetchedAt < plan.updatedAt || quote.fetchedAt < now - 5 * 60_000
    || quote.fetchedAt > now + 60_000
    || (plan.lastQuote && quote.fetchedAt < plan.lastQuote.fetchedAt)) return plan;
  const next: PriceMonitor = { ...plan, lastQuote: quote, lastCheckedAt: now, lastErrorAt: undefined };
  const signal = getPriceMonitorSignal(plan, quote.priceMicros);
  if (!signal) return next;
  if (signal === 'reached') {
    return { ...next, status: 'reached', updatedAt: now,
      alert: { kind: signal, date: formatLocalDate(new Date(now)), priceMicros: quote.priceMicros, createdAt: now } };
  }
  const day = formatLocalDate(new Date(now));
  if (plan.alert?.date === day) return next;
  return { ...next, alert: { kind: signal, date: day, priceMicros: quote.priceMicros, createdAt: now } };
}
