import { stockBudgetMinor, type DividendStock, type GridLevel } from './dividendWorkbench.ts';

export const CLASSIC_BUY_YIELD_LADDER = [550, 575, 600, 650] as const;
export const CLASSIC_SELL_YIELD_LADDER = [480, 450, 420, 400] as const;
export const CLASSIC_NEUTRAL_YIELD_BPS = 500;
export const CLASSIC_TIER_PORTION_BPS = 2500;

export type ClassicTaxRateBps = 0 | 1000 | 2000;
export type ClassicDividendBaseTier = 'recent_batches' | 'unavailable';
export type ClassicGridOrigin = 'custom_saved' | 'classic_saved' | 'classic_auto';
export type ClassicQuoteSource = 'live' | 'cached' | 'missing';

/** The verified recent-batch basis shared with the screening check, already limited to the latest annual EPS. */
export interface ClassicVerifiedBasis {
  dpsMicros?: number;
  implementedDpsMicros?: number;
  earningsCap?: { epsMicros: number; reportDate: string };
  flags?: string[];
  verified: boolean;
  latestExDate?: string;
  reportPeriods?: string[];
  frequency?: 'semiannual' | 'annual' | 'unknown';
}

export interface ClassicDividendBase {
  /** Pricing numerator: implemented recent-batch cash, limited to the latest annual EPS. */
  grossDpsMicros?: number;
  netDpsMicros?: number;
  /** Cash actually paid in the selected batches, before the earnings limit. */
  implementedDpsMicros?: number;
  earningsCap?: { epsMicros: number; reportDate: string };
  cappedAtEarnings: boolean;
  earningsUnchecked: boolean;
  taxBps: ClassicTaxRateBps;
  tier: ClassicDividendBaseTier;
  frequency: 'semiannual' | 'annual' | 'unknown';
  periodLabel: string;
  strategyNoteZh: string;
  strategyNoteEn: string;
  latestExDate?: string;
  reportPeriods: string[];
}

export interface ClassicGridTierRow {
  level: number;
  side: 'buy' | 'sell';
  yieldBps: number;
  portionBps: number;
  cumulativePortionBps: number;
  grossPriceMinor: number;
  priceMinor: number;
  classicPriceMinor: number;
  gapFromQuoteBps?: number;
  targetShares?: number;
  incrementalShares?: number;
  sellShares?: number;
  touched: boolean;
  status: 'triggered' | 'covered' | 'below_lot' | 'no_holding' | 'waiting' | 'quote_pending';
}

export interface ClassicTodayAction {
  type: 'buy' | 'sell' | 'hold_covered' | 'paused' | 'wait' | 'unavailable';
  triggeredBuyLevel: number;
  triggeredSellLevel: number;
  suggestedShares: number;
  suggestedAmountMinor?: number;
  nextBuyPriceMinor?: number;
  nextBuyGapBps?: number;
  nextSellPriceMinor?: number;
  nextSellGapBps?: number;
  headlineZh: string;
  headlineEn: string;
  detailZh: string;
  detailEn: string;
}

export interface ClassicHealthCheck {
  key: 'yield_zone' | 'dividend_base' | 'position_discipline';
  status: 'good' | 'neutral' | 'caution';
  labelZh: string;
  labelEn: string;
  detailZh: string;
  detailEn: string;
}

export interface ClassicStockPlan {
  code: string;
  name: string;
  group: DividendStock['group'];
  sector: string;
  shares: number;
  lotSize: number;
  weightBps: number;
  budgetMinor?: number;
  buyPaused: boolean;
  quotePriceMinor?: number;
  quoteChangePercent?: number;
  quoteDate?: string;
  quoteSource: ClassicQuoteSource;
  currentGrossYieldBps?: number;
  currentNetYieldBps?: number;
  neutralPriceMinor?: number;
  grossNeutralPriceMinor?: number;
  base: ClassicDividendBase;
  gridOrigin: ClassicGridOrigin;
  hasCustomPriceDiff: boolean;
  buyRows: ClassicGridTierRow[];
  sellRows: ClassicGridTierRow[];
  classicBuyLevels: GridLevel[];
  classicSellLevels: GridLevel[];
  todayAction: ClassicTodayAction;
  /** Symmetric 20% beyond the outermost tier; the action is then reference-only. */
  marketDeviation?: 'above_sell_grid' | 'below_buy_grid' | null;
  healthChecks: ClassicHealthCheck[];
}

