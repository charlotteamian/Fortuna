export type UsOptionRight = 'call' | 'put';

export interface UsOptionContract {
  underlying: string;
  expiration: string;     // YYYY-MM-DD
  right: UsOptionRight;
  strikeMilli: number;    // strike × 1000, matching the 8-digit OSI field
  multiplier: number;     // US equity options normally represent 100 shares
}

export interface UsOptionFields {
  instrumentType?: string;
  name?: string;
  symbol?: string;
  optionUnderlying?: string;
  optionExpiration?: string;
  optionRight?: UsOptionRight;
  optionStrikeMilli?: number;
  contractMultiplier?: number;
}

export const DEFAULT_US_OPTION_MULTIPLIER = 100;

function normalizeUnderlying(value: string): string | null {
  const normalized = value.trim().toUpperCase();
  return /^[A-Z][A-Z0-9.-]{0,9}$/.test(normalized) ? normalized : null;
}

function normalizeExpiration(value: string): string | null {
  const compact = value.trim();
  const iso = /^\d{6}$/.test(compact)
    ? `20${compact.slice(0, 2)}-${compact.slice(2, 4)}-${compact.slice(4, 6)}`
    : compact;
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
    ? iso
    : null;
}

export function parseStrikeMilli(value: string): number | null {
  const normalized = value.trim();
  const match = normalized.match(/^(\d{1,5})(?:\.(\d{1,3}))?$/);
  if (!match) return null;
  const strikeMilli = Number(match[1]) * 1000 + Number((match[2] ?? '').padEnd(3, '0'));
  return Number.isSafeInteger(strikeMilli) && strikeMilli > 0 && strikeMilli <= 99_999_999
    ? strikeMilli
    : null;
}

export function formatStrikeMilli(strikeMilli: number): string {
  if (!Number.isSafeInteger(strikeMilli) || strikeMilli <= 0) return '';
  const whole = Math.floor(strikeMilli / 1000);
  const fraction = String(strikeMilli % 1000).padStart(3, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : String(whole);
}

export function buildUsOptionContract(fields: {
  underlying: string;
  expiration: string;
  right: UsOptionRight;
  strikeMilli: number;
  multiplier?: number;
}): UsOptionContract | null {
  const underlying = normalizeUnderlying(fields.underlying);
  const expiration = normalizeExpiration(fields.expiration);
  const multiplier = fields.multiplier ?? DEFAULT_US_OPTION_MULTIPLIER;
  if (!underlying || !expiration || !['call', 'put'].includes(fields.right)) return null;
  if (!Number.isSafeInteger(fields.strikeMilli) || fields.strikeMilli <= 0 || fields.strikeMilli > 99_999_999) return null;
  if (!Number.isSafeInteger(multiplier) || multiplier <= 0) return null;
  return { underlying, expiration, right: fields.right, strikeMilli: fields.strikeMilli, multiplier };
}

/** Compact OSI/OCC symbol used by Cboe, e.g. NOK280121C00007000. */
export function toUsOptionSymbol(contract: UsOptionContract): string {
  const date = contract.expiration.slice(2).replaceAll('-', '');
  const right = contract.right === 'call' ? 'C' : 'P';
  return `${contract.underlying}${date}${right}${String(contract.strikeMilli).padStart(8, '0')}`;
}

export function formatUsOptionLabel(contract: UsOptionContract): string {
  return `${contract.underlying} ${contract.expiration} ${formatStrikeMilli(contract.strikeMilli)}${contract.right === 'call' ? 'C' : 'P'}`;
}

/**
 * Accepts the compact OSI symbol plus common broker formats such as
 * "NOK 280121 7.00C" and "NOK 2028-01-21 CALL 7".
 */
export function parseUsOptionSymbol(value?: string): UsOptionContract | null {
  if (!value) return null;
  const normalized = value.trim().toUpperCase().replace(/\s+/g, ' ');
  if (!normalized) return null;

  const osi = normalized.match(/^([A-Z][A-Z0-9.-]{0,9})(\d{6})([CP])(\d{8})$/);
  if (osi) {
    return buildUsOptionContract({
      underlying: osi[1],
      expiration: osi[2],
      right: osi[3] === 'C' ? 'call' : 'put',
      strikeMilli: Number(osi[4]),
    });
  }

  const broker = normalized.match(/^([A-Z][A-Z0-9.-]{0,9}) (\d{6}|\d{4}-\d{2}-\d{2}) (\d+(?:\.\d{1,3})?)\s*(C|P|CALL|PUT)$/);
  const brokerRightFirst = normalized.match(/^([A-Z][A-Z0-9.-]{0,9}) (\d{6}|\d{4}-\d{2}-\d{2}) (C|P|CALL|PUT)\s*(\d+(?:\.\d{1,3})?)$/);
  const match = broker ?? brokerRightFirst;
  if (!match) return null;
  const rightText = broker ? match[4] : match[3];
  const strikeText = broker ? match[3] : match[4];
  const strikeMilli = parseStrikeMilli(strikeText);
  if (strikeMilli == null) return null;
  return buildUsOptionContract({
    underlying: match[1],
    expiration: match[2],
    right: rightText === 'C' || rightText === 'CALL' ? 'call' : 'put',
    strikeMilli,
  });
}

export function resolveUsOptionContract(fields: UsOptionFields): UsOptionContract | null {
  if (fields.instrumentType === 'us_option') {
    const structured = buildUsOptionContract({
      underlying: fields.optionUnderlying ?? '',
      expiration: fields.optionExpiration ?? '',
      right: fields.optionRight ?? 'call',
      strikeMilli: fields.optionStrikeMilli ?? 0,
      multiplier: fields.contractMultiplier,
    });
    if (structured) return structured;
  }
  return parseUsOptionSymbol(fields.symbol) ?? parseUsOptionSymbol(fields.name);
}

/** Legacy/free-text holdings keep multiplier 1; only explicit structured options use 100. */
export function getHoldingContractMultiplier(fields: UsOptionFields): number {
  return fields.instrumentType === 'us_option'
    && Number.isSafeInteger(fields.contractMultiplier)
    && (fields.contractMultiplier ?? 0) > 0
    ? fields.contractMultiplier!
    : 1;
}
