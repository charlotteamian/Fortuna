import type { HoldingTxn } from '../db';

export const DEFAULT_COMMISSION_RATE_PERCENT = 0.01;
export const MAX_COMMISSION_RATE_PERCENT = 10;
export const DEFAULT_STAMP_DUTY_RATE_PERCENT = 0.05;
export const MAX_MIN_COMMISSION = 1_000_000;

const UNIT_HOLDING_CATEGORIES = new Set(['股票/ETF', '股票', '场外基金', '数字货币']);
const STOCK_COMMISSION_CATEGORIES = new Set(['股票/ETF', '股票']);

export type HoldingTxnLike = Pick<
  HoldingTxn,
  'date' | 'kind' | 'shares' | 'price' | 'createdAt' | 'quantitySnapshot' | 'costPriceSnapshot' | 'balanceSnapshot' | 'fee'
> & { id?: string };

export interface HoldingFeeTerms {
  /** Commission as a percentage of the traded amount (0.01 means 0.01% = 0.0001). */
  commissionRatePercent: number;
  /** Smallest commission charged per fill, in the account currency. Only applies where a commission applies. */
  minCommission: number;
  /** Stamp duty as a percentage of the traded amount, charged on sells only. */
  stampDutyRatePercent: number;
}

/** Terms used to price a fill that has no stored fee. Every omitted term is 0. */
export type HoldingPositionOptions = Partial<HoldingFeeTerms>;

export interface HoldingDayTradeMatch {
  date: string;
  direction: 'buy_then_sell' | 'sell_then_buy';
  buyTxnId: string;
  sellTxnId: string;
  shares: number;
  buyPrice: number;
  sellPrice: number;
  buyFee: number;
  sellFee: number;
  fee: number;
  pnl: number;
  costBasis: number;
}

export interface HoldingTxnDayTradeSummary {
  txnId: string;
  matchedShares: number;
  totalShares: number;
  direction: 'buy_then_sell' | 'sell_then_buy' | 'mixed';
  buyAvgPrice: number;
  sellAvgPrice: number;
  pnl: number;
  fee: number;
  matchCount: number;
}

export interface HoldingRealizedEvent {
  date: string;
  sellTxnId: string;
  amount: number;
  costBasis: number;
  isDayTrade: boolean;
}

export interface HoldingDailyState {
  date: string;
  shares: number;
  costBasis: number;
  realizedPnl: number;
  realizedCostBasis: number;
  knownPrice: number;
}

export interface HoldingPosition {
  shares: number;
  avgCost: number;          // weighted-average cost of remaining open lots (including buy fees)
  costBasis: number;        // total cost of remaining open lots (including buy fees)
  realizedPnl: number;      // accumulated realized P&L from same-day T matches & LIFO sells (net of fees)
  realizedCostBasis: number;// accumulated cost basis of sold/matched shares (including buy fees)
  netInvested: number;      // costBasis - realizedPnl; total buy cash out minus net sell proceeds
  dilutedCost: number;      // broker-style break-even cost per remaining share
  totalFees: number;        // accumulated commission/fees across buy & sell fills
  dayTradePnl: number;      // realized P&L specifically from matched same-day T+0 trades (net of fees)
  dayTradeCount: number;    // count of matched same-day T+0 pairs
}

export interface HoldingPositionAnalysis {
  position: HoldingPosition;
  dayTrades: HoldingDayTradeMatch[];
  txnDayTrades: Record<string, HoldingTxnDayTradeSummary>;
  txnFees: Record<string, number>;
  realizedEvents: HoldingRealizedEvent[];
  dailyStates: HoldingDailyState[];
}

export interface HoldingPnl {
  unrealizedPnl: number;
  totalPnl: number;
  totalPnlRate: number | null;
}

const POSITION_EPSILON = 1e-9;

export interface BalanceHoldingTimelineEntry {
  id: string;
  balance: number;
  underflow: boolean;
}

export function isValidCommissionRatePercent(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= MAX_COMMISSION_RATE_PERCENT;
}

export function normalizeCommissionRatePercent(value: unknown, fallback = 0): number {
  return isValidCommissionRatePercent(value) ? value : fallback;
}

export function formatCommissionRatePercent(ratePercent: number): string {
  const safe = normalizeCommissionRatePercent(ratePercent, 0);
  return String(Number(safe.toFixed(6)));
}