function applyTaxMicros(grossDpsMicros: number, taxBps: ClassicTaxRateBps): number {
  return Math.max(1, Number((BigInt(Math.max(1, Math.round(grossDpsMicros))) * BigInt(10000 - taxBps)) / 10000n));
}

function buyPriceForYield(dpsMicros: number, yieldBps: number): number {
  return Math.max(1, Math.floor(dpsMicros / yieldBps));
}

function sellPriceForYield(dpsMicros: number, yieldBps: number): number {
  return Math.max(1, Number((BigInt(Math.max(1, Math.round(dpsMicros))) + BigInt(yieldBps) - 1n) / BigInt(yieldBps)));
}

function periodShortLabel(reportDate: string): string {
  const year = reportDate.slice(0, 4);
  if (reportDate.endsWith('-12-31')) return `${year}年报`;
  if (reportDate.endsWith('-06-30')) return `${year}中报`;
  return reportDate;
}

function daysBetween(a: string, b: string): number {
  const ta = Date.parse(`${a.slice(0, 10)}T00:00:00Z`);
  const tb = Date.parse(`${b.slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(ta) && Number.isFinite(tb) ? Math.abs(ta - tb) / 86400000 : Infinity;
}

const yuan = (micros?: number) => micros === undefined ? '—' : `¥${(micros / 1e6).toFixed(4)}`;

/**
 * The home grid accepts only the same verified recent-batch basis as the
 * screening check: implemented cash limited to the latest annual EPS. There is
 * no proposal, placeholder, baseline-table or cyclical-smoothing fallback, and
 * a manual DPS guess never generates prices; without a verified basis the grid
 * is explicitly unavailable.
 */
export function resolveClassicDividendBase(
  options: { taxBps?: ClassicTaxRateBps; basis?: ClassicVerifiedBasis } = {},
): ClassicDividendBase {
  const taxBps: ClassicTaxRateBps = options.taxBps ?? 1000;
  const basis = options.basis;
  const flags = basis?.flags ?? [];
  const cappedAtEarnings = flags.includes('CAPPED_AT_EARNINGS');
  const earningsUnchecked = flags.includes('EARNINGS_CAP_UNCHECKED');
  const periods = basis?.reportPeriods ?? [];
  const periodLabel = periods.map(periodShortLabel).join(' + ');
  if (basis?.verified && basis.dpsMicros !== undefined && basis.dpsMicros > 0) {
    const gross = basis.dpsMicros;
    const baseNote = `已核验最近分红批次基数（${periodLabel || '批次所属期待确认'}），送转除权已折算`;
    const baseNoteEn = `Verified recent-batch base (${periodLabel || 'periods pending'}), restated for share changes`;
    return {
      grossDpsMicros: gross,
      netDpsMicros: applyTaxMicros(gross, taxBps),
      implementedDpsMicros: basis.implementedDpsMicros,
      ...(basis.earningsCap ? { earningsCap: basis.earningsCap } : {}),
      cappedAtEarnings,
      earningsUnchecked,
      taxBps,
      tier: 'recent_batches',
      frequency: basis.frequency ?? 'unknown',
      periodLabel,
      strategyNoteZh: cappedAtEarnings
        ? `已实施分红 ${yuan(basis.implementedDpsMicros)} 超过最近年报每股收益 ${yuan(basis.earningsCap?.epsMicros)}（${basis.earningsCap?.reportDate ?? ''}），网格基数已按每股收益封顶。`
        : earningsUnchecked
          ? `${baseNote}；缺少最近年报每股收益，未能核对分红是否超过盈利，网格按已实施分红计算。`
          : `${baseNote}，且未超过最近年报每股收益。`,
      strategyNoteEn: cappedAtEarnings
        ? `Implemented cash ${yuan(basis.implementedDpsMicros)} exceeds the latest annual EPS ${yuan(basis.earningsCap?.epsMicros)} (${basis.earningsCap?.reportDate ?? ''}); the base is limited to that EPS.`
        : earningsUnchecked
          ? `${baseNoteEn}; the latest annual EPS is unavailable, so cash was not compared with earnings.`
          : `${baseNoteEn}, within the latest annual EPS.`,
      ...(basis.latestExDate ? { latestExDate: basis.latestExDate } : {}),
      reportPeriods: periods,
    };
  }
  const annualLoss = flags.includes('EARNINGS_NON_POSITIVE');
  return {
    cappedAtEarnings: false,
    earningsUnchecked,
    taxBps,
    tier: 'unavailable',
    frequency: basis?.frequency ?? 'unknown',
    periodLabel,
    strategyNoteZh: annualLoss
      ? '最近年度每股收益不为正，分红缺少当年盈利支撑，不生成网格价格。'
      : '尚未取得已核验的最近分红批次，无法计算网格价格；请先刷新行情与分红。已保存的手工网格仍会原样显示。',
    strategyNoteEn: annualLoss
      ? 'The latest annual EPS is not positive, so the dividend lacks earnings support; no grid prices are generated.'
      : 'No verified recent distribution batches; grid prices are unavailable. Refresh quotes and dividends first. A saved manual grid remains visible.',
    ...(basis?.latestExDate ? { latestExDate: basis.latestExDate } : {}),
    reportPeriods: periods,
  };
}

const validLadder = (values: readonly number[] | undefined, fallback: readonly number[]): number[] =>
  Array.isArray(values) && values.length > 0 && values.every(value => Number.isSafeInteger(value) && value > 0) ? [...values] : [...fallback];

/**
 * Builds the complete, ready-to-render Classic Dividend Grid Plan and live trigger analysis
 * for a stock. Without a verified recent-batch basis only a saved explicit grid is shown.
 */
export function buildClassicStockPlan(
  stock: DividendStock,
  options: {
    totalBudgetMinor?: number;
    shares?: number;
    taxBps?: ClassicTaxRateBps;
    asOf?: string;
    basis?: ClassicVerifiedBasis;
    buyYieldBps?: readonly number[];
    sellYieldBps?: readonly number[];
  } = {},
): ClassicStockPlan {
  const taxBps: ClassicTaxRateBps = options.taxBps ?? (stock.gridProvenance?.taxBps ?? 1000);
  const asOf = options.asOf ?? new Date().toISOString().slice(0, 10);
  const shares = options.shares ?? (stock.shareMode === 'manual' ? stock.manualShares : 0);
  const budgetMinor = options.totalBudgetMinor === undefined ? undefined : stockBudgetMinor(options.totalBudgetMinor, stock.weightBps);
  const base = resolveClassicDividendBase({ taxBps, basis: options.basis });
  const hasBase = base.tier === 'recent_batches' && base.grossDpsMicros !== undefined && base.netDpsMicros !== undefined;
  const sector = /银行/.test(stock.name) ? '银行' : /电|水|能/.test(stock.name) ? '公用事业' : /煤|矿|油|化/.test(stock.name) ? '资源周期' : '红利价值';

  let quotePriceMinor: number | undefined;
  let quoteDate: string | undefined;
  let quoteChangePercent: number | undefined;
  let quoteSource: ClassicQuoteSource = 'missing';
  if (stock.quote && Number.isSafeInteger(stock.quote.priceMinor) && stock.quote.priceMinor > 0) {
    quotePriceMinor = stock.quote.priceMinor;
    quoteDate = stock.quote.date;
    quoteChangePercent = stock.quote.changePercent;
    const age = quoteDate ? daysBetween(asOf, quoteDate.slice(0, 10)) : 0;
    quoteSource = age <= 10 && stock.quoteFailedAt === undefined ? 'live' : 'cached';
  }

  const grossNeutralPriceMinor = hasBase ? buyPriceForYield(base.grossDpsMicros!, CLASSIC_NEUTRAL_YIELD_BPS) : undefined;
  const neutralPriceMinor = hasBase ? buyPriceForYield(base.netDpsMicros!, CLASSIC_NEUTRAL_YIELD_BPS) : undefined;
  const currentGrossYieldBps = quotePriceMinor && hasBase ? Math.round((base.implementedDpsMicros ?? base.grossDpsMicros!) / quotePriceMinor) : undefined;
  const currentNetYieldBps = quotePriceMinor && hasBase ? Math.round(base.netDpsMicros! / quotePriceMinor) : undefined;

  const buyLadder = validLadder(options.buyYieldBps, CLASSIC_BUY_YIELD_LADDER);
  const sellLadder = validLadder(options.sellYieldBps, CLASSIC_SELL_YIELD_LADDER);
  const classicBuyLevels: GridLevel[] = hasBase ? buyLadder.map(yieldBps => ({
    yieldBps,
    portionBps: CLASSIC_TIER_PORTION_BPS,
    priceMinor: buyPriceForYield(base.netDpsMicros!, yieldBps),
  })) : [];
  const classicSellLevels: GridLevel[] = hasBase ? sellLadder.map(yieldBps => ({
    yieldBps,
    portionBps: CLASSIC_TIER_PORTION_BPS,
    priceMinor: sellPriceForYield(base.netDpsMicros!, yieldBps),
  })) : [];

  const hasSavedBuy = Array.isArray(stock.buyLevels) && stock.buyLevels.length > 0 && stock.buyLevels.every(l => l.priceMinor && l.priceMinor > 0);
  const hasSavedSell = Array.isArray(stock.sellLevels) && stock.sellLevels.length > 0 && stock.sellLevels.every(l => l.priceMinor && l.priceMinor > 0);
  const useSaved = hasSavedBuy && hasSavedSell;
  const activeBuyLevels = useSaved ? stock.buyLevels! : classicBuyLevels;
  const activeSellLevels = useSaved ? stock.sellLevels! : classicSellLevels;

  const matchesClassic = useSaved && hasBase
    && activeBuyLevels.length === classicBuyLevels.length
    && activeBuyLevels.every((l, i) => l.priceMinor === classicBuyLevels[i].priceMinor)
    && activeSellLevels.length === classicSellLevels.length
    && activeSellLevels.every((l, i) => l.priceMinor === classicSellLevels[i].priceMinor);

  const gridOrigin: ClassicGridOrigin = !useSaved ? 'classic_auto' : matchesClassic ? 'classic_saved' : 'custom_saved';
  const hasCustomPriceDiff = useSaved && !matchesClassic;

  // Build Buy Rows
  let buyCumulativePortion = 0;
  let cumulativeBuySharesFloat = 0;
  const buyRows: ClassicGridTierRow[] = activeBuyLevels.map((level, index) => {
    buyCumulativePortion += level.portionBps;
    const classicPrice = classicBuyLevels[index]?.priceMinor ?? (hasBase ? buyPriceForYield(base.netDpsMicros!, level.yieldBps) : 0);
    const priceMinor = level.priceMinor ?? classicPrice;
    const grossPriceMinor = hasBase ? buyPriceForYield(base.grossDpsMicros!, level.yieldBps) : priceMinor;
    if (budgetMinor !== undefined && budgetMinor > 0 && priceMinor > 0) {
      cumulativeBuySharesFloat += stockBudgetMinor(budgetMinor, level.portionBps) / priceMinor;
    }
    const targetShares = budgetMinor !== undefined && budgetMinor > 0
      ? Math.floor(cumulativeBuySharesFloat / stock.lotSize) * stock.lotSize
      : undefined;
    const incrementalShares = targetShares !== undefined
      ? Math.max(0, Math.floor((targetShares - shares) / stock.lotSize) * stock.lotSize)
      : undefined;
    const touched = quotePriceMinor !== undefined && priceMinor > 0 && quotePriceMinor <= priceMinor;
    const gapFromQuoteBps = quotePriceMinor !== undefined && quotePriceMinor > 0 && priceMinor > 0
      ? Math.round(((priceMinor - quotePriceMinor) / quotePriceMinor) * 10000)
      : undefined;
    const status: ClassicGridTierRow['status'] = quotePriceMinor === undefined
      ? 'quote_pending'
      : !touched
        ? 'waiting'
        : targetShares === undefined
          ? 'triggered'
          : incrementalShares && incrementalShares > 0
            ? 'triggered'
            : targetShares <= shares && targetShares > 0
              ? 'covered'
              : 'below_lot';
    return {
      level: index + 1,
      side: 'buy',
      yieldBps: level.yieldBps,
      portionBps: level.portionBps,
      cumulativePortionBps: buyCumulativePortion,
      grossPriceMinor,
      priceMinor,
      classicPriceMinor: classicPrice,
      gapFromQuoteBps,
      targetShares,
      incrementalShares,
      touched,
      status,
    };
  });

  // Build Sell Rows
  let sellCumulativePortion = 0;
  const sellRows: ClassicGridTierRow[] = activeSellLevels.map((level, index) => {
    sellCumulativePortion += level.portionBps;
    const classicPrice = classicSellLevels[index]?.priceMinor ?? (hasBase ? sellPriceForYield(base.netDpsMicros!, level.yieldBps) : 0);
    const priceMinor = level.priceMinor ?? classicPrice;
    const grossPriceMinor = hasBase ? sellPriceForYield(base.grossDpsMicros!, level.yieldBps) : priceMinor;
    const sellShares = shares > 0
      ? sellCumulativePortion >= 10000
        ? shares
        : Math.floor(((shares * sellCumulativePortion) / 10000) / stock.lotSize) * stock.lotSize
      : 0;
    const touched = quotePriceMinor !== undefined && priceMinor > 0 && quotePriceMinor >= priceMinor;
    const gapFromQuoteBps = quotePriceMinor !== undefined && quotePriceMinor > 0 && priceMinor > 0
      ? Math.round(((priceMinor - quotePriceMinor) / quotePriceMinor) * 10000)
      : undefined;
    const status: ClassicGridTierRow['status'] = quotePriceMinor === undefined
      ? 'quote_pending'
      : !touched
        ? 'waiting'
        : shares <= 0
          ? 'no_holding'
          : sellShares > 0
            ? 'triggered'
            : 'below_lot';
    return {
      level: index + 1,
      side: 'sell',
      yieldBps: level.yieldBps,
      portionBps: level.portionBps,
      cumulativePortionBps: sellCumulativePortion,
      grossPriceMinor,
      priceMinor,
      classicPriceMinor: classicPrice,
      gapFromQuoteBps,
      sellShares: shares > 0 ? sellShares : undefined,
      touched,
      status,
    };
  });

  // Determine Today's Action
  const touchedBuys = buyRows.filter(r => r.touched);
  const touchedSells = sellRows.filter(r => r.touched);
  const triggeredBuyLevel = touchedBuys.length ? touchedBuys.at(-1)!.level : 0;
  const triggeredSellLevel = touchedSells.length ? touchedSells.at(-1)!.level : 0;
  const nextUntouchedBuy = buyRows.find(r => !r.touched) ?? buyRows[0];
  const nextUntouchedSell = sellRows.find(r => !r.touched) ?? sellRows[0];

  const maxBuyIncremental = Math.max(0, ...touchedBuys.map(r => r.incrementalShares ?? 0));
  const maxSellShares = Math.max(0, ...touchedSells.map(r => r.sellShares ?? 0));

  let todayAction: ClassicTodayAction;
  const priceText = (minor?: number) => minor === undefined ? '—' : `¥${(minor / 100).toFixed(2)}`;
  const pct = (bps?: number) => bps === undefined ? '—' : `${(bps / 100).toFixed(2)}%`;

  if (!buyRows.length && !sellRows.length) {
    todayAction = {
      type: 'unavailable',
      triggeredBuyLevel: 0,
      triggeredSellLevel: 0,
      suggestedShares: 0,
      headlineZh: '缺少已核验的最近分红批次，无法计算网格价格',
      headlineEn: 'No verified recent distribution batches; grid prices are unavailable',
      detailZh: '点击“刷新行情与分红”取得分红台账后自动计算；未核验前不给出买卖档位。',
      detailEn: 'Refresh quotes and dividends to build the distribution ledger. No buy or sell tiers are shown until verified.',
    };
  } else if (stock.buyPaused && triggeredBuyLevel > 0) {
    todayAction = {
      type: 'paused',
      triggeredBuyLevel,
      triggeredSellLevel,
      suggestedShares: 0,
      nextBuyPriceMinor: nextUntouchedBuy?.priceMinor,
      nextBuyGapBps: nextUntouchedBuy?.gapFromQuoteBps,
      nextSellPriceMinor: nextUntouchedSell?.priceMinor,
      nextSellGapBps: nextUntouchedSell?.gapFromQuoteBps,
      headlineZh: `股价已触及买${triggeredBuyLevel}档（≤${priceText(touchedBuys.at(-1)!.priceMinor)}），但当前已手动暂停买入`,
      headlineEn: `Price reached Buy Tier ${triggeredBuyLevel} (≤${priceText(touchedBuys.at(-1)!.priceMinor)}), but buying is manually paused`,
      detailZh: `若需执行加仓，可在编辑中解除“暂停买入”。当前扣税后股息率 ${pct(currentNetYieldBps)}。`,
      detailEn: `Unpause buying in settings to execute. Current after-tax yield: ${pct(currentNetYieldBps)}.`,
    };
  } else if (triggeredSellLevel > 0 && shares > 0 && maxSellShares > 0) {
    const row = touchedSells.at(-1)!;
    const amountMinor = quotePriceMinor ? maxSellShares * quotePriceMinor : undefined;
    todayAction = {
      type: 'sell',
      triggeredBuyLevel,
      triggeredSellLevel,
      suggestedShares: maxSellShares,
      suggestedAmountMinor: amountMinor,
      nextBuyPriceMinor: buyRows[0]?.priceMinor,
      nextBuyGapBps: buyRows[0]?.gapFromQuoteBps,
      nextSellPriceMinor: nextUntouchedSell?.priceMinor,
      nextSellGapBps: nextUntouchedSell?.gapFromQuoteBps,
      headlineZh: `触发卖${triggeredSellLevel}档（≥${priceText(row.priceMinor)}，股息率≤${pct(row.yieldBps)}），建议今日减仓 ${maxSellShares} 股`,
      headlineEn: `Triggered Sell Tier ${triggeredSellLevel} (≥${priceText(row.priceMinor)}), suggest selling ${maxSellShares} shares`,
      detailZh: `现价 ${priceText(quotePriceMinor)} 已进入高估止盈区（对应税后股息率 ${pct(currentNetYieldBps)}），按阶梯兑现 ${row.cumulativePortionBps / 100}% 持仓（约 ${priceText(amountMinor)}）。`,
      detailEn: `Current price ${priceText(quotePriceMinor)} is in the profit-taking zone (after-tax yield ${pct(currentNetYieldBps)}).`,
    };
  } else if (triggeredBuyLevel > 0) {
    const row = touchedBuys.at(-1)!;
    if (maxBuyIncremental > 0) {
      const amountMinor = quotePriceMinor ? maxBuyIncremental * quotePriceMinor : undefined;
      todayAction = {
        type: 'buy',
        triggeredBuyLevel,
        triggeredSellLevel,
        suggestedShares: maxBuyIncremental,
        suggestedAmountMinor: amountMinor,
        nextBuyPriceMinor: nextUntouchedBuy?.priceMinor,
        nextBuyGapBps: nextUntouchedBuy?.gapFromQuoteBps,
        nextSellPriceMinor: sellRows[0]?.priceMinor,
        nextSellGapBps: sellRows[0]?.gapFromQuoteBps,
        headlineZh: `触发买${triggeredBuyLevel}档（≤${priceText(row.priceMinor)}，股息率≥${pct(row.yieldBps)}），建议今日买入 ${maxBuyIncremental} 股`,
        headlineEn: `Triggered Buy Tier ${triggeredBuyLevel} (≤${priceText(row.priceMinor)}), suggest buying ${maxBuyIncremental} shares`,
        detailZh: `现价 ${priceText(quotePriceMinor)}（税后股息率 ${pct(currentNetYieldBps)}）低于买${triggeredBuyLevel}档上限，累计目标持仓 ${row.targetShares} 股，扣除已持 ${shares} 股后建议补足 ${maxBuyIncremental} 股（约 ${priceText(amountMinor)}）。`,
        detailEn: `Current price ${priceText(quotePriceMinor)} (yield ${pct(currentNetYieldBps)}) is at or below Buy Tier ${triggeredBuyLevel}. Target ${row.targetShares} shares, add ${maxBuyIncremental} shares.`,
      };
    } else if (budgetMinor === undefined || budgetMinor <= 0) {
      todayAction = {
        type: 'buy',
        triggeredBuyLevel,
        triggeredSellLevel,
        suggestedShares: stock.lotSize,
        suggestedAmountMinor: quotePriceMinor ? stock.lotSize * quotePriceMinor : undefined,
        nextBuyPriceMinor: nextUntouchedBuy?.priceMinor,
        nextBuyGapBps: nextUntouchedBuy?.gapFromQuoteBps,
        nextSellPriceMinor: sellRows[0]?.priceMinor,
        nextSellGapBps: sellRows[0]?.gapFromQuoteBps,
        headlineZh: `价格已触发买${triggeredBuyLevel}档（≤${priceText(row.priceMinor)}，股息率≥${pct(row.yieldBps)}），可按每档 25% 分批建仓`,
        headlineEn: `Price triggered Buy Tier ${triggeredBuyLevel} (≤${priceText(row.priceMinor)}, yield ≥${pct(row.yieldBps)})`,
        detailZh: `现价 ${priceText(quotePriceMinor)} 已进入高股息击球区（累计应配 ${row.cumulativePortionBps / 100}% 仓位）。为该股分配预算后可自动算出精确整手股数（1手=${stock.lotSize}股约 ${priceText(quotePriceMinor ? quotePriceMinor * stock.lotSize : undefined)}）。`,
        detailEn: `Price ${priceText(quotePriceMinor)} is in the buy zone (${row.cumulativePortionBps / 100}% cumulative weight). Assign a budget to calculate exact lot shares.`,
      };
    } else {
      todayAction = {
        type: 'hold_covered',
        triggeredBuyLevel,
        triggeredSellLevel,
        suggestedShares: 0,
        nextBuyPriceMinor: nextUntouchedBuy?.priceMinor,
        nextBuyGapBps: nextUntouchedBuy?.gapFromQuoteBps,
        nextSellPriceMinor: sellRows[0]?.priceMinor,
        nextSellGapBps: sellRows[0]?.gapFromQuoteBps,
        headlineZh: `价格处于买${triggeredBuyLevel}档区间（≤${priceText(row.priceMinor)}），当前持仓 ${shares} 股已满足本档目标，今日持股收息`,
        headlineEn: `In Buy Tier ${triggeredBuyLevel} zone (≤${priceText(row.priceMinor)}); current ${shares} shares already cover target`,
        detailZh: `本档累计目标 ${row.targetShares ?? 0} 股（或差额不足1手 ${stock.lotSize} 股），无需重复加仓，等待下一档 ${priceText(nextUntouchedBuy?.priceMinor)} 或派息。`,
        detailEn: `Current holdings already cover this tier's target (${row.targetShares ?? 0} shares). Hold and collect dividends.`,
      };
    }
  } else {
    const buy1 = buyRows[0];
    const sell1 = sellRows[0];
    const buyGapText = buy1?.gapFromQuoteBps !== undefined ? `距买1档 ${priceText(buy1.priceMinor)} 还需回落 ${Math.abs(buy1.gapFromQuoteBps / 100).toFixed(2)}%` : `买1档目标价 ${priceText(buy1?.priceMinor)}`;
    const sellGapText = sell1?.gapFromQuoteBps !== undefined ? `距卖1档 ${priceText(sell1.priceMinor)} 还需上涨 ${Math.abs(sell1.gapFromQuoteBps / 100).toFixed(2)}%` : `卖1档目标价 ${priceText(sell1?.priceMinor)}`;
    todayAction = {
      type: 'wait',
      triggeredBuyLevel: 0,
      triggeredSellLevel: 0,
      suggestedShares: 0,
      nextBuyPriceMinor: buy1?.priceMinor,
      nextBuyGapBps: buy1?.gapFromQuoteBps,
      nextSellPriceMinor: sell1?.priceMinor,
      nextSellGapBps: sell1?.gapFromQuoteBps,
      headlineZh: `今日未触发买卖档 · ${buyGapText}，耐心等待击球区`,
      headlineEn: `No tier triggered today · Wait for Buy 1 (${priceText(buy1?.priceMinor)}) or Sell 1 (${priceText(sell1?.priceMinor)})`,
      detailZh: `当前现价 ${priceText(quotePriceMinor)}（税后股息率 ${pct(currentNetYieldBps)}，5%中性锚 ${priceText(neutralPriceMinor)}）。${buyGapText}；${sellGapText}。`,
      detailEn: `Current price ${priceText(quotePriceMinor)} (after-tax yield ${pct(currentNetYieldBps)}, 5% anchor ${priceText(neutralPriceMinor)}).`,
    };
  }

  // Symmetric 20% distance: a quote far beyond the outermost tier means the
  // grid no longer fits the market, so the action becomes reference-only.
  const maximumSell = sellRows.length ? Math.max(...sellRows.map(row => row.priceMinor)) : undefined;
  const minimumBuy = buyRows.length ? Math.min(...buyRows.map(row => row.priceMinor)) : undefined;
  const aboveSellGapMet = quotePriceMinor !== undefined && maximumSell !== undefined && quotePriceMinor > maximumSell
    && BigInt(quotePriceMinor - maximumSell) * 10000n >= BigInt(maximumSell) * 2000n;
  const belowBuyGapMet = quotePriceMinor !== undefined && minimumBuy !== undefined && quotePriceMinor < minimumBuy
    && BigInt(minimumBuy - quotePriceMinor) * 10000n >= BigInt(minimumBuy) * 2000n;
  const marketDeviation: 'above_sell_grid' | 'below_buy_grid' | null = aboveSellGapMet ? 'above_sell_grid'
    : belowBuyGapMet ? 'below_buy_grid' : null;
  if (marketDeviation && todayAction.type !== 'unavailable') {
    const side = marketDeviation === 'above_sell_grid' ? '卖' : '买';
    const edge = marketDeviation === 'above_sell_grid' ? maximumSell : minimumBuy;
    const referenceHeadlineZh = `现价已超出网格最外${side}档 20%以上（${priceText(edge)}），仅作参考，不建议按档执行`;
    const referenceHeadlineEn = `Price is over 20% beyond the outermost ${side === '卖' ? 'sell' : 'buy'} tier (${priceText(edge)}); shown for reference only`;
    todayAction = {
      type: 'wait',
      triggeredBuyLevel: 0,
      triggeredSellLevel: 0,
      suggestedShares: 0,
      nextBuyPriceMinor: minimumBuy,
      nextBuyGapBps: buyRows[0]?.gapFromQuoteBps,
      nextSellPriceMinor: maximumSell,
      nextSellGapBps: sellRows[0]?.gapFromQuoteBps,
      headlineZh: referenceHeadlineZh,
      headlineEn: referenceHeadlineEn,
      detailZh: `现价 ${priceText(quotePriceMinor)} 已在最外${side}档（${priceText(edge)}）之外 20% 以上。网格区间已脱离现价，今日动作降级为仅参考；回到区间内再恢复执行。`,
      detailEn: `The quote ${priceText(quotePriceMinor)} is more than 20% outside the outermost ${side === '卖' ? 'sell' : 'buy'} tier (${priceText(edge)}); the grid no longer matches the market, so the action is reference-only until the price returns.`,
    };
  }

  // Build 3 Classic Health Checks (non-blocking, informative)
  const healthChecks: ClassicHealthCheck[] = [
    {
      key: 'yield_zone',
      status: currentNetYieldBps !== undefined && currentNetYieldBps >= 550 ? 'good' : currentNetYieldBps !== undefined && currentNetYieldBps < 450 ? 'caution' : 'neutral',
      labelZh: '股息率估值位置',
      labelEn: 'Yield Valuation Zone',
      detailZh: currentNetYieldBps !== undefined
        ? currentNetYieldBps >= 550
          ? `当前税后股息率 ${pct(currentNetYieldBps)} ≥ 5.50%，处于经典高息建仓区（低于5%中性锚 ${priceText(neutralPriceMinor)}）`
          : currentNetYieldBps >= 480
            ? `当前税后股息率 ${pct(currentNetYieldBps)}，处于 4.8%~5.5% 中性持有收息区间`
            : `当前税后股息率 ${pct(currentNetYieldBps)} < 4.80%，股价高于中性锚，注意分批止盈纪律`
        : hasBase
          ? `5.0% 中性锚定价 ${priceText(neutralPriceMinor)}，买1档(${pct(buyLadder[0])}) ${priceText(buyRows[0]?.priceMinor)}`
          : '取得已核验分红基数后显示股息率估值位置。',
      detailEn: currentNetYieldBps !== undefined
        ? `Current after-tax yield ${pct(currentNetYieldBps)} vs 5.0% neutral anchor (${priceText(neutralPriceMinor)}).`
        : hasBase ? `5.0% neutral anchor is ${priceText(neutralPriceMinor)}.` : 'The yield zone appears once a verified dividend base exists.',
    },
    {
      key: 'dividend_base',
      status: base.tier === 'recent_batches' ? (base.cappedAtEarnings || base.earningsUnchecked ? 'neutral' : 'good') : 'caution',
      labelZh: '分红基数',
      labelEn: 'Dividend Base',
      detailZh: base.strategyNoteZh,
      detailEn: base.strategyNoteEn,
    },
    {
      key: 'position_discipline',
      status: budgetMinor && budgetMinor > 0 ? 'good' : 'neutral',
      labelZh: '网格仓位与整手纪律',
      labelEn: 'Grid & Lot Discipline',
      detailZh: budgetMinor && budgetMinor > 0
        ? `分配预算 ${priceText(budgetMinor)}（权重 ${(stock.weightBps / 100).toFixed(2)}%），买档每档 25% 预算、卖档每档 25% 持仓，按 ${stock.lotSize} 股/手向下取整计算`
        : `当前未分配固定预算金额（权重 ${(stock.weightBps / 100).toFixed(2)}%），已按每档 25% 仓位比例直接给出触发价格`,
      detailEn: budgetMinor && budgetMinor > 0
        ? `Allocated budget ${priceText(budgetMinor)} (${(stock.weightBps / 100).toFixed(2)}%), 25% per tier, rounded to ${stock.lotSize}-share lots.`
        : `No fixed budget assigned; displaying 25% tier price levels directly.`,
    },
  ];

  return {
    code: stock.code,
    name: stock.name,
    group: stock.group,
    sector,
    shares,
    lotSize: stock.lotSize,
    weightBps: stock.weightBps,
    budgetMinor,
    buyPaused: Boolean(stock.buyPaused),
    quotePriceMinor,
    quoteChangePercent,
    quoteDate,
    quoteSource,
    currentGrossYieldBps,
    currentNetYieldBps,
    neutralPriceMinor,
    grossNeutralPriceMinor,
    base,
    gridOrigin,
    hasCustomPriceDiff,
    buyRows,
    sellRows,
    classicBuyLevels,
    classicSellLevels,
    todayAction,
    marketDeviation,
    healthChecks,
  };
}
