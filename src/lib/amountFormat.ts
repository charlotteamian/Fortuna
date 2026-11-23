/**
 * The single source of truth for how the app renders amounts, prices, and share
 * counts. Each page used to keep its own copy of these helpers, which let decimal
 * places and the negative-sign character drift apart between screens (B5). Every
 * caller now formats through here.
 */

/** Compact magnitude formatting: abbreviates to 亿/万 (zh) or B/M (en) units. */
export function formatAmountCompact(n: number, isEn: boolean, unitWan: string, unitYi: string): string {
  if (isEn) {
    if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(2) + unitYi;
    if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(2) + unitWan;
    return n.toFixed(2);
  }
  if (Math.abs(n) >= 1e8) return (n / 1e8).toFixed(2) + unitYi;
  if (Math.abs(n) >= 1e4) return (n / 1e4).toFixed(2) + unitWan;
  return n.toFixed(2);
}

/** Full amount with thousands separators and exactly two decimal places. */
export function formatAmountFull(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Share/lot counts: thousands separators, up to eight fractional digits. */
export function formatShares(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 8 });
}

/**
 * Price with per-currency minimum decimals (JPY has none) and a configurable
 * maximum precision for high-decimal crypto and fund quotes.
 */
export function formatPrice(n: number, currency: string, precision = 8): string {
  return n.toLocaleString('en-US', {
    minimumFractionDigits: currency === 'JPY' ? 0 : 2,
    maximumFractionDigits: precision,
  });
}