export function formatCommissionWan(ratePercent: number): string {
  const safe = normalizeCommissionRatePercent(ratePercent, 0);
  return String(Number((safe * 100).toFixed(4)));
}

export function resolveHoldingCommissionRatePercent(
  holding?: { mode?: string; commissionRatePercent?: number },
  defaultCommissionRatePercent?: number,
  accountCategory?: string,
): number {
  if (holding?.mode === 'balance') return 0;
  if (accountCategory && !holding?.mode && !UNIT_HOLDING_CATEGORIES.has(accountCategory)) return 0;
  if (isValidCommissionRatePercent(holding?.commissionRatePercent)) return holding.commissionRatePercent;
  if (accountCategory && !STOCK_COMMISSION_CATEGORIES.has(accountCategory)) return 0;
  return normalizeCommissionRatePercent(defaultCommissionRatePercent, DEFAULT_COMMISSION_RATE_PERCENT);
}

export function isValidMinCommission(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= MAX_MIN_COMMISSION;
}

function normalizeFeeTerms(terms: number | Partial<HoldingFeeTerms> | undefined): HoldingFeeTerms {
  const source = typeof terms === 'number' ? { commissionRatePercent: terms } : terms ?? {};
  return {
    commissionRatePercent: normalizeCommissionRatePercent(source.commissionRatePercent, 0),
    minCommission: isValidMinCommission(source.minCommission) ? source.minCommission : 0,
    stampDutyRatePercent: normalizeCommissionRatePercent(source.stampDutyRatePercent, 0),
  };
}

/**
 * Fee terms that price a new fill of this holding. Stamp duty is opt-in per holding, so
 * ETFs and funds stay duty-free unless the user sets a rate on them.
 */
export function resolveHoldingFeeTerms(
  holding?: { mode?: string; commissionRatePercent?: number; stampDutyRatePercent?: number },
  settings?: { defaultCommissionRatePercent?: number; minCommission?: number },
  accountCategory?: string,
): HoldingFeeTerms {
  const tradesUnits = holding?.mode !== 'balance'
    && !(accountCategory && !holding?.mode && !UNIT_HOLDING_CATEGORIES.has(accountCategory));
  if (!tradesUnits) return { commissionRatePercent: 0, minCommission: 0, stampDutyRatePercent: 0 };
  return normalizeFeeTerms({
    commissionRatePercent: resolveHoldingCommissionRatePercent(holding, settings?.defaultCommissionRatePercent, accountCategory),
    minCommission: settings?.minCommission,
    stampDutyRatePercent: holding?.stampDutyRatePercent,
  });
}

type FeeFill = Pick<HoldingTxn, 'shares' | 'price'> & Partial<Pick<HoldingTxn, 'kind' | 'quantitySnapshot' | 'balanceSnapshot'>>;

const roundToCents = (value: number) => Math.round(value * 100) / 100;

function hasStoredFee(tx: Pick<HoldingTxn, 'fee'>): tx is { fee: number } {
  return typeof tx.fee === 'number' && Number.isFinite(tx.fee) && tx.fee >= 0;
}

/** A fee typed by the user. Fees stored before fee sources existed were always typed. */
export function isManualTxnFee(tx: Pick<HoldingTxn, 'fee' | 'feeSource'>): boolean {
  return typeof tx.fee === 'number' && Number.isFinite(tx.fee) && tx.fee >= 0 && tx.feeSource !== 'auto';
}

/** Commission (never below the minimum) plus stamp duty on sells, each rounded to cents. */
export function calculateAutoTxnFee(
  tx: FeeFill,
  multiplier = 1,
  terms: number | Partial<HoldingFeeTerms> = 0,
): number {
  if (tx.quantitySnapshot != null || tx.balanceSnapshot != null) return 0;
  const { commissionRatePercent, minCommission, stampDutyRatePercent } = normalizeFeeTerms(terms);
  const safeMultiplier = Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1;
  const gross = Math.max(0, tx.shares) * Math.max(0, tx.price) * safeMultiplier;
  if (!(gross > 0)) return 0;
  const commission = commissionRatePercent > 0
    ? Math.max(roundToCents(gross * (commissionRatePercent / 100)), minCommission)
    : 0;
  const stampDuty = tx.kind === 'sell' && stampDutyRatePercent > 0
    ? roundToCents(gross * (stampDutyRatePercent / 100))
    : 0;
  return roundToCents(commission + stampDuty);
}

