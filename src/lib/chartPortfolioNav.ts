import type { PortfolioNavSeriesPoint, PortfolioNavSummary } from './balanceFlow.ts';
import {
  calculateHoldingTxnFee,
  resolveHoldingFeeTerms,
  type HoldingFeeTerms,
} from './holdingPosition.ts';
import { getHoldingContractMultiplier } from './usOption.ts';

interface PortfolioAccountLike {
  id: string;
  type: 'asset' | 'liability';
  portfolio?: boolean;
  hidden?: boolean;
  archivedAt?: number;
}

interface PnlHoldingLike {
  id: string;
  accountId: string;
  mode?: string;
  lastPrice: number;
  priceDate?: string;
  commissionRatePercent?: number;
  stampDutyRatePercent?: number;
  instrumentType?: 'us_option';
  contractMultiplier?: number;
}

interface PnlTxnLike {
  id: string;
  accountId: string;
  holdingId: string;
  date: string;
  kind: 'buy' | 'sell';
  shares: number;
  price: number;
  fee?: number;
  balanceSnapshot?: number;
  quantitySnapshot?: number;
  costPriceSnapshot?: number;
  marketPriceSnapshot?: number;
  feeSource?: 'auto' | 'manual';
  createdAt: number;
}

export interface PnlNavPoint {
  date: string;
  /** Time-weighted unit NAV; the first subscription is priced at 1.0000. */
  nav: number;
}

/** Statistics are an explicit opt-in for actual portfolio accounts, independent of global totals. */
export function getEligibleNavAccounts<T extends PortfolioAccountLike>(accounts: readonly T[]): T[] {
  return accounts.filter(account => account.type === 'asset' && account.portfolio === true && !account.hidden && !account.archivedAt);
}

export function normalizeNavAccountIds(ids: readonly string[] | undefined, accounts: readonly PortfolioAccountLike[]): string[] {
  const eligible = new Set(getEligibleNavAccounts(accounts).map(account => account.id));
  return [...new Set(Array.isArray(ids) ? ids : [])].filter(id => eligible.has(id));
}

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const EPSILON = 1e-9;

function isValidIsoDate(value?: string): value is string {
  return typeof value === 'string' && ISO_DATE_PATTERN.test(value);
}

interface NavSlot {
  shares: number;
  /** Latest valuation price: execution price, calibration price, or the current quote once marked. */
  price: number;
  multiplier: number;
  feeTerms: HoldingFeeTerms;
  lastTxnDate: string;
}

interface NavRun {
  points: PnlNavPoint[];
  slots: Map<string, NavSlot>;
}

/**
 * Holdings-only fund accounting: every buy subscribes units and every sell redeems units
 * at the NAV implied by that fill's price, so adding or withdrawing capital never moves
 * the NAV. Only price changes and fees do.
 */
