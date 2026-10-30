import type { DividendStock, GridLevel } from './dividendWorkbench.ts';

/** Origin of an explicitly confirmed price grid; never backfill this onto old grids. */
export interface DividendGridProvenance {
  generatedAt: number;
  grossDpsMicros: number;
  taxBps: 0 | 1000 | 2000;
  parameterVersion: number;
  basisKind: 'recent_batches' | 'classic_ttm';
}

export interface DividendGridBasisCheck {
  dpsMicros?: number;
  asOf: string;
  latestExDate?: string;
  verified: boolean;
}

export type DividendGridBasisState = 'verified' | 'saved_unverified' | 'unavailable';
export type DividendGridStaleReason = 'base_changed' | 'ex_dividend_since_generation' | 'parameters_changed' | 'tax_changed' | 'basis_kind_changed';

const integer = (value: unknown, min = 0): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= min;
const date = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};
const chinaDate = (timestamp = Date.now()) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(timestamp);

export function isDividendGridProvenance(value: unknown): value is DividendGridProvenance {
  if (!value || typeof value !== 'object') return false;
  const origin = value as DividendGridProvenance;
  return integer(origin.generatedAt, 1) && Number.isFinite(new Date(origin.generatedAt).getTime())
    && integer(origin.grossDpsMicros, 1) && [0, 1000, 2000].includes(origin.taxBps)
    && integer(origin.parameterVersion, 1) && ['recent_batches', 'classic_ttm'].includes(origin.basisKind);
}

const explicitLevels = (levels?: GridLevel[]) => (levels ?? []).flatMap((level, index) => integer(level.priceMinor, 1) ? [{ index: index + 1, priceMinor: level.priceMinor }] : []);

/** Review is read-only: stale evidence never replaces prices, budget, shares or the manual pause. */
export function reviewDividendGrid(stock: Pick<DividendStock, 'buyLevels' | 'sellLevels' | 'gridProvenance' | 'quote' | 'quoteFailedAt'>,
  basis?: DividendGridBasisCheck, options: { asOf?: string; parameterVersion?: number; taxBps?: number; basisKind?: DividendGridProvenance['basisKind']; marketDistanceBps?: number } = {}) {
  const asOf = options.asOf ?? chinaDate();
  const buy = explicitLevels(stock.buyLevels), sell = explicitLevels(stock.sellLevels);
  const hasSavedGrid = buy.length > 0 || sell.length > 0;
  const hasCompleteSavedGrid = !!stock.buyLevels?.length && !!stock.sellLevels?.length
    && buy.length === stock.buyLevels.length && sell.length === stock.sellLevels.length;
  const origin = isDividendGridProvenance(stock.gridProvenance) ? stock.gridProvenance : undefined;
  const generatedDate = origin ? chinaDate(origin.generatedAt) : undefined;
  const currentBasisVerified = !!basis?.verified && integer(basis.dpsMicros) && date(asOf)
    && basis.asOf === asOf && (basis.latestExDate === undefined || date(basis.latestExDate) && basis.latestExDate <= asOf);
  const staleReasons: DividendGridStaleReason[] = [];
  let basisChangeBps: number | undefined;
  if (hasSavedGrid && origin) {
    if (currentBasisVerified) {
      const difference = BigInt(Math.abs(basis!.dpsMicros! - origin.grossDpsMicros));
      const previous = BigInt(origin.grossDpsMicros);
      basisChangeBps = Number((difference * 10000n + previous / 2n) / previous);
      // Use exact integers for the >10% decision, independent of the rounded display.
      if (difference * 10000n > previous * 1000n) staleReasons.push('base_changed');
    }
    // Ex-date evidence can retire an old grid even when the cash base cannot be recomputed.
    if (basis?.latestExDate && date(basis.latestExDate) && basis.latestExDate <= asOf && generatedDate && basis.latestExDate > generatedDate) staleReasons.push('ex_dividend_since_generation');
    if (options.parameterVersion !== undefined && options.parameterVersion !== origin.parameterVersion) staleReasons.push('parameters_changed');
    if (options.taxBps !== undefined && options.taxBps !== origin.taxBps) staleReasons.push('tax_changed');
    if (options.basisKind !== undefined && options.basisKind !== origin.basisKind) staleReasons.push('basis_kind_changed');
  }
  const stale = staleReasons.length > 0;
  const provenanceMissing = hasSavedGrid && !origin;
  const basisState: DividendGridBasisState = !hasSavedGrid ? 'unavailable'
    : currentBasisVerified && !!origin && !!generatedDate && generatedDate <= asOf && !stale ? 'verified' : 'saved_unverified';
  const quoteDate = stock.quote?.date.slice(0, 10);
  const quoteAge = date(asOf) && date(quoteDate) ? (Date.parse(asOf) - Date.parse(quoteDate)) / 86400000 : NaN;
  const quoteUsable = !!stock.quote && integer(stock.quote.priceMinor, 1) && stock.quoteFailedAt === undefined && quoteAge >= 0 && quoteAge <= 10;
  const current = quoteUsable ? stock.quote!.priceMinor : undefined;
  const buyTriggeredLevels = current === undefined ? [] : buy.filter(level => current <= level.priceMinor).map(level => level.index);
  const sellTriggeredLevels = current === undefined ? [] : sell.filter(level => current >= level.priceMinor).map(level => level.index);
  const priceState = (levels: typeof buy, triggered: number[]): 'triggered' | 'waiting' | 'unknown' => !quoteUsable || !levels.length ? 'unknown' : triggered.length ? 'triggered' : 'waiting';
  const maximumSell = sell.length ? Math.max(...sell.map(level => level.priceMinor)) : undefined;
  const minimumBuy = buy.length ? Math.min(...buy.map(level => level.priceMinor)) : undefined;
  const belowBuyGapBps = current !== undefined && minimumBuy !== undefined && current < minimumBuy
    ? Math.round((minimumBuy - current) / minimumBuy * 10000) : undefined;
  const distance = options.marketDistanceBps ?? 2000;
  // Above every saved sell price is already a concrete mismatch; a lower price
  // warns only after the configurable distance below the final buy level.
  const marketDeviation: 'above_sell_grid' | 'below_buy_grid' | null = current !== undefined && maximumSell !== undefined && current > maximumSell ? 'above_sell_grid'
    : current !== undefined && minimumBuy !== undefined && current < minimumBuy && integer(distance)
      && BigInt(minimumBuy - current) * 10000n >= BigInt(minimumBuy) * BigInt(distance) ? 'below_buy_grid' : null;
  return { hasSavedGrid, hasCompleteSavedGrid, generatedDate, provenanceMissing, currentBasisVerified, basisState,
    stale, staleReasons, basisChangeBps, quoteUsable, buyState: priceState(buy, buyTriggeredLevels), sellState: priceState(sell, sellTriggeredLevels),
    buyTriggeredLevels, sellTriggeredLevels, marketDeviation, belowBuyGapBps };
}