/** The fee a fill carries: its stored fee, or the automatic fee when nothing is stored yet. */
export function calculateHoldingTxnFee(
  tx: FeeFill & Pick<HoldingTxn, 'fee'>,
  multiplier = 1,
  terms: number | Partial<HoldingFeeTerms> = 0,
): number {
  if (tx.quantitySnapshot != null || tx.balanceSnapshot != null) return 0;
  if (hasStoredFee(tx)) return roundToCents(tx.fee);
  return calculateAutoTxnFee(tx, multiplier, terms);
}

/** Balance-mode ledger: direct snapshots reset the anchor; principal flows continue from it. */
export function deriveBalanceHoldingTimeline(txns: HoldingTxn[]): BalanceHoldingTimelineEntry[] {
  const chron = [...txns].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt);
  let balance = 0;
  return chron.map(tx => {
    let underflow = false;
    if (tx.balanceSnapshot != null) {
      balance = Math.max(0, tx.balanceSnapshot);
    } else {
      const next = balance + (tx.kind === 'buy' ? tx.shares : -tx.shares);
      underflow = next < -0.005;
      balance = Math.max(0, next);
    }
    balance = Math.round(balance * 100) / 100;
    return { id: tx.id, balance, underflow };
  });
}

export function computeBalanceHoldingPosition(txns: HoldingTxn[]): HoldingPosition {
  const balance = deriveBalanceHoldingTimeline(txns).at(-1)?.balance ?? 0;
  return {
    shares: balance,
    avgCost: balance > POSITION_EPSILON ? 1 : 0,
    costBasis: balance,
    realizedPnl: 0,
    realizedCostBasis: 0,
    netInvested: balance,
    dilutedCost: balance > POSITION_EPSILON ? 1 : 0,
    totalFees: 0,
    dayTradePnl: 0,
    dayTradeCount: 0,
  };
}

interface OpenLot {
  txnId: string;
  date: string;
  shares: number;
  price: number;
  cost: number;
  fee: number;
  isAnchor?: boolean;
}

interface PendingSell {
  txnId: string;
  date: string;
  shares: number;
  price: number;
  net: number;
  fee: number;
}

/**
 * Same-day T+0 matching (both buy-then-sell and sell-then-buy) + LIFO lot accounting,
 * with each fill's stored fee (or the automatic fee when none is stored) and broker-style diluted cost.
 */