function runNav(
  slots: Map<string, NavSlot>,
  txnsByDate: Map<string, PnlTxnLike[]>,
  marksByDate: Map<string, { holdingId: string; price: number }[]>,
): NavRun {
  for (const slot of slots.values()) { slot.shares = 0; slot.price = 0; slot.lastTxnDate = ''; }
  let units = 0;
  let nav = 1;

  const totalValue = () => {
    let value = 0;
    for (const slot of slots.values()) value += slot.shares * slot.multiplier * slot.price;
    return value;
  };
  /** Re-derive the NAV from current valuations; units only change through flows. */
  const reprice = () => {
    const value = totalValue();
    if (units > EPSILON) nav = Math.max(0, value / units);
    else if (value > EPSILON && nav > 0) units = value / nav;
  };
  const flow = (amount: number) => {
    if (!(nav > 0) || Math.abs(amount) < EPSILON) return;
    units = Math.max(0, units + amount / nav);
  };
  /** An emptied book keeps its closing NAV so the next subscription continues from it. */
  const closeIfEmpty = () => {
    if (totalValue() < EPSILON) units = 0;
  };

  const points: PnlNavPoint[] = [];
  const dates = [...new Set([...txnsByDate.keys(), ...marksByDate.keys()])].sort();
  for (const date of dates) {
    for (const tx of txnsByDate.get(date) ?? []) {
      const slot = slots.get(tx.holdingId)!;
      slot.lastTxnDate = date;

      if (tx.quantitySnapshot != null) {
        const target = Math.max(0, tx.quantitySnapshot);
        const marketPrice = tx.marketPriceSnapshot;
        if (typeof marketPrice === 'number' && Number.isFinite(marketPrice) && marketPrice > 0) {
          // The recorded quote is a real valuation: the move up to it is return,
          // and only the share difference is capital in or out.
          slot.price = marketPrice;
          reprice();
          flow((target - slot.shares) * slot.multiplier * marketPrice);
        } else {
          // No quote was recorded, so the cost price stands in as the valuation and the
          // whole value change is a flow: the calibration itself earns nothing.
          const cost = tx.costPriceSnapshot;
          const nextPrice = typeof cost === 'number' && Number.isFinite(cost) && cost > 0 ? cost : slot.price;
          flow((target * nextPrice - slot.shares * slot.price) * slot.multiplier);
          slot.price = nextPrice;
        }
        slot.shares = target;
        closeIfEmpty();
        reprice();
        continue;
      }

      const fee = calculateHoldingTxnFee(tx, slot.multiplier, slot.feeTerms);
      // A zero price (for example bonus shares) carries no valuation information.
      if (tx.price > 0) {
        slot.price = tx.price;
        reprice();
      }
      if (!(tx.shares > EPSILON)) continue;

      if (tx.kind === 'buy') {
        flow(tx.shares * slot.multiplier * tx.price + fee);
        slot.shares += tx.shares;
        reprice();
        continue;
      }

      const sold = Math.min(tx.shares, slot.shares);
      if (sold < EPSILON) continue;
      const sellFee = sold >= tx.shares - EPSILON ? fee : fee * (sold / tx.shares);
      const proceeds = sold * slot.multiplier * tx.price;
      const bookValue = sold * slot.multiplier * slot.price;
      const before = totalValue();
      if (units > EPSILON) {
        // The fee, and any shortfall of a zero-price disposal against book value, is a loss
        // shared by all units before the net proceeds are redeemed.
        nav = Math.max(0, (before - sellFee - (bookValue - proceeds)) / units);
        const remaining = before - bookValue;
        units = nav > 0 ? Math.max(0, remaining / nav) : (remaining > EPSILON ? units : 0);
      }
      slot.shares -= sold;
      if (slot.shares < EPSILON) slot.shares = 0;
      closeIfEmpty();
    }

    for (const mark of marksByDate.get(date) ?? []) {
      const slot = slots.get(mark.holdingId)!;
      slot.price = mark.price;
    }
    if (marksByDate.has(date)) reprice();

    points.push({ date, nav: Math.max(0, nav) });
  }
  return { points, slots };
}

/**
 * Time-weighted unit NAV of an account's unit holdings, independent of cash balances.
 * Historical dates value each position at its latest execution price (or the market price
 * recorded with a calibration), and adopt the current `lastPrice` on the valuation date.
 */