export function analyzeHoldingPosition(
  txns: readonly HoldingTxnLike[],
  multiplier = 1,
  options: HoldingPositionOptions = {},
): HoldingPositionAnalysis {
  const safeMultiplier = Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1;

  const normalized = txns.map((tx, index) => ({ tx, txnId: tx.id ?? `__txn_${index}`, index }));
  normalized.sort(
    (a, b) => a.tx.date.localeCompare(b.tx.date)
      || a.tx.createdAt - b.tx.createdAt
      || a.txnId.localeCompare(b.txnId)
      || a.index - b.index,
  );

  const sharesByTxnId = new Map<string, number>();
  for (const item of normalized) sharesByTxnId.set(item.txnId, item.tx.shares);

  const historicalLots: OpenLot[] = [];
  let realizedPnl = 0;
  let realizedCostBasis = 0;
  let totalFees = 0;
  let dayTradePnl = 0;
  let knownPrice = 0;

  const dayTrades: HoldingDayTradeMatch[] = [];
  const txnFees: Record<string, number> = {};
  const dailyStates: HoldingDailyState[] = [];
  const sellOrder: string[] = [];
  const realizedBySell = new Map<string, {
    date: string;
    amount: number;
    costBasis: number;
    dayTradeCount: number;
    nonDayTradeCount: number;
  }>();

  const recordSellRealized = (sellTxnId: string, date: string, amount: number, costBasis: number, isDayTrade: boolean) => {
    let entry = realizedBySell.get(sellTxnId);
    if (!entry) {
      entry = { date, amount: 0, costBasis: 0, dayTradeCount: 0, nonDayTradeCount: 0 };
      realizedBySell.set(sellTxnId, entry);
      sellOrder.push(sellTxnId);
    }
    entry.amount += amount;
    entry.costBasis += costBasis;
    if (isDayTrade) entry.dayTradeCount += 1;
    else entry.nonDayTradeCount += 1;
  };

  const sumLotShares = (lots: readonly OpenLot[]) => lots.reduce((sum, lot) => sum + lot.shares, 0);
  const sumLotCost = (lots: readonly OpenLot[]) => lots.reduce((sum, lot) => sum + lot.cost, 0);

  const flushPendingSellsToHistorical = (pendingSells: PendingSell[]) => {
    for (const pending of pendingSells) {
      while (pending.shares > POSITION_EPSILON && historicalLots.length > 0) {
        const lot = historicalLots[historicalLots.length - 1];
        const take = Math.min(pending.shares, lot.shares);
        const buyCost = take >= lot.shares - POSITION_EPSILON ? lot.cost : lot.cost * (take / lot.shares);
        const sellNet = take >= pending.shares - POSITION_EPSILON ? pending.net : pending.net * (take / pending.shares);
        const pnl = sellNet - buyCost;
        realizedPnl += pnl;
        realizedCostBasis += buyCost;
        recordSellRealized(pending.txnId, pending.date, pnl, buyCost, false);
        pending.shares -= take;
        pending.net -= sellNet;
        lot.shares -= take;
        lot.cost -= buyCost;
        if (lot.shares < POSITION_EPSILON) historicalLots.pop();
      }
    }
    pendingSells.length = 0;
  };

  let cursor = 0;
  while (cursor < normalized.length) {
    const dayDate = normalized[cursor].tx.date;
    let dayEnd = cursor + 1;
    while (dayEnd < normalized.length && normalized[dayEnd].tx.date === dayDate) dayEnd += 1;

    const todayBuys: OpenLot[] = [];
    const pendingSells: PendingSell[] = [];

    for (let i = cursor; i < dayEnd; i++) {
      const { tx, txnId } = normalized[i];
      if (tx.quantitySnapshot != null) {
        txnFees[txnId] = 0;
        flushPendingSellsToHistorical(pendingSells);
        if (todayBuys.length > 0) {
          historicalLots.push(...todayBuys);
          todayBuys.length = 0;
        }
        const prevShares = sumLotShares(historicalLots);
        const prevCost = sumLotCost(historicalLots);
        const previousAvg = prevShares > POSITION_EPSILON ? prevCost / (prevShares * safeMultiplier) : 0;
        const targetShares = Math.max(0, tx.quantitySnapshot);
        const nextAvg = tx.costPriceSnapshot ?? previousAvg;
        historicalLots.length = 0;
        if (targetShares >= POSITION_EPSILON) {
          historicalLots.push({
            txnId,
            date: tx.date,
            shares: targetShares,
            price: nextAvg,
            cost: targetShares * safeMultiplier * nextAvg,
            fee: 0,
            isAnchor: true,
          });
        }
        if (tx.costPriceSnapshot != null && tx.costPriceSnapshot > 0) knownPrice = tx.costPriceSnapshot;
        else if (knownPrice === 0 && nextAvg > 0) knownPrice = nextAvg;
        continue;
      }

      const fee = calculateHoldingTxnFee(tx, safeMultiplier, options);
      txnFees[txnId] = fee;
      if (tx.price > 0) knownPrice = tx.price;

      if (tx.shares < POSITION_EPSILON) {
        totalFees += fee;
        continue;
      }

      if (tx.kind === 'buy') {
        totalFees += fee;
        let remShares = tx.shares;
        let remCost = tx.shares * safeMultiplier * tx.price + fee;
        let remFee = fee;

        // Same-day reverse T+0 (sell first, then buy back): match against pending sells LIFO.
        while (remShares > POSITION_EPSILON && pendingSells.length > 0) {
          const pending = pendingSells[pendingSells.length - 1];
          const take = Math.min(remShares, pending.shares);
          const buyCost = take >= remShares - POSITION_EPSILON ? remCost : remCost * (take / remShares);
          const buyFee = take >= remShares - POSITION_EPSILON ? remFee : remFee * (take / remShares);
          const sellNet = take >= pending.shares - POSITION_EPSILON ? pending.net : pending.net * (take / pending.shares);
          const sellFee = take >= pending.shares - POSITION_EPSILON ? pending.fee : pending.fee * (take / pending.shares);
          const pnl = sellNet - buyCost;
          realizedPnl += pnl;
          realizedCostBasis += buyCost;
          dayTradePnl += pnl;
          dayTrades.push({
            date: dayDate,
            direction: 'sell_then_buy',
            buyTxnId: txnId,
            sellTxnId: pending.txnId,
            shares: take,
            buyPrice: tx.price,
            sellPrice: pending.price,
            buyFee,
            sellFee,
            fee: buyFee + sellFee,
            pnl,
            costBasis: buyCost,
          });
          recordSellRealized(pending.txnId, dayDate, pnl, buyCost, true);
          remShares -= take;
          remCost -= buyCost;
          remFee -= buyFee;
          pending.shares -= take;
          pending.net -= sellNet;
          pending.fee -= sellFee;
          if (pending.shares < POSITION_EPSILON) pendingSells.pop();
        }

        if (remShares > POSITION_EPSILON) {
          todayBuys.push({
            txnId,
            date: dayDate,
            shares: remShares,
            price: tx.price,
            cost: remCost,
            fee: remFee,
          });
        }
      } else {
        const pendingSellShares = pendingSells.reduce((sum, item) => sum + item.shares, 0);
        const availableShares = Math.max(0, sumLotShares(historicalLots) + sumLotShares(todayBuys) - pendingSellShares);
        const sold = Math.min(tx.shares, availableShares);
        if (sold < POSITION_EPSILON) continue;
        const effectiveSellFee = sold >= tx.shares - POSITION_EPSILON ? fee : fee * (sold / tx.shares);
        totalFees += effectiveSellFee;

        let remShares = sold;
        let remNet = sold * safeMultiplier * tx.price - effectiveSellFee;
        let remFee = effectiveSellFee;

        // Same-day regular T+0 (buy first, then sell): match against today's open buys LIFO.
        while (remShares > POSITION_EPSILON && todayBuys.length > 0) {
          const lot = todayBuys[todayBuys.length - 1];
          const take = Math.min(remShares, lot.shares);
          const buyCost = take >= lot.shares - POSITION_EPSILON ? lot.cost : lot.cost * (take / lot.shares);
          const buyFee = take >= lot.shares - POSITION_EPSILON ? lot.fee : lot.fee * (take / lot.shares);
          const sellNet = take >= remShares - POSITION_EPSILON ? remNet : remNet * (take / remShares);
          const sellFee = take >= remShares - POSITION_EPSILON ? remFee : remFee * (take / remShares);
          const pnl = sellNet - buyCost;
          realizedPnl += pnl;
          realizedCostBasis += buyCost;
          dayTradePnl += pnl;
          dayTrades.push({
            date: dayDate,
            direction: 'buy_then_sell',
            buyTxnId: lot.txnId,
            sellTxnId: txnId,
            shares: take,
            buyPrice: lot.price,
            sellPrice: tx.price,
            buyFee,
            sellFee,
            fee: buyFee + sellFee,
            pnl,
            costBasis: buyCost,
          });
          recordSellRealized(txnId, dayDate, pnl, buyCost, true);
          remShares -= take;
          remNet -= sellNet;
          remFee -= sellFee;
          lot.shares -= take;
          lot.cost -= buyCost;
          lot.fee -= buyFee;
          if (lot.shares < POSITION_EPSILON) todayBuys.pop();
        }

        if (remShares > POSITION_EPSILON) {
          pendingSells.push({
            txnId,
            date: dayDate,
            shares: remShares,
            price: tx.price,
            net: remNet,
            fee: remFee,
          });
        }
      }
    }

    // End of day: settle remaining unmatched sells against historical lots via LIFO.
    flushPendingSellsToHistorical(pendingSells);
    if (todayBuys.length > 0) historicalLots.push(...todayBuys);

    let dayShares = sumLotShares(historicalLots);
    let dayCostBasis = sumLotCost(historicalLots);
    if (dayShares < POSITION_EPSILON) {
      historicalLots.length = 0;
      dayShares = 0;
      dayCostBasis = 0;
    }

    dailyStates.push({
      date: dayDate,
      shares: dayShares,
      costBasis: dayCostBasis,
      realizedPnl,
      realizedCostBasis,
      knownPrice,
    });

    cursor = dayEnd;
  }

  let shares = sumLotShares(historicalLots);
  let costBasis = sumLotCost(historicalLots);
  if (shares < POSITION_EPSILON) {
    shares = 0;
    costBasis = 0;
  }
  const netInvested = costBasis - realizedPnl;

  // Build per-transaction same-day T+0 summary so UI can badge both legs with "T".
  const txnDayTradeAcc = new Map<string, {
    matchedShares: number;
    buyValue: number;
    sellValue: number;
    pnl: number;
    fee: number;
    matchCount: number;
    hasBuyThenSell: boolean;
    hasSellThenBuy: boolean;
  }>();
  const accumulateTxnMatch = (txnId: string, match: HoldingDayTradeMatch) => {
    const current = txnDayTradeAcc.get(txnId) ?? {
      matchedShares: 0,
      buyValue: 0,
      sellValue: 0,
      pnl: 0,
      fee: 0,
      matchCount: 0,
      hasBuyThenSell: false,
      hasSellThenBuy: false,
    };
    current.matchedShares += match.shares;
    current.buyValue += match.shares * match.buyPrice;
    current.sellValue += match.shares * match.sellPrice;
    current.pnl += match.pnl;
    current.fee += match.fee;
    current.matchCount += 1;
    if (match.direction === 'buy_then_sell') current.hasBuyThenSell = true;
    else current.hasSellThenBuy = true;
    txnDayTradeAcc.set(txnId, current);
  };
  for (const match of dayTrades) {
    accumulateTxnMatch(match.buyTxnId, match);
    accumulateTxnMatch(match.sellTxnId, match);
  }
  const txnDayTrades: Record<string, HoldingTxnDayTradeSummary> = {};
  for (const [txnId, acc] of txnDayTradeAcc.entries()) {
    txnDayTrades[txnId] = {
      txnId,
      matchedShares: acc.matchedShares,
      totalShares: sharesByTxnId.get(txnId) ?? acc.matchedShares,
      direction: acc.hasBuyThenSell && acc.hasSellThenBuy
        ? 'mixed'
        : acc.hasBuyThenSell
          ? 'buy_then_sell'
          : 'sell_then_buy',
      buyAvgPrice: acc.matchedShares > POSITION_EPSILON ? acc.buyValue / acc.matchedShares : 0,
      sellAvgPrice: acc.matchedShares > POSITION_EPSILON ? acc.sellValue / acc.matchedShares : 0,
      pnl: acc.pnl,
      fee: acc.fee,
      matchCount: acc.matchCount,
    };
  }

  const realizedEvents: HoldingRealizedEvent[] = sellOrder.map(sellTxnId => {
    const entry = realizedBySell.get(sellTxnId)!;
    return {
      date: entry.date,
      sellTxnId,
      amount: entry.amount,
      costBasis: entry.costBasis,
      isDayTrade: entry.dayTradeCount > 0 && entry.nonDayTradeCount === 0,
    };
  });

  return {
    position: {
      shares,
      avgCost: shares > POSITION_EPSILON ? costBasis / (shares * safeMultiplier) : 0,
      costBasis,
      realizedPnl,
      realizedCostBasis,
      netInvested,
      dilutedCost: shares > POSITION_EPSILON ? netInvested / (shares * safeMultiplier) : 0,
      totalFees: Math.round(totalFees * 100) / 100,
      dayTradePnl,
      dayTradeCount: dayTrades.length,
    },
    dayTrades,
    txnDayTrades,
    txnFees,
    realizedEvents,
    dailyStates,
  };
}

/** LIFO + same-day T+0 ledger math plus broker-style diluted cost. */
export function computeHoldingPosition(
  txns: readonly HoldingTxnLike[],
  multiplier = 1,
  options?: HoldingPositionOptions,
): HoldingPosition {
  return analyzeHoldingPosition(txns, multiplier, options).position;
}

/** Cumulative P&L includes both the open position and every settled sell / T+0 match. */
export function computeHoldingPnl(position: HoldingPosition, marketValue: number): HoldingPnl {
  const unrealizedPnl = marketValue - position.costBasis;
  const totalPnl = unrealizedPnl + position.realizedPnl;
  // Open positions retain the broker-style diluted-capital return. Once fully sold,
  // use the historical cost of the settled shares; netInvested collapses to
  // -realizedPnl at that point and would otherwise manufacture -100% losses.
  const rateBasis = position.shares > POSITION_EPSILON
    ? position.netInvested
    : position.realizedCostBasis;
  return {
    unrealizedPnl,
    totalPnl,
    totalPnlRate: rateBasis > POSITION_EPSILON
      ? (totalPnl / rateBasis) * 100
      : null,
  };
}