export function buildAccountNavPoints(
  accountId: string,
  holdings: readonly PnlHoldingLike[],
  txns: readonly PnlTxnLike[],
  feeSettings: { defaultCommissionRatePercent?: number; minCommission?: number } = {},
  accountCategory?: string,
): PnlNavPoint[] {
  // A bare call prices fills at 0 commission, matching the historical default; callers with
  // real settings pass the configured default and minimum instead.
  const normalizedFeeSettings = {
    defaultCommissionRatePercent: feeSettings.defaultCommissionRatePercent ?? 0,
    minCommission: feeSettings.minCommission ?? 0,
  };
  const slots = new Map<string, NavSlot>();
  const holdingById = new Map<string, PnlHoldingLike>();
  for (const holding of holdings) {
    if (holding.accountId !== accountId || holding.mode === 'balance') continue;
    holdingById.set(holding.id, holding);
    slots.set(holding.id, {
      shares: 0,
      price: 0,
      multiplier: getHoldingContractMultiplier(holding),
      feeTerms: resolveHoldingFeeTerms(holding, normalizedFeeSettings, accountCategory),
      lastTxnDate: '',
    });
  }

  const ordered = txns
    .filter(tx => tx.accountId === accountId && slots.has(tx.holdingId) && tx.balanceSnapshot == null)
    .map((tx, index) => ({ tx, index }))
    .sort((a, b) => a.tx.date.localeCompare(b.tx.date)
      || a.tx.createdAt - b.tx.createdAt
      || a.tx.id.localeCompare(b.tx.id)
      || a.index - b.index);
  if (!ordered.length) return [];
  const txnsByDate = new Map<string, PnlTxnLike[]>();
  for (const { tx } of ordered) {
    const list = txnsByDate.get(tx.date) ?? [];
    list.push(tx);
    txnsByDate.set(tx.date, list);
  }

  // First pass finds each holding's closing position, which decides where its quote applies.
  const dryRun = runNav(slots, txnsByDate, new Map());
  let finalDate = '';
  const pending: { holdingId: string; quoteDate: string | null; price: number }[] = [];
  for (const [holdingId, slot] of dryRun.slots) {
    if (!slot.lastTxnDate) continue;
    const holding = holdingById.get(holdingId)!;
    const open = slot.shares > EPSILON;
    const quoteDate = open && isValidIsoDate(holding.priceDate) && holding.priceDate >= slot.lastTxnDate
      ? holding.priceDate
      : null;
    if (slot.lastTxnDate > finalDate) finalDate = slot.lastTxnDate;
    if (quoteDate && quoteDate > finalDate) finalDate = quoteDate;
    if (open) {
      pending.push({
        holdingId,
        quoteDate,
        price: Number.isFinite(holding.lastPrice) && holding.lastPrice > 0 ? holding.lastPrice : 0,
      });
    }
  }
  const marksByDate = new Map<string, { holdingId: string; price: number }[]>();
  for (const { holdingId, quoteDate, price } of pending) {
    const date = quoteDate ?? finalDate;
    const list = marksByDate.get(date) ?? [];
    list.push({ holdingId, price });
    marksByDate.set(date, list);
  }

  return runNav(slots, txnsByDate, marksByDate).points;
}

/**
 * With `fromDate`, the range is rebased on the last NAV before it (carried in as 1.0000
 * at the range start), so both the return and the drawdown describe the range alone.
 */
export function summarizeAccountNav(points: readonly PnlNavPoint[], fromDate?: string): PortfolioNavSummary {
  const ordered = [...points].sort((a, b) => a.date.localeCompare(b.date));
  let inRange = ordered;
  let base = 1;
  if (fromDate) {
    inRange = ordered.filter(point => point.date >= fromDate);
    const before = ordered.filter(point => point.date < fromDate).at(-1);
    if (before && before.nav > 0) {
      base = before.nav;
      if (inRange[0]?.date !== fromDate) inRange = [{ date: fromDate, nav: before.nav }, ...inRange];
    }
  }
  const series: PortfolioNavSeriesPoint[] = [];
  let peak = 1;
  let maxDrawdown = 0;
  for (const point of inRange) {
    const nav = Math.round((Math.max(0, point.nav) / base) * 10000) / 10000;
    if (nav > peak) peak = nav;
    const drawdown = (peak > 0 ? Math.round(((peak - nav) / peak) * 10000) / 100 : 0) || 0;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;
    const cumulativeReturnPercent = Math.round((nav - 1) * 10000) / 100 || 0;
    series.push({ date: point.date, nav, cumulativeReturnPercent, drawdownPercent: drawdown });
  }
  const latest = series.at(-1);
  return { series, latestNav: latest?.nav ?? 1, cumulativeReturnPercent: latest?.cumulativeReturnPercent ?? 0, maxDrawdownPercent: maxDrawdown };
}
